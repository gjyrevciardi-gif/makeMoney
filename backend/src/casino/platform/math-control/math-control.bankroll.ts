import { QUANTILE_CONVENTION, summarize, summarizeExact } from './math-control.analytics';
import {
  bigRational,
  bigRationalToDecimalString,
  bigRationalToPresentationNumber,
  bigintToDecimalString,
  toExactNumber,
} from './math-control.rational';
import type {
  BankrollReport,
  QuantileSummary,
  QuantileSummaryExact,
  SessionConfig,
  SessionOutcomeSource,
  SessionRecord,
} from './math-control.types';

/**
 * Complete-session bankroll validation.
 *
 * Simulation-only denomination: one unit is one hundredth of a platform point,
 * so the compared session starts from 100.00 PTS with a 0.20 PTS stake. The
 * live stake ladder is not changed here - this conversion exists so a
 * fractional-stake comparison can be stated exactly with integers.
 *
 * Accounting rules enforced by this module:
 *  - every authoritative accumulator is a BigInt: balance, wager, payout,
 *    feature payout, base payout, peak and drawdown. Exact values larger than
 *    Number.MAX_SAFE_INTEGER are carried and reported as decimal strings; the
 *    numeric mirrors are `null` when a value is not exactly representable, and
 *    no accounting figure is ever silently rounded;
 *  - spin counts are the counts the outcome source actually resolved: a paid
 *    round contributes one paid spin plus the free spins it really played
 *    (retriggers included). They are never inferred from a trigger flag, and a
 *    replayed or recovered round contributes nothing;
 *  - one paid round is one stake debit and one credit of its complete return;
 *    free spins never debit a wager;
 *  - a session ends when the balance can no longer fund the next stake;
 *  - a session that reaches the horizon while still fundable is censored, never
 *    called ruined, and a checkpoint beyond the horizon is unobserved.
 */

export const BANKROLL_DENOMINATION =
  'simulation-only centi-points (1 unit = 0.01 PTS); the live game ladder stays whole points';

export function defaultSessionConfig(): SessionConfig {
  return {
    startUnits: 10_000,
    stakeUnits: 20,
    horizonPaidSpins: 50_000,
    aliveCheckpoints: [100, 250, 500, 1000, 2500, 5000, 10_000, 25_000, 50_000],
    balanceCheckpoints: [100, 250, 500, 1000, 5000],
    reachTargets: [12_500, 15_000, 20_000],
    fallTargets: [8_000, 6_000, 4_000, 2_000],
    ruinCheckpoints: [100, 250, 500, 1000, 5000],
  };
}

/** Bounded, exactly-representable session configuration. */
export function assertSessionConfig(config: SessionConfig) {
  const positive = [
    ['startUnits', config.startUnits],
    ['stakeUnits', config.stakeUnits],
    ['horizonPaidSpins', config.horizonPaidSpins],
  ] as const;
  for (const [label, value] of positive) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`SESSION_CONFIG_INVALID: ${label} must be a positive safe integer`);
    }
  }
  if (config.stakeUnits > config.startUnits) {
    throw new Error('SESSION_CONFIG_INVALID: the stake cannot exceed the starting balance');
  }
  for (const [label, list] of [
    ['aliveCheckpoints', config.aliveCheckpoints],
    ['balanceCheckpoints', config.balanceCheckpoints],
    ['reachTargets', config.reachTargets],
    ['fallTargets', config.fallTargets],
    ['ruinCheckpoints', config.ruinCheckpoints],
  ] as const) {
    if (list.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
      throw new Error(`SESSION_CONFIG_INVALID: ${label} must contain positive safe integers`);
    }
  }
  if (config.aliveCheckpoints.length === 0 || config.ruinCheckpoints.length === 0) {
    throw new Error('SESSION_CONFIG_INVALID: survival and ruin checkpoints are required');
  }
}

/** Exact integer units supplied by an outcome source. */
function toUnits(value: number, code: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`SESSION_ROUND_${code}_INVALID`);
  }
  return BigInt(value);
}

