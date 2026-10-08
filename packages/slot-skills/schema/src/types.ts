export const SCHEMA_VERSION = "2.0" as const;
export const ENGINE_API_VERSION = "1.0" as const;

export type EvaluatorKind = "paylines" | "ways" | "count" | "cluster";
export type Volatility = "low" | "medium" | "high";
export type SymbolKind = "normal" | "wild" | "scatter" | "bonus" | "collect" | "jackpot";
export type SymbolTier = "low" | "high";
export type CanonicalNormalSymbolId = `${SymbolTier}-${number}`;
export type CanonicalSpecialSymbolId =
  | "wild" | `wild-${number}`
  | "scatter" | `scatter-${number}`
  | "bonus" | `bonus-${number}`
  | "collect" | `collect-${number}`
  | "jackpot" | `jackpot-${number}`;
export type CanonicalSymbolId = CanonicalNormalSymbolId | CanonicalSpecialSymbolId;
export type ComponentStatus = "implemented" | "stub" | "blocked";
export type PayoutBasis = "bet" | "line-bet" | "coin";

export interface Rational {
  numerator: string;
  denominator: string;
}

export interface LayoutConfig {
  reels: number;
  rows: number | number[];
  orientation?: "landscape" | "portrait" | "responsive";
  maxVisibleCells?: number;
}

export interface SymbolConfig {
  id: string;
  name: string;
  kind: SymbolKind;
  asset: string;
  animation?: string;
  tags?: string[];
}

export interface PaytableEntry {
  symbolId: string;
  count: number;
  payout: Rational;
  basis: PayoutBasis;
}

export interface MathTargets {
  rtpBps: number;
  volatility: Volatility;
  hitRateBps: [number, number];
  maxWinMultiplier: Rational;
}

export interface MathConfig {
  evaluator: EvaluatorKind;
  outcomeGenerator: "reel-strips" | "weighted-grid";
  targets: MathTargets;
  paytable: PaytableEntry[];
  paylines?: number[][];
  reelStrips?: string[][];
  symbolWeights?: Record<string, number>;
  featureWeights?: Record<string, number>;
  maxCascades?: number;
  /** Fixed-return evidence for scatter-triggered bonuses, keyed by configuration hash. */
  bonusAwardProfile?: BonusAwardProfile;
}

export type FeaturePhase = "base" | "free-spin" | "respin";
export interface FeatureSelection {
  id: string;
  enabled: boolean;
  config?: Record<string, unknown>;
  activation?: { parentFeatureId?: string; phases?: FeaturePhase[] };
}

export interface BonusNormalizationRecord {
  moduleId: ScatterBonusModuleId;
  configurationHash: string;
  scale: Rational;
  offsetUnits: string;
  sampleMeanUnits: string;
  rounds: number;
  seed: number;
  digest: string;
}

export interface BonusAwardProfile {
  minMultiplier: Rational;
  averageMultiplier: Rational;
  maxMultiplier: Rational;
  normalizations: Record<string, BonusNormalizationRecord>;
}

export type ScatterBonusModuleId = "free-spins" | "hold-and-win" | "pick-and-click-bonus";

export interface AssetEntry {
  id: string;
  role: string;
  path: string;
  fallback?: string;
  mediaType?: string;
  width?: number;
  height?: number;
  animationDurationMs?: number;
  sha256?: string;
  generation?: {
    provider: string;
    model: string;
    prompt: string;
    runDir: string;
    referenceImages?: string[];
  };
  rights?: {
    owner: string;
    source: string;
    permittedUse: string;
  };
  feature?: { moduleId: ScatterBonusModuleId; purpose: string };
}

export type CharacterWinSize = "small" | "nice" | "big" | "mega" | "epic";

export type CharacterAnimationTrigger =
  | { type: "win-size"; size: CharacterWinSize }
  | { type: "feature-start"; featureId: string }
  | { type: "feature-event"; featureId: string; event: "entry" | "highlight" | "completion" };

export interface CharacterAnimationMapping {
  animationId: string;
  trigger: CharacterAnimationTrigger;
}

export interface ThemeConfig {
  id: string;
  palette: string[];
  typography?: { heading: string; body: string };
  components: Record<string, string>;
  effects?: Record<string, string>;
  /** Legacy single assignment per purpose; read-compatible during assignment migration. */
  effectSlots?: Record<string, GameEffectConfig>;
  ambientEffects?: AmbientEffectConfig[];
  effectAssignments?: GameEffectAssignment[];
  sounds?: Record<string, string>;
}

