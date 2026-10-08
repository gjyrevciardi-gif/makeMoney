import { describe, expect, it } from "vitest";
import type { GameConfig } from "@slot-skills/schema";
import { evaluateGrid, scatterWins, SeededRngProvider, multiplyRational } from "./index.js";

const game = {
  math: {
    evaluator: "paylines",
    paylines: [[0, 0, 0]],
    paytable: [{ symbolId: "a", count: 3, payout: { numerator: "5", denominator: "1" }, basis: "line-bet" }],
  },
  symbols: [{ id: "a", kind: "normal" }, { id: "wild", kind: "wild" }],
} as unknown as GameConfig;

describe("slot math", () => {
  it("uses exact integer payout arithmetic", () => {
    expect(multiplyRational(100n, { numerator: "5", denominator: "2" })).toBe(250n);
    expect(() => multiplyRational(1n, { numerator: "1", denominator: "2" })).toThrow(/does not divide/);
  });

  it("evaluates paylines with wild substitution", () => {
    expect(evaluateGrid(game, [["wild"], ["a"], ["a"]], "100").totalWinUnits).toBe("500");
  });

  it("produces reproducible test draws", async () => {
    const first = new SeededRngProvider(42);
    const second = new SeededRngProvider(42);
    expect((await first.uniformInt(100, "x")).value).toBe((await second.uniformInt(100, "x")).value);
  });

  it("excludes scatter and bonus symbols from count evaluation", () => {
    const countGame = {
      math: {
        evaluator: "count",
        paytable: [
          { symbolId: "a", count: 3, payout: { numerator: "2", denominator: "1" }, basis: "bet" },
          { symbolId: "s", count: 3, payout: { numerator: "3", denominator: "1" }, basis: "bet" },
          { symbolId: "b", count: 3, payout: { numerator: "4", denominator: "1" }, basis: "bet" },
        ],
      },
      symbols: [{ id: "a", kind: "normal" }, { id: "s", kind: "scatter" }, { id: "b", kind: "bonus" }],
    } as unknown as GameConfig;
    const grid = [["a", "s"], ["a", "s"], ["a", "s"], ["b", "b"], ["b", "a"]];
    const evaluation = evaluateGrid(countGame, grid, "100");
    expect(evaluation.wins.map((win) => win.symbolId)).toEqual(["a"]);
    expect(evaluation.totalWinUnits).toBe("200");
    const scatters = scatterWins(countGame, grid, 100n);
    expect(scatters.map((win) => [win.symbolId, win.count])).toEqual([["s", 3], ["b", 3]]);
  });
});
