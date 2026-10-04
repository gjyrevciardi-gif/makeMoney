import {
  canonicalJson,
  multiplierToUnits,
  percentile,
  sha256Hex,
  summarize,
  summarizeExact,
} from './math-control.analytics';
import { simulateCohort } from './math-control.bankroll';
import { cohortSeeds } from './math-control.random';
import {
  bigRational,
  bigRationalToDecimalString,
  bigRationalToPresentationNumber,
} from './math-control.rational';
import {
  DISTRIBUTION_CLASSES,
  distributionPolicyHash,
  type DistributionClass,
  type DistributionPolicy,
} from './payout-distribution';
import type {
  BankrollReport,
  QuantileSummary,
  QuantileSummaryExact,
  SessionConfig,
  SessionOutcomeSource,
  SessionRecord,
} from './math-control.types';

/**
 * Offline payout-policy bankroll bridge.
 *
 * This module does not simulate anything itself: it drives the *accepted*
 * `simulateCohort`/`simulateSession` accounting with a game-provided
 * `SessionOutcomeSource` that selects a payout class from a policy's exact
 * weights and then executes a real reachable board through the game's own
 * mathematics. Around that accepted loop it observes the resolved rounds the
 * source actually produced and aggregates the paid-event, dry-spell,
 * class-frequency and per-spin-maximum statistics the policy report promises.
 *
 * Nothing here is production: reports are stamped `testOnly`/`activated:false`,
 * the selector stream is a deterministic simulation stream, and the production
 * runtime keeps its OS CSPRNG and its own envelope.
 */

/** One paid round, exactly as the game resolved it. */
export type PolicyRoundObservation = {
  /** 0-based paid-round index inside its session. */
  index: number;
  selectedClass: DistributionClass;
  /** Class derived from the native paid evaluation under the same bounds. */
  nativeClass: DistributionClass;
  nativeScatterCount: number;
  /** The reel stops the paid board was forced to (real reachable board). */
  stops: number[];
  /** Simulation units returned by the initial paid resolution alone. */
  paidUnits: number;
  /** Simulation units returned by the complete paid round (feature included). */
  returnUnits: number;
  /** Simulation units produced by free spins inside this round. */
  featureUnits: number;
  /** Largest single free-spin payout inside this round, in simulation units. */
  maxFreeSpinUnits: number;
  freeSpins: number;
  totalResolvedSpins: number;
  featureTriggered: boolean;
  retriggered: boolean;
};

/**
 * The structural view of a game's proved distribution support that this report
 * needs. The game's own `DistributionSupport` satisfies it, so the shared module
 * stays free of any game import.
 */
export type PolicySupportView = {
  policy: DistributionPolicy;
  reachableBoards: number;
  totalBoardMass: bigint;
  ev: { numerator: bigint; denominator: bigint };
  classes: ReadonlyArray<{
    class: DistributionClass;
    members: number;
    boardMass: bigint;
    probabilityExact: string;
    conditionalEv: { numerator: bigint; denominator: bigint } | null;
  }>;
  maxWin: { paidSpinMax: number; freeSpinMax: number; resolvedSpinMax: number };
};

export type PolicySessionObserver = {
  onPaidRound: (observation: PolicyRoundObservation) => void;
};

export type PolicySessionSourceFactory = (
  seed: string,
  observer: PolicySessionObserver,
) => SessionOutcomeSource;

export type PolicyClassStat = {
  class: DistributionClass;
  configuredWeight: number;
  configuredPercent: number;
  observedCount: number;
  observedPercent: number;
  deviationPercent: number;
  /** Binomial standard error of the observed share under the configured weight. */
  binomialStandardErrorPercent: number;
  /** Deviation in standard errors; |z| > 3 is flagged, not a formal test. */
  zDeviation: number | null;
  outsideThreeSigma: boolean;
  supportMembers: number;
  supportBoardMass: string;
  probabilityExact: string;
  conditionalEvExact: string | null;
};

export type DrySpellStat = {
  definition: string;
  runs: number;
  /** Pooled mean over runs; the denominator is the run count below. */
  meanRunLength: number | null;
  /** `runs` - the pooled mean divides the summed run lengths by run count. */
  meanRunLengthDenominator: number;
  /** Quantiles of the *longest* run inside each session (mean/P50/P75/P90/P95). */
  longestPerSession: QuantileSummary;
  /** P99 of the longest run inside each session (QuantileSummary stops at P95). */
  longestPerSessionP99: number | null;
  /** Quantiles over every run, terminal run included. */
  pooledRuns: QuantileSummary;
  pooledP99: number | null;
  terminalStreakIncluded: true;
};

export type PolicyBankrollReport = {
  testOnly: boolean;
  activated: false;
  gameId: string;
  policyId: string;
  policyHash: string;
  policyVersion: number;
  mathProfileId: string;
  mathProfileHash: string;
  runId: string;
  generatedAt: string;
  scope: { maxWinScope: string; maxWinMultiplier: number; maxBandMin: number; granularity: number };
  weights: Record<DistributionClass, number>;
  expected: {
    basis: string;
    evExact: string;
    rtpPercentExact: string;
    rtpPercent: number | null;
  };
  measured: {
    paidWagerUnitsExact: string;
    returnedUnitsExact: string;
    closingUnitsExact: string;
    openingUnitsExact: string;
    ledgerIdentityHolds: boolean;
    rtpPercentExact: string;
    rtpPercent: number | null;
    /** Normal-approximation standard error of the per-round mean return. */
    rtpStandardErrorPercent: number | null;
    rtp95IntervalPercent: [number, number] | null;
    houseEdgePercentExact: string;
    houseEdgePercent: number | null;
  };
  classes: PolicyClassStat[];
  classesOutsideThreeSigma: number;
  paidEvents: {
    paidRounds: number;
    paidStakeUnits: number;
    fullLoss: EventRate;
    hit: EventRate;
    profitable: EventRate;
    partial: EventRate;
    breakEven: EventRate;
    nonProfitable: EventRate;
    featureTriggered: EventRate;
    retriggered: EventRate;
    triggerPaidPayoutUnits: QuantileSummaryExact;
    nativeClassMismatches: number;
  };
  spins: {
    paidSpinsTotal: number;
    freeSpinsTotal: number;
    resolvedSpinsTotal: number;
    perSessionPaidSpins: QuantileSummary;
    perSessionPaidSpinsExact: QuantileSummaryExact;
  };
  survival: Record<string, SurvivalPoint>;
  turnover: {
    paidOnly: true;
    perSessionUnits: QuantileSummaryExact;
    perSessionPts: QuantileSummaryExact;
    totalUnitsExact: string;
    totalPtsExact: string;
  };
  house: {
    meanWagerUnitsPerSession: number;
    meanWagerPtsPerSession: number;
    meanPayoutUnitsPerSession: number;
    meanPayoutPtsPerSession: number;
    meanNetUnitsPerSession: number;
    meanNetPtsPerSession: number;
    netPerSessionExact: QuantileSummaryExact;
  };
  /** Survivor-only checkpoint balance: `Balance @N | survivors only`. */
  balance: Record<string, ConditionalBalancePoint>;
  /** Unconditional checkpoint balance with early ruin represented as 0: `Balance @N | all sessions, ruin=0`. */
  unconditionalBalance: Record<string, UnconditionalBalancePoint>;
  reach: Record<string, number>;
  fallBelow: Record<string, number>;
  ruin: Record<string, RuinPoint>;
  drySpells: { fullLoss: DrySpellStat; nonProfitable: DrySpellStat };
  drawdown: QuantileSummary & { exact: QuantileSummaryExact; units: 'simulation centi-points' };
  maxObserved: {
    paidSpinUnits: number;
    paidSpinUnitsExact: string;
    freeSpinUnits: number;
    freeSpinUnitsExact: string;
    featureAggregateUnits: number;
    featureAggregateUnitsExact: string;
    capUnits: number;
    capUnitsExact: string;
    paidSpinWithinCap: boolean;
    freeSpinWithinCap: boolean;
    featureAggregateExceedsCap: boolean;
  };
  support: {
    reachableBoards: number;
    totalBoardMass: string;
    maxWin: { paidSpinMax: number; freeSpinMax: number; resolvedSpinMax: number };
  };
  sample: {
    sessions: number;
    /** The complete session configuration this run used. */
    config: SessionConfig;
    horizonPaidSpins: number;
    censoredCount: number;
    ruinedCount: number;
    actualPaidRounds: number;
    actualFreeSpins: number;
    actualResolvedSpins: number;
    seedPrefix: string;
    seedFirst: string;
    seedLast: string;
    denomination: string;
  };
  limitations: string[];
};

