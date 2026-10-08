import type { GameConfig } from "@slot-skills/schema";
import { evaluateGrid, SeededRngProvider, type MathPredictionReport } from "@slot-skills/math";
import { predictGameMath, predictiveDigest } from "@slot-skills/math";
import { DefaultGameEngine } from "./engine.js";

export interface PredictionRefinementOptions {
  rounds?: number;
  seed?: number;
  signal?: AbortSignal;
  onProgress?: (completed: number) => void;
}

/** Refines continuation, transform and feature effects using the exact initial-grid award as a
 * control variate. This is development evidence only and always uses a non-production RNG. */
export async function refineGameMathPrediction(game: GameConfig, options: PredictionRefinementOptions = {}): Promise<MathPredictionReport> {
  const rounds = options.rounds ?? 100_000; const seed = options.seed ?? 4242;
  if (!Number.isInteger(rounds) || rounds < 100 || rounds > 1_000_000) throw new Error("Prediction refinement rounds must be an integer from 100 to 1,000,000");
  const provisional = predictGameMath(game); const engine = new DefaultGameEngine(); const rng = new SeededRngProvider(seed);
  const featureBps = provisional.phaseRtpBps.freeSpins + provisional.phaseRtpBps.holdAndWin + provisional.phaseRtpBps.interactive;
  const deferredScatterBps = game.math.evaluator === "count" ? provisional.components.find((component) => component.id === "scatter")?.rtpBps ?? 0 : 0;
  let sum = 0; let squares = 0;
  for (let round = 0; round < rounds; round += 1) {
    if (options.signal?.aborted) throw new Error("Prediction refinement cancelled");
    const computation = await engine.spin(game, { roundId: `prediction-${round}`, playerId: "prediction", betUnits: "100" }, rng);
    let result = computation.result;
    if (computation.continuation) {
      const choice = computation.continuation.action.choices[0];
      if (choice) result = engine.resolveAction(computation.continuation, computation.continuation.action.id, choice.id);
    }
    const reveal = result.events.find((event) => event.type === "grid-reveal")?.data.grid;
    const first = Array.isArray(reveal) ? Number(evaluateGrid(game, reveal as string[][], "100").totalWinUnits) / 100 : 0;
    const actual = Number(result.totalWinUnits) / 100;
    // Remove the analytically modeled feature mean, leaving only the correlated continuation and
    // transform residual. The control's exact expectation is already in the provisional report.
    const residual = actual - first - (featureBps + deferredScatterBps) / 10_000;
    sum += residual; squares += residual * residual;
    if ((round + 1) % 1_000 === 0 || round + 1 === rounds) options.onProgress?.(round + 1);
  }
  const mean = sum / rounds; const variance = Math.max(0, squares / rounds - mean * mean);
  const error99Bps = Math.ceil(2.576 * Math.sqrt(variance / rounds) * 10_000);
  const residual = { meanBps: Math.round(mean * 10_000), error99Bps, rounds, seed, digest: predictiveDigest({ rounds, seed, sum, squares }) };
  return predictGameMath(game, { cachedResidual: residual });
}
