import { parentPort, workerData } from "node:worker_threads";
import type { GameConfig } from "@slot-skills/schema";
import { simulateGame, type SimulationOptions } from "./simulation.js";

const input = workerData as { game: GameConfig; rounds: number; seed: number; betUnits: string; options?: SimulationOptions };
simulateGame(input.game, input.rounds, input.seed, input.betUnits, input.options ?? {}, {
  progressEveryRounds: 25_000,
  onProgress: (roundsDone) => parentPort!.postMessage({ type: "progress", roundsDone }),
})
  .then((report) => parentPort!.postMessage({ type: "result", report }))
  .catch((error) => { throw error; });