export type EventRate = {
  count: number;
  denominator: number;
  rate: number;
  wilson95: [number, number] | null;
};

export type SurvivalPoint = {
  checkpoint: number;
  observed: number;
  alive: number;
  rate: number | null;
  wilson95: [number, number] | null;
};

/** Exact-plus-mirror quantile presentation shared by both balance populations. */
export type BalanceQuantiles = {
  meanExact: string | null;
  medianExact: string | null;
  p10Exact: string | null;
  p25Exact: string | null;
  p75Exact: string | null;
  p90Exact: string | null;
  p95Exact: string | null;
  mean: number | null;
  median: number | null;
  p10: number | null;
  p25: number | null;
  p75: number | null;
  p90: number | null;
  p95: number | null;
};

/**
 * Survivor-only checkpoint balance.
 *
 * The eligible population is exactly the sessions that REACHED checkpoint N:
 * records whose authoritative `paidSpins >= N` ("resolved at least N paid
 * spins"). This is a different event from the accepted `Alive@N`, which means
 * "could fund the next paid stake after N completed paid spins": a session that
 * resolved exactly N paid spins and then could not fund spin N+1 is INCLUDED
 * here (it reached N) while `Alive@N` is false and `ruinBy[N]` counts it as
 * ruined. The two are never claimed to be the same predicate. The accepted
 * `Alive@N`/`Ruin@N` calculations are unchanged; the exact reconciliation is
 * `reachedCheckpoint = Alive@N + exactCheckpointRuin`.
 */
export type ConditionalBalancePoint = BalanceQuantiles & {
  checkpoint: number;
  /** Mandated label: `Balance @N | survivors only`. */
  label: string;
  totalSessions: number;
  /** Sessions that resolved at least N paid spins. */
  reachedCheckpoint: number;
  /**
   * `(Alive@N + exactCheckpointRuin) / Alive@N denominator`, i.e. the reach
   * probability. For an observed checkpoint this is exactly
   * `survival[N].rate + exactCheckpointRuin / totalSessions`; `null` when the
   * checkpoint is beyond the horizon (unobserved).
   */
  survivalRate: number | null;
  /** Alias of `reachedCheckpoint`: the survivor-only population size. */
  conditionalSampleSize: number;
  /** Sessions ruined strictly before N; excluded from these statistics. */
  excludedRuinedBeforeCheckpoint: number;
  /** Sessions that resolved exactly N and then could not fund N+1; included here. */
  exactCheckpointRuin: number;
  /** The accepted `Alive@N` count (could fund N+1); unchanged accepted calculation. */
  aliveAtCheckpoint: number;
  /** The accepted `survival[N].rate` (`alive / observed`), or `null` when N is not an alive checkpoint. */
  aliveRate: number | null;
  /** Denominator the accepted `Alive@N` rate used (`survival[N].observed`), or the session count when N is a balance-only checkpoint. */
  survivalRateDenominator: number;
  beyondHorizon: boolean;
};

/**
 * Unconditional / ruin-absorbed checkpoint balance.
 *
 * Every session is represented: a session that reached N contributes its real
 * balance, and a session ruined before N is represented as 0. This is kept
 * strictly separate from the survivor-only statistic and never mixed with it.
 */
export type UnconditionalBalancePoint = BalanceQuantiles & {
  checkpoint: number;
  /** Mandated label: `Balance @N | all sessions, ruin=0`. */
  label: string;
  totalSessions: number;
  /** Sessions represented: the reached sessions plus the zeros below. */
  observed: number;
  /** Sessions ruined before N represented as 0. */
  zeroRepresented: number;
  beyondHorizon: boolean;
};

/** The mandated human label for a survivor-only checkpoint balance. */
export const survivorsOnlyBalanceLabel = (checkpoint: number): string =>
  `Balance @${checkpoint} | survivors only`;

/** The mandated human label for an all-sessions ruin=0 checkpoint balance. */
export const allSessionsRuinZeroBalanceLabel = (checkpoint: number): string =>
  `Balance @${checkpoint} | all sessions, ruin=0`;

function balanceQuantiles(summary: QuantileSummaryExact | undefined): BalanceQuantiles {
  return {
    meanExact: summary?.meanExact ?? null,
    medianExact: summary?.medianExact ?? null,
    p10Exact: summary?.p10Exact ?? null,
    p25Exact: summary?.p25Exact ?? null,
    p75Exact: summary?.p75Exact ?? null,
    p90Exact: summary?.p90Exact ?? null,
    p95Exact: summary?.p95Exact ?? null,
    mean: summary?.mean ?? null,
    median: summary?.median ?? null,
    p10: summary?.p10 ?? null,
    p25: summary?.p25 ?? null,
    p75: summary?.p75 ?? null,
    p90: summary?.p90 ?? null,
    p95: summary?.p95 ?? null,
  };
}

export type RuinPoint = {
  checkpoint: number;
  observed: number;
  ruined: number | null;
  rate: number | null;
  beyondHorizon: boolean;
};

export type PolicyBankrollInput = {
  gameId: string;
  policy: DistributionPolicy;
  support: PolicySupportView;
  config: SessionConfig;
  sessions: number;
  seedPrefix: string;
  sessionSourceFactory: PolicySessionSourceFactory;
  /** Fixed timestamp for reproducible artifacts; defaults to the wall clock. */
  generatedAt?: string;
};

export type PolicyBankrollRun = {
  report: PolicyBankrollReport;
  bankroll: BankrollReport;
  records: SessionRecord[];
  observations: PolicyRoundObservation[][];
};

