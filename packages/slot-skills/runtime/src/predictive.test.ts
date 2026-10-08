import { describe, expect, it } from "vitest";
import type { GameConfig } from "@slot-skills/schema";
import { refineGameMathPrediction } from "./predictive.js";

const game: GameConfig = {
  schemaVersion: "2.0", engineApi: "1.0", id: "refine", version: "1", title: "Refine",
  layout: { reels: 3, rows: 1 }, symbols: [{ id: "high-1", name: "High", kind: "normal", asset: "high-1" }],
  math: { evaluator: "paylines", outcomeGenerator: "weighted-grid", targets: { rtpBps: 10_000, volatility: "low", hitRateBps: [1, 10_000], maxWinMultiplier: { numerator: "100", denominator: "1" } }, paytable: [{ symbolId: "high-1", count: 3, payout: { numerator: "1", denominator: "1" }, basis: "bet" }], paylines: [[0, 0, 0]], symbolWeights: { "high-1": 1 }, maxCascades: 1 },
  features: [], assets: [{ id: "high-1", role: "symbol", path: "high.svg" }], theme: { id: "theme", palette: ["#000"], components: {} },
  locales: { default: "en", packs: {} }, jurisdiction: { profileId: "test", reviewedAt: "2026-01-01", reviewBy: "2030-01-01", sourceUrls: [] },
  providers: { rng: "test", wallet: "test", jackpot: "test", session: "test", audit: "test" },
  presentation: { cycleDurationMs: 1000, autoPlay: false, turbo: false, slamStop: false, celebrateReturnAtOrBelowStake: false, reducedMotionFallback: true },
};

describe("predictive refinement", () => {
  it("uses a zero-variance control residual for a deterministic game", async () => {
    const report = await refineGameMathPrediction(game, { rounds: 100, seed: 4242 });
    expect(report.quality).toBe("hybrid-refined");
    expect(report.rtpBps).toBe(10_000);
    expect(report.residual?.error99Bps).toBe(0);
  });
});
