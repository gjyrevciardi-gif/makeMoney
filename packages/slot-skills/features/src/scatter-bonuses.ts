import type { FeaturePhase, FeatureSelection, GameConfig, ScatterBonusModuleId } from "@slot-skills/schema";

export interface WeightedPrize { score: number; weight: number }
export interface FreeSpinsConfiguration {
  spins: number; retriggerEnabled: boolean; retriggerScatterCount: number; retriggerSpins: number;
  countMode: "final-grid";
  modifiers: {
    randomWilds: { enabled: boolean; count: number };
    expandingWilds: { enabled: boolean };
    stickyWilds: { enabled: boolean; spins: number };
    increasingMultiplier: { enabled: boolean; startsAt: number; increment: number };
    expandingReels: { enabled: boolean; extraRows: number };
    enhancedSymbol: { enabled: boolean; symbolId?: string; multiplier: number };
  };
}
export interface HoldAndWinConfiguration {
  lives: number; resetLivesOnHit: boolean; hitChanceBps: number; maxRespins: number; prizes: WeightedPrize[];
}
export interface PickAndClickConfiguration {
  choices: number; picks: number; revealRemaining: boolean; prizes: WeightedPrize[];
}
export interface ScatterBonusConfiguration {
  activeModuleId: ScatterBonusModuleId;
  modules: {
    "free-spins": FreeSpinsConfiguration;
    "hold-and-win": HoldAndWinConfiguration;
    "pick-and-click-bonus": PickAndClickConfiguration;
  };
}

export const SCATTER_BONUS_DEFAULTS: ScatterBonusConfiguration = {
  activeModuleId: "free-spins",
  modules: {
    "free-spins": {
      spins: 8, retriggerEnabled: true, retriggerScatterCount: 3, retriggerSpins: 3, countMode: "final-grid",
      modifiers: {
        randomWilds: { enabled: false, count: 1 }, expandingWilds: { enabled: false },
        stickyWilds: { enabled: false, spins: 2 }, increasingMultiplier: { enabled: false, startsAt: 1, increment: 1 },
        expandingReels: { enabled: false, extraRows: 3 }, enhancedSymbol: { enabled: false, multiplier: 2 },
      },
    },
    "hold-and-win": { lives: 3, resetLivesOnHit: true, hitChanceBps: 2200, maxRespins: 50, prizes: [{ score: 1, weight: 60 }, { score: 2, weight: 25 }, { score: 5, weight: 10 }, { score: 10, weight: 5 }] },
    "pick-and-click-bonus": { choices: 3, picks: 1, revealRemaining: true, prizes: [{ score: 2, weight: 60 }, { score: 5, weight: 30 }, { score: 10, weight: 10 }] },
  },
};

const copy = <T>(value: T): T => structuredClone(value);
const integer = (value: unknown, name: string, min: number, max: number): number => {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return Number(value);
};
function prizes(value: WeightedPrize[], name: string): WeightedPrize[] {
  if (!Array.isArray(value) || !value.length) throw new Error(`${name} must contain at least one prize`);
  return value.map((entry, index) => ({ score: integer(entry?.score, `${name}[${index}].score`, 1, 1_000_000), weight: integer(entry?.weight, `${name}[${index}].weight`, 1, 1_000_000) }));
}

export function validateScatterBonusConfiguration(input: ScatterBonusConfiguration, symbolIds: string[] = []): ScatterBonusConfiguration {
  if (!["free-spins", "hold-and-win", "pick-and-click-bonus"].includes(input.activeModuleId)) throw new Error("Unknown active bonus module");
  const result = copy(input); const free = result.modules["free-spins"]; const hold = result.modules["hold-and-win"]; const pick = result.modules["pick-and-click-bonus"];
  free.spins = integer(free.spins, "Free spins", 1, 100);
  free.retriggerScatterCount = integer(free.retriggerScatterCount, "Retrigger scatters", 3, 20); free.retriggerSpins = integer(free.retriggerSpins, "Retrigger spins", 1, 100);
  free.modifiers.randomWilds.count = integer(free.modifiers.randomWilds.count, "Random wild count", 1, 100);
  free.modifiers.stickyWilds.spins = integer(free.modifiers.stickyWilds.spins, "Sticky wild spins", 1, 100);
  free.modifiers.increasingMultiplier.startsAt = integer(free.modifiers.increasingMultiplier.startsAt, "Multiplier start", 1, 100);
  free.modifiers.increasingMultiplier.increment = integer(free.modifiers.increasingMultiplier.increment, "Multiplier increment", 1, 100);
  free.modifiers.expandingReels.extraRows = integer(free.modifiers.expandingReels.extraRows, "Extra rows", 1, 10);
  free.modifiers.enhancedSymbol.multiplier = integer(free.modifiers.enhancedSymbol.multiplier, "Enhanced multiplier", 2, 100);
  if (free.modifiers.enhancedSymbol.enabled && (!free.modifiers.enhancedSymbol.symbolId || !symbolIds.includes(free.modifiers.enhancedSymbol.symbolId))) throw new Error("Enhanced symbol must be a valid game symbol");
  hold.lives = integer(hold.lives, "Lives", 1, 20); hold.hitChanceBps = integer(hold.hitChanceBps, "Hit chance", 0, 10_000); hold.maxRespins = integer(hold.maxRespins, "Safety limit", 1, 1_000); hold.prizes = prizes(hold.prizes, "Hold and Win prizes");
  pick.choices = integer(pick.choices, "Choices", 2, 6); pick.picks = integer(pick.picks, "Picks", 1, pick.choices); pick.prizes = prizes(pick.prizes, "Pick prizes");
  return result;
}

