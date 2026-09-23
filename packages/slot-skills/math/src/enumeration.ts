import type { GameConfig } from "@slot-skills/schema";
import { evaluateGrid } from "./evaluators.js";
import type { Grid } from "./grid.js";
import { rowCounts } from "./grid.js";

export interface EnumerationReport {
  outcomes: number;
  totalWinUnits: string;
  totalBetUnits: string;
  theoreticalRtpBps: number;
}

export function enumerateReelStops(game: GameConfig, betUnits = "100", maxOutcomes = 1_000_000): EnumerationReport {
  if (game.math.outcomeGenerator !== "reel-strips" || !game.math.reelStrips) throw new Error("Exact enumeration requires reel strips");
  const outcomeCount = game.math.reelStrips.reduce((product, strip) => product * strip.length, 1);
  if (!Number.isSafeInteger(outcomeCount) || outcomeCount > maxOutcomes) throw new Error(`Outcome space ${outcomeCount} exceeds exact-enumeration limit ${maxOutcomes}`);
  const rows = rowCounts(game);
  const stops = Array(game.layout.reels).fill(0) as number[];
  let totalWin = 0n;
  let outcomes = 0;
  const visit = (reel: number): void => {
    if (reel === game.layout.reels) {
      const grid: Grid = game.math.reelStrips!.map((strip, index) => Array.from({ length: rows[index] ?? 0 }, (_, row) => strip[(stops[index]! + row) % strip.length]!));
      totalWin += BigInt(evaluateGrid(game, grid, betUnits).totalWinUnits);
      outcomes += 1;
      return;
    }
    for (let stop = 0; stop < game.math.reelStrips![reel]!.length; stop += 1) {
      stops[reel] = stop;
      visit(reel + 1);
    }
  };
  visit(0);
  const totalBet = BigInt(betUnits) * BigInt(outcomes);
  return { outcomes, totalWinUnits: totalWin.toString(), totalBetUnits: totalBet.toString(), theoreticalRtpBps: Number(totalWin * 10000n / totalBet) };
}
