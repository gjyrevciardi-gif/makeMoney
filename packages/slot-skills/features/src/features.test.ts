import { describe, expect, it } from "vitest";
import { featureCatalog, featureRegistry } from "./index.js";

describe("feature catalog", () => {
  it("contains every planned feature once", () => {
    expect(featureCatalog.length).toBe(95);
    expect(new Set(featureCatalog.map((feature) => feature.id)).size).toBe(featureCatalog.length);
  });

  it("implements every catalogued mechanic", () => {
    expect(featureCatalog.every((feature) => feature.status === "implemented")).toBe(true);
    expect(featureRegistry["rewind"]?.status).toBe("implemented");
    expect(featureRegistry["near-miss-enhancement"]?.requires).toEqual(["outcome:natural-near-trigger"]);
    expect(featureRegistry["scatter-trigger"]?.provides).toContain("outcome:natural-near-trigger");
  });

  it("provides specific catalogue copy and detailed rules for every feature", () => {
    expect(new Set(featureCatalog.map((feature) => feature.description)).size).toBe(featureCatalog.length);
    for (const feature of featureCatalog) {
      expect(feature.description).not.toContain("slot mechanic in the");
      expect(feature.guide.howItWorks.length, feature.id).toBeGreaterThan(80);
      expect(feature.guide.rules.length, feature.id).toBeGreaterThanOrEqual(3);
      expect(feature.guide.rules.every((rule) => rule.length > 20), feature.id).toBe(true);
    }
  });
});