export function applyScatterBonusConfiguration(game: GameConfig, configuration: ScatterBonusConfiguration): GameConfig {
  const validated = validateScatterBonusConfiguration(configuration, game.symbols.map(({ id }) => id));
  const ids = Object.keys(validated.modules) as ScatterBonusModuleId[];
  const existing = new Map(game.features.map((feature) => [feature.id, feature]));
  const features = game.features.filter((feature) => !ids.includes(feature.id as ScatterBonusModuleId));
  for (const id of ids) features.push({ ...existing.get(id), id, enabled: id === validated.activeModuleId, config: copy(validated.modules[id]) as unknown as Record<string, unknown> });
  return { ...game, features };
}

export function describeScatterBonusConfiguration(game: GameConfig): ScatterBonusConfiguration {
  const result = copy(SCATTER_BONUS_DEFAULTS); const selected = game.features.find((feature) => feature.enabled && feature.id in result.modules);
  if (selected) result.activeModuleId = selected.id as ScatterBonusModuleId;
  for (const id of Object.keys(result.modules) as ScatterBonusModuleId[]) {
    const saved = game.features.find((feature) => feature.id === id)?.config;
    if (saved) result.modules[id] = { ...result.modules[id], ...copy(saved) } as never;
  }
  return result;
}

export function validateFeatureActivation(features: FeatureSelection[]): void {
  const enabled = new Set(features.filter((feature) => feature.enabled).map((feature) => feature.id));
  for (const feature of features) {
    const activation = feature.activation; if (!activation) continue;
    if (activation.parentFeatureId && !enabled.has(activation.parentFeatureId)) throw new Error(`${feature.id} requires ${activation.parentFeatureId}`);
    const phases = activation.phases ?? [];
    if (new Set(phases).size !== phases.length || phases.some((phase) => !["base", "free-spin", "respin"].includes(phase))) throw new Error(`${feature.id} has invalid activation phases`);
    if (activation.parentFeatureId === "free-spins" && (phases.length !== 1 || phases[0] !== "free-spin")) throw new Error(`${feature.id} modifiers run only during free spins`);
  }
}

export function drawWeightedPrize(entries: WeightedPrize[], draw: number): number {
  const checked = prizes(entries, "Prizes"); const total = checked.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = Math.min(total - 1, Math.max(0, Math.floor(draw * total)));
  for (const entry of checked) { if (cursor < entry.weight) return entry.score; cursor -= entry.weight; }
  return checked.at(-1)!.score;
}

/** Exact proportional integer allocation. Stable order resolves equal remainders. */
export function allocateNormalizedAward(rawAwards: readonly bigint[], normalizedTotal: bigint): bigint[] {
  if (normalizedTotal < 0n || rawAwards.some((award) => award < 0n)) throw new Error("Awards cannot be negative");
  const rawTotal = rawAwards.reduce((sum, award) => sum + award, 0n);
  if (rawTotal === 0n) return rawAwards.map(() => 0n);
  const allocations = rawAwards.map((award, index) => ({ index, units: award * normalizedTotal / rawTotal, remainder: award * normalizedTotal % rawTotal }));
  let left = normalizedTotal - allocations.reduce((sum, entry) => sum + entry.units, 0n);
  for (const entry of [...allocations].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)) {
    if (!left) break; entry.units++; left--;
  }
  return allocations.sort((a, b) => a.index - b.index).map(({ units }) => units);
}

export function normalizeFeatureAward(rawUnits: bigint, betUnits: bigint, scaleNumerator: bigint, scaleDenominator: bigint, offsetUnits: bigint): bigint {
  if (betUnits <= 0n || scaleDenominator <= 0n) throw new Error("Bet and scale denominator must be positive");
  const mapped = rawUnits * scaleNumerator / scaleDenominator + offsetUnits;
  const minimum = betUnits * 10n; const maximum = betUnits * 100n;
  return mapped < minimum ? minimum : mapped > maximum ? maximum : mapped;
}

export function featureRunsInPhase(feature: FeatureSelection, phase: FeaturePhase): boolean {
  return feature.enabled && (!feature.activation?.phases || feature.activation.phases.includes(phase));
}
