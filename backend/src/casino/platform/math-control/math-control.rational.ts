import type { PayoutDistribution, Rational } from './math-control.types';

/**
 * Exact rational arithmetic for money-shaped mathematics.
 *
 * Payout distributions are weighted by integers, so an expected value can be
 * computed exactly. Anything that has to be *equal* to one - the canonical
 * worked example, or a break-even band - must not be compared through binary
 * floating point, where 0.5 + 0.3 + 0.12 + ... does not land on 1.
 */

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function gcdBig(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x === 0n ? 1n : x;
}

/** Guard every rational against silent precision loss. */
function toSafe(value: bigint, label: string): number {
  if (value > MAX_SAFE || value < -MAX_SAFE) {
    throw new Error(`RATIONAL_OVERFLOW: ${label} exceeds the exact integer range`);
  }
  return Number(value);
}

export function rational(numerator: number, denominator = 1): Rational {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) {
    throw new Error('RATIONAL_NOT_FINITE');
  }
  if (denominator === 0) throw new Error('RATIONAL_ZERO_DENOMINATOR');
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new Error('RATIONAL_NOT_SAFE_INTEGER');
  }
  let n = BigInt(numerator);
  let d = BigInt(denominator);
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const divisor = gcdBig(n, d);
  return { numerator: toSafe(n / divisor, 'numerator'), denominator: toSafe(d / divisor, 'denominator') };
}

/**
 * Exact rational from a decimal literal such as `0.5`, `12`, `1.25` or `1e-7`.
 *
 * Scientific notation is expanded through BigInt string arithmetic, never by
 * re-parsing the same number with the same lossy value, and a literal that
 * would need more than 15 significant digits is refused instead of silently
 * rounded.
 */
export function rationalFromDecimal(value: number): Rational {
  if (!Number.isFinite(value)) throw new Error('RATIONAL_NOT_FINITE');
  let text = String(value);
  if (text.includes('e') || text.includes('E')) {
    const [mantissa, exponentText] = text.toLowerCase().split('e');
    const exponent = Number(exponentText);
    if (!Number.isSafeInteger(exponent)) throw new Error('RATIONAL_PRECISION_UNSUPPORTED');
    const negative = mantissa.startsWith('-');
    const digits = (negative ? mantissa.slice(1) : mantissa).replace('.', '');
    const fractionDigits = mantissa.includes('.') ? mantissa.length - mantissa.indexOf('.') - 1 : 0;
    const scale = fractionDigits - exponent;
    if (scale < 0) {
      text = `${negative ? '-' : ''}${digits}${'0'.repeat(-scale)}`;
    } else if (scale === 0) {
      text = `${negative ? '-' : ''}${digits}`;
    } else if (scale >= digits.length) {
      text = `${negative ? '-' : ''}0.${'0'.repeat(scale - digits.length)}${digits}`;
    } else {
      const cut = digits.length - scale;
      text = `${negative ? '-' : ''}${digits.slice(0, cut)}.${digits.slice(cut)}`;
    }
  }
  const dot = text.indexOf('.');
  if (dot === -1) return rational(value, 1);
  const digits = text.replace('-', '').replace('.', '').replace(/^0+/, '');
  if (digits.length > 15) {
    throw new Error('RATIONAL_PRECISION_UNSUPPORTED: more than 15 significant digits');
  }
  const decimals = text.length - dot - 1;
  const denominator = BigInt(10) ** BigInt(decimals);
  const numerator = BigInt(text.replace('.', ''));
  return rational(toSafe(numerator, 'numerator'), toSafe(denominator, 'denominator'));
}

export function ratAdd(a: Rational, b: Rational): Rational {
  const numerator = BigInt(a.numerator) * BigInt(b.denominator) + BigInt(b.numerator) * BigInt(a.denominator);
  const denominator = BigInt(a.denominator) * BigInt(b.denominator);
  return rationalFromBig(numerator, denominator);
}

/**
 * Exact rational from a decimal string, including scientific notation.
 *
 * The literal is parsed digit by digit (never via `Number`), so `"1e-7"` and
 * `"0.0000001"` are the same exact value, and a literal that would need more
 * than 15 significant digits is refused instead of silently rounded.
 */
