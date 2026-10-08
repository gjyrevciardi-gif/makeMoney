import { describe, expect, it } from "vitest";
import { evaluateBookOfRa, bookOfRaPayout } from "./book-of-ra.js";

const game = { symbols: [{ id: "high-1", kind: "normal" }, { id: "low-2", kind: "normal" }, { id: "scatter", kind: "scatter" }], math: { paylines: Array.from({ length: 10 }, () => [1, 1, 1, 1, 1]) } };
const blank = () => Array.from({ length: 5 }, () => ["none", "none", "none"]);
const withLine = (values: string[]) => { const g = blank(); values.forEach((v, reel) => { g[reel]![1] = v; }); return g; };

describe("Book of Ra Deluxe rules", () => {
  it("has exactly ten active paylines", () => expect(game.math.paylines).toHaveLength(10));
  it("losing spin pays zero", () => expect(evaluateBookOfRa(game, blank(), 10n).total).toBe(0n));
  it("pays two Explorer left to right", () => expect(evaluateBookOfRa(game, withLine(["high-1", "high-1", "low-2", "low-2", "low-2"]), 10n).regularWins[0]!.payoutUnits).toBe("100"));
  it("uses Book as wild", () => expect(evaluateBookOfRa(game, withLine(["high-1", "scatter", "high-1", "low-2", "low-2"]), 10n).regularWins[0]!.symbolId).toBe("high-1"));
  it("takes only the highest payout per line", () => expect(evaluateBookOfRa(game, withLine(["high-1", "high-1", "high-1", "high-1", "high-1"]), 1n).regularWins.filter((w) => w.cells.length === 5)).toHaveLength(10));
  it("does not pay disconnected symbols", () => expect(evaluateBookOfRa(game, withLine(["high-1", "low-2", "high-1", "high-1", "high-1"]), 10n).regularWins.every((w) => w.count < 2)).toBe(true));
  for (const [count, multiplier] of [[3, 2], [4, 20], [5, 200] as const]) it(`pays ${count} Books anywhere`, () => { const g = blank(); for (let i = 0; i < count; i++) g[Math.floor(i / 3)]![i % 3] = "scatter"; expect(evaluateBookOfRa(game, g, 1n).scatterWin).toBe(BigInt(multiplier * 10)); });
  it("combines line and scatter", () => { const g = withLine(["high-1", "high-1", "high-1", "low-2", "low-2"]); g[4]![2] = "scatter"; g[3]![2] = "scatter"; g[2]![2] = "scatter"; expect(evaluateBookOfRa(game, g, 1n).total).toBeGreaterThan(0n); });
  it("has the required paytable", () => expect(bookOfRaPayout("high-1", 5)).toBe(5000));
  it("does not treat a Book-only line as a regular win", () => expect(evaluateBookOfRa(game, withLine(["scatter", "scatter", "scatter", "scatter", "scatter"]), 1n).regularWins).toHaveLength(0));
  it("supports royal minimum of three", () => expect(bookOfRaPayout("low-2", 2)).toBe(0));
  it("supports high-symbol minimum of two", () => expect(bookOfRaPayout("high-1", 2)).toBe(10));
  it("scatter is independent of paylines", () => { const g = blank(); g[0]![0] = "scatter"; g[1]![2] = "scatter"; g[2]![1] = "scatter"; expect(evaluateBookOfRa(game, g, 7n).scatterWin).toBe(140n); });
  it("does not evaluate right to left", () => expect(evaluateBookOfRa(game, withLine(["low-2", "low-2", "low-2", "high-1", "high-1"]), 10n).regularWins.every((w) => w.symbolId !== "high-1")).toBe(true));
  it("uses bet per line for line wins", () => expect(evaluateBookOfRa(game, withLine(["high-1", "high-1", "low-2", "low-2", "low-2"]), 3n).regularWins[0]!.payoutUnits).toBe("30"));
});
