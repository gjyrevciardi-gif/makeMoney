import { Injectable } from '@nestjs/common';
import {
  canonicalProfileHash,
  confidenceInterval95,
  emptyClassHistogram,
  fineHistogram,
  payoutClass,
  sha256Hex,
  standardDeviation,
} from '../../platform/math-control/math-control.analytics';
import { simulateCohort, defaultSessionConfig, BANKROLL_DENOMINATION } from '../../platform/math-control/math-control.bankroll';
import { cohortSeeds, createSimulationRng } from '../../platform/math-control/math-control.random';
import { toExactNumber } from '../../platform/math-control/math-control.rational';
import type {
  CheckStatus,
  ConstraintReason,
  GameMathAdapter,
  GameMathCapabilities,
  GenerateProfileResult,
  MathCheck,
  MathPolicy,
  MathProfileArtifact,
  MonteCarloRun,
  PayoutClass,
  ProfileAnalysis,
  ProfileValidationOutcome,
  SessionConfig,
  SessionOutcomeSource,
  ValidationOptions,
  ValidationRun,
} from '../../platform/math-control/math-control.types';
import { PAYOUT_CLASSES } from '../../platform/math-control/math-control.types';
import {
  activationGradeMinimum,
  type EvidenceGrade,
  type MaxWinPin,
} from '../../platform/math-control/math-control.types';
import { analyzeProfileExact, type LlProfilePayload } from './lucky-lady.exact';
import {
  LUCKY_LADY_GAME_ID,
  loadVerifiedMath,
  type Board,
  type EngineModule,
  type RulesTable,
} from './lucky-lady.math';

/**
 * Lucky Lady's contribution to Game Math Control.
 *
 * The shared control plane owns policy, lifecycle, persistence, security and
 * session accounting. What stays here is only what is genuinely this game's:
 * the pre-draw stop weights its own evaluator consumes, the exact enumeration
 * of the boards those weights can reach, and the observation that this game's
 * optional red/black gamble can double an already-settled win without limit.
 */

/** Simulation-only denomination: 1 unit = 0.01 PTS. The live ladder is untouched. */
export const LUCKY_LADY_SESSION_CONFIG: SessionConfig = {
  ...defaultSessionConfig(),
};

/**
 * The optional gamble, as proved by the adapter's own settlement path
 * (`luckyLadyAdapter.gamble`): a win sets `pendingWin = stake * 2` and returns
 * the round to the GAMBLE phase, so there is no attempt cap and no ceiling.
 */
export const LUCKY_LADY_GAMBLE = {
  present: true,
  bounded: false,
  detail:
    'the red/black gamble doubles the pending win and returns to the GAMBLE phase with no attempt cap, ' +
    'so any reachable win can be doubled arbitrarily many times; only a ceiling that excludes the ' +
    'optional gamble can be proved',
} as const;

/**
 * The max-win pin a round is opened with.
 *
 * Pure and side-effect free: it records the scope, the explicit enabled flag
 * and the ceiling of the profile the round is pinned to. A legacy artifact that
 * carries no `maxWinEnabled` records `false` - nothing is reinterpreted, and no
 * `RESOLVED_SPIN` guarantee is claimed for it.
 */
export function resolveMaxWinPin(policy: MathPolicy, profileId: string, profileHash: string): MaxWinPin {
  return {
    maxWinEnabled: policy.maxWinEnabled === true,
    maxWinScope: policy.maxWinScope,
    maxWinMultiplier: policy.maxWinMultiplier,
    profileId,
    profileHash,
  };
}

/** The per-resolution maxima the `RESOLVED_SPIN` scope is proved against. */
export function resolvedSpinMaximums(analysis: ReturnType<typeof analyzeProfileExact>): {
  paid: number;
  free: number | null;
  ceiling: number | null;
  basis: string;
} {
  const paid = analysis.maxBoardMultiplier;
  const featureReachable = analysis.triggerProbability > 0;
  // A free spin that can never be reached imposes no bound - that is a proof of
  // unreachability, not an assumption. A reachable feature with a non-finite
  // maximum is unprovable and must fail closed rather than fall back to the
  // (smaller) paid maximum.
  const free = !featureReachable
    ? 0
    : Number.isFinite(analysis.maxFreeSpinMultiplier) ? analysis.maxFreeSpinMultiplier : null;
  const ceiling = free === null || !Number.isFinite(paid) ? null : Math.max(paid, free);
  const basis =
    `per-resolution proof from exact enumeration: largest paid spin ${paid.toFixed(4)}x of the paid stake, ` +
    (featureReachable
      ? `largest free spin ${free === null ? 'unprovable (non-finite)' : `${free.toFixed(4)}x`} of the locked paid stake `
      : 'free spins are unreachable, so they impose no bound ') +
    '(the free stake is not treated as zero). The feature chain and its retriggers aggregate without a ceiling.';
  return { paid, free, ceiling, basis };
}

/** Bounded structural sweep used only to describe what the game can express. */
const STRUCTURAL_STOPS_PER_REEL = 8;
const MAX_REACHABLE_BOARDS = 4_096;
const WEIGHT_SCALE = 1_000_000;

@Injectable()
export class LuckyLadyMathAdapter implements GameMathAdapter {
  readonly gameId = LUCKY_LADY_GAME_ID;

  identity() {
    const { hashes } = loadVerifiedMath();
    return { engineSha256: hashes.engineSha256, rulesSha256: hashes.rulesSha256 };
  }

  /**
   * Worker entry: the compiled module, when this process is running compiled
   * JavaScript. Under ts-jest/ts-node only source exists, so the runner falls
   * back to its bounded in-process queue.
   */
  workerModule() {
    if (typeof __filename !== 'string' || !__filename.endsWith('.js')) return null;
    return { modulePath: __filename, exportName: 'LuckyLadyMathAdapter' };
  }

  capabilities(): Promise<GameMathCapabilities> {
    const { engine, rules, hashes } = loadVerifiedMath();
    const structural = structuralEnvelope(rules, engine);
    const zeroBoard = structural.zeroBoard as number[] | null;
    return Promise.resolve({
      gameId: this.gameId,
      minRtpPercent: 0,
      maxRtpPercent: (structural.maxBoardMultiplier / 1) * 100,
      supportsZeroRtp: structural.zeroBoard !== null,
      optionalGamble: { ...LUCKY_LADY_GAMBLE },
      reachableClasses: structural.classes,
      engineSha256: hashes.engineSha256,
      rulesSha256: hashes.rulesSha256,
      notes: [
        'Return is measured over complete paid rounds: one paid board plus the whole free-spin chain it awards.',
        'A complete round is bounded in practice only by the engine\'s 20000-spin feature abort, which fails the round rather than truncating it.',
        'RESOLVED_SPIN scope: every paid-spin and free-spin resolution is bounded by the ceiling times the LOCKED ' +
          'originating paid stake (a free stake is never treated as zero); the feature chain and its retriggers ' +
          'aggregate without a ceiling by design, and no result is ever truncated or redrawn.',
        'The accepted lucky-lady.rtp50.v1 profile stays active by default; generated profiles are new immutable identities.',
        zeroBoard === null
          ? 'no zero-return board was found in the bounded structural sweep'
          : `zero return is reachable: stop combination ${zeroBoard.join(',')} wins nothing`,
      ],
    });
  }

  getReachableOutcomeClasses(): Promise<PayoutClass[]> {
    const { engine, rules } = loadVerifiedMath();
    return Promise.resolve(structuralEnvelope(rules, engine).classes);
  }

