import type { SymbolId } from '../../../shared/types.js';

/**
 * Scatter-pays paytable, original to FOOL'S GOLD: OLYMPUS.
 *
 * Wins are awarded for 8+ of a symbol anywhere on the 6x5 board (position
 * irrelevant). Values are multipliers of TOTAL STAKE, in three count tiers.
 */
export interface PayTier {
  /** minimum count for this tier */
  min: number;
  /** multiplier of total stake */
  pay: number;
}

/** tiers are ordered high -> low so lookup takes the first match */
export const PAYTABLE: Record<SymbolId, PayTier[]> = {
  CROWN: [{ min: 12, pay: 50 }, { min: 10, pay: 25 }, { min: 8, pay: 10 }],
  LYRE: [{ min: 12, pay: 25 }, { min: 10, pay: 10 }, { min: 8, pay: 2.5 }],
  HELM: [{ min: 12, pay: 15 }, { min: 10, pay: 5 }, { min: 8, pay: 2 }],
  CHALICE: [{ min: 12, pay: 12 }, { min: 10, pay: 2 }, { min: 8, pay: 1.5 }],
  RING: [{ min: 12, pay: 10 }, { min: 10, pay: 1.5 }, { min: 8, pay: 1 }],
  EMERALD: [{ min: 12, pay: 8 }, { min: 10, pay: 1.2 }, { min: 8, pay: 0.8 }],
  AMETHYST: [{ min: 12, pay: 5 }, { min: 10, pay: 1 }, { min: 8, pay: 0.5 }],
  QUARTZ: [{ min: 12, pay: 4 }, { min: 10, pay: 0.9 }, { min: 8, pay: 0.4 }],
  PYRITE: [{ min: 12, pay: 2 }, { min: 10, pay: 0.75 }, { min: 8, pay: 0.25 }],

  // IDOL is the scatter: pays on count, and triggers free spins at 4+.
  IDOL: [{ min: 6, pay: 100 }, { min: 5, pay: 5 }, { min: 4, pay: 3 }],

  // ORB never forms a paying group; it only carries a multiplier value.
  ORB: [],
};

/**
 * Global paytable scale. Tuned against a 300k-spin simulation to land total
 * RTP near 96%. Scatter (IDOL) pays are excluded so the trigger economics stay
 * independent of symbol-pay tuning.
 */
export const PAY_SCALE = 1.08;

/** Minimum count for a normal symbol to pay. */
export const MIN_CLUSTER = 8;
/** Minimum scatter count to trigger free spins. */
export const SCATTER_TRIGGER = 4;

/** Free-spin rules. */
export const FREE_SPINS_INITIAL = 15;
export const FREE_SPINS_RETRIGGER = 5;
/** scatters needed on a free spin to retrigger */
export const RETRIGGER_SCATTERS = 3;

/**
 * Multiplier orb face values, weighted (free spins only).
 *
 * Uniform selection over a table containing 250 and 500 would give a mean of
 * ~49x per orb, which is why this is weighted: low values dominate, the
 * headline values are rare. Mean is ~5.2x per orb.
 */
export const ORB_TABLE: Array<[value: number, weight: number]> = [
  [2, 3000], [3, 2500], [4, 1500], [5, 1200], [6, 800], [8, 600],
  [10, 500], [12, 300], [15, 200], [20, 150], [25, 100],
  [50, 40], [100, 15], [250, 4], [500, 1],
];

export const ORB_TABLE_TOTAL = ORB_TABLE.reduce((s, [, w]) => s + w, 0);

/** Draw an orb value from the weighted table. */
export function pickOrbValue(roll: number): number {
  let r = roll % ORB_TABLE_TOTAL;
  for (const [value, weight] of ORB_TABLE) {
    if (r < weight) return value;
    r -= weight;
  }
  return ORB_TABLE[0][0];
}

/**
 * Returns the stake-multiplier for `count` of `symbol`, or 0 if it does not pay.
 */
export function payFor(symbol: SymbolId, count: number): number {
  const tiers = PAYTABLE[symbol];
  if (!tiers || tiers.length === 0) return 0;
  for (const t of tiers) {
    if (count >= t.min) {
      return symbol === 'IDOL' ? t.pay : Math.round(t.pay * PAY_SCALE * 1000) / 1000;
    }
  }
  return 0;
}
