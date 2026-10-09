/**
 * Shared Game Math Control types.
 *
 * This module is deliberately game-agnostic. It knows policy, bands, evidence
 * and session accounting; it knows nothing about reels, cards, mines or crash
 * curves. A game contributes exactly one object implementing `GameMathAdapter`,
 * and every rule below is enforced by the shared layer so a second and third
 * game cannot invent a weaker control plane.
 */

/** Injection token for the per-game mathematics adapters. */
export const GAME_MATH_ADAPTERS = 'GAME_MATH_ADAPTERS';

/**
 * Injection token for the per-game DEFAULT reset delegates.
 *
 * Most games let the shared lifecycle move their own pointer to the explicit
 * `DEFAULT` state. A game whose default state is owned by a dedicated admin
 * panel (Lucky Lady's payout panel writes history and clears a runtime
 * distribution in the same transaction) registers one delegate here, so the
 * generic route reuses that exact behaviour instead of duplicating it.
 */
export const GAME_MATH_DEFAULT_RESETTERS = 'GAME_MATH_DEFAULT_RESETTERS';

/**
 * What a DEFAULT transition produced, reported uniformly whichever path ran.
 *
 * `mode` is `DEFAULT` for this operation by contract; a custom (including a
 * zero-return) profile is `CUSTOM`. The state is keyed on the pointer's kind and
 * profile row, never on an RTP value, so a zero-return custom profile is not
 * mistaken for "control off".
 */
export type GameMathDefaultResult = {
  gameId: string;
  mode: 'DEFAULT';
  version: number;
  profileId: string | null;
  profileHash: string | null;
  validationId: string | null;
  activatedAt: string | null;
  activatedBy: string | null;
  note: string;
};

/** One game's DEFAULT-reset delegate, registered under its exact gameId. */
export interface GameMathDefaultResetter {
  readonly gameId: string;
  resetToDefault(
    actorId: string,
    input: { actionId: string; expectedVersion?: number },
  ): Promise<GameMathDefaultResult>;
}

/**
 * Payout classes a profile can be described in.
 *
 * `MAX` is the class above the policy's big-win ceiling and `BIG` is the
 * ceiling band itself, so `bigWinMinMultiplier`/`bigWinMaxMultiplier` are
 * meaningful rather than decorative.
 */
export const PAYOUT_CLASSES = [
  'ZERO',
  'PARTIAL_RETURN',
  'BREAK_EVEN',
  'SMALL',
  'MEDIUM',
  'BIG',
  'MAX',
] as const;
export type PayoutClass = (typeof PAYOUT_CLASSES)[number];

/** Pacing shapes the distribution; it never schedules or targets a player. */
export const PACING_MODES = ['RETENTION', 'RECYCLE', 'BALANCED', 'VOLATILE', 'CUSTOM'] as const;
export type PacingMode = (typeof PACING_MODES)[number];

/** How much of the return arrives below one stake. */
export const RETURN_TIERS = ['LOW', 'MED', 'HIGH'] as const;
export type ReturnTier = (typeof RETURN_TIERS)[number];

/**
 * Hit-rate request.
 *
 * `AUTO` means the profile is generated with whatever hit rate its target
 * return naturally produces, and the observed value is only reported.
 */
export type HitRatePolicy =
  | { mode: 'AUTO' }
  | { mode: 'EXPLICIT'; target: number }
  | { mode: 'RANGE'; min: number; max: number };

/** Share of total return that must come from free spins / feature play. */
export type FeatureContributionPolicy = {
  minPercent: number;
  maxPercent: number;
};

/**
 * The complete generation request.
 *
 * It contains policy and game maths only: no user, session, wallet, balance,
 * history, round or clock value is part of a policy, by construction of the
 * type and by the whitelist in `validatePolicy`.
 */