  /**
   * Generate a candidate profile.
   *
   * The search is deliberately bounded and explicit: a low anchor (the least
   * generous reachable board) and a high anchor (the most generous board that
   * still respects the requested ceiling) are chosen by coordinate refinement
   * through the game's own evaluator, the reachable board set is checked to be
   * entirely inside the ceiling, and the target return is then hit by bisecting
   * a single pre-draw weight ratio. Nothing here consults a player, a session,
   * a balance or any history.
   */
  async generateProfile(policy: MathPolicy): Promise<GenerateProfileResult> {
    const { engine, rules, hashes } = loadVerifiedMath();
    const constraints = constraintFailuresBeforeSearch(policy);
    if (constraints.length > 0) {
      return { status: 'UNSUPPORTED', reasons: constraints, bestEffort: null };
    }

    const cap = policy.maxWinMultiplier;
    const lines = rules.lines.length;
    const lowStops = refineStops(rules, engine, 'min', cap);
    // A bounded ladder of "most generous reachable board" levels. A calmer
    // ceiling-level board is what makes the requested volatility and
    // partial-return tiers reachable; the most generous board is simply the
    // last rung.
    const levels = [1.5, 2.5, 4, 7, 12, 20, 27]
      .filter((multiplier) => multiplier <= cap)
      .map((multiplier) => multiplier * lines);
    levels.push(cap * lines);

    const candidates: Array<{ anchors: { low: number[]; high: number[] }; solved: Solved; failures: ConstraintReason[] }> = [];
    const rangeReasons: ConstraintReason[] = [];

    for (const targetUnits of levels) {
      const highStops = refineHighForTarget(rules, engine, lowStops, targetUnits, cap);
      const anchors = repairCapSafeSet(rules, engine, lowStops, highStops, cap);
      if (!anchors) continue;
      const payloadAtCandidate = (t: number): LlProfilePayload => mixPayload(rules, anchors.low, anchors.high, t);
      const atLow = analyzeProfileExact(rules, engine, payloadAtCandidate(0), MAX_REACHABLE_BOARDS);
      const atHigh = analyzeProfileExact(rules, engine, payloadAtCandidate(1), MAX_REACHABLE_BOARDS);
      const lowRtp = atLow.totalRtpPercent;
      const highRtp = atHigh.totalRtpPercent;
      if (policy.targetRtpPercent > highRtp + 1e-9) {
        rangeReasons.push({
          constraint: 'TARGET_RTP_ABOVE_CEILING_FEASIBLE_MAXIMUM',
          requested: `${policy.targetRtpPercent}%`,
          achievable: `${highRtp.toFixed(4)}%`,
          detail:
            `With a ${(targetUnits / lines).toFixed(2)}x most-generous board inside a ${cap}x ceiling the ` +
            `reachable maximum is ${highRtp.toFixed(4)}%.`,
        });
        continue;
      }
      if (policy.targetRtpPercent < lowRtp - 1e-9) {
        rangeReasons.push({
          constraint: 'TARGET_RTP_BELOW_FLOOR_FEASIBLE_MINIMUM',
          requested: `${policy.targetRtpPercent}%`,
          achievable: `${lowRtp.toFixed(4)}%`,
          detail: `The least generous cap-safe board set still returns ${lowRtp.toFixed(4)}%.`,
        });
        continue;
      }
      // Endpoints are exact: at an endpoint the other anchor carries weight 0,
      // so its stops are unreachable and cannot widen the proved support.
      const solved: Solved = policy.targetRtpPercent <= lowRtp + 1e-9
        ? { t: 0, payload: payloadAtCandidate(0), analysis: atLow, evaluated: 0 }
        : policy.targetRtpPercent >= highRtp - 1e-9
          ? { t: 1, payload: payloadAtCandidate(1), analysis: atHigh, evaluated: 0 }
          : bisectMix(rules, engine, anchors, policy.targetRtpPercent, payloadAtCandidate);
      candidates.push({ anchors, solved, failures: constraintFailuresForProfile(policy, solved.analysis) });
      if (candidates[candidates.length - 1].failures.length === 0) break;
    }

    if (candidates.length === 0) {
      return {
        status: 'UNSUPPORTED',
        reasons: rangeReasons.length > 0
          ? dedupeReasons(rangeReasons)
          : [
              {
                constraint: 'MAX_WIN_CEILING_UNREACHABLE',
                requested: `${cap}x over the complete paid round`,
                achievable: 'no reachable board set satisfies the ceiling with a positive return',
                detail:
                  'Every candidate board set contains a board above the requested ceiling. Raise the ceiling or ' +
                  'lower the requested big-win band.',
              },
            ],
        bestEffort: null,
      };
    }

    candidates.sort((left, right) => left.failures.length - right.failures.length);
    const anchors = candidates[0].anchors;
    const solved = candidates[0].solved;
    const analysis = solved.analysis;
    const artifact: MathProfileArtifact = {
      schemaVersion: 1,
      profileId: profileIdFor(rules, engine, policy, anchors, hashes),
      gameId: this.gameId,
      engineSha256: hashes.engineSha256,
      rulesSha256: hashes.rulesSha256,
      // A new RESOLVED_SPIN profile records the explicit metadata. A legacy
      // policy that never carried the flag is written back unchanged, so the
      // canonical hash of an existing artifact cannot move.
      policy: policy.maxWinScope === 'RESOLVED_SPIN' && policy.maxWinEnabled === undefined
        ? { ...policy, maxWinEnabled: true }
        : policy,
      payload: solved.payload,
      canonicalHash: '',
      createdAt: new Date().toISOString(),
    };
    artifact.canonicalHash = canonicalProfileHash(artifact);

    const failures = constraintFailuresForProfile(policy, analysis);
    if (failures.length > 0) {
      return { status: 'UNSUPPORTED', reasons: failures, bestEffort: bestEffortOf(analysis, policy) };
    }

    return {
      status: 'SUPPORTED',
      artifact,
      analysis: toAnalysis(analysis, policy),
      calibration: {
        strategy: 'bounded-anchor-bisection',
        parameters: {
          lowStops: anchors.low,
          highStops: anchors.high,
          mix: solved.t,
          reachableBoards: analysis.reachableBoards,
          ceiling: cap,
        },
        evaluatedCandidates: solved.evaluated,
        expectedRtpPercent: analysis.totalRtpPercent,
        sample: null,
      },
    };
  }

