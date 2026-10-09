import { createHash } from 'node:crypto';
import {
  PAYOUT_CLASSES,
  type PayoutClass,
  type QuantileSummary,
  type QuantileSummaryExact,
} from './math-control.types';
import {
  bigRational,
  bigRationalMean,
  bigRationalPercentile,
  bigRationalToDecimalString,
  bigRationalToPresentationNumber,
  rationalFromDecimal,
  rationalFromDecimalString,
  toExactNumber,
} from './math-control.rational';

/**
 * Statistical conventions used by every Game Math Control report.
 *
 * Quantiles: **linear interpolation between closest ranks (R-7)** - the same
 * convention as NumPy's default, Excel's `PERCENTILE.INC` and Google Sheets'
 * `PERCENTILE`. With a sample of size n sorted ascending, `h = (n - 1) * q`
 * and the result is `x[floor(h)] + (h - floor(h)) * (x[floor(h) + 1] - x[floor(h)])`.
 * p0 is the minimum and p100 the maximum. An empty sample yields `null` rather
 * than zero, so a missing checkpoint can never be read as a measured zero.
 */
export const QUANTILE_CONVENTION = 'linear interpolation between closest ranks (R-7)';

export function percentile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  if (!Number.isFinite(q) || q < 0 || q > 1) throw new Error('QUANTILE_OUT_OF_RANGE');
  if (sorted.length === 1) return sorted[0];
  const h = (sorted.length - 1) * q;
  const lower = Math.floor(h);
  const upper = Math.ceil(h);
  if (lower === upper) return sorted[lower];
  const weight = h - lower;
  return sorted[lower] + weight * (sorted[upper] - sorted[lower]);
}

