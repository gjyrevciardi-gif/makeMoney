/**
 * Tumbling "pays anywhere" slot domain types.
 *
 * This is a second, independent slot family alongside the fixed-payline engine
 * in `slot.types.ts`. Nothing is shared between them beyond the fairness stream
 * and the round lifecycle, so neither can perturb the other's mathematics.
 *
 * ---------------------------------------------------------------------------
 * Payout semantics (one definition, used everywhere)
 * ---------------------------------------------------------------------------
 *
 * There are no paylines. A paying symbol wins when at least `minCluster` copies
 * are visible anywhere on the board, and every multiplier in this family is in
 * hundredths of ONE BET - never of the charged stake, which differs when the
 * feature is bought.
 *
 *   spinCenti   = sum over drops of (band centi of each symbol that paid)
 *   winCenti    = spinCenti * appliedMultiplier + scatterCenti
 *   roundCenti  = min(sum of winCenti, maxWinCenti)
 *   payout      = floor(bet * roundCenti / 100)
 *
 * Everything is an integer in hundredths and the payout is a single BigInt
 * floor division, so no payout decision touches binary floating point.
 *
 * ---------------------------------------------------------------------------
 * Wire shape
 * ---------------------------------------------------------------------------
 *
 * A session can run to hundreds of spins, each with a chain of drops, so a
 * board is carried as one string per row with one character per reel. Anything
 * a browser can derive - which cells hold a winning symbol, where the scatters
 * are, which cells are about to clear - is derived there rather than repeated
 * in every step, which keeps a stored round small enough to be an ordinary row.
 */

export type TumbleSymbolType = 'PAY' | 'SCATTER' | 'ORB';

export type TumbleSymbol = {
  id: string;
  name: string;
  type: TumbleSymbolType;
  /** Single character used to encode this symbol on the wire. */
  code: string;
};

/** A paytable band: `min` copies or more pay `centi` hundredths of one bet. */
export type TumbleTier = {
  min: number;
  centi: number;
};

/** One multiplier orb face and its drawing weight. */
export type TumbleOrbFace = {
  value: number;
  weight: number;
};

/**
 * An immutable, versioned tumbling slot.
 *
 * Unlike the payline family this game's return has no closed form - tumbling
 * and a cumulative session multiplier make the state space unbounded - so the
 * declared RTP is a simulated figure reproduced by `tumble.rtp.ts` in the test
 * suite rather than an exact enumeration. `validateTumbleDefinition` therefore
 * checks structure and bounds at startup and never claims exactness.
 */
export type TumbleGameDefinition = {
  gameId: string;
  name: string;
  description: string;
  mathVersion: number;
  reels: number;
  rows: number;
  symbols: TumbleSymbol[];
  /** Drawing weight per paying symbol id. */
  symbolWeights: Record<string, number>;
  /** Copies required before a paying symbol pays anything. */
  minCluster: number;
  /** symbolId -> bands, highest `min` first. Centi of one bet. */
  paytable: Record<string, TumbleTier[]>;
  /** Chance out of 1000 that a reel carries a scatter on the opening drop. */
  scatterReelWeight: number;
  /** Chance out of 10000 that a filled cell is a multiplier orb. */
  orbWeight: number;
  orbFaces: TumbleOrbFace[];
  /** Scatter count -> centi of one bet. Counts above the top band pay it. */
  scatterPay: Record<number, number>;
  freeSpins: {
    /** Scatters needed on an opening drop to start the feature. */
    trigger: number;
    /** Spins granted on a trigger. */
    award: number;
    /** Scatters needed during the feature to extend it. */
    retrigger: number;
    /** Spins added by a retrigger. */
    retriggerAward: number;
    /** Structural ceiling on one session, so a session always terminates. */
    maxSpins: number;
  };
  /** Cost of buying the feature, in centi of one bet. */
  buyFeatureCenti: number;
  /** Structural cap on the round's return, in centi of one bet. */
  maxWinCenti: number;
  /** Structural ceiling on one tumble chain, so a spin always terminates. */
  maxTumbles: number;
  volatility: 'LOW' | 'MEDIUM' | 'HIGH';
  /** Simulated theoretical RTP in basis points, verified by the test suite. */
  declaredRtpBps: number;
};

/** One board cell. `orbValue` is present exactly when the symbol is the orb. */
export type TumbleCell = {
  symbol: string;
  orbValue?: number;
};

/** One symbol that paid on a drop. Every copy of it then clears. */
export type TumbleWin = {
  symbolId: string;
  count: number;
  /** Centi of one bet. */
  centi: number;
};

/** One drop of the board inside a tumble chain, as the browser replays it. */
export type TumbleStep = {
  /** One string per row, one symbol code per reel. Row 0 is the top row. */
  rows: string[];
  /** Multiplier orbs visible on this board. */
  orbs: { row: number; reel: number; value: number }[];
  wins: TumbleWin[];
  /** Centi of one bet won on this drop, before any multiplier. */
  winCenti: number;
};

/** One complete spin: an opening drop plus every tumble it caused. */
export type TumbleSpin = {
  steps: TumbleStep[];
  scatterCount: number;
  /** Centi of one bet paid by the scatters themselves. Never multiplied. */
  scatterCenti: number;
  /** Sum of the orb faces left on the board when the chain ended. */
  orbTotal: number;
  /** The multiplier this spin's symbol wins were actually paid at. */
  appliedMultiplier: number;
  /** Sum of every drop's `winCenti`, before the multiplier. */
  rawCenti: number;
  /** `rawCenti * appliedMultiplier + scatterCenti`. */
  winCenti: number;
};

export type TumbleRetrigger = {
  /** Zero-based index of the free spin that retriggered. */
  spinIndex: number;
  scatterCount: number;
  award: number;
};

export type TumbleFeature = {
  spins: TumbleSpin[];
  /** Total free spins granted, including retriggers. */
  awarded: number;
  retriggers: TumbleRetrigger[];
  /** The cumulative session multiplier after each spin, index-aligned. */
  multiplierAfter: number[];
  /** Centi of one bet won across the whole session. */
  totalCenti: number;
  /** True when the structural spin ceiling ended the session early. */
  truncated: boolean;
};

export type TumbleMode = 'BASE' | 'BUY_FEATURE';

/** The full authoritative result of one round, replayed by the browser. */
export type TumbleRoundResult = {
  mode: TumbleMode;
  /** Null only when the feature was bought, which skips the paid spin. */
  base: TumbleSpin | null;
  feature: TumbleFeature | null;
  /** Centi of one bet, after the structural cap. */
  totalCenti: number;
  capped: boolean;
  /** Total return as a display string, x one bet. */
  totalMultiplier: string;
};
