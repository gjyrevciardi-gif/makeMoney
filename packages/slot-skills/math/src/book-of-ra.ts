import type { Grid } from "./grid.js";
import type { Win } from "./evaluators.js";
import type { GameConfig } from "@slot-skills/schema";
import {
  BOOK_HIGH_SYMBOL_MINIMUM_REELS,
  BOOK_LOW_SYMBOL_MINIMUM_REELS,
  BOOK_OF_RA_LINES,
  BOOK_OF_RA_PAYTABLE,
  BOOK_OF_RA_SCATTER_PAYS,
  BOOK_OF_RA_SCATTER_SYMBOL,
} from "./book-of-ra.profile.js";

export { BOOK_OF_RA_LINES };
export type BookOfRaResult = {
  regularWins: Win[];
  scatterWin: bigint;
  bookCount: number;
  total: bigint;
};

type Paytable = Readonly<Record<string, Readonly<Record<number, number>>>>;

const PAY: Paytable = BOOK_OF_RA_PAYTABLE;

/**
 * The published paytable, taken from the game configuration when it carries
 * one and otherwise from the canonical Book of Ra constants. Both sources are
 * required to agree; the configuration copy is what lets a caller pin an exact
 * frozen profile while keeping `bookOfRaPayout` as the canonical reader.
 */
function payTable(game: { math?: { paytable?: Array<{ symbolId: string; count: number; payout: { numerator: string; denominator: string }; basis: string }> } }): Paytable {
  const entries = game.math?.paytable?.filter((entry) => entry.basis === "line-bet") ?? [];
  if (!entries.length) return PAY;
  const table: Record<string, Record<number, number>> = {};
  for (const entry of entries) {
    if (!Object.prototype.hasOwnProperty.call(PAY, entry.symbolId)) continue;
    const denominator = Number(entry.payout.denominator);
    const numerator = Number(entry.payout.numerator);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator !== 1) continue;
    (table[entry.symbolId] ??= {})[entry.count] = numerator;
  }
  // The canonical table remains the source of truth for any symbol the
  // configuration omitted, so a partial paytable can never pay less than the
  // published game does.
  for (const [symbolId, tiers] of Object.entries(PAY)) {
    table[symbolId] ??= {};
    for (const [count, multiplier] of Object.entries(tiers)) table[symbolId]![Number(count)] ??= multiplier;
  }
  return table;
}

function bookId(game: { symbols: Array<{ id: string; kind: string }> }): string {
  return game.symbols.find((s) => s.kind === "scatter")?.id ?? BOOK_OF_RA_SCATTER_SYMBOL;
}

/** Scatter tier for a landed Book count, on the total stake. */
export function bookOfRaScatterMultiplier(count: number): number {
  if (count >= 5) return BOOK_OF_RA_SCATTER_PAYS[5]!;
  if (count >= 4) return BOOK_OF_RA_SCATTER_PAYS[4]!;
  if (count >= 3) return BOOK_OF_RA_SCATTER_PAYS[3]!;
  return 0;
}

/** High symbols expand from two reels, honour cards from three. */
export function bookOfRaExpandingMinimum(symbolId: string): number {
  return symbolId.startsWith("high-") ? BOOK_HIGH_SYMBOL_MINIMUM_REELS : BOOK_LOW_SYMBOL_MINIMUM_REELS;
}

/**
 * Expanding-symbol award: the paytable multiplier for the number of reels the
 * chosen symbol filled, applied across every active payline, paid once per
 * spin. Reels do not have to be adjacent — every reel the symbol lands on
 * expands, and only the count matters.
 */
export function bookOfRaExpandingWin(symbolId: string, qualifyingReels: number, betPerLine: bigint, activeLines: number): bigint {
  if (activeLines <= 0 || qualifyingReels < bookOfRaExpandingMinimum(symbolId)) return 0n;
  const multiplier = bookOfRaPayout(symbolId, qualifyingReels);
  if (multiplier <= 0) return 0n;
  return betPerLine * BigInt(activeLines) * BigInt(multiplier);
}

export function evaluateBookOfRa(
  game: { symbols: Array<{ id: string; kind: string }>; math: { paylines?: number[][] } & Partial<Pick<GameConfig["math"], "paytable">> },
  grid: Grid,
  betPerLine: bigint,
  activeLines = BOOK_OF_RA_LINES,
): BookOfRaResult {
  if (grid.length !== 5 || grid.some((column) => column.length !== 3)) throw new Error("Book of Ra requires a 5x3 grid");
  const book = bookId(game);
  const pay = payTable(game);
  const wins: Win[] = [];
  const lines = (game.math.paylines ?? []).slice(0, activeLines);
  for (const line of lines) {
    const cells = line.map((row, reel) => ({ reel, row }));
    const values = cells.map((cell) => grid[cell.reel]![cell.row]!);
    let best: { symbolId: string; count: number; multiplier: number } | undefined;
    for (const symbolId of Object.keys(pay)) {
      let count = 0;
      while (count < values.length && (values[count] === symbolId || values[count] === book)) count += 1;
      const multiplier = pay[symbolId]?.[count];
      if (multiplier && values.slice(0, count).includes(symbolId) && (!best || multiplier > best.multiplier)) best = { symbolId, count, multiplier };
    }
    if (best) {
      wins.push({ evaluator: "book-of-ra-deluxe-paylines", symbolId: best.symbolId, count: best.count, ways: 1, cells: cells.slice(0, best.count), payoutUnits: (betPerLine * BigInt(best.multiplier)).toString() });
    }
  }
  const bookCount = grid.flat().filter((value) => value === book).length;
  const scatterMultiplier = bookOfRaScatterMultiplier(bookCount);
  const scatterWin = betPerLine * BigInt(activeLines) * BigInt(scatterMultiplier);
  const regularTotal = wins.reduce((sum, win) => sum + BigInt(win.payoutUnits), 0n);
  return { regularWins: wins, scatterWin, bookCount, total: regularTotal + scatterWin };
}

export function bookOfRaPayout(symbolId: string, count: number): number { return PAY[symbolId]?.[count] ?? 0; }
