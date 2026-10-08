/**
 * FOOL'S GOLD: OLYMPUS - shared wire contract.
 *
 * The server produces one authoritative RoundResponse per round. The frontend
 * ONLY animates it. The client never generates a symbol, a win, or a balance.
 */

export const REELS = 6;
export const ROWS = 5;
export const CELLS = REELS * ROWS; // 30

/** Symbol ids. Board cells hold these. */
export type SymbolId =
  | 'PYRITE'   // low  - fool's gold nugget
  | 'QUARTZ'   // low
  | 'AMETHYST' // low
  | 'EMERALD'  // low
  | 'RING'     // low-mid
  | 'CHALICE'  // mid
  | 'HELM'     // mid-high
  | 'LYRE'     // high
  | 'CROWN'    // top
  | 'IDOL'     // scatter (pays + triggers free spins)
  | 'ORB';     // multiplier orb (free spins only, no line pay)

export const PAY_SYMBOLS: SymbolId[] = [
  'PYRITE', 'QUARTZ', 'AMETHYST', 'EMERALD', 'RING', 'CHALICE', 'HELM', 'LYRE', 'CROWN',
];
export const SCATTER: SymbolId = 'IDOL';
export const MULTIPLIER: SymbolId = 'ORB';

/** Board is column-major: board[reel][row]. reel 0..5, row 0..4. */
export type Board = SymbolId[][];

/** A winning cluster within one cascade step. */
export interface WinGroup {
  symbol: SymbolId;
  count: number;
  /** flat positions, index = reel * ROWS + row */
  positions: number[];
  /** payout in PTS for this group, before multipliers */
  win: number;
}

/** A multiplier orb present on the board during a step. */
export interface OrbData {
  position: number;
  value: number;
}

/** One tumble step. The client animates these in order. */
export interface RoundStep {
  index: number;
  /** board state at the START of this step */
  board: Board;
  winningPositions: number[];
  groups: WinGroup[];
  /** raw win for this step, before multiplier application */
  win: number;
  /** orbs visible this step (free spins only) */
  multiplierData: OrbData[];
  /** board after removal + tumble; null when the sequence ends */
  boardAfter: Board | null;
}

export type SpinKind = 'BASE' | 'FREE' | 'BUY';

/** A single spin (base game spin, or one free spin) and all its tumbles. */
export interface SpinResult {
  kind: SpinKind;
  /** 1-based index within a free-spin session, else 0 */
  freeSpinNumber: number;
  freeSpinsTotal: number;
  initialBoard: Board;
  steps: RoundStep[];
  /** sum of step wins before multiplier */
  baseWin: number;
  /** orbs collected this spin */
  orbs: OrbData[];
  /** total orb multiplier applied at end of this spin (free spins) */
  appliedMultiplier: number;
  /** final credited win for this spin */
  spinWin: number;
  /** scatter count on the initial board */
  scatterCount: number;
  /** free spins awarded by this spin (trigger or retrigger) */
  freeSpinsAwarded: number;
  /** scatter pay awarded on this spin */
  scatterPay: number;
}

export interface RoundResponse {
  roundId: string;
  stake: number;
  kind: SpinKind;
  /** convenience mirror of spins[0] for milestone-1 clients */
  initialBoard: Board;
  steps: RoundStep[];
  /** every spin in the round: 1 base spin, plus any free spins */
  spins: SpinResult[];
  freeSpins: {
    triggered: boolean;
    total: number;
    retriggers: number;
    /** accumulated multiplier progression across the session */
    accumulated: number;
  };
  finalWin: number;
  balanceAfter: number;
  /** server time, ms */
  createdAt: number;
}

export interface BalanceResponse {
  playerId: string;
  balance: number;
  currency: 'PTS';
}

export type LedgerType = 'BET' | 'WIN' | 'BONUS_BUY' | 'VOID';

export interface LedgerEvent {
  id: string;
  roundId: string;
  type: LedgerType;
  amount: number;
  balanceAfter: number;
  createdAt: number;
}

export interface SpinRequest {
  stake: number;
  /** client-generated idempotency key; same key must never settle twice */
  roundId: string;
  buyBonus?: boolean;
  /** DEV TEST MODE ONLY - ignored unless the server runs with TEST_MODE=1 */
  testVector?: string;
}

export const STAKE_LEVELS = [
  20, 40, 60, 100, 200, 400, 600, 1000, 2000, 4000,
];

export const STARTING_BALANCE = 100_000;
/** Buy Bonus costs 100x the stake, the standard for this mechanic. */
export const BUY_BONUS_COST_MULTIPLIER = 100;
