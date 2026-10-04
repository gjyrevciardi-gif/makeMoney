import { createHash } from 'node:crypto';

/**
 * Deterministic, independent simulation streams.
 *
 * Every seed domain in the control plane is separate by construction:
 * calibration, independent validation and bankroll simulation each build their
 * seeds from a distinct prefix, and each session inside a cohort draws from its
 * own stream. Reproducing a run therefore never means reusing another run's
 * randomness, and none of this touches the production draw path, which stays
 * the OS CSPRNG behind the game's own `int(min, max)` interface.
 */
export type SimulationRng = { int(min: number, max: number): number };

/** sfc32: fast, deterministic, well-distributed, seeded by SHA-256. */
export function createSimulationRng(seed: string): SimulationRng {
  const digest = createHash('sha256').update(seed).digest();
  let a = digest.readUInt32BE(0);
  let b = digest.readUInt32BE(4);
  let c = digest.readUInt32BE(8);
  let d = digest.readUInt32BE(12);

  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0);
  };

  // Warm-up: discard a few outputs so closely related seeds diverge immediately.
  for (let i = 0; i < 12; i += 1) next();

  const UINT32 = 0x1_0000_0000;

  return {
    int(min: number, max: number) {
      if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
        throw new Error('SIMULATION_RNG_INVALID_BOUNDS');
      }
      const span = max - min + 1;
      if (!Number.isSafeInteger(span) || span <= 0 || span > UINT32) {
        throw new Error('SIMULATION_RNG_INVALID_SPAN');
      }
      if (span === 1) return min;
      // Unbiased rejection sampling: no modulo bias, same contract as the engine.
      const limit = Math.floor(UINT32 / span) * span;
      let draw = next();
      while (draw >= limit) draw = next();
      return min + (draw % span);
    },
  };
}

/** Deterministic seed list for one cohort; every session gets its own stream. */
export function cohortSeeds(prefix: string, count: number): string[] {
  const seeds: string[] = [];
  for (let index = 0; index < count; index += 1) seeds.push(`${prefix}:${index}`);
  return seeds;
}