  /**
   * Independent validation of a frozen profile.
   *
   * The analytical figures are recomputed from the artifact alone; the Monte
   * Carlo run and the bankroll cohort use seed domains that calibration never
   * touches, and the bankroll cohort gives every session its own stream.
   */
  async validateProfile(
    policy: MathPolicy,
    artifact: MathProfileArtifact,
    options: ValidationOptions,
  ): Promise<ProfileValidationOutcome> {
    const { engine, rules } = loadVerifiedMath();
    const payload = artifact.payload as LlProfilePayload;
    const exact = analyzeProfileExact(rules, engine, payload, MAX_REACHABLE_BOARDS);
    const checks: MathCheck[] = [];
    const runs: ValidationRun[] = [];

    // 1. Analytical reproduction, seed free.
    const reproduced = analyzeProfileExact(rules, engine, structuredClone(payload), MAX_REACHABLE_BOARDS);
    runs.push({
      kind: 'ANALYTIC_REPRODUCTION',
      seedFree: true,
      rtpPercent: reproduced.totalRtpPercent,
      agreementBps: Math.abs(reproduced.totalRtpPercent - exact.totalRtpPercent) * 100,
    });

    // 2. Independent Monte Carlo over complete paid rounds.
    const metrics = runMonteCarlo(rules, engine, payload, policy, options);
    runs.push(metrics.run);

    // 3. Complete-session bankroll validation on independent streams.
    const seeds = cohortSeeds(options.bankrollSeedPrefix, options.bankrollSessions);
    const sessionConfig = options.sessionConfig ?? LUCKY_LADY_SESSION_CONFIG;
    const { report } = simulateCohort(
      (seed) => this.sessionSourceFor(payload, seed, sessionConfig, rules, engine),
      sessionConfig,
      seeds,
    );

    const targetTolerance = options.rtpTolerancePercent;
    const ciHalfWidth = metrics.run.ci95Bps === null ? null : metrics.run.ci95Bps / 100;
    const exactWithinTolerance = Math.abs(exact.totalRtpPercent - policy.targetRtpPercent) <= targetTolerance;
    // Two distinct questions, with two distinct rules:
    //  - CI_COVERS_TARGET is the honest 95% interval test: the target must lie
    //    inside the interval the sample actually produced.
    //  - CONSISTENT_WITH_EXACT is a stated z-multiplier consistency check
    //    against the seed-free reproduction; the multiplier is named in the
    //    detail so it can never be mistaken for the CI.
    const CONSISTENCY_Z = 3;
    const ciCoversTarget = ciHalfWidth === null
      ? Math.abs(metrics.run.measuredRtpPercent - policy.targetRtpPercent) <= targetTolerance
      : Math.abs(metrics.run.measuredRtpPercent - policy.targetRtpPercent) <= ciHalfWidth;
    const consistencyTolerance = ciHalfWidth === null ? targetTolerance : CONSISTENCY_Z * ciHalfWidth;
    const mcConsistentWithExact =
      Math.abs(metrics.run.measuredRtpPercent - exact.totalRtpPercent) <= consistencyTolerance;

    checks.push(check(
      'EXACT_RTP_MATCHES_TARGET',
      exactWithinTolerance ? 'PASS' : 'FAIL',
      `exact ${exact.totalRtpPercent.toFixed(4)}% vs requested ${policy.targetRtpPercent}% (tolerance ${targetTolerance}pp)`,
      { exact: exact.totalRtpPercent, requested: policy.targetRtpPercent },
    ));
    checks.push(check(
      'MONTE_CARLO_CONSISTENT_WITH_EXACT',
      mcConsistentWithExact ? 'PASS' : 'FAIL',
      `${metrics.run.rounds} independent rounds measured ${metrics.run.measuredRtpPercent.toFixed(4)}% against the ` +
        `proved ${exact.totalRtpPercent.toFixed(4)}%; ${CONSISTENCY_Z}-sigma consistency tolerance ` +
        `${consistencyTolerance.toFixed(4)}pp (this is a stated z-multiplier, not the confidence interval)`,
      {
        measured: metrics.run.measuredRtpPercent,
        proved: exact.totalRtpPercent,
        zMultiplier: CONSISTENCY_Z,
        tolerancePercent: consistencyTolerance,
      },
    ));
    checks.push(check(
      'MONTE_CARLO_CI_COVERS_TARGET',
      ciCoversTarget ? 'PASS' : 'FAIL',
      ciHalfWidth === null
        ? 'no confidence interval could be computed'
        : `95% interval ${metrics.run.measuredRtpPercent.toFixed(4)}% +/- ${ciHalfWidth.toFixed(4)}pp must contain the ` +
          `requested ${policy.targetRtpPercent}%`,
      { ciHalfWidthPercent: ciHalfWidth },
    ));

    // 4. Maximum-win proof.
    const perSpin = resolvedSpinMaximums(exact);
    if (policy.maxWinScope === 'RESOLVED_SPIN') {
      // Metadata first: a new RESOLVED_SPIN profile must state the flag, and an
      // explicit `false` means no cap is claimed - it is never read as a pass.
      if (policy.maxWinEnabled === undefined) {
        checks.push(check(
          'MAX_WIN_METADATA_MISSING',
          'FAIL',
          'a RESOLVED_SPIN profile must carry explicit maxWinEnabled metadata; absence is legacy, not a guarantee',
        ));
      } else if (typeof policy.maxWinEnabled !== 'boolean') {
        checks.push(check(
          'MAX_WIN_METADATA_INVALID',
          'FAIL',
          `maxWinEnabled must be a boolean (received ${typeof policy.maxWinEnabled})`,
        ));
      } else if (policy.maxWinEnabled === false) {
        checks.push(check(
          'MAX_WIN_METADATA_NOT_ASSERTED',
          'UNSUPPORTED',
          'maxWinEnabled is false: this profile claims no per-resolution ceiling, so no cap is proved or advertised here',
        ));
      } else {
        // A payout may never exceed the cap: no tolerance is applied.
        const perSpinOk = perSpin.ceiling !== null && perSpin.ceiling <= policy.maxWinMultiplier;
        checks.push(check(
          'MAX_WIN_RESOLVED_SPIN_WITHIN_CEILING',
          perSpinOk ? 'PASS' : 'FAIL',
          `per-resolved-spin ceiling ${perSpin.ceiling === null ? 'unprovable' : `${perSpin.ceiling.toFixed(4)}x`}` +
            ` vs requested ${policy.maxWinMultiplier}x (no tolerance); ${perSpin.basis}`,
          {
            requested: policy.maxWinMultiplier,
            provedPaidSpinMax: perSpin.paid,
            provedFreeSpinMax: perSpin.free,
            provedResolvedSpinMax: perSpin.ceiling,
          },
        ));
      }
      checks.push(check(
        'MAX_WIN_AGGREGATE_DELIBERATELY_UNCAPPED',
        'PASS',
        'the feature chain and its retriggers may aggregate above the per-spin ceiling by design; no outcome is ' +
          'truncated, retruncated or redrawn',
        { aggregateUncapped: true },
      ));
    } else {
      const capOk = exact.maxRoundMultiplier <= policy.maxWinMultiplier + 1e-9;
      checks.push(check(
        'MAX_WIN_PROVEN_WITHIN_CEILING',
        capOk ? 'PASS' : 'FAIL',
        `proved ceiling ${exact.maxRoundMultiplier.toFixed(4)}x vs requested ${policy.maxWinMultiplier}x; ${exact.maxRoundBasis}`,
        { provedMax: exact.maxRoundMultiplier, requested: policy.maxWinMultiplier },
      ));
      // The acceptance-contract identity belongs to whole-round ceilings: with a
      // hard bound M on every outcome, E[X] can never exceed M * P(X > 0). It is
      // deliberately not asserted for RESOLVED_SPIN, where one round may resolve
      // many bounded spins.
      const expectedMultiplier = exact.totalRtpPercent / 100;
      const boundTimesHitRate = policy.maxWinMultiplier * exact.hitRate;
      checks.push(check(
        'RTP_WITHIN_BOUND_TIMES_HIT_RATE',
        expectedMultiplier <= boundTimesHitRate + 1e-12 ? 'PASS' : 'FAIL',
        `E[X] = ${expectedMultiplier.toFixed(6)} <= M x P(X>0) = ${boundTimesHitRate.toFixed(6)}`,
        { expectedMultiplier, boundTimesHitRate },
      ));
    }
    if (policy.maxWinScope === 'TOTAL_INCLUDING_OPTIONAL_GAMBLE') {
      // Fail closed: this game's gamble doubles a settled win with no attempt
      // cap, so no finite total-return ceiling can be proved. The policy scope
      // is part of the immutable artifact, so the claim can never be softened
      // after the fact.
      checks.push(check('OPTIONAL_GAMBLE_WITHIN_CEILING', 'FAIL', LUCKY_LADY_GAMBLE.detail));
    } else {
      checks.push(check(
        'OPTIONAL_GAMBLE_SCOPE_STATED',
        'PASS',
        policy.maxWinScope === 'RESOLVED_SPIN'
          ? 'ceiling applies to each resolved spin (paid or free) of the locked paid stake and explicitly excludes the optional gamble decision'
          : 'ceiling applies to the complete paid round and explicitly excludes the optional gamble decision',
        { scope: policy.maxWinScope },
      ));
    }

    // 5. Policy shape checks: hit rate, partial return, volatility, big wins,
    //    feature contribution.
    checks.push(...shapeChecks(policy, exact, metrics.run));

    // 6. Bankroll completeness: a validation without a completed cohort is not
    //    a validation.
    checks.push(check(
      'BANKROLL_COHORT_COMPLETED',
      report.sampleSize > 0 ? 'PASS' : 'FAIL',
      `${report.sampleSize} complete sessions, horizon ${report.horizonPaidSpins} paid spins, ` +
        `${report.censoredCount} censored, ${report.ruinedCount} busted`,
      { sampleSize: report.sampleSize, censored: report.censoredCount, ruined: report.ruinedCount },
    ));
    checks.push(check(
      'BANKROLL_ACCOUNTING_EXACT',
      report.totals.ledgerIdentityHolds ? 'PASS' : 'FAIL',
      `total return / total paid wager = ${report.measuredRtpExact}% (rounded presentation); ` +
        `opening ${report.totals.openingUnitsExact} + returned ${report.totals.returnedUnitsExact} - ` +
        `wager ${report.totals.paidWagerUnitsExact} = closing ${report.totals.closingUnitsExact} ` +
        `(delta ${report.totals.ledgerDeltaUnitsExact})`,
      {
        measuredRtpPercent: report.measuredRtpPercent,
        measuredRtpExact: report.measuredRtpExact,
        ledgerDeltaUnits: report.totals.ledgerDeltaUnits,
        ledgerDeltaUnitsExact: report.totals.ledgerDeltaUnitsExact,
        basePlusFeatureEqualsReturn:
          BigInt(report.totals.baseReturnUnitsExact) + BigInt(report.totals.featureReturnUnitsExact) ===
          BigInt(report.totals.returnedUnitsExact),
      },
    ));

    // Evidence grade: a short run is a preview, and a preview is never labelled
    // as a passing validation.
    const grade: EvidenceGrade =
      options.monteCarloRounds >= activationGradeMinimum().monteCarloRounds &&
      options.bankrollSessions >= activationGradeMinimum().bankrollSessions &&
      sessionConfig.horizonPaidSpins >= activationGradeMinimum().bankrollHorizonPaidSpins
        ? 'ACTIVATION'
        : 'PREVIEW';
    checks.push(check(
      'EVIDENCE_GRADE_ACTIVATION',
      grade === 'ACTIVATION' ? 'PASS' : 'FAIL',
      `grade ${grade}: activation requires at least ${activationGradeMinimum().monteCarloRounds} Monte Carlo rounds, ` +
        `${activationGradeMinimum().bankrollSessions} sessions and a horizon of ` +
        `${activationGradeMinimum().bankrollHorizonPaidSpins} paid spins; this run used ` +
        `${options.monteCarloRounds} rounds, ${options.bankrollSessions} sessions, horizon ${sessionConfig.horizonPaidSpins}`,
      { grade, monteCarloRounds: options.monteCarloRounds, bankrollSessions: options.bankrollSessions, horizon: sessionConfig.horizonPaidSpins },
    ));

    const result = checks.every((entry) => entry.status === 'PASS') ? 'PASS' : 'FAIL';
    return { runs, metrics: metrics.run, bankroll: report, checks, result, grade };
  }

