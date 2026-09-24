import type {
  EffectFrame,
  EffectInstance,
  EffectMetadata,
  EffectOptions,
  EffectTarget,
  SlotEffect,
} from "./types.js";

const DEFAULTS = {
  durationMs: 800,
  loop: false,
  intensity: 1,
  zIndex: 0,
  seed: 1,
} as const;

class StubEffectInstance implements EffectInstance {
  readonly metadata: EffectMetadata;
  readonly target: EffectTarget;
  readonly options: EffectFrame["options"];
  #startedAt = 0;
  #elapsed = 0;
  #complete = false;

  constructor(metadata: EffectMetadata, target: EffectTarget, options: EffectOptions = {}) {
    this.metadata = metadata;
    this.target = target;
    this.options = { ...DEFAULTS, ...options };
  }

  start(nowMs: number): void {
    this.#startedAt = nowMs;
    this.#elapsed = 0;
    this.#complete = false;
  }

  update(nowMs: number, _deltaMs: number): void {
    this.#elapsed = Math.max(0, nowMs - this.#startedAt);
    if (!this.options.loop && this.#elapsed >= this.options.durationMs) this.#complete = true;
  }

  render(frame: EffectFrame): void {
    if (frame.mode !== "development") return;
    const { x, y, width, height } = this.target.bounds();
    const hue = Math.abs(this.options.seed * 47) % 360;
    frame.ctx.strokeStyle = `hsla(${hue} 85% 60% / 0.9)`;
    frame.ctx.fillStyle = "rgba(12, 14, 24, 0.72)";
    frame.ctx.lineWidth = Math.max(1, frame.dpr);
    frame.ctx.setLineDash([6 * frame.dpr, 4 * frame.dpr]);
    frame.ctx.strokeRect(x, y, width, height);
    frame.ctx.setLineDash([]);
    frame.ctx.font = `${Math.max(11, 12 * frame.dpr)}px system-ui, sans-serif`;
    const label = `STUB: ${this.metadata.id}`;
    const metrics = frame.ctx.measureText(label);
    frame.ctx.fillRect(x + 4, y + 4, metrics.width + 10, 20 * frame.dpr);
    frame.ctx.fillStyle = "white";
    frame.ctx.fillText(label, x + 9, y + 18 * frame.dpr);
  }

  stop(): void {
    this.#complete = true;
  }

  destroy(): void {
    this.#complete = true;
  }

  isComplete(): boolean {
    return this.#complete;
  }

  elapsedMs(): number {
    return this.#elapsed;
  }
}

export function defineStub(metadata: Omit<EffectMetadata, "status" | "parameters" | "defaultPalette">): SlotEffect {
  const completeMetadata: EffectMetadata = Object.freeze({ ...metadata, status: "stub", defaultPalette: Object.freeze([]), parameters: Object.freeze([]) });
  return Object.freeze({
    metadata: completeMetadata,
    create(target: EffectTarget, options?: EffectOptions): EffectInstance {
      return new StubEffectInstance(completeMetadata, target, options);
    },
  });
}
