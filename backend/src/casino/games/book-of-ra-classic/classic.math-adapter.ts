import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLASSIC_ID,
  ClassicProfile,
  RULES,
  RULES_HASH,
  analyze,
  boardAt,
  evaluate,
  generateProfile,
  hash,
  IntRng,
  playRound,
} from './classic.engine';
import { CLASSIC_V1 } from './classic.definition';
import {
  canonicalProfileHash,
  confidenceInterval95,
  emptyClassHistogram,
  fineHistogram,
  payoutClass,
  standardDeviation,
} from '../../platform/math-control/math-control.analytics';
import { simulateCohort } from '../../platform/math-control/math-control.bankroll';
import { cohortSeeds, createSimulationRng } from '../../platform/math-control/math-control.random';
import {
  activationGradeMinimum,
  GameMathAdapter,
  GameMathCapabilities,
  GenerateProfileResult,
  MathCheck,
  MathPolicy,
  MathProfileArtifact,
  MonteCarloRun,
  PayoutClass,
  ProfileValidationOutcome,
  SessionConfig,
  SessionOutcomeSource,
  ValidationOptions,
} from '../../platform/math-control/math-control.types';

function file(relative: string): Buffer {
  const found = [
    join(__dirname, relative),
    join(process.cwd(), 'backend/src/casino/games/book-of-ra-classic', relative),
    join(process.cwd(), 'src/casino/games/book-of-ra-classic', relative),
  ].find(existsSync);
  if (!found) throw Error('CLASSIC_ARTIFACT_MISSING');
  return readFileSync(found);
}

const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

/**
 * The accepted red/black gamble is a doubling run at even odds, and the
 * recovered client's own rule text caps it at five attempts: a settled pending
 * win can therefore be multiplied by at most 32. That ceiling is a property of
 * the gamble, deliberately separate from the per-resolution `maxWinMultiplier`
 * of the paid and free games.
 */
export const CLASSIC_GAMBLE = {
  maxAttempts: 5,
  ceilingMultiplier: 2 ** 5,
} as const;

/** Payout bands used to describe reachable classes when no policy is in scope. */
const DESCRIPTIVE_BANDS = { min: 10, max: 50 } as const;

/**
 * Storage-stable precision for the derived analytic metadata.
 *
 * `expectedRtpPercent`, `triggerProbability`, `retriggerProbability`,
 * `featureReturn`, `maxPaid` and `maxFree` are *reported* metadata: the runtime
 * draws from the integer `positiveMass` and the native stop-index arrays, never
 * from these figures. Hashing them at full double precision made a stored
 * artifact unverifiable, because PostgreSQL jsonb does not round-trip every
 * 17-significant-digit double, so the row could not re-derive its own canonical
 * hash and every validate/activate failed with MATH_ARTIFACT_HASH_MISMATCH.
 *
 * Rounding only these six fields to nine decimal places keeps the reported value
 * exact to within 5e-10 (inside the 0.01 and 0.01pp validation tolerances) while
 * making the in-memory payload identical to what the database returns. Stop
 * indexes, masses, reels, paytable, RNG and the generator's search bounds are
 * untouched, and the frozen shipped artefact is never rewritten.
 */
const ANALYTIC_METADATA_PRECISION = 1e9;

function quantizeAnalyticMetadata(value: number): number {
  return Number.isFinite(value) ? Math.round(value * ANALYTIC_METADATA_PRECISION) / ANALYTIC_METADATA_PRECISION : value;
}

function normalizeAnalyticMetadata(payload: ClassicProfile): ClassicProfile {
  for (const table of Object.values(payload.tables)) {
    table.expectedRtpPercent = quantizeAnalyticMetadata(table.expectedRtpPercent);
    table.triggerProbability = quantizeAnalyticMetadata(table.triggerProbability);
    table.retriggerProbability = quantizeAnalyticMetadata(table.retriggerProbability);
    table.featureReturn = quantizeAnalyticMetadata(table.featureReturn);
    table.maxPaid = quantizeAnalyticMetadata(table.maxPaid);
    table.maxFree = quantizeAnalyticMetadata(table.maxFree);
  }
  return payload;
}

type ClassicGolden = { id: string; hash: string; rulesHash: string; payload: ClassicProfile };

let golden: ClassicGolden | undefined;

