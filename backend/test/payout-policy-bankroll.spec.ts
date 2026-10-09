import { loadVerifiedMath } from '../src/casino/games/lucky-lady/lucky-lady.math';
import { boardFromStops } from '../src/casino/games/lucky-lady/lucky-lady.exact';
import { buildDistributionSupport } from '../src/casino/games/lucky-lady/lucky-lady.distribution';
import {
  luckyLadyPolicySessionFactory,
  policyDistributionSessionSource,
} from '../src/casino/games/lucky-lady/lucky-lady.distribution-session';
import {
  FROZEN_RTP50_REFERENCE,
  PAYOUT_POLICY_FIXTURES,
  type PolicyFixture,
} from '../src/casino/games/lucky-lady/lucky-lady.distribution-fixtures';
import { defaultSessionConfig } from '../src/casino/platform/math-control/math-control.bankroll';
import type { DistributionPolicy } from '../src/casino/platform/math-control/payout-distribution';
import type { SessionConfig, SessionOutcomeSource } from '../src/casino/platform/math-control/math-control.types';
import {
  drySpellStat,
  renderPolicyBankrollMarkdown,
  runLengths,
  runPolicyBankroll,
  wilson95,
  type PolicyBankrollReport,
  type PolicyRoundObservation,
  type PolicySessionObserver,
  type PolicySupportView,
} from '../src/casino/platform/math-control/payout-policy-bankroll';
import { simulateSession } from '../src/casino/platform/math-control/math-control.bankroll';

/**
 * Offline payout-policy -> bankroll bridge.
 *
 * These are behaviour fixtures: real reachable boards executed by the vendored
 * Lucky Lady engine, selected through the shared payout-class selector, and
 * accounted by the accepted bankroll simulator. Nothing here generates,
 * validates or activates a profile, and the sessions exclude the optional
 * gamble by construction.
 */

const { engine, rules } = loadVerifiedMath();
const strips = rules.reels as Record<string, string[]>;
const reels = Object.keys(strips)
  .sort((a, b) => Number(a.replace('reelStrip', '')) - Number(b.replace('reelStrip', '')))
  .map((reelKey) => ({ reelKey, strip: strips[reelKey] }));
const lines = rules.lines.length;

const fixture = (fixtureId: string): PolicyFixture => {
  const found = PAYOUT_POLICY_FIXTURES.find((entry) => entry.fixtureId === fixtureId);
  if (!found) throw new Error(`unknown fixture ${fixtureId}`);
  return found;
};

const supportFor = (entry: PolicyFixture) => {
  const built = buildDistributionSupport(
    { profileId: entry.artifact.profileId, profileHash: entry.artifact.canonicalHash, payload: entry.payload },
    entry.policy,
    { maxBoards: 4_096 },
  );
  if (!built.ok) throw new Error(`fixture ${entry.fixtureId} support refused: ${built.reasons.map((r) => r.constraint).join(', ')}`);
  return built.support;
};

const sessionConfigFor = (horizonPaidSpins: number) => ({ ...defaultSessionConfig(), horizonPaidSpins });

const runFixture = (entry: PolicyFixture, sessions: number, horizonPaidSpins: number, seedPrefix: string) => {
  const support = supportFor(entry);
  const config = sessionConfigFor(horizonPaidSpins);
  return runPolicyBankroll({
    gameId: 'lucky-lady',
    policy: entry.policy,
    support,
    config,
    sessions,
    seedPrefix,
    sessionSourceFactory: luckyLadyPolicySessionFactory({ support, payload: entry.payload, config, rules, engine }),
  });
};

/** Independent native re-evaluation of a forced paid board. */
const nativePaidUnits = (stops: readonly number[], bet: number) =>
  engine.evaluate(rules, boardFromStops(reels, stops, String(rules.emptyRow)), { bet, lines });

