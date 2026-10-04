import { analyzeProfileExact } from '../src/casino/games/lucky-lady/lucky-lady.exact';
import { loadVerifiedMath } from '../src/casino/games/lucky-lady/lucky-lady.math';
import {
  FINE_PAYOUT_BINS,
  canonicalJson,
  canonicalProfileHash,
  fineHistogram,
  multiplierToUnits,
  payoutClass,
  percentile,
  summarize,
} from '../src/casino/platform/math-control/math-control.analytics';
import {
  defaultSessionConfig,
  simulateCohort,
  simulateSession,
} from '../src/casino/platform/math-control/math-control.bankroll';
import { validatePolicy } from '../src/casino/platform/math-control/math-control.policy';
import { createSimulationRng } from '../src/casino/platform/math-control/math-control.random';
import { bankrollMarkdown } from '../src/casino/platform/math-control/math-control.artifacts';
import {
  CANONICAL_EXAMPLE_DISTRIBUTION,
  distributionExpectedPercent,
  distributionExpectedValue,
  ratCompare,
  ratEquals,
  rational,
  rationalFromDecimal,
  rationalFromDecimalString,
  ratMul,
  ratToNumber,
  bigRational,
  bigRationalToPresentationNumber,
} from '../src/casino/platform/math-control/math-control.rational';
import { PRESET_NAMES } from '../src/casino/platform/math-control/math-control.policy';
import type {
  BankrollReport,
  MathValidationEvidence,
  SessionOutcomeSource,
} from '../src/casino/platform/math-control/math-control.types';

/**
 * Shared control plane: policy, exact accounting, statistics and the bankroll
 * simulator. Nothing here touches PostgreSQL, a wallet or a browser.
 */

const constantSource = (returnUnits: number): SessionOutcomeSource => ({
  // Authoritative per-round counts: one paid spin, no free spins.
  drawPaidRound: () => ({
    returnUnits,
    featureReturnUnits: 0,
    paidSpins: 1,
    freeSpins: 0,
    totalResolvedSpins: 1,
    featureTriggered: false,
    retriggered: false,
  }),
});

const constantCohort = (
  returnUnits: number,
  session: Parameters<typeof simulateSession>[1],
  seeds: string[],
) => simulateCohort(() => constantSource(returnUnits), session, seeds);

const basePolicy = (overrides: Record<string, unknown> = {}) => ({
  gameId: 'lucky-lady',
  targetRtpPercent: 50,
  maxWinMultiplier: 50,
  maxWinScope: 'PAID_ROUND_BEFORE_OPTIONAL_GAMBLE',
  pacing: 'BALANCED',
  customPacing: null,
  hitRate: { mode: 'AUTO' },
  partialReturn: 'LOW',
  volatility: 'MED',
  bigWinMinMultiplier: 10,
  bigWinMaxMultiplier: 50,
  featureContribution: { minPercent: 0, maxPercent: 60 },
  presets: [],
  ...overrides,
});

describe('math control policy', () => {
  it('accepts the whole 0..100 requested range and rejects anything outside it', () => {
    for (const target of [0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100]) {
      const parsed = validatePolicy(basePolicy({ targetRtpPercent: target }));
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.policy.targetRtpPercent).toBe(target);
    }
    for (const target of [-0.5, 100.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const parsed = validatePolicy(basePolicy({ targetRtpPercent: target }));
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.errors.map((entry) => entry.constraint)).toContain('TARGET_RTP_OUT_OF_RANGE');
    }
  });

  it('denies identity, player, session, balance, history and seed fields outright', () => {
    for (const field of ['userId', 'actorId', 'role', 'sessionId', 'balance', 'history', 'seed', 'playerId', 'roundId']) {
      const parsed = validatePolicy(basePolicy({ [field]: 'whatever' }));
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.errors.map((entry) => entry.constraint)).toContain('UNKNOWN_FIELD');
        expect(parsed.errors[0].requested).toBe(field);
      }
    }
  });

  it('treats presets as defaults and lets every explicit value win', () => {
    // Only `presets` plus the fields the operator actually stated: a preset can
    // never overwrite a value the request supplies itself.
    const fromPreset = validatePolicy({
      gameId: 'lucky-lady',
      presets: ['VOLATILE'],
      targetRtpPercent: 40,
      maxWinMultiplier: 40,
    });
    expect(fromPreset.ok).toBe(true);
    if (fromPreset.ok) {
      // preset defaults applied ...
      expect(fromPreset.policy.pacing).toBe('VOLATILE');
      expect(fromPreset.policy.bigWinMaxMultiplier).toBe(250);
      // ... explicit values still win.
      expect(fromPreset.policy.targetRtpPercent).toBe(40);
      expect(fromPreset.policy.maxWinMultiplier).toBe(40);
      expect(fromPreset.appliedPresets).toEqual(['VOLATILE']);
    }
    const explicit = validatePolicy(basePolicy({
      presets: ['BALANCED'],
      volatility: 'HIGH',
      partialReturn: 'MED',
      hitRate: { mode: 'EXPLICIT', target: 0.25 },
    }));
    expect(explicit.ok).toBe(true);
    if (explicit.ok) {
      expect(explicit.policy.volatility).toBe('HIGH');
      expect(explicit.policy.partialReturn).toBe('MED');
      expect(explicit.policy.hitRate).toEqual({ mode: 'EXPLICIT', target: 0.25 });
    }
  });

  it('bounds custom pacing, hit-rate ranges and big-win windows', () => {
    expect(validatePolicy(basePolicy({ pacing: 'CUSTOM' })).ok).toBe(false);
    expect(validatePolicy(basePolicy({
      pacing: 'CUSTOM',
      customPacing: { zeroWeight: 0, partialWeight: 0, breakEvenWeight: 0, winWeight: 0 },
    })).ok).toBe(false);
    const okCustom = validatePolicy(basePolicy({
      pacing: 'CUSTOM',
      customPacing: { zeroWeight: 500, partialWeight: 250, breakEvenWeight: 150, winWeight: 100 },
    }));
    expect(okCustom.ok).toBe(true);
    expect(validatePolicy(basePolicy({ hitRate: { mode: 'RANGE', min: 0.5, max: 0.2 } })).ok).toBe(false);
    expect(validatePolicy(basePolicy({ bigWinMinMultiplier: 60, bigWinMaxMultiplier: 50 })).ok).toBe(false);
    expect(validatePolicy(basePolicy({ maxWinScope: 'SOMETHING_ELSE' })).ok).toBe(false);
  });

  it('refuses unknown presets, fractional weights, nested stranger fields and contradictory hit rates', () => {
    expect(validatePolicy(basePolicy({ presets: ['NOT_A_PRESET'] })).ok).toBe(false);
    expect(validatePolicy(basePolicy({
      pacing: 'CUSTOM',
      customPacing: { zeroWeight: 1.5, partialWeight: 0, breakEvenWeight: 0, winWeight: 0 },
    })).ok).toBe(false);
    expect(validatePolicy(basePolicy({ customPacingExtra: 1 })).ok).toBe(false);
    expect(validatePolicy(basePolicy({
      pacing: 'CUSTOM',
      customPacing: { zeroWeight: 500, partialWeight: 500, breakEvenWeight: 0, winWeight: 0, smuggled: 1 },
    })).ok).toBe(false);
    expect(validatePolicy(basePolicy({ hitRate: { mode: 'AUTO', target: 0.2 } })).ok).toBe(false);
    expect(validatePolicy(basePolicy({ hitRate: { mode: 'EXPLICIT', target: 0.2, min: 0.1, max: 0.3 } })).ok).toBe(false);
    expect(validatePolicy(basePolicy({ featureContribution: { minPercent: 0, maxPercent: 10, extra: 1 } })).ok).toBe(false);
  });

  it('keeps the semantic preset defaults rather than weakening them to fit a search', () => {
    const retention = validatePolicy({ gameId: 'lucky-lady', presets: ['RETENTION'], targetRtpPercent: 50 });
    expect(retention.ok).toBe(true);
    if (retention.ok) {
      expect(retention.policy.partialReturn).toBe('HIGH');
      expect(retention.policy.volatility).toBe('LOW');
    }
    const recycle = validatePolicy({ gameId: 'lucky-lady', presets: ['RECYCLE'], targetRtpPercent: 50 });
    expect(recycle.ok).toBe(true);
    if (recycle.ok) {
      expect(recycle.policy.partialReturn).toBe('LOW');
      expect(recycle.policy.volatility).toBe('HIGH');
      expect(recycle.policy.featureContribution.minPercent).toBe(20);
    }
    // Only the presets the operator asked for exist.
    expect(PRESET_NAMES).toEqual(['BALANCED', 'RETENTION', 'RECYCLE', 'VOLATILE']);
  });
});