/** Wilson score interval at 95%, used for every session proportion. */
export function wilson95(successes: number, total: number): [number, number] | null {
  if (!Number.isFinite(successes) || !Number.isFinite(total) || total <= 0) return null;
  const z = 1.959963984540054;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const half =
    (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denominator;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

const eventRate = (count: number, denominator: number): EventRate => ({
  count,
  denominator,
  rate: denominator === 0 ? 0 : count / denominator,
  wilson95: wilson95(count, denominator),
});

/** Consecutive-run lengths of a predicate over each session, terminal run included. */
export function runLengths(
  perSessionValues: ReadonlyArray<readonly number[]>,
  predicate: (value: number) => boolean,
): { runs: number[]; longestPerSession: number[] } {
  const runs: number[] = [];
  const longestPerSession: number[] = [];
  for (const session of perSessionValues) {
    let current = 0;
    let longest = 0;
    for (const value of session) {
      if (predicate(value)) {
        current += 1;
        if (current > longest) longest = current;
      } else if (current > 0) {
        runs.push(current);
        current = 0;
      }
    }
    // The streak the session ended on is a real observed streak.
    if (current > 0) runs.push(current);
    longestPerSession.push(longest);
  }
  return { runs, longestPerSession };
}

function summarizeWithP99(values: readonly number[]): { summary: QuantileSummary; p99: number | null } {
  if (values.length === 0) return { summary: summarize(values), p99: null };
  const sorted = [...values].sort((a, b) => a - b);
  return { summary: summarize(sorted), p99: percentile(sorted, 0.99) };
}

export function drySpellStat(
  perSessionPaidUnits: ReadonlyArray<readonly number[]>,
  predicate: (value: number) => boolean,
  definition: string,
): DrySpellStat {
  const { runs, longestPerSession } = runLengths(perSessionPaidUnits, predicate);
  const pooled = summarizeWithP99(runs);
  const longest = summarizeWithP99(longestPerSession);
  return {
    definition,
    runs: runs.length,
    meanRunLength: runs.length === 0 ? null : runs.reduce((sum, value) => sum + value, 0) / runs.length,
    meanRunLengthDenominator: runs.length,
    longestPerSession: longest.summary,
    longestPerSessionP99: longest.p99,
    pooledRuns: pooled.summary,
    pooledP99: pooled.p99,
    terminalStreakIncluded: true,
  };
}

export function runPolicyBankroll(input: PolicyBankrollInput): PolicyBankrollRun {
  const { policy, support, config, sessions, seedPrefix, sessionSourceFactory } = input;
  if (!Number.isSafeInteger(sessions) || sessions <= 0) throw new Error('POLICY_BANKROLL_SESSIONS_INVALID');
  const paidStakeUnits = config.stakeUnits;
  // Exact cap conversion *before* any session runs: a fractional ceiling whose
  // product with the paid stake is not a whole number of simulation units is
  // refused, never rounded up into a permissive bound.
  let capUnits: number;
  try {
    capUnits = multiplierToUnits(policy.maxWinMultiplier, paidStakeUnits);
  } catch (error) {
    throw new Error(`POLICY_BANKROLL_CAP_NOT_INTEGRAL: ${(error as Error).message}`);
  }
  if (!Number.isSafeInteger(capUnits) || capUnits <= 0) throw new Error('POLICY_BANKROLL_CAP_UNITS_INVALID');
  const seeds = cohortSeeds(seedPrefix, sessions);
  const observations: PolicyRoundObservation[][] = [];
  const { report: bankroll, records } = simulateCohort(
    (seed) => {
      const bucket: PolicyRoundObservation[] = [];
      observations.push(bucket);
      return sessionSourceFactory(seed, { onPaidRound: (observation) => bucket.push(observation) });
    },
    config,
    seeds,
  );

  const allRounds = observations.flat();
  const paidRounds = allRounds.length;

  const observedByClass = new Map<DistributionClass, number>();
  for (const name of DISTRIBUTION_CLASSES) observedByClass.set(name, 0);
  for (const round of allRounds) observedByClass.set(round.selectedClass, (observedByClass.get(round.selectedClass) ?? 0) + 1);

  const classes: PolicyClassStat[] = DISTRIBUTION_CLASSES.map((name) => {
    const configuredExpected = (policy.weights[name] ?? 0) / policy.granularity;
    const observedCount = observedByClass.get(name) ?? 0;
    const observedShare = paidRounds === 0 ? 0 : observedCount / paidRounds;
    const standardError = Math.sqrt((configuredExpected * (1 - configuredExpected)) / Math.max(1, paidRounds));
    const supportClass = support.classes.find((entry) => entry.class === name);
    const zDeviation = standardError === 0 ? null : (observedShare - configuredExpected) / standardError;
    return {
      class: name,
      configuredWeight: policy.weights[name] ?? 0,
      configuredPercent: configuredExpected * 100,
      observedCount,
      observedPercent: observedShare * 100,
      deviationPercent: (observedShare - configuredExpected) * 100,
      binomialStandardErrorPercent: standardError * 100,
      zDeviation,
      outsideThreeSigma: zDeviation !== null && Math.abs(zDeviation) > 3,
      supportMembers: supportClass?.members ?? 0,
      supportBoardMass: (supportClass?.boardMass ?? 0n).toString(),
      probabilityExact: supportClass?.probabilityExact ?? '0',
      conditionalEvExact: supportClass?.conditionalEv
        ? bigRationalToDecimalString(supportClass.conditionalEv, 10)
        : null,
    };
  });

  const paidUnitsPerSession = observations.map((bucket) => bucket.map((round) => round.paidUnits));
  const triggerPayouts = allRounds.filter((round) => round.selectedClass === 'FEATURE_TRIGGER').map((round) => BigInt(round.paidUnits));
  const nativeClassMismatches = allRounds.filter((round) => round.nativeClass !== round.selectedClass).length;
  const expectedEv = support.ev;
  const expectedRtp = bigRational(expectedEv.numerator * 100n, expectedEv.denominator);

  const turnoverTotal = BigInt(bankroll.totals.paidWagerUnitsExact);
  const returnedTotal = BigInt(bankroll.totals.returnedUnitsExact);
  const measuredRtp = turnoverTotal === 0n
    ? bigRational(0n, 1n)
    : bigRational(returnedTotal * 100n, turnoverTotal);
  const houseEdge = turnoverTotal === 0n
    ? bigRational(0n, 1n)
    : bigRational((turnoverTotal - returnedTotal) * 100n, turnoverTotal);

  const netPerSession = records.map((record) => BigInt(record.turnoverUnitsExact) - BigInt(record.returnedUnitsExact));
  const turnoverPerSession = records.map((record) => BigInt(record.turnoverUnitsExact));
  const sessionCount = records.length;
  const meanUnits = (values: readonly bigint[]) =>
    sessionCount === 0 ? 0 : Number(values.reduce((sum, value) => sum + value, 0n)) / sessionCount;

  // Standard error of the per-paid-round return: the RTP estimator is the mean
  // of the observed round returns divided by the stake. Normal approximation,
  // approximate for the heavy-tailed feature fixture; the count is reported.
  const roundReturns = allRounds.map((round) => round.returnUnits);
  const roundMean = roundReturns.length === 0
    ? 0
    : roundReturns.reduce((sum, value) => sum + value, 0) / roundReturns.length;
  const roundVariance = roundReturns.length < 2
    ? null
    : roundReturns.reduce((sum, value) => sum + (value - roundMean) ** 2, 0) / (roundReturns.length - 1);
  const standardErrorUnits = roundVariance === null ? null : Math.sqrt(roundVariance / roundReturns.length);
  const measuredRtpNumber = bigRationalToPresentationNumber(measuredRtp);
  const standardErrorPercent = standardErrorUnits === null
    ? null
    : (standardErrorUnits / paidStakeUnits) * 100;
  const rtp95IntervalPercent = standardErrorPercent === null || measuredRtpNumber === null
    ? null
    : [
        measuredRtpNumber - 1.959963984540054 * standardErrorPercent,
        measuredRtpNumber + 1.959963984540054 * standardErrorPercent,
      ] as [number, number];

  const survival: Record<string, SurvivalPoint> = {};
  for (const checkpoint of config.aliveCheckpoints) {
    const observed = records.filter((record) => record.aliveAtCheckpoint[String(checkpoint)] !== null).length;
    const alive = records.filter((record) => record.aliveAtCheckpoint[String(checkpoint)] === true).length;
    survival[String(checkpoint)] = {
      checkpoint,
      observed,
      alive,
      rate: observed === 0 ? null : alive / observed,
      wilson95: wilson95(alive, observed),
    };
  }

  // Checkpoint balances are derived from the authoritative session records and
  // reported twice, never mixed:
  //   - survivor-only: exactly the sessions that REACHED checkpoint N, i.e.
  //     resolved at least N paid spins (`paidSpins >= N`). A session that
  //     resolved exactly N and then could not fund N+1 is included; a session
  //     ruined before N is excluded.
  //   - unconditional / ruin=0: every session, with each session ruined before
  //     N represented as 0.
  // Reach is the population definition; the accepted `Alive@N` is the separate
  // next-stake fundability check and its calculation is left untouched. For an
  // observed checkpoint the exact identity is
  //   reached = Alive@N + (busted && paidSpins == N)
  // so the reach probability is exactly
  //   survival[N].rate + exactCheckpointRuin / survival[N].observed.
  // The rate below is derived from that accepted survival entry plus the
  // exact-boundary mass; a balance-only checkpoint (no accepted survival entry)
  // uses the shared authoritative session counts instead. No separate survival
  // calculation is introduced and no accepted field is modified.
  const stakeUnits = BigInt(config.stakeUnits);
  const balance: Record<string, ConditionalBalancePoint> = {};
  const unconditionalBalance: Record<string, UnconditionalBalancePoint> = {};
  for (const checkpoint of config.balanceCheckpoints) {
    const beyondHorizon = checkpoint > config.horizonPaidSpins;
    const key = String(checkpoint);
    const reachedRecords = records.filter((record) => record.paidSpins >= checkpoint);
    const survivorValues: bigint[] = [];
    for (const record of reachedRecords) {
      const held = record.balanceAtCheckpointExact[key];
      if (held === null || held === undefined) {
        // A reached session must carry its balance at N: the reach predicate and
        // the accepted checkpoint observation are the same event.
        throw new Error(`POLICY_BANKROLL_BALANCE_MISSING: reached checkpoint ${checkpoint} without a balance`);
      }
      survivorValues.push(BigInt(held));
    }
    const survivorSummary = summarizeExact(survivorValues);
    const excludedRuinedBeforeCheckpoint = records.filter(
      (record) => record.paidSpins < checkpoint && record.busted,
    ).length;
    const exactCheckpointRuin = records.filter(
      (record) => record.busted && record.paidSpins === checkpoint,
    ).length;
    // The accepted `Alive@N` rule, applied to the accepted balance observation:
    // a session is alive when the balance after N completed paid spins can fund
    // the next stake (`Alive@N` therefore means "funds N+1", not "reached N").
    const aliveAtCheckpoint = reachedRecords.filter(
      (record) => BigInt(record.balanceAtCheckpointExact[key] as string) >= stakeUnits,
    ).length;
    // Rate reconciliation: the accepted survival rate plus the exact-boundary
    // mass. `Alive@N` means "could fund N+1", so the reach probability adds back
    // the sessions that resolved exactly N and could not.
    const survivalEntry = survival[key];
    const survivalRateDenominator = survivalEntry ? survivalEntry.observed : records.length;
    const reachProbabilityNumerator = survivalEntry
      ? survivalEntry.alive + exactCheckpointRuin
      : reachedRecords.length;
    balance[key] = {
      checkpoint,
      label: survivorsOnlyBalanceLabel(checkpoint),
      totalSessions: records.length,
      reachedCheckpoint: reachedRecords.length,
      survivalRate:
        beyondHorizon || survivalRateDenominator === 0
          ? null
          : reachProbabilityNumerator / survivalRateDenominator,
      conditionalSampleSize: reachedRecords.length,
      excludedRuinedBeforeCheckpoint,
      exactCheckpointRuin,
      aliveAtCheckpoint,
      aliveRate: survivalEntry ? survivalEntry.rate : null,
      survivalRateDenominator,
      beyondHorizon,
      ...balanceQuantiles(survivorSummary),
    };

    // Unconditional: reached sessions keep their balance; sessions ruined before
    // N are represented as 0. Beyond the horizon nothing is observed, so the
    // population is empty rather than a claimed all-zero loss.
    const unconditionalValues: bigint[] = beyondHorizon
      ? []
      : records.map((record) =>
          record.paidSpins >= checkpoint ? BigInt(record.balanceAtCheckpointExact[key] as string) : 0n,
        );
    unconditionalBalance[key] = {
      checkpoint,
      label: allSessionsRuinZeroBalanceLabel(checkpoint),
      totalSessions: records.length,
      observed: unconditionalValues.length,
      zeroRepresented: beyondHorizon
        ? 0
        : records.filter((record) => record.paidSpins < checkpoint).length,
      beyondHorizon,
      ...balanceQuantiles(summarizeExact(unconditionalValues)),
    };
  }

  const ruin: Record<string, RuinPoint> = {};
  for (const checkpoint of config.ruinCheckpoints) {
    const beyondHorizon = checkpoint > config.horizonPaidSpins;
    const observed = records.filter((record) => record.ruinedBy[String(checkpoint)] !== null).length;
    const ruined = beyondHorizon
      ? null
      : records.filter((record) => record.ruinedBy[String(checkpoint)] === true).length;
    ruin[String(checkpoint)] = {
      checkpoint,
      observed,
      ruined,
      rate: ruined === null || observed === 0 ? null : ruined / observed,
      beyondHorizon,
    };
  }

  const maxPaid = allRounds.reduce((max, round) => (round.paidUnits > max ? round.paidUnits : max), 0);
  const maxFree = allRounds.reduce((max, round) => (round.maxFreeSpinUnits > max ? round.maxFreeSpinUnits : max), 0);
  const maxFeatureAggregate = allRounds.reduce(
    (max, round) => (round.featureUnits > max ? round.featureUnits : max),
    0,
  );

  const maxWinScope = policy.maxWinScope;
  const policyHash = distributionPolicyHash(policy);
  const report: PolicyBankrollReport = {
    testOnly: true,
    activated: false,
    gameId: input.gameId,
    policyId: policy.policyId,
    policyHash,
    policyVersion: policy.version,
    mathProfileId: policy.mathProfileId,
    mathProfileHash: policy.mathProfileHash,
    runId: sha256Hex(canonicalJson({
      policyId: policy.policyId,
      policyHash,
      mathProfileHash: policy.mathProfileHash,
      seedPrefix,
      sessions,
      config,
      reachableBoards: support.reachableBoards,
      totalBoardMass: support.totalBoardMass.toString(),
    })),
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    scope: {
      maxWinScope,
      maxWinMultiplier: policy.maxWinMultiplier,
      maxBandMin: policy.maxBandMin,
      granularity: policy.granularity,
    },
    weights: { ...policy.weights },
    expected: {
      basis:
        'exact expected return of the policy: class probabilities x each class\'s conditional expectation, computed from the policy\'s real reachable support',
      evExact: bigRationalToDecimalString(expectedEv, 10),
      rtpPercentExact: bigRationalToDecimalString(expectedRtp, 6),
      rtpPercent: bigRationalToPresentationNumber(expectedRtp),
    },
    measured: {
      paidWagerUnitsExact: bankroll.totals.paidWagerUnitsExact,
      returnedUnitsExact: bankroll.totals.returnedUnitsExact,
      closingUnitsExact: bankroll.totals.closingUnitsExact,
      openingUnitsExact: bankroll.totals.openingUnitsExact,
      ledgerIdentityHolds: bankroll.totals.ledgerIdentityHolds,
      rtpPercentExact: bigRationalToDecimalString(measuredRtp, 6),
      rtpPercent: measuredRtpNumber,
      rtpStandardErrorPercent: standardErrorPercent,
      rtp95IntervalPercent,
      houseEdgePercentExact: bigRationalToDecimalString(houseEdge, 6),
      houseEdgePercent: bigRationalToPresentationNumber(houseEdge),
    },
    classes,
    classesOutsideThreeSigma: classes.filter((entry) => entry.outsideThreeSigma).length,
    paidEvents: {
      paidRounds,
      paidStakeUnits,
      fullLoss: eventRate(allRounds.filter((round) => round.paidUnits === 0).length, paidRounds),
      hit: eventRate(allRounds.filter((round) => round.paidUnits > 0).length, paidRounds),
      profitable: eventRate(allRounds.filter((round) => round.paidUnits > paidStakeUnits).length, paidRounds),
      partial: eventRate(
        allRounds.filter((round) => round.paidUnits > 0 && round.paidUnits < paidStakeUnits).length,
        paidRounds,
      ),
      breakEven: eventRate(allRounds.filter((round) => round.paidUnits === paidStakeUnits).length, paidRounds),
      nonProfitable: eventRate(allRounds.filter((round) => round.paidUnits <= paidStakeUnits).length, paidRounds),
      featureTriggered: eventRate(allRounds.filter((round) => round.featureTriggered).length, paidRounds),
      retriggered: eventRate(allRounds.filter((round) => round.retriggered).length, paidRounds),
      triggerPaidPayoutUnits: summarizeExact(triggerPayouts),
      nativeClassMismatches,
    },
    spins: {
      paidSpinsTotal: bankroll.spinCounts.paidSpins,
      freeSpinsTotal: bankroll.spinCounts.freeSpins,
      resolvedSpinsTotal: bankroll.spinCounts.totalResolvedSpins,
      perSessionPaidSpins: bankroll.observedLengthPaidSpins,
      perSessionPaidSpinsExact: summarizeExact(records.map((record) => BigInt(record.paidSpins))),
    },
    survival,
    turnover: {
      paidOnly: true,
      perSessionUnits: summarizeExact(turnoverPerSession),
      perSessionPts: bankroll.turnoverPts,
      totalUnitsExact: bankroll.totals.paidWagerUnitsExact,
      totalPtsExact: bankroll.totals.turnoverPtsExact,
    },
    house: {
      meanWagerUnitsPerSession: meanUnits(turnoverPerSession),
      meanWagerPtsPerSession: meanUnits(turnoverPerSession) / 100,
      meanPayoutUnitsPerSession: meanUnits(records.map((record) => BigInt(record.returnedUnitsExact))),
      meanPayoutPtsPerSession: meanUnits(records.map((record) => BigInt(record.returnedUnitsExact))) / 100,
      meanNetUnitsPerSession: meanUnits(netPerSession),
      meanNetPtsPerSession: meanUnits(netPerSession) / 100,
      netPerSessionExact: summarizeExact(netPerSession),
    },
    balance,
    unconditionalBalance,
    reach: { ...bankroll.reachProbability },
    fallBelow: { ...bankroll.fallBelowProbability },
    ruin,
    drySpells: {
      fullLoss: drySpellStat(paidUnitsPerSession, (value) => value === 0, 'consecutive paid rounds with a zero initial paid payout'),
      nonProfitable: drySpellStat(
        paidUnitsPerSession,
        (value) => value <= paidStakeUnits,
        'consecutive paid rounds whose initial paid payout is at or below the full paid stake',
      ),
    },
    drawdown: {
      ...bankroll.maxDrawdown,
      exact: summarizeExact(records.map((record) => BigInt(record.maxDrawdownUnitsExact))),
      units: 'simulation centi-points',
    },
    maxObserved: {
      paidSpinUnits: maxPaid,
      paidSpinUnitsExact: String(maxPaid),
      freeSpinUnits: maxFree,
      freeSpinUnitsExact: String(maxFree),
      featureAggregateUnits: maxFeatureAggregate,
      featureAggregateUnitsExact: String(maxFeatureAggregate),
      capUnits,
      capUnitsExact: String(capUnits),
      paidSpinWithinCap: maxPaid <= capUnits,
      freeSpinWithinCap: maxFree <= capUnits,
      featureAggregateExceedsCap: maxFeatureAggregate > capUnits,
    },
    support: {
      reachableBoards: support.reachableBoards,
      totalBoardMass: support.totalBoardMass.toString(),
      maxWin: { ...support.maxWin },
    },
    sample: {
      sessions: records.length,
      config,
      horizonPaidSpins: config.horizonPaidSpins,
      censoredCount: bankroll.censoredCount,
      ruinedCount: bankroll.ruinedCount,
      actualPaidRounds: paidRounds,
      actualFreeSpins: bankroll.spinCounts.freeSpins,
      actualResolvedSpins: bankroll.spinCounts.totalResolvedSpins,
      seedPrefix,
      seedFirst: seeds[0],
      seedLast: seeds[seeds.length - 1],
      denomination: bankroll.denomination,
    },
    limitations: [
      'Offline behaviour fixture: testOnly=true, activated=false. No profile was generated, validated or activated.',
      'The optional red/black gamble is excluded from these sessions; the reported maxima are per resolved spin and per feature aggregate only.',
      'Selection uses a deterministic simulation stream (class and member draws) and a separate simulation stream for the native engine; production keeps the OS CSPRNG.',
      'Class frequencies are drawn from the configured weights, and the fixed-n binomial standard errors are closed-form; ' +
        'because the number of paid rounds is random (bankroll-dependent stopping), those intervals and the normal-approximation ' +
        'RTP interval are approximate rather than exact multinomial inference.',
      'Free spins are paid by the originating round under the same locked profile and cap; free spins never debit a wager.',
      'The per-resolved-spin cap is compared against `maxWinMultiplier x the full locked paid stake` (never a zero free stake); ' +
        'the feature aggregate is reported separately and may exceed the per-spin cap by design.',
      '`Balance @N | survivors only` is the balance after N completed paid rounds, over exactly the sessions that ' +
        'reached N (resolved at least N paid spins). A session that resolved exactly N and then could not fund the next ' +
        'stake is included; a session ruined before N is excluded, and the conditional sample size is reported with it.',
      '`Balance @N | all sessions, ruin=0` keeps every session, representing each session ruined before N as 0. It is ' +
        'reported separately from the survivor-only statistic and the two are never mixed. A checkpoint beyond the ' +
        'horizon is unobserved in both.',
      'A checkpoint beyond a session horizon is unobserved, and a session that reached the horizon is censored, not ruined: ' +
        'its bust time inside the horizon is unknown and no finite bust quantile is claimed.',
      'The exact per-resolution cap is converted from the policy multiple with exact rational arithmetic; a non-integral cap ' +
        'is refused rather than rounded up.',
    ],
  };

  return { report, bankroll, records, observations };
}

/** Fixed-decimal presentation with a scientific fallback (never a false zero). */
export function presentNumber(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  const fixed = value.toFixed(digits);
  if (value !== 0 && Number(fixed) === 0) return value.toExponential(3);
  return fixed;
}

const presentPercent = (value: number | null | undefined, digits = 2) => `${presentNumber(value, digits)}%`;

/** Both dry-spell readings: pooled runs and the longest run inside a session. */
function drySpellLines(label: string, stat: DrySpellStat): string[] {
  const longest = stat.longestPerSession;
  return [
    `- ${label} dry spell: ${stat.definition}`,
    `  - pooled run length: mean ${presentNumber(stat.meanRunLength, 2)} (denominator: ${stat.meanRunLengthDenominator} runs),` +
    ` P50 ${presentNumber(stat.pooledRuns.median, 1)}, P75 ${presentNumber(stat.pooledRuns.p75, 1)},` +
    ` P90 ${presentNumber(stat.pooledRuns.p90, 1)}, P95 ${presentNumber(stat.pooledRuns.p95, 1)},` +
    ` P99 ${presentNumber(stat.pooledP99, 1)}`,
    `  - longest run per session: mean ${presentNumber(longest.mean, 2)}, P50 ${presentNumber(longest.median, 1)},` +
    ` P75 ${presentNumber(longest.p75, 1)}, P90 ${presentNumber(longest.p90, 1)},` +
    ` P95 ${presentNumber(longest.p95, 1)}, P99 ${presentNumber(stat.longestPerSessionP99, 1)}`,
    '  - the streak a session ended on is included; `runs` counts runs, not sessions',
  ];
}

export function renderPolicyBankrollMarkdown(report: PolicyBankrollReport): string {
  const checkpoints = Array.from(new Set([
    ...Object.keys(report.survival),
    ...Object.keys(report.balance),
    ...Object.keys(report.ruin),
  ])).map(Number).sort((a, b) => a - b);
  const lines: string[] = [
    `# ${report.policyId} - payout-policy bankroll report`,
    '',
    `- **testOnly: ${report.testOnly}; activated: false** - a behaviour fixture, not a live profile.`,
    `- Game: \`${report.gameId}\`; policy \`${report.policyId}\` v${report.policyVersion}`,
    `- Policy hash: \`${report.policyHash}\``,
    `- Math profile: \`${report.mathProfileId}\` (\`${report.mathProfileHash}\`)`,
    `- Run id: \`${report.runId}\`; generated ${report.generatedAt}`,
    `- Scope: ${report.scope.maxWinScope}, cap ${report.scope.maxWinMultiplier}x, MAX band floor ${report.scope.maxBandMin}x, granularity ${report.scope.granularity}`,
    `- Simulation-only denomination: 1 unit = 0.01 PTS; initial balance ${(report.sample.config.startUnits / 100).toFixed(2)} PTS` +
    ` (${report.sample.config.startUnits} units); paid stake ${(report.sample.config.stakeUnits / 100).toFixed(2)} PTS` +
    ` (${report.sample.config.stakeUnits} units) per paid round. The live ladder is unchanged.`,
    '',
    '## Return',
    '',
    `- Expected (support, exact): ${report.expected.rtpPercentExact}% - ${report.expected.basis}`,
    `- Measured (complete paid rounds): ${report.measured.rtpPercentExact}%; house edge ${report.measured.houseEdgePercentExact}%`,
    `- Measured RTP uncertainty: standard error ${presentPercent(report.measured.rtpStandardErrorPercent)}` +
    ` (normal approximation over ${report.sample.actualPaidRounds} paid rounds),` +
    ` 95% interval ${report.measured.rtp95IntervalPercent
      ? `${presentPercent(report.measured.rtp95IntervalPercent[0])} - ${presentPercent(report.measured.rtp95IntervalPercent[1])}`
      : 'n/a'}`,
    `- Ledger (exact units): opening ${report.measured.openingUnitsExact} + returned ${report.measured.returnedUnitsExact}`,
    `  - paid wager ${report.measured.paidWagerUnitsExact} = closing ${report.measured.closingUnitsExact}`,
    `  - identity holds: ${report.measured.ledgerIdentityHolds}`,
    '',
    '## Class frequencies (configured vs observed)',
    '',
    '| Class | Configured | Observed | Deviation | Binomial SE | z | Support members | Conditional EV |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.classes.map((entry) =>
      `| ${entry.class} | ${presentPercent(entry.configuredPercent)} | ${presentPercent(entry.observedPercent)}` +
      ` (${entry.observedCount}) | ${presentPercent(entry.deviationPercent)} | ${presentPercent(entry.binomialStandardErrorPercent)}` +
      ` | ${presentNumber(entry.zDeviation, 2)} | ${entry.supportMembers} | ${entry.conditionalEvExact ?? 'n/a'} |`),
    '',
    `Classes outside 3 standard errors: ${report.classesOutsideThreeSigma} (a pragmatic flag across 9 classes, not a formal simultaneous test).`,
    '',
    '## Paid-event statistics (initial paid resolution only; free spins excluded)',
    '',
    `Denominator: ${report.paidEvents.paidRounds} paid rounds; full paid stake ${report.paidEvents.paidStakeUnits} simulation units.`,
    '',
    '| Event | Count | Rate | Wilson 95% |',
    '| --- | ---: | ---: | --- |',
    ...([['Full loss (0x)', report.paidEvents.fullLoss],
      ['Hit (> 0)', report.paidEvents.hit],
      ['Profitable (> stake)', report.paidEvents.profitable],
      ['Partial (0 < x < stake)', report.paidEvents.partial],
      ['Break-even (exactly stake)', report.paidEvents.breakEven],
      ['Non-profitable (<= stake)', report.paidEvents.nonProfitable],
      ['Feature triggered', report.paidEvents.featureTriggered],
      ['Retriggered', report.paidEvents.retriggered]] as const)
      .map(([label, value]) =>
        `| ${label} | ${value.count} | ${presentPercent(value.rate * 100)} | ` +
        `${value.wilson95 ? `${presentPercent(value.wilson95[0] * 100)} - ${presentPercent(value.wilson95[1] * 100)}` : 'n/a'} |`),
    '',
    `Native class mismatches (selected class vs native evaluation): ${report.paidEvents.nativeClassMismatches}`,
    `Trigger-board paid payout (units): mean ${report.paidEvents.triggerPaidPayoutUnits.meanExact}, median ${report.paidEvents.triggerPaidPayoutUnits.medianExact}, sample ${report.paidEvents.triggerPaidPayoutUnits.sampleSize}`,
    '',
    '## Sessions',
    '',
    `- Sessions: ${report.sample.sessions}; horizon: ${report.sample.horizonPaidSpins} paid spins; censored ${report.sample.censoredCount}; ruined ${report.sample.ruinedCount}`,
    `- Actual paid rounds ${report.sample.actualPaidRounds}; free spins ${report.sample.actualFreeSpins}; resolved spins ${report.sample.actualResolvedSpins}`,
    `- Seeds: prefix \`${report.sample.seedPrefix}\` (${report.sample.seedFirst} .. ${report.sample.seedLast})`,
    `- Paid spins per session: mean ${presentNumber(report.spins.perSessionPaidSpins.mean, 1)}, median ${presentNumber(report.spins.perSessionPaidSpins.median, 1)},` +
    ` p10 ${presentNumber(report.spins.perSessionPaidSpins.p10, 1)}, p25 ${presentNumber(report.spins.perSessionPaidSpins.p25, 1)},` +
    ` p75 ${presentNumber(report.spins.perSessionPaidSpins.p75, 1)}, p90 ${presentNumber(report.spins.perSessionPaidSpins.p90, 1)},` +
    ` p95 ${presentNumber(report.spins.perSessionPaidSpins.p95, 1)}`,
    `- Turnover (PAID only, PTS): mean ${report.turnover.perSessionPts.meanExact}, median ${report.turnover.perSessionPts.medianExact},` +
    ` p75 ${report.turnover.perSessionPts.p75Exact}, p90 ${report.turnover.perSessionPts.p90Exact}, p95 ${report.turnover.perSessionPts.p95Exact}` +
    ` (total ${report.turnover.totalPtsExact} PTS)`,
    `- House per session: mean wager ${report.house.meanWagerPtsPerSession.toFixed(4)} PTS, mean payout ${report.house.meanPayoutPtsPerSession.toFixed(4)} PTS,` +
    ` mean net ${report.house.meanNetPtsPerSession.toFixed(4)} PTS, median net ${report.house.netPerSessionExact.median === null ? 'n/a' : (report.house.netPerSessionExact.median / 100).toFixed(4)} PTS` +
    ` (edge per wager ${report.measured.houseEdgePercentExact}%)`,
    `- Drawdown (units): mean ${presentNumber(report.drawdown.mean, 1)}, median ${presentNumber(report.drawdown.median, 1)},` +
    ` p75 ${presentNumber(report.drawdown.p75, 1)}, p90 ${presentNumber(report.drawdown.p90, 1)}, p95 ${presentNumber(report.drawdown.p95, 1)}`,
    '',
    '## Checkpoints',
    '',
    'Balance figures are rounded statistical presentation in simulation units (the JSON report carries the full',
    'quantile summaries and exact strings). Two checkpoint populations are reported and never mixed.',
    '',
    '#### Balance @N | survivors only',
    '',
    'Eligible population: exactly the sessions that reached N (resolved at least N paid spins). This is NOT the',
    'accepted `Alive@N` event: `Alive@N` means the session could still fund the next paid stake after N completed paid',
    'spins. A session that resolved exactly N and then could not fund spin N+1 is included here (it reached N) while',
    '`Alive@N` is false. A session ruined before N is excluded. A checkpoint beyond the horizon is unobserved (`n/a`).',
    '',
    '| N | total sessions | reached | reach rate (survivor rate) | conditional sample | excluded (ruined before N) | exact checkpoint ruin | Alive@N | mean | p10 | p25 | median (P50) | p75 | p90 | p95 |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...checkpoints.map((checkpoint) => {
      const point = report.balance[String(checkpoint)];
      if (!point) {
        return `| ${checkpoint} | n/a | not requested | not requested | not requested | n/a | n/a | n/a | not requested | n/a | n/a | n/a | n/a | n/a | n/a |`;
      }
      const quantile = (value: number | null | undefined) => presentNumber(value, 1);
      return `| ${checkpoint} | ${point.totalSessions} | ${point.reachedCheckpoint}` +
        ` | ${point.survivalRate === null ? 'unobserved' : presentPercent(point.survivalRate * 100)}` +
        ` | ${point.conditionalSampleSize} | ${point.excludedRuinedBeforeCheckpoint} | ${point.exactCheckpointRuin}` +
        ` | ${point.beyondHorizon ? 'unobserved' : point.aliveAtCheckpoint}` +
        ` | ${quantile(point.mean)} | ${quantile(point.p10)} | ${quantile(point.p25)} | ${quantile(point.median)}` +
        ` | ${quantile(point.p75)} | ${quantile(point.p90)} | ${quantile(point.p95)} |`;
    }),
    '',
    'Reconciliation (exact identity): `reached = Alive@N + exact checkpoint ruin`. A session that resolved exactly N',
    'and then could not fund N+1 is counted by the accepted `Ruin by N` block while still reaching N, so it appears in',
    'both the exact checkpoint ruin column and the survivor-only balance.',
    '',
    'Rate reconciliation: `reach rate = Alive@N rate + exact checkpoint ruin / Alive@N observed`. The accepted `Alive@N`',
    'calculations and `Alive@N` itself are unchanged; only the reach probability is decomposed against them.',
    '',
    '| N | Alive@N rate | exact checkpoint ruin / observed | reach rate (survivor rate) | denominator |',
    '| ---: | ---: | ---: | ---: | ---: |',
    ...checkpoints.map((checkpoint) => {
      const point = report.balance[String(checkpoint)];
      if (!point || point.beyondHorizon) {
        return `| ${checkpoint} | ${point?.beyondHorizon ? 'unobserved' : 'n/a'} | unobserved | unobserved | unobserved |`;
      }
      const boundaryShare = point.survivalRateDenominator === 0
        ? 'n/a'
        : presentPercent((point.exactCheckpointRuin / point.survivalRateDenominator) * 100);
      return `| ${checkpoint} | ${point.aliveRate === null ? 'n/a (balance-only checkpoint)' : presentPercent(point.aliveRate * 100)}` +
        ` | ${boundaryShare}` +
        ` | ${point.survivalRate === null ? 'unobserved' : presentPercent(point.survivalRate * 100)}` +
        ` | ${point.survivalRateDenominator} |`;
    }),
    '',
    '#### Balance @N | all sessions, ruin=0',
    '',
    'Every session is represented: a reached session keeps its balance, and a session ruined before N is represented',
    'as 0. This is kept strictly separate from the survivor-only population above.',
    '',
    '| N | total sessions | observed | represented as 0 (ruined before N) | mean | p10 | p25 | median (P50) | p75 | p90 | p95 |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...checkpoints.map((checkpoint) => {
      const point = report.unconditionalBalance[String(checkpoint)];
      if (!point) {
        return `| ${checkpoint} | n/a | not requested | n/a | not requested | n/a | n/a | n/a | n/a | n/a | n/a |`;
      }
      const quantile = (value: number | null | undefined) => presentNumber(value, 1);
      return `| ${checkpoint} | ${point.totalSessions} | ${point.observed} | ${point.zeroRepresented}` +
        ` | ${quantile(point.mean)} | ${quantile(point.p10)} | ${quantile(point.p25)} | ${quantile(point.median)}` +
        ` | ${quantile(point.p75)} | ${quantile(point.p90)} | ${quantile(point.p95)} |`;
    }),
    '',
    '#### Survival and ruin',
    '',
    '`Alive@N` means the session could still fund the next paid stake after N completed paid spins; a checkpoint beyond',
    'the horizon is unobserved, not zero.',
    '',
    '| N | Alive@N | Alive obs | Ruin by N | Ruin obs | beyond horizon |',
    '| ---: | ---: | ---: | ---: | ---: | --- |',
    ...checkpoints.map((checkpoint) => {
      const alive = report.survival[String(checkpoint)];
      const ruin = report.ruin[String(checkpoint)];
      return `| ${checkpoint} | ${alive && alive.rate !== null ? presentPercent(alive.rate * 100) : (alive ? 'unobserved' : 'n/a')}` +
        ` | ${alive?.observed ?? 'n/a'}` +
        ` | ${ruin && !ruin.beyondHorizon && ruin.rate !== null ? presentPercent(ruin.rate * 100) : 'unknown'}` +
        ` | ${ruin?.observed ?? 'n/a'} | ${ruin === undefined ? 'n/a' : ruin.beyondHorizon ? 'yes' : 'no'} |`;
    }),
    '',
    '## Reach / fall / dry spells / maxima',
    '',
    ...Object.entries(report.reach).map(([key, value]) => `- reached ${Number(key) / 100} PTS: ${presentPercent(value * 100)}`),
    ...Object.entries(report.fallBelow).map(([key, value]) => `- fell below ${Number(key) / 100} PTS: ${presentPercent(value * 100)}`),
    ...drySpellLines('FULL_LOSS', report.drySpells.fullLoss),
    ...drySpellLines('NON_PROFITABLE', report.drySpells.nonProfitable),
    `- Max observed paid resolved spin: ${report.maxObserved.paidSpinUnitsExact} units (within cap: ${report.maxObserved.paidSpinWithinCap})`,
    `- Max observed free resolved spin: ${report.maxObserved.freeSpinUnitsExact} units (within cap ${report.maxObserved.capUnitsExact}: ${report.maxObserved.freeSpinWithinCap})`,
    `- Max observed feature aggregate: ${report.maxObserved.featureAggregateUnitsExact} units` +
    ` (aggregate above the per-spin cap is expected and deliberately uncapped: ${report.maxObserved.featureAggregateExceedsCap})`,
    `- Support: ${report.support.reachableBoards} reachable boards, mass ${report.support.totalBoardMass};` +
    ` proved per-resolution max paid ${report.support.maxWin.paidSpinMax}, free ${report.support.maxWin.freeSpinMax}, resolved ${report.support.maxWin.resolvedSpinMax}`,
    '',
    '## Limitations',
    '',
    ...report.limitations.map((entry) => `- ${entry}`),
    '',
  ];
  return lines.join('\n');
}

