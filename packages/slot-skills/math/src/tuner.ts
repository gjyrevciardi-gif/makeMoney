import type { GameConfig } from "@slot-skills/schema";
import { simulateBaseGame, type SimulationReport } from "./simulation.js";

export interface TuneOptions {
  roundsPerCandidate?: number;
  iterations?: number;
  seed?: number;
  lockPaytable?: boolean;
}

export interface TuneResult {
  game: GameConfig;
  report: SimulationReport;
  iterations: number;
  targetRtpBps: number;
}

function highValueSymbols(game: GameConfig): Set<string> {
  const totals = new Map<string, bigint>();
  for (const entry of game.math.paytable) totals.set(entry.symbolId, (totals.get(entry.symbolId) ?? 0n) + BigInt(entry.payout.numerator) * 1_000_000n / BigInt(entry.payout.denominator));
  return new Set([...totals.entries()].sort((a, b) => a[1] === b[1] ? 0 : a[1] > b[1] ? -1 : 1).slice(0, Math.max(1, Math.ceil(totals.size / 3))).map(([id]) => id));
}

export async function tuneWeightedGame(source: GameConfig, options: TuneOptions = {}): Promise<TuneResult> {
  if (source.math.outcomeGenerator !== "weighted-grid" || !source.math.symbolWeights) throw new Error("The deterministic tuner currently requires weighted-grid math");
  const game = structuredClone(source);
  const target = game.math.targets.rtpBps;
  const iterations = options.iterations ?? 16;
  const rounds = options.roundsPerCandidate ?? 20_000;
  const seed = options.seed ?? 7331;
  const high = highValueSymbols(game);
  let bestGame = structuredClone(game);
  let bestReport = await simulateBaseGame(bestGame, rounds, seed);
  let bestDistance = Math.abs(bestReport.rtpBps - target);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const candidate = structuredClone(bestGame);
    const direction = bestReport.rtpBps < target ? 1 : -1;
    for (const [symbol, weight] of Object.entries(candidate.math.symbolWeights!)) {
      const delta = high.has(symbol) ? direction : -direction;
      candidate.math.symbolWeights![symbol] = Math.max(1, weight + delta);
    }
    const report = await simulateBaseGame(candidate, rounds, seed + iteration + 1);
    const distance = Math.abs(report.rtpBps - target);
    if (distance <= bestDistance) {
      bestGame = candidate;
      bestReport = report;
      bestDistance = distance;
    }
  }
  return { game: bestGame, report: bestReport, iterations, targetRtpBps: target };
}