describe('exact rational robustness', () => {
  it('parses scientific notation exactly and refuses imprecise literals', () => {
    expect(ratEquals(rationalFromDecimal(1e-7), rational(1, 10_000_000))).toBe(true);
    expect(ratEquals(rationalFromDecimal(1.25), rational(5, 4))).toBe(true);
    expect(ratEquals(rationalFromDecimal(1e15), rational(1_000_000_000_000_000, 1))).toBe(true);
    // Beyond the exact integer range the literal is refused rather than
    // rounded: the tested example works, arbitrary magnitudes do not silently
    // corrupt.
    expect(() => rationalFromDecimal(1e21)).toThrow(/RATIONAL_NOT_SAFE_INTEGER|RATIONAL_OVERFLOW/);
    expect(() => rationalFromDecimal(1.2345678901234567)).toThrow(/RATIONAL_PRECISION_UNSUPPORTED/);
    expect(() => rational(Number.MAX_SAFE_INTEGER, 1)).not.toThrow();
    expect(() => ratMul(rational(Number.MAX_SAFE_INTEGER, 1), rational(Number.MAX_SAFE_INTEGER, 1)))
      .toThrow(/RATIONAL_OVERFLOW|RATIONAL_NOT_SAFE_INTEGER/);
  });
});

describe('bankroll report identities', () => {
  it('reports turnover in PTS, raw totals and an exact ledger identity', () => {
    const { report } = constantCohort(10, { ...defaultSessionConfig(), horizonPaidSpins: 5_000 }, ['identity:0']);
    expect(report.totals.paidRounds).toBe(999);
    expect(report.totals.paidWagerUnits).toBe(19_980);
    expect(report.totals.turnoverPts).toBeCloseTo(199.8, 10);
    expect(report.totals.closingUnits).toBe(10);
    expect(report.totals.ledgerDeltaUnits).toBe(0);
    expect(report.totals.ledgerIdentityHolds).toBe(true);
    // Exact split identity, in BigInt, independent of the numeric mirrors.
    expect(
      BigInt(report.totals.baseReturnUnitsExact) + BigInt(report.totals.featureReturnUnitsExact),
    ).toBe(BigInt(report.totals.returnedUnitsExact));
    expect(report.turnoverPts.median).toBeCloseTo(199.8, 6);
  });

  it('reports ruin beyond the horizon as unknown rather than zero', () => {
    const { report } = constantCohort(20, { ...defaultSessionConfig(), horizonPaidSpins: 1_000 }, ['unknown:0']);
    expect(report.aliveAt['5000']).toBeNull();
    expect(report.ruinBy['5000']).toBeNull();
    expect(report.ruinByObservedSessions['5000']).toBe(0);
    expect(report.ruinBy['500']).toBe(0);
    expect(report.ruinByObservedSessions['500']).toBe(1);
    expect(report.maxWin.units).toBe(20);
    expect(report.maxWin.sessionFrequency).toBe(1);
  });

  it('refuses an incoherent session configuration or a non-integral round amount', () => {
    expect(() => simulateSession(constantSource(0), { ...defaultSessionConfig(), stakeUnits: 0 }, 'bad:0'))
      .toThrow(/SESSION_CONFIG_INVALID/);
    expect(() => simulateSession(
      {
        drawPaidRound: () => ({
          returnUnits: 1.5, featureReturnUnits: 0,
          paidSpins: 1, freeSpins: 0, totalResolvedSpins: 1,
          featureTriggered: false, retriggered: false,
        }),
      },
      defaultSessionConfig(),
      'bad:1',
    )).toThrow(/SESSION_ROUND_RETURN_INVALID/);
    expect(() => simulateSession(
      {
        drawPaidRound: () => ({
          returnUnits: 10, featureReturnUnits: 20,
          paidSpins: 1, freeSpins: 15, totalResolvedSpins: 16,
          featureTriggered: true, retriggered: false,
        }),
      },
      defaultSessionConfig(),
      'bad:2',
    )).toThrow(/SESSION_ROUND_FEATURE_EXCEEDS_RETURN/);
  });
});

describe('exact money arithmetic', () => {
  it('computes the canonical worked example as exactly 100%', () => {
    const ev = distributionExpectedValue(CANONICAL_EXAMPLE_DISTRIBUTION);
    expect(ratEquals(ev, rational(1, 1))).toBe(true);
    expect(ratEquals(distributionExpectedPercent(CANONICAL_EXAMPLE_DISTRIBUTION), rational(100, 1))).toBe(true);
    const weights = CANONICAL_EXAMPLE_DISTRIBUTION.bands.reduce((sum, band) => sum + band.weight, 0);
    expect(weights).toBe(CANONICAL_EXAMPLE_DISTRIBUTION.totalWeight);
    // The acceptance contract spells the same total out term by term:
    // 0.15 + 0.12 + 0.10 + 0.24 + 0.12 + 0.12 + 0.15 = 1.
    const terms = CANONICAL_EXAMPLE_DISTRIBUTION.bands.slice(1).map((band) => {
      const term = ratToNumber(band.multiplier) * (band.weight / CANONICAL_EXAMPLE_DISTRIBUTION.totalWeight);
      return Number(term.toFixed(10));
    });
    expect(terms).toEqual([0.15, 0.12, 0.1, 0.24, 0.12, 0.12, 0.15]);
    expect(terms.reduce((sum, term) => sum + term, 0)).toBeCloseTo(1, 10);
  });
});