function toCount(value: number, code: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`SESSION_ROUND_${code}_INVALID`);
  }
  return value;
}

const exact = (value: bigint) => bigintToDecimalString(value);
const mirror = (value: bigint) => toExactNumber(value);

export function simulateSession(
  source: SessionOutcomeSource,
  config: SessionConfig,
  seed: string,
): SessionRecord {
  assertSessionConfig(config);
  const start = BigInt(config.startUnits);
  const stake = BigInt(config.stakeUnits);
  const horizon = config.horizonPaidSpins;

  let balance = start;
  let peak = start;
  let maxDrawdown = 0n;
  // Loop control stays a bounded Number; the reported counts are accumulated
  // exactly and mirrored with a checked conversion, so a long run of large
  // per-round counts can never overflow silently.
  let paidSpins = 0;
  let paidSpinsTotal = 0n;
  let freeSpinsTotal = 0n;
  let resolvedSpinsTotal = 0n;
  let turnoverUnits = 0n;
  let returnedUnits = 0n;
  let baseReturnUnits = 0n;
  let featureReturnUnits = 0n;
  let featureTriggeredRounds = 0;
  let retriggeredRounds = 0;
  let maxObservedReturnUnits = 0n;
  let busted = false;

  const balanceAtCheckpoint: Record<string, number | null> = {};
  const balanceAtCheckpointExact: Record<string, string | null> = {};
  const aliveAtCheckpoint: Record<string, boolean | null> = {};
  const reachedTargets: Record<string, boolean> = {};
  const fellBelowTargets: Record<string, boolean> = {};
  const ruinedBy: Record<string, boolean | null> = {};

  for (const target of config.reachTargets) reachedTargets[String(target)] = start >= BigInt(target);
  for (const target of config.fallTargets) fellBelowTargets[String(target)] = start < BigInt(target);

  const observedBalance = new Map<number, bigint>();
  const checkpoints = new Set<number>([
    ...config.balanceCheckpoints,
    ...config.aliveCheckpoints,
    ...config.ruinCheckpoints,
  ]);

  while (paidSpins < horizon) {
    if (balance < stake) {
      busted = true;
      break;
    }
    const round = source.drawPaidRound();

    // Authoritative counts, exactly as resolved by the game for this round.
    const roundPaid = toCount(round.paidSpins, 'PAID_SPINS');
    const roundFree = toCount(round.freeSpins, 'FREE_SPINS');
    const roundResolved = toCount(round.totalResolvedSpins, 'TOTAL_RESOLVED_SPINS');
    if (roundPaid !== 1) throw new Error('SESSION_PAID_SPIN_COUNT_INVALID: a paid round resolves exactly one paid spin');
    if (roundResolved !== roundPaid + roundFree) {
      throw new Error('SESSION_RESOLVED_SPIN_MISMATCH: totalResolvedSpins must equal paidSpins + freeSpins');
    }

    const roundReturn = toUnits(round.returnUnits, 'RETURN');
    const roundFeatureReturn = toUnits(round.featureReturnUnits, 'FEATURE_RETURN');
    if (roundFeatureReturn > roundReturn) {
      throw new Error('SESSION_ROUND_FEATURE_EXCEEDS_RETURN');
    }
    if (roundFeatureReturn > 0n && roundFree === 0) {
      throw new Error('SESSION_ROUND_FEATURE_PAYOUT_WITHOUT_RESOLVED_SPINS');
    }

    balance -= stake;
    turnoverUnits += stake;
    balance += roundReturn;
    returnedUnits += roundReturn;
    baseReturnUnits += roundReturn - roundFeatureReturn;
    featureReturnUnits += roundFeatureReturn;
    paidSpins += roundPaid;
    paidSpinsTotal += BigInt(roundPaid);
    freeSpinsTotal += BigInt(roundFree);
    resolvedSpinsTotal += BigInt(roundResolved);
    if (round.featureTriggered) featureTriggeredRounds += 1;
    if (round.retriggered) retriggeredRounds += 1;
    if (roundReturn > maxObservedReturnUnits) maxObservedReturnUnits = roundReturn;

    if (balance > peak) peak = balance;
    const drawdown = peak - balance;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;

    for (const target of config.reachTargets) {
      if (!reachedTargets[String(target)] && balance >= BigInt(target)) reachedTargets[String(target)] = true;
    }
    for (const target of config.fallTargets) {
      if (!fellBelowTargets[String(target)] && balance < BigInt(target)) fellBelowTargets[String(target)] = true;
    }
    if (checkpoints.has(paidSpins)) observedBalance.set(paidSpins, balance);
  }

  const endingUnits = balance;
  // The per-session ledger identity is checked in exact integers.
  if (returnedUnits !== turnoverUnits + endingUnits - start) {
    throw new Error(
      `SESSION_ACCOUNTING_MISMATCH: returned ${returnedUnits} != turnover ${turnoverUnits} + ending ${endingUnits} - start ${start}`,
    );
  }
  busted = endingUnits < stake;
  const censored = !busted;

  for (const checkpoint of checkpoints) {
    const held = checkpoint > horizon ? null : checkpointBalance(checkpoint);
    balanceAtCheckpoint[String(checkpoint)] = held === null ? null : mirror(held);
    balanceAtCheckpointExact[String(checkpoint)] = held === null ? null : exact(held);
  }
  for (const checkpoint of config.aliveCheckpoints) {
    const held = checkpoint > horizon ? null : checkpointBalance(checkpoint);
    aliveAtCheckpoint[String(checkpoint)] = held === null ? null : held >= stake;
  }
  for (const checkpoint of config.ruinCheckpoints) {
    // Beyond the horizon the checkpoint is unobserved: reporting a point
    // probability of zero there would claim knowledge the run does not have.
    ruinedBy[String(checkpoint)] = checkpoint > horizon ? null : busted && paidSpins <= checkpoint;
  }

  function checkpointBalance(checkpoint: number): bigint | null {
    if (checkpoint <= paidSpins) {
      return observedBalance.get(checkpoint) ?? endingUnits;
    }
    // The session ended before this checkpoint: a busted session keeps its
    // terminal dust balance so later checkpoints stay representative.
    if (busted) return endingUnits;
    return null;
  }

  return {
    seed,
    paidSpins: requireNumber(paidSpinsTotal, 'paidSpins'),
    freeSpins: requireNumber(freeSpinsTotal, 'freeSpins'),
    totalResolvedSpins: requireNumber(resolvedSpinsTotal, 'totalResolvedSpins'),
    turnoverUnits: mirror(turnoverUnits),
    turnoverUnitsExact: exact(turnoverUnits),
    endingUnits: mirror(endingUnits),
    endingUnitsExact: exact(endingUnits),
    returnedUnits: mirror(returnedUnits),
    returnedUnitsExact: exact(returnedUnits),
    baseReturnUnits: mirror(baseReturnUnits),
    baseReturnUnitsExact: exact(baseReturnUnits),
    featureReturnUnits: mirror(featureReturnUnits),
    featureReturnUnitsExact: exact(featureReturnUnits),
    maxObservedReturnUnits: mirror(maxObservedReturnUnits),
    maxObservedReturnUnitsExact: exact(maxObservedReturnUnits),
    busted,
    censored,
    featureTriggeredRounds,
    retriggeredRounds,
    peakUnits: mirror(peak),
    peakUnitsExact: exact(peak),
    maxDrawdownUnits: mirror(maxDrawdown),
    maxDrawdownUnitsExact: exact(maxDrawdown),
    balanceAtCheckpoint,
    balanceAtCheckpointExact,
    aliveAtCheckpoint,
    reachedTargets,
    fellBelowTargets,
    ruinedBy,
  };
}

