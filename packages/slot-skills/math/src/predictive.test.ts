import { describe, expect, it } from "vitest";
import type { GameConfig } from "@slot-skills/schema";
import { predictGameMath, solveGameMath } from "./predictive.js";

function fixture(evaluator: GameConfig["math"]["evaluator"] = "paylines"): GameConfig {
  return {
    schemaVersion: "2.0", engineApi: "1.0", id: "predictive", version: "1.0.0", title: "Predictive",
    layout: { reels: 3, rows: 1 }, symbols: [
      { id: "high-1", name: "High", kind: "normal", asset: "high-1" },
      { id: "scatter", name: "Scatter", kind: "scatter", asset: "scatter" },
    ],
    math: {
      evaluator, outcomeGenerator: "weighted-grid", targets: { rtpBps: 9600, volatility: "medium", hitRateBps: [1, 10_000], maxWinMultiplier: { numerator: "100", denominator: "1" } },
      paytable: [{ symbolId: "high-1", count: 3, payout: { numerator: "1", denominator: "1" }, basis: "bet" }],
      ...(evaluator === "paylines" ? { paylines: [[0, 0, 0]] } : {}), symbolWeights: { "high-1": 1, scatter: 0 }, maxCascades: 1,
    },
    features: [], assets: [{ id: "high-1", role: "symbol", path: "high.svg" }, { id: "scatter", role: "symbol", path: "scatter.svg" }],
    theme: { id: "theme", palette: ["#000"], components: {} }, locales: { default: "en", packs: {} },
    jurisdiction: { profileId: "test", reviewedAt: "2026-01-01", reviewBy: "2030-01-01", sourceUrls: [] },
    providers: { rng: "test", wallet: "test", jackpot: "test", session: "test", audit: "test" },
    presentation: { cycleDurationMs: 1_000, autoPlay: false, turbo: false, slamStop: false, celebrateReturnAtOrBelowStake: false, reducedMotionFallback: true },
  };
}

describe("predictive math", () => {
  it("computes exact payline RTP without Monte Carlo", () => {
    const report = predictGameMath(fixture());
    expect(report.quality).toBe("exact");
    expect(report.rtpBps).toBe(10_000);
    expect(report.rtpIntervalBps).toEqual([10_000, 10_000]);
  });

  it("solves an exact fixture to 97 percent", () => {
    const proposal = solveGameMath(fixture(), { rtpBps: 9_700, volatility: "medium" });
    expect(proposal.after.rtpBps).toBe(9_700);
    expect(proposal.sourceDigest).toBe(proposal.before.configurationDigest);
    expect(proposal.changes).toHaveLength(1);
  });

  it("decomposes scatter-triggered pick awards", () => {
    const game = fixture(); game.math.symbolWeights = { "high-1": 7, scatter: 3 };
    game.features = [
      { id: "scatter-trigger", enabled: true, config: { count: 3 } },
      { id: "pick-and-click-bonus", enabled: true, config: { choices: 3, awards: [2, 5, 10] } },
    ];
    const report = predictGameMath(game);
    expect(report.triggerBps).toBe(270);
    expect(report.conditionalFeatureMultiplier).toBeCloseTo(17 / 3);
    expect(report.phaseRtpBps.interactive).toBeGreaterThan(0);
  });

  it.each(["paylines", "ways", "count", "cluster"] as const)("predicts the %s evaluator deterministically", (evaluator) => {
    const game = fixture(evaluator);
    const first = predictGameMath(game);
    const second = predictGameMath(game);
    expect(first.digest).toBe(second.digest);
    expect(Number.isFinite(first.rtpBps)).toBe(true);
    expect(first.components.some((component) => component.id === "base")).toBe(true);
    expect(first.quality).toBe(evaluator === "paylines" || evaluator === "ways" ? "exact" : "hybrid-provisional");
  });

  it.each([
    ["free-spins", "freeSpins"],
    ["hold-and-win", "holdAndWin"],
  ] as const)("computes conditional %s expectation without waiting for a natural trigger", (featureId, phase) => {
    const game = fixture(); game.math.symbolWeights = { "high-1": 7, scatter: 3 };
    game.features = [
      { id: "scatter-trigger", enabled: true, config: { count: 3 } },
      featureId === "free-spins"
        ? { id: featureId, enabled: true, config: { spins: 8 } }
        : { id: featureId, enabled: true, config: { lives: 3, hitChanceBps: 2200, maxRespins: 50, prizes: [{ score: 1, weight: 1 }] } },
    ];
    const report = predictGameMath(game);
    expect(report.conditionalFeatureMultiplier).toBeGreaterThan(0);
    expect(report.phaseRtpBps[phase]).toBeGreaterThan(0);
  });
});
