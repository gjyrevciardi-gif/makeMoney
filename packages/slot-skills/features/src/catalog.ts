import type { ComponentManifest } from "@slot-skills/schema";
import { featureGuides, type FeatureGuide } from "./guides.js";

export type FeatureCategory = "wild" | "free-spins" | "respin" | "transformation" | "cascade" | "grid" | "collection" | "prize" | "jackpot" | "interactive" | "trigger";

export interface FeatureManifest extends ComponentManifest {
  kind: "feature";
  category: FeatureCategory;
  displayName: string;
  guide: FeatureGuide;
}

const stubbed = new Set<string>();

const groups: Record<FeatureCategory, readonly [string, string][]> = {
  wild: [
    ["expanding-wilds", "Expanding Wilds"], ["sticky-wilds", "Sticky Wilds"], ["walking-wilds", "Walking Wilds"],
    ["stacked-wilds", "Stacked Wilds"], ["random-wilds", "Random Wilds"], ["spreading-wilds", "Spreading Wilds"],
    ["multiplier-wilds", "Multiplier Wilds"], ["shifting-wilds", "Shifting Wilds"], ["mystery-wilds", "Mystery Wilds"],
    ["colossal-wilds", "Colossal Wilds"], ["wild-reels", "Wild Reels"], ["wild-respin", "Wild Respin"],
  ],
  "free-spins": [
    ["free-spins", "Free Spins"], ["retriggering-free-spins", "Retriggering Free Spins"],
    ["increasing-multipliers", "Increasing Multipliers"], ["persistent-multipliers", "Persistent Multipliers"],
    ["sticky-symbols", "Sticky Symbols"], ["expanding-reels", "Expanding Reels"], ["enhanced-symbols", "Enhanced Symbols"],
    ["choose-your-bonus", "Choose Your Bonus"], ["free-spins-trail", "Free Spins Trail"],
  ],
  respin: [
    ["respins", "Respins"], ["hold-and-win", "Hold and Win"], ["lock-and-respin", "Lock and Respin"],
    ["reel-respin", "Reel Respin"], ["nudge", "Nudge"], ["rewind", "Rewind"], ["second-chance", "Second Chance"],
  ],
  transformation: [
    ["mystery-symbols", "Mystery Symbols"], ["symbol-upgrade", "Symbol Upgrade"], ["symbol-swap", "Symbol Swap"],
    ["symbol-removal", "Symbol Removal"], ["symbol-clone", "Symbol Clone"], ["symbol-expansion", "Symbol Expansion"],
    ["split-symbols", "Split Symbols"], ["oversized-symbols", "Oversized Symbols"],
  ],
  cascade: [
    ["cascading-reels", "Cascading Reels"], ["avalanche-wins", "Avalanche Wins"],
    ["increasing-cascade-multiplier", "Increasing Cascade Multiplier"], ["cluster-pays", "Cluster Pays"],
    ["connected-pays", "Connected Pays"], ["pay-anywhere", "Pay Anywhere"], ["symbol-drop", "Symbol Drop"],
    ["chain-reactions", "Chain Reactions"],
  ],
  grid: [
    ["variable-height-ways", "Variable Height Ways"], ["ways-to-win", "Ways to Win"], ["expanding-grid", "Expanding Grid"],
    ["extra-reel", "Extra Reel"], ["reel-growth", "Reel Growth"], ["reel-split", "Reel Split"],
    ["random-reel-modifier", "Random Reel Modifier"], ["adjacent-pays", "Adjacent Pays"],
  ],
  collection: [
    ["symbol-collection", "Symbol Collection"], ["meter-progress", "Meter or Progress Bar"],
    ["level-up-bonus", "Level-Up Bonus"], ["persistent-collection", "Persistent Collection"],
    ["prize-ladder", "Prize Ladder"], ["map-journey-bonus", "Map or Journey Bonus"],
    ["feature-upgrade", "Feature Upgrade"], ["pot-collection", "Pot Collection"],
  ],
  prize: [
    ["coin-values", "Coin Values"], ["cash-collect", "Cash Collect"], ["tumble-multiplier-orbs", "Tumble Multiplier Orbs"], ["multiplier-symbols", "Multiplier Symbols"],
    ["additive-multipliers", "Additive Multipliers"], ["multiplying-multipliers", "Multiplying Multipliers"],
    ["random-prize", "Random Prize"], ["instant-win", "Instant Win"], ["prize-boost", "Prize Boost"],
    ["double-or-nothing", "Double or Nothing"], ["gamble-feature", "Gamble Feature"],
  ],
  jackpot: [
    ["progressive-jackpot", "Progressive Jackpot"], ["fixed-jackpot", "Fixed Jackpot"], ["local-jackpot", "Local Jackpot"],
    ["mystery-jackpot", "Mystery Jackpot"], ["jackpot-wheel", "Jackpot Wheel"], ["jackpot-tiers", "Mini Minor Major Grand"],
    ["jackpot-pick-bonus", "Jackpot Pick Bonus"], ["must-win-by-jackpot", "Must-Win-By Jackpot"],
  ],
  interactive: [
    ["pick-and-click-bonus", "Pick-and-Click Bonus"], ["wheel-bonus", "Wheel Bonus"], ["board-game-bonus", "Board Game Bonus"],
    ["treasure-chest-bonus", "Treasure Chest Bonus"], ["match-three-bonus", "Match-Three Bonus"],
    ["skill-style-bonus", "Shooting or Skill-Style Bonus"], ["choose-a-path-bonus", "Choose-a-Path Bonus"],
    ["boss-battle-bonus", "Boss Battle Bonus"],
  ],
  trigger: [
    ["scatter-trigger", "Scatter Trigger"], ["bonus-buy", "Bonus Buy"], ["random-feature", "Random Feature"],
    ["feature-drop", "Feature Drop"], ["feature-combination", "Feature Combination"],
    ["near-miss-enhancement", "Near-Miss Enhancement"], ["ante-bet", "Ante Bet"], ["feature-guarantee", "Feature Guarantee"],
  ],
};

export const featureCatalog: readonly FeatureManifest[] = Object.freeze(
  (Object.entries(groups) as Array<[FeatureCategory, readonly [string, string][]]>).flatMap(([category, entries]) =>
    entries.map(([id, displayName]) => {
      const guide = featureGuides[id];
      if (!guide) throw new Error(`Missing player-facing guide for feature ${id}`);
      return {
        id, displayName, category, guide, version: "1.0.0", kind: "feature" as const,
        status: stubbed.has(id) ? "stub" as const : "implemented" as const,
        description: guide.description,
        provides: [`feature:${id}`, `category:${category}`, ...(id === "scatter-trigger" ? ["outcome:natural-near-trigger"] : [])],
        minEngineApi: "1.0",
        ...(id === "near-miss-enhancement" ? { requires: ["outcome:natural-near-trigger"] } : {}),
      };
    }),
  ),
);

export const featureIds = featureCatalog.map((feature) => feature.id);
export const featureRegistry = Object.freeze(Object.fromEntries(featureCatalog.map((feature) => [feature.id, feature])) as Record<string, FeatureManifest>);

export function listFeatures(category?: FeatureCategory): FeatureManifest[] {
  return featureCatalog.filter((feature) => !category || feature.category === category);
}
