import { describe, expect, it } from "vitest";
import type { GameConfig } from "@slot-skills/schema";
import { SeededRngProvider } from "@slot-skills/math";
import { ReferenceGameHost, ReferenceSqliteStore } from "./index.js";

const game = {
  schemaVersion: "2.0", engineApi: "1.0", id: "host-fixture", version: "1.0.0", title: "Host Fixture",
  layout: { reels: 3, rows: 1 },
  symbols: [{ id: "high-1", name: "A", kind: "normal", asset: "high-1", tags: ["high"] }, { id: "low-1", name: "Low", kind: "normal", asset: "low-1", tags: ["low"] }, { id: "wild", name: "Wild", kind: "wild", asset: "wild" }],
  math: { evaluator: "paylines", outcomeGenerator: "reel-strips", targets: { rtpBps: 9600, volatility: "medium", hitRateBps: [2500, 3500], maxWinMultiplier: { numerator: "5000", denominator: "1" } }, paytable: [{ symbolId: "high-1", count: 3, payout: { numerator: "2", denominator: "1" }, basis: "bet" }], paylines: [[0, 0, 0]], reelStrips: [["high-1"], ["high-1"], ["high-1"]] },
  features: [], assets: [{ id: "high-1", role: "symbol", path: "a.svg" }, { id: "low-1", role: "symbol", path: "low.svg" }, { id: "wild", role: "symbol", path: "wild.svg" }],
  theme: { id: "fixture", palette: ["#000"], components: {} }, locales: { default: "en", packs: { en: "en.json" } },
  jurisdiction: { profileId: "gb-gli-reference", reviewedAt: "2026-07-18", reviewBy: "2026-10-18", sourceUrls: ["https://www.gamblingcommission.gov.uk/"] },
  providers: { rng: "external", wallet: "external", jackpot: "external", session: "external", audit: "external" },
  presentation: { cycleDurationMs: 2500, autoPlay: false, turbo: false, slamStop: false, celebrateReturnAtOrBelowStake: false, reducedMotionFallback: true },
} as GameConfig;

describe("reference host", () => {
  it("settles an idempotent round transactionally", async () => {
    const store = new ReferenceSqliteStore();
    store.initializePlayer({ playerId: "p1", ageBand: "25+", jurisdiction: "gb-gli-reference", locale: "en" }, "1000");
    const host = new ReferenceGameHost({ games: [game], providers: { wallet: store, jackpot: store, sessions: store, audit: store, rounds: store }, rng: new SeededRngProvider(1), now: () => 1000 });
    const input = { gameId: game.id, playerId: "p1", betUnits: "100", idempotencyKey: "same-request" };
    const first = await host.spin(input);
    const second = await host.spin(input);
    expect(second.roundId).toBe(first.roundId);
    expect(await store.balance("p1")).toBe("1100");
    store.close();
  });

  it("rejects test RNG in production mode", () => {
    const store = new ReferenceSqliteStore();
    expect(() => new ReferenceGameHost({ games: [game], providers: { wallet: store, jackpot: store, sessions: store, audit: store, rounds: store }, rng: new SeededRngProvider(1), production: true })).toThrow(/cannot run in production/);
    store.close();
  });
});
