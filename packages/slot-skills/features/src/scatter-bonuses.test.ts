import { describe, expect, it } from "vitest";
import {
  SCATTER_BONUS_DEFAULTS, allocateNormalizedAward, drawWeightedPrize, normalizeFeatureAward,
  validateFeatureActivation, validateScatterBonusConfiguration,
} from "./scatter-bonuses.js";

describe("scatter bonus configuration", () => {
  it("ships the curated zero-configuration defaults", () => {
    expect(SCATTER_BONUS_DEFAULTS.modules["free-spins"].spins).toBe(8);
    expect(SCATTER_BONUS_DEFAULTS.modules["hold-and-win"].hitChanceBps).toBe(2200);
    expect(SCATTER_BONUS_DEFAULTS.modules["pick-and-click-bonus"].choices).toBe(3);
  });

  it("validates bounds and free-spin modifier dependencies", () => {
    expect(() => validateScatterBonusConfiguration({ ...structuredClone(SCATTER_BONUS_DEFAULTS), modules: { ...structuredClone(SCATTER_BONUS_DEFAULTS.modules), "pick-and-click-bonus": { ...SCATTER_BONUS_DEFAULTS.modules["pick-and-click-bonus"], choices: 7 } } })).toThrow(/2 to 6/);
    expect(() => validateFeatureActivation([{ id: "random-wilds", enabled: true, activation: { parentFeatureId: "free-spins", phases: ["free-spin"] } }])).toThrow(/requires free-spins/);
    expect(() => validateFeatureActivation([{ id: "free-spins", enabled: true }, { id: "random-wilds", enabled: true, activation: { parentFeatureId: "free-spins", phases: ["base"] } }])).toThrow(/only during free spins/);
  });

  it("draws weighted relative prizes at exact boundaries", () => {
    const table = [{ score: 1, weight: 60 }, { score: 2, weight: 25 }, { score: 5, weight: 10 }, { score: 10, weight: 5 }];
    expect(drawWeightedPrize(table, 0)).toBe(1);
    expect(drawWeightedPrize(table, .6)).toBe(2);
    expect(drawWeightedPrize(table, .999)).toBe(10);
  });

  it("allocates normalized totals exactly with deterministic remainders", () => {
    expect(allocateNormalizedAward([1n, 1n, 1n], 10n)).toEqual([4n, 3n, 3n]);
    expect(allocateNormalizedAward([0n, 5n], 17n)).toEqual([0n, 17n]);
  });

  it("guarantees the hard 10x and 100x award bounds", () => {
    expect(normalizeFeatureAward(0n, 100n, 1n, 1n, 0n)).toBe(1_000n);
    expect(normalizeFeatureAward(99_999n, 100n, 1n, 1n, 0n)).toBe(10_000n);
  });
});