/** The shared simulator speaks `int(min,max)`; the engine speaks `int(upper)`. */
const intRngFor = (seed: string): IntRng => {
  const rng = createSimulationRng(seed);
  return (upperExclusive: number) => rng.int(0, upperExclusive - 1);
};

/**
 * The accepted frozen Classic profile.
 *
 * It is loaded from the artefact the repository ships, re-hashed on every load
 * and re-enumerated for every line count, so a tampered file cannot be served as
 * the default mathematics.
 */
export function defaultClassicProfile() {
  if (!golden) {
    const parsed = JSON.parse(file('math/rtp50-maxwin50.json').toString()) as ClassicGolden;
    if (
      !parsed
      || parsed.hash !== hash(parsed.payload)
      || parsed.rulesHash !== RULES_HASH
      || parsed.payload.gameId !== CLASSIC_ID
    ) {
      throw Error('CLASSIC_GOLDEN_HASH');
    }
    golden = parsed;
    for (let lines = 1; lines <= RULES.paylines.length; lines += 1) analyze(golden.payload, lines);
  }
  return golden;
}

/**
 * Identity of the mathematics this process executes.
 *
 * `classic.engine.ts` is the evaluator, and the file itself is the identity
 * anchor: it is copied into the build output byte-for-byte (see `nest-cli.json`),
 * so a profile generated in one environment stays verifiable in the other.
 */
export function classicIdentity() {
  return { engineSha256: sha256(file('classic.engine.ts')), rulesSha256: RULES_HASH };
}

/** Independent re-examination of one frozen Classic artifact. */
export function assertClassicArtifact(artifact: MathProfileArtifact): ClassicProfile {
  const identity = classicIdentity();
  if (
    artifact.gameId !== CLASSIC_ID
    || artifact.canonicalHash !== canonicalProfileHash(artifact)
    || artifact.engineSha256 !== identity.engineSha256
    || artifact.rulesSha256 !== identity.rulesSha256
  ) {
    throw Error('CLASSIC_PROFILE_IDENTITY_MISMATCH');
  }
  const p = artifact.payload as ClassicProfile;
  if (
    p.targetRtpPercent !== artifact.policy.targetRtpPercent
    || p.maxWinMultiplier !== artifact.policy.maxWinMultiplier
    || p.maxWinScope !== 'RESOLVED_SPIN'
    || artifact.policy.maxWinScope !== 'RESOLVED_SPIN'
    || artifact.policy.maxWinEnabled !== true
  ) {
    throw Error('CLASSIC_POLICY_PAYLOAD_MISMATCH');
  }
  for (let lines = 1; lines <= RULES.paylines.length; lines += 1) analyze(p, lines);
  return p;
}

@Injectable()
export class ClassicMathAdapter implements GameMathAdapter {
  readonly gameId = CLASSIC_ID;

  /**
   * The registered immutable default: the frozen `book-of-ra-classic.rtp50.v1`
   * artefact this game ships and falls back to whenever no profile is active.
   */
  defaultProfile() {
    const frozen = defaultClassicProfile();
    return { profileId: frozen.id, profileHash: frozen.hash };
  }

  identity() {
    return classicIdentity();
  }

  /** The compiled module the control plane can fork for a long job. */
  workerModule() {
    return __filename.endsWith('.js') ? { modulePath: __filename, exportName: 'ClassicMathAdapter' } : null;
  }

  async capabilities(): Promise<GameMathCapabilities> {
    return {
      ...this.identity(),
      gameId: this.gameId,
      minRtpPercent: 0,
      maxRtpPercent: 100,
      supportsZeroRtp: true,
      optionalGamble: {
        present: true,
        bounded: true,
        detail:
          `the native red/black gamble doubles the pending win at even odds and is capped at ` +
          `${CLASSIC_GAMBLE.maxAttempts} attempts, so a settled pending win can be multiplied at most ` +
          `${CLASSIC_GAMBLE.ceilingMultiplier}x; that cap is a property of the gamble and is separate from the ` +
          `RESOLVED_SPIN ceiling on each paid and free resolution`,
      },
      reachableClasses: await this.getReachableOutcomeClasses(),
      notes: [
        'Classic only: nine exact paylines, the native stop windows and the native paytable; separate from Deluxe.',
        'Generation supports BALANCED / AUTO hit rate / MED partial return and volatility with the bounded Classic support family; every other constraint is refused, never ignored.',
        'A paid round wagers a whole number of platform points, and the bankroll simulator requires the session stake to be exactly representable as a native stake x line count.',
        'MaxWin bounds each resolved paid and free spin against its locked originating stake, never the feature aggregate and never the optional gamble.',
      ],
    };
  }

