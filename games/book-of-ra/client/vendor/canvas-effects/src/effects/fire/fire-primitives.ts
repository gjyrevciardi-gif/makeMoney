import type { EffectOptions, EffectParameterDefinition } from "../../types.js";

export const fireParameters = Object.freeze([
  { key: "density", label: "Detail density", description: "Flame tongues and live particles.", kind: "number", defaultValue: 1, min: 0.4, max: 2, step: 0.1 },
  { key: "turbulence", label: "Turbulence", description: "Flicker, curl, and breakup in the flame front.", kind: "number", defaultValue: 1, min: 0.2, max: 2, step: 0.1 },
  { key: "wind", label: "Wind", description: "Horizontal lean; negative values push left.", kind: "number", defaultValue: 0, min: -1, max: 1, step: 0.05 },
  { key: "flameHeight", label: "Flame height", description: "Vertical reach of the hot flame body.", kind: "number", defaultValue: 1, min: 0.5, max: 1.4, step: 0.05 },
  { key: "embers", label: "Embers", description: "Amount and brightness of flying embers.", kind: "number", defaultValue: 1, min: 0, max: 2, step: 0.1 },
  { key: "smoke", label: "Smoke", description: "Dark smoke carried above and behind the flames.", kind: "number", defaultValue: 1, min: 0, max: 2, step: 0.1 },
  { key: "bloom", label: "Heat bloom", description: "Additive glow surrounding the hottest regions.", kind: "number", defaultValue: 1, min: 0.25, max: 1.75, step: 0.05 },
] satisfies readonly EffectParameterDefinition[]);

export interface FireSettings {
  density: number;
  turbulence: number;
  wind: number;
  flameHeight: number;
  embers: number;
  smoke: number;
  bloom: number;
}

export function fireSettings(options: EffectOptions): FireSettings {
  const parameters = options.parameters ?? {};
  return {
    density: numeric(parameters.density, 1),
    turbulence: numeric(parameters.turbulence, 1),
    wind: numeric(parameters.wind, 0),
    flameHeight: numeric(parameters.flameHeight, 1),
    embers: numeric(parameters.embers, 1),
    smoke: numeric(parameters.smoke, 1),
    bloom: numeric(parameters.bloom, 1),
  };
}

export function fireCount(base: number, settings: FireSettings, multiplier = 1): number {
  return Math.max(3, Math.round(base * settings.density * multiplier));
}

function numeric(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