export type MathPolicy = {
  gameId: string;
  /** Requested return, 0..100, in percent. */
  targetRtpPercent: number;
  /**
   * The advertised ceiling, as a multiple of the locked originating paid stake.
   *
   * What it covers is decided by `maxWinScope`: the complete paid round for the
   * legacy whole-round scopes, or each individual paid/free resolution for
   * `RESOLVED_SPIN`. It is never a ceiling on the aggregate of a feature chain.
   */
  maxWinMultiplier: number;
  pacing: PacingMode;
  /** Extra guidance for `CUSTOM` pacing; bounded and validated. */
  customPacing: CustomPacing | null;
  hitRate: HitRatePolicy;
  partialReturn: ReturnTier;
  volatility: ReturnTier;
  bigWinMinMultiplier: number;
  bigWinMaxMultiplier: number;
  featureContribution: FeatureContributionPolicy;
  /** Named presets that supplied unset defaults. Recorded, never binding. */
  presets: string[];
  /**
   * What the advertised `maxWinMultiplier` is a ceiling over.
   *
   * A game with an in-round gamble that can double an already-settled win
   * cannot advertise a hard ceiling on the total return. The adapter must
   * refuse that combination instead of quietly narrowing the claim.
   */
  maxWinScope: MaxWinScope;
  /**
   * Whether the advertised ceiling is an asserted guarantee.
   *
   * Absent means legacy: the artifact predates the explicit flag, nothing is
   * reinterpreted, and no `RESOLVED_SPIN` guarantee is claimed for it. A newly
   * generated `RESOLVED_SPIN` profile always records this field explicitly, and
   * the value is part of the immutable artifact hash.
   */
  maxWinEnabled?: boolean;
};

export const MAX_WIN_SCOPES = [
  /** Ceiling over the paid round before any optional gamble decision. */
  'PAID_ROUND_BEFORE_OPTIONAL_GAMBLE',
  /** Ceiling over everything the player can actually take home. */
  'TOTAL_INCLUDING_OPTIONAL_GAMBLE',
  /**
   * Ceiling over each individual mathematical resolution.
   *
   * Every paid-spin result and every free-spin result (multiplied by the
   * feature multiplier; the free stake is never treated as zero) must be at or
   * below `maxWinMultiplier` times the LOCKED originating paid stake. A feature
   * chain - including retriggers - aggregates without a ceiling by design, so
   * this scope deliberately says nothing about the total round return.
   */
  'RESOLVED_SPIN',
] as const;
export type MaxWinScope = (typeof MAX_WIN_SCOPES)[number];

export type CustomPacing = {
  /** Relative weight of a zero-return outcome class, 0..1_000_000. */
  zeroWeight: number;
  /** Relative weight of a partial-return outcome class, 0..1_000_000. */
  partialWeight: number;
  /** Relative weight of a break-even outcome class, 0..1_000_000. */
  breakEvenWeight: number;
  /** Relative weight of the paying classes above break-even. */
  winWeight: number;
};

/** Exact rational, used wherever an accounting figure must stay exact. */
export type Rational = { numerator: number; denominator: number };

/**
 * One weighted payout band.
 *
 * `weight` is an integer share of `totalWeight`; multipliers are exact
 * rationals so a distribution like the canonical 100% example totals exactly
 * one and never drifts through binary floating point.
 */
export type WeightedBand = {
  multiplier: Rational;
  weight: number;
};

export type PayoutDistribution = {
  totalWeight: number;
  bands: WeightedBand[];
};

/**
 * The immutable math artifact.
 *
 * `canonicalHash` covers exactly `evidence-excluded` fields: identity, engine
 * identity, policy and the engine-native payload. Measured values, status and
 * validation evidence are deliberately outside it, so re-validating or
 * activating a profile can never change its identity.
 */
export type MathProfileArtifact = {
  schemaVersion: 1;
  profileId: string;
  gameId: string;
  engineSha256: string;
  rulesSha256: string;
  policy: MathPolicy;
  /** Opaque engine-native body. The platform never interprets it. */
  payload: unknown;
  canonicalHash: string;
  createdAt: string;
};