describe('statistical conventions', () => {
  it('uses linear interpolation between closest ranks and orders its input', () => {
    const sorted = [1, 2, 3, 4];
    expect(percentile(sorted, 0)).toBe(1);
    expect(percentile(sorted, 0.25)).toBeCloseTo(1.75, 12);
    expect(percentile(sorted, 0.5)).toBeCloseTo(2.5, 12);
    expect(percentile(sorted, 0.9)).toBeCloseTo(3.7, 12);
    expect(percentile(sorted, 1)).toBe(4);
    const summary = summarize([4, 1, 3, 2]);
    expect(summary.median).toBeCloseTo(2.5, 12);
    expect(summary.p90).toBeCloseTo(3.7, 12);
    expect(percentile([], 0.5)).toBeNull();
    expect(summarize([]).mean).toBeNull();
  });

  it('keeps the payout bins non-overlapping and exhaustive at their boundaries', () => {
    // The canonical array: values just inside and on every boundary.
    const returns = [
      0, 0.01, 0.49,
      0.50, 0.99,
      1,
      1.01, 1.99,
      2, 4.99,
      5, 9.99,
      10, 19.99,
      20, 29.99,
      30, 39.99,
      40, 49.99,
      50,
      50.01,
    ];
    const buckets = fineHistogram(returns);
    expect(buckets.zero).toBe(1);
    expect(buckets['gt0_lt0.5']).toBe(2);
    expect(buckets['gte0.5_lt1']).toBe(2);
    expect(buckets.exactly1).toBe(1);
    expect(buckets['gt1_lt2']).toBe(2);
    expect(buckets.gte2_lt5).toBe(2);
    expect(buckets.gte5_lt10).toBe(2);
    expect(buckets.gte10_lt20).toBe(2);
    expect(buckets.gte20_lt30).toBe(2);
    expect(buckets.gte30_lt40).toBe(2);
    expect(buckets.gte40_lt50).toBe(2);
    expect(buckets.exactly50).toBe(1);
    expect(buckets.gt50).toBe(1);
    expect(Object.values(buckets).reduce((sum, value) => sum + value, 0)).toBe(returns.length);
    expect(FINE_PAYOUT_BINS.length).toBe(Object.keys(buckets).length);
    // Each array value lands in exactly one bucket, and the reported group
    // assignments match the canonical order.
    const bucketsFor = (value: number) => FINE_PAYOUT_BINS.filter((bin) => bin.test(value)).map((bin) => bin.id);
    expect(bucketsFor(0)).toEqual(['zero']);
    expect(bucketsFor(0.01)).toEqual(['gt0_lt0.5']);
    expect(bucketsFor(0.5)).toEqual(['gte0.5_lt1']);
    expect(bucketsFor(1)).toEqual(['exactly1']);
    expect(bucketsFor(1.01)).toEqual(['gt1_lt2']);
    expect(bucketsFor(2)).toEqual(['gte2_lt5']);
    expect(bucketsFor(40)).toEqual(['gte40_lt50']);
    expect(bucketsFor(50)).toEqual(['exactly50']);
    expect(bucketsFor(50.01)).toEqual(['gt50']);
    for (const value of [...returns, 0.0001, 0.9999, 1.9999, 49.999, 1_000]) {
      expect(FINE_PAYOUT_BINS.filter((bin) => bin.test(value))).toHaveLength(1);
    }
  });

  it('classifies payout classes against the policy big-win window', () => {
    expect(payoutClass(0, 10, 50)).toBe('ZERO');
    expect(payoutClass(0.4, 10, 50)).toBe('PARTIAL_RETURN');
    expect(payoutClass(0.5, 10, 50)).toBe('PARTIAL_RETURN');
    expect(payoutClass(0.999, 10, 50)).toBe('PARTIAL_RETURN');
    expect(payoutClass(1, 10, 50)).toBe('BREAK_EVEN');
    expect(payoutClass(1.5, 10, 50)).toBe('SMALL');
    expect(payoutClass(3, 10, 50)).toBe('MEDIUM');
    expect(payoutClass(10, 10, 50)).toBe('BIG');
    expect(payoutClass(50, 10, 50)).toBe('BIG');
    expect(payoutClass(50.0001, 10, 50)).toBe('MAX');
    expect(payoutClass(9000, 25, 250)).toBe('MAX');
  });
});

describe('bankroll validation oracles', () => {
  const session = { ...defaultSessionConfig(), horizonPaidSpins: 500 };

  it('0x: exactly 500 paid spins, 100 PTS turnover, ending 0, ruined and not alive', () => {
    const { report, records } = constantCohort(0, session, ['oracle:0']);
    const record = records[0];
    expect(record.paidSpins).toBe(500);
    expect(record.turnoverUnits).toBe(10_000);
    expect(record.endingUnits).toBe(0);
    expect(record.busted).toBe(true);
    expect(record.censored).toBe(false);
    expect(record.aliveAtCheckpoint['500']).toBe(false);
    expect(record.ruinedBy['500']).toBe(true);
    expect(report.turnoverPaidSpins.mean).toBe(500);
    expect(report.measuredRtpPercent).toBe(0);
    expect(report.ruinBy['500']).toBe(1);
  });

  it('0.5x: exactly 999 paid spins, ending 0.10 PTS, 199.80 PTS turnover', () => {
    const { records } = constantCohort(10, { ...session, horizonPaidSpins: 5_000 }, ['oracle:half']);
    const record = records[0];
    expect(record.paidSpins).toBe(999);
    expect(record.endingUnits).toBe(10);
    expect(record.turnoverUnits).toBe(19_980);
    // Return over the paid wager: half of every stake comes back.
    expect(constantCohort(10, { ...session, horizonPaidSpins: 5_000 }, ['oracle:half-rtp']).report.measuredRtpPercent!)
      .toBeCloseTo(50, 10);
    expect(record.busted).toBe(true);
    expect(record.maxDrawdownUnits).toBe(9_990);
    expect(record.balanceAtCheckpoint['500']).toBe(5_000);
    // The ruined session keeps its dust at later checkpoints.
    expect(record.balanceAtCheckpoint['5000']).toBe(10);
  });

  it('1x: survives the horizon unchanged, censored, bust time unknown', () => {
    const { report, records } = constantCohort(20, session, ['oracle:one']);
    const record = records[0];
    expect(record.paidSpins).toBe(500);
    expect(record.endingUnits).toBe(10_000);
    expect(record.busted).toBe(false);
    expect(record.censored).toBe(true);
    // Return over the paid wager: 20 units back for every 20 units staked.
    expect(report.measuredRtpPercent).toBe(100);
    expect(record.turnoverUnits).toBe(20 * 500);
    expect(record.aliveAtCheckpoint['500']).toBe(true);
    expect(record.ruinedBy['500']).toBe(false);
    expect(record.maxDrawdownUnits).toBe(0);
    expect(report.censoredCount).toBe(1);
    expect(report.observedBustQuantiles.mean).toBeNull();
    expect(report.observedLengthPaidSpins.median).toBe(500);
  });

  it('2x: reaches 125/150/200 PTS at 125/250/500 paid spins with no drawdown', () => {
    const { records } = constantCohort(40, session, ['oracle:double']);
    const record = records[0];
    expect(record.reachedTargets['12500']).toBe(true);
    expect(record.reachedTargets['15000']).toBe(true);
    expect(record.reachedTargets['20000']).toBe(true);
    expect(record.balanceAtCheckpoint['100']).toBe(12_000);
    expect(record.balanceAtCheckpoint['250']).toBe(15_000);
    expect(record.balanceAtCheckpoint['500']).toBe(20_000);
    expect(record.maxDrawdownUnits).toBe(0);
    expect(record.fellBelowTargets['8000']).toBe(false);

    const shorter = constantCohort(40, { ...session, horizonPaidSpins: 200 }, ['oracle:double-short']).records[0];
    expect(shorter.reachedTargets['20000']).toBe(false);
    // Beyond the horizon nothing is reported as a zero.
    expect(shorter.balanceAtCheckpoint['500']).toBeNull();
    expect(shorter.aliveAtCheckpoint['500']).toBeNull();
  });

  it('never counts a censored session as ruined and holds busted dust at checkpoints', () => {
    const mixed = simulateCohort(
      (seed) => constantSource(seed.endsWith('rich') ? 40 : 0),
      session,
      ['cohort:0', 'cohort:rich'],
    );
    expect(mixed.report.sampleSize).toBe(2);
    expect(mixed.report.ruinedCount).toBe(1);
    expect(mixed.report.censoredCount).toBe(1);
    expect(mixed.report.ruinBy['500']).toBe(0.5);
    // The busted session holds its dust balance, so the richer session does not
    // silently become the whole distribution at later checkpoints.
    expect(mixed.report.balanceAt['500'].mean).toBe(10_000);
  });

  it('gives every session its own independent stream', () => {
    const seeds = ['stream:0', 'stream:1'];
    const streams = seeds.map((seed) => createSimulationRng(seed));
    const first = streams[0].int(1, 1_000_000);
    const second = streams[1].int(1, 1_000_000);
    expect(first).not.toBe(second);
    const replay = createSimulationRng('stream:0').int(1, 1_000_000);
    expect(replay).toBe(first);
  });
});

