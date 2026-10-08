import { describe, expect, it } from "vitest";
import type { GameConfig } from "@slot-skills/schema";
import { SeededRngProvider, type RngProvider } from "@slot-skills/math";
import { DefaultGameEngine, gbGliReferenceProfile, mtMgaReferenceProfile, roundCostUnits } from "./index.js";

function fixture(): GameConfig {
  return {
    schemaVersion: "2.0", engineApi: "1.0", id: "fixture", version: "1.0.0", title: "Fixture",
    layout: { reels: 3, rows: 1 },
    symbols: [
      { id: "high-1", name: "A", kind: "normal", asset: "high-1", tags: ["high"] },
      { id: "low-1", name: "Low", kind: "normal", asset: "low-1", tags: ["low"] },
      { id: "wild", name: "Wild", kind: "wild", asset: "wild" },
      { id: "scatter", name: "Scatter", kind: "scatter", asset: "scatter" },
    ],
    math: {
      evaluator: "paylines", outcomeGenerator: "reel-strips", targets: { rtpBps: 9600, volatility: "medium", hitRateBps: [2500, 3500], maxWinMultiplier: { numerator: "5000", denominator: "1" } },
      paytable: [{ symbolId: "high-1", count: 3, payout: { numerator: "2", denominator: "1" }, basis: "bet" }],
      paylines: [[0, 0, 0]], reelStrips: [["high-1"], ["high-1"], ["high-1"]],
    },
    features: [], assets: [{ id: "high-1", role: "symbol", path: "a.svg" }, { id: "low-1", role: "symbol", path: "l.svg" }, { id: "wild", role: "symbol", path: "w.svg" }, { id: "scatter", role: "symbol", path: "s.svg" }],
    theme: { id: "fixture", palette: ["#000"], components: {} }, locales: { default: "en", packs: { en: "en.json" } },
    jurisdiction: { profileId: "gb-gli-reference", reviewedAt: "2026-07-18", reviewBy: "2026-10-18", sourceUrls: [...gbGliReferenceProfile.sourceUrls] },
    providers: { rng: "node-crypto", wallet: "local", jackpot: "local", session: "local", audit: "local" },
    presentation: { cycleDurationMs: 2500, autoPlay: false, turbo: false, slamStop: false, celebrateReturnAtOrBelowStake: false, reducedMotionFallback: true },
  };
}

class HoldAndWinRng implements RngProvider {
  readonly id = "hold-and-win-test";
  readonly production = false;
  #index = 0;

  async uniformInt(maxExclusive: number, context: string) {
    const index = this.#index++;
    const value = context === "hold-win:0:3:0" ? 0 : context.startsWith("hold-win:") ? maxExclusive - 1 : 0;
    return { value, maxExclusive, index, source: this.id, reference: `${context}:${index}` };
  }
}