export function sortedCopy(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

/**
 * Overflow-safe total.
 *
 * Every metric in this module is an exact integer before it is turned into a
 * ratio, so summation goes through BigInt and the result is refused when it no
 * longer fits the exact integer range instead of silently losing precision.
 */
export function safeTotal(values: readonly number[]): number {
  let total = 0n;
  for (const value of values) {
    if (!Number.isFinite(value)) throw new Error(`SAFE_TOTAL_NOT_FINITE: ${value}`);
    if (!Number.isSafeInteger(value)) throw new Error(`SAFE_TOTAL_NOT_INTEGER: ${value}`);
    total += BigInt(value);
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error('SAFE_TOTAL_OVERFLOW');
  }
  return Number(total);
}

export function summarize(values: readonly number[]): QuantileSummary {
  if (values.length === 0) {
    return { mean: null, median: null, p10: null, p25: null, p75: null, p90: null, p95: null };
  }
  const sorted = sortedCopy(values);
  const integral = sorted.every((value) => Number.isSafeInteger(value));
  const total = integral ? safeTotal(sorted) : sorted.reduce((sum, value) => sum + value, 0);
  return {
    mean: total / sorted.length,
    median: percentile(sorted, 0.5),
    p10: percentile(sorted, 0.1),
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
  };
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const integral = values.every((value) => Number.isSafeInteger(value));
  const total = integral ? safeTotal(values) : values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

/**
 * Exact quantile summary of an exact integer sample.
 *
 * The sample is summarized in BigInt/rational arithmetic; the `*Exact` decimal
 * strings are authoritative, and the numeric mirrors are presentation-only
 * doubles computed from those exact rationals.
 */
export function summarizeExact(
  values: readonly bigint[],
  scaleNumerator = 1n,
  scaleDenominator = 1n,
): QuantileSummaryExact {
  if (values.length === 0) {
    return {
      sampleSize: 0,
      mean: null, meanExact: null,
      median: null, medianExact: null,
      p10: null, p10Exact: null,
      p25: null, p25Exact: null,
      p75: null, p75Exact: null,
      p90: null, p90Exact: null,
      p95: null, p95Exact: null,
    };
  }
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const scale = (value: { numerator: bigint; denominator: bigint }) =>
    bigRational(value.numerator * scaleNumerator, value.denominator * scaleDenominator);
  const meanValue = scale(bigRationalMean(sorted)!);
  const median = scale(bigRationalPercentile(sorted, 1n, 2n)!);
  const p10 = scale(bigRationalPercentile(sorted, 1n, 10n)!);
  const p25 = scale(bigRationalPercentile(sorted, 1n, 4n)!);
  const p75 = scale(bigRationalPercentile(sorted, 3n, 4n)!);
  const p90 = scale(bigRationalPercentile(sorted, 9n, 10n)!);
  const p95 = scale(bigRationalPercentile(sorted, 19n, 20n)!);
  return {
    sampleSize: sorted.length,
    mean: bigRationalToPresentationNumber(meanValue),
    meanExact: bigRationalToDecimalString(meanValue, 10),
    median: bigRationalToPresentationNumber(median),
    medianExact: bigRationalToDecimalString(median, 10),
    p10: bigRationalToPresentationNumber(p10),
    p10Exact: bigRationalToDecimalString(p10, 10),
    p25: bigRationalToPresentationNumber(p25),
    p25Exact: bigRationalToDecimalString(p25, 10),
    p75: bigRationalToPresentationNumber(p75),
    p75Exact: bigRationalToDecimalString(p75, 10),
    p90: bigRationalToPresentationNumber(p90),
    p90Exact: bigRationalToDecimalString(p90, 10),
    p95: bigRationalToPresentationNumber(p95),
    p95Exact: bigRationalToDecimalString(p95, 10),
  };
}

/** Population standard deviation. Used for the reported volatility figure. */
export function standardDeviation(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** 95% confidence half-width of a mean, in the units of the sample. */
export function confidenceInterval95(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  return (1.96 * standardDeviation(values)) / Math.sqrt(values.length);
}

/**
 * Canonical payout histogram.
 *
 * Exhaustive, mutually exclusive, in this exact order:
 *
 *   0 | (0, 0.5) | [0.5, 1) | exactly 1 | (1, 2) | [2, 5) | [5, 10) |
 *   [10, 20) | [20, 30) | [30, 40) | [40, 50) | exactly 50 | > 50
 *
 * Exact 1x has its own bucket and is never merged into (1, 2); exact 50x has
 * its own bucket and is never merged into [40, 50) or into > 50. Every
 * non-negative return lands in exactly one bucket.
 */
export const FINE_PAYOUT_BINS = [
  { id: 'zero', label: '0', test: (x: number) => x === 0 },
  { id: 'gt0_lt0.5', label: '(0, 0.5)', test: (x: number) => x > 0 && x < 0.5 },
  { id: 'gte0.5_lt1', label: '[0.5, 1)', test: (x: number) => x >= 0.5 && x < 1 },
  { id: 'exactly1', label: '1', test: (x: number) => x === 1 },
  { id: 'gt1_lt2', label: '(1, 2)', test: (x: number) => x > 1 && x < 2 },
  { id: 'gte2_lt5', label: '[2, 5)', test: (x: number) => x >= 2 && x < 5 },
  { id: 'gte5_lt10', label: '[5, 10)', test: (x: number) => x >= 5 && x < 10 },
  { id: 'gte10_lt20', label: '[10, 20)', test: (x: number) => x >= 10 && x < 20 },
  { id: 'gte20_lt30', label: '[20, 30)', test: (x: number) => x >= 20 && x < 30 },
  { id: 'gte30_lt40', label: '[30, 40)', test: (x: number) => x >= 30 && x < 40 },
  { id: 'gte40_lt50', label: '[40, 50)', test: (x: number) => x >= 40 && x < 50 },
  { id: 'exactly50', label: '50', test: (x: number) => x === 50 },
  { id: 'gt50', label: '> 50', test: (x: number) => x > 50 },
] as const;

export function fineHistogram(returns: readonly number[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const bin of FINE_PAYOUT_BINS) counts[bin.id] = 0;
  for (const value of returns) {
    const bin = FINE_PAYOUT_BINS.find((candidate) => candidate.test(value));
    if (!bin) throw new Error(`PAYOUT_OUTSIDE_HISTOGRAM: ${value}`);
    counts[bin.id] += 1;
  }
  return counts;
}

/**
 * Coarse payout class for one complete paid round.
 *
 * Class boundaries follow the acceptance contract:
 *   ZERO            X = 0
 *   PARTIAL_RETURN  0 < X < 1        (the whole partial-return region)
 *   BREAK_EVEN      X = 1            (exactly the stake back)
 *   SMALL           1 < X < 2
 *   MEDIUM          2 <= X < bigWinMin
 *   BIG             bigWinMin <= X <= bigWinMax
 *   MAX             X > bigWinMax
 * The fine histogram below keeps a `[0.5, 1)` band as a reporting bucket; that
 * bucket is not the BREAK_EVEN class.
 */
export function payoutClass(returnMultiplier: number, bigWinMin: number, bigWinMax: number): PayoutClass {
  if (returnMultiplier === 0) return 'ZERO';
  if (returnMultiplier < 1) return 'PARTIAL_RETURN';
  if (returnMultiplier === 1) return 'BREAK_EVEN';
  if (returnMultiplier < 2) return 'SMALL';
  if (returnMultiplier < bigWinMin) return 'MEDIUM';
  if (returnMultiplier <= bigWinMax) return 'BIG';
  return 'MAX';
}

export function emptyClassHistogram(): Record<PayoutClass, number> {
  const counts = {} as Record<PayoutClass, number>;
  for (const value of PAYOUT_CLASSES) counts[value] = 0;
  return counts;
}

/**
 * Canonical JSON: object keys sorted recursively, arrays preserved.
 *
 * This is the hash input for immutable math artifacts. It is deliberately the
 * same shape of canonicalisation the vendored Lucky Lady engine uses for its
 * own profile hash, so an artifact hash is stable across hosts and runtimes.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = sortKeysDeep(source[key]);
    return out;
  }
  return value;
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Stable artifact hash: identity, engine identity, policy and payload only. */
export function canonicalProfileHash(input: {
  schemaVersion: number;
  profileId: string;
  gameId: string;
  engineSha256: string;
  rulesSha256: string;
  policy: unknown;
  payload: unknown;
}): string {
  return sha256Hex(
    canonicalJson({
      schemaVersion: input.schemaVersion,
      profileId: input.profileId,
      gameId: input.gameId,
      engineSha256: input.engineSha256,
      rulesSha256: input.rulesSha256,
      policy: input.policy,
      payload: input.payload,
    }),
  );
}

/**
 * Convert a stake multiple to exact integer simulation units.
 *
 * The conversion is exact rational arithmetic, not a floating-point multiply
 * with a tolerance: a multiplier that is not an exact integer number of units,
 * or a product beyond the exact integer range, is refused rather than rounded.
 * Prefer the string form for values that must not be rounded on the way in.
 */
export function multiplierToUnits(multiplier: number | string, stakeUnits: number): number {
  if (!Number.isSafeInteger(stakeUnits) || stakeUnits <= 0) {
    throw new Error('RETURN_UNITS_STAKE_INVALID: stakeUnits must be a positive safe integer');
  }
  const exactMultiplier = typeof multiplier === 'string'
    ? rationalFromDecimalString(multiplier)
    : rationalFromDecimal(multiplier);
  const product = bigRational(
    BigInt(exactMultiplier.numerator) * BigInt(stakeUnits),
    BigInt(exactMultiplier.denominator),
  );
  if (product.denominator !== 1n) {
    throw new Error(
      `RETURN_UNITS_NOT_INTEGRAL: ${multiplier} x ${stakeUnits} is not a whole number of units`,
    );
  }
  const units = toExactNumber(product.numerator);
  if (units === null) {
    throw new Error(`RETURN_UNITS_OUT_OF_RANGE: ${product.numerator} exceeds the exact integer range`);
  }
  return units;
}
