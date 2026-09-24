import type { AmbientEffectAnchor, AmbientEffectConfig } from "@slot-skills/schema";
import { EffectManager, effectIds, effectRegistry, seededRandom, type EffectId, type EffectTarget, type EffectTargetKind } from "@slot-skills/canvas-effects";

export interface AmbientEffectRendererOptions {
  reducedMotion?: boolean;
  mode?: "development" | "production";
}

interface ScheduledLayer {
  config: AmbientEffectConfig;
  random: () => number;
  nextAt: number;
  zIndex: number;
}

export function mapCoverAnchor(anchor: AmbientEffectAnchor, sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number) {
  const safeSourceWidth = Math.max(1, sourceWidth); const safeSourceHeight = Math.max(1, sourceHeight);
  const scale = Math.max(targetWidth / safeSourceWidth, targetHeight / safeSourceHeight);
  const renderedWidth = safeSourceWidth * scale; const renderedHeight = safeSourceHeight * scale;
  const offsetX = (targetWidth - renderedWidth) / 2; const offsetY = (targetHeight - renderedHeight) / 2;
  return {
    x: offsetX + anchor.x * renderedWidth,
    y: offsetY + anchor.y * renderedHeight,
    width: anchor.width * renderedWidth,
    height: anchor.height * renderedHeight,
  };
}

export class AmbientEffectRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly manager: EffectManager;
  readonly reducedMotion: boolean;
  #layers: ScheduledLayer[] = [];
  #palette: readonly string[] = [];
  #sourceWidth = 1;
  #sourceHeight = 1;

  constructor(canvas: HTMLCanvasElement, options: AmbientEffectRendererOptions = {}) {
    const context = canvas.getContext("2d"); if (!context) throw new Error("Ambient effects require a 2D canvas context");
    this.canvas = canvas; this.reducedMotion = options.reducedMotion ?? false;
    this.manager = new EffectManager(context, { mode: options.mode ?? "production", dpr: 1, reducedMotion: this.reducedMotion, clearBeforeRender: true });
  }

  setSourceSize(width: number, height: number): void {
    this.#sourceWidth = Math.max(1, width); this.#sourceHeight = Math.max(1, height);
  }

  configure(configs: readonly AmbientEffectConfig[], palette: readonly string[], nowMs = performance.now()): void {
    this.manager.clear(); this.#palette = [...palette]; this.#layers = [];
    for (const [zIndex, source] of configs.entries()) {
      const config = structuredClone(source);
      if (!config.enabled || !effectIds.includes(config.effectId as EffectId)) continue;
      const random = seededRandom(config.options.seed);
      const layer: ScheduledLayer = { config, random, nextAt: nowMs, zIndex };
      if (config.playback.mode === "continuous") this.#play(layer, true, nowMs);
      else layer.nextAt = nowMs + this.#interval(layer);
      this.#layers.push(layer);
    }
  }

  tick(nowMs = performance.now()): void {
    if (!this.reducedMotion) {
      for (const layer of this.#layers) {
        if (layer.config.playback.mode !== "random-interval" || nowMs < layer.nextAt) continue;
        this.#play(layer, false, nowMs);
        layer.nextAt = nowMs + layer.config.playback.durationMs + this.#interval(layer);
      }
    }
    this.manager.tick(nowMs);
  }

  trigger(instanceId: string, nowMs = performance.now()): void {
    const layer = this.#layers.find((candidate) => candidate.config.instanceId === instanceId);
    if (layer && !this.reducedMotion) this.#play(layer, false, nowMs);
  }

  destroy(): void { this.#layers = []; this.manager.destroy(); }

  #interval(layer: ScheduledLayer): number {
    if (layer.config.playback.mode !== "random-interval") return layer.config.playback.durationMs;
    const { minIntervalMs, maxIntervalMs } = layer.config.playback;
    return minIntervalMs + layer.random() * Math.max(0, maxIntervalMs - minIntervalMs);
  }

  #play(layer: ScheduledLayer, loop: boolean, nowMs: number): void {
    const effectId = layer.config.effectId as EffectId; const definition = effectRegistry[effectId]; if (!definition) return;
    const target = this.#target(layer.config, definition.metadata.targets);
    if (!target) return;
    this.manager.play(effectId, target, {
      durationMs: layer.config.playback.durationMs, loop, intensity: layer.config.options.intensity,
      seed: layer.config.options.seed, zIndex: layer.zIndex, palette: layer.config.options.palette?.length ? layer.config.options.palette : this.#palette,
      ...(layer.config.options.parameters ? { parameters: layer.config.options.parameters } : {}),
    }, nowMs);
  }

  #target(config: AmbientEffectConfig, supported: readonly EffectTargetKind[]): EffectTarget | undefined {
    const kind = config.scope === "full-background"
      ? (["background", "overlay"] as const).find((candidate) => supported.includes(candidate))
      : (["overlay", "background"] as const).find((candidate) => supported.includes(candidate));
    if (!kind) return undefined;
    return {
      kind, id: config.instanceId, clip: true,
      bounds: () => config.scope === "anchored" && config.anchor
        ? mapCoverAnchor(config.anchor, this.#sourceWidth, this.#sourceHeight, this.canvas.width, this.canvas.height)
        : { x: 0, y: 0, width: this.canvas.width, height: this.canvas.height },
    };
  }
}
