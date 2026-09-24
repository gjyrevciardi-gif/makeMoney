import type {
  EffectFrame,
  EffectInstance,
  EffectMetadata,
  EffectOptions,
  EffectParameterDefinition,
  EffectParameterValue,
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

/** Deterministic per-instance pseudo-random stream (mulberry32) so replays and reduced-motion frames stay stable. */
export function seededRandom(seed: number): () => number {
  let state = (Math.floor(seed) || 1) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t: number): number => t * t * t;
export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack = (t: number): number => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
/** Triangle wave: 0 → 1 → 0 across progress. */
export const pulse = (t: number): number => 1 - Math.abs(2 * clamp01(t) - 1);

export interface EffectPaint {
  /** Primary accent colour resolved from options.palette with a safe fallback. */
  color(index?: number): string;
  /** Accent colour with an explicit alpha. */
  alpha(alphaValue: number, index?: number): string;
}

function parseColor(value: string): [number, number, number] {
  const hex = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const packed = parseInt(hex[1]!, 16);
    return [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255];
  }
  const short = /^#?([0-9a-f]{3})$/i.exec(value.trim());
  if (short) {
    const [r, g, b] = short[1]!.split("");
    return [parseInt(`${r}${r}`, 16), parseInt(`${g}${g}`, 16), parseInt(`${b}${b}`, 16)];
  }
  return [255, 211, 79];
}

function createPaint(options: EffectFrame["options"], fallback: readonly string[]): EffectPaint {
  const palette = options.palette?.length ? options.palette : fallback;
  return {
    color: (index = 0) => palette[index % palette.length] ?? fallback[0]!,
    alpha: (alphaValue, index = 0) => {
      const [r, g, b] = parseColor(palette[index % palette.length] ?? fallback[0]!);
      return `rgba(${r},${g},${b},${clamp01(alphaValue)})`;
    },
  };
}

export interface EffectRenderContext {
  frame: EffectFrame;
  /**
   * Seeded pseudo-random stream that restarts at every frame, so the Nth call
   * returns the same value on every frame. Use it for stable particle layouts;
   * animate with frame.progress rather than by re-rolling values.
   */
  random: () => number;
  paint: EffectPaint;
}

export interface EffectDefinition {
  metadata: Omit<EffectMetadata, "status" | "parameters" | "defaultPalette">;
  /** Default accent palette; overridden by options.palette. */
  palette?: readonly string[];
  /** Typed, clamped controls surfaced by effect browsers and authoring tools. */
  parameters?: readonly EffectParameterDefinition[];
  /** Full animated render. The manager has already saved the context and applied clipping. */
  render(context: EffectRenderContext): void;
  /**
   * Static or minimal variant used when the viewer prefers reduced motion.
   * Defaults to a single soft accent glow when omitted.
   */
  renderReducedMotion?(context: EffectRenderContext): void;
}

class ImplementedEffectInstance implements EffectInstance {
  readonly metadata: EffectMetadata;
  readonly target: EffectTarget;
  readonly options: EffectFrame["options"];
  #definition: EffectDefinition;
  #startedAt = 0;
  #elapsed = 0;
  #complete = false;

  constructor(definition: EffectDefinition, metadata: EffectMetadata, target: EffectTarget, options: EffectOptions = {}) {
    this.#definition = definition;
    this.metadata = metadata;
    this.target = target;
    this.options = {
      ...DEFAULTS,
      ...options,
      parameters: normalizeParameters(definition.parameters ?? [], options.parameters),
    };
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
    const paint = createPaint(frame.options, this.#definition.palette ?? ["#ffd34f", "#ff8a3c", "#fff7c4"]);
    const context: EffectRenderContext = { frame, random: seededRandom(this.options.seed), paint };
    if (frame.reducedMotion) {
      if (this.#definition.renderReducedMotion) {
        this.#definition.renderReducedMotion(context);
      } else {
        const { x, y, width, height } = frame.target.bounds();
        frame.ctx.globalAlpha = 0.35 * frame.options.intensity;
        const gradient = frame.ctx.createRadialGradient(x + width / 2, y + height / 2, 0, x + width / 2, y + height / 2, Math.max(width, height) / 2);
        gradient.addColorStop(0, paint.alpha(0.6));
        gradient.addColorStop(1, paint.alpha(0));
        frame.ctx.fillStyle = gradient;
        frame.ctx.fillRect(x, y, width, height);
      }
      return;
    }
    this.#definition.render(context);
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

export function defineEffect(definition: EffectDefinition): SlotEffect {
  const metadata: EffectMetadata = Object.freeze({
    ...definition.metadata,
    status: "implemented",
    defaultPalette: Object.freeze([...(definition.palette ?? ["#ffd34f", "#ff8a3c", "#fff7c4"])]),
    parameters: Object.freeze([...(definition.parameters ?? [])]),
  });
  return Object.freeze({
    metadata,
    create(target: EffectTarget, options?: EffectOptions): EffectInstance {
      return new ImplementedEffectInstance(definition, metadata, target, options);
    },
  });
}

function normalizeParameters(
  definitions: readonly EffectParameterDefinition[],
  supplied: EffectOptions["parameters"],
): Readonly<Record<string, EffectParameterValue>> {
  const normalized: Record<string, EffectParameterValue> = { ...supplied };
  for (const definition of definitions) {
    const value = supplied?.[definition.key];
    if (definition.kind === "number") {
      const numeric = typeof value === "number" && Number.isFinite(value) ? value : definition.defaultValue;
      normalized[definition.key] = Math.min(definition.max, Math.max(definition.min, numeric));
    } else if (definition.kind === "boolean") {
      normalized[definition.key] = typeof value === "boolean" ? value : definition.defaultValue;
    } else {
      const selected = typeof value === "string" && definition.choices.some((choice) => choice.value === value)
        ? value
        : definition.defaultValue;
      normalized[definition.key] = selected;
    }
  }
  return Object.freeze(normalized);
}
