import type { GameConfig } from "@slot-skills/schema";
import type { RngDraw, RngProvider } from "./rng.js";

export type Grid = string[][];

export interface GeneratedGrid {
  grid: Grid;
  draws: RngDraw[];
  stops?: number[];
}

export function rowCounts(game: GameConfig): number[] {
  return Array.isArray(game.layout.rows) ? [...game.layout.rows] : Array(game.layout.reels).fill(game.layout.rows) as number[];
}

async function weightedSymbol(weights: Record<string, number>, rng: RngProvider, context: string): Promise<{ symbol: string; draw: RngDraw }> {
  const entries = Object.entries(weights).filter(([, weight]) => Number.isInteger(weight) && weight > 0);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (!entries.length || total <= 0) throw new Error("At least one positive symbol weight is required");
  const draw = await rng.uniformInt(total, context);
  let cursor = draw.value;
  for (const [symbol, weight] of entries) {
    if (cursor < weight) return { symbol, draw };
    cursor -= weight;
  }
  throw new Error("Weighted symbol selection fell outside its range");
}

export async function generateGrid(game: GameConfig, rng: RngProvider, context = "base"): Promise<GeneratedGrid> {
  const rows = rowCounts(game);
  const draws: RngDraw[] = [];
  if (game.math.outcomeGenerator === "reel-strips") {
    const strips = game.math.reelStrips;
    if (!strips || strips.length !== game.layout.reels) throw new Error("Missing reel strips");
    const grid: Grid = [];
    const stops: number[] = [];
    for (let reel = 0; reel < game.layout.reels; reel += 1) {
      const strip = strips[reel];
      if (!strip?.length) throw new Error(`Reel ${reel} is empty`);
      const draw = await rng.uniformInt(strip.length, `${context}:reel:${reel}`);
      draws.push(draw);
      stops.push(draw.value);
      grid.push(Array.from({ length: rows[reel] ?? 0 }, (_, row) => strip[(draw.value + row) % strip.length]!));
    }
    return { grid, draws, stops };
  }
  const weights = game.math.symbolWeights;
  if (!weights) throw new Error("Missing symbol weights");
  const grid: Grid = [];
  for (let reel = 0; reel < game.layout.reels; reel += 1) {
    const column: string[] = [];
    for (let row = 0; row < (rows[reel] ?? 0); row += 1) {
      const selected = await weightedSymbol(weights, rng, `${context}:cell:${reel}:${row}`);
      column.push(selected.symbol);
      draws.push(selected.draw);
    }
    grid.push(column);
  }
  return { grid, draws };
}