/** Analytical facts a game can state about a candidate profile. */
export type ProfileAnalysis = {
  /** Exact expected return in percent, when the game can compute it. */
  exactRtpPercent: number | null;
  /** Exact expected return in percent from the paid (base) game only. */
  baseRtpPercent: number | null;
  /** Exact expected return in percent contributed by feature play. */
  featureRtpPercent: number | null;
  /** Exact probability that one paid spin triggers the feature. */
  featureTriggerProbability: number | null;
  /** Exact probability that a free spin retriggers the feature. */
  retriggerProbability: number | null;
  /** Expected number of free spins per trigger; `null` when it diverges. */
  expectedFeatureSpins: number | null;
  /** True when the feature's expected length diverges (no finite EV). */
  featureDiverges: boolean;
  /** Largest total return one single paid board can produce, in stake multiples. */
  maxSingleSpinMultiplier: number;
  /**
   * Largest single *paid-spin* resolution, in multiples of the paid stake.
   * Under `RESOLVED_SPIN` this is the paid half of the per-resolution ceiling.
   */
  maxResolvedPaidSpinMultiplier: number;
  /**
   * Largest single *free-spin* resolution after the feature multiplier, in
   * multiples of the locked originating paid stake. `null` when the game
   * cannot prove it.
   */
  maxResolvedFreeSpinMultiplier: number | null;
  /**
   * The per-resolution ceiling for `RESOLVED_SPIN`: the larger of the paid and
   * free single-spin maxima. Feature-chain aggregates are deliberately not
   * included.
   */
  maxResolvedSpinMultiplier: number | null;
  /** How the per-resolution ceiling was established. */
  maxResolvedSpinBasis: string;
  /**
   * Largest total return a *complete* paid round can produce inside the
   * engine's own termination bound. `null` when the game cannot prove one.
   */
  maxRoundMultiplier: number | null;
  /** How that maximum was established; never a sample maximum. */
  maxRoundBasis: string;
  /** Outcome classes this game can actually reach under some policy. */
  reachableClasses: PayoutClass[];
  /** Free-form adapter notes, shown verbatim to the operator. */
  notes: string[];
};

/**
 * The cap a round is pinned to, captured when the round is opened.
 *
 * A later activation never rewrites this: the round, its feature chain, its
 * prepared outcomes and its recovery payload keep the identity and the ceiling
 * they were created under.
 */
export type MaxWinPin = {
  maxWinEnabled: boolean;
  maxWinScope: MaxWinScope;
  maxWinMultiplier: number;
  profileId: string;
  profileHash: string;
};

/** What the game says it can and cannot do before any policy is applied. */
export type GameMathCapabilities = {
  gameId: string;
  /** Minimum return this game can express, in percent. */
  minRtpPercent: number;
  /** Maximum return this game can express, in percent. */
  maxRtpPercent: number;
  /** True when the game can produce a genuinely zero-return profile. */
  supportsZeroRtp: boolean;
  /**
   * Optional in-round gamble that can multiply a settled win after the paid
   * round finished. When present, a total-return ceiling is unprovable.
   */
  optionalGamble: { present: boolean; bounded: boolean; detail: string };
  /** Bands this game can produce. */
  reachableClasses: PayoutClass[];
  /** Engine identity the adapter reads. */
  engineSha256: string;
  rulesSha256: string;
  notes: string[];
};

export type GenerateProfileResult =
  | {
      status: 'SUPPORTED';
      artifact: MathProfileArtifact;
      analysis: ProfileAnalysis;
      /** Calibration runs, kept as evidence but never as validation. */
      calibration: CalibrationRecord;
    }
  | {
      status: 'UNSUPPORTED';
      /** Plain-language, per-constraint reasons. Never a silent downgrade. */
      reasons: ConstraintReason[];
      /** The best candidate the search reached, for operator inspection only. */
      bestEffort: { analysis: ProfileAnalysis; rtpPercent: number } | null;
    };

export type ConstraintReason = {
  constraint: string;
  requested: string;
  achievable: string;
  detail: string;
};

export type CalibrationRecord = {
  strategy: string;
  /** Deterministic search parameters. Sampled seeds are test/evidence only. */
  parameters: Record<string, unknown>;
  evaluatedCandidates: number;
  /** Exact RTP of the accepted candidate, before independent validation. */
  expectedRtpPercent: number;
  /** Bounded exploratory sample drawn with the generation-only seed domain. */
  sample: { rounds: number; seedPrefix: string; measuredRtpPercent: number } | null;
};

/** A single session simulator outcome source, in exact integer units. */
export type SessionConfig = {
  /** Starting balance in simulation units (not platform points). */
  startUnits: number;
  /** Stake per paid round, in simulation units. */
  stakeUnits: number;
  /** Maximum number of paid rounds before the session is censored. */
  horizonPaidSpins: number;
  /** Checkpoints for survival and balance reporting. */
  aliveCheckpoints: number[];
  balanceCheckpoints: number[];
  /** Balance checkpoints used as "ever reached" / "ever fell below". */
  reachTargets: number[];
  fallTargets: number[];
  ruinCheckpoints: number[];
};

