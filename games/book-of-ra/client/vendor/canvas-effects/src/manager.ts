import { effectRegistry, type EffectId } from "./registry.js";
import type { EffectFrame, EffectInstance, EffectMode, EffectOptions, EffectTarget } from "./types.js";

export interface EffectManagerOptions {
  mode?: EffectMode;
  dpr?: number;
  reducedMotion?: boolean;
  /** Clear the owned canvas before every rendered frame. Enable for overlay canvases. */
  clearBeforeRender?: boolean;
}

export class EffectManager {
  readonly ctx: CanvasRenderingContext2D;
  readonly mode: EffectMode;
  readonly dpr: number;
  readonly reducedMotion: boolean;
  readonly clearBeforeRender: boolean;
  #instances: EffectInstance[] = [];
  #lastNow = 0;

  constructor(ctx: CanvasRenderingContext2D, options: EffectManagerOptions = {}) {
    this.ctx = ctx;
    this.mode = options.mode ?? "production";
    this.dpr = options.dpr ?? globalThis.devicePixelRatio ?? 1;
    this.reducedMotion = options.reducedMotion ?? false;
    this.clearBeforeRender = options.clearBeforeRender ?? false;
  }

  play(id: EffectId, target: EffectTarget, options: EffectOptions = {}, nowMs = performance.now()): EffectInstance {
    const definition = effectRegistry[id];
    if (!definition) throw new Error(`Unknown slot effect: ${id}`);
    if (!definition.metadata.targets.includes(target.kind)) {
      throw new Error(`Effect ${id} does not support target kind ${target.kind}`);
    }
    const instance = definition.create(target, options);
    instance.start(nowMs);
    this.#instances.push(instance);
    return instance;
  }

  tick(nowMs = performance.now()): void {
    if (this.clearBeforeRender) this.#clearCanvas();
    const deltaMs = this.#lastNow === 0 ? 0 : Math.max(0, nowMs - this.#lastNow);
    this.#lastNow = nowMs;
    this.#instances.sort((a, b) => a.options.zIndex - b.options.zIndex);
    for (const instance of this.#instances) {
      instance.update(nowMs, deltaMs);
      const duration = Math.max(1, instance.options.durationMs);
      const elapsed = instance.elapsedMs();
      const frame: EffectFrame = {
        ctx: this.ctx,
        nowMs,
        deltaMs,
        elapsedMs: elapsed,
        progress: instance.options.loop ? (elapsed % duration) / duration : Math.min(1, elapsed / duration),
        target: instance.target,
        options: instance.options,
        mode: this.mode,
        reducedMotion: this.reducedMotion,
        dpr: this.dpr,
      };
      this.ctx.save();
      try {
        if (instance.options.blendMode) this.ctx.globalCompositeOperation = instance.options.blendMode;
        if (instance.target.clip) {
          const bounds = instance.target.bounds();
          this.ctx.beginPath();
          this.ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
          this.ctx.clip();
        }
        instance.render(frame);
      } finally {
        this.ctx.restore();
      }
    }
    const completed = this.#instances.filter((instance) => instance.isComplete());
    completed.forEach((instance) => instance.destroy());
    this.#instances = this.#instances.filter((instance) => !instance.isComplete());
  }

  stop(instance: EffectInstance): void {
    instance.stop();
  }

  clear(): void {
    this.#instances.forEach((instance) => instance.destroy());
    this.#instances = [];
    if (this.clearBeforeRender) this.#clearCanvas();
  }

  destroy(): void {
    this.clear();
  }

  get activeCount(): number {
    return this.#instances.length;
  }

  #clearCanvas(): void {
    this.ctx.save();
    try {
      this.ctx.resetTransform();
      this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    } finally {
      this.ctx.restore();
    }
  }
}