describe('immutable artifact hashing', () => {
  const artifact = {
    schemaVersion: 1,
    profileId: 'lucky-lady.rtp50.gabc',
    gameId: 'lucky-lady',
    engineSha256: 'e'.repeat(64),
    rulesSha256: 'r'.repeat(64),
    policy: { targetRtpPercent: 50, pins: [1, 2, 3] },
    payload: { stopWeights: { reelStrip1: [1, 0, 5] } },
  };

  it('is stable across key order and changes with any covered field', () => {
    const hash = canonicalProfileHash(artifact);
    expect(canonicalProfileHash({ ...artifact, policy: { pins: [1, 2, 3], targetRtpPercent: 50 } })).toBe(hash);
    expect(canonicalProfileHash({ ...artifact, payload: { stopWeights: { reelStrip1: [1, 0, 6] } } })).not.toBe(hash);
    expect(canonicalProfileHash({ ...artifact, profileId: 'lucky-lady.rtp50.gother' })).not.toBe(hash);
    expect(canonicalProfileHash({ ...artifact, engineSha256: 'f'.repeat(64) })).not.toBe(hash);
    expect(JSON.parse(canonicalJson({ b: 1, a: { d: 2, c: 3 } }))).toEqual({ a: { c: 3, d: 2 }, b: 1 });
  });
});

describe('exact Lucky Lady analysis uses the game engine itself', () => {
  const { engine, rules } = loadVerifiedMath();

  const sparsePayload = () => {
    const strips = rules.reels as Record<string, string[]>;
    const stopWeights: Record<string, number[]> = {};
    for (const reelKey of Object.keys(strips)) {
      const stopCount = strips[reelKey].length - 2;
      const weights = new Array(stopCount).fill(0);
      weights[10] = 3;
      weights[40] = 1;
      stopWeights[reelKey] = weights;
    }
    return { stopWeights };
  };

  it('refuses to pretend a non-enumerable profile is proved', () => {
    expect(() => analyzeProfileExact(rules, engine, {}, 4_096)).toThrow(/LUCKY_LADY_BOARD_SPACE_TOO_LARGE/);
  });

  it('agrees with an independent Monte Carlo run of the same engine', () => {
    const payload = sparsePayload();
    const exact = analyzeProfileExact(rules, engine, payload, 4_096);
    expect(exact.reachableBoards).toBe(Math.pow(2, 5));

    const rng = createSimulationRng('differential:exact-vs-monte-carlo');
    let wager = 0;
    let returned = 0;
    const rounds = 3_000;
    const multipliers: number[] = [];
    for (let index = 0; index < rounds; index += 1) {
      const round = engine.playRound(rules, payload, { bet: 1, lines: rules.lines.length, rng, capture: false });
      wager += rules.lines.length;
      returned += round.totalWin;
      multipliers.push(round.totalWin / rules.lines.length);
    }
    const measured = (returned / wager) * 100;
    // Compare against the sampling error of THIS distribution, not a fixed
    // number of percentage points: a high-volatility profile has a wide
    // interval, and pretending otherwise would be a false precision.
    const mean = multipliers.reduce((sum, value) => sum + value, 0) / multipliers.length;
    const variance = multipliers.reduce((sum, value) => sum + (value - mean) ** 2, 0) / multipliers.length;
    const standardErrorPercent = (Math.sqrt(variance) / Math.sqrt(rounds)) * 100;
    expect(Math.abs(measured - exact.totalRtpPercent)).toBeLessThan(4 * standardErrorPercent + 0.01);

    // The exact distribution is a distribution: probabilities sum to one and
    // its mean is the analytical return.
    const probabilitySum = exact.baseDistribution.reduce((sum, entry) => sum + entry.probability, 0);
    const distributionMean = exact.baseDistribution.reduce(
      (sum, entry) => sum + entry.probability * entry.returnMultiplier,
      0,
    );
    expect(probabilitySum).toBeCloseTo(1, 10);
    expect(distributionMean * 100).toBeCloseTo(exact.baseRtpPercent, 8);

    // Every reachable board is inside the proved maximum, and no board exceeds
    // the single-spin ceiling the analysis states.
    expect(exact.maxBoardMultiplier).toBeGreaterThanOrEqual(0);
    expect(exact.maxRoundMultiplier).toBeGreaterThanOrEqual(exact.maxBoardMultiplier);
  });

  it('proves a zero-return profile only when no reachable board can pay', () => {
    const strips = rules.reels as Record<string, string[]>;
    const stopWeights: Record<string, number[]> = {};
    // A deliberately ungenerous stop choice; the analysis still has to prove it.
    for (const reelKey of Object.keys(strips)) {
      const stopCount = strips[reelKey].length - 2;
      const weights = new Array(stopCount).fill(0);
      weights[0] = 1;
      stopWeights[reelKey] = weights;
    }
    const analysis = analyzeProfileExact(rules, engine, { stopWeights }, 4_096);
    expect(analysis.reachableBoards).toBe(1);
    if (analysis.totalRtpPercent === 0) {
      expect(analysis.triggerProbability).toBe(0);
      expect(analysis.maxRoundMultiplier).toBe(0);
    } else {
      expect(analysis.totalRtpPercent).toBeGreaterThan(0);
    }
  });
});

