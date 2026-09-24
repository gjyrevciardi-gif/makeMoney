import type { EffectOptions, EffectTargetKind } from "./types.js";
import type { EffectId } from "./registry.js";

export interface EffectSample {
  id: EffectId;
  title: string;
  description: string;
  target: EffectTargetKind;
  options: Readonly<EffectOptions>;
}

/**
 * A de-duplicated showcase: one visually distinct, production-quality sample
 * per category. The complete stable registry remains available separately.
 */
export const effectSamples: readonly EffectSample[] = Object.freeze([
  {
    id: "smoke-floor-fog",
    title: "Volumetric floor fog",
    description: "Layered rolling banks with controlled wind, softness, density, and internal turbulence.",
    target: "overlay",
    options: { durationMs: 2800, intensity: 0.9, seed: 29, palette: ["#9aa8bd", "#465166", "#d7deea"], parameters: { density: 1.4, turbulence: 1.25, wind: 0.18, softness: 1.3, volume: 0.85 } },
  },
  {
    id: "fire-inferno",
    title: "Simulation-driven inferno",
    description: "A cellular heat field, shaped flame contours, smoke, hot cores, and windblown embers.",
    target: "overlay",
    options: { durationMs: 2800, intensity: 1.1, seed: 17, parameters: { density: 1.2, turbulence: 1.15, wind: 0.1, flameHeight: 1.05, embers: 1.25, smoke: 0.8, bloom: 1.15 } },
  },
  {
    id: "light-rays",
    title: "Cinematic light rays",
    description: "Layered volumetric beams for feature reveals and premium transitions.",
    target: "overlay",
    options: { durationMs: 2400, intensity: 1.05, seed: 23, palette: ["#fff7d0", "#eab64d", "#ffffff"] },
  },
  {
    id: "shine-gem",
    title: "Faceted gem sheen",
    description: "A crisp, restrained material highlight that keeps symbol artwork legible.",
    target: "symbol",
    options: { durationMs: 1900, intensity: 1.2, seed: 31, palette: ["#ffffff", "#bfe8ff", "#ffe29a"] },
  },
  {
    id: "laser-vortex",
    title: "Laser vortex",
    description: "A coherent neon spiral with a bright focal core and controlled additive energy.",
    target: "overlay",
    options: { durationMs: 2300, intensity: 1.05, seed: 37, palette: ["#3cf5ff", "#8d4dff", "#ffffff"] },
  },
  {
    id: "symbol-electrify",
    title: "Symbol electrify",
    description: "Branching arcs and edge energy designed to frame a winning symbol.",
    target: "symbol",
    options: { durationMs: 1700, intensity: 1.15, seed: 41, palette: ["#8ed7ff", "#5d6dff", "#ffffff"] },
  },
  {
    id: "reel-lock",
    title: "Premium reel lock",
    description: "A persistent lock state with corner clamps, a centre shackle, and controlled energy pulses.",
    target: "reel",
    options: { durationMs: 1800, intensity: 1.15, seed: 43, palette: ["#ffd96b", "#35d6ed", "#ffffff"] },
  },
  {
    id: "button-win",
    title: "Premium win button",
    description: "Layered rings, sparks, and a gold pulse for a high-value interaction state.",
    target: "button",
    options: { durationMs: 1700, intensity: 1.1, seed: 47, palette: ["#ffe47a", "#ff9d35", "#ffffff"] },
  },
  {
    id: "background-lightning",
    title: "Forked storm lightning",
    description: "Configurable strike cadence, branching, flash energy, chaos, and atmospheric bloom.",
    target: "background",
    options: { durationMs: 2900, intensity: 1.05, seed: 53, parameters: { strikes: 3, branching: 1.2, chaos: 1, flash: 0.95, bloom: 1.15 } },
  },
]);