  sessionSource(
    _policy: MathPolicy,
    artifact: MathProfileArtifact,
    config: SessionConfig,
  ): SessionOutcomeSource {
    const { engine, rules } = loadVerifiedMath();
    const seed = `session:${artifact.canonicalHash}`;
    return this.sessionSourceFor(artifact.payload as LlProfilePayload, seed, config, rules, engine);
  }

  /**
   * One session's outcome stream.
   *
   * The paid stake is debited once per round by the simulator; everything the
   * round returns - base win, scatter win and free spins - is credited as the
   * return of that same round. Feature play never produces a second debit.
   */
  private sessionSourceFor(
    payload: LlProfilePayload,
    seed: string,
    config: SessionConfig,
    rules: RulesTable,
    engine: EngineModule,
  ): SessionOutcomeSource {
    const rng = createSimulationRng(`${seed}:lucky-lady`);
    const lines = rules.lines.length;
    // Exact unit scaling: one engine bet-unit must be a whole number of
    // simulation units, otherwise the conversion would have to round and the
    // ledger identity would stop being exact.
    if (config.stakeUnits % lines !== 0) {
      throw new Error(
        `SESSION_UNIT_SCALE_NOT_INTEGRAL: ${config.stakeUnits} units / ${lines} lines is not a whole number`,
      );
    }
    const unitsPerEngineUnit = config.stakeUnits / lines;
    if (!Number.isSafeInteger(unitsPerEngineUnit) || unitsPerEngineUnit <= 0) {
      throw new Error(`SESSION_UNIT_SCALE_NOT_INTEGRAL: scale ${unitsPerEngineUnit} is not a positive integer`);
    }
    /**
     * Validate the engine's own value first, multiply in BigInt, then mirror
     * with a checked conversion: no pre-rounded operand ever reaches the
     * accounting path.
     */
    const scaleEngineUnits = (engineUnits: number, label: string): number => {
      if (!Number.isSafeInteger(engineUnits) || engineUnits < 0) {
        throw new Error(`SESSION_ENGINE_${label}_INVALID: ${engineUnits}`);
      }
      const product = BigInt(engineUnits) * BigInt(unitsPerEngineUnit);
      const mirrored = toExactNumber(product);
      if (mirrored === null) {
        throw new Error(`SESSION_UNIT_PRODUCT_OUT_OF_RANGE: ${label} ${product}`);
      }
      return mirrored;
    };
    return {
      drawPaidRound() {
        const round = engine.playRound(rules, payload, {
          bet: 1,
          lines,
          rng,
          capture: false,
        });
        const returnUnits = scaleEngineUnits(round.totalWin, 'RETURN');
        const featureReturnUnits = scaleEngineUnits(round.feature.win, 'FEATURE_RETURN');
        // Authoritative resolved counts for this round: the engine reports how
        // many free spins it actually played, retriggers included. Nothing is
        // inferred from the trigger flag and nothing is replayed.
        const paidSpins = 1;
        const freeSpins = round.feature.spins;
        if (!Number.isSafeInteger(freeSpins) || freeSpins < 0) {
          throw new Error('SESSION_FREE_SPIN_COUNT_INVALID: the engine reported an unusable free-spin count');
        }
        const totalResolvedSpins = paidSpins + freeSpins;
        if (!Number.isSafeInteger(totalResolvedSpins)) {
          throw new Error('SESSION_RESOLVED_SPIN_COUNT_INVALID: the resolved count is not representable');
        }
        return {
          returnUnits,
          featureReturnUnits,
          paidSpins,
          freeSpins,
          totalResolvedSpins,
          featureTriggered: round.feature.triggered,
          retriggered: round.feature.retriggers > 0,
        };
      },
    };
  }
}

/** A ceiling that no single session can approach; used only for the gamble scope. */
const LUCKY_LADY_GAMBLE_MAX_SENTINEL = Number.POSITIVE_INFINITY;

// ---------------------------------------------------------------------------
// Anchors and mixing
// ---------------------------------------------------------------------------

function stopWindows(rules: RulesTable): { reelKey: string; strip: string[] }[] {
  const strips = rules.reels as Record<string, string[]>;
  return Object.keys(strips)
    .sort((a, b) => Number(a.replace('reelStrip', '')) - Number(b.replace('reelStrip', '')))
    .map((reelKey) => ({ reelKey, strip: strips[reelKey] }));
}

function boardFor(reels: { reelKey: string; strip: string[] }[], stops: readonly number[], rules: RulesTable): Board {
  const board = { rp: [...stops] } as Board;
  reels.forEach((reel, index) => {
    const stop = stops[index];
    const reelIndex = Number(reel.reelKey.replace('reelStrip', ''));
    board[`reel${reelIndex}`] = [reel.strip[stop], reel.strip[stop + 1], reel.strip[stop + 2], String(rules.emptyRow)];
  });
  return board;
}