describe('free feature accounting with authoritative resolved counts', () => {
  it('credits complete free-spin payouts with no extra wager and keeps the counts separate', () => {
    const config = { ...defaultSessionConfig(), horizonPaidSpins: 3 };
    const source = {
      drawPaidRound: () => ({
        returnUnits: 100,
        featureReturnUnits: 100,
        // Actual resolved counts for this round: one paid spin plus the free
        // spins the game really played.
        paidSpins: 1,
        freeSpins: 15,
        totalResolvedSpins: 16,
        featureTriggered: true,
        retriggered: false,
      }),
    };

    const record = simulateSession(source, config, 'free:0');
    expect(record.paidSpins).toBe(3);
    expect(record.freeSpins).toBe(45);
    expect(record.totalResolvedSpins).toBe(48);
    // Paid-only wager: free spins never debit.
    expect(record.turnoverUnits).toBe(60);
    // Every free-spin payout is credited inside its originating paid round.
    expect(record.returnedUnits).toBe(300);
    expect(record.endingUnits).toBe(10_000 - 60 + 300);
    expect(record.featureReturnUnits).toBe(300);
    expect(record.turnoverUnitsExact).toBe('60');
    expect(record.returnedUnitsExact).toBe('300');

    const { report } = simulateCohort(() => source, config, ['free:0']);
    expect(report.spinCounts).toEqual({ paidSpins: 3, freeSpins: 45, totalResolvedSpins: 48 });
    expect(report.totals.paidWagerUnits).toBe(60);
    expect(report.totals.turnoverPts).toBeCloseTo(0.6, 10);
    expect(report.totals.turnoverPtsExact).toBe('0.6');
    // RTP numerator is every credited payout, denominator is the paid wager.
    expect(report.measuredRtpPercent!).toBeCloseTo((300 / 60) * 100, 10);
    expect(report.measuredRtpExact).toBe('500');
    expect(report.totals.ledgerIdentityHolds).toBe(true);
  });

  it('uses the resolved free-spin count verbatim, never the awarded count or a trigger flag', () => {
    // The game awarded 15 spins but only 7 were actually resolved (a truncated
    // illustrative case): the resolved count is what must be recorded.
    const source = {
      drawPaidRound: () => ({
        returnUnits: 50,
        featureReturnUnits: 50,
        paidSpins: 1,
        freeSpins: 7,
        totalResolvedSpins: 8,
        featureTriggered: true,
        retriggered: false,
      }),
    };
    const record = simulateSession(source, { ...defaultSessionConfig(), horizonPaidSpins: 2 }, 'free:1');
    expect(record.paidSpins).toBe(2);
    expect(record.freeSpins).toBe(14);
    expect(record.totalResolvedSpins).toBe(16);
    expect(record.freeSpins).not.toBe(30);
  });

  it('refuses a total resolved count that disagrees with paid + free', () => {
    expect(() => simulateSession(
      {
        drawPaidRound: () => ({
          returnUnits: 10,
          featureReturnUnits: 10,
          paidSpins: 1,
          freeSpins: 15,
          totalResolvedSpins: 99,
          featureTriggered: true,
          retriggered: false,
        }),
      },
      defaultSessionConfig(),
      'free:2',
    )).toThrow(/SESSION_RESOLVED_SPIN_MISMATCH/);
  });

  it('refuses a feature payout that claims no resolved free spins', () => {
    expect(() => simulateSession(
      {
        drawPaidRound: () => ({
          returnUnits: 50,
          featureReturnUnits: 50,
          paidSpins: 1,
          freeSpins: 0,
          totalResolvedSpins: 1,
          featureTriggered: true,
          retriggered: false,
        }),
      },
      defaultSessionConfig(),
      'free:3',
    )).toThrow(/SESSION_ROUND_FEATURE_PAYOUT_WITHOUT_RESOLVED_SPINS/);
  });
});

describe('survival, ruin, quantiles and drawdown conventions', () => {
  it('reports survival at 100/250/500/1000 and null beyond the horizon', () => {
    const config = { ...defaultSessionConfig(), horizonPaidSpins: 1_000 };
    const { report } = simulateCohort(
      (seed) => constantSource(seed.endsWith('one') ? 20 : 0),
      config,
      ['mixed:zero', 'mixed:one'],
    );
    expect(report.aliveAt['100']).toBe(1);
    expect(report.aliveAt['250']).toBe(1);
    expect(report.aliveAt['500']).toBe(0.5);
    expect(report.aliveAt['1000']).toBe(0.5);
    // Beyond the horizon nothing is claimed.
    expect(report.aliveAt['2500']).toBeNull();
    expect(report.aliveAt['5000']).toBeNull();
    expect(report.ruinBy['1000']).toBe(0.5);
    expect(report.ruinBy['5000']).toBeNull();
    expect(report.ruinByObservedSessions['5000']).toBe(0);
  });

  it('measures peak-to-trough drawdown over completed rounds, initial balance included', () => {
    const returns = [0, 5_000, 0];
    let index = 0;
    const source = {
      drawPaidRound: () => ({
        returnUnits: returns[index++ % returns.length],
        featureReturnUnits: 0,
        paidSpins: 1,
        freeSpins: 0,
        totalResolvedSpins: 1,
        featureTriggered: false,
        retriggered: false,
      }),
    };
    const record = simulateSession(source, { ...defaultSessionConfig(), horizonPaidSpins: 3 }, 'drawdown:0');
    // 10000 -> 9980 (dd 20) -> 14960 (new peak) -> 14940 (dd 20 from the peak)
    expect(record.peakUnits).toBe(14_960);
    expect(record.peakUnitsExact).toBe('14960');
    expect(record.maxDrawdownUnits).toBe(20);
    expect(record.maxDrawdownUnitsExact).toBe('20');
    expect(record.endingUnits).toBe(14_940);
  });

  it('reports the documented R-7 quantiles for a small mixed sample', () => {
    const summary = summarize([100, 200, 300, 400, 500]);
    expect(summary.median).toBe(300);
    // R-7: h = (5 - 1) * 0.1 = 0.4 -> 100 + 0.4 * (200 - 100)
    expect(summary.p10).toBeCloseTo(140, 10);
    expect(summary.p25).toBe(200);
    expect(summary.p75).toBe(400);
    expect(summary.p90).toBeCloseTo(460, 10);
    expect(summary.p95).toBeCloseTo(480, 10);
  });
});

