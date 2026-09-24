import type { AssetEntry, CharacterAnimationMapping, CharacterWinSize, GameConfig, PaytableEntry } from "@slot-skills/schema";

export interface PaytableRow extends PaytableEntry {
  symbolName: string;
}

export function paytableRows(game: GameConfig): PaytableRow[] {
  const names = new Map(game.symbols.map((symbol) => [symbol.id, symbol.name]));
  return game.math.paytable.map((entry) => ({ ...entry, symbolName: names.get(entry.symbolId) ?? entry.symbolId }));
}

export function mayCelebrate(betUnits: string, returnUnits: string, game: GameConfig): boolean {
  if (game.presentation.celebrateReturnAtOrBelowStake) return BigInt(returnUnits) > 0n;
  return BigInt(returnUnits) > BigInt(betUnits);
}

export function characterAnimationDurationMs(asset: AssetEntry, fallbackDurationMs: number): number {
  const configured = asset.animationDurationMs;
  return typeof configured === "number" && Number.isFinite(configured) && configured > 0
    ? configured
    : fallbackDurationMs;
}

export function remainingCharacterPoseLockMs(currentPose: string | undefined, lockedUntil: number, now: number): number {
  return currentPose && currentPose !== "idle" ? Math.max(0, lockedUntil - now) : 0;
}

export function characterWinSize(betUnits: string, returnUnits: string): CharacterWinSize | undefined {
  const bet = BigInt(betUnits); const win = BigInt(returnUnits);
  if (win <= 0n || bet <= 0n) return undefined;
  if (win >= bet * 250n) return "epic";
  if (win >= bet * 100n) return "mega";
  if (win >= bet * 25n) return "big";
  if (win >= bet * 10n) return "nice";
  return "small";
}

export function mappedCharacterAnimation(game: GameConfig, trigger: CharacterAnimationMapping["trigger"]): string | undefined {
  const matches = game.presentation.characterAnimationMappings?.filter((mapping) => mapping.trigger.type === trigger.type && (
    trigger.type === "win-size"
      ? mapping.trigger.type === "win-size" && mapping.trigger.size === trigger.size
      : mapping.trigger.type === "feature-start" && mapping.trigger.featureId === trigger.featureId
  )) ?? [];
  return matches.length ? matches[Math.floor(Math.random() * matches.length)]!.animationId : undefined;
}
