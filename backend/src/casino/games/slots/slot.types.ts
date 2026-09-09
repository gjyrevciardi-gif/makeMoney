/**
 * Slot domain types.
 *
 * A slot game is entirely described by its definition: strips, paylines,
 * paytable, symbol behaviour, and payout semantics. Adding a new slot means
 * adding a new validated definition, never new wallet, RNG, or accounting code.
 *
 * ---------------------------------------------------------------------------
 * Payout semantics (one definition, used everywhere)
 * ---------------------------------------------------------------------------
 *
 * A spin commits a single total `stake`. All paylines are always active, so
 *
 *   betPerLine = stake / lineCount
 *
 * Paytable entries are in hundredths of the *bet per line*; scatter tiers are
 * in hundredths of the *total stake*. Both are combined into one integer
 * numerator so nothing is ever rounded twice:
 *
 *   returnNumerator = sum(lineCenti) + lineCount * scatterCenti
 *   payout          = floor(stake * returnNumerator / (lineCount * 100))
 *   totalReturn     = returnNumerator / (lineCount * 100)   (x total stake)
 *
 * Every value is an integer in hundredths, and the payout is a single BigInt
 * floor division, so no payout decision touches binary floating point.
 */

export type SlotSymbolType = 'NORMAL' | 'WILD' | 'SCATTER';

export type SlotSymbol = {
  id: string;
  name: string;
  type: SlotSymbolType;
};

/** One payline: a row index per reel, evaluated left to right from reel 1. */
export type SlotPayline = {
  id: number;
  rows: number[];
};

/** symbolId -> matched count (3..reels) -> multiplier in centi of bet per line. */
export type SlotPaytable = Record<string, Record<number, number>>;

/** Scatter count -> multiplier in centi of total stake. Counts at or above the
 *  highest declared tier pay that tier. */
export type SlotScatterRule = {
  symbolId: string;
  minimumCount: number;
  tiers: Record<number, number>;
};

export type SlotVolatility = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * An immutable, versioned slot game. `declaredRtpBps` is validated against the
 * exact value computed from this very definition at startup, so the metadata
 * can never drift from the mathematics it claims to describe.
 */
export type SlotGameDefinition = {
  gameId: string;
  name: string;
  description: string;
  mathVersion: number;
  reels: number;
  rows: number;
  symbols: SlotSymbol[];
  /** One strip per reel, as symbol ids. Reel stops index into these. */
  strips: string[][];
  paylines: SlotPayline[];
  paytable: SlotPaytable;
  scatter: SlotScatterRule | null;
  /** Structural cap on the total return, in centi of total stake. */
  maxWinCenti: number;
  volatility: SlotVolatility;
  /** Exact theoretical RTP in basis points; verified against the computed value. */
  declaredRtpBps: number;
};

export type SlotLineWin = {
  lineId: number;
  symbolId: string;
  count: number;
  /** Multiplier in centi of the bet per line. */
  multiplierCenti: number;
  /** Board positions [row, reel] that formed the win, for highlighting. */
  positions: [number, number][];
};

export type SlotScatterWin = {
  symbolId: string;
  count: number;
  /** Multiplier in centi of the total stake. */
  multiplierCenti: number;
  positions: [number, number][];
};

export type SlotSpinResult = {
  stops: number[];
  /** matrix[row][reel] — orientation is fixed and covered by tests. */
  matrix: string[][];
  lineWins: SlotLineWin[];
  scatterWin: SlotScatterWin | null;
  /** sum(lineCenti) + lineCount * scatterCenti, after any cap. */
  returnNumerator: number;
  /** True when the structural max-win cap actually reduced the return. */
  capped: boolean;
  /** Total return as a display string, x total stake. */
  totalMultiplier: string;
};