export type SessionRecord = {
  seed: string;
  /** Paid spins resolved by this session. */
  paidSpins: number;
  /** Free spins resolved inside those paid rounds; retriggers are counted here. */
  freeSpins: number;
  /** paidSpins + freeSpins: every resolved spin of the session. */
  totalResolvedSpins: number;
  /**
   * Exact money-shaped totals. The `*Exact` strings are authoritative and can
   * exceed 9007199254740991; the numeric mirror is `null` when the value is not
   * exactly representable as a Number, never a silently rounded value.
   */
  turnoverUnits: number | null;
  turnoverUnitsExact: string;
  endingUnits: number | null;
  endingUnitsExact: string;
  returnedUnits: number | null;
  returnedUnitsExact: string;
  baseReturnUnits: number | null;
  baseReturnUnitsExact: string;
  featureReturnUnits: number | null;
  featureReturnUnitsExact: string;
  maxObservedReturnUnits: number | null;
  maxObservedReturnUnitsExact: string;
  /** True when the session stopped because it could not fund another spin. */
  busted: boolean;
  /** True when the session stopped at the horizon instead of busting. */
  censored: boolean;
  featureTriggeredRounds: number;
  retriggeredRounds: number;
  peakUnits: number | null;
  peakUnitsExact: string;
  maxDrawdownUnits: number | null;
  maxDrawdownUnitsExact: string;
  /**
   * Balance after N completed paid rounds. A session that busted before N holds
   * its terminal dust balance instead of disappearing; a checkpoint beyond the
   * session's horizon is `null` and reported as unobserved.
   */
  balanceAtCheckpoint: Record<string, number | null>;
  /** Exact balance at each configured checkpoint, as a decimal string. */
  balanceAtCheckpointExact: Record<string, string | null>;
  /**
   * Alive@N = could fund the next paid stake after N completed paid spins.
   * `null` when the checkpoint lies beyond the configured horizon.
   */
  aliveAtCheckpoint: Record<string, boolean | null>;
  /** Ever reached the balance, initial balance included. */
  reachedTargets: Record<string, boolean>;
  /** Ever fell below the balance, initial balance included. */
  fellBelowTargets: Record<string, boolean>;
  /** Ruined by N completed paid spins. */
  ruinedBy: Record<string, boolean | null>;
};

export type QuantileSummary = {
  mean: number | null;
  median: number | null;
  p10: number | null;
  p25: number | null;
  p75: number | null;
  p90: number | null;
  p95: number | null;
};

/**
 * Quantiles of an exact integer sample.
 *
 * The sample is summarized in exact arithmetic (R-7 with rational
 * interpolation). The `*Exact` strings are a fixed-precision, half-up rounding
 * of those exact rationals - presentation, not accounting - while exact
 * monetary totals elsewhere are integer strings. Numeric mirrors are
 * bounded-precision doubles and are `null` when the value cannot be presented.
 */
export type QuantileSummaryExact = {
  sampleSize: number;
  mean: number | null;
  meanExact: string | null;
  median: number | null;
  medianExact: string | null;
  p10: number | null;
  p10Exact: string | null;
  p25: number | null;
  p25Exact: string | null;
  p75: number | null;
  p75Exact: string | null;
  p90: number | null;
  p90Exact: string | null;
  p95: number | null;
  p95Exact: string | null;
};