function boardWin(rules: RulesTable, engine: EngineModule, reels: { reelKey: string; strip: string[] }[], stops: readonly number[]) {
  const evaluation = engine.evaluate(rules, boardFor(reels, stops, rules), { bet: 1, lines: rules.lines.length });
  return { evaluation, units: evaluation.totalWin, triggers: evaluation.scatterCount >= 3 };
}

/**
 * Coordinate refinement of a stop choice.
 *
 * `min` walks the board win down to the least generous reachable board; `max`
 * walks it up while keeping the single board inside the requested ceiling.
 */
function refineStops(rules: RulesTable, engine: EngineModule, direction: 'min' | 'max', cap: number): number[] {
  const reels = stopWindows(rules);
  const capUnits = cap * rules.lines.length;
  const stops = reels.map((reel) => (direction === 'min' ? 0 : Math.max(0, reel.strip.length - 3)));
  for (let pass = 0; pass < 4; pass += 1) {
    reels.forEach((reel, index) => {
      const stopCount = reel.strip.length - 2;
      let best = stops[index];
      let bestValue = direction === 'min' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
      for (let candidate = 0; candidate < stopCount; candidate += 1) {
        stops[index] = candidate;
        const { units } = boardWin(rules, engine, reels, stops);
        if (direction === 'max' && units > capUnits) continue;
        if (direction === 'min' ? units < bestValue : units > bestValue) {
          bestValue = units;
          best = candidate;
        }
      }
      stops[index] = best;
    });
  }
  return stops;
}

/**
 * Coordinate refinement of the "most generous board" rung.
 *
 * Each rung targets a total board win; the reel stops are chosen to land as
 * close to that target as possible while never exceeding the ceiling. A calmer
 * rung is what lets a low-volatility or partial-return request be satisfied.
 */