export function rationalFromDecimalString(text: string): Rational {
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text.trim());
  if (!match) throw new Error(`RATIONAL_LITERAL_INVALID: ${text}`);
  const [, sign, integerPart, fractionPart = '', exponentPart] = match;
  const exponent = exponentPart === undefined ? 0 : Number(exponentPart);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 400) {
    throw new Error(`RATIONAL_LITERAL_INVALID: ${text}`);
  }
  const digits = `${integerPart}${fractionPart}`.replace(/^0+(?=\d)/, '');
  if (digits.replace(/0+$/, '').length > 15) {
    throw new Error('RATIONAL_PRECISION_UNSUPPORTED: more than 15 significant digits');
  }
  const scale = fractionPart.length - exponent;
  let numerator = BigInt(digits === '' ? '0' : digits);
  if (sign === '-') numerator = -numerator;
  const denominator = scale >= 0 ? 10n ** BigInt(scale) : 1n;
  const scaledNumerator = scale >= 0 ? numerator : numerator * 10n ** BigInt(-scale);
  return rationalFromBig(scaledNumerator, denominator);
}

export function ratMul(a: Rational, b: Rational): Rational {
  return rationalFromBig(BigInt(a.numerator) * BigInt(b.numerator), BigInt(a.denominator) * BigInt(b.denominator));
}

/** Rational from BigInt terms, reduced exactly and checked against the safe range. */
export function rationalFromBig(numerator: bigint, denominator: bigint): Rational {
  if (denominator === 0n) throw new Error('RATIONAL_ZERO_DENOMINATOR');
  let n = numerator;
  let d = denominator;
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const divisor = gcdBig(n, d);
  return { numerator: toSafe(n / divisor, 'numerator'), denominator: toSafe(d / divisor, 'denominator') };
}

// ---------------------------------------------------------------------------
// Exact presentation helpers
//
// Money-shaped accumulators can legitimately exceed Number.MAX_SAFE_INTEGER, so
// they are carried as BigInt and rendered as decimal strings. A numeric mirror
// is produced only when the value is exactly representable; otherwise it is
// `null`, and no accounting figure is ever silently rounded.
// ---------------------------------------------------------------------------

export const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export function toExactNumber(value: bigint): number | null {
  if (value > MAX_SAFE_BIGINT || value < -MAX_SAFE_BIGINT) return null;
  return Number(value);
}

export function bigintToDecimalString(value: bigint): string {
  return value.toString(10);
}

/** Exact rational rendered as a decimal string with `digits` fraction digits. */
export function rationalToDecimalString(value: Rational, digits = 10): string {
  if (!Number.isInteger(digits) || digits < 0 || digits > 40) {
    throw new Error('RATIONAL_DECIMAL_DIGITS_INVALID');
  }
  const negative = value.numerator < 0;
  let numerator = BigInt(value.numerator < 0 ? -value.numerator : value.numerator);
  const denominator = BigInt(value.denominator);
  const scale = 10n ** BigInt(digits);
  // Round half up on the last rendered digit.
  const scaled = (numerator * scale * 2n + denominator) / (denominator * 2n);
  const integerPart = scaled / scale;
  const fractionPart = scaled % scale;
  const sign = negative && scaled !== 0n ? '-' : '';
  if (digits === 0) return `${sign}${integerPart}`;
  const fraction = fractionPart.toString(10).padStart(digits, '0').replace(/0+$/, '');
  return fraction.length === 0 ? `${sign}${integerPart}` : `${sign}${integerPart}.${fraction}`;
}

// ---------------------------------------------------------------------------
// Exact BigInt rationals
//
// Accounting figures can exceed Number.MAX_SAFE_INTEGER, so the exact rational
// type below keeps numerator and denominator as BigInt. Only the presentation
// mirror is allowed to be a double, and the decimal string is always
// authoritative.
// ---------------------------------------------------------------------------

export type BigRational = { numerator: bigint; denominator: bigint };

export function bigRational(numerator: bigint, denominator: bigint): BigRational {
  if (denominator === 0n) throw new Error('RATIONAL_ZERO_DENOMINATOR');
  let n = numerator;
  let d = denominator;
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const divisor = gcdBig(n, d);
  return { numerator: n / divisor, denominator: d / divisor };
}

export function bigRationalMean(values: readonly bigint[]): BigRational | null {
  if (values.length === 0) return null;
  let total = 0n;
  for (const value of values) total += value;
  return bigRational(total, BigInt(values.length));
}