export type BankrollReport = {
  /** Simulation-only denomination. Not platform points, not money. */
  denomination: string;
  config: SessionConfig;
  sampleSize: number;
  seeds: { prefix: string; count: number; first: string; last: string };
  horizonPaidSpins: number;
  censoredCount: number;
  ruinedCount: number;
  /**
   * Raw totals in simulation units plus the PTS presentation. The ledger
   * identity `opening + returned - wager = closing` must hold exactly.
   */
  totals: {
    openingUnits: number | null;
    openingUnitsExact: string;
    paidWagerUnits: number | null;
    paidWagerUnitsExact: string;
    baseReturnUnits: number | null;
    baseReturnUnitsExact: string;
    featureReturnUnits: number | null;
    featureReturnUnitsExact: string;
    returnedUnits: number | null;
    returnedUnitsExact: string;
    closingUnits: number | null;
    closingUnitsExact: string;
    ledgerDeltaUnits: number | null;
    ledgerDeltaUnitsExact: string;
    ledgerIdentityHolds: boolean;
    paidRounds: number;
    turnoverPts: number | null;
    turnoverPtsExact: string;
    returnedPts: number | null;
    returnedPtsExact: string;
  };
  /**
   * Restricted observed durations: censored sessions contribute their
   * observed length only, and are never reported as busted.
   */
  observedLengthPaidSpins: QuantileSummary;
  turnoverPaidSpins: QuantileSummary;
  /** Turnover in platform-point equivalents (simulation-only denomination). */
  turnoverPts: QuantileSummaryExact;
  /** Balance after N completed paid rounds; busted sessions hold their dust. */
  balanceAt: Record<string, QuantileSummary>;
  /** Exact balance checkpoints, as decimal strings. */
  balanceAtExact: Record<string, QuantileSummaryExact>;
  /** Alive@N = could fund the next paid stake after N completed paid spins. */
  aliveAt: Record<string, number | null>;
  reachProbability: Record<string, number>;
  fallBelowProbability: Record<string, number>;
  /** `null` when the checkpoint lies beyond the horizon and is unobserved. */
  ruinBy: Record<string, number | null>;
  /** Sessions that were observable at each ruin checkpoint. */
  ruinByObservedSessions: Record<string, number>;
  /** Ruin quantiles, restricted; null when never observed inside the horizon. */
  observedBustQuantiles: QuantileSummary;
  maxDrawdown: QuantileSummary;
  /** Largest single paid round seen in the cohort, and how often sessions hit it. */
  maxWin: { units: number | null; unitsExact: string; pts: number | null; ptsExact: string; sessionFrequency: number };
  /**
   * Separate authoritative spin counters. Retriggers are resolved spins, so
   * they are included in `freeSpins`; a replayed or recovered round adds none.
   */
  spinCounts: {
    paidSpins: number;
    freeSpins: number;
    totalResolvedSpins: number;
  };
  featureRoundRate: number;
  retriggerRoundRate: number;
  featureReturnShare: number;
  /** Rounded presentation of the exact measured return; not an accounting value. */
  measuredRtpExact: string;
  /** Presentation mirror; `null` when the ratio cannot be presented as a double. */
  measuredRtpPercent: number | null;
  /** Rounded presentation of the exact house edge; not an accounting value. */
  houseEdgeExact: string;
  /** Presentation mirror; `null` when the ratio cannot be presented as a double. */
  houseEdgePercent: number | null;
  notes: string[];
};

export type CheckStatus = 'PASS' | 'FAIL' | 'UNSUPPORTED';

export type MathCheck = {
  id: string;
  status: CheckStatus;
  detail: string;
  value?: unknown;
};

export type MonteCarloRun = {
  kind: 'MONTE_CARLO';
  seedPrefix: string;
  rounds: number;
  paidWagerUnits: number;
  returnedUnits: number;
  measuredRtpPercent: number;
  ci95Bps: number | null;
  hitRate: number;
  zeroRate: number;
  lossRate: number;
  partialRate: number;
  /** P(X = 1) exactly: the break-even outcome, per the acceptance contract. */
  breakEvenRate: number;
  /** P(0.5 <= X < 1): the break-even *band* of the fine payout histogram. */
  breakEvenBandRate: number;
  classHistogram: Record<PayoutClass, number>;
  fineHistogram: Record<string, number>;
  maxObservedMultiplier: number;
  featureTriggerRate: number;
  featureRetriggerRate: number;
  featureRtpPercent: number;
  volatilityStdDev: number;
  /** Rounds the game's own feature bound aborted; must be zero for a pass. */
  abortedRounds: number;
};

export type IndependentVerification = {
  kind: 'ANALYTIC_REPRODUCTION';
  seedFree: true;
  rtpPercent: number | null;
  agreementBps: number | null;
};

export type ValidationRun = MonteCarloRun | IndependentVerification;

export type MathValidationEvidence = {
  validationId: string;
  profileId: string;
  gameId: string;
  profileHash: string;
  engineSha256: string;
  rulesSha256: string;
  createdAt: string;
  /** Independent from calibration by seed domain, and recorded as such. */
  seeds: { calibrationPrefix: string; validationPrefix: string; bankrollPrefix: string };
  runs: ValidationRun[];
  metrics: MonteCarloRun | null;
  bankroll: BankrollReport;
  checks: MathCheck[];
  result: 'PASS' | 'FAIL';
  grade: EvidenceGrade;
};

/**
 * `PREVIEW` is a fast, explicitly insufficient examination; `ACTIVATION` is the
 * minimum independent evidence grade activation requires.
 */