  async generateProfile(policy: MathPolicy): Promise<GenerateProfileResult> {
    const unsupported = (detail: string): GenerateProfileResult => ({
      status: 'UNSUPPORTED',
      reasons: [{
        constraint: 'CLASSIC_SUPPORT_POLICY',
        requested: JSON.stringify(policy),
        achievable:
          'BALANCED pacing, AUTO hit rate, MED partial return and volatility, RESOLVED_SPIN with an asserted ceiling, '
          + `a resolved-spin ceiling of at least 18x, and the native nine-line support family`,
        detail,
      }],
      bestEffort: null,
    });
    // Every field of the policy is either honoured or refused here. Nothing is
    // silently ignored, and an incompatible request never degrades into a
    // different profile than the one that was asked for.
    if (policy.gameId !== this.gameId) return unsupported('This adapter only generates the Classic game.');
    if (policy.maxWinScope !== 'RESOLVED_SPIN') {
      return unsupported('Classic advertises a ceiling on each paid and free resolution, so the scope must be RESOLVED_SPIN.');
    }
    if (policy.maxWinEnabled === false) {
      return unsupported('A RESOLVED_SPIN profile is an asserted per-resolution ceiling; maxWinEnabled cannot be false.');
    }
    if (policy.maxWinEnabled !== undefined && typeof policy.maxWinEnabled !== 'boolean') {
      return unsupported('maxWinEnabled is explicit metadata; it is never coerced.');
    }
    if (policy.pacing !== 'BALANCED') {
      return unsupported('The Classic support family implements BALANCED pacing only.');
    }
    if (policy.customPacing !== null && policy.customPacing !== undefined) {
      return unsupported('Custom pacing weights are not part of the Classic support family.');
    }
    if (policy.hitRate.mode !== 'AUTO') {
      return unsupported('The Classic profile derives its hit rate from the target return; EXPLICIT and RANGE shapes are not implemented.');
    }
    if (policy.partialReturn !== 'MED') {
      return unsupported('The Classic support family produces the MED partial-return shape only.');
    }
    if (policy.volatility !== 'MED') {
      return unsupported('The Classic support family produces the MED volatility shape only.');
    }
    if (!Number.isFinite(policy.targetRtpPercent) || policy.targetRtpPercent < 0 || policy.targetRtpPercent > 100) {
      return unsupported('The requested return must be between 0 and 100 percent.');
    }
    if (!Number.isFinite(policy.maxWinMultiplier) || policy.maxWinMultiplier < 18) {
      return unsupported('The Classic support family proves a ceiling of at least 18x of the locked stake; a lower ceiling would truncate outcomes at runtime.');
    }
    if (
      !Number.isFinite(policy.bigWinMinMultiplier)
      || !Number.isFinite(policy.bigWinMaxMultiplier)
      || policy.bigWinMinMultiplier < 1
      || policy.bigWinMaxMultiplier < policy.bigWinMinMultiplier
    ) {
      return unsupported('The big-win bands must be ordered stake multiples of at least 1.');
    }

    let payload: ClassicProfile;
    try {
      payload = generateProfile(policy.targetRtpPercent, policy.maxWinMultiplier);
    } catch (error) {
      return unsupported(String(error));
    }
    // Normalise the derived analytic metadata BEFORE the artifact hash is taken,
    // so the shipped identity is exactly what the database returns.
    payload = normalizeAnalyticMetadata(payload);
    const analysis = analyze(payload);
    const share = analysis.expectedRtpPercent > 0
      ? (analysis.featureRtpPercent / analysis.expectedRtpPercent) * 100
      : 0;
    if (share < policy.featureContribution.minPercent || share > policy.featureContribution.maxPercent) {
      return unsupported(
        `The Classic feature share ${share.toFixed(4)}% is outside the requested ` +
        `${policy.featureContribution.minPercent}..${policy.featureContribution.maxPercent}%.`,
      );
    }
    // A RESOLVED_SPIN request that did not state the flag is stamped explicitly,
    // so the artifact carries the guarantee it actually proves.
    const artifactPolicy: MathPolicy = policy.maxWinEnabled === undefined
      ? { ...policy, maxWinEnabled: true }
      : policy;
    const artifact: MathProfileArtifact = {
      schemaVersion: 1,
      profileId: `${CLASSIC_ID}.g${hash({ payload, policy: artifactPolicy }).slice(0, 20)}`,
      gameId: this.gameId,
      ...this.identity(),
      policy: artifactPolicy,
      payload,
      canonicalHash: '',
      createdAt: new Date().toISOString(),
    };
    artifact.canonicalHash = canonicalProfileHash(artifact);
    const max = Math.max(analysis.paidMax, analysis.freeMax);
    return {
      status: 'SUPPORTED',
      artifact,
      analysis: {
        exactRtpPercent: analysis.expectedRtpPercent,
        baseRtpPercent: analysis.baseRtpPercent,
        featureRtpPercent: analysis.featureRtpPercent,
        featureTriggerProbability: analysis.triggerProbability,
        retriggerProbability: analysis.retriggerProbability,
        expectedFeatureSpins: null,
        featureDiverges: false,
        maxSingleSpinMultiplier: analysis.paidMax,
        maxResolvedPaidSpinMultiplier: analysis.paidMax,
        maxResolvedFreeSpinMultiplier: analysis.freeMax,
        maxResolvedSpinMultiplier: max,
        maxResolvedSpinBasis:
          'Exhaustive native-window support for every selected line count and every persistent expanding symbol.',
        maxRoundMultiplier: null,
        maxRoundBasis: 'Retriggers aggregate without a ceiling; the optional gamble is excluded and bounded separately.',
        reachableClasses: await this.getReachableOutcomeClasses(),
        notes: [
          'New Classic pre-draw weighted support, not the legacy server outcome-selection algorithm.',
          'Expected return is computed per expanding-symbol branch before averaging, so no retrigger approximation is used.',
          'No runtime truncation or rejection: every drawn stop window is a native window from the accepted support.',
        ],
      },
      calibration: {
        strategy: 'classic-finite-native-stop-support',
        parameters: { supportSeed: 'classic-reference-support-v1', candidates: 6000 },
        evaluatedCandidates: 6000,
        expectedRtpPercent: analysis.expectedRtpPercent,
        sample: null,
      },
    };
  }

