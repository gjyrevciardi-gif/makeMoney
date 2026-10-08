import type { Grid } from "./grid.js";
import type { Win } from "./evaluators.js";

export const BOOK_OF_RA_LINES = 10;
export type BookOfRaResult = {
  regularWins: Win[];
  scatterWin: bigint;
  bookCount: number;
  total: bigint;
};

const PAY: Record<string, Record<number, number>> = {
  "high-1": { 2: 10, 3: 100, 4: 1000, 5: 5000 },
  "high-2": { 2: 5, 3: 40, 4: 400, 5: 2000 },
  "high-3": { 2: 5, 3: 30, 4: 100, 5: 750 },
  "high-4": { 2: 5, 3: 30, 4: 100, 5: 750 },
  "low-1": { 3: 5, 4: 40, 5: 150 },
  "low-2": { 3: 5, 4: 40, 5: 150 },
  "low-3": { 3: 5, 4: 25, 5: 100 },
  "low-4": { 3: 5, 4: 25, 5: 100 },
  "low-5": { 3: 5, 4: 25, 5: 100 },
};

function bookId(game: { symbols: Array<{ id: string; kind: string }> }): string {
  return game.symbols.find((s) => s.kind === "scatter")?.id ?? "scatter";
}

export function evaluateBookOfRa(game: { symbols: Array<{ id: string; kind: string }>; math: { paylines?: number[][] } }, grid: Grid, betPerLine: bigint, activeLines = BOOK_OF_RA_LINES): BookOfRaResult {
  if (grid.length !== 5 || grid.some((column) => column.length !== 3)) throw new Error("Book of Ra requires a 5x3 grid");
  const book = bookId(game);
  const wins: Win[] = [];
  const lines = (game.math.paylines ?? []).slice(0, activeLines);
  for (const line of lines) {
    const cells = line.map((row, reel) => ({ reel, row }));
    const values = cells.map((cell) => grid[cell.reel]![cell.row]!);
    let best: { symbolId: string; count: number; multiplier: number } | undefined;
    for (const symbolId of Object.keys(PAY)) {
      let count = 0;
      while (count < values.length && (values[count] === symbolId || values[count] === book)) count += 1;
      const multiplier = PAY[symbolId]?.[count];
      if (multiplier && values.slice(0, count).includes(symbolId) && (!best || multiplier > best.multiplier)) best = { symbolId, count, multiplier };
    }
    if (best) {
      wins.push({ evaluator: "book-of-ra-deluxe-paylines", symbolId: best.symbolId, count: best.count, ways: 1, cells: cells.slice(0, best.count), payoutUnits: (betPerLine * BigInt(best.multiplier)).toString() });
    }
  }
  const bookCount = grid.flat().filter((value) => value === book).length;
  const scatterMultiplier = bookCount >= 5 ? 200 : bookCount >= 4 ? 20 : bookCount >= 3 ? 2 : 0;
  const scatterWin = betPerLine * BigInt(activeLines) * BigInt(scatterMultiplier);
  const regularTotal = wins.reduce((sum, win) => sum + BigInt(win.payoutUnits), 0n);
  return { regularWins: wins, scatterWin, bookCount, total: regularTotal + scatterWin };
}

export function bookOfRaPayout(symbolId: string, count: number): number { return PAY[symbolId]?.[count] ?? 0; }