export type EvidenceGrade = 'PREVIEW' | 'ACTIVATION';

/**
 * The minimum independent evidence an activation-grade validation must carry.
 *
 * Production defaults are fixed; the environment overrides exist so a
 * disposable test database can exercise the activation path without running a
 * production-sized cohort, and any override is recorded in the evidence.
 */
export function activationGradeMinimum() {
  return {
    monteCarloRounds: Number(process.env.MATH_CONTROL_MIN_MC_ROUNDS ?? 20_000),
    bankrollSessions: Number(process.env.MATH_CONTROL_MIN_SESSIONS ?? 200),
    bankrollHorizonPaidSpins: Number(process.env.MATH_CONTROL_MIN_HORIZON ?? 1_000),
  };
}

export type PolicyValidationResult =
  | { ok: true; policy: MathPolicy; appliedPresets: string[] }
  | { ok: false; errors: ConstraintReason[] };

/**
 * The one interface a game contributes.
 *
 * `generateProfile` may produce a candidate or an explicit unsupported result;
 * `validateProfile` is a *fresh, independent* examination of a frozen profile
 * and must not trust anything the generator reported.
 */
export interface GameMathAdapter {
  readonly gameId: string;
  /**
   * The game's registered, immutable default mathematics, when it declares one.
   *
   * The shared DEFAULT reset records this identity on the pointer so CURRENT can
   * prove which default is live instead of only clearing a custom pointer. It is
   * always the game's own declared default, never inferred from a hash and never
   * borrowed from another game; a game that declares none keeps the empty
   * identity. A panel-owned default (Lucky Lady) keeps its own contract instead.
   */
  defaultProfile?(): { profileId: string; profileHash: string } | null;
  /** Cheap identity of the mathematics this process executes, without a sweep. */
  identity(): { engineSha256: string; rulesSha256: string };
  /**
   * Compiled module a worker thread can load to run this adapter's CPU work,
   * or `null` when only source is available (the runner then uses the bounded
   * in-process queue instead).
   */
  workerModule(): { modulePath: string; exportName: string } | null;
  capabilities(): Promise<GameMathCapabilities>;
  getReachableOutcomeClasses(): Promise<PayoutClass[]>;
  generateProfile(policy: MathPolicy): Promise<GenerateProfileResult>;
  validateProfile(
    policy: MathPolicy,
    artifact: MathProfileArtifact,
    options: ValidationOptions,
  ): Promise<ProfileValidationOutcome>;
  /** Session outcome source bound to one frozen profile. */
  sessionSource(
    policy: MathPolicy,
    artifact: MathProfileArtifact,
    config: SessionConfig,
  ): SessionOutcomeSource;
}

/** What independent validation produced, before the platform stamps identity. */
export type ProfileValidationOutcome = {
  runs: ValidationRun[];
  metrics: MonteCarloRun | null;
  bankroll: BankrollReport;
  checks: MathCheck[];
  result: 'PASS' | 'FAIL';
  grade: EvidenceGrade;
};

export type ValidationOptions = {
  validationSeedPrefix: string;
  bankrollSeedPrefix: string;
  monteCarloRounds: number;
  bankrollSessions: number;
  sessionConfig: SessionConfig;
  /** Tolerance in percentage points between requested and measured return. */
  rtpTolerancePercent: number;
};

/**
 * The per-session outcome source a bankroll simulation draws from.
 *
 * Returns exact integer simulation units for one complete paid round, feature
 * play included and never separately debited.
 *
 * The spin counts are authoritative and come from whatever the game actually
 * resolved for this round. They are never derived from a trigger flag, an
 * awarded count or a replay:
 *   - `paidSpins` is the number of paid spins this call resolved (1);
 *   - `freeSpins` is the number of free spins actually resolved, retriggers
 *     included;
 *   - `totalResolvedSpins` must equal `paidSpins + freeSpins`.
 */
export interface SessionOutcomeSource {
  drawPaidRound(): {
    /** Total returned for this complete paid round, in simulation units. */
    returnUnits: number;
    /** Portion of `returnUnits` produced by feature play. */
    featureReturnUnits: number;
    /** Paid spins resolved by this round. */
    paidSpins: number;
    /** Free spins actually resolved by this round, retriggers included. */
    freeSpins: number;
    /** paidSpins + freeSpins for this round. */
    totalResolvedSpins: number;
    featureTriggered: boolean;
    retriggered: boolean;
  };
}
