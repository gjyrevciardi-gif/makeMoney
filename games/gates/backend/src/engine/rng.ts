import { randomInt, randomBytes } from 'node:crypto';

/**
 * Production RNG. Node CSPRNG only - never Math.random().
 *
 * `randomInt` is rejection-sampled by Node, so it is uniform over [0, max).
 */
export interface Rng {
  /** uniform integer in [0, max) */
  int(max: number): number;
  /** uniform float in [0, 1) */
  float(): number;
  pick<T>(items: readonly T[]): T;
}

export const cryptoRng: Rng = {
  int(max: number): number {
    if (max <= 0) throw new RangeError(`rng.int: max must be > 0, got ${max}`);
    if (max === 1) return 0;
    return randomInt(max);
  },
  float(): number {
    // 48 bits of entropy -> double in [0,1)
    const b = randomBytes(6);
    const v = b.readUIntBE(0, 6);
    return v / 2 ** 48;
  },
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('rng.pick: empty array');
    return items[this.int(items.length)];
  },
};

/**
 * Deterministic RNG for tests and DEV TEST VECTORS ONLY.
 *
 * This is NOT an outcome control. It is only reachable when the server is
 * started with TEST_MODE=1, and it seeds the same engine that production uses -
 * it does not bias, re-roll, or filter results. See testVectors.ts.
 */
export function seededRng(seed: number): Rng {
  // mulberry32 - small, fast, good enough for reproducible fixtures
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    int(max: number): number {
      if (max <= 0) throw new RangeError(`rng.int: max must be > 0, got ${max}`);
      return Math.floor(next() * max) % max;
    },
    float: next,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new RangeError('rng.pick: empty array');
      return items[rng.int(items.length)];
    },
  };
  return rng;
}
