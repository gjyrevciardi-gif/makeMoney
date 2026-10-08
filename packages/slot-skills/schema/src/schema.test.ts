import { describe, expect, it } from "vitest";
import { resolveCompatibility, validateCanonicalSymbolContract, validateGameConfig } from "./index.js";

describe("slot schema", () => {
  it("rejects incomplete games", () => {
    expect(() => validateGameConfig({ schemaVersion: "2.0" })).toThrow();
  });

  it("enforces canonical tier and special IDs", () => {
    const valid = [
      { id: "high-1", name: "Hero", kind: "normal" as const, asset: "high-1", tags: ["high"] },
      { id: "low-1", name: "Rank", kind: "normal" as const, asset: "low-1", tags: ["low"] },
      { id: "wild", name: "Wild", kind: "wild" as const, asset: "wild" },
    ];
    expect(() => validateCanonicalSymbolContract(valid)).not.toThrow();
    expect(() => validateCanonicalSymbolContract(valid.map((symbol) => symbol.id === "low-1" ? { ...symbol, id: "queen" } : symbol))).toThrow(/canonical/);
    expect(() => validateCanonicalSymbolContract([...valid, { id: "high-3", name: "Other", kind: "normal", asset: "high-3", tags: ["high"] }])).toThrow(/contiguous/);
    expect(() => validateCanonicalSymbolContract([...valid, { id: "wild-2", name: "Other wild", kind: "wild", asset: "wild-2" }])).toThrow(/numbered/);
  });

  it("reports incompatible and stub features", () => {
    const result = resolveCompatibility(
      [{ id: "walking-wilds", enabled: true }],
      "cluster",
      [{ id: "walking-wilds", version: "1.0.0", kind: "feature", status: "stub", description: "", provides: [], evaluators: ["paylines"] }],
      true,
    );
    expect(result.compatible).toBe(false);
    expect(result.errors).toHaveLength(2);
  });
});
