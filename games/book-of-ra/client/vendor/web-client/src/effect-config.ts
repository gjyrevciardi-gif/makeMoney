import { effectIds, type EffectId } from "@slot-skills/canvas-effects";

/** Resolve only effects explicitly saved on the game. Unconfigured events stay visually silent. */
export function configuredEventEffect(effects: Readonly<Record<string, string>> | undefined, eventType: string): EffectId | undefined {
  const configured = effects?.[eventType];
  return configured && effectIds.includes(configured as EffectId) ? configured as EffectId : undefined;
}