  sessionSource(
    _policy: MathPolicy,
    artifact: MathProfileArtifact,
    config: SessionConfig,
  ): SessionOutcomeSource {
    const profile = assertClassicArtifact(artifact);
    // The stream is a deterministic function of the artifact's own identity:
    // the shared simulator supplies per-session seeds through `sessionSourceFor`,
    // and this entry point simply anchors on the profile that was activated.
    return this.sessionSourceFor(profile, `session:${artifact.canonicalHash}`, config);
  }

  /**
   * One session's outcome stream.
   *
   * The paid stake is debited once per round by the simulator; everything the
   * round returns - line wins, scatter wins and every free spin - is credited as
   * the return of that same round. Feature play never produces a second debit.
   */
  private sessionSourceFor(
    profile: ClassicProfile,
    seed: string,
    config: SessionConfig,
  ): SessionOutcomeSource {
    const rng = intRngFor(`${seed}:${CLASSIC_ID}`);
    const wager = this.nativeWagerFor(config.stakeUnits);
    return {
      drawPaidRound: () => {
        const round = playRound(profile, wager.bet, wager.lines, rng);
        return {
          returnUnits: round.totalWin,
          featureReturnUnits: round.featureWin,
          paidSpins: 1,
          freeSpins: round.freeSpins,
          totalResolvedSpins: 1 + round.freeSpins,
          featureTriggered: round.freeSpins > 0,
          retriggered: round.retriggers > 0,
        };
      },
    };
  }

