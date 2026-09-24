export type EffectCategory =
  | "smoke"
  | "fire"
  | "lights"
  | "shines"
  | "lasers"
  | "symbols"
  | "reels"
  | "buttons"
  | "backgrounds";

export type EffectTargetKind = "symbol" | "reel" | "button" | "background" | "overlay";
export type EffectMode = "development" | "production";
export type EffectStatus = "stub" | "implemented";
export type EffectParameterValue = number | string | boolean;

interface EffectParameterBase {
  key: string;
  label: string;
  description: string;
}

export interface EffectNumberParameter extends EffectParameterBase {
  kind: "number";
  defaultValue: number;
  min: number;
  max: number;
  step: number;
}

export interface EffectBooleanParameter extends EffectParameterBase {
  kind: "boolean";
  defaultValue: boolean;
}

export interface EffectSelectParameter extends EffectParameterBase {
  kind: "select";
  defaultValue: string;
  choices: readonly { value: string; label: string }[];
}

export type EffectParameterDefinition = EffectNumberParameter | EffectBooleanParameter | EffectSelectParameter;

export interface EffectRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EffectTarget {
  kind: EffectTargetKind;
  bounds: () => EffectRect;
  clip?: boolean;
  id?: string;
}

export interface EffectOptions {
  durationMs?: number;
  loop?: boolean;
  intensity?: number;
  palette?: readonly string[];
  blendMode?: GlobalCompositeOperation;
  zIndex?: number;
  seed?: number;
  parameters?: Readonly<Record<string, EffectParameterValue>>;
}

export interface EffectMetadata {
  id: string;
  displayName: string;
  description: string;
  category: EffectCategory;
  targets: readonly EffectTargetKind[];
  status: EffectStatus;
  /** Authoring palette used when EffectOptions.palette is omitted. */
  defaultPalette: readonly string[];
  /** Typed effect-specific controls. Common duration, intensity, seed, blend and palette controls live in EffectOptions. */
  parameters: readonly EffectParameterDefinition[];
}

export interface EffectFrame {
  ctx: CanvasRenderingContext2D;
  nowMs: number;
  deltaMs: number;
  elapsedMs: number;
  progress: number;
  target: EffectTarget;
  options: Required<Pick<EffectOptions, "durationMs" | "loop" | "intensity" | "zIndex" | "seed">> &
    Omit<EffectOptions, "durationMs" | "loop" | "intensity" | "zIndex" | "seed">;
  mode: EffectMode;
  reducedMotion: boolean;
  dpr: number;
}

export interface EffectInstance {
  readonly metadata: EffectMetadata;
  readonly target: EffectTarget;
  readonly options: EffectFrame["options"];
  start(nowMs: number): void;
  update(nowMs: number, deltaMs: number): void;
  render(frame: EffectFrame): void;
  stop(): void;
  destroy(): void;
  isComplete(): boolean;
  elapsedMs(): number;
}

export interface SlotEffect {
  readonly metadata: EffectMetadata;
  create(target: EffectTarget, options?: EffectOptions): EffectInstance;
}
