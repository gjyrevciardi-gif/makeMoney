import type { CanonicalSymbolId, SymbolConfig, SymbolKind, SymbolTier } from "./types.js";

const NORMAL_ID = /^(low|high)-([1-9][0-9]*)$/;
const SPECIAL_KINDS = ["wild", "scatter", "bonus", "collect", "jackpot"] as const;

export interface CanonicalSymbolIdentity {
  id: CanonicalSymbolId;
  kind: SymbolKind;
  tier?: SymbolTier;
  index?: number;
}

export function parseCanonicalSymbolId(id: string): CanonicalSymbolIdentity | undefined {
  const normal = NORMAL_ID.exec(id);
  if (normal) return { id: id as CanonicalSymbolId, kind: "normal", tier: normal[1] as SymbolTier, index: Number(normal[2]) };
  for (const kind of SPECIAL_KINDS) {
    if (id === kind) return { id: id as CanonicalSymbolId, kind };
    const numbered = new RegExp(`^${kind}-([1-9][0-9]*)$`).exec(id);
    if (numbered) return { id: id as CanonicalSymbolId, kind, index: Number(numbered[1]) };
  }
  return undefined;
}

export function isCanonicalSymbolId(id: string): id is CanonicalSymbolId {
  return parseCanonicalSymbolId(id) !== undefined;
}

function assertContiguous(label: string, indexes: number[]): void {
  const sorted = [...indexes].sort((left, right) => left - right);
  for (let position = 0; position < sorted.length; position += 1) {
    if (sorted[position] !== position + 1) throw new Error(`${label} symbol IDs must be contiguous from ${label}-1`);
  }
}

export function validateCanonicalSymbolContract(symbols: readonly SymbolConfig[]): void {
  const tierIndexes: Record<SymbolTier, number[]> = { low: [], high: [] };
  const specials = new Map<(typeof SPECIAL_KINDS)[number], SymbolConfig[]>();

  for (const symbol of symbols) {
    const identity = parseCanonicalSymbolId(symbol.id);
    if (!identity) throw new Error(`Symbol ${symbol.id} does not use a canonical low/high/special ID`);
    if (identity.kind !== symbol.kind) throw new Error(`Symbol ${symbol.id} must use kind ${identity.kind}, not ${symbol.kind}`);
    if (symbol.kind === "normal") {
      const tier = identity.tier!;
      const tags = new Set(symbol.tags ?? []);
      if (!tags.has(tier) || tags.has(tier === "low" ? "high" : "low")) throw new Error(`Normal symbol ${symbol.id} must have exactly its ${tier} tier tag`);
      tierIndexes[tier].push(identity.index!);
    } else {
      const entries = specials.get(symbol.kind) ?? [];
      entries.push(symbol); specials.set(symbol.kind, entries);
    }
  }

  for (const tier of ["low", "high"] as const) {
    if (!tierIndexes[tier].length) throw new Error(`At least one ${tier}-N symbol is required`);
    assertContiguous(tier, tierIndexes[tier]);
  }
  for (const kind of SPECIAL_KINDS) {
    const entries = specials.get(kind) ?? [];
    if (entries.length === 1 && entries[0]!.id !== kind) throw new Error(`A single ${kind} symbol must use the ID ${kind}`);
    if (entries.length > 1) {
      const indexes = entries.map((entry) => parseCanonicalSymbolId(entry.id)?.index).filter((index): index is number => index !== undefined);
      if (indexes.length !== entries.length) throw new Error(`Multiple ${kind} symbols must use numbered IDs`);
      assertContiguous(kind, indexes);
    }
  }
}