function refineHighForTarget(
  rules: RulesTable,
  engine: EngineModule,
  low: readonly number[],
  targetUnits: number,
  cap: number,
): number[] {
  const reels = stopWindows(rules);
  const capUnits = cap * rules.lines.length;
  const stops = [...low];
  for (let pass = 0; pass < 3; pass += 1) {
    reels.forEach((reel, index) => {
      const stopCount = reel.strip.length - 2;
      let best = stops[index];
      let bestScore = Number.POSITIVE_INFINITY;
      for (let candidate = 0; candidate < stopCount; candidate += 1) {
        stops[index] = candidate;
        const { units } = boardWin(rules, engine, reels, stops);
        if (units > capUnits) continue;
        const score = Math.abs(units - targetUnits);
        if (score < bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
      stops[index] = best;
    });
  }
  return stops;
}

function dedupeReasons(reasons: ConstraintReason[]): ConstraintReason[] {
  const seen = new Map<string, ConstraintReason>();
  for (const reason of reasons) {
    const existing = seen.get(reason.constraint);
    if (!existing || parseFloat(reason.achievable) > parseFloat(existing.achievable)) {
      seen.set(reason.constraint, reason);
    }
  }
  return [...seen.values()];
}

/**
 * Make sure the *whole* reachable cross-product respects the ceiling.
 *
 * Mixing two anchors makes every combination of them reachable, so the
 * ceiling has to hold for all of them, not only for the most generous board.
 */
function repairCapSafeSet(
  rules: RulesTable,
  engine: EngineModule,
  low: number[],
  high: number[],
  cap: number,
): { low: number[]; high: number[] } | null {
  const reels = stopWindows(rules);
  const lowStops = [...low];
  const highStops = [...high];
  const capUnits = cap * rules.lines.length;

  for (let attempt = 0; attempt < 64; attempt += 1) {
    const payload: LlProfilePayload = {
      stopWeights: Object.fromEntries(
        reels.map((reel, index) => {
          const stopCount = reel.strip.length - 2;
          const weights = new Array(stopCount).fill(0);
          weights[lowStops[index]] = 1;
          if (highStops[index] !== lowStops[index]) weights[highStops[index]] = 1;
          return [reel.reelKey, weights];
        }),
      ),
    };
    let analysis;
    try {
      analysis = analyzeProfileExact(rules, engine, payload, MAX_REACHABLE_BOARDS);
    } catch {
      return null;
    }
    if (analysis.maxRoundMultiplier <= cap + 1e-9) {
      return { low: lowStops, high: highStops };
    }
    // Downgrade the reel whose high anchor contributes to the worst board.
    const worstIndex = worstBoardReel(rules, engine, reels, lowStops, highStops, capUnits);
    if (worstIndex === null) return null;
    const stopCount = reels[worstIndex].strip.length - 2;
    const currentHigh = highStops[worstIndex];
    let replacement = currentHigh;
    let best = Number.POSITIVE_INFINITY;
    for (let candidate = 0; candidate < stopCount; candidate += 1) {
      if (candidate === currentHigh) continue;
      const trial = [...highStops];
      trial[worstIndex] = candidate;
      const units = worstCrossProductUnits(rules, engine, reels, lowStops, trial);
      if (units < best) {
        best = units;
        replacement = candidate;
      }
    }
    if (replacement === currentHigh) return null;
    highStops[worstIndex] = replacement;
  }
  return null;
}

function worstCrossProductUnits(
  rules: RulesTable,
  engine: EngineModule,
  reels: { reelKey: string; strip: string[] }[],
  low: readonly number[],
  high: readonly number[],
): number {
  let worst = 0;
  const choices = reels.map((_, index) => (low[index] === high[index] ? [low[index]] : [low[index], high[index]]));
  const walk = (index: number, stops: number[]) => {
    if (index === choices.length) {
      const { units } = boardWin(rules, engine, reels, stops);
      if (units > worst) worst = units;
      return;
    }
    for (const stop of choices[index]) walk(index + 1, [...stops, stop]);
  };
  walk(0, []);
  return worst;
}

function worstBoardReel(
  rules: RulesTable,
  engine: EngineModule,
  reels: { reelKey: string; strip: string[] }[],
  low: readonly number[],
  high: readonly number[],
  capUnits: number,
): number | null {
  const choices = reels.map((_, index) => (low[index] === high[index] ? [low[index]] : [low[index], high[index]]));
  let worst = -1;
  let worstStops: number[] = [];
  const walk = (index: number, stops: number[]) => {
    if (index === choices.length) {
      const { units } = boardWin(rules, engine, reels, stops);
      if (units > worst) {
        worst = units;
        worstStops = [...stops];
      }
      return;
    }
    for (const stop of choices[index]) walk(index + 1, [...stops, stop]);
  };
  walk(0, []);
  if (worst <= capUnits) return null;
  for (let index = 0; index < reels.length; index += 1) {
    if (worstStops[index] === high[index] && high[index] !== low[index]) return index;
  }
  return null;
}

function mixPayload(
  rules: RulesTable,
  low: readonly number[],
  high: readonly number[],
  t: number,
): LlProfilePayload {
  const reels = stopWindows(rules);
  const clamped = Math.min(1, Math.max(0, t));
  const highWeight = Math.round(clamped * WEIGHT_SCALE);
  const stopWeights: Record<string, number[]> = {};
  reels.forEach((reel, index) => {
    const stopCount = reel.strip.length - 2;
    const weights = new Array(stopCount).fill(0);
    if (low[index] === high[index]) {
      weights[low[index]] = WEIGHT_SCALE;
    } else {
      weights[low[index]] = WEIGHT_SCALE - highWeight;
      weights[high[index]] = highWeight;
    }
    stopWeights[reel.reelKey] = weights;
  });
  return { stopWeights };
}

type Solved = { t: number; payload: LlProfilePayload; analysis: ReturnType<typeof analyzeProfileExact>; evaluated: number };

function bisectMix(
  rules: RulesTable,
  engine: EngineModule,
  anchors: { low: number[]; high: number[] },
  target: number,
  payloadAt: (t: number) => LlProfilePayload,
): Solved {
  let evaluated = 0;
  const interior = (t: number) => {
    // Keep both anchors reachable so the reachable board set, and therefore the
    // proved ceiling, is identical everywhere in the search.
    const highWeight = Math.min(WEIGHT_SCALE - 1, Math.max(1, Math.round(t * WEIGHT_SCALE)));
    return highWeight / WEIGHT_SCALE;
  };
  const evaluate = (t: number) => {
    const payload = payloadAt(interior(t));
    const analysis = analyzeProfileExact(rules, engine, payload, MAX_REACHABLE_BOARDS);
    evaluated += 1;
    return { t: interior(t), payload, analysis, evaluated };
  };

  let low = 0;
  let high = 1;
  let best = evaluate(0.5);
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const mid = (low + high) / 2;
    const candidate = evaluate(mid);
    if (Math.abs(candidate.analysis.totalRtpPercent - target) < Math.abs(best.analysis.totalRtpPercent - target)) {
      best = candidate;
    }
    if (Math.abs(candidate.analysis.totalRtpPercent - target) <= 0.001) break;
    if (candidate.analysis.totalRtpPercent < target) low = mid;
    else high = mid;
  }
  return { ...best, evaluated };
}

function toAnalysis(analysis: ReturnType<typeof analyzeProfileExact>, policy: MathPolicy): ProfileAnalysis {
  const classes = new Set<PayoutClass>();
  for (const entry of analysis.baseDistribution) {
    classes.add(payoutClass(entry.returnMultiplier, policy.bigWinMinMultiplier, policy.bigWinMaxMultiplier));
  }
  const perSpin = resolvedSpinMaximums(analysis);
  return {
    exactRtpPercent: analysis.totalRtpPercent,
    baseRtpPercent: analysis.baseRtpPercent,
    featureRtpPercent: analysis.featureRtpPercent,
    featureTriggerProbability: analysis.triggerProbability,
    retriggerProbability: analysis.retriggerProbability,
    expectedFeatureSpins: analysis.expectedFeatureSpins,
    featureDiverges: analysis.featureDiverges,
    maxSingleSpinMultiplier: analysis.maxBoardMultiplier,
    maxResolvedPaidSpinMultiplier: perSpin.paid,
    maxResolvedFreeSpinMultiplier: perSpin.free,
    maxResolvedSpinMultiplier: perSpin.ceiling,
    maxResolvedSpinBasis: perSpin.basis,
    maxRoundMultiplier: analysis.maxRoundMultiplier,
    maxRoundBasis: analysis.maxRoundBasis,
    reachableClasses: PAYOUT_CLASSES.filter((value) => classes.has(value)),
    notes: [],
  };
}

function bestEffortOf(analysis: ReturnType<typeof analyzeProfileExact>, policy: MathPolicy) {
  return { analysis: toAnalysis(analysis, policy), rtpPercent: analysis.totalRtpPercent };
}

function profileIdFor(
  _rules: RulesTable,
  _engine: EngineModule,
  policy: MathPolicy,
  anchors: { low: number[]; high: number[] },
  hashes: { engineSha256: string; rulesSha256: string },
): string {
  const digest = sha256Hex(
    `${policy.gameId}|${policy.targetRtpPercent}|${policy.maxWinMultiplier}|` +
      `${anchors.low.join(',')}|${anchors.high.join(',')}|${hashes.engineSha256}`,
  ).slice(0, 12);
  const rtpTag = Number.isInteger(policy.targetRtpPercent)
    ? String(policy.targetRtpPercent)
    : policy.targetRtpPercent.toFixed(2).replace('.', 'p');
  return `${policy.gameId}.rtp${rtpTag}.g${digest}`;
}

// ---------------------------------------------------------------------------
// Constraint evaluation
// ---------------------------------------------------------------------------

function constraintFailuresBeforeSearch(policy: MathPolicy): ConstraintReason[] {
  const failures: ConstraintReason[] = [];
  if (policy.maxWinScope === 'TOTAL_INCLUDING_OPTIONAL_GAMBLE') {
    failures.push({
      constraint: 'GAMBLE_UNBOUNDED_TOTAL_CEILING',
      requested: `${policy.maxWinMultiplier}x including the optional gamble`,
      achievable: 'no finite ceiling',
      detail: LUCKY_LADY_GAMBLE.detail,
    });
  }
  // The aggregate-ceiling conflict belongs to the scopes that promise a
  // complete-round bound. `RESOLVED_SPIN` bounds one resolution at a time and
  // deliberately lets the chain aggregate, so a feature-bearing profile is
  // allowed there instead of being refused.
  if (
    policy.maxWinScope !== 'RESOLVED_SPIN' &&
    policy.featureContribution.minPercent > 0 &&
    policy.maxWinMultiplier < LUCKY_LADY_GAMBLE_MAX_SENTINEL
  ) {
    failures.push({
      constraint: 'FEATURE_AND_HARD_CEILING_CONFLICT',
      requested: `at least ${policy.featureContribution.minPercent}% of return from features inside a ${policy.maxWinMultiplier}x ceiling`,
      achievable: 'a feature-free profile inside a finite ceiling, or a feature profile with no finite ceiling',
      detail:
        'A reachable free-spin award can retrigger without a configured count limit, so a complete paid round has ' +
        'no finite return bound that a player cannot exceed. Requesting feature contribution above zero together ' +
        'with a finite hard ceiling is therefore unprovable, and this adapter refuses instead of narrowing the claim.',
    });
  }
  return failures;
}

function constraintFailuresForProfile(
  policy: MathPolicy,
  analysis: ReturnType<typeof analyzeProfileExact>,
): ConstraintReason[] {
  const failures: ConstraintReason[] = [];
  const perSpin = resolvedSpinMaximums(analysis);
  if (policy.maxWinScope === 'RESOLVED_SPIN') {
    // No tolerance: a single resolution may never exceed the advertised cap.
    if (perSpin.ceiling === null || perSpin.ceiling > policy.maxWinMultiplier) {
      failures.push({
        constraint: 'MAX_WIN_RESOLVED_SPIN_UNPROVABLE',
        requested: `${policy.maxWinMultiplier}x per resolved spin`,
        achievable: perSpin.ceiling === null ? 'unprovable' : `${perSpin.ceiling.toFixed(4)}x`,
        detail: perSpin.basis,
      });
    }
  } else if (analysis.maxRoundMultiplier > policy.maxWinMultiplier + 1e-9) {
    failures.push({
      constraint: 'MAX_WIN_CEILING_UNPROVABLE',
      requested: `${policy.maxWinMultiplier}x`,
      achievable: `${analysis.maxRoundMultiplier.toFixed(4)}x`,
      detail: analysis.maxRoundBasis,
    });
  }
  // A profile whose whole support is unreachable-winning cannot contain a
  // big-win band; that is the point of a true 0% profile, not a defect.
  const zeroProfile = analysis.totalRtpPercent === 0;
  if (!zeroProfile && analysis.maxBoardMultiplier < policy.bigWinMinMultiplier) {
    failures.push({
      constraint: 'BIG_WIN_BAND_UNREACHABLE',
      requested: `big wins from ${policy.bigWinMinMultiplier}x`,
      achievable: `${analysis.maxBoardMultiplier.toFixed(4)}x`,
      detail: 'The requested big-win band starts above the largest win this cap-safe board set can produce.',
    });
  }
  const hit = analysis.hitRate;
  if (policy.hitRate.mode === 'EXPLICIT' && Math.abs(hit - policy.hitRate.target) > 0.02) {
    failures.push({
      constraint: 'HIT_RATE_OUT_OF_TOLERANCE',
      requested: policy.hitRate.target.toFixed(4),
      achievable: hit.toFixed(4),
      detail: 'The hit rate this distribution produces differs from the requested target by more than 2 percentage points.',
    });
  }
  if (policy.hitRate.mode === 'RANGE' && (hit < policy.hitRate.min || hit > policy.hitRate.max)) {
    failures.push({
      constraint: 'HIT_RATE_OUTSIDE_RANGE',
      requested: `${policy.hitRate.min}..${policy.hitRate.max}`,
      achievable: hit.toFixed(4),
      detail: 'The hit rate this distribution produces falls outside the requested range.',
    });
  }
  const [partialMin, partialMax] = PARTIAL_TIERS[policy.partialReturn];
  if (analysis.partialRate < partialMin || analysis.partialRate > partialMax) {
    failures.push({
      constraint: 'PARTIAL_RETURN_TIER_UNSATISFIED',
      requested: `${policy.partialReturn} (${partialMin}..${partialMax} of rounds returning between 0x and 1x)`,
      achievable: analysis.partialRate.toFixed(4),
      detail:
        'The reachable board set this search can build does not place enough rounds inside the requested ' +
        'partial-return band. The control plane refuses rather than relabelling the profile.',
    });
  }
  const [volMin, volMax] = VOLATILITY_TIERS[policy.volatility];
  if (analysis.baseVolatility < volMin || analysis.baseVolatility > volMax) {
    failures.push({
      constraint: 'VOLATILITY_TIER_UNSATISFIED',
      requested: `${policy.volatility} (${volMin}..${volMax === Number.POSITIVE_INFINITY ? 'inf' : volMax} return standard deviation)`,
      achievable: analysis.baseVolatility.toFixed(4),
      detail: 'The requested volatility tier is outside what this bounded board set produces.',
    });
  }
  failures.push(...customPacingFailures(policy, analysis));
  return failures;
}

const PARTIAL_TIERS = {
  LOW: [0, 0.15],
  MED: [0.15, 0.35],
  HIGH: [0.35, 1],
} as const satisfies Record<string, readonly [number, number]>;

const VOLATILITY_TIERS = {
  LOW: [0, 1],
  MED: [1, 3],
  HIGH: [3, Number.POSITIVE_INFINITY],
} as const satisfies Record<string, readonly [number, number]>;

/**
 * Custom pacing is a requested shape, and a requested shape that the search
 * cannot reach is a refusal - never a silently ignored field.
 */
function customPacingShape(analysis: ReturnType<typeof analyzeProfileExact>) {
  return {
    ZERO: analysis.zeroRate,
    PARTIAL_RETURN: analysis.partialRate,
    BREAK_EVEN: analysis.breakEvenRate,
    WIN: 1 - analysis.zeroRate - analysis.partialRate - analysis.breakEvenRate,
  };
}

function customPacingFailures(
  policy: MathPolicy,
  analysis: ReturnType<typeof analyzeProfileExact>,
): ConstraintReason[] {
  if (policy.pacing !== 'CUSTOM' || !policy.customPacing) return [];
  const weights = policy.customPacing;
  const total = weights.zeroWeight + weights.partialWeight + weights.breakEvenWeight + weights.winWeight;
  if (total <= 0) return [];
  const requested = {
    ZERO: weights.zeroWeight / total,
    PARTIAL_RETURN: weights.partialWeight / total,
    BREAK_EVEN: weights.breakEvenWeight / total,
    WIN: weights.winWeight / total,
  };
  const achieved = customPacingShape(analysis);
  const tolerance = 0.05;
  const failures: ConstraintReason[] = [];
  for (const key of Object.keys(requested) as Array<keyof typeof requested>) {
    if (Math.abs(achieved[key] - requested[key]) > tolerance) {
      failures.push({
        constraint: 'CUSTOM_PACING_UNSATISFIED',
        requested: `${key} share ${requested[key].toFixed(4)}`,
        achievable: `${achieved[key].toFixed(4)}`,
        detail:
          'The custom pacing weights were used as the search target, but the reachable board set cannot place ' +
          `that much probability in the ${key} class within ${tolerance} absolute.`,
      });
    }
  }
  return failures;
}

function shapeChecks(
  policy: MathPolicy,
  analysis: ReturnType<typeof analyzeProfileExact>,
  run: MonteCarloRun,
): MathCheck[] {
  const checks: MathCheck[] = [];
  const hit = analysis.hitRate;
  if (policy.hitRate.mode === 'EXPLICIT') {
    const ok = Math.abs(hit - policy.hitRate.target) <= 0.02;
    checks.push(check('HIT_RATE_TARGET', ok ? 'PASS' : 'FAIL', `measured ${hit.toFixed(4)} vs target ${policy.hitRate.target}`, { hit }));
  } else if (policy.hitRate.mode === 'RANGE') {
    const ok = hit >= policy.hitRate.min && hit <= policy.hitRate.max;
    checks.push(check('HIT_RATE_RANGE', ok ? 'PASS' : 'FAIL', `measured ${hit.toFixed(4)} in [${policy.hitRate.min}, ${policy.hitRate.max}]`, { hit }));
  } else {
    checks.push(check('HIT_RATE_AUTO', 'PASS', `observed hit rate ${hit.toFixed(4)} (AUTO, not constrained)`, { hit }));
  }

  const partialShare = analysis.partialRate;
  const [partialMin, partialMax] = PARTIAL_TIERS[policy.partialReturn];
  const partialOk = partialShare >= partialMin && partialShare <= partialMax;
  checks.push(check(
    'PARTIAL_RETURN_TIER',
    partialOk ? 'PASS' : 'FAIL',
    `partial-return share ${partialShare.toFixed(4)} requested ${policy.partialReturn} (${partialMin}..${partialMax})`,
    { partialShare, tier: policy.partialReturn },
  ));

  const [volMin, volMax] = VOLATILITY_TIERS[policy.volatility];
  const vol = analysis.baseVolatility;
  const volOk = vol >= volMin && vol <= volMax;
  checks.push(check(
    'VOLATILITY_TIER',
    volOk ? 'PASS' : 'FAIL',
    `return standard deviation ${vol.toFixed(4)} requested ${policy.volatility} (${volMin}..${volMax === Number.POSITIVE_INFINITY ? 'inf' : volMax})`,
    { volatility: vol, tier: policy.volatility },
  ));

  const zeroProfile = analysis.totalRtpPercent === 0;
  // The requested band must be *populated*, not merely approached: at least one
  // reachable board has to land inside [bigWinMin, bigWinMax].
  const bandWeight = analysis.baseDistribution
    .filter((entry) => entry.returnMultiplier >= policy.bigWinMinMultiplier
      && entry.returnMultiplier <= policy.bigWinMaxMultiplier)
    .reduce((sum, entry) => sum + entry.probability, 0);
  const bigReachable = zeroProfile || bandWeight > 0;
  checks.push(check(
    'BIG_WIN_BAND_REACHABLE',
    bigReachable ? 'PASS' : 'FAIL',
    zeroProfile
      ? 'a proved zero-return profile has no reachable paying outcome, so no win band applies'
      : `${(bandWeight * 100).toFixed(6)}% of paid boards land inside the requested ` +
        `[${policy.bigWinMinMultiplier}x, ${policy.bigWinMaxMultiplier}x] band; largest board ` +
        `${analysis.maxBoardMultiplier.toFixed(4)}x`,
    { bandProbability: bandWeight, maxBoard: analysis.maxBoardMultiplier },
  ));

  const featureShare = run.measuredRtpPercent === 0 ? 0 : (run.featureRtpPercent / run.measuredRtpPercent) * 100;
  const featureOk = featureShare >= policy.featureContribution.minPercent - 1e-9
    && featureShare <= policy.featureContribution.maxPercent + 1e-9;
  checks.push(check(
    'FEATURE_CONTRIBUTION',
    featureOk ? 'PASS' : 'FAIL',
    `feature contributed ${featureShare.toFixed(4)}% of observed return, requested ` +
      `${policy.featureContribution.minPercent}..${policy.featureContribution.maxPercent}%`,
    { featureShare },
  ));

  if (policy.pacing === 'CUSTOM' && policy.customPacing) {
    const weights = policy.customPacing;
    const total = weights.zeroWeight + weights.partialWeight + weights.breakEvenWeight + weights.winWeight;
    const achieved = customPacingShape(analysis);
    const requested = total <= 0 ? achieved : {
      ZERO: weights.zeroWeight / total,
      PARTIAL_RETURN: weights.partialWeight / total,
      BREAK_EVEN: weights.breakEvenWeight / total,
      WIN: weights.winWeight / total,
    };
    const worst = (Object.keys(requested) as Array<keyof typeof requested>)
      .reduce((max, key) => Math.max(max, Math.abs(achieved[key] - requested[key])), 0);
    checks.push(check(
      'CUSTOM_PACING_SHAPE',
      worst <= 0.05 ? 'PASS' : 'FAIL',
      `custom pacing requested ${JSON.stringify(requested)}; achieved ${JSON.stringify(achieved)}; ` +
        `worst absolute deviation ${worst.toFixed(4)} (tolerance 0.05)`,
      { requested, achieved, worstDeviation: worst },
    ));
  }

  if (run.abortedRounds > 0) {
    checks.push(check(
      'ENGINE_FEATURE_BOUND_NOT_HIT',
      'FAIL',
      `${run.abortedRounds} rounds were aborted by the engine's own feature-spin bound`,
      { abortedRounds: run.abortedRounds },
    ));
  }

  return checks;
}

function check(id: string, status: CheckStatus, detail: string, value?: unknown): MathCheck {
  return { id, status, detail, value };
}

// ---------------------------------------------------------------------------
// Monte Carlo
// ---------------------------------------------------------------------------

function runMonteCarlo(
  rules: RulesTable,
  engine: EngineModule,
  payload: LlProfilePayload,
  policy: MathPolicy,
  options: ValidationOptions,
): { run: MonteCarloRun } {
  const lines = rules.lines.length;
  const rng = createSimulationRng(`${options.validationSeedPrefix}:monte-carlo`);
  const rounds = options.monteCarloRounds;
  const returns: number[] = [];
  const classHistogram = emptyClassHistogram();
  let paidWagerUnits = 0;
  let returnedUnits = 0;
  let featureReturnUnits = 0;
  let featureRounds = 0;
  let retriggerRounds = 0;
  let maxObservedMultiplier = 0;
  let aborted = 0;

  for (let index = 0; index < rounds; index += 1) {
    paidWagerUnits += lines;
    let round;
    try {
      round = engine.playRound(rules, payload as never, { bet: 1, lines, rng: rng as never, capture: false });
    } catch {
      aborted += 1;
      continue;
    }
    returnedUnits += round.totalWin;
    featureReturnUnits += round.feature.win;
    if (round.feature.triggered) featureRounds += 1;
    if (round.feature.retriggers > 0) retriggerRounds += 1;
    const multiplier = round.totalWin / lines;
    returns.push(multiplier);
    classHistogram[payoutClass(multiplier, policy.bigWinMinMultiplier, policy.bigWinMaxMultiplier)] += 1;
    if (multiplier > maxObservedMultiplier) maxObservedMultiplier = multiplier;
  }

  const ci = confidenceInterval95(returns);
  const hitRate = returns.filter((value) => value > 0).length / Math.max(1, returns.length);
  const run: MonteCarloRun = {
    kind: 'MONTE_CARLO',
    seedPrefix: options.validationSeedPrefix,
    rounds,
    paidWagerUnits,
    returnedUnits,
    measuredRtpPercent: paidWagerUnits === 0 ? 0 : (returnedUnits / paidWagerUnits) * 100,
    ci95Bps: ci === null ? null : ci * 100 * 100,
    hitRate,
    zeroRate: returns.filter((value) => value === 0).length / Math.max(1, returns.length),
    lossRate: returns.filter((value) => value < 1).length / Math.max(1, returns.length),
    partialRate: returns.filter((value) => value > 0 && value < 1).length / Math.max(1, returns.length),
    breakEvenRate: returns.filter((value) => value === 1).length / Math.max(1, returns.length),
    breakEvenBandRate: returns.filter((value) => value >= 0.5 && value < 1).length / Math.max(1, returns.length),
    classHistogram,
    fineHistogram: fineHistogram(returns),
    maxObservedMultiplier,
    featureTriggerRate: featureRounds / Math.max(1, returns.length),
    featureRetriggerRate: retriggerRounds / Math.max(1, returns.length),
    featureRtpPercent: paidWagerUnits === 0 ? 0 : (featureReturnUnits / paidWagerUnits) * 100,
    volatilityStdDev: standardDeviation(returns),
    abortedRounds: aborted,
  };
  return { run };
}

// ---------------------------------------------------------------------------
// Structural envelope (what the game can express at all)
// ---------------------------------------------------------------------------

let structuralCache: ReturnType<typeof computeStructuralEnvelope> | null = null;

function structuralEnvelope(rules: RulesTable, engine: EngineModule) {
  structuralCache ??= computeStructuralEnvelope(rules, engine);
  return structuralCache;
}

function computeStructuralEnvelope(rules: RulesTable, engine: EngineModule) {
  const reels = stopWindows(rules);
  const samples = reels.map((reel) => {
    const stopCount = reel.strip.length - 2;
    const chosen = new Set<number>();
    const step = Math.max(1, Math.floor(stopCount / STRUCTURAL_STOPS_PER_REEL));
    for (let index = 0; index < STRUCTURAL_STOPS_PER_REEL; index += 1) chosen.add(Math.min(stopCount - 1, index * step));
    chosen.add(0);
    chosen.add(stopCount - 1);
    return [...chosen].sort((a, b) => a - b);
  });

  let minUnits = Number.POSITIVE_INFINITY;
  let maxUnits = 0;
  let maxScatterCount = 0;
  const multipliers = new Set<number>();
  let zeroBoard: number[] | null = null;
  const walk = (index: number, stops: number[]) => {
    if (index === samples.length) {
      const { evaluation, units } = boardWin(rules, engine, reels, stops);
      multipliers.add(units / rules.lines.length);
      if (units < minUnits) minUnits = units;
      if (units === 0 && zeroBoard === null) zeroBoard = [...stops];
      if (units > maxUnits) maxUnits = units;
      if (evaluation.scatterCount > maxScatterCount) maxScatterCount = evaluation.scatterCount;
      return;
    }
    for (const stop of samples[index]) walk(index + 1, [...stops, stop]);
  };
  walk(0, []);

  const classes: PayoutClass[] = [];
  for (const value of PAYOUT_CLASSES) {
    if ([...multipliers].some((multiplier) => payoutClass(multiplier, 10, 50) === value)) classes.push(value);
  }
  return {
    classes: classes.length > 0 ? classes : ['ZERO' as PayoutClass],
    minBoardMultiplier: minUnits / rules.lines.length,
    maxBoardMultiplier: maxUnits / rules.lines.length,
    maxScatterCount,
    zeroBoard,
  };
}

function describeStops(stops: readonly number[]): string {
  return `[${stops.join(', ')}]`;
}

export const LUCKY_LADY_BANKROLL_DENOMINATION = BANKROLL_DENOMINATION;