describe("round runtime", () => {
  it("replays the same seeded result", async () => {
    const engine = new DefaultGameEngine();
    const request = { roundId: "round", playerId: "player", betUnits: "100" };
    const first = await engine.spin(fixture(), request, new SeededRngProvider(9));
    const second = await engine.spin(fixture(), request, new SeededRngProvider(9));
    expect(first.result.outcomeHash).toBe(second.result.outcomeHash);
    expect(first.result.totalWinUnits).toBe("200");
  });

  it("enforces GB reference presentation rules", () => {
    const game = fixture();
    game.presentation.turbo = true;
    expect(gbGliReferenceProfile.validate(game)).toContain("GB profile prohibits turbo play");
  });

  it("preserves scatter triggers when a cascade removes the triggering symbols", async () => {
    const game = fixture();
    game.math.reelStrips = [["scatter"], ["scatter"], ["scatter"]];
    game.math.paytable.push({ symbolId: "scatter", count: 3, payout: { numerator: "1", denominator: "1" }, basis: "bet" });
    game.features = [
      { id: "cascading-reels", enabled: true },
      { id: "scatter-trigger", enabled: true, config: { count: 3 } },
      { id: "free-spins", enabled: true, config: { spins: 1 } },
    ];
    const computation = await new DefaultGameEngine().spin(game, { roundId: "cascade-trigger", playerId: "player", betUnits: "100" }, new SeededRngProvider(11));
    expect(computation.result.events.some((event) => event.type === "free-spins-start")).toBe(true);
  });

  it("emits round-complete only after an interactive choice resolves", async () => {
    const game = fixture();
    game.math.reelStrips = [["scatter"], ["scatter"], ["scatter"]];
    game.features = [
      { id: "scatter-trigger", enabled: true, config: { count: 3 } },
      { id: "pick-and-click-bonus", enabled: true, config: { choices: 2, awards: [1] } },
    ];
    const engine = new DefaultGameEngine();
    const pending = await engine.spin(game, { roundId: "choice", playerId: "player", betUnits: "100" }, new SeededRngProvider(12));
    expect(pending.result.events.filter((event) => event.type === "round-complete")).toHaveLength(0);
    const complete = engine.resolveAction(pending.continuation!, pending.continuation!.action.id, pending.continuation!.action.choices[0]!.id);
    expect(complete.events.filter((event) => event.type === "round-complete")).toHaveLength(1);
  });

  it("emits immutable cumulative Hold and Win grids from a configured scatter trigger", async () => {
    const game = fixture();
    game.symbols.push({ id: "bonus-2", name: "Prize Coin", kind: "bonus", asset: "bonus-coin" }); game.assets.push({ id: "bonus-coin", role: "symbol", path: "coin.svg" });
    game.layout = { reels: 5, rows: 1 };
    game.math.reelStrips = [["scatter"], ["scatter"], ["scatter"], ["high-1"], ["high-1"]];
    game.math.paylines = [[0, 0, 0, 0, 0]];
    game.features = [
      { id: "scatter-trigger", enabled: true, config: { count: 3 } },
      { id: "hold-and-win", enabled: true, config: { triggerCount: 3, triggerSymbolKind: "scatter", coinSymbolId: "bonus-2", hitBps: 5000 } },
    ];
    const result = await new DefaultGameEngine().spin(game, { roundId: "scatter-hold-win", playerId: "player", betUnits: "100" }, new HoldAndWinRng());
    const start = result.result.events.find((event) => event.type === "hold-win-start")!;
    const respins = result.result.events.filter((event) => event.type === "respin");
    expect(start.data.cells).toEqual([[true], [true], [true], [false], [false]]);
    expect(start.data.grid).toEqual([["bonus-2"], ["bonus-2"], ["bonus-2"], ["high-1"], ["high-1"]]);
    expect(respins).toHaveLength(4);
    expect(respins[0]!.data.cells).toEqual([[true], [true], [true], [true], [false]]);
    expect(respins[3]!.data.cells).toEqual([[true], [true], [true], [true], [false]]);
    for (const event of respins) {
      const cells = event.data.cells as boolean[][];
      const grid = event.data.grid as string[][];
      expect(grid).toEqual(cells.map((column) => column.map((held) => held ? "bonus-2" : "high-1")));
    }
    expect(result.result.events.some((event) => event.type === "hold-win-end")).toBe(true);
    expect(result.result.totalWinUnits).toBe("400");
  });
});

/** Pay-anywhere fixture in the shape of a tumble game: count evaluator, orbs, scatters. */
function countFixture(): GameConfig {
  const game = fixture();
  game.id = "count-fixture";
  game.layout = { reels: 4, rows: 1 };
  game.symbols.push({ id: "bonus", name: "Orb", kind: "bonus", asset: "bonus" });
  game.assets.push({ id: "bonus", role: "symbol", path: "b.svg" });
  game.math.evaluator = "count";
  delete game.math.paylines;
  game.math.reelStrips = [["high-1"], ["high-1"], ["high-1"], ["bonus"]];
  game.math.symbolWeights = { "low-1": 1 };
  game.jurisdiction.profileId = "mt-mga-reference";
  return game;
}