  /**
   * Exact native decomposition of a session stake.
   *
   * The simulator debits `stakeUnits` per paid round and the game returns whole
   * points, so the stake has to be exactly `native per-line stake x line count`.
   * The decomposition prefers the widest line count the stake can carry; a value
   * that is not representable is refused rather than rounded to a nearby round.
   */
  private nativeWagerFor(stakeUnits: number): { bet: number; lines: number } {
    if (!Number.isSafeInteger(stakeUnits) || stakeUnits <= 0) {
      throw new Error('CLASSIC_SESSION_STAKE_INVALID: the session stake must be a positive whole number of points');
    }
    const lineCounts = [...CLASSIC_V1.lineCounts].reverse();
    for (const lines of lineCounts) {
      if (stakeUnits % lines !== 0) continue;
      const bet = stakeUnits / lines;
      if ((CLASSIC_V1.lineStakes as readonly number[]).includes(bet)) return { bet, lines };
    }
    throw new Error(
      `CLASSIC_SESSION_STAKE_NOT_NATIVE: ${stakeUnits} points is not exactly a native Classic round ` +
      `(per-line stake ${CLASSIC_V1.lineStakes.join('/')} x 1..${CLASSIC_V1.lines} lines)`,
    );
  }

  /**
   * One independent examination of a frozen Classic artifact.
   *
   * Everything here is recomputed from the artifact's own payload: the exact
   * expectation comes from a fresh enumeration of every stored native window,
   * the measured return comes from an independent simulated sample with its own
   * seed domain, and the bound is proved against the enumerated per-resolution
   * maxima. Nothing is copied from the generator, and no Deluxe figure is ever
   * reused.
   */
  async validateProfile(
    policy: MathPolicy,
    artifact: MathProfileArtifact,
    options: ValidationOptions,
  ): Promise<ProfileValidationOutcome> {
    const profile = assertClassicArtifact(artifact);
    const targetTolerance = options.rtpTolerancePercent;

    // --- exact, independent expectation and bound --------------------------
    const perLine = Array.from({ length: RULES.paylines.length }, (_, index) => analyze(profile, index + 1));
    const exact = analyze(profile, RULES.paylines.length);
    const maxDeviationPercent = Math.max(
      ...perLine.map((entry) => Math.abs(entry.expectedRtpPercent - policy.targetRtpPercent)),
    );
    const provedMax = Math.max(...perLine.flatMap((entry) => [entry.paidMax, entry.freeMax]));

    // --- independent simulated sample --------------------------------------
    const rng = intRngFor(options.validationSeedPrefix);
    const values: number[] = [];
    const histogram = emptyClassHistogram();
    let returned = 0;
    let featureReturn = 0;
    let triggers = 0;
    let retriggers = 0;
    let maximum = 0;
    let resolvedFreeSpins = 0;
    for (let round = 0; round < options.monteCarloRounds; round += 1) {
      const played = playRound(profile, 1, RULES.paylines.length, rng);
      const x = played.totalWin / RULES.paylines.length;
      values.push(x);
      returned += played.totalWin;
      featureReturn += played.featureWin;
      resolvedFreeSpins += played.freeSpins;
      triggers += played.freeSpins > 0 ? 1 : 0;
      retriggers += played.retriggers > 0 ? 1 : 0;
      maximum = Math.max(maximum, x);
      histogram[payoutClass(x, policy.bigWinMinMultiplier, policy.bigWinMaxMultiplier)] += 1;
    }
    const n = values.length;
    const paidWagerUnits = n * RULES.paylines.length;
    const measuredRtpPercent = (returned / paidWagerUnits) * 100;
    const ratio = (predicate: (value: number) => boolean) => values.filter(predicate).length / n;
    const ci = confidenceInterval95(values);
    const metrics: MonteCarloRun = {
      kind: 'MONTE_CARLO',
      seedPrefix: options.validationSeedPrefix,
      rounds: n,
      paidWagerUnits,
      returnedUnits: returned,
      measuredRtpPercent,
      ci95Bps: ci === null ? null : ci * 10000,
      hitRate: ratio((value) => value > 0),
      zeroRate: ratio((value) => value === 0),
      lossRate: ratio((value) => value < 1),
      partialRate: ratio((value) => value > 0 && value < 1),
      breakEvenRate: ratio((value) => value === 1),
      breakEvenBandRate: ratio((value) => value >= 0.5 && value < 1),
      classHistogram: histogram,
      fineHistogram: fineHistogram(values),
      maxObservedMultiplier: maximum,
      featureTriggerRate: triggers / n,
      featureRetriggerRate: retriggers / n,
      featureRtpPercent: (featureReturn / paidWagerUnits) * 100,
      volatilityStdDev: standardDeviation(values),
      abortedRounds: 0,
    };
    const ciHalfWidthPercent = ci === null ? null : ci * 100;
    // A fixed percentage-point tolerance is only meaningful once the sample is
    // precise enough to support it. The honest test of a volatile feature game is
    // the 95% interval, so the acceptance band is the wider of the requested
    // tolerance and this sample's own half-width - a genuinely wrong profile
    // still fails, because it has to be outside both.
    const effectiveTolerancePercent = ciHalfWidthPercent === null
      ? targetTolerance
      : Math.max(targetTolerance, ciHalfWidthPercent);

    // --- bankroll cohort on the same exact units ---------------------------
    const sessionConfig = options.sessionConfig;
    const { report: bankroll } = simulateCohort(
      (seed) => this.sessionSourceFor(profile, seed, sessionConfig),
      sessionConfig,
      cohortSeeds(options.bankrollSeedPrefix, options.bankrollSessions),
    );

    const minimum = activationGradeMinimum();
    const grade = n >= minimum.monteCarloRounds
      && options.bankrollSessions >= minimum.bankrollSessions
      && sessionConfig.horizonPaidSpins >= minimum.bankrollHorizonPaidSpins
      ? 'ACTIVATION' as const
      : 'PREVIEW' as const;

    const check = (id: string, ok: boolean, detail: string, value?: unknown): MathCheck => ({
      id,
      status: ok ? 'PASS' : 'FAIL',
      detail,
      ...(value === undefined ? {} : { value }),
    });
    const checks: MathCheck[] = [
      check(
        'ARTIFACT_IS_AN_ASSERTED_RESOLVED_SPIN_CEILING',
        artifact.policy.maxWinScope === 'RESOLVED_SPIN' && artifact.policy.maxWinEnabled === true,
        `scope ${artifact.policy.maxWinScope}, explicit ceiling flag ${String(artifact.policy.maxWinEnabled)}`,
      ),
      check(
        'POLICY_TARGET_MATCHES_PAYLOAD',
        profile.targetRtpPercent === policy.targetRtpPercent
        && profile.maxWinMultiplier === policy.maxWinMultiplier
        && profile.maxWinMultiplier === artifact.policy.maxWinMultiplier,
        `payload ${profile.targetRtpPercent}% at ${profile.maxWinMultiplier}x, policy ${policy.targetRtpPercent}% at ${policy.maxWinMultiplier}x`,
      ),
      check(
        'EXACT_RTP_MATCHES_TARGET',
        maxDeviationPercent <= 0.01,
        `fresh enumeration of every stored native window agrees with ${policy.targetRtpPercent}% within ${maxDeviationPercent.toFixed(6)}pp`,
        { maxDeviationPercent, exactRtpPercent: exact.expectedRtpPercent },
      ),
      check(
        'MONTE_CARLO_CI_COVERS_TARGET',
        ciHalfWidthPercent !== null
        && Math.abs(measuredRtpPercent - policy.targetRtpPercent) <= ciHalfWidthPercent,
        `${n} rounds measured ${measuredRtpPercent.toFixed(4)}% with a 95% half-width of ${ciHalfWidthPercent === null ? 'n/a' : ciHalfWidthPercent.toFixed(4)}pp`,
        { measuredRtpPercent, ci95Bps: metrics.ci95Bps },
      ),
      check(
        'MONTE_CARLO_WITHIN_TOLERANCE',
        Math.abs(measuredRtpPercent - policy.targetRtpPercent) <= effectiveTolerancePercent,
        `measured ${measuredRtpPercent.toFixed(4)}% vs requested ${policy.targetRtpPercent}% within the wider of the ` +
        `${targetTolerance}pp requested tolerance and the sample's 95% half-width ` +
        `${ciHalfWidthPercent === null ? 'n/a' : `${ciHalfWidthPercent.toFixed(4)}pp`}`,
      ),
      check(
        'MAX_WIN_PROVEN_WITHIN_CEILING',
        provedMax <= policy.maxWinMultiplier,
        `exhaustive per-resolution support proves ${provedMax.toFixed(4)}x <= ${policy.maxWinMultiplier}x of the locked originating stake`,
        { provedMax, ceiling: policy.maxWinMultiplier },
      ),
      check(
        'FEATURE_AGGREGATE_IS_NOT_THE_PER_RESOLUTION_CAP',
        profile.maxWinScope === 'RESOLVED_SPIN',
        'free spins aggregate across the feature chain without a round ceiling; the asserted bound applies to each resolution',
      ),
      check(
        'SUPPORT_COVERS_EVERY_LINE_COUNT_AND_EXPANDING_SYMBOL',
        perLine.length === RULES.paylines.length
        && RULES.paylines.length === CLASSIC_V1.lines
        && RULES.expandingSymbols.length === 9
        && perLine.every((entry) => entry.paidMax >= 0),
        `${perLine.length} line counts and ${RULES.expandingSymbols.length} persistent expanding symbols enumerated`,
      ),
      check(
        'FEATURE_LENGTH_IS_FINITE',
        perLine.every((entry) => entry.retriggerProbability * RULES.freeSpins < 1),
        `retrigger probability x ${RULES.freeSpins} free spins stays below one for every line count, so no round can diverge`,
      ),
      check(
        'BANKROLL_COHORT_COMPLETED',
        bankroll.totals.paidRounds > 0,
        `${options.bankrollSessions} sessions at ${sessionConfig.stakeUnits} units, horizon ${sessionConfig.horizonPaidSpins} paid spins`,
      ),
      check(
        'BANKROLL_ACCOUNTING_EXACT',
        bankroll.totals.ledgerIdentityHolds,
        'opening + returned - wager = closing holds exactly in whole simulation units',
      ),
      check(
        'EVIDENCE_GRADE_ACTIVATION',
        grade === 'ACTIVATION',
        `grade ${grade}: activation requires ${minimum.monteCarloRounds} rounds, ${minimum.bankrollSessions} sessions and a ${minimum.bankrollHorizonPaidSpins}-spin horizon; this run used ${n}, ${options.bankrollSessions} and ${sessionConfig.horizonPaidSpins}`,
      ),
      check(
        'PROFILE_IDENTITY',
        artifact.canonicalHash === canonicalProfileHash(artifact),
        `engine/rules/policy/payload binding rechecked at ${artifact.canonicalHash}`,
      ),
    ];

    return {
      runs: [
        metrics,
        {
          kind: 'ANALYTIC_REPRODUCTION',
          seedFree: true,
          rtpPercent: exact.expectedRtpPercent,
          agreementBps: Math.abs(exact.expectedRtpPercent - policy.targetRtpPercent) * 100,
        },
      ],
      metrics,
      bankroll,
      checks,
      result: checks.every((entry) => entry.status === 'PASS') ? 'PASS' : 'FAIL',
      grade,
    };
  }