describe('payout policy fixtures (offline behaviour evidence)', () => {
  it('builds an exact bounded support for every fixture, with the weighted classes reachable', () => {
    for (const entry of PAYOUT_POLICY_FIXTURES) {
      const support = supportFor(entry);
      expect(support.reachableBoards).toBeGreaterThan(0);
      expect(support.reachableBoards).toBeLessThanOrEqual(4_096);
      expect(support.ev.denominator).toBeGreaterThan(0n);
      expect(support.maxWin.resolvedSpinMax).toBeLessThanOrEqual(entry.policy.maxWinMultiplier);
      // Every class that carries weight must have at least one reachable member;
      // the support builder refuses rather than carrying unreachable weight.
      for (const [name, weight] of Object.entries(entry.policy.weights)) {
        if (weight > 0) {
          expect(support.membersByClass[name as keyof typeof support.membersByClass].length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('A: LOSS 100% funds exactly 500 staked rounds and ends at zero', () => {
    const run = runFixture(fixture('test-loss-100'), 3, 10_000, 'spec:loss-100');
    const { report, records } = run;
    for (const record of records) {
      expect(record.paidSpins).toBe(500);
      expect(record.turnoverUnitsExact).toBe('10000');
      expect(record.endingUnitsExact).toBe('0');
      expect(record.returnedUnitsExact).toBe('0');
      expect(record.busted).toBe(true);
      expect(record.censored).toBe(false);
      expect(record.ruinedBy['500']).toBe(true);
    }
    expect(Number(report.measured.rtpPercentExact)).toBe(0);
    expect(Number(report.expected.rtpPercentExact)).toBe(0);
    expect(report.paidEvents.fullLoss.rate).toBe(1);
    expect(report.paidEvents.hit.count).toBe(0);
    expect(report.paidEvents.nativeClassMismatches).toBe(0);
    expect(report.classes.find((entry) => entry.class === 'LOSS')?.observedPercent).toBe(100);
    expect(report.maxObserved.paidSpinUnits).toBe(0);
    expect(report.maxObserved.freeSpinUnits).toBe(0);
    expect(Number(report.turnover.totalPtsExact)).toBe(300);
    expect(report.measured.ledgerIdentityHolds).toBe(true);
  });

  it('B: BREAK_EVEN 100% returns the stake exactly and censors at the horizon', () => {
    const run = runFixture(fixture('test-break-even-100'), 2, 1_000, 'spec:break-even-100');
    const { report, records } = run;
    for (const record of records) {
      expect(record.paidSpins).toBe(1_000);
      expect(record.turnoverUnitsExact).toBe('20000');
      expect(record.endingUnitsExact).toBe('10000');
      expect(record.returnedUnitsExact).toBe('20000');
      expect(record.censored).toBe(true);
      expect(record.busted).toBe(false);
      expect(record.maxDrawdownUnitsExact).toBe('0');
    }
    expect(Number(report.measured.rtpPercentExact)).toBe(100);
    expect(Number(report.measured.houseEdgePercentExact)).toBe(0);
    expect(report.paidEvents.breakEven.rate).toBe(1);
    expect(report.paidEvents.fullLoss.count).toBe(0);
    expect(report.survival['1000']?.rate).toBe(1);
    expect(report.ruin['1000']?.ruined).toBe(0);
    expect(report.sample.censoredCount).toBe(2);
  });

  it('feature rounds credit the native free-spin chain with no extra wager and stay inside the per-spin cap', () => {
    const entry = fixture('test-feature-mix');
    const run = runFixture(entry, 3, 800, 'spec:feature-mix');
    const observations = run.observations.flat();
    expect(observations.length).toBeGreaterThan(0);

    const capUnits = entry.policy.maxWinMultiplier * run.report.paidEvents.paidStakeUnits;
    const triggered = observations.filter((round) => round.featureTriggered);
    expect(triggered.length).toBeGreaterThan(0);

    for (const round of observations) {
      // Every reported paid board is a real reachable board: re-evaluating the
      // exact stops with the engine must reproduce the recorded numbers.
      const native = nativePaidUnits(round.stops, run.report.paidEvents.paidStakeUnits / lines);
      expect(native.totalWin).toBe(round.paidUnits);
      expect(native.scatterCount).toBe(round.nativeScatterCount);
      expect(round.totalResolvedSpins).toBe(1 + round.freeSpins);
      expect(round.returnUnits).toBe(round.paidUnits + round.featureUnits);
      expect(round.paidUnits).toBeLessThanOrEqual(capUnits);
      expect(round.maxFreeSpinUnits).toBeLessThanOrEqual(capUnits);
      if (!round.featureTriggered) {
        expect(round.freeSpins).toBe(0);
        expect(round.featureUnits).toBe(0);
      }
    }

    for (const round of triggered) {
      // A trigger awards the native 15 free spins; a retrigger would extend the
      // chain, and in this fixture the free-spin chain is subcritical.
      expect(round.freeSpins).toBeGreaterThanOrEqual(rules.constants.slotFreeCount);
      expect(round.selectedClass).toBe('FEATURE_TRIGGER');
      expect(round.totalResolvedSpins).toBe(1 + round.freeSpins);
    }
    // The free-spin chain really pays: across the run at least one free spin
    // credited a native payout to its originating round.
    expect(observations.some((round) => round.featureUnits > 0)).toBe(true);
    expect(run.report.spins.freeSpinsTotal).toBeGreaterThan(0);

    expect(run.report.paidEvents.nativeClassMismatches).toBe(0);
    expect(run.report.paidEvents.featureTriggered.count).toBe(triggered.length);
    expect(run.report.maxObserved.paidSpinWithinCap).toBe(true);
    expect(run.report.maxObserved.freeSpinWithinCap).toBe(true);
    // The per-spin cap is proved per resolved spin; the feature chain itself is
    // deliberately uncapped and reported separately.
    expect(run.report.maxObserved.featureAggregateUnits).toBeGreaterThanOrEqual(
      run.report.maxObserved.freeSpinUnits,
    );
    expect(run.report.spins.freeSpinsTotal).toBeGreaterThan(0);
    expect(run.report.spins.resolvedSpinsTotal).toBe(run.report.spins.paidSpinsTotal + run.report.spins.freeSpinsTotal);
    expect(run.report.expected.rtpPercent).not.toBeNull();
  });

  it('is deterministic per seed and independent across session streams', () => {
    const entry = fixture('test-retention');
    const support = supportFor(entry);
    const config = sessionConfigFor(500);
    const factory = luckyLadyPolicySessionFactory({ support, payload: entry.payload, config, rules, engine });

    const draw = (seed: string, rounds: number): PolicyRoundObservation[] => {
      const collected: PolicyRoundObservation[] = [];
      const source = factory(seed, { onPaidRound: (round) => collected.push(round) });
      for (let index = 0; index < rounds; index += 1) source.drawPaidRound();
      return collected;
    };

    const first = draw('spec:determinism:0', 40);
    const second = draw('spec:determinism:0', 40);
    expect(second).toEqual(first);
    const other = draw('spec:determinism:1', 40);
    expect(other).not.toEqual(first);
    // The accepted session simulator consumes exactly the same stream: a
    // re-run of one session with the same seed yields the identical record.
    const recordA = simulateSession(factory('spec:determinism:0', { onPaidRound: () => undefined }), config, 'spec:determinism:0');
    const recordB = simulateSession(factory('spec:determinism:0', { onPaidRound: () => undefined }), config, 'spec:determinism:0');
    expect(recordB).toEqual(recordA);
    expect(recordA.paidSpins).toBeGreaterThan(0);
  });

  it('a moderate actual-path sample matches the configured classes and the accepted accounting identity', () => {
    const retention = runFixture(fixture('test-retention'), 6, 1_200, 'spec:moderate-retention');
    const observations = retention.observations.flat();
    const report = retention.report;
    const stakeUnits = report.paidEvents.paidStakeUnits;

    // Counts come from the rounds the source actually resolved.
    expect(report.paidEvents.paidRounds).toBe(observations.length);
    expect(report.spins.paidSpinsTotal).toBe(observations.length);
    expect(report.spins.freeSpinsTotal).toBe(observations.reduce((sum, round) => sum + round.freeSpins, 0));
    expect(report.spins.resolvedSpinsTotal).toBe(report.spins.paidSpinsTotal + report.spins.freeSpinsTotal);

    // The accepted accounting identity holds per session in exact integers.
    for (const record of retention.records) {
      const identity =
        BigInt(record.returnedUnitsExact)
        - BigInt(record.turnoverUnitsExact)
        - (BigInt(record.endingUnitsExact) - BigInt(report.sample.config.startUnits));
      expect(identity).toBe(0n);
    }
    expect(report.measured.ledgerIdentityHolds).toBe(true);
    expect(Number(report.measured.houseEdgePercentExact).toFixed(4))
      .toBe((100 - Number(report.measured.rtpPercentExact)).toFixed(4));

    // Observed class shares stay within a stated tolerance of the configured
    // weights: the fixed-n binomial z, with |z| <= 5 as the fixture tolerance.
    // At most one class may exceed 3 standard errors in a run this size (the
    // fixed-n z is approximate here, because the paid-round count is random).
    expect(report.classesOutsideThreeSigma).toBeLessThanOrEqual(1);
    for (const entry of report.classes) {
      if (entry.configuredWeight > 0) {
        expect(entry.zDeviation).not.toBeNull();
        expect(Math.abs(entry.zDeviation as number)).toBeLessThan(5);
      } else {
        expect(entry.observedCount).toBe(0);
      }
    }
    expect(report.paidEvents.nativeClassMismatches).toBe(0);

    // Expected and measured return agree within the reported standard error of
    // the per-round mean (a normal approximation, stated in the report).
    const difference = Math.abs(
      Number(report.measured.rtpPercentExact) - Number(report.expected.rtpPercentExact),
    );
    expect(difference).toBeLessThanOrEqual(3 * (report.measured.rtpStandardErrorPercent ?? 0) + 1);

    // Maxima: paid and free resolved spins stay inside the exact cap; the
    // feature aggregate is reported separately.
    const capUnits = Number(report.maxObserved.capUnitsExact);
    expect(report.maxObserved.paidSpinUnits).toBeLessThanOrEqual(capUnits);
    expect(report.maxObserved.freeSpinUnits).toBeLessThanOrEqual(capUnits);
    expect(report.maxObserved.paidSpinWithinCap).toBe(true);
    expect(report.maxObserved.freeSpinWithinCap).toBe(true);

    const feature = runFixture(fixture('test-feature-mix'), 4, 800, 'spec:moderate-feature');
    const featureObservations = feature.observations.flat();
    const featureCapUnits = Number(feature.report.maxObserved.capUnitsExact);
    for (const round of featureObservations) {
      expect(round.paidUnits).toBeLessThanOrEqual(featureCapUnits);
      expect(round.maxFreeSpinUnits).toBeLessThanOrEqual(featureCapUnits);
      expect(round.returnUnits).toBe(round.paidUnits + round.featureUnits);
    }
    const triggered = featureObservations.filter((round) => round.featureTriggered);
    expect(triggered.length).toBeGreaterThan(0);
    expect(feature.report.maxObserved.freeSpinWithinCap).toBe(true);
    expect(feature.report.maxObserved.featureAggregateUnits).toBeGreaterThanOrEqual(
      Math.max(...featureObservations.map((round) => round.maxFreeSpinUnits)),
    );
    expect(feature.report.paidEvents.nativeClassMismatches).toBe(0);
    // A non-integral ceiling is refused instead of being rounded up.
    expect(() => runPolicyBankroll({
      gameId: 'lucky-lady',
      policy: { ...fixture('test-retention').policy, maxWinMultiplier: 0.33 },
      support: supportFor(fixture('test-retention')),
      config: sessionConfigFor(10),
      sessions: 1,
      seedPrefix: 'spec:cap-refusal',
      sessionSourceFactory: () => { throw new Error('the source must never be reached'); },
    })).toThrow(/POLICY_BANKROLL_CAP_NOT_INTEGRAL/);
  });

  it('classifies paid events and terminal dry spells exactly', () => {
    const stake = 20;
    const values = [0, 0, 0, 20, 5, 0, 0, 30];
    const fullLoss = drySpellStat([values], (value) => value === 0, 'zero paid payout');
    expect(fullLoss.runs).toBe(2);
    expect(fullLoss.meanRunLength).toBe(2.5);
    expect(fullLoss.meanRunLengthDenominator).toBe(2);
    expect(fullLoss.longestPerSession.mean).toBe(3);
    expect(fullLoss.longestPerSessionP99).toBe(3);
    // R-7 interpolation over the pooled runs [2, 3].
    expect(fullLoss.pooledRuns.p75).toBe(2.75);
    expect(fullLoss.terminalStreakIncluded).toBe(true);

    const nonProfitable = drySpellStat([values], (value) => value <= stake, 'non-profitable paid round');
    expect(nonProfitable.runs).toBe(1);
    expect(nonProfitable.meanRunLength).toBe(7);
    expect(nonProfitable.longestPerSession.mean).toBe(7);

    // A session that ends on a qualifying streak keeps that terminal run.
    const terminal = runLengths([[5, 0, 0], [1, 2, 3]], (value) => value === 0);
    expect(terminal.runs).toEqual([2]);
    expect(terminal.longestPerSession).toEqual([2, 0]);

    // Wilson intervals are bounded and widen as the sample shrinks.
    const wide = wilson95(1, 2)!;
    const narrow = wilson95(500, 1000)!;
    expect(wide[0]).toBeLessThan(narrow[0]);
    expect(wide[1]).toBeGreaterThan(narrow[1]);
    expect(wilson95(0, 0)).toBeNull();
  });

  it('reports exact house arithmetic and honest metadata labels', () => {
    const lossRun = runFixture(fixture('test-loss-100'), 2, 10_000, 'spec:house-loss');
    const lossReport: PolicyBankrollReport = lossRun.report;
    expect(lossReport.testOnly).toBe(true);
    expect(lossReport.activated).toBe(false);
    expect(lossReport.house.meanWagerPtsPerSession).toBe(100);
    expect(lossReport.house.meanPayoutPtsPerSession).toBe(0);
    expect(lossReport.house.meanNetPtsPerSession).toBe(100);
    expect(Number(lossReport.measured.houseEdgePercentExact)).toBe(100);
    expect(lossReport.measured.ledgerIdentityHolds).toBe(true);
    expect(lossReport.turnover.paidOnly).toBe(true);

    const breakEvenRun = runFixture(fixture('test-break-even-100'), 2, 500, 'spec:house-even');
    expect(breakEvenRun.report.house.meanNetPtsPerSession).toBe(0);
    expect(Number(breakEvenRun.report.measured.rtpPercentExact) + Number(breakEvenRun.report.measured.houseEdgePercentExact)).toBe(100);

    // The accepted dense profile is refused by the bounded index; the reference
    // is reported, never approximated.
    const dense = buildDistributionSupport(
      {
        profileId: FROZEN_RTP50_REFERENCE.profileId,
        profileHash: FROZEN_RTP50_REFERENCE.profileHash,
        payload: FROZEN_RTP50_REFERENCE.payload,
      },
      {
        ...fixture('test-loss-100').policy,
        policyId: 'lucky-lady.rtp50.reference',
        mathProfileId: FROZEN_RTP50_REFERENCE.profileId,
        mathProfileHash: FROZEN_RTP50_REFERENCE.profileHash,
        weights: { ...fixture('test-loss-100').policy.weights, LOSS: 0, SMALL: 10_000 },
      },
      { maxBoards: 4_096 },
    );
    expect(dense.ok).toBe(false);
    if (!dense.ok) {
      // The accepted dense profile cannot be indexed inside the bound, and the
      // refusal is recorded verbatim rather than approximated.
      expect(dense.reasons.map((entry) => entry.constraint)).toContain('DISTRIBUTION_SUPPORT_TOO_LARGE');
    }
  });
});

/**
 * Conditional checkpoint balance populations.
 *
 * The survivor-only population is exactly the sessions that reached checkpoint
 * N (resolved at least N paid spins). The unconditional population keeps every
 * session with early ruin represented as 0. The two are reported separately and
 * never mixed, and the survivor-only sample reconciles with the accepted
 * Alive@N / Ruin@N block.
 */

const requiredCheckpoints = [100, 250, 500, 1000, 2500, 5000, 10_000] as const;

const checkpointConfig = (horizonPaidSpins: number): SessionConfig => ({
  ...defaultSessionConfig(),
  horizonPaidSpins,
  aliveCheckpoints: [...requiredCheckpoints],
  balanceCheckpoints: [...requiredCheckpoints],
  ruinCheckpoints: [100, 250, 500, 1000, 2500, 5000],
});

const runFixtureWithConfig = (
  entry: PolicyFixture,
  sessions: number,
  config: SessionConfig,
  seedPrefix: string,
) => {
  const support = supportFor(entry);
  return runPolicyBankroll({
    gameId: 'lucky-lady',
    policy: entry.policy,
    support,
    config,
    sessions,
    seedPrefix,
    sessionSourceFactory: luckyLadyPolicySessionFactory({ support, payload: entry.payload, config, rules, engine }),
  });
};

/** The documented reconciliation identity, checked at every configured checkpoint. */
const checkReconciliation = (report: PolicyBankrollReport, checkpoints: readonly number[]) => {
  for (const checkpoint of checkpoints) {
    const key = String(checkpoint);
    const point = report.balance[key];
    expect(point).toBeDefined();
    expect(point.label).toBe(`Balance @${checkpoint} | survivors only`);
    expect(point.conditionalSampleSize).toBe(point.reachedCheckpoint);
    // Reach is its own population event: every reached session either could still
    // fund the next stake (`Alive@N`, which means funds N+1) or resolved exactly
    // N and could not (the exact-checkpoint ruin the accepted Ruin@N block counts).
    expect(point.reachedCheckpoint).toBe(point.aliveAtCheckpoint + point.exactCheckpointRuin);
    const survival = report.survival[key];
    if (survival) expect(point.aliveAtCheckpoint).toBe(survival.alive);
    const unconditional = report.unconditionalBalance[key];
    expect(unconditional).toBeDefined();
    expect(unconditional.label).toBe(`Balance @${checkpoint} | all sessions, ruin=0`);
    if (point.beyondHorizon) {
      expect(point.survivalRate).toBeNull();
      expect(point.aliveRate).toBeNull();
      expect(point.conditionalSampleSize).toBe(0);
      expect(point.mean).toBeNull();
      expect(unconditional.observed).toBe(0);
      expect(unconditional.mean).toBeNull();
    } else {
      expect(point.survivalRate).toBeCloseTo(point.reachedCheckpoint / point.totalSessions, 12);
      expect(point.survivalRate).toBeCloseTo(
        (point.aliveAtCheckpoint + point.exactCheckpointRuin) / point.totalSessions,
        12,
      );
      if (survival && survival.rate !== null && survival.observed > 0) {
        // The exact rate identity against the accepted survival entry: the reach
        // probability is the accepted Alive@N rate plus the exact-boundary mass.
        expect(point.aliveRate).toBe(survival.rate);
        expect(point.survivalRateDenominator).toBe(survival.observed);
        expect(point.survivalRate).toBeCloseTo(
          survival.rate + point.exactCheckpointRuin / survival.observed,
          12,
        );
      } else {
        // A balance-only checkpoint falls back to the shared authoritative counts.
        expect(point.aliveRate).toBeNull();
        expect(point.survivalRateDenominator).toBe(point.totalSessions);
      }
      expect(unconditional.observed).toBe(point.totalSessions);
      expect(unconditional.zeroRepresented).toBe(point.totalSessions - point.reachedCheckpoint);
    }
  }
};

/** A minimal one-class support so a synthetic cohort can drive the real module. */
const syntheticPolicy: DistributionPolicy = {
  policyId: 'synthetic.checkpoint-balance',
  version: 1,
  gameId: 'lucky-lady',
  mathProfileId: 'synthetic.checkpoint-balance',
  mathProfileHash: 'synthetic.checkpoint-balance',
  maxWinScope: 'RESOLVED_SPIN',
  maxWinMultiplier: 50,
  granularity: 1,
  maxBandMin: 20,
  weights: {
    LOSS: 1,
    PARTIAL_LOW: 0,
    PARTIAL_HIGH: 0,
    BREAK_EVEN: 0,
    SMALL: 0,
    MEDIUM: 0,
    BIG: 0,
    MAX: 0,
    FEATURE_TRIGGER: 0,
  },
};

const syntheticSupport = (): PolicySupportView => ({
  policy: syntheticPolicy,
  reachableBoards: 1,
  totalBoardMass: 1n,
  ev: { numerator: 0n, denominator: 1n },
  classes: [
    {
      class: 'LOSS',
      members: 1,
      boardMass: 1n,
      probabilityExact: '1',
      conditionalEv: { numerator: 0n, denominator: 1n },
    },
  ],
  maxWin: { paidSpinMax: 0, freeSpinMax: 0, resolvedSpinMax: 0 },
});

/** One fixed per-round return per session, in call order; the observer is unused. */
const syntheticSourceFactory = (
  perSessionReturn: readonly number[],
): ((seed: string, observer: PolicySessionObserver) => SessionOutcomeSource) => {
  let call = 0;
  return () => {
    const returnUnits = perSessionReturn[call % perSessionReturn.length];
    call += 1;
    return {
      drawPaidRound: () => ({
        returnUnits,
        featureReturnUnits: 0,
        paidSpins: 1,
        freeSpins: 0,
        totalResolvedSpins: 1,
        featureTriggered: false,
        retriggered: false,
      }),
    };
  };
};

describe('conditional checkpoint balance (survivors only vs ruin=0)', () => {
  it('LOSS100: 80/50/0 PTS at 100/250/500, all reach 500, none fund 501', () => {
    const entry = fixture('test-loss-100');
    const run = runFixtureWithConfig(entry, 3, checkpointConfig(10_000), 'spec:conditional-loss-100');
    const { report } = run;

    for (const [checkpoint, expectedUnits] of [[100, 8_000], [250, 5_000], [500, 0]] as const) {
      const point = report.balance[String(checkpoint)];
      expect(point.reachedCheckpoint).toBe(3);
      expect(point.excludedRuinedBeforeCheckpoint).toBe(0);
      expect(point.mean).toBe(expectedUnits);
      expect(point.median).toBe(expectedUnits);
      expect(point.p10).toBe(expectedUnits);
      expect(point.p25).toBe(expectedUnits);
      expect(point.p75).toBe(expectedUnits);
      expect(point.p90).toBe(expectedUnits);
      expect(point.p95).toBe(expectedUnits);
    }

    // Every session resolved exactly 500 paid spins and could not fund spin 501:
    // it reached 500 (survivor-only balance is 0), is not Alive@500, and is an
    // exact-checkpoint ruin the accepted Ruin@500 block counts.
    const at500 = report.balance['500'];
    expect(at500.meanExact).toBe('0');
    expect(at500.reachedCheckpoint).toBe(3);
    expect(at500.aliveAtCheckpoint).toBe(0);
    expect(at500.exactCheckpointRuin).toBe(3);
    expect(report.ruin['500'].ruined).toBe(3);
    // The reach rate is NOT the accepted Alive@N rate: reach = alive + exact
    // boundary mass, i.e. 0% + 3/3 = 100%, while Alive@500 is 0%.
    expect(report.survival['500'].rate).toBe(0);
    expect(at500.aliveRate).toBe(0);
    expect(at500.survivalRateDenominator).toBe(3);
    expect(at500.survivalRate).toBeCloseTo(
      (report.survival['500'].rate as number) + at500.exactCheckpointRuin / at500.survivalRateDenominator,
      12,
    );
    expect(at500.survivalRate).toBe(1);
    expect(run.records.every((record) => record.paidSpins === 500)).toBe(true);

    // No survivor at or beyond 1000: null summaries, never a fabricated zero.
    for (const checkpoint of [1000, 2500, 5000, 10_000]) {
      const point = report.balance[String(checkpoint)];
      expect(point.reachedCheckpoint).toBe(0);
      expect(point.excludedRuinedBeforeCheckpoint).toBe(3);
      expect(point.mean).toBeNull();
      expect(point.median).toBeNull();
      expect(point.p10).toBeNull();
      expect(point.p95).toBeNull();
      // The unconditional population keeps all three, each represented as 0.
      const unconditional = report.unconditionalBalance[String(checkpoint)];
      expect(unconditional.observed).toBe(3);
      expect(unconditional.zeroRepresented).toBe(3);
      expect(unconditional.mean).toBe(0);
    }
    checkReconciliation(report, requiredCheckpoints);
  });

  it('BREAK_EVEN100: 100 PTS at every checkpoint up to the horizon', () => {
    const entry = fixture('test-break-even-100');
    const run = runFixtureWithConfig(entry, 2, checkpointConfig(10_000), 'spec:conditional-break-even-100');
    const { report } = run;
    for (const checkpoint of requiredCheckpoints) {
      const point = report.balance[String(checkpoint)];
      expect(point.reachedCheckpoint).toBe(2);
      expect(point.survivalRate).toBe(1);
      expect(point.mean).toBe(10_000);
      expect(point.median).toBe(10_000);
      expect(point.meanExact).toBe('10000');
      expect(point.p10).toBe(10_000);
      expect(point.p95).toBe(10_000);
      const unconditional = report.unconditionalBalance[String(checkpoint)];
      expect(unconditional.zeroRepresented).toBe(0);
      expect(unconditional.mean).toBe(10_000);
    }
    checkReconciliation(report, requiredCheckpoints);
  });

  it('excludes early ruin, includes exact-checkpoint ruin, and separates the populations', () => {
    const config: SessionConfig = {
      startUnits: 1_000,
      stakeUnits: 20,
      horizonPaidSpins: 60,
      aliveCheckpoints: [20, 50, 60, 80],
      balanceCheckpoints: [20, 50, 60, 80],
      ruinCheckpoints: [20, 50, 60],
      reachTargets: [],
      fallTargets: [],
    };
    // Four deterministic sessions: two LOSS-only (bust after exactly 50 paid
    // spins), one 2x winner that grows, one break-even that stays flat.
    const run = runPolicyBankroll({
      gameId: 'lucky-lady',
      policy: syntheticPolicy,
      support: syntheticSupport(),
      config,
      sessions: 4,
      seedPrefix: 'spec:conditional-synthetic',
      sessionSourceFactory: syntheticSourceFactory([0, 40, 20, 0]),
    });
    const { report } = run;

    // At 20 every session has reached; the two populations coincide.
    const at20 = report.balance['20'];
    expect(at20.reachedCheckpoint).toBe(4);
    expect(at20.excludedRuinedBeforeCheckpoint).toBe(0);
    expect(at20.mean).toBe(900);
    expect(report.unconditionalBalance['20'].mean).toBe(900);

    // At 50 the two losers resolved exactly 50 paid spins and then could not
    // fund spin 51: they reached 50 (included in the survivor-only balance) and
    // are an exact-checkpoint ruin.
    const at50 = report.balance['50'];
    expect(at50.reachedCheckpoint).toBe(4);
    expect(at50.exactCheckpointRuin).toBe(2);
    expect(at50.aliveAtCheckpoint).toBe(2);
    expect(at50.excludedRuinedBeforeCheckpoint).toBe(0);
    expect(at50.mean).toBe(750);
    expect(report.ruin['50'].ruined).toBe(2);
    expect(run.records.filter((record) => record.paidSpins === 50).length).toBe(2);

    // At 60 the two losers are excluded from the survivor-only population and
    // kept, represented as 0, in the unconditional one. The survivor-only
    // population is [1000, 2200]; the unconditional population is [0, 0, 1000, 2200].
    // Every requested statistic is asserted against that exact survivor sample,
    // so a polluted quantile (or mean/median) would fail.
    const at60 = report.balance['60'];
    expect(at60.reachedCheckpoint).toBe(2);
    expect(at60.excludedRuinedBeforeCheckpoint).toBe(2);
    expect(at60.mean).toBe(1_600);
    expect(at60.median).toBe(1_600); // median == P50
    expect(at60.p10).toBe(1_120);
    expect(at60.p25).toBe(1_300);
    expect(at60.p75).toBe(1_900);
    expect(at60.p90).toBe(2_080);
    expect(at60.p95).toBe(2_140);
    const uncond60 = report.unconditionalBalance['60'];
    expect(uncond60.observed).toBe(4);
    expect(uncond60.zeroRepresented).toBe(2);
    expect(uncond60.mean).toBe(800);
    expect(uncond60.median).toBe(500);
    expect(uncond60.p10).toBe(0);
    expect(uncond60.p25).toBe(0);
    expect(uncond60.p75).toBe(1_300);
    expect(uncond60.p90).toBe(1_840);
    expect(uncond60.p95).toBe(2_020);
    expect(at60.mean).not.toBe(uncond60.mean);
    expect(at60.median).not.toBe(uncond60.median);
    expect(at60.p10).not.toBe(uncond60.p10);
    expect(at60.p25).not.toBe(uncond60.p25);
    expect(at60.p75).not.toBe(uncond60.p75);
    expect(at60.p90).not.toBe(uncond60.p90);
    expect(at60.p95).not.toBe(uncond60.p95);

    // The two horizon-censored sessions keep their real balance at the horizon;
    // a checkpoint beyond the horizon is unobserved, not a claimed zero.
    expect(run.records.filter((record) => record.censored).length).toBe(2);
    const at80 = report.balance['80'];
    expect(at80.beyondHorizon).toBe(true);
    expect(at80.reachedCheckpoint).toBe(0);
    expect(at80.conditionalSampleSize).toBe(0);
    expect(at80.survivalRate).toBeNull();
    expect(at80.mean).toBeNull();
    expect(report.unconditionalBalance['80'].observed).toBe(0);
    expect(report.unconditionalBalance['80'].mean).toBeNull();

    checkReconciliation(report, [20, 50, 60]);
  });

  it('represents early ruin as 0 while the exact-checkpoint balance keeps its nonzero dust', () => {
    const config: SessionConfig = {
      startUnits: 100,
      stakeUnits: 20,
      horizonPaidSpins: 20,
      aliveCheckpoints: [9, 12],
      balanceCheckpoints: [9, 12],
      ruinCheckpoints: [9, 12],
      reachTargets: [],
      fallTargets: [],
    };
    // Two sessions return 10 units on a 20-unit stake: they bust after exactly 9
    // paid spins with 10 units of terminal dust (nonzero). One session returns
    // the 20-unit stake exactly and censors at the horizon with 100 units intact.
    const run = runPolicyBankroll({
      gameId: 'lucky-lady',
      policy: syntheticPolicy,
      support: syntheticSupport(),
      config,
      sessions: 3,
      seedPrefix: 'spec:conditional-dust',
      sessionSourceFactory: syntheticSourceFactory([10, 10, 20]),
    });
    const { report } = run;

    const busted = run.records.filter((record) => record.busted);
    expect(busted.length).toBe(2);
    for (const record of busted) {
      expect(record.paidSpins).toBe(9);
      expect(record.endingUnitsExact).toBe('10'); // nonzero terminal dust
    }

    // At 9 the two dusted sessions resolved exactly 9 paid spins: they reached 9,
    // so the exact-checkpoint balance keeps their real (nonzero) dust.
    const at9 = report.balance['9'];
    expect(at9.reachedCheckpoint).toBe(3);
    expect(at9.exactCheckpointRuin).toBe(2);
    expect(at9.aliveAtCheckpoint).toBe(1);
    expect(at9.excludedRuinedBeforeCheckpoint).toBe(0);
    // [10, 10, 100]: the dust is retained, never flattened to zero.
    expect(at9.meanExact).toBe('40');
    expect(at9.mean).toBe(40);
    expect(at9.median).toBe(10);

    // At 12 the two dusted sessions are strictly early ruin: the survivor-only
    // population is only the break-even session, while the unconditional
    // population represents each early-ruined session as 0 (NOT its 10 dust).
    const at12 = report.balance['12'];
    expect(at12.reachedCheckpoint).toBe(1);
    expect(at12.excludedRuinedBeforeCheckpoint).toBe(2);
    expect(at12.exactCheckpointRuin).toBe(0);
    expect(at12.meanExact).toBe('100');
    expect(at12.mean).toBe(100);
    expect(at12.median).toBe(100);

    const uncond12 = report.unconditionalBalance['12'];
    expect(uncond12.observed).toBe(3);
    expect(uncond12.zeroRepresented).toBe(2);
    expect(uncond12.mean).toBeCloseTo(100 / 3, 12);
    // If the implementation carried dust, the mean would be (100 + 10 + 10)/3 = 40.
    expect(uncond12.mean).not.toBeCloseTo(40, 12);
    expect(uncond12.median).toBe(0);
    expect(uncond12.p10).toBe(0);
    expect(uncond12.p25).toBe(0);
    expect(uncond12.p75).toBe(50);
    expect(uncond12.p90).toBe(80);
    expect(uncond12.p95).toBe(90);

    checkReconciliation(report, [9, 12]);
  });

  it('labels every balance without an ambiguous Balance@N and reconciles the renderer', () => {
    const run = runFixtureWithConfig(fixture('test-retention'), 3, checkpointConfig(1_200), 'spec:conditional-labels');
    const markdown = renderPolicyBankrollMarkdown(run.report);
    expect(markdown).toContain('Balance @N | survivors only');
    expect(markdown).toContain('Balance @N | all sessions, ruin=0');
    expect(markdown).toContain('median (P50)');
    expect(markdown).toContain('reach rate = Alive@N rate + exact checkpoint ruin / Alive@N observed');
    expect(markdown).not.toMatch(/Balance@\d/);
    for (const [key, point] of Object.entries(run.report.balance)) {
      expect(point.label).toBe(`Balance @${key} | survivors only`);
      expect(run.report.unconditionalBalance[key].label).toBe(`Balance @${key} | all sessions, ruin=0`);
    }
    checkReconciliation(run.report, [100, 250, 500, 1000]);
  });
});