/**
 * R-7 quantile of an exact integer sample, evaluated entirely in BigInt.
 *
 * `h = (n - 1) * qNumerator / qDenominator` is kept exact, so interpolation
 * between neighbouring samples never rounds an accounting figure.
 */
export function bigRationalPercentile(
  sorted: readonly bigint[],
  qNumerator: bigint,
  qDenominator: bigint,
): BigRational | null {
  if (sorted.length === 0) return null;
  if (qNumerator < 0n || qDenominator <= 0n || qNumerator > qDenominator) {
    throw new Error('QUANTILE_OUT_OF_RANGE');
  }
  if (sorted.length === 1) return bigRational(sorted[0], 1n);
  const position = BigInt(sorted.length - 1) * qNumerator;
  const lower = position / qDenominator;
  const remainder = position - lower * qDenominator;
  const upper = lower + 1n < BigInt(sorted.length) ? lower + 1n : lower;
  const base = sorted[Number(lower)];
  const delta = sorted[Number(upper)] - base;
  return bigRational(base * qDenominator + remainder * delta, qDenominator);
}

/** Decimal string of an exact BigInt rational, rounded half up at `digits`. */
export function bigRationalToDecimalString(value: BigRational, digits = 10): string {
  if (!Number.isInteger(digits) || digits < 0 || digits > 40) {
    throw new Error('RATIONAL_DECIMAL_DIGITS_INVALID');
  }
  const negative = value.numerator < 0n;
  const numerator = negative ? -value.numerator : value.numerator;
  const denominator = value.denominator;
  const scale = 10n ** BigInt(digits);
  const scaled = (numerator * scale * 2n + denominator) / (denominator * 2n);
  const integerPart = scaled / scale;
  const fractionPart = scaled % scale;
  const sign = negative && scaled !== 0n ? '-' : '';
  if (digits === 0) return `${sign}${integerPart}`;
  const fraction = fractionPart.toString(10).padStart(digits, '0').replace(/0+$/, '');
  return fraction.length === 0 ? `${sign}${integerPart}` : `${sign}${integerPart}.${fraction}`;
}

/**
 * Presentation mirror of an exact rational.
 *
 * Magnitude-normalised, exactly bounded conversion for display only.
 *
 * The ratio is rendered as a scientific literal with a fixed number of
 * significant digits through BigInt division - never by dividing one
 * `Number(numerator)` by another, which would itself overflow - and only then
 * parsed by the language's correctly rounded decimal parser. The result is
 * therefore:
 *
 *   - `0` for a zero numerator (with any non-zero denominator);
 *   - a finite non-zero double for any representable non-zero ratio, including
 *     `1e-300`, subnormal values and `1e300`;
 *   - an explicit `RationalPresentationError` for a zero denominator (including
 *     `0/0`), for overflow past `Number.MAX_VALUE`, and for underflow that the
 *     double format would flush to zero. Nothing is ever silently `Infinity`,
 *     `NaN` or `0`.
 *
 * This is presentation only: exact monetary totals stay integer `*Exact`
 * strings and rounded statistical strings stay separate.
 */
export function bigRationalToPresentationNumber(value: BigRational): number {
  const { numerator, denominator } = value;
  if (denominator === 0n) {
    throw new RationalPresentationError(
      'RATIONAL_DENOMINATOR_ZERO',
      'a rational with a zero denominator has no value to present',
    );
  }
  if (numerator === 0n) return 0;
  const negative = (numerator < 0n) !== (denominator < 0n);
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;

  // Range is decided by exact BigInt comparison, not by the rounded literal, so
  // a ratio only just outside the double range is still reported as overflow.
  // Half an ulp above the largest finite double is the true overflow boundary:
  // at or beyond it the correctly rounded double is Infinity.
  if (absNumerator >= absDenominator * MAX_OVERFLOW_THRESHOLD_BIGINT) {
    throw new RationalPresentationError(
      'RATIONAL_PRESENTATION_OVERFLOW',
      'the ratio rounds to infinity past the largest finite double',
    );
  }
  // Half of the smallest positive subnormal (2^-1075) rounds to zero.
  if ((absNumerator << 1075n) <= absDenominator) {
    throw new RationalPresentationError(
      'RATIONAL_PRESENTATION_UNDERFLOW',
      'the ratio is at or below half of the smallest positive subnormal double',
    );
  }

  const magnitudeText = bigRationalToScientificString(absNumerator, absDenominator, PRESENTATION_SIGNIFICANT_DIGITS);
  const parsed = Number(`${negative ? '-' : ''}${magnitudeText}`);
  if (!Number.isFinite(parsed)) {
    throw new RationalPresentationError(
      'RATIONAL_PRESENTATION_OVERFLOW',
      `the ratio exceeds the double range (${negative ? '-' : ''}${magnitudeText})`,
    );
  }
  if (parsed === 0) {
    throw new RationalPresentationError(
      'RATIONAL_PRESENTATION_UNDERFLOW',
      `the ratio is below the smallest subnormal double (${negative ? '-' : ''}${magnitudeText})`,
    );
  }
  return parsed;
}