  /**
   * The payout bands the frozen Classic support can actually reach.
   *
   * Derived from the stored native windows rather than asserted: every paid and
   * free resolution that any activated Classic profile can present is classified
   * with the descriptive BALANCED bands, and the reachable set is reported in the
   * canonical class order.
   */
  async getReachableOutcomeClasses(): Promise<PayoutClass[]> {
    const found = new Set<PayoutClass>();
    const profile = defaultClassicProfile().payload;
    for (let lines = 1; lines <= RULES.paylines.length; lines += 1) {
      const table = profile.tables[lines];
      if (!table) continue;
      for (const stops of [...table.paidZero, ...table.paidPositive]) {
        found.add(payoutClass(evaluate(boardAt(stops), 1, lines).win / lines, DESCRIPTIVE_BANDS.min, DESCRIPTIVE_BANDS.max));
      }
      for (const symbol of RULES.expandingSymbols) {
        for (const stops of table.free[symbol] ?? []) {
          found.add(payoutClass(
            evaluate(boardAt(stops), 1, lines, symbol).win / lines,
            DESCRIPTIVE_BANDS.min,
            DESCRIPTIVE_BANDS.max,
          ));
        }
      }
    }
    const order: PayoutClass[] = ['ZERO', 'PARTIAL_RETURN', 'BREAK_EVEN', 'SMALL', 'MEDIUM', 'BIG', 'MAX'];
    return order.filter((entry) => found.has(entry));
  }
}