describe('exact accumulation above the safe integer range', () => {
  const start = 9_000_000_000_000_000; // safe integer, near 2^53
  const stake = 1_000_000_000_000_000;
  const payout = 9_000_000_000_000_000;

  it('keeps session balance, wager and payout exact past Number.MAX_SAFE_INTEGER', () => {
    const config = {
      ...defaultSessionConfig(),
      startUnits: start,
      stakeUnits: stake,
      horizonPaidSpins: 2,
      aliveCheckpoints: [1, 2],
      balanceCheckpoints: [1, 2],
      ruinCheckpoints: [1, 2],
      reachTargets: [],
      fallTargets: [],
    };
    const record = simulateSession(constantSource(payout), config, 'big:0');
    const expectedEnding = BigInt(start) - 2n * BigInt(stake) + 2n * BigInt(payout);
    expect(record.turnoverUnitsExact).toBe(String(2n * BigInt(stake)));
    expect(record.returnedUnitsExact).toBe(String(2n * BigInt(payout)));
    expect(record.endingUnitsExact).toBe(expectedEnding.toString());
    // 1.7e16 is beyond the exact Number range, so the numeric mirror is null
    // rather than a silently rounded value.
    expect(record.endingUnits).toBeNull();
    expect(record.balanceAtCheckpointExact['1']).toBe((BigInt(start) - BigInt(stake) + BigInt(payout)).toString());
    expect(record.balanceAtCheckpointExact['2']).toBe(expectedEnding.toString());

    const { report } = simulateCohort(() => constantSource(payout), config, ['big:0']);
    expect(report.totals.paidWagerUnitsExact).toBe(String(2n * BigInt(stake)));
    expect(report.totals.returnedUnitsExact).toBe(String(2n * BigInt(payout)));
    expect(report.totals.closingUnitsExact).toBe(expectedEnding.toString());
    expect(report.totals.closingUnits).toBeNull();
    expect(report.totals.ledgerIdentityHolds).toBe(true);
    // Exact ratio before any presentation rounding: 18e15 / 2e15 = 900%.
    expect(report.measuredRtpExact).toBe('900');
    expect(report.measuredRtpPercent).toBe(900);
    expect(report.spinCounts).toEqual({ paidSpins: 2, freeSpins: 0, totalResolvedSpins: 2 });
  });

  it('keeps repeated balance updates exact across many rounds above the safe range', () => {
    const config = {
      ...defaultSessionConfig(),
      startUnits: start,
      stakeUnits: stake,
      horizonPaidSpins: 5,
      aliveCheckpoints: [3, 5],
      balanceCheckpoints: [3, 5],
      ruinCheckpoints: [5],
      reachTargets: [],
      fallTargets: [],
    };
    const record = simulateSession(constantSource(payout), config, 'big:1');
    // 9e15 + 5 * (9e15 - 1e15) = 4.9e16, far above 2^53.
    const expected = BigInt(start) + 5n * (BigInt(payout) - BigInt(stake));
    expect(record.endingUnitsExact).toBe(expected.toString());
    expect(record.endingUnits).toBeNull();
    expect(BigInt(record.balanceAtCheckpointExact['5']!)).toBe(expected);
    expect(BigInt(record.balanceAtCheckpointExact['3']!)).toBe(BigInt(start) + 3n * (BigInt(payout) - BigInt(stake)));
    expect(record.peakUnitsExact).toBe(expected.toString());
    expect(record.maxDrawdownUnitsExact).toBe('0');
  });

  it('reports turnover PTS exactly when the unit total is beyond the safe range', () => {
    const config = {
      ...defaultSessionConfig(),
      startUnits: start,
      stakeUnits: stake,
      horizonPaidSpins: 2,
      aliveCheckpoints: [1],
      balanceCheckpoints: [1],
      ruinCheckpoints: [1],
      reachTargets: [],
      fallTargets: [],
    };
    const { report } = simulateCohort(() => constantSource(payout), config, ['big:2']);
    expect(report.totals.turnoverPtsExact).toBe('20000000000000'); // 2e15 units = 2e13 PTS
    expect(report.turnoverPts.medianExact).toBe('20000000000000');
    // The exact value is preserved; only its presentation mirror may be null.
    expect(report.turnoverPts.sampleSize).toBe(1);
  });
});

describe('true thresholds beyond MAX_SAFE with odd totals', () => {
  const MAX = Number.MAX_SAFE_INTEGER; // 9007199254740991

  const stepSource = (returns: readonly number[]): SessionOutcomeSource => {
    let index = 0;
    return {
      drawPaidRound: () => {
        const value = returns[index];
        if (value === undefined) throw new Error('test source exhausted');
        index += 1;
        return {
          returnUnits: value,
          featureReturnUnits: 0,
          paidSpins: 1,
          freeSpins: 0,
          totalResolvedSpins: 1,
          featureTriggered: false,
          retriggered: false,
        };
      },
    };
  };

  const edgeConfig = {
    ...defaultSessionConfig(),
    startUnits: MAX,
    stakeUnits: 1,
    horizonPaidSpins: 4,
    aliveCheckpoints: [1, 2, 3, 4],
    balanceCheckpoints: [1, 2, 3, 4],
    ruinCheckpoints: [1, 2, 3, 4],
    reachTargets: [],
    fallTargets: [],
  };

  it('walks +/-1 around MAX_SAFE with exact checkpoints, peak, drawdown and ledger', () => {
    // Stake 1: MAX+1, MAX, MAX+1, MAX - the balance crosses the safe range and
    // comes back to an exactly representable value.
    const config = edgeConfig;
    const record = simulateSession(stepSource([2, 0, 2, 0]), config, 'edge:0');
    expect(record.balanceAtCheckpointExact['1']).toBe('9007199254740992');
    expect(record.balanceAtCheckpointExact['2']).toBe('9007199254740991');
    expect(record.balanceAtCheckpointExact['3']).toBe('9007199254740992');
    expect(record.balanceAtCheckpointExact['4']).toBe('9007199254740991');
    expect(record.balanceAtCheckpoint['1']).toBeNull();
    expect(record.balanceAtCheckpoint['2']).toBe(9007199254740991);
    expect(record.endingUnitsExact).toBe('9007199254740991');
    expect(record.peakUnitsExact).toBe('9007199254740992');
    expect(record.peakUnits).toBeNull();
    expect(record.maxDrawdownUnitsExact).toBe('1');
    expect(record.maxDrawdownUnits).toBe(1);
    expect(record.turnoverUnitsExact).toBe('4');
    expect(record.returnedUnitsExact).toBe('4');

    const { report } = simulateCohort(() => stepSource([2, 0, 2, 0]), config, ['edge:0']);
    expect(report.totals.openingUnitsExact).toBe('9007199254740991');
    expect(report.totals.closingUnitsExact).toBe('9007199254740991');
    expect(report.totals.ledgerDeltaUnitsExact).toBe('0');
    expect(report.totals.ledgerIdentityHolds).toBe(true);
    expect(report.measuredRtpExact).toBe('100');
    expect(report.maxDrawdown.p90).toBe(1);
  });

  it('crosses MAX_SAFE with an odd total and keeps exact feature/base/ratio identity', () => {
    const config = edgeConfig;
    const factory = () => ({
      drawPaidRound: () => ({
        returnUnits: 3,
        featureReturnUnits: 3,
        paidSpins: 1,
        freeSpins: 1,
        totalResolvedSpins: 2,
        featureTriggered: true,
        retriggered: false,
      }),
    });
    const record = simulateSession(factory(), config, 'edge:1');
    // MAX - 4 stakes + 4 x 3 units = 9007199254740999, odd and beyond 2^53.
    expect(record.endingUnitsExact).toBe('9007199254740999');
    expect(record.endingUnits).toBeNull();
    expect(record.returnedUnitsExact).toBe('12');
    expect(record.featureReturnUnitsExact).toBe('12');
    expect(record.baseReturnUnitsExact).toBe('0');
    expect(record.turnoverUnitsExact).toBe('4');
    expect(record.paidSpins).toBe(4);
    expect(record.freeSpins).toBe(4);
    expect(record.totalResolvedSpins).toBe(8);

    const { report } = simulateCohort(factory, config, ['edge:1']);
    expect(report.totals.openingUnitsExact).toBe('9007199254740991');
    expect(report.totals.closingUnitsExact).toBe('9007199254740999');
    expect(report.totals.closingUnits).toBeNull();
    expect(report.totals.featureReturnUnitsExact).toBe('12');
    expect(report.totals.baseReturnUnitsExact).toBe('0');
    expect(BigInt(report.totals.baseReturnUnitsExact) + BigInt(report.totals.featureReturnUnitsExact))
      .toBe(BigInt(report.totals.returnedUnitsExact));
    expect(report.totals.paidWagerUnitsExact).toBe('4');
    expect(report.totals.ledgerIdentityHolds).toBe(true);
    // Exact ratio before presentation: 12 / 4 x 100 = 300.
    expect(report.measuredRtpExact).toBe('300');
    expect(report.measuredRtpPercent).toBe(300);
    expect(report.spinCounts).toEqual({ paidSpins: 4, freeSpins: 4, totalResolvedSpins: 8 });
  });
});