/** Exact integer value of the largest finite double. */
export const MAX_FINITE_DOUBLE_BIGINT = BigInt(Number.MAX_VALUE);

/** Largest finite double plus half an ulp: at or above this the result is Infinity. */
export const MAX_OVERFLOW_THRESHOLD_BIGINT = MAX_FINITE_DOUBLE_BIGINT + 2n ** 970n;

/** Explicit conversion failure; the code distinguishes the three cases. */
export class RationalPresentationError extends Error {
  constructor(readonly code: 'RATIONAL_DENOMINATOR_ZERO' | 'RATIONAL_PRESENTATION_OVERFLOW' | 'RATIONAL_PRESENTATION_UNDERFLOW', detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'RationalPresentationError';
  }
}

/**
 * Significant digits used for the presentation literal. The double format
 * needs 17 to round-trip; 20 keeps the rounding decision stable.
 */
export const PRESENTATION_SIGNIFICANT_DIGITS = 20;

/**
 * Scientific literal `D.DDDDe±EE` for a positive exact ratio.
 *
 * The mantissa is produced by BigInt division at the requested precision and
 * rounded half-up on the last produced digit; the decimal exponent is found by
 * a bounded adjustment loop, so no `Number` arithmetic is involved before the
 * final parse.
 */
export function bigRationalToScientificString(
  numerator: bigint,
  denominator: bigint,
  digits = PRESENTATION_SIGNIFICANT_DIGITS,
): string {
  if (denominator === 0n) {
    throw new RationalPresentationError('RATIONAL_DENOMINATOR_ZERO', 'cannot render a ratio with a zero denominator');
  }
  if (numerator === 0n) return '0e0';
  if (!Number.isInteger(digits) || digits < 1 || digits > 60) {
    throw new Error('RATIONAL_PRESENTATION_DIGITS_INVALID');
  }
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;

  // Work with one guard digit so the final rounding is half-up on `digits`.
  const working = digits + 1;
  let exponent = absNumerator.toString().length - absDenominator.toString().length;
  let mantissa = 0n;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const shift = working - 1 - exponent;
    mantissa = shift >= 0
      ? (absNumerator * 10n ** BigInt(shift)) / absDenominator
      : absNumerator / (absDenominator * 10n ** BigInt(-shift));
    const length = mantissa.toString().length;
    if (length === working) break;
    exponent += length - working;
  }

  // Round half-up from `working` to `digits` significant digits.
  let rounded = ((mantissa + 5n) / 10n);
  if (rounded.toString().length > digits) {
    rounded /= 10n;
    exponent += 1;
  }
  const roundedDigits = rounded.toString();
  const head = roundedDigits.slice(0, 1);
  const tail = roundedDigits.slice(1);
  return tail.length === 0 ? `${head}e${exponent}` : `${head}.${tail}e${exponent}`;
}

export function ratToNumber(a: Rational): number {
  return a.numerator / a.denominator;
}

/**
 * Exact comparison. The cross-products are computed in BigInt, so two large
 * rationals can never be mis-ordered by losing precision in a `number`
 * multiplication.
 */
export function ratEquals(a: Rational, b: Rational): boolean {
  assertSafeTerm(a, 'left');
  assertSafeTerm(b, 'right');
  const left = normalizeTerms(a);
  const right = normalizeTerms(b);
  return left.numerator * right.denominator === right.numerator * left.denominator;
}

