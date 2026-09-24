import type { EffectId } from "./registry.js";

export type AmbientEffectScope = "full-background" | "anchored";
export type AmbientPlaybackPreset =
  | { mode: "continuous"; durationMs: number }
  | { mode: "random-interval"; durationMs: number; minIntervalMs: number; maxIntervalMs: number };

export interface AmbientEffectPreset {
  effectId: EffectId;
  allowedScopes: readonly AmbientEffectScope[];
  defaultScope: AmbientEffectScope;
  defaultPlayback: AmbientPlaybackPreset;
  defaultIntensity: number;
}

const continuous = (durationMs: number): AmbientPlaybackPreset => ({ mode: "continuous", durationMs });
const random = (durationMs: number, minIntervalMs: number, maxIntervalMs: number): AmbientPlaybackPreset => ({ mode: "random-interval", durationMs, minIntervalMs, maxIntervalMs });

export const ambientEffectCatalog: readonly AmbientEffectPreset[] = Object.freeze([
  { effectId: "background-particles", allowedScopes: ["full-background"], defaultScope: "full-background", defaultPlayback: continuous(4000), defaultIntensity: 0.7 },
  { effectId: "background-stars", allowedScopes: ["full-background"], defaultScope: "full-background", defaultPlayback: continuous(5000), defaultIntensity: 0.7 },
  { effectId: "background-bokeh", allowedScopes: ["full-background"], defaultScope: "full-background", defaultPlayback: continuous(5000), defaultIntensity: 0.65 },
  { effectId: "background-aurora", allowedScopes: ["full-background"], defaultScope: "full-background", defaultPlayback: continuous(6000), defaultIntensity: 0.65 },
  { effectId: "background-color-cycle", allowedScopes: ["full-background"], defaultScope: "full-background", defaultPlayback: continuous(7000), defaultIntensity: 0.55 },
  { effectId: "light-beam", allowedScopes: ["full-background", "anchored"], defaultScope: "full-background", defaultPlayback: continuous(5000), defaultIntensity: 0.65 },
  { effectId: "light-rays", allowedScopes: ["full-background", "anchored"], defaultScope: "full-background", defaultPlayback: continuous(7000), defaultIntensity: 0.55 },
  { effectId: "light-point-glow", allowedScopes: ["full-background", "anchored"], defaultScope: "anchored", defaultPlayback: continuous(3500), defaultIntensity: 0.7 },
  { effectId: "smoke-drift", allowedScopes: ["full-background", "anchored"], defaultScope: "full-background", defaultPlayback: continuous(7000), defaultIntensity: 0.6 },
  { effectId: "smoke-floor-fog", allowedScopes: ["full-background", "anchored"], defaultScope: "full-background", defaultPlayback: continuous(7000), defaultIntensity: 0.6 },
  { effectId: "background-lightning", allowedScopes: ["full-background"], defaultScope: "full-background", defaultPlayback: random(2900, 6000, 14000), defaultIntensity: 0.8 },
  { effectId: "shine-sparkle", allowedScopes: ["anchored"], defaultScope: "anchored", defaultPlayback: random(1600, 2500, 7000), defaultIntensity: 0.9 },
  { effectId: "shine-glint", allowedScopes: ["anchored"], defaultScope: "anchored", defaultPlayback: random(1200, 2500, 7000), defaultIntensity: 0.9 },
  { effectId: "shine-twinkle", allowedScopes: ["anchored"], defaultScope: "anchored", defaultPlayback: continuous(3000), defaultIntensity: 0.7 },
] satisfies readonly AmbientEffectPreset[]);

export const ambientEffectIds = Object.freeze(ambientEffectCatalog.map((entry) => entry.effectId));

export function ambientEffectPreset(id: string): AmbientEffectPreset | undefined {
  return ambientEffectCatalog.find((entry) => entry.effectId === id);
}
