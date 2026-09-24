export { EffectManager, type EffectManagerOptions } from "./manager.js";
export { ambientEffectCatalog, ambientEffectIds, ambientEffectPreset, type AmbientEffectPreset, type AmbientEffectScope, type AmbientPlaybackPreset } from "./ambient.js";
export { clamp01, defineEffect, easeInCubic, easeInOutCubic, easeOutBack, easeOutCubic, pulse, seededRandom, type EffectDefinition, type EffectRenderContext } from "./effect.js";
export { effectCatalog, effectIds, effectRegistry, type EffectId } from "./registry.js";
export { effectSamples, type EffectSample } from "./samples.js";
export { elementTarget, fixedTarget } from "./targets.js";
export type {
  EffectCategory,
  EffectFrame,
  EffectInstance,
  EffectMetadata,
  EffectMode,
  EffectOptions,
  EffectParameterDefinition,
  EffectParameterValue,
  EffectRect,
  EffectStatus,
  EffectTarget,
  EffectTargetKind,
  SlotEffect,
} from "./types.js";