export function ratCompare(a: Rational, b: Rational): number {
  assertSafeTerm(a, 'left');
  assertSafeTerm(b, 'right');
  // A raw Rational can arrive with a negative denominator; normalise the sign
  // first so cross-multiplication cannot invert the ordering.
  const leftTerm = normalizeTerms(a);
  const rightTerm = normalizeTerms(b);
  const left = leftTerm.numerator * rightTerm.denominator;
  const right = rightTerm.numerator * leftTerm.denominator;
  return left === right ? 0 : left < right ? -1 : 1;
}

function normalizeTerms(value: Rational): { numerator: bigint; denominator: bigint } {
  let numerator = BigInt(value.numerator);
  let denominator = BigInt(value.denominator);
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  return { numerator, denominator };
}

function assertSafeTerm(value: Rational, label: string) {
  if (
    !Number.isSafeInteger(value.numerator) || !Number.isSafeInteger(value.denominator) ||
    value.denominator === 0
  ) {
    throw new Error(`RATIONAL_NOT_SAFE_INTEGER: ${label} term is not an exact integer ratio`);
  }
}

/** Exact sum of a list of rationals; the result is guarded against overflow. */
export function ratSum(values: readonly Rational[]): Rational {
  let numerator = 0n;
  let denominator = 1n;
  for (const value of values) {
    assertSafeTerm(value, 'term');
    numerator = numerator * BigInt(value.denominator) + BigInt(value.numerator) * denominator;
    denominator *= BigInt(value.denominator);
    const divisor = gcdBig(numerator, denominator);
    numerator /= divisor;
    denominator /= divisor;
  }
  return rationalFromBig(numerator, denominator);
}

export function ratToString(a: Rational): string {
  return a.denominator === 1 ? `${a.numerator}` : `${a.numerator}/${a.denominator}`;
}

/**
 * Exact expected value of a weighted payout distribution.
 *
 * Returns the expected multiplier as an exact rational: for a distribution
 * whose weights sum to `totalWeight`, EV = sum(weight x multiplier) / totalWeight.
 */
export function distributionExpectedValue(distribution: PayoutDistribution): Rational {
  const { bands, totalWeight } = distribution;
  if (!Number.isSafeInteger(totalWeight) || totalWeight <= 0) {
    throw new Error('DISTRIBUTION_TOTAL_WEIGHT_INVALID');
  }
  let numerator = 0n;
  let denominator = 1n;
  for (const band of bands) {
    if (!Number.isSafeInteger(band.weight) || band.weight < 0) {
      throw new Error('DISTRIBUTION_WEIGHT_INVALID');
    }
    // Each term is (weight / totalWeight) * (numerator / denominator); the
    // accumulation stays in BigInt so no intermediate rounding can occur.
    const termNumerator = BigInt(band.weight) * BigInt(band.multiplier.numerator);
    const termDenominator = BigInt(totalWeight) * BigInt(band.multiplier.denominator);
    numerator = numerator * termDenominator + termNumerator * denominator;
    denominator *= termDenominator;
    const divisor = gcdBig(numerator, denominator);
    numerator /= divisor;
    denominator /= divisor;
  }
  return rationalFromBig(numerator, denominator);
}

/** Exact expected value expressed in percent (EV x 100). */
export function distributionExpectedPercent(distribution: PayoutDistribution): Rational {
  const ev = distributionExpectedValue(distribution);
  return rationalFromBig(BigInt(ev.numerator) * 100n, BigInt(ev.denominator));
}

/**
 * The canonical distribution from the control-plane specification.
 *
 * `[0:.5, .5:.3, 1:.12, 2:.05, 12:.02, 30:.004, 40:.003, 50:.003]`
 *
 * Weights are scaled to integers out of one thousand so the total is exactly
 * one and the expected value is exactly 1.0 (100%).
 */
export const CANONICAL_EXAMPLE_DISTRIBUTION: PayoutDistribution = {
  totalWeight: 1000,
  bands: [
    { multiplier: rational(0, 1), weight: 500 },
    { multiplier: rational(1, 2), weight: 300 },
    { multiplier: rational(1, 1), weight: 120 },
    { multiplier: rational(2, 1), weight: 50 },
    { multiplier: rational(12, 1), weight: 20 },
    { multiplier: rational(30, 1), weight: 4 },
    { multiplier: rational(40, 1), weight: 3 },
    { multiplier: rational(50, 1), weight: 3 },
  ],
};