export interface GameEffectConfig {
  effectId: string;
  enabled: boolean;
  durationMs: number;
  intensity: number;
  seed: number;
  palette?: string[];
  blendMode?: GlobalCompositeOperation;
  parameters?: Record<string, AmbientEffectParameterValue>;
}

export interface GameEffectAssignment {
  instanceId: string;
  purposeId: string;
  effectId: string;
  enabled: boolean;
  options?: Record<string, AmbientEffectParameterValue>;
  /** Omitted means all symbols. An explicit list is always a non-empty subset. */
  symbolIds?: string[];
}

export type AmbientEffectScope = "full-background" | "anchored";
export type AmbientEffectParameterValue = number | string | boolean;

export interface AmbientEffectAnchor {
  /** Normalized X coordinate in the uncropped source background image. */
  x: number;
  /** Normalized Y coordinate in the uncropped source background image. */
  y: number;
  width: number;
  height: number;
}

export type AmbientEffectPlayback =
  | { mode: "continuous"; durationMs: number }
  | { mode: "random-interval"; durationMs: number; minIntervalMs: number; maxIntervalMs: number };

export interface AmbientEffectConfig {
  instanceId: string;
  effectId: string;
  enabled: boolean;
  scope: AmbientEffectScope;
  anchor?: AmbientEffectAnchor;
  playback: AmbientEffectPlayback;
  options: {
    intensity: number;
    seed: number;
    palette?: string[];
    parameters?: Record<string, AmbientEffectParameterValue>;
  };
}

export interface LocaleConfig {
  default: string;
  packs: Record<string, string>;
}

export interface JurisdictionConfig {
  profileId: string;
  reviewedAt: string;
  reviewBy: string;
  sourceUrls: string[];
  overrides?: Record<string, unknown>;
}

export interface ProviderConfig {
  rng: string;
  wallet: string;
  jackpot: string;
  session: string;
  audit: string;
  image?: string;
  video?: string;
  audio?: string;
}

export interface PresentationConfig {
  cycleDurationMs: number;
  autoPlay: boolean;
  turbo: boolean;
  slamStop: boolean;
  celebrateReturnAtOrBelowStake: boolean;
  reducedMotionFallback: boolean;
  characterHeight?: number;
  characterOverflow?: boolean;
  /** Global artwork scale within each reel cell. Reel geometry and math are unchanged. */
  symbolScale?: number;
  /** Scale applied to the reel-frame overlay around its centre. */
  frameScale?: number;
  /** Multiplier applied to the generated character artwork without changing the game layout. */
  characterScale?: number;
  /** Horizontal character offset as a fraction of the character's rendered width. Positive moves right. */
  characterOffsetX?: number;
  /** Vertical character offset as a fraction of the character's rendered height. Positive moves down. */
  characterOffsetY?: number;
  /** Transparent padding baked below the character's feet in its assets, as a fraction of the
   * image height. The client shifts the image down by this fraction of characterHeight so the
   * feet - not the padded edge - sit on the reel-area bottom line. */
  characterBottomMargin?: number;
  /** Selects a character animation for a completed win tier or the start of a feature. */
  characterAnimationMappings?: CharacterAnimationMapping[];
}

export interface GameConfig {
  schemaVersion: typeof SCHEMA_VERSION;
  engineApi: typeof ENGINE_API_VERSION;
  id: string;
  version: string;
  title: string;
  layout: LayoutConfig;
  symbols: SymbolConfig[];
  math: MathConfig;
  features: FeatureSelection[];
  assets: AssetEntry[];
  theme: ThemeConfig;
  locales: LocaleConfig;
  jurisdiction: JurisdictionConfig;
  providers: ProviderConfig;
  presentation: PresentationConfig;
}

export interface ComponentManifest {
  id: string;
  version: string;
  kind: "feature" | "evaluator" | "renderer" | "provider" | "jurisdiction" | "locale" | "theme";
  status: ComponentStatus;
  description: string;
  provides: string[];
  requires?: string[];
  conflicts?: string[];
  evaluators?: EvaluatorKind[];
  minEngineApi?: string;
  configSchema?: Record<string, unknown>;
}

export interface GameLock {
  schemaVersion: typeof SCHEMA_VERSION;
  gameId: string;
  gameVersion: string;
  compiledAt: string;
  source: string;
  bundleHash: string;
  mathHash: string;
  components: Array<{ id: string; version: string; status: ComponentStatus }>;
}

export interface CompiledGame {
  game: GameConfig;
  lock: GameLock;
}