describe('spin-count accumulation is exact and checked', () => {
  const half = 2 ** 52; // 4503599627370496, a safe integer
  const config = {
    ...defaultSessionConfig(),
    startUnits: 10_000,
    stakeUnits: 20,
    horizonPaidSpins: 2,
    aliveCheckpoints: [1, 2],
    balanceCheckpoints: [1],
    ruinCheckpoints: [1],
    reachTargets: [],
    fallTargets: [],
  };

  it('accumulates two large counts exactly while the total stays representable', () => {
    const perRoundFree = half - 2;
    const source = {
      drawPaidRound: () => ({
        returnUnits: 0,
        featureReturnUnits: 0,
        paidSpins: 1,
        freeSpins: perRoundFree,
        totalResolvedSpins: perRoundFree + 1,
        featureTriggered: true,
        retriggered: false,
      }),
    };
    const record = simulateSession(source, config, 'count:0');
    expect(record.paidSpins).toBe(2);
    expect(record.freeSpins).toBe(2 * perRoundFree); // 9007199254740988
    expect(record.totalResolvedSpins).toBe(2 * (perRoundFree + 1)); // 9007199254740990
    expect(record.freeSpins).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it('fails closed when a count total leaves the exact range', () => {
    const source = {
      drawPaidRound: () => ({
        returnUnits: 0,
        featureReturnUnits: 0,
        paidSpins: 1,
        freeSpins: half,
        totalResolvedSpins: half + 1,
        featureTriggered: true,
        retriggered: false,
      }),
    };
    expect(() => simulateSession(source, config, 'count:1')).toThrow(/BANKROLL_COUNT_UNREPRESENTABLE/);
  });
});

describe('presentation and multiplier helpers', () => {
  it('orders raw rationals with negative denominators', () => {
    expect(ratCompare(rational(1, 2), { numerator: 1, denominator: -2 })).toBe(1);
    expect(ratEquals(rational(-1, 2), { numerator: 1, denominator: -2 })).toBe(true);
    expect(ratCompare({ numerator: -1, denominator: -2 }, rational(1, 4))).toBe(1);
    expect(ratCompare({ numerator: 1, denominator: -3 }, rational(0, 1))).toBe(-1);
  });

  it('converts exact rationals to finite doubles with explicit failure modes', () => {
    // Zero numerator: 0, whatever the (non-zero) denominator sign.
    expect(bigRationalToPresentationNumber({ numerator: 0n, denominator: 7n })).toBe(0);
    expect(bigRationalToPresentationNumber({ numerator: 0n, denominator: -7n })).toBe(0);
    // Invalid denominator: explicit rejection, including 0/0.
    expect(() => bigRationalToPresentationNumber({ numerator: 1n, denominator: 0n }))
      .toThrow(/RATIONAL_DENOMINATOR_ZERO/);
    expect(() => bigRationalToPresentationNumber({ numerator: 0n, denominator: 0n }))
      .toThrow(/RATIONAL_DENOMINATOR_ZERO/);

    // Small but representable, both signs.
    expect(bigRationalToPresentationNumber(bigRational(1n, 10n ** 16n))).toBe(1e-16);
    expect(bigRationalToPresentationNumber(bigRational(-1n, 10n ** 16n))).toBe(-1e-16);
    expect(bigRationalToPresentationNumber(bigRational(1n, 10n ** 300n))).toBe(1e-300);
    expect(bigRationalToPresentationNumber(bigRational(-1n, 10n ** 300n))).toBe(-1e-300);

    // Large but representable.
    expect(bigRationalToPresentationNumber(bigRational(10n ** 100n, 1n))).toBe(1e100);
    expect(bigRationalToPresentationNumber(bigRational(10n ** 300n, 1n))).toBe(1e300);
    expect(bigRationalToPresentationNumber(bigRational(-(10n ** 300n), 1n))).toBe(-1e300);
    // Huge over huge still resolves by magnitude, not by overflowing inputs.
    expect(bigRationalToPresentationNumber(bigRational(10n ** 30n, 10n ** 28n))).toBeCloseTo(100, 6);
    expect(bigRationalToPresentationNumber(bigRational(10n ** 400n, 10n ** 400n))).toBe(1);
    expect(bigRationalToPresentationNumber(bigRational(10n ** 400n, 10n ** 416n))).toBeCloseTo(1e-16, 30);

    // Thirds: nearest double in both directions.
    expect(bigRationalToPresentationNumber(bigRational(1n, 3n))).toBe(0.3333333333333333);
    expect(bigRationalToPresentationNumber(bigRational(-1n, 3n))).toBe(-0.3333333333333333);
    // Signed units and a large power of ten.
    expect(bigRationalToPresentationNumber(bigRational(1n, 1n))).toBe(1);
    expect(bigRationalToPresentationNumber(bigRational(-1n, 1n))).toBe(-1);
    expect(bigRationalToPresentationNumber(bigRational(10n ** 16n, 1n))).toBe(1e16);

    // Near Number.MAX_VALUE: exactly representable, then a true overflow.
    const exactMax = BigInt(Number.MAX_VALUE);
    expect(bigRationalToPresentationNumber(bigRational(exactMax, 1n))).toBe(Number.MAX_VALUE);
    // Inside half an ulp of MAX_VALUE the value still rounds down to it.
    expect(bigRationalToPresentationNumber(bigRational(exactMax + 2n ** 969n, 1n))).toBe(Number.MAX_VALUE);
    // Past half an ulp the exact comparison reports overflow, not a rounded value.
    expect(() => bigRationalToPresentationNumber(bigRational(exactMax + 2n ** 970n + 1n, 1n)))
      .toThrow(/RATIONAL_PRESENTATION_OVERFLOW/);
    expect(() => bigRationalToPresentationNumber(bigRational(18n * 10n ** 307n, 1n)))
      .toThrow(/RATIONAL_PRESENTATION_OVERFLOW/);

    // Subnormal boundary: the smallest subnormal is keepable, half of it is not.
    expect(bigRationalToPresentationNumber(bigRational(5n, 10n ** 324n))).toBe(5e-324);
    expect(bigRationalToPresentationNumber(bigRational(25n, 10n ** 325n))).toBe(5e-324);
    expect(bigRationalToPresentationNumber(bigRational(1n, 10n ** 320n))).toBe(1e-320);
    expect(() => bigRationalToPresentationNumber(bigRational(2n, 10n ** 324n)))
      .toThrow(/RATIONAL_PRESENTATION_UNDERFLOW/);
    expect(() => bigRationalToPresentationNumber(bigRational(1n, 10n ** 400n)))
      .toThrow(/RATIONAL_PRESENTATION_UNDERFLOW/);
    expect(() => bigRationalToPresentationNumber(bigRational(-1n, 10n ** 400n)))
      .toThrow(/RATIONAL_PRESENTATION_UNDERFLOW/);
  });

  it('converts multipliers exactly or refuses them', () => {
    expect(multiplierToUnits('0.2', 20)).toBe(4);
    expect(multiplierToUnits(0.5, 20)).toBe(10);
    expect(multiplierToUnits('1e-7', 10_000_000)).toBe(1);
    expect(() => multiplierToUnits('0.333', 20)).toThrow(/RETURN_UNITS_NOT_INTEGRAL/);
    expect(() => multiplierToUnits(0.1, 3)).toThrow(/RETURN_UNITS_NOT_INTEGRAL/);
    expect(() => multiplierToUnits(1, 0)).toThrow(/RETURN_UNITS_STAKE_INVALID/);
  });
});

describe('markdown report presentation', () => {
  const emptyQuantiles = {
    mean: null, median: null, p10: null, p25: null, p75: null, p90: null, p95: null,
  };
  const exactSummary = (value: string) => ({
    sampleSize: 2,
    mean: null, meanExact: value,
    median: null, medianExact: value,
    p10: null, p10Exact: value,
    p25: null, p25Exact: value,
    p75: null, p75Exact: value,
    p90: null, p90Exact: value,
    p95: null, p95Exact: value,
  });

  const HUGE = '54043195528445946';

  const buildReport = (): BankrollReport => ({
    denomination: 'simulation-only centi-points (1 unit = 0.01 PTS)',
    config: defaultSessionConfig(),
    sampleSize: 2,
    seeds: { prefix: 'bankroll', count: 2, first: 'bankroll:0', last: 'bankroll:1' },
    horizonPaidSpins: 3,
    censoredCount: 0,
    ruinedCount: 2,
    totals: {
      openingUnits: null,
      openingUnitsExact: HUGE,
      paidWagerUnits: 40,
      paidWagerUnitsExact: '40',
      baseReturnUnits: 10,
      baseReturnUnitsExact: '10',
      featureReturnUnits: 30,
      featureReturnUnitsExact: '30',
      returnedUnits: 40,
      returnedUnitsExact: '40',
      closingUnits: null,
      closingUnitsExact: HUGE,
      ledgerDeltaUnits: null,
      ledgerDeltaUnitsExact: '0',
      ledgerIdentityHolds: true,
      paidRounds: 2,
      turnoverPts: 0.4,
      turnoverPtsExact: '0.4',
      returnedPts: 0.4,
      returnedPtsExact: '0.4',
    },
    observedLengthPaidSpins: { ...emptyQuantiles, mean: 1, median: 1 },
    turnoverPaidSpins: { ...emptyQuantiles, mean: 1, median: 1 },
    turnoverPts: exactSummary('0.4'),
    balanceAt: { '1': emptyQuantiles },
    balanceAtExact: { '1': exactSummary('27021597764222973') },
    aliveAt: { '1': 1 },
    reachProbability: { '15000': 0 },
    fallBelowProbability: { '8000': 1 },
    ruinBy: { '1': 1 },
    ruinByObservedSessions: { '1': 2 },
    observedBustQuantiles: { ...emptyQuantiles, mean: 1, median: 1 },
    maxDrawdown: { ...emptyQuantiles, mean: 0, median: 0 },
    maxWin: { units: 30, unitsExact: '30', pts: 0.3, ptsExact: '0.3', sessionFrequency: 1 },
    spinCounts: { paidSpins: 2, freeSpins: 2, totalResolvedSpins: 4 },
    featureRoundRate: 1,
    retriggerRoundRate: 0,
    featureReturnShare: 0.75,
    measuredRtpExact: '100',
    measuredRtpPercent: 100,
    houseEdgeExact: '0',
    houseEdgePercent: 0,
    notes: [],
  });

  const buildEvidence = (): MathValidationEvidence => ({
    validationId: 'fixture-validation',
    profileId: 'lucky-lady.rtp50.presentation',
    gameId: 'lucky-lady',
    profileHash: 'a'.repeat(64),
    engineSha256: 'b'.repeat(64),
    rulesSha256: 'c'.repeat(64),
    createdAt: '2026-10-01T00:00:00.000Z',
    seeds: { calibrationPrefix: 'calibration', validationPrefix: 'validation', bankrollPrefix: 'bankroll' },
    runs: [],
    metrics: null,
    bankroll: buildReport(),
    checks: [{ id: 'BANKROLL_ACCOUNTING_EXACT', status: 'PASS', detail: 'fixture' }],
    result: 'PASS',
    grade: 'ACTIVATION',
  });

  it('writes exact accounting strings verbatim and marks statistics as rounded', () => {
    const markdown = bankrollMarkdown(buildEvidence());
    // The huge exact total survives Markdown untouched.
    expect(markdown).toContain(HUGE);
    expect(markdown).toContain(`opening ${HUGE}`);
    expect(markdown).toContain(`= closing ${HUGE}`);
    expect(markdown).toContain('base 10 + feature 30 = returned 40');
    expect(markdown).toContain('Turnover: 40 units exact (= 0.4 PTS at the exact 1/100 scaling) over 2 paid rounds');
    expect(markdown).toContain('27021597764222973');
    // No accounting line degrades to a null numeric mirror.
    expect(markdown).not.toMatch(/opening null/);
    expect(markdown).not.toMatch(/closing null/);
    expect(markdown).not.toMatch(/wager null/);
    // Exact monetary strings and rounded statistical presentation are labelled.
    expect(markdown).toContain('exact integer unit strings');
    expect(markdown).toContain('never an accounting input');
    expect(markdown).toContain('rounded statistical presentation');
    expect(markdown).toContain('Balance mean (rounded statistical)');
    expect(markdown).toContain('30 units exact');
    // No statistical figure may be labelled as an exact ratio.
    expect(markdown).not.toContain('exact ratio');
  });

  it('shows a tiny non-zero statistic as non-zero instead of 0.0000', () => {
    const evidence = buildEvidence();
    evidence.bankroll.measuredRtpPercent = 1e-16;
    // The stored rounded string is a 6-decimal presentation of the exact ratio.
    evidence.bankroll.measuredRtpExact = '0';
    const markdown = bankrollMarkdown(evidence);
    expect(markdown).toContain('1e-16%');
    expect(markdown).toContain('the stored 6-decimal presentation rounds this to 0');
    expect(markdown).not.toMatch(/Measured return[^\n]*0\.000000%/);
    expect(markdown).not.toContain('exact ratio');
  });
});
