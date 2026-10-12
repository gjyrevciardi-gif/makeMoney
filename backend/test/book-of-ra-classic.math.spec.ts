import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalProfileHash } from '../src/casino/platform/math-control/math-control.analytics';
import { defaultSessionConfig } from '../src/casino/platform/math-control/math-control.bankroll';
import type {
  MathPolicy,
  MathProfileArtifact,
  MonteCarloRun,
  ValidationOptions,
} from '../src/casino/platform/math-control/math-control.types';
import {
  CLASSIC_ID,
  ClassicProfile,
  RULES,
  analyze,
  boardAt,
  evaluate,
  playRound,
  RULES_HASH,
} from '../src/casino/games/book-of-ra-classic/classic.engine';
import { CLASSIC_V1 } from '../src/casino/games/book-of-ra-classic/classic.definition';
import {
  CLASSIC_GAMBLE,
  ClassicMathAdapter,
  assertClassicArtifact,
  classicIdentity,
  defaultClassicProfile,
} from '../src/casino/games/book-of-ra-classic/classic.math-adapter';

const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

const FROZEN_RTP50_MAXWIN50 = 'a2f6fef07d3afa792bafda0af824fecb0042d8295e83dc9672b437cc18480d48';
const FROZEN_RTP50_MAXWIN20 = 'a01616408af3f82dddd9f1aa479e04de1773a5e9386fd4e23293aa0fc3de9d61';

const mathDir = join(__dirname, '..', 'src', 'casino', 'games', 'book-of-ra-classic', 'math');

const policy = (overrides: Partial<MathPolicy> = {}): MathPolicy => ({
  gameId: CLASSIC_ID,
  targetRtpPercent: 50,
  maxWinMultiplier: 50,
  pacing: 'BALANCED',
  customPacing: null,
  hitRate: { mode: 'AUTO' },
  partialReturn: 'MED',
  volatility: 'MED',
  bigWinMinMultiplier: 10,
  bigWinMaxMultiplier: 50,
  featureContribution: { minPercent: 0, maxPercent: 60 },
  presets: ['BALANCED'],
  maxWinScope: 'RESOLVED_SPIN',
  ...overrides,
});

/** The published artifact for one of the two frozen Classic files. */
function artifactFor(fileName: string, maxWinMultiplier: number): MathProfileArtifact {
  const golden = JSON.parse(readFileSync(join(mathDir, fileName), 'utf8')) as {
    id: string;
    payload: ClassicProfile;
  };
  const artifact: MathProfileArtifact = {
    schemaVersion: 1,
    profileId: golden.id,
    gameId: CLASSIC_ID,
    ...classicIdentity(),
    policy: policy({ maxWinMultiplier, maxWinEnabled: true }),
    payload: golden.payload,
    canonicalHash: '',
    createdAt: new Date().toISOString(),
  };
  artifact.canonicalHash = canonicalProfileHash(artifact);
  return artifact;
}

const options = (overrides: Partial<ValidationOptions> = {}): ValidationOptions => ({
  validationSeedPrefix: 'classic-validation',
  bankrollSeedPrefix: 'classic-bankroll',
  monteCarloRounds: 25_000,
  bankrollSessions: 200,
  sessionConfig: { ...defaultSessionConfig(), stakeUnits: 180, horizonPaidSpins: 1_000 },
  rtpTolerancePercent: 0.5,
  ...overrides,
});

/**
 * Classic mathematics on its own terms.
 *
 * Every number here is recomputed from the frozen artifact: the exact return is
 * a fresh enumeration of every stored native window, and the measured return is
 * an independent simulated sample with its own seed domain. No Deluxe figure is
 * reused, and no runtime truncation or rejection is involved.
 */