describe("tumble multiplier orbs", () => {
  const orbFeature = (values: number[], weights: number[]) => ({ id: "tumble-multiplier-orbs", enabled: true, config: { symbolId: "bonus", values, weights } });

  it("multiplies the end-of-sequence total by the sum of orb values in the base game", async () => {
    const game = countFixture();
    game.features = [orbFeature([10], [1])];
    const computation = await new DefaultGameEngine().spin(game, { roundId: "orbs-base", playerId: "player", betUnits: "100" }, new SeededRngProvider(3));
    const events = computation.result.events;
    const symbolValue = events.find((event) => event.type === "symbol-value");
    expect(symbolValue?.data.valueMultiplier).toBe(10);
    expect(symbolValue?.data.reel).toBe(3);
    const tumble = events.find((event) => event.type === "tumble-multiplier");
    expect(tumble?.data.sum).toBe(10);
    expect(tumble?.data.totalMultiplier).toBe(10);
    expect(tumble?.data.winBeforeUnits).toBe("200");
    expect(computation.result.totalWinUnits).toBe("2000");
  });

  it("keeps orb values aligned when cascades shift symbols down", async () => {
    const game = countFixture();
    game.layout = { reels: 3, rows: 2 };
    game.math.reelStrips = [["high-1", "high-1"], ["high-1", "high-1"], ["high-1", "bonus"]];
    game.features = [{ id: "cascading-reels", enabled: true }, orbFeature([7], [1])];
    const computation = await new DefaultGameEngine().spin(game, { roundId: "orbs-cascade", playerId: "player", betUnits: "100" }, new SeededRngProvider(5));
    const events = computation.result.events;
    const drop = events.find((event) => event.type === "symbols-drop");
    expect(drop).toBeDefined();
    const orbValues = drop!.data.orbValues as Array<Array<number | undefined>>;
    expect(orbValues[2]).toEqual([undefined, 7]);
    const tumble = events.find((event) => event.type === "tumble-multiplier");
    expect(tumble?.data.sum).toBe(7);
    expect(computation.result.totalWinUnits).toBe("1400");
  });

  it("accumulates a persistent total multiplier across free spins", async () => {
    const game = countFixture();
    game.features = [
      orbFeature([10], [1]),
      { id: "scatter-trigger", enabled: true, config: { count: 0 } },
      { id: "free-spins", enabled: true, config: { spins: 2 } },
    ];
    const computation = await new DefaultGameEngine().spin(game, { roundId: "orbs-free-spins", playerId: "player", betUnits: "100" }, new SeededRngProvider(7));
    const tumbles = computation.result.events.filter((event) => event.type === "tumble-multiplier");
    expect(tumbles.map((event) => event.data.totalMultiplier)).toEqual([10, 10, 20]);
    expect(computation.result.totalWinUnits).toBe((2000 + 2000 + 4000).toString());
  });

  it("clamps the round win to the configured maximum multiplier", async () => {
    const game = countFixture();
    game.math.targets.maxWinMultiplier = { numerator: "5", denominator: "1" };
    game.features = [orbFeature([10], [1])];
    const computation = await new DefaultGameEngine().spin(game, { roundId: "orbs-cap", playerId: "player", betUnits: "100" }, new SeededRngProvider(3));
    const capEvent = computation.result.events.find((event) => event.type === "max-win");
    expect(capEvent?.data.capUnits).toBe("500");
    expect(capEvent?.data.uncappedWinUnits).toBe("2000");
    expect(computation.result.totalWinUnits).toBe("500");
    expect(computation.result.netUnits).toBe("400");
  });
});

describe("count-mode scatter pays and triggers", () => {
  it("pays scatters exactly once per tumble sequence on the final grid", async () => {
    const game = countFixture();
    game.math.reelStrips = [["scatter"], ["scatter"], ["scatter"], ["scatter"]];
    game.math.paytable.push({ symbolId: "scatter", count: 4, payout: { numerator: "3", denominator: "1" }, basis: "bet" });
    game.features = [
      { id: "cascading-reels", enabled: true },
      { id: "scatter-trigger", enabled: true, config: { count: 4, countOn: "final-grid" } },
      { id: "free-spins", enabled: true, config: { spins: 1 } },
    ];
    const computation = await new DefaultGameEngine().spin(game, { roundId: "count-scatter", playerId: "player", betUnits: "100" }, new SeededRngProvider(13));
    const scatterWinEvents = computation.result.events.filter((event) => event.type === "win" && event.data.symbolId === "scatter");
    expect(scatterWinEvents).toHaveLength(2);
    expect(computation.result.events.some((event) => event.type === "free-spins-start")).toBe(true);
    expect(computation.result.totalWinUnits).toBe("600");
  });
});

