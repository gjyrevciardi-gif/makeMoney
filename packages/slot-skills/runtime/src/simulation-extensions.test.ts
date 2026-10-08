import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GameConfig } from "@slot-skills/schema";
import { gbGliReferenceProfile } from "./jurisdiction.js";
import { SimulationCancelledError, simulateGame, WIN_HISTOGRAM_BUCKETS, type WinPhase } from "./simulation.js";

// The parallel path spawns the COMPILED worker (dist/simulation-worker.js), so those tests run
// against the built package and skip loudly when the package has not been built yet.
const distSimulation = fileURLToPath(new URL("../dist/simulation.js", import.meta.url));
const distBuilt = existsSync(distSimulation);

function weightedFixture(): GameConfig {
  return {
    schemaVersion: "2.0", engineApi: "1.0", id: "sim-fixture", version: "1.0.0", title: "Sim Fixture",
    layout: { reels: 3, rows: 3 },
    symbols: [
      { id: "high-1", name: "A", kind: "normal", asset: "high-1", tags: ["high"] },
      { id: "low-1", name: "Low", kind: "normal", asset: "low-1", tags: ["low"] },
      { id: "scatter", name: "Scatter", kind: "scatter", asset: "scatter" },
    ],
    math: {
      evaluator: "count", outcomeGenerator: "weighted-grid", targets: { rtpBps: 9600, volatility: "medium", hitRateBps: [2000, 6000], maxWinMultiplier: { numerator: "5000", denominator: "1" } },
      paytable: [
        { symbolId: "high-1", count: 5, payout: { numerator: "3", denominator: "1" }, basis: "bet" },
        { symbolId: "low-1", count: 5, payout: { numerator: "1", denominator: "2" }, basis: "bet" },
        { symbolId: "scatter", count: 3, payout: { numerator: "1", denominator: "1" }, basis: "bet" },
      ],
      symbolWeights: { "high-1": 30, "low-1": 60, scatter: 10 },
    },
    features: [
      { id: "scatter-trigger", enabled: true, config: { count: 3, countOn: "final-grid" } },
      { id: "free-spins", enabled: true, config: { spins: 2 } },
    ],
    assets: [{ id: "high-1", role: "symbol", path: "a.svg" }, { id: "low-1", role: "symbol", path: "l.svg" }, { id: "scatter", role: "symbol", path: "s.svg" }],
    theme: { id: "sim-fixture", palette: ["#000"], components: {} }, locales: { default: "en", packs: { en: "en.json" } },
    jurisdiction: { profileId: "gb-gli-reference", reviewedAt: "2026-07-18", reviewBy: "2026-10-18", sourceUrls: [...gbGliReferenceProfile.sourceUrls] },
    providers: { rng: "node-crypto", wallet: "local", jackpot: "local", session: "local", audit: "local" },
    presentation: { cycleDurationMs: 2500, autoPlay: false, turbo: false, slamStop: false, celebrateReturnAtOrBelowStake: false, reducedMotionFallback: true },
  };
}

const PHASES: readonly WinPhase[] = ["base", "freeSpins", "holdAndWin", "interactive"];

describe("simulation report extensions", () => {
  it("splits win phases exactly, buckets every round, and tracks symbol and feature stats", async () => {
    const report = await simulateGame(weightedFixture(), 4000, 7);
    const phaseTotal = PHASES.reduce((total, phase) => total + BigInt(report.winUnitsByPhase[phase]), 0n);
    expect(phaseTotal.toString()).toBe(report.totalWinUnits);
    expect(report.winMultiplierHistogram).toHaveLength(WIN_HISTOGRAM_BUCKETS.length);
    expect(report.winMultiplierHistogram.reduce((total, bucket) => total + bucket.rounds, 0)).toBe(4000);
    const histogramWin = report.winMultiplierHistogram.reduce((total, bucket) => total + BigInt(bucket.winUnits), 0n);
    expect(histogramWin.toString()).toBe(report.totalWinUnits);
    const totalSymbolHits = Object.values(report.symbolStats).reduce((total, stats) => total + stats.hits, 0);
    expect(totalSymbolHits).toBe(report.featureEventCounts.win ?? 0);
    for (const stats of Object.values(report.symbolStats)) {
      expect(Object.values(stats.countDistribution).reduce((total, occurrences) => total + occurrences, 0)).toBe(stats.hits);
    }
    expect(report.featureStats["free-spins"]?.triggers).toBe(report.featureEventCounts["free-spins-start"] ?? 0);
    expect(report.featureStats["free-spins"]?.totalWinUnits).toBe(report.winUnitsByPhase.freeSpins);
    expect(report.rtpBpsByPhase.base + report.rtpBpsByPhase.freeSpins).toBeGreaterThan(0);
    expect(report.runtimeEvidenceVersion).toBe("1.1.0");
  });

  it("reports monotone progress and supports cancellation", async () => {
    const seen: number[] = [];
    await simulateGame(weightedFixture(), 3000, 7, "100", {}, { progressEveryRounds: 500, onProgress: (done) => seen.push(done) });
    expect(seen.length).toBeGreaterThan(2);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    expect(seen.at(-1)).toBe(3000);

    const controller = new AbortController();
    const cancelled = simulateGame(weightedFixture(), 500_000, 7, "100", {}, { progressEveryRounds: 100, signal: controller.signal, onProgress: (done) => { if (done >= 200) controller.abort(); } });
    await expect(cancelled).rejects.toBeInstanceOf(SimulationCancelledError);
  });

  it.skipIf(!distBuilt)("merges parallel worker reports to the same totals as the equivalent single runs", async () => {
    const { simulateGameParallel } = await import(distSimulation) as typeof import("./simulation.js");
    const game = weightedFixture();
    const parallel = await simulateGameParallel(game, 4000, 2, 21);
    const first = await simulateGame(game, 2000, 21);
    const second = await simulateGame(game, 2000, 21 + 1_000_003);
    const expectedWin = BigInt(first.totalWinUnits) + BigInt(second.totalWinUnits);
    expect(parallel.totalWinUnits).toBe(expectedWin.toString());
    for (const phase of PHASES) {
      const expected = BigInt(first.winUnitsByPhase[phase]) + BigInt(second.winUnitsByPhase[phase]);
      expect(parallel.winUnitsByPhase[phase]).toBe(expected.toString());
    }
    for (const [index, bucket] of parallel.winMultiplierHistogram.entries()) {
      expect(bucket.rounds).toBe(first.winMultiplierHistogram[index]!.rounds + second.winMultiplierHistogram[index]!.rounds);
    }
    const parallelHits = Object.values(parallel.symbolStats).reduce((total, stats) => total + stats.hits, 0);
    const singleHits = [first, second].flatMap((report) => Object.values(report.symbolStats)).reduce((total, stats) => total + stats.hits, 0);
    expect(parallelHits).toBe(singleHits);
  });

  it.skipIf(!distBuilt)("cancels a parallel simulation by terminating workers", async () => {
    const { simulateGameParallel, SimulationCancelledError: DistCancelled } = await import(distSimulation) as typeof import("./simulation.js");
    const controller = new AbortController();
    const pending = simulateGameParallel(weightedFixture(), 2_000_000, 2, 5, "100", {}, { signal: controller.signal });
    setTimeout(() => controller.abort(), 300);
    await expect(pending).rejects.toBeInstanceOf(DistCancelled);
  });
});