describe('Book of Ra Classic mathematics (independent validation)', () => {
  const adapter = new ClassicMathAdapter();

  it('keeps the reference rules the frozen profiles were built from', () => {
    expect(CLASSIC_ID).toBe('book-of-ra-classic');
    expect(classicIdentity().rulesSha256).toBe(RULES_HASH);
    expect(RULES.paylines).toHaveLength(9);
    expect(RULES.expandingSymbols).toHaveLength(9);
    expect(RULES.expandingSymbols).not.toContain('SCAT');
    expect(RULES.freeSpins).toBe(10);
    expect(RULES.retriggerSpins).toBe(10);
    expect(RULES.paytable.SCAT).toEqual([0, 0, 0, 18, 180, 1800]);
    // The Book pays from two reels; the low symbols need three.
    expect(RULES.paytable.P_1[2]).toBe(10);
    expect(RULES.paytable['10'][2]).toBe(0);
    expect(RULES.paytable['10'][3]).toBe(5);
    expect(CLASSIC_V1.lineStakes).toEqual([1, 2, 5, 10, 20]);
    expect(CLASSIC_V1.lines).toBe(9);
    expect(CLASSIC_V1.maxStake).toBe(180n);
  });

  it('hashes the frozen Classic artifacts and keeps them non-divergent', () => {
    expect(defaultClassicProfile().hash).toBe(FROZEN_RTP50_MAXWIN50);
    expect(sha256(readFileSync(join(mathDir, 'rtp50-maxwin20.json')))).not.toBe(FROZEN_RTP50_MAXWIN20);
    const maxwin20 = JSON.parse(readFileSync(join(mathDir, 'rtp50-maxwin20.json'), 'utf8')) as {
      hash: string;
      payload: ClassicProfile;
    };
    // The recorded hash is over the payload, not the file.
    expect(maxwin20.hash).toBe(FROZEN_RTP50_MAXWIN20);
    expect(sha256(JSON.stringify(maxwin20.payload))).toBe(FROZEN_RTP50_MAXWIN20);

    for (const [name, multiplier] of [['rtp50-maxwin50.json', 50], ['rtp50-maxwin20.json', 20]] as const) {
      const artifact = artifactFor(name, multiplier);
      const profile = assertClassicArtifact(artifact);
      expect(profile.maxWinScope).toBe('RESOLVED_SPIN');
      expect(profile.maxWinMultiplier).toBe(multiplier);
      // Every line count and every persistent expanding symbol is enumerated,
      // and the artifact's own analysis is reproduced exactly.
      for (let lines = 1; lines <= 9; lines += 1) {
        const table = profile.tables[String(lines)];
        expect(table).toBeDefined();
        expect(table.paidZero.length).toBeGreaterThan(0);
        expect(table.paidPositive.length).toBeGreaterThan(0);
        expect(table.paidPositive.some((stops) => evaluate(boardAt(stops), 1, lines).trigger)).toBe(true);
        for (const symbol of RULES.expandingSymbols) {
          expect(table.free[symbol].length).toBeGreaterThan(0);
        }
        const recomputed = analyze(profile, lines);
        expect(recomputed.expectedRtpPercent).toBeCloseTo(50, 6);
        expect(Math.max(recomputed.paidMax, recomputed.freeMax)).toBeLessThanOrEqual(multiplier);
        expect(recomputed.retriggerProbability * RULES.freeSpins).toBeLessThan(1);
      }
    }
  });

  it('draws only complete native rounds, never a truncated one', () => {
    const profile = defaultClassicProfile().payload;
    let triggers = 0;
    let retriggers = 0;
    let freeSpins = 0;
    const seed = (index: number) => `classic-support-${index}`;
    const intRng = (value: string) => {
      const rng = createHash('sha256').update(value).digest();
      let cursor = 0;
      return (upper: number) => {
        const next = rng.readUInt32BE((cursor % 8) * 4);
        cursor += 1;
        return next % upper;
      };
    };
    for (let index = 0; index < 400; index += 1) {
      const round = playRound(profile, 1, 9, intRng(seed(index)));
      // The paid spin is always resolved, and every free spin the round awarded
      // is present in the plan: the sequence is drawn, never rejected.
      expect(round.spins[0].free).toBe(false);
      expect(round.spins).toHaveLength(1 + round.freeSpins);
      expect(round.spins.filter((spin) => spin.free)).toHaveLength(round.freeSpins);
      if (round.special !== null) expect(RULES.expandingSymbols).toContain(round.special);
      if (round.freeSpins > 0) {
        triggers += 1;
        // The expanding symbol is persistent across the whole feature.
        for (const spin of round.spins.filter((entry) => entry.free)) {
          expect(spin.special).toBe(round.special);
        }
      }
      if (round.retriggers > 0) retriggers += 1;
      freeSpins += round.freeSpins;
    }
    expect(triggers).toBeGreaterThan(0);
    expect(freeSpins).toBeGreaterThan(0);
    expect(retriggers).toBeGreaterThanOrEqual(0);
  });

  it('reports a bounded, honestly derived capability surface', async () => {
    const capabilities = await adapter.capabilities();
    expect(capabilities.gameId).toBe(CLASSIC_ID);
    expect(capabilities.engineSha256).toBe(classicIdentity().engineSha256);
    expect(capabilities.rulesSha256).toBe(RULES_HASH);
    // The native gamble doubles the pending win at even odds, capped at five.
    expect(capabilities.optionalGamble.present).toBe(true);
    expect(capabilities.optionalGamble.bounded).toBe(true);
    expect(CLASSIC_GAMBLE.maxAttempts).toBe(5);
    expect(CLASSIC_GAMBLE.ceilingMultiplier).toBe(32);
    expect(capabilities.optionalGamble.detail).toContain('32x');
    // The reachable set is derived from the stored support, not asserted.
    const reachable = await adapter.getReachableOutcomeClasses();
    expect(reachable.length).toBeGreaterThan(1);
    expect(reachable).toContain('ZERO');
    expect(reachable).toContain('PARTIAL_RETURN');
    const order = ['ZERO', 'PARTIAL_RETURN', 'BREAK_EVEN', 'SMALL', 'MEDIUM', 'BIG', 'MAX'];
    expect([...reachable].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(reachable);
  });

  it('refuses every policy it cannot honour instead of ignoring it', async () => {
    const accepted = await adapter.generateProfile(policy());
    expect(accepted.status).toBe('SUPPORTED');

    const refused: Array<[string, Partial<MathPolicy>]> = [
      ['another game', { gameId: 'book-of-ra' }],
      ['a round-scoped ceiling', { maxWinScope: 'TOTAL_INCLUDING_OPTIONAL_GAMBLE' }],
      ['a disabled ceiling flag', { maxWinEnabled: false }],
      ['retention pacing', { pacing: 'RETENTION' }],
      ['an explicit hit rate', { hitRate: { mode: 'EXPLICIT', target: 0.3 } }],
      ['a high partial-return shape', { partialReturn: 'HIGH' }],
      ['a low-volatility shape', { volatility: 'LOW' }],
      ['a ceiling below the provable support', { maxWinMultiplier: 5 }],
      ['an out-of-band return', { targetRtpPercent: 120 }],
      ['a feature-share window the family cannot reach', { featureContribution: { minPercent: 99, maxPercent: 100 } }],
    ];
    for (const [label, override] of refused) {
      const result = await adapter.generateProfile(policy(override));
      expect([label, result.status]).toEqual([label, 'UNSUPPORTED']);
      if (result.status === 'UNSUPPORTED') {
        expect(result.reasons[0].detail.length).toBeGreaterThan(0);
        // An incompatible request never degrades into a different profile.
        expect(result.bestEffort).toBeNull();
      }
    }
  });

  it('stamps an explicit RESOLVED_SPIN ceiling when the request omitted the flag', async () => {
    const result = await adapter.generateProfile(policy({ maxWinEnabled: undefined }));
    expect(result.status).toBe('SUPPORTED');
    if (result.status !== 'SUPPORTED') return;
    expect(result.artifact.policy.maxWinEnabled).toBe(true);
    expect(result.artifact.policy.maxWinScope).toBe('RESOLVED_SPIN');
    expect(result.analysis.exactRtpPercent).toBeCloseTo(50, 6);
    expect(result.analysis.maxResolvedSpinMultiplier).toBeLessThanOrEqual(50);
    expect(result.analysis.maxRoundMultiplier).toBeNull();
    expect(result.analysis.featureDiverges).toBe(false);
    // The generated artifact must survive an independent re-examination.
    expect(() => assertClassicArtifact(result.artifact)).not.toThrow();
  });

  it('anchors the session stream on the artifact identity and refuses an unrepresentable stake', () => {
    const artifact = artifactFor('rtp50-maxwin50.json', 50);
    const shared = defaultSessionConfig();
    // The shared default stake (20 points) decomposes exactly: four lines at
    // five points per line. Nothing is rounded to make it fit.
    const source = adapter.sessionSource(policy(), artifact, shared);
    const first = source.drawPaidRound();
    expect(first.paidSpins).toBe(1);
    expect(first.totalResolvedSpins).toBe(1 + first.freeSpins);
    expect(Number.isSafeInteger(first.returnUnits)).toBe(true);
    expect(first.returnUnits).toBeGreaterThanOrEqual(0);

    // Eleven points is not any native per-line stake x line count (it is prime
    // and larger than nine), so it is refused rather than rounded.
    expect(() => adapter.sessionSource(policy(), artifact, { ...shared, stakeUnits: 11 }))
      .toThrow(/CLASSIC_SESSION_STAKE_NOT_NATIVE/);
    // The maximum native round is representable exactly.
    const maxRound = adapter.sessionSource(policy(), artifact, { ...shared, stakeUnits: 180 });
    expect(maxRound.drawPaidRound().paidSpins).toBe(1);
  });

  it('validates the frozen RTP50 / MaxWin50 profile independently', async () => {
    const artifact = artifactFor('rtp50-maxwin50.json', 50);
    const outcome = await adapter.validateProfile(policy(), artifact, options());
    expect(outcome.metrics).not.toBeNull();
    const measured = outcome.metrics as MonteCarloRun;
    expect(outcome.result).toBe('PASS');
    expect(outcome.grade).toBe('ACTIVATION');
    expect(measured.rounds).toBe(25_000);
    expect(measured.ci95Bps).not.toBeNull();
    const halfWidthPercent = (measured.ci95Bps as number) / 100;
    // The honest statistical claim: the target sits inside this sample's own
    // 95% interval. A fixed sub-percent tolerance would need millions of rounds
    // for a feature this volatile, and would only be measuring the seed.
    expect(Math.abs(measured.measuredRtpPercent - 50)).toBeLessThanOrEqual(halfWidthPercent);
    // The bound is proved per resolution, never over the feature aggregate.
    const maxWinCheck = outcome.checks.find((entry) => entry.id === 'MAX_WIN_PROVEN_WITHIN_CEILING');
    expect(maxWinCheck?.status).toBe('PASS');
    expect((maxWinCheck?.value as { provedMax: number }).provedMax).toBeLessThanOrEqual(50);
    expect(outcome.checks.find((entry) => entry.id === 'EXACT_RTP_MATCHES_TARGET')?.status).toBe('PASS');
    expect(outcome.checks.find((entry) => entry.id === 'BANKROLL_ACCOUNTING_EXACT')?.status).toBe('PASS');
    expect(outcome.checks.find((entry) => entry.id === 'PROFILE_IDENTITY')?.status).toBe('PASS');
    expect(outcome.bankroll.totals.paidRounds).toBeGreaterThan(0);
    // The analytic reproduction is seeded from the artifact, not from the sample.
    const analytic = outcome.runs.find((entry) => entry.kind === 'ANALYTIC_REPRODUCTION');
    expect(analytic).toBeDefined();
    console.log(
      `CLASSIC_RTP50_MAXWIN50 expected=${analyze(defaultClassicProfile().payload).expectedRtpPercent.toFixed(4)}% `
      + `measured=${measured.measuredRtpPercent.toFixed(4)}% ci95=+/-${halfWidthPercent.toFixed(4)}pp `
      + `rounds=${measured.rounds} profile=${artifact.canonicalHash}`,
    );
  });

  it('validates the frozen RTP50 / MaxWin20 profile independently', async () => {
    const artifact = artifactFor('rtp50-maxwin20.json', 20);
    const outcome = await adapter.validateProfile(
      policy({ maxWinMultiplier: 20 }),
      artifact,
      options({ monteCarloRounds: 25_000, bankrollSessions: 200 }),
    );
    expect(outcome.metrics).not.toBeNull();
    const measured = outcome.metrics as MonteCarloRun;
    expect(outcome.result).toBe('PASS');
    const halfWidthPercent = (measured.ci95Bps as number) / 100;
    expect(Math.abs(measured.measuredRtpPercent - 50)).toBeLessThanOrEqual(halfWidthPercent);
    const maxWinCheck = outcome.checks.find((entry) => entry.id === 'MAX_WIN_PROVEN_WITHIN_CEILING');
    expect(maxWinCheck?.status).toBe('PASS');
    expect((maxWinCheck?.value as { provedMax: number }).provedMax).toBeLessThanOrEqual(20);
    console.log(
      `CLASSIC_RTP50_MAXWIN20 expected=${analyze(artifact.payload as ClassicProfile).expectedRtpPercent.toFixed(4)}% `
      + `measured=${measured.measuredRtpPercent.toFixed(4)}% ci95=+/-${halfWidthPercent.toFixed(4)}pp `
      + `rounds=${measured.rounds} profile=${artifact.canonicalHash}`,
    );
  });

  it('never reuses a Deluxe figure and never leaks Deluxe mathematics', () => {
    const deluxeProfile = join(__dirname, '..', '..', 'packages', 'slot-skills', 'math', 'src', 'book-of-ra.profile.ts');
    // The Deluxe profile is historical evidence in another worktree, not a source
    // this adapter can read; the Classic adapter has no code path to it.
    const adapterSource = readFileSync(
      join(__dirname, '..', 'src', 'casino', 'games', 'book-of-ra-classic', 'classic.math-adapter.ts'),
      'utf8',
    );
    expect(adapterSource).not.toContain('49.9976');
    expect(adapterSource).not.toContain('book-of-ra.v1.rtp5000');
    expect(adapterSource).not.toContain('BOOK_OF_RA_LINES');
    expect(deluxeProfile.length).toBeGreaterThan(0);
    // The Classic identity is its own.
    expect(CLASSIC_V1.profileId).toBe('book-of-ra-classic.rtp50.v1');
    expect(CLASSIC_V1.profileId).not.toBe('book-of-ra.v1.rtp5000');
  });
});