export function renderPolicyBankrollComparisonMarkdown(reports: readonly PolicyBankrollReport[]): string {
  const rows = reports.map((report) => {
    const alive500 = report.survival['500']?.rate ?? null;
    const alive1000 = report.survival['1000']?.rate ?? null;
    const ruin500 = report.ruin['500'];
    const maxObservedSpinUnits = Math.max(report.maxObserved.paidSpinUnits, report.maxObserved.freeSpinUnits);
    return [
      report.policyId,
      report.expected.rtpPercentExact,
      report.measured.rtpPercentExact,
      presentPercent(report.paidEvents.fullLoss.rate * 100),
      presentPercent(report.paidEvents.partial.rate * 100),
      presentPercent(report.paidEvents.hit.rate * 100),
      presentPercent(report.paidEvents.featureTriggered.rate * 100),
      // Configured ceiling first; then the observed max resolved spin
      // (max of paid and free) separately from the feature aggregate.
      `cap ${report.scope.maxWinMultiplier}x; obs ${maxObservedSpinUnits}/${report.maxObserved.featureAggregateUnitsExact}`,
      `${presentNumber(report.spins.perSessionPaidSpins.median, 1)}/${presentNumber(report.spins.perSessionPaidSpins.p90, 1)}`,
      report.turnover.perSessionPts.medianExact ?? 'n/a',
      presentPercent(alive500 === null ? null : alive500 * 100, 1),
      presentPercent(alive1000 === null ? null : alive1000 * 100, 1),
      ruin500 && !ruin500.beyondHorizon && ruin500.rate !== null ? presentPercent(ruin500.rate * 100, 1) : 'unknown',
      presentPercent((report.reach['15000'] ?? 0) * 100, 1),
      presentNumber(report.drySpells.fullLoss.longestPerSession.p90, 1),
      report.house.meanNetPtsPerSession.toFixed(4),
    ].join(' | ');
  });
  return [
    '# Payout-policy bankroll comparison (TEST fixtures)',
    '',
    '`testOnly: true`, `activated: false`. Every row is an offline behaviour fixture with an honest canonical',
    'artifact hash - none of them is an activated live profile, and none claims activation-grade evidence.',
    '',
    '| Policy | Expected RTP | Measured RTP | Full loss | Partial | Hit | Feature | MaxWin (cap; observed max spin/feature aggregate, units) | Median/P90 spins | Median turnover (PTS) | Alive@500 | Alive@1000 | Ruin@500 | Reach 150 PTS | P90 full-loss streak/session | Mean house net (PTS) |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map((row) => `| ${row} |`),
    '',
  ].join('\n');
}
