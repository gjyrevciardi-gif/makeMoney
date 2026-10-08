import type { GameConfig } from "@slot-skills/schema";
import { evaluateGrid } from "./evaluators.js";
import { generateGrid } from "./grid.js";
import { SeededRngProvider } from "./rng.js";

export interface SimulationReport {
  rounds: number;
  seed: number;
  betUnits: string;
  totalBetUnits: string;
  totalWinUnits: string;
  rtpBps: number;
  hitRateBps: number;
  variance: number;
  standardDeviation: number;
  maxObservedMultiplier: number;
  confidence99Bps: [number, number];
}

export async function simulateBaseGame(game: GameConfig, rounds: number, seed = 1, betUnits = "100"): Promise<SimulationReport> {
  if (!Number.isInteger(rounds) || rounds <= 0) throw new Error("Rounds must be a positive integer");
  const rng = new SeededRngProvider(seed);
  const bet = BigInt(betUnits);
  let totalWin = 0n;
  let hits = 0;
  let sum = 0;
  let sumSquares = 0;
  let maxMultiplier = 0;
  for (let round = 0; round < rounds; round += 1) {
    const generated = await generateGrid(game, rng, `simulation:${round}`);
    const evaluation = evaluateGrid(game, generated.grid, betUnits);
    const win = BigInt(evaluation.totalWinUnits);
    totalWin += win;
    if (win > 0n) hits += 1;
    const multiplier = Number(win) / Number(bet);
    sum += multiplier;
    sumSquares += multiplier * multiplier;
    maxMultiplier = Math.max(maxMultiplier, multiplier);
  }
  const mean = sum / rounds;
  const variance = Math.max(0, sumSquares / rounds - mean * mean);
  const standardDeviation = Math.sqrt(variance);
  const error = 2.576 * standardDeviation / Math.sqrt(rounds) * 10000;
  const rtpBps = Number(totalWin * 10000n / (bet * BigInt(rounds)));
  return {
    rounds, seed, betUnits, totalBetUnits: (bet * BigInt(rounds)).toString(), totalWinUnits: totalWin.toString(),
    rtpBps, hitRateBps: Math.round(hits / rounds * 10000), variance, standardDeviation,
    maxObservedMultiplier: maxMultiplier,
    confidence99Bps: [Math.max(0, Math.round(rtpBps - error)), Math.round(rtpBps + error)],
  };
}