describe("ante bet and bonus buy", () => {
  it("boosts scatter weights only when the request carries the ante flag", async () => {
    const game = countFixture();
    game.math.outcomeGenerator = "weighted-grid";
    delete game.math.reelStrips;
    game.math.symbolWeights = { "high-1": 1, scatter: 1 };
    game.features = [{ id: "ante-bet", enabled: true, config: { scatterWeightMultiplier: 2, stakeMultiplierBps: 12500 } }];
    const engine = new DefaultGameEngine();
    const plain = await engine.spin(game, { roundId: "no-ante", playerId: "player", betUnits: "100" }, new SeededRngProvider(1));
    expect(plain.result.events.some((event) => event.type === "feature-start" && event.data.featureId === "ante-bet")).toBe(false);
    const ante = await engine.spin(game, { roundId: "ante", playerId: "player", betUnits: "100", anteBet: true }, new SeededRngProvider(1));
    expect(ante.result.events.some((event) => event.type === "feature-start" && event.data.featureId === "ante-bet")).toBe(true);
    expect(BigInt(ante.result.netUnits)).toBe(BigInt(ante.result.totalWinUnits) - 125n);
  });

  it("rejects an ante-bet round that also purchases a feature", async () => {
    const game = countFixture();
    game.features = [
      { id: "ante-bet", enabled: true },
      { id: "bonus-buy", enabled: true },
    ];
    await expect(new DefaultGameEngine().spin(game, { roundId: "conflict", playerId: "player", betUnits: "100", anteBet: true, purchasedFeatureId: "bonus-buy" }, new SeededRngProvider(1))).rejects.toThrow(/Ante bet/);
  });

  it("forces the triggering scatters onto the reveal grid and charges the buy cost", async () => {
    const game = countFixture();
    game.math.reelStrips = [["low-1"], ["low-1"], ["low-1"], ["low-1"]];
    game.features = [
      { id: "scatter-trigger", enabled: true, config: { count: 2 } },
      { id: "free-spins", enabled: true, config: { spins: 1 } },
      { id: "bonus-buy", enabled: true, config: { costMultiplier: 100 } },
    ];
    const computation = await new DefaultGameEngine().spin(game, { roundId: "buy", playerId: "player", betUnits: "100", purchasedFeatureId: "bonus-buy" }, new SeededRngProvider(21));
    const reveal = computation.result.events.find((event) => event.type === "grid-reveal");
    const revealGrid = reveal!.data.grid as string[][];
    expect(revealGrid.flat().filter((symbol) => symbol === "scatter")).toHaveLength(2);
    const buyEvent = computation.result.events.find((event) => event.type === "feature-start" && event.data.featureId === "bonus-buy");
    expect(buyEvent?.data.costUnits).toBe("10000");
    expect(computation.result.events.some((event) => event.type === "free-spins-start")).toBe(true);
    expect(BigInt(computation.result.netUnits)).toBe(BigInt(computation.result.totalWinUnits) - 10000n);
  });

  it("computes round costs for plain, ante, and purchased rounds", () => {
    const game = countFixture();
    game.features = [
      { id: "ante-bet", enabled: true, config: { stakeMultiplierBps: 12500 } },
      { id: "bonus-buy", enabled: true, config: { costMultiplier: 100 } },
    ];
    expect(roundCostUnits(game, { betUnits: "100" })).toBe(100n);
    expect(roundCostUnits(game, { betUnits: "100", anteBet: true })).toBe(125n);
    expect(roundCostUnits(game, { betUnits: "100", purchasedFeatureId: "bonus-buy" })).toBe(10000n);
  });

  it("allows ante bet and bonus buy under the MT reference profile", () => {
    const game = countFixture();
    game.features = [{ id: "ante-bet", enabled: true }, { id: "bonus-buy", enabled: true }];
    expect(mtMgaReferenceProfile.validate(game)).toEqual([]);
  });
});
