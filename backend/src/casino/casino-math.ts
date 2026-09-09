/**
 * Shared exact combinatorics for casino game mathematics.
 *
 * Everything here is integer-only BigInt arithmetic so that probability
 * denominators stay exact for any board or row count we support.
 */

/** Exact binomial coefficient C(n, k). */
export function binomial(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n;
  const upper = Math.min(k, n - k);
  let result = 1n;
  for (let step = 0; step < upper; step += 1) {
    result = (result * BigInt(n - step)) / BigInt(step + 1);
  }
  return result;
}

/** Exact 2^n. */
export const twoPow = (n: number) => 1n << BigInt(n);
