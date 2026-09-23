import { buildTables, playFeature, playSpin } from './tumble.engine';
import { TumbleGameDefinition, TumbleMode } from './tumble.types';

/**
 * Simulated return analysis for the tumbling family.
 *
 * The payline engine's return is enumerated exactly, because a fixed set of
 * reel stops is finite. This family has no such closed form: a chain can tumble
 * an unbounded number of times and a session carries a multiplier that never
 * resets, so the state space is unbounded. The honest measurement is therefore
 * a simulation, and it is reported as one - never as a certification and never
 * as an exact figure.
 *
 * The simulation deliberately does NOT use the fairness stream. HMAC per draw
 * would make a few million rounds take hours, and the stream's uniformity is
 * already established on its own terms by `FairnessStream.nextBelow`'s
 * rejection sampling. What this file measures is the *mathematics* of the
 * definition, fed by an unbiased uniform source.
 */

/**
 * A fast, deterministic uniform source with the same contract as the fairness
 * stream: `nextBelow(bound)` is uniform on `[0, bound)` via the same rejection
 * rule, so a residue bias can never creep into a measured figure.
 */
export class SimulationStream {
  private state: number;

  constructor(seed: number) {
    // Any non-zero state works; mixing keeps nearby seeds from correlating.
    this.state = (seed ^ 0x9e37_79b9) >>> 0;
  }

  private nextUint32(): number {
    // mulberry32: small, fast, and well distributed over 32 bits.
    this.state = (this.state + 0x6d2b_79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0);
  }

  nextBelow(bound: number): number {
    if (!Number.isInteger(bound) || bound < 1) {
      throw new RangeError('bound must be a positive integer');
    }
    if (bound === 1) return 0;
    const limit = Math.floor(0x1_0000_0000 / bound) * bound;
    for (;;) {
      const draw = this.nextUint32();
      if (draw < limit) return draw % bound;
    }
  }
}

export type TumbleSimulation = {
  mode: TumbleMode;
  rounds: number;
  /** Centi of one bet staked in total. */
  wageredCenti: number;
  /** Centi of one bet returned in total, after the structural cap. */
  returnedCenti: number;
  rtpBps: number;
  rtpPercent: string;
  /** Share of rounds that returned anything at all. */
  hitRate: number;
  /** Share of base rounds that opened the feature. */
  featureRate: number;
  /** Largest single round return, in centi of one bet. */
  maxRoundCenti: number;
  /** Rounds the structural cap actually reduced. */
  cappedRounds: number;
  /** Mean free spins played in a session, when one happened. */
  meanFeatureSpins: number;
};

/**
 * Measures a definition's return over `rounds` simulated rounds.
 *
 * Deliberately re-implements the round loop rather than calling
 * `resolveTumbleRound`, so it can run against the cheap uniform source and skip
 * building the wire projection for every drop of every spin. The payout
 * arithmetic below is the same arithmetic the engine applies.
 */
export function simulateTumbleRtp(
  definition: TumbleGameDefinition,
  options: { rounds: number; mode?: TumbleMode; seed?: number } = { rounds: 100_000 },
): TumbleSimulation {
  const mode: TumbleMode = options.mode ?? 'BASE';
  const rounds = options.rounds;
  const stream = new SimulationStream(options.seed ?? 1);
  const tables = buildTables(definition);
  const stakeCenti = mode === 'BASE' ? 100 : definition.buyFeatureCenti;

  let returnedCenti = 0;
  let hits = 0;
  let features = 0;
  let featureSpins = 0;
  let maxRoundCenti = 0;
  let cappedRounds = 0;

  for (let round = 0; round < rounds; round += 1) {
    let raw = 0;
    let entersFeature = mode === 'BUY_FEATURE';
    if (mode === 'BASE') {
      const base = playSpin(stream, definition, tables, 0).spin;
      raw += base.winCenti;
      entersFeature = base.scatterCount >= definition.freeSpins.trigger;
    }
    if (entersFeature) {
      const feature = playFeature(stream, definition, tables);
      raw += feature.totalCenti;
      features += 1;
      featureSpins += feature.spins.length;
    }
    const capped = raw > definition.maxWinCenti;
    const total = capped ? definition.maxWinCenti : raw;
    if (capped) cappedRounds += 1;
    if (total > 0) hits += 1;
    if (total > maxRoundCenti) maxRoundCenti = total;
    returnedCenti += total;
  }

  const wageredCenti = rounds * stakeCenti;
  const rtpBps = Math.round((returnedCenti / wageredCenti) * 10_000);
  return {
    mode,
    rounds,
    wageredCenti,
    returnedCenti,
    rtpBps,
    rtpPercent: ((returnedCenti / wageredCenti) * 100).toFixed(4),
    hitRate: hits / rounds,
    featureRate: features / rounds,
    maxRoundCenti,
    cappedRounds,
    meanFeatureSpins: features ? featureSpins / features : 0,
  };
}
