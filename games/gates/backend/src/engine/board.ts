import {
  REELS, ROWS, type Board, type SymbolId,
} from '../../../shared/types.js';
import type { Rng } from './rng.js';

/**
 * Per-reel symbol weights. Original distribution for FOOL'S GOLD: OLYMPUS.
 *
 * Weights are drawn independently per cell (this is a scatter-pays tumble game,
 * so there are no fixed reel strips - each landing cell is an independent draw
 * from its reel's weight table). Higher-value symbols are rarer.
 */
type WeightTable = Array<[SymbolId, number]>;

const BASE_WEIGHTS: WeightTable = [
  ['PYRITE', 120],
  ['QUARTZ', 110],
  ['AMETHYST', 100],
  ['EMERALD', 92],
  ['RING', 78],
  ['CHALICE', 60],
  ['HELM', 46],
  ['LYRE', 32],
  ['CROWN', 20],
  ['IDOL', 16],
];

/** Free-spin reels: no scatter-heavy bias, plus multiplier orbs. */
const FREE_WEIGHTS: WeightTable = [
  ['PYRITE', 118],
  ['QUARTZ', 108],
  ['AMETHYST', 98],
  ['EMERALD', 90],
  ['RING', 76],
  ['CHALICE', 58],
  ['HELM', 45],
  ['LYRE', 31],
  ['CROWN', 19],
  ['IDOL', 10],
  ['ORB', 6],
];

/**
 * Tumble refill weights - same as the spin they belong to, so a cascade does
 * not change the distribution mid-sequence.
 */
export function weightsFor(kind: 'BASE' | 'FREE'): WeightTable {
  return kind === 'FREE' ? FREE_WEIGHTS : BASE_WEIGHTS;
}

function totalWeight(table: WeightTable): number {
  let t = 0;
  for (const [, w] of table) t += w;
  return t;
}

/** Draw one symbol from a weight table. */
export function drawSymbol(rng: Rng, table: WeightTable): SymbolId {
  const total = totalWeight(table);
  let r = rng.int(total);
  for (const [sym, w] of table) {
    if (r < w) return sym;
    r -= w;
  }
  // unreachable given r < total, but keeps the function total
  return table[table.length - 1][0];
}

/** Build a fresh 6x5 board, column-major. */
export function makeBoard(rng: Rng, kind: 'BASE' | 'FREE'): Board {
  const table = weightsFor(kind);
  const board: Board = [];
  for (let reel = 0; reel < REELS; reel++) {
    const col: SymbolId[] = [];
    for (let row = 0; row < ROWS; row++) col.push(drawSymbol(rng, table));
    board.push(col);
  }
  return board;
}

/** flat position <-> (reel,row) helpers. position = reel * ROWS + row */
export const pos = (reel: number, row: number): number => reel * ROWS + row;
export const reelOf = (p: number): number => Math.floor(p / ROWS);
export const rowOf = (p: number): number => p % ROWS;

export function cloneBoard(b: Board): Board {
  return b.map((col) => col.slice());
}

/** Count every symbol on the board. */
export function countSymbols(b: Board): Map<SymbolId, number[]> {
  const m = new Map<SymbolId, number[]>();
  for (let reel = 0; reel < REELS; reel++) {
    for (let row = 0; row < ROWS; row++) {
      const s = b[reel][row];
      const arr = m.get(s);
      if (arr) arr.push(pos(reel, row));
      else m.set(s, [pos(reel, row)]);
    }
  }
  return m;
}

/** Result of a tumble: new board, where survivors moved, which cells are new. */
export interface TumbleResult {
  board: Board;
  /** oldPosition -> newPosition for every symbol that survived */
  moved: Map<number, number>;
  /** positions in the NEW board that were freshly drawn */
  fresh: number[];
}

/**
 * Remove the given positions and tumble: surviving symbols fall to the bottom
 * of their reel, new symbols are drawn in at the top.
 */
export function tumble(
  board: Board,
  remove: Set<number>,
  rng: Rng,
  kind: 'BASE' | 'FREE',
): TumbleResult {
  const table = weightsFor(kind);
  const out: Board = [];
  const moved = new Map<number, number>();
  const fresh: number[] = [];

  for (let reel = 0; reel < REELS; reel++) {
    const survivors: SymbolId[] = [];
    const survivorOldRows: number[] = [];
    for (let row = 0; row < ROWS; row++) {
      if (!remove.has(pos(reel, row))) {
        survivors.push(board[reel][row]);
        survivorOldRows.push(row);
      }
    }
    const missing = ROWS - survivors.length;
    const col: SymbolId[] = [];
    for (let i = 0; i < missing; i++) {
      col.push(drawSymbol(rng, table));
      fresh.push(pos(reel, i));
    }
    for (let i = 0; i < survivors.length; i++) {
      const newRow = missing + i;
      col.push(survivors[i]);
      moved.set(pos(reel, survivorOldRows[i]), pos(reel, newRow));
    }
    out.push(col);
  }
  return { board: out, moved, fresh };
}
