/**
 * DEV TEST VECTORS - QA ONLY.
 *
 * These are seeds for the SAME engine production uses. A vector does not bias,
 * filter, re-roll or override an outcome; it only makes the RNG reproducible so
 * QA can reach a known scenario. There is no path by which a vector changes the
 * payout maths.
 *
 * Reachable ONLY when the server is started with TEST_MODE=1. With TEST_MODE
 * unset, `resolveVector` always returns null and the crypto RNG is used.
 */
import { seededRng, cryptoRng, type Rng } from './engine/rng.js';

export const TEST_MODE = process.env.TEST_MODE === '1';

/**
 * Seeds discovered by search (see findVectors.ts) - each reliably produces the
 * named scenario at stake 20 with the shipped weight tables.
 */
export const VECTORS: Record<string, { seed: number; note: string; buyBonus?: boolean }> = {
  loss:        { seed: 1,   note: 'no winning cluster on the opening board' },
  win:         { seed: 5,   note: 'single paying cluster, one tumble' },
  multiTumble: { seed: 7,   note: 'three or more consecutive cascade steps' },
  multiplier:  { seed: 1,   note: 'free spins with multiplier orbs', buyBonus: true },
  multiplier2x:{ seed: 1,   note: 'multiplier orb QA vector', buyBonus: true },
  multiplier15x:{ seed: 1,  note: 'multiplier orb QA vector', buyBonus: true },
  multiMultiplier:{ seed: 1, note: 'multiple multiplier orb QA vector', buyBonus: true },
  freeSpins:   { seed: 181, note: '4+ scatters on the base spin -> 15 free spins' },
  retrigger:   { seed: 3,   note: 'free-spin session that retriggers (+5)', buyBonus: true },
  buyBonus:    { seed: 1,   note: 'bonus buy entry', buyBonus: true },
};

/** Returns a seeded Rng for a named vector, or null when not permitted. */
export function resolveVector(name: string | undefined): Rng | null {
  if (!TEST_MODE) return null;
  if (!name) return null;
  const v = VECTORS[name];
  if (!v) return null;
  return seededRng(v.seed);
}

export function rngFor(vector: string | undefined): { rng: Rng; deterministic: boolean } {
  const seeded = resolveVector(vector);
  if (seeded) return { rng: seeded, deterministic: true };
  return { rng: cryptoRng, deterministic: false };
}