/** Exact integer total; used for every cohort accumulation. */
function exactTotal(values: readonly bigint[]): bigint {
  let total = 0n;
  for (const value of values) total += value;
  return total;
}

/** Legacy numeric summary derived from the exact one (presentation only). */
function numericSummary(summary: QuantileSummaryExact): QuantileSummary {
  return {
    mean: summary.mean,
    median: summary.median,
    p10: summary.p10,
    p25: summary.p25,
    p75: summary.p75,
    p90: summary.p90,
    p95: summary.p95,
  };
}

function requireNumber(value: bigint, label: string): number {
  const mirrored = mirror(value);
  if (mirrored === null) {
    throw new Error(`BANKROLL_COUNT_UNREPRESENTABLE: ${label} exceeds the exact Number range`);
  }
  return mirrored;
}

export function simulateCohort(
  sourceFor: (seed: string) => SessionOutcomeSource,
  config: SessionConfig,
  seeds: readonly string[],
): { report: BankrollReport; records: SessionRecord[] } {
  if (seeds.length === 0) throw new Error('BANKROLL_COHORT_EMPTY');
  const records: SessionRecord[] = [];
  for (const seed of seeds) records.push(simulateSession(sourceFor(seed), config, seed));

  // Every cohort total is an exact BigInt sum.
  const paidSpinsTotal = exactTotal(records.map((record) => BigInt(record.paidSpins)));
  const freeSpinsTotal = exactTotal(records.map((record) => BigInt(record.freeSpins)));
  const resolvedSpinsTotal = exactTotal(records.map((record) => BigInt(record.totalResolvedSpins)));
  const turnoverTotal = exactTotal(records.map((record) => BigInt(record.turnoverUnitsExact)));
  const returnedTotal = exactTotal(records.map((record) => BigInt(record.returnedUnitsExact)));
  const featureReturnTotal = exactTotal(records.map((record) => BigInt(record.featureReturnUnitsExact)));
  const baseReturnTotal = exactTotal(records.map((record) => BigInt(record.baseReturnUnitsExact)));
  const openingUnits = BigInt(config.startUnits) * BigInt(records.length);
  const closingUnits = exactTotal(records.map((record) => BigInt(record.endingUnitsExact)));
  const ledgerDeltaUnits = openingUnits + returnedTotal - turnoverTotal - closingUnits;
  const splitIdentityHolds = baseReturnTotal + featureReturnTotal === returnedTotal;
  const featureRounds = exactTotal(records.map((record) => BigInt(record.featureTriggeredRounds)));
  const retriggerRounds = exactTotal(records.map((record) => BigInt(record.retriggeredRounds)));
  const busted = records.filter((record) => record.busted);

  const balanceAt: Record<string, QuantileSummary> = {};
  const balanceAtExact: Record<string, QuantileSummaryExact> = {};
  for (const checkpoint of config.balanceCheckpoints) {
    const values = records
      .map((record) => record.balanceAtCheckpointExact[String(checkpoint)])
      .filter((value): value is string => value !== null && value !== undefined)
      .map((value) => BigInt(value));
    const summary = summarizeExact(values);
    balanceAtExact[String(checkpoint)] = summary;
    balanceAt[String(checkpoint)] = numericSummary(summary);
  }

  const aliveAt: Record<string, number | null> = {};
  for (const checkpoint of config.aliveCheckpoints) {
    const observed = records.filter((record) => record.aliveAtCheckpoint[String(checkpoint)] !== null);
    aliveAt[String(checkpoint)] = observed.length === 0
      ? null
      : observed.filter((record) => record.aliveAtCheckpoint[String(checkpoint)] === true).length / observed.length;
  }

  const reachProbability: Record<string, number> = {};
  const reachLabels: Record<string, string> = {};
  for (const target of config.reachTargets) {
    reachProbability[String(target)] = records.filter((record) => record.reachedTargets[String(target)]).length / records.length;
    reachLabels[`${target} units`] = `${(target / 100).toFixed(2)} PTS`;
  }

  const fallBelowProbability: Record<string, number> = {};
  for (const target of config.fallTargets) {
    fallBelowProbability[String(target)] = records.filter((record) => record.fellBelowTargets[String(target)]).length / records.length;
  }

  const ruinBy: Record<string, number | null> = {};
  const ruinByObservedSessions: Record<string, number> = {};
  for (const checkpoint of config.ruinCheckpoints) {
    const observed = records.filter((record) => record.ruinedBy[String(checkpoint)] !== null);
    ruinByObservedSessions[String(checkpoint)] = observed.length;
    ruinBy[String(checkpoint)] = checkpoint > config.horizonPaidSpins || observed.length === 0
      ? null
      : observed.filter((record) => record.ruinedBy[String(checkpoint)] === true).length / observed.length;
  }

  const observedLength = summarizeExact(records.map((record) => BigInt(record.paidSpins)));
  const turnoverPaidSpinsExact = summarizeExact(
    records.map((record) => BigInt(record.turnoverUnitsExact) / BigInt(config.stakeUnits)),
  );
  // Turnover in PTS: the exact per-session unit total scaled by 1/100.
  const turnoverPts = summarizeExact(
    records.map((record) => BigInt(record.turnoverUnitsExact)),
    1n,
    100n,
  );
  const observedBustQuantiles = summarize(busted.map((record) => record.paidSpins));
  const drawdownSummary = summarizeExact(records.map((record) => BigInt(record.maxDrawdownUnitsExact)));
  const maxWinUnits = records.reduce(
    (max, record) => {
      const value = BigInt(record.maxObservedReturnUnitsExact);
      return value > max ? value : max;
    },
    0n,
  );
  const sessionsAtMax = records.filter(
    (record) => BigInt(record.maxObservedReturnUnitsExact) === maxWinUnits && maxWinUnits > 0n,
  ).length;

  const measuredRtp = turnoverTotal === 0n ? bigRational(0n, 1n) : bigRational(returnedTotal * 100n, turnoverTotal);
  const houseEdge = houseComputed(turnoverTotal, returnedTotal);

  const report: BankrollReport = {
    denomination: BANKROLL_DENOMINATION,
    config,
    sampleSize: records.length,
    seeds: {
      prefix: seeds[0].split(':').slice(0, -1).join(':'),
      count: seeds.length,
      first: seeds[0],
      last: seeds[seeds.length - 1],
    },
    horizonPaidSpins: config.horizonPaidSpins,
    censoredCount: records.filter((record) => record.censored).length,
    ruinedCount: busted.length,
    spinCounts: {
      paidSpins: requireNumber(paidSpinsTotal, 'paidSpins'),
      freeSpins: requireNumber(freeSpinsTotal, 'freeSpins'),
      totalResolvedSpins: requireNumber(resolvedSpinsTotal, 'totalResolvedSpins'),
    },
    totals: {
      openingUnits: mirror(openingUnits),
      openingUnitsExact: exact(openingUnits),
      paidWagerUnits: mirror(turnoverTotal),
      paidWagerUnitsExact: exact(turnoverTotal),
      baseReturnUnits: mirror(baseReturnTotal),
      baseReturnUnitsExact: exact(baseReturnTotal),
      featureReturnUnits: mirror(featureReturnTotal),
      featureReturnUnitsExact: exact(featureReturnTotal),
      returnedUnits: mirror(returnedTotal),
      returnedUnitsExact: exact(returnedTotal),
      closingUnits: mirror(closingUnits),
      closingUnitsExact: exact(closingUnits),
      ledgerDeltaUnits: mirror(ledgerDeltaUnits),
      ledgerDeltaUnitsExact: exact(ledgerDeltaUnits),
      ledgerIdentityHolds: ledgerDeltaUnits === 0n && splitIdentityHolds,
      paidRounds: requireNumber(paidSpinsTotal, 'paidRounds'),
      turnoverPts: bigRationalToPresentationNumber(bigRational(turnoverTotal, 100n)),
      turnoverPtsExact: bigRationalToDecimalString(bigRational(turnoverTotal, 100n), 4),
      returnedPts: bigRationalToPresentationNumber(bigRational(returnedTotal, 100n)),
      returnedPtsExact: bigRationalToDecimalString(bigRational(returnedTotal, 100n), 4),
    },
    observedLengthPaidSpins: numericSummary(observedLength),
    turnoverPaidSpins: numericSummary(turnoverPaidSpinsExact),
    turnoverPts,
    balanceAt,
    balanceAtExact,
    aliveAt,
    reachProbability,
    fallBelowProbability,
    ruinBy,
    ruinByObservedSessions,
    observedBustQuantiles,
    maxDrawdown: numericSummary(drawdownSummary),
    maxWin: {
      units: mirror(maxWinUnits),
      unitsExact: exact(maxWinUnits),
      pts: bigRationalToPresentationNumber(bigRational(maxWinUnits, 100n)),
      ptsExact: bigRationalToDecimalString(bigRational(maxWinUnits, 100n), 4),
      sessionFrequency: records.length === 0 ? 0 : sessionsAtMax / records.length,
    },
    featureRoundRate: paidSpinsTotal === 0n ? 0 : Number(featureRounds) / Number(paidSpinsTotal),
    retriggerRoundRate: paidSpinsTotal === 0n ? 0 : Number(retriggerRounds) / Number(paidSpinsTotal),
    featureReturnShare: returnedTotal === 0n ? 0 : Number(featureReturnTotal) / Number(returnedTotal),
    measuredRtpExact: bigRationalToDecimalString(measuredRtp, 6),
    // No fabricated zero: an unrepresentable ratio presents as null and the
    // exact decimal string above stays authoritative.
    measuredRtpPercent: bigRationalToPresentationNumber(measuredRtp),
    houseEdgeExact: bigRationalToDecimalString(houseEdge, 6),
    houseEdgePercent: bigRationalToPresentationNumber(houseEdge),
    notes: [
      'Measured return is total return over total PAID wager, never an ending balance over a starting balance.',
      `Ledger identity: opening ${openingUnits} + returned ${returnedTotal} - paid wager ${turnoverTotal} = closing ${closingUnits}` +
        ` (exact: ${ledgerDeltaUnits === 0n && splitIdentityHolds}).`,
      `Spin counts from the authoritative outcome source: ${paidSpinsTotal} paid spins + ${freeSpinsTotal} free spins ` +
        `= ${resolvedSpinsTotal} resolved spins (free spins never debit a wager; retriggers are resolved spins).`,
      'Money-shaped figures are exact BigInt accumulations; a `*Exact` string is authoritative and a numeric mirror is null when the value is not exactly representable.',
      'Rounded decimal strings (`*Exact` on a ratio, e.g. RTP/quantiles) are fixed-precision presentations; exact monetary totals are integer strings.',
      'A session that reached the horizon is censored, not ruined; its bust time is unknown inside the horizon.',
      'A ruin checkpoint beyond the horizon is unobserved (null) with its observable-session count, never a point probability of zero.',
      `Length is the restricted observed duration (paid spins completed), quantiles by ${QUANTILE_CONVENTION}.`,
      'Balance checkpoints hold the terminal dust balance of a busted session so later checkpoints stay representative.',
      'Number-valued statistics are presentation mirrors of exact values, not accounting inputs.',
      `reachTargets (simulation units): ${JSON.stringify(reachLabels)}`,
    ],
  };

  return { report, records };
}

/** Exact house edge in percent: (wager - returned) / wager * 100. */
function houseComputed(turnover: bigint, returned: bigint): ReturnType<typeof bigRational> {
  return turnover === 0n ? bigRational(0n, 1n) : bigRational((turnover - returned) * 100n, turnover);
}

/** Sorted helper used by tests and reports that need raw ordering. */
export const sortedDurations = (records: readonly SessionRecord[]) =>
  records.map((record) => record.paidSpins).sort((a, b) => a - b);
