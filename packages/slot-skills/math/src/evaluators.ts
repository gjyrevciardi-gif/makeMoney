import type { GameConfig, PaytableEntry, PayoutBasis } from "@slot-skills/schema";
import type { Grid } from "./grid.js";
import { multiplyRational } from "./payout.js";

export interface Cell {
  reel: number;
  row: number;
}

export interface Win {
  evaluator: string;
  symbolId: string;
  count: number;
  ways: number;
  cells: Cell[];
  payoutUnits: string;
}

export interface Evaluation {
  wins: Win[];
  totalWinUnits: string;
}

function entryFor(game: GameConfig, symbolId: string, count: number): PaytableEntry | undefined {
  return game.math.paytable
    .filter((entry) => entry.symbolId === symbolId && entry.count <= count)
    .sort((a, b) => b.count - a.count)[0];
}

function payoutBase(game: GameConfig, bet: bigint, basis: PayoutBasis): bigint {
  if (basis !== "line-bet") return bet;
  const lines = BigInt(game.math.paylines?.length ?? 1);
  if (bet % lines !== 0n) throw new Error(`Bet ${bet} is not divisible across ${lines} paylines`);
  return bet / lines;
}

function makeWin(game: GameConfig, bet: bigint, entry: PaytableEntry, symbolId: string, count: number, cells: Cell[], ways = 1): Win {
  const award = multiplyRational(payoutBase(game, bet, entry.basis), entry.payout) * BigInt(ways);
  return { evaluator: game.math.evaluator, symbolId, count, cells, ways, payoutUnits: award.toString() };
}

function wildIds(game: GameConfig): Set<string> {
  return new Set(game.symbols.filter((symbol) => symbol.kind === "wild").map((symbol) => symbol.id));
}

export function scatterWins(game: GameConfig, grid: Grid, bet: bigint): Win[] {
  const wins: Win[] = [];
  for (const symbol of game.symbols.filter((candidate) => candidate.kind === "scatter" || candidate.kind === "bonus")) {
    const cells: Cell[] = [];
    grid.forEach((column, reel) => column.forEach((value, row) => { if (value === symbol.id) cells.push({ reel, row }); }));
    const entry = entryFor(game, symbol.id, cells.length);
    if (entry) wins.push(makeWin(game, bet, entry, symbol.id, cells.length, cells));
  }
  return wins;
}

function evaluatePaylines(game: GameConfig, grid: Grid, bet: bigint): Win[] {
  const wilds = wildIds(game);
  const wins: Win[] = [];
  for (const line of game.math.paylines ?? []) {
    if (line.length !== grid.length) throw new Error("Every payline must contain one row per reel");
    const values = line.map((row, reel) => grid[reel]?.[row]);
    if (values.some((value) => value === undefined)) throw new Error("Payline row is outside the visible grid");
    const symbolId = values.find((value) => value !== undefined && !wilds.has(value)) ?? values[0]!;
    let count = 0;
    const cells: Cell[] = [];
    for (let reel = 0; reel < values.length; reel += 1) {
      const value = values[reel]!;
      if (value !== symbolId && !wilds.has(value)) break;
      count += 1;
      cells.push({ reel, row: line[reel]! });
    }
    const entry = entryFor(game, symbolId, count);
    if (entry) wins.push(makeWin(game, bet, entry, symbolId, count, cells));
  }
  return wins;
}

function evaluateWays(game: GameConfig, grid: Grid, bet: bigint): Win[] {
  const wilds = wildIds(game);
  const candidates = new Set(grid[0]?.filter((symbol) => !wilds.has(symbol)) ?? []);
  const wins: Win[] = [];
  for (const symbolId of candidates) {
    let count = 0;
    let ways = 1;
    const cells: Cell[] = [];
    for (let reel = 0; reel < grid.length; reel += 1) {
      const matching: Cell[] = [];
      grid[reel]!.forEach((value, row) => { if (value === symbolId || wilds.has(value)) matching.push({ reel, row }); });
      if (!matching.length) break;
      count += 1;
      ways *= matching.length;
      cells.push(...matching);
    }
    const entry = entryFor(game, symbolId, count);
    if (entry) wins.push(makeWin(game, bet, entry, symbolId, count, cells, ways));
  }
  return wins;
}

function evaluateCount(game: GameConfig, grid: Grid, bet: bigint): Win[] {
  const wins: Win[] = [];
  for (const symbol of game.symbols.filter((candidate) => candidate.kind !== "scatter" && candidate.kind !== "bonus")) {
    const cells: Cell[] = [];
    grid.forEach((column, reel) => column.forEach((value, row) => { if (value === symbol.id) cells.push({ reel, row }); }));
    const entry = entryFor(game, symbol.id, cells.length);
    if (entry) wins.push(makeWin(game, bet, entry, symbol.id, cells.length, cells));
  }
  return wins;
}

function evaluateClusters(game: GameConfig, grid: Grid, bet: bigint): Win[] {
  const wins: Win[] = [];
  const visitedBySymbol = new Map<string, Set<string>>();
  const wilds = wildIds(game);
  for (const symbol of game.symbols.filter((candidate) => candidate.kind === "normal")) {
    const visited = visitedBySymbol.get(symbol.id) ?? new Set<string>();
    visitedBySymbol.set(symbol.id, visited);
    for (let reel = 0; reel < grid.length; reel += 1) {
      for (let row = 0; row < grid[reel]!.length; row += 1) {
        const key = `${reel}:${row}`;
        const value = grid[reel]![row]!;
        if (visited.has(key) || (value !== symbol.id && !wilds.has(value))) continue;
        const queue: Cell[] = [{ reel, row }];
        const cells: Cell[] = [];
        visited.add(key);
        while (queue.length) {
          const cell = queue.shift()!;
          cells.push(cell);
          const neighbors: Array<[number, number]> = [[cell.reel - 1, cell.row], [cell.reel + 1, cell.row], [cell.reel, cell.row - 1], [cell.reel, cell.row + 1]];
          for (const [nextReel, nextRow] of neighbors) {
            const nextKey = `${nextReel}:${nextRow}`;
            const next = grid[nextReel]?.[nextRow];
            if (next === undefined || visited.has(nextKey) || (next !== symbol.id && !wilds.has(next))) continue;
            visited.add(nextKey);
            queue.push({ reel: nextReel, row: nextRow });
          }
        }
        const entry = entryFor(game, symbol.id, cells.length);
        if (entry) wins.push(makeWin(game, bet, entry, symbol.id, cells.length, cells));
      }
    }
  }
  return wins;
}

export function evaluateGrid(game: GameConfig, grid: Grid, betUnits: string): Evaluation {
  const bet = BigInt(betUnits);
  if (bet <= 0n) throw new Error("Bet must be positive");
  let wins: Win[];
  switch (game.math.evaluator) {
    case "paylines": wins = evaluatePaylines(game, grid, bet); break;
    case "ways": wins = evaluateWays(game, grid, bet); break;
    case "count": wins = evaluateCount(game, grid, bet); break;
    case "cluster": wins = evaluateClusters(game, grid, bet); break;
  }
  if (game.math.evaluator !== "count") wins.push(...scatterWins(game, grid, bet));
  return { wins, totalWinUnits: wins.reduce((total, win) => total + BigInt(win.payoutUnits), 0n).toString() };
}
