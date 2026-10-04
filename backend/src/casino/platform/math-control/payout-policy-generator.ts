import { canonicalJson, multiplierToUnits, sha256Hex } from './math-control.analytics';
import {
  bigRationalToDecimalString,
  bigRationalToPresentationNumber,
  type BigRational,
} from './math-control.rational';
import {
  DISTRIBUTION_CLASSES,
  distributionPolicyHash,
  type DistributionClass,
  type DistributionPolicy,
  type DistributionWeights,
} from './payout-distribution';
import type { ConstraintReason, MathCheck } from './math-control.types';

/**
 * Offline automatic payout-policy generator: the game-agnostic half.
 *
 * This module knows nothing about a particular game. It consumes immutable
 * per-class conditional expectations (exact rationals) produced by a game
 * adapter from that game's own reachable-outcome model, and solves for the
 * class weights that hit a requested return target on an explicit fixed-point
 * grid. Every arithmetic step on targets, weights and expectations is exact
 * BigInt/rational arithmetic - no floating-point accumulation is ever the
 * authority.
 *
 * Honest status semantics:
 *  - REJECTED: the request itself is unusable (unknown or player-shaped field,
 *    non-numeric / out-of-range / too-precise target, unsupported constraint,
 *    empty reachable class set). Nothing is generated.
 *  - INFEASIBLE: exact bounds or the attainable expectation interval prove a
 *    contradiction in the declared model. SEARCH_EXHAUSTED is not such proof.
 *  - SOLVED: an exact-on-the-grid weight vector whose expected return matches
 *    the target within the stated tolerance.
 */

export const SOLVER_VERSION = 'payout-policy-solver.v1.1';
/** Explicit fixed-point grid: 1 000 000 units = 100% (1 unit = 0.0001%). */
export const DEFAULT_GRANULARITY = 1_000_000;
export const DEFAULT_TOLERANCE_PERCENT = '0.01';
export const MAX_TARGET_DECIMAL_PLACES = 6;
/** Documented small-return band used by the RETENTION objective. */
export const RETENTION_BAND_MAX_EV = 5;
/** Bound on the deterministic three-class ladder (per admissible triple). */

export type GeneratorObjective = 'RETENTION' | 'BALANCED' | 'VOLATILE' | 'CUSTOM';

export type GeneratorClassMetadata = {
  /** Class id, one of the shared distribution classes. */
  classId: DistributionClass;
  /** Exact conditional expectation of a complete paid round in this class. */
  conditionalEv: BigRational;
  /** Portion of `conditionalEv` from the paid board alone. */
  conditionalPaidEv: BigRational | null;
  /** Portion of `conditionalEv` from the whole feature chain (triggers). */
  conditionalFeatureEv: BigRational | null;
};

export type GeneratorModelMetadata = {
  gameId: string;
  /** Declared bounded model identity (never the accepted dense profile). */
  modelId: string;
  /** Canonical artifact hash of the declared model. */
  modelHash: string;
  engineSha256: string;
  rulesSha256: string;
  maxWinScope: string;
  maxWinMultiplier: number;
  maxBandMin: number;
  /** Reachable classes with their exact expectations, ordered by class id. */
  reachableClasses: GeneratorClassMetadata[];
  /** Classes the declared model cannot reach; carrying weight there is refused. */
  unreachableClasses: DistributionClass[];
  notes: string[];
};

export type NormalizedGeneratorRequest = {
  gameId: string;
  maxWinMultiplier: number;
  targetRtpPercent: string;
  objective: GeneratorObjective;
  granularity: number;
  tolerancePercent: string;
  /** Exact per-class minimum weight floors, in grid units. */
  minimumWeight: Record<string, number>;
  /** Exact per-class maximum weight caps, in grid units. */
  maximumWeight: Record<string, number>;
  /** Deterministic ladder resolution for the three-class fallback. */
};

const REQUEST_FIELDS = new Set([
  'gameId',
  'maxWinMultiplier',
  'targetRtp',
  'pacing',
  'targetRtpPercent',
  'objective',
  'granularity',
  'tolerancePercent',
  'constraints',
]);

const CONSTRAINT_FIELDS = new Set([
  'maxFullLossRate',
  'requirePositiveLoss',
  'requirePositivePartial',
  'requirePositiveProfit',
  'minFeatureWeightFraction',
  'maxFeatureWeightFraction',
  'minimumWeightFraction',
  'maximumWeightFraction',
]);

/**
 * Constraints a caller may plausibly ask for that this generator does not
 * implement. They are *explicitly* refused, never silently ignored.
 */
const KNOWN_UNSUPPORTED_CONSTRAINTS = new Set([
  'maxDrySpellPaidRounds',
  'maxMeanDrySpell',
  'maxVolatility',
  'minVolatility',
  'minHitRate',
  'maxHitRate',
  'featureContribution',
  'maxWinMultiplier',
  'maxWinScope',
  'minimumProfileLength',
  'bankrollStartUnits',
  'stakeUnits',
]);

/**
 * Player-shaped inputs. They are rejected as unknown fields: no probability in
 * this pipeline may come from a player, a session, a balance or a history.
 */
const PLAYER_SHAPED_FIELDS = new Set([
  'seed',
  'playerId',
  'userId',
  'user',
  'sessionId',
  'session',
  'balance',
  'history',
  'walletId',
  'accountId',
]);

// ---------------------------------------------------------------------------
// Exact rational helpers (local, BigInt only - the accepted accounting modules
// are not modified)
// ---------------------------------------------------------------------------

type Rat = { numerator: bigint; denominator: bigint };

function ratNormalize(value: Rat): Rat {
  if (value.denominator === 0n) throw new Error('GENERATOR_RATIONAL_DENOMINATOR_ZERO');
  let { numerator, denominator } = value;
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  const abs = (x: bigint) => (x < 0n ? -x : x);
  let a = abs(numerator);
  let b = denominator;
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  if (a > 1n) {
    numerator /= a;
    denominator /= a;
  }
  return { numerator, denominator };
}

const ratAdd = (a: Rat, b: Rat) =>
  ratNormalize({ numerator: a.numerator * b.denominator + b.numerator * a.denominator, denominator: a.denominator * b.denominator });
const ratSub = (a: Rat, b: Rat) =>
  ratNormalize({ numerator: a.numerator * b.denominator - b.numerator * a.denominator, denominator: a.denominator * b.denominator });
const ratMul = (a: Rat, b: Rat) => ratNormalize({ numerator: a.numerator * b.numerator, denominator: a.denominator * b.denominator });
const ratDiv = (a: Rat, b: Rat) => {
  if (b.numerator === 0n) throw new Error('GENERATOR_RATIONAL_DIVISION_BY_ZERO');
  return ratNormalize({ numerator: a.numerator * b.denominator, denominator: a.denominator * b.numerator });
};
const ratCmp = (a: Rat, b: Rat) => {
  const left = a.numerator * b.denominator;
  const right = b.numerator * a.denominator;
  return left < right ? -1 : left > right ? 1 : 0;
};
const ratAbs = (a: Rat): Rat => (a.numerator < 0n ? { numerator: -a.numerator, denominator: a.denominator } : a);
const ratFromBig = (value: bigint): Rat => ({ numerator: value, denominator: 1n });
/** Largest integer â‰¤ value (value may be negative). */
const ratFloor = (a: Rat): bigint => {
  const quotient = a.numerator / a.denominator;
  const remainder = a.numerator % a.denominator;
  if (remainder !== 0n && a.numerator < 0n) return quotient - 1n;
  return quotient;
};
const ratCeil = (a: Rat): bigint => -ratFloor({ numerator: -a.numerator, denominator: a.denominator });

/** Exact decimal-text -> rational (the accepted helper is Number-based). */
function ratFromDecimalText(text: string): Rat {
  const [whole, fraction = ''] = text.trim().split('.');
  const digits = `${whole}${fraction}`;
  return ratNormalize({ numerator: BigInt(digits), denominator: 10n ** BigInt(fraction.length) });
}

const decimalString = (value: Rat, digits: number) => bigRationalToDecimalString(value as BigRational, digits);
const presentation = (value: Rat) => bigRationalToPresentationNumber(value as BigRational);

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

const fail = (constraint: string, requested: string, achievable: string, detail?: string): ConstraintReason => ({
  constraint,
  requested,
  achievable,
  detail: detail ?? 'The generation request was rejected.',
});

export type GeneratorRequestValidation =
  | {
      ok: true;
      request: NormalizedGeneratorRequest;
      /**
       * Semantic constraints the *game adapter* interprets (it knows which
       * class is the loss class, the partial classes and the feature class).
       */
      semantic: {
        requirePositiveLoss?: boolean;
        requirePositivePartial?: boolean;
        requirePositiveProfit?: boolean;
        minFeatureWeightFraction?: string;
        maxFeatureWeightFraction?: string;
      };
    }
  | { ok: false; reasons: ConstraintReason[] };

export function validateGeneratorRequest(raw: unknown): GeneratorRequestValidation {
  const reasons: ConstraintReason[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reasons: [fail('REQUEST_INVALID', String(raw), 'a generation request object')] };
  }
  const input = raw as Record<string, unknown>;
  if (typeof input.gameId !== 'string' || !input.gameId.trim()) {
    reasons.push(fail('GAME_ID_INVALID', String(input.gameId), 'a non-empty game id'));
  }
  if (typeof input.maxWinMultiplier !== 'number' || !Number.isFinite(input.maxWinMultiplier) || input.maxWinMultiplier <= 0) {
    reasons.push(fail('MAX_WIN_REQUIRED', String(input.maxWinMultiplier), 'an explicit positive finite multiplier'));
  }
  if (input.targetRtp !== undefined && input.targetRtpPercent !== undefined) {
    reasons.push(fail('DUPLICATE_TARGET', 'targetRtp and targetRtpPercent', 'one target field'));
  }
  if (input.pacing !== undefined && input.objective !== undefined) {
    reasons.push(fail('DUPLICATE_OBJECTIVE', 'pacing and objective', 'one pacing field'));
  }
  for (const key of Object.keys(input)) {
    if (REQUEST_FIELDS.has(key)) continue;
    reasons.push(fail(
      KNOWN_UNSUPPORTED_CONSTRAINTS.has(key) ? 'UNSUPPORTED_CONSTRAINT' : 'UNKNOWN_FIELD',
      key,
      'the documented generation request fields',
      KNOWN_UNSUPPORTED_CONSTRAINTS.has(key)
        ? `"${key}" is recognised but not implemented by this generator; it is refused rather than ignored.`
        : PLAYER_SHAPED_FIELDS.has(key)
          ? `"${key}" is a player/session/balance/history-shaped input and is rejected.`
          : `"${key}" is not part of the generation request.`,
    ));
  }

  const targetRaw = input.targetRtpPercent ?? input.targetRtp;
  let targetText: string | null = null;
  if (typeof targetRaw === 'number') {
    if (!Number.isFinite(targetRaw)) reasons.push(fail('TARGET_NOT_FINITE', String(targetRaw), 'a finite percent'));
    else targetText = String(targetRaw);
  } else if (typeof targetRaw === 'string') {
    targetText = targetRaw;
  } else {
    reasons.push(fail('TARGET_INVALID', String(targetRaw), 'a percent number or exact decimal string'));
  }
  if (targetText !== null) {
    const trimmed = targetText.trim();
    if (!/^\d+(\.\d+)?$/.test(trimmed)) {
      reasons.push(fail('TARGET_NOT_A_DECIMAL', trimmed, 'a non-negative decimal percent'));
    } else {
      const decimals = trimmed.includes('.') ? trimmed.split('.')[1].length : 0;
      if (decimals > MAX_TARGET_DECIMAL_PLACES) {
        reasons.push(fail(
          'TARGET_PRECISION_TOO_FINE',
          trimmed,
          `at most ${MAX_TARGET_DECIMAL_PLACES} decimal places on the fixed-point grid`,
        ));
      } else {
        const target = ratFromDecimalText(trimmed);
        if (target.numerator < 0n || ratCmp(target, ratFromBig(100n)) > 0) {
          reasons.push(fail('TARGET_OUT_OF_RANGE', trimmed, '0..100 percent'));
        }
      }
    }
  }

  const objectiveRaw = input.objective ?? input.pacing ?? 'BALANCED';
  if (!['RETENTION', 'BALANCED', 'VOLATILE', 'CUSTOM'].includes(String(objectiveRaw))) {
    reasons.push(fail('OBJECTIVE_UNSUPPORTED', String(objectiveRaw), 'RETENTION | BALANCED | VOLATILE | CUSTOM'));
  }

  const granularityRaw = input.granularity ?? DEFAULT_GRANULARITY;
  if (!Number.isSafeInteger(granularityRaw) || (granularityRaw as number) < 1 || (granularityRaw as number) > 1_000_000_000) {
    reasons.push(fail('GRANULARITY_INVALID', String(granularityRaw), 'an integer 1..1000000000'));
  }
  const granularity = granularityRaw as number;

  const toleranceRaw = input.tolerancePercent ?? DEFAULT_TOLERANCE_PERCENT;
  let toleranceText: string | null = null;
  if (typeof toleranceRaw === 'number' && Number.isFinite(toleranceRaw)) toleranceText = String(toleranceRaw);
  else if (typeof toleranceRaw === 'string') toleranceText = toleranceRaw;
  else reasons.push(fail('TOLERANCE_INVALID', String(toleranceRaw), 'a positive decimal percent'));
  if (toleranceText !== null && !/^\d+(\.\d+)?$/.test(toleranceText.trim())) {
    reasons.push(fail('TOLERANCE_INVALID', toleranceText, 'a positive decimal percent'));
    toleranceText = null;
  }
  if (toleranceText !== null) {
    const tolerance = ratFromDecimalText(toleranceText.trim());
    if (tolerance.numerator <= 0n || ratCmp(tolerance, ratFromBig(5n)) > 0) {
      reasons.push(fail('TOLERANCE_OUT_OF_RANGE', toleranceText, 'a positive tolerance no larger than 5 percentage points'));
    }
    toleranceText = decimalString(tolerance, 6);
  }


  const minimumWeight: Record<string, number> = {};
  const maximumWeight: Record<string, number> = {};
  const semantic: {
    requirePositiveLoss?: boolean;
    requirePositivePartial?: boolean;
    requirePositiveProfit?: boolean;
    minFeatureWeightFraction?: string;
    maxFeatureWeightFraction?: string;
  } = {};
  const constraintsRaw = input.constraints ?? {};
  if (constraintsRaw && typeof constraintsRaw === 'object' && !Array.isArray(constraintsRaw)) {
    const constraints = constraintsRaw as Record<string, unknown>;
    for (const key of Object.keys(constraints)) {
      if (CONSTRAINT_FIELDS.has(key)) continue;
      reasons.push(fail(
        KNOWN_UNSUPPORTED_CONSTRAINTS.has(key) ? 'UNSUPPORTED_CONSTRAINT' : 'UNKNOWN_FIELD',
        key,
        'the documented constraint fields',
        KNOWN_UNSUPPORTED_CONSTRAINTS.has(key)
          ? `Constraint "${key}" (for example a dry-spell or volatility bound) has no well-defined generator metric here and is refused, not ignored.`
          : PLAYER_SHAPED_FIELDS.has(key)
            ? `Constraint "${key}" is player/session/balance/history-shaped and is rejected.`
            : `Constraint "${key}" is not part of the supported constraint set.`,
      ));
    }
    const parseFraction = (key: string, text: string): Rat | null => {
      if (!/^\d+(\.\d+)?$/.test(text)) {
        reasons.push(fail('CONSTRAINT_VALUE_INVALID', `${key}=${text}`, 'an exact decimal fraction 0..1'));
        return null;
      }
      const fraction = ratFromDecimalText(text);
      if (fraction.numerator < 0n || ratCmp(fraction, ratFromBig(1n)) > 0) {
        reasons.push(fail('CONSTRAINT_VALUE_OUT_OF_RANGE', `${key}=${text}`, 'a fraction between 0 and 1'));
        return null;
      }
      return fraction;
    };
    for (const [key, value] of Object.entries(constraints)) {
      if (!CONSTRAINT_FIELDS.has(key)) continue;
      if (key === 'maxFullLossRate') {
        const text = String(value);
        if (!/^\d+(\.\d+)?$/.test(text) || ratCmp(ratFromDecimalText(text), ratFromBig(100n)) > 0) {
          reasons.push(fail('CONSTRAINT_VALUE_INVALID', text, 'maxFullLossRate percentage 0..100'));
        } else {
          const fraction = ratDiv(ratFromDecimalText(text), ratFromBig(100n));
          maximumWeight.LOSS = Math.min(maximumWeight.LOSS ?? granularity,
            Number(ratFloor(ratMul(fraction, ratFromBig(BigInt(Number.isSafeInteger(granularity) ? granularity : 1))))));
        }
        continue;
      }
      if (key === 'requirePositiveLoss' || key === 'requirePositivePartial' || key === 'requirePositiveProfit') {
        if (typeof value !== 'boolean') {
          reasons.push(fail('CONSTRAINT_VALUE_INVALID', `${key}=${String(value)}`, 'a boolean'));
          continue;
        }
        if (key === 'requirePositiveLoss') semantic.requirePositiveLoss = value;
        if (key === 'requirePositivePartial') semantic.requirePositivePartial = value;
        if (key === 'requirePositiveProfit') semantic.requirePositiveProfit = value;
        continue;
      }
      if (key === 'minFeatureWeightFraction' || key === 'maxFeatureWeightFraction') {
        if (typeof value !== 'string') {
          reasons.push(fail('CONSTRAINT_VALUE_INVALID', `${key}=${String(value)}`, 'an exact decimal fraction'));
          continue;
        }
        const text = value.trim();
        const fraction = parseFraction(key, text);
        if (!fraction) continue;
        if (ratCmp(fraction, ratFromBig(0n)) === 0) {
          reasons.push(fail('CONSTRAINT_VALUE_OUT_OF_RANGE', `${key}=${text}`, 'a fraction greater than 0'));
          continue;
        }
        try {
          fractionToGridUnits(text, granularity); // grid-exactness is required
        } catch (error) {
          reasons.push(fail('CONSTRAINT_NOT_ON_GRID', `${key}=${text}`, `an exact multiple of 1/${granularity}`, (error as Error).message));
          continue;
        }
        if (key === 'minFeatureWeightFraction') semantic.minFeatureWeightFraction = text;
        else semantic.maxFeatureWeightFraction = text;
        continue;
      }
      // minimumWeightFraction / maximumWeightFraction: exact per-class floors and caps.
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        reasons.push(fail('CONSTRAINT_VALUE_INVALID', `${key}=${String(value)}`, 'an object of class -> exact decimal fraction'));
        continue;
      }
      const target = key === 'minimumWeightFraction' ? minimumWeight : maximumWeight;
      for (const [classId, fractionText] of Object.entries(value as Record<string, unknown>)) {
        if (!DISTRIBUTION_CLASSES.includes(classId as DistributionClass)) {
          reasons.push(fail('CONSTRAINT_CLASS_UNKNOWN', classId, DISTRIBUTION_CLASSES.join(', ')));
          continue;
        }
        if (typeof fractionText !== 'string') {
          reasons.push(fail('CONSTRAINT_VALUE_INVALID', `${classId}=${String(fractionText)}`, 'an exact decimal fraction 0..1'));
          continue;
        }
        const text = fractionText.trim();
        const fraction = parseFraction(`${key}.${classId}`, text);
        if (!fraction) continue;
        try {
          const units = fractionToGridUnits(text, granularity);
          target[classId] = key === 'maximumWeightFraction'
            ? Math.min(target[classId] ?? granularity, units) : units;
        } catch (error) {
          reasons.push(fail('CONSTRAINT_NOT_ON_GRID', `${key}.${classId}=${text}`, `an exact multiple of 1/${granularity}`, (error as Error).message));
        }
      }
    }
  } else {
    reasons.push(fail('CONSTRAINTS_INVALID', String(constraintsRaw), 'a constraint object'));
  }

  if (reasons.length > 0) return { ok: false, reasons };
  return {
    ok: true,
    request: {
      gameId: input.gameId as string,
      maxWinMultiplier: input.maxWinMultiplier as number,
      targetRtpPercent: targetText!.trim(),
      objective: String(objectiveRaw) as GeneratorObjective,
      granularity,
      tolerancePercent: toleranceText!,
      minimumWeight,
      maximumWeight,
    },
    semantic,
  };
}

/**
 * Translate a requested *fraction of total weight* into exact grid units.
 * A fraction that is not representable on the grid is refused.
 */
export function fractionToGridUnits(fraction: string, granularity: number): number {
  const value = ratFromDecimalText(fraction);
  const scaled = ratMul(value, ratFromBig(BigInt(granularity)));
  if (scaled.denominator !== 1n) {
    throw new Error(`GENERATOR_FRACTION_NOT_ON_GRID: ${fraction} x ${granularity}`);
  }
  const units = Number(scaled.numerator);
  if (!Number.isSafeInteger(units) || units < 0 || units > granularity) {
    throw new Error(`GENERATOR_FRACTION_OUT_OF_RANGE: ${fraction}`);
  }
  return units;
}

// ---------------------------------------------------------------------------
// The solver
// ---------------------------------------------------------------------------

export type SolverStrategy = {
  objective: GeneratorObjective;
  /** Classes that received weight above their floors, in class order. */
  support: DistributionClass[];
  method: 'EXACT_SINGLE_CLASS' | 'EXACT_TWO_CLASS' | 'EXACT_THREE_CLASS';
  enumeratedPairs: number;
  enumeratedTriples: number;
  minimumWeight: Record<string, number>;
};

export type SolverOutcome =
  | {
      ok: true;
      status: 'SOLVED';
      weights: DistributionWeights;
      expectedEv: BigRational;
      expectedRtpPercentExact: string;
      expectedRtpPercent: number | null;
      absoluteErrorPercentExact: string;
      absoluteErrorPercent: number | null;
      exact: boolean;
      strategy: SolverStrategy;
    }
  | { ok: false; status: 'INFEASIBLE' | 'SEARCH_EXHAUSTED' | 'REJECTED'; reasons: ConstraintReason[] };

export function solvePayoutPolicyWeights(input: {
  metadata: GeneratorModelMetadata;
  request: NormalizedGeneratorRequest;
}): SolverOutcome {
  const { metadata, request } = input;
  if (request.gameId !== metadata.gameId || request.maxWinMultiplier !== metadata.maxWinMultiplier
      || metadata.maxWinScope !== 'RESOLVED_SPIN') {
    return { ok: false, status: 'REJECTED', reasons: [fail('MODEL_REQUEST_MISMATCH',
      `${request.gameId}/${request.maxWinMultiplier}x`,
      `${metadata.gameId}/${metadata.maxWinMultiplier}x/RESOLVED_SPIN`,
      'The solver must consume the reachability model proved for the requested game and cap.')] };
  }
  const G = BigInt(request.granularity);
  const targetPercent = ratFromDecimalText(request.targetRtpPercent);
  const tolerancePercent = ratFromDecimalText(request.tolerancePercent);
  const targetEv = ratDiv(targetPercent, ratFromBig(100n));
  // True RTP0 is an exact zero-return requirement, not a near-zero target.
  const toleranceEv = targetPercent.numerator === 0n ? ratFromBig(0n) : ratDiv(tolerancePercent, ratFromBig(100n));
  const infeasible = (constraint: string, requested: string, achievable: string): SolverOutcome => ({
    ok: false, status: 'INFEASIBLE', reasons: [fail(constraint, requested, achievable,
      `Exact bound contradiction for model ${metadata.modelId}: ${requested}; required ${achievable}.`)],
  });

  const classes = [...metadata.reachableClasses].sort((a, b) => {
    const cmp = ratCmp(a.conditionalEv as Rat, b.conditionalEv as Rat);
    if (cmp !== 0) return cmp;
    return DISTRIBUTION_CLASSES.indexOf(a.classId) - DISTRIBUTION_CLASSES.indexOf(b.classId);
  });
  if (classes.length === 0) {
    return {
      ok: false,
      status: 'INFEASIBLE',
      reasons: [fail('MODEL_HAS_NO_REACHABLE_CLASS', '0', '>= 1 reachable class', 'The declared model reaches no payable class.')],
    };
  }

  // Floors and caps: exact grid units.
  const floors = new Map<string, bigint>();
  const caps = new Map<string, bigint>();
  const reachable = new Set(classes.map((entry) => entry.classId));
  for (const [id, value] of Object.entries(request.minimumWeight)) {
    if (value > 0 && !reachable.has(id as DistributionClass)) {
      return infeasible('UNREACHABLE_CLASS_MINIMUM', `${id} >= ${value}`, 'zero weight on an unreachable class');
    }
  }
  for (const entry of classes) {
    floors.set(entry.classId, BigInt(request.minimumWeight[entry.classId] ?? 0));
    caps.set(entry.classId, BigInt(request.maximumWeight[entry.classId] ?? request.granularity));
    if (floors.get(entry.classId)! > caps.get(entry.classId)!) {
      return infeasible('MINIMUM_EXCEEDS_MAXIMUM', `${entry.classId}: min ${floors.get(entry.classId)}, max ${caps.get(entry.classId)}`, 'min <= max');
    }
  }
  let floorWeight = 0n;
  let floorEv = ratFromBig(0n);
  for (const entry of classes) {
    const floor = floors.get(entry.classId)!;
    floorWeight += floor;
    floorEv = ratAdd(floorEv, ratMul(ratFromBig(floor), entry.conditionalEv as Rat));
  }
  if (floorWeight > G) {
    return {
      ok: false,
      status: 'INFEASIBLE',
      reasons: [fail('MINIMUM_WEIGHTS_EXCEED_TOTAL', floorWeight.toString(), `<= ${G.toString()} grid units`)],
    };
  }
  const residual = G - floorWeight;
  const capTotal = [...caps.values()].reduce((sum, value) => sum + value, 0n);
  if (capTotal < G) return infeasible('MAXIMUM_WEIGHTS_BELOW_TOTAL', capTotal.toString(), `>= ${G}`);

  // Exact extrema of a box-constrained distribution: greedily fill remaining
  // integer mass in EV order. Outside this interval is genuinely impossible;
  // inside it, a bounded search miss is NOT proof of grid infeasibility.
  const extremeEv = (ordered: typeof classes): Rat => {
    let remaining = residual;
    let total = floorEv;
    for (const entry of ordered) {
      const room = caps.get(entry.classId)! - floors.get(entry.classId)!;
      const take = remaining < room ? remaining : room;
      total = ratAdd(total, ratMul(ratFromBig(take), entry.conditionalEv));
      remaining -= take;
    }
    return ratDiv(total, ratFromBig(G));
  };
  const minEv = extremeEv(classes);
  const maxEv = extremeEv([...classes].reverse());
  if (ratCmp(ratAdd(targetEv, toleranceEv), minEv) < 0 || ratCmp(ratSub(targetEv, toleranceEv), maxEv) > 0) {
    return infeasible('TARGET_OUTSIDE_ATTAINABLE_INTERVAL', `${request.targetRtpPercent}% +/- ${request.tolerancePercent}pp`,
      `RTP in [${decimalString(ratMul(minEv, ratFromBig(100n)), 12)}, ${decimalString(ratMul(maxEv, ratFromBig(100n)), 12)}]% ` +
      `(exact EV bounds ${minEv.numerator}/${minEv.denominator}, ${maxEv.numerator}/${maxEv.denominator})`);
  }

  const evById = new Map<string, Rat>();
  for (const entry of classes) evById.set(entry.classId, entry.conditionalEv as Rat);

  /** Evaluate a candidate weight vector exactly (weights in grid units). */
  const evaluate = (weights: Map<string, bigint>): { ev: Rat; error: Rat } => {
    let total = ratFromBig(0n);
    for (const entry of classes) {
      const weight = weights.get(entry.classId) ?? 0n;
      total = ratAdd(total, ratMul(ratFromBig(weight), evById.get(entry.classId)!));
    }
    const ev = ratDiv(total, ratFromBig(G));
    return { ev, error: ratAbs(ratSub(ev, targetEv)) };
  };

  type Candidate = { weights: Map<string, bigint>; ev: Rat; error: Rat; support: DistributionClass[]; method: SolverStrategy['method'] };
  const candidates: Candidate[] = [];
  const baseWeights = () => new Map<string, bigint>(classes.map((entry) => [entry.classId, floors.get(entry.classId)!]));

  /** Exact single-class solve: put the whole residual on one class. */
  for (const entry of classes) {
    const weights = baseWeights();
    weights.set(entry.classId, weights.get(entry.classId)! + residual);
    if (weights.get(entry.classId)! > caps.get(entry.classId)!) continue;
    const { ev, error } = evaluate(weights);
    candidates.push({ weights, ev, error, support: [entry.classId], method: 'EXACT_SINGLE_CLASS' });
  }

  /** Exact two-class solve: the residual is split between a and b in closed form. */
  const solvePair = (aId: DistributionClass, bId: DistributionClass, method: SolverStrategy['method']): Candidate | null => {
    const evA = evById.get(aId)!;
    const evB = evById.get(bId)!;
    if (ratCmp(evA, evB) === 0) return null;
    const targetWeighted = ratMul(targetEv, ratFromBig(G));
    const base = baseWeights();
    // residual on a is x, on b is (residual - x).
    const numerator = ratSub(ratSub(targetWeighted, floorEv), ratMul(ratFromBig(residual), evB));
    const denominator = ratSub(evA, evB);
    const xExact = ratDiv(numerator, denominator);
    let best: Candidate | null = null;
    for (const candidateX of [ratFloor(xExact), ratCeil(xExact)]) {
      if (candidateX < 0n || candidateX > residual) continue;
      const weights = new Map(base);
      weights.set(aId, weights.get(aId)! + candidateX);
      weights.set(bId, weights.get(bId)! + (residual - candidateX));
      if (weights.get(aId)! > caps.get(aId)!) continue;
      if (weights.get(bId)! > caps.get(bId)!) continue;
      const { ev, error } = evaluate(weights);
      const support: DistributionClass[] = candidateX === 0n ? [bId] : candidateX === residual ? [aId] : [aId, bId];
      const candidate: Candidate = { weights, ev, error, support, method };
      if (!best || ratCmp(candidate.error, best.error) < 0) best = candidate;
    }
    return best;
  };

  const pairs = new Map<string, Candidate>();
  let enumeratedPairs = 0;
  for (let i = 0; i < classes.length; i += 1) {
    for (let j = i + 1; j < classes.length; j += 1) {
      enumeratedPairs += 1;
      const candidate = solvePair(classes[i].classId, classes[j].classId, 'EXACT_TWO_CLASS');
      if (candidate) pairs.set(`${classes[i].classId}|${classes[j].classId}`, candidate);
    }
  }
  candidates.push(...pairs.values());

  /**
   * Exact three-class solve.
   *
   * With three classes and integer grid weights summing to the grid, the
   * expectation constraint is a single linear Diophantine equation in two
   * unknowns, so it is solved *exactly* (extended Euclid) instead of searched:
   * every returned candidate hits the target exactly on the grid, and a triple
   * with no integer solution is refused as infeasible *for that triple*. This
   * keeps the family bounded (at most one solve per class triple) while
   * covering the fine-grained mixtures an extreme pair alone cannot express.
   */
  const gcdBig = (a: bigint, b: bigint): bigint => {
    let left = a < 0n ? -a : a;
    let right = b < 0n ? -b : b;
    while (right !== 0n) {
      const next = left % right;
      left = right;
      right = next;
    }
    return left;
  };
  const lcmBig = (a: bigint, b: bigint): bigint => (a === 0n || b === 0n ? 0n : (a / gcdBig(a, b)) * b);
  const extendedGcd = (a: bigint, b: bigint) => {
    let [oldR, r] = [a, b];
    let [oldS, s] = [1n, 0n];
    let [oldT, t] = [0n, 1n];
    while (r !== 0n) {
      const quotient = oldR / r;
      [oldR, r] = [r, oldR - quotient * r];
      [oldS, s] = [s, oldS - quotient * s];
      [oldT, t] = [t, oldT - quotient * t];
    }
    return { g: oldR, x: oldS, y: oldT };
  };
  /** Interval of t with lo <= base + t*step <= hi. */
  const tInterval = (base: bigint, step: bigint, lo: bigint, hi: bigint): [bigint, bigint] | null => {
    if (lo > hi) return null;
    if (step === 0n) return base >= lo && base <= hi ? [-(2n ** 62n), 2n ** 62n] : null;
    // Normalize so the denominator is positive before flooring/ceiling: BigInt
    // division truncates toward zero and would break a negative step.
    const lower = ratCeil(ratNormalize({ numerator: (step > 0n ? lo : hi) - base, denominator: step }));
    const upper = ratFloor(ratNormalize({ numerator: (step > 0n ? hi : lo) - base, denominator: step }));
    return lower <= upper ? [lower, upper] : null;
  };
  const intersect = (a: [bigint, bigint] | null, b: [bigint, bigint] | null): [bigint, bigint] | null => {
    if (!a || !b) return null;
    const lower = a[0] > b[0] ? a[0] : b[0];
    const upper = a[1] < b[1] ? a[1] : b[1];
    return lower <= upper ? [lower, upper] : null;
  };

  let enumeratedTriples = 0;
  const solveTriple = (aId: DistributionClass, mId: DistributionClass, bId: DistributionClass): Candidate[] => {
    const evA = evById.get(aId)!;
    const evM = evById.get(mId)!;
    const evB = evById.get(bId)!;
    const dA = ratSub(evA, evB);
    const dM = ratSub(evM, evB);
    const rhs = ratSub(ratSub(ratMul(targetEv, ratFromBig(G)), floorEv), ratMul(ratFromBig(residual), evB));
    const scale = lcmBig(lcmBig(dA.denominator, dM.denominator), rhs.denominator);
    if (scale === 0n) return [];
    const A = dA.numerator * (scale / dA.denominator);
    const B = dM.numerator * (scale / dM.denominator);
    const C = rhs.numerator * (scale / rhs.denominator);
    const { g, x: x0, y: y0 } = extendedGcd(A, B);
    if (g === 0n || C % g !== 0n) return [];
    const factor = C / g;
    const baseX = x0 * factor;
    const baseY = y0 * factor;
    const stepX = B / g;
    const stepY = -(A / g);
    const floorA = floors.get(aId)!;
    const floorM = floors.get(mId)!;
    const floorB = floors.get(bId)!;
    const roomA = caps.get(aId)! - floorA;
    const roomM = caps.get(mId)! - floorM;
    const roomB = caps.get(bId)! - floorB;
    let interval = intersect(tInterval(baseX, stepX, 0n, roomA), tInterval(baseY, stepY, 0n, roomM));
    interval = intersect(interval, tInterval(baseX + baseY, stepX + stepY, 0n, residual));
    interval = intersect(interval, tInterval(residual - baseX - baseY, -(stepX + stepY), 0n, roomB));
    if (!interval) return [];
    const found: Candidate[] = [];
    for (const t of [interval[0], interval[1]]) {
      const x = baseX + t * stepX;
      const y = baseY + t * stepY;
      if (x < 0n || y < 0n || x > roomA || y > roomM) continue;
      const weights = baseWeights();
      weights.set(aId, floorA + x);
      weights.set(mId, floorM + y);
      weights.set(bId, floorB + (residual - x - y));
      const { ev, error } = evaluate(weights);
      const support: DistributionClass[] = [aId, mId, bId].filter((id, index, all) =>
        weights.get(id)! > floors.get(id)! && all.indexOf(id) === index);
      const candidate: Candidate = {
        weights,
        ev,
        error,
        support: support.length > 0 ? support : [bId],
        method: 'EXACT_THREE_CLASS',
      };
      if (!found.some((entry) => entry.support.join(',') === candidate.support.join(',')
        && entry.weights.get(bId) === candidate.weights.get(bId))) {
        found.push(candidate);
      }
    }
    return found;
  };

  for (let i = 0; i < classes.length; i += 1) {
    for (let j = i + 1; j < classes.length; j += 1) {
      for (let k = j + 1; k < classes.length; k += 1) {
        enumeratedTriples += 1;
        candidates.push(...solveTriple(classes[i].classId, classes[j].classId, classes[k].classId));
      }
    }
  }

  /**
   * Objective support selection over the *soft* candidates (single/pair).
   *  - BALANCED: the tightest bracket around the target.
   *  - VOLATILE: the widest bracket (fewest, largest wins).
   *  - RETENTION: the pair whose low leg is the highest-EV class inside the
   *    documented small-return band (frequent small returns).
   *  - CUSTOM: the BALANCED rule, with the caller's floors carrying the custom shape.
   */
  const meetsBounds = (entry: Candidate) => {
    let sum = 0n;
    for (const cls of classes) {
      const weight = entry.weights.get(cls.classId) ?? 0n;
      if (weight < floors.get(cls.classId)! || weight > caps.get(cls.classId)!) return false;
      sum += weight;
    }
    return sum === G;
  };
  const withinTolerance = (entry: Candidate) => ratCmp(entry.error, toleranceEv) <= 0;
  const validCandidates = candidates.filter((entry) => meetsBounds(entry) && withinTolerance(entry));
  // Preserve existing valid pair solutions. Triples are a bounded feasibility
  // fallback, not a reason to replace already generated valid policies.
  const simple = validCandidates.filter((entry) => entry.method !== 'EXACT_THREE_CLASS');
  const softCandidates = simple.length ? simple : validCandidates;
  const bracketSpan = (entry: Candidate) => {
    const evs = entry.support.map((id) => evById.get(id)!);
    if (evs.length < 2) return ratFromBig(0n);
    return ratAbs(ratSub(evs[evs.length - 1], evs[0]));
  };
  /**
   * Objective ordering, stated explicitly and deterministically:
   *  - BALANCED / CUSTOM: the tightest bracket around the target (least extreme),
   *    ties broken by exact error and then by class order.
   *  - VOLATILE: the widest bracket (fewest, largest wins), same tie-breaks.
   *  - RETENTION: the largest share of weight on the documented small-return
   *    band (classes whose expectation is inside `0 < ev <= RETENTION_BAND_MAX_EV`),
   *    i.e. the highest frequency of small returns; ties are broken by the
   *    widest bracket to keep the shape simple.
   */
  type Scored = { entry: Candidate; span: number; lowEv: number; inBand: boolean; bandWeight: number };
  const scored: Scored[] = softCandidates.map((entry) => {
    const evs = entry.support.map((id) => evById.get(id)!);
    const span = evs.length >= 2 ? presentation(bracketSpan(entry)) ?? 0 : 0;
    const lowEv = presentation(evById.get(entry.support[0])!) ?? 0;
    let bandWeight = 0;
    for (const [classId, weight] of entry.weights) {
      const ev = presentation(evById.get(classId as DistributionClass)!) ?? 0;
      if (ev > 0 && ev <= RETENTION_BAND_MAX_EV) bandWeight += Number(weight);
    }
    return { entry, span, lowEv, inBand: lowEv > 0 && lowEv <= RETENTION_BAND_MAX_EV, bandWeight };
  });
  const byClassOrder = (a: Scored, b: Scored) =>
    a.entry.support.join(',').localeCompare(b.entry.support.join(','));
  scored.sort((a, b) => {
    switch (request.objective) {
      case 'VOLATILE':
        return (b.span - a.span) || ratCmp(a.entry.error, b.entry.error) || byClassOrder(a, b);
      case 'RETENTION':
        return (b.bandWeight - a.bandWeight) || (b.span - a.span) || (b.lowEv - a.lowEv) ||
          ratCmp(a.entry.error, b.entry.error) || byClassOrder(a, b);
      case 'BALANCED':
      case 'CUSTOM':
      default:
        return (a.span - b.span) || ratCmp(a.entry.error, b.entry.error) || byClassOrder(a, b);
    }
  });

  // The objective order already ranks every exact solution; take the first that
  // is genuinely inside the stated tolerance, and never accept one that is not.
  const chosen = (scored.map((entry) => entry.entry).filter((entry) => withinTolerance(entry)))[0] ?? null;

  if (!chosen || !withinTolerance(chosen)) {
    return {
      ok: false,
      status: 'SEARCH_EXHAUSTED',
      reasons: [fail(
        'BOUNDED_SEARCH_EXHAUSTED',
        `target ${request.targetRtpPercent}%`,
        'a weight vector inside the declared model, grid and bounded search family',
        'The bounded search (exact single-class, two-class and three-class solves) found no ' +
          'allocation inside the stated tolerance. ' +
          (chosen ? `Best exact error found: ${decimalString(ratMul(chosen.error, ratFromBig(100n)), 6)}pp. ` : '') +
          'The exact feasible EV interval contains the target; this search miss is not proof of infeasibility.',
      )],
    };
  }

  const weights = {} as DistributionWeights;
  for (const classId of DISTRIBUTION_CLASSES) {
    weights[classId] = Number(chosen.weights.get(classId) ?? 0n);
  }
  const expectedRtp = ratMul(chosen.ev, ratFromBig(100n));
  const errorRtp = ratMul(chosen.error, ratFromBig(100n));
  return {
    ok: true,
    status: 'SOLVED',
    weights,
    expectedEv: chosen.ev as BigRational,
    expectedRtpPercentExact: decimalString(expectedRtp, 6),
    expectedRtpPercent: presentation(expectedRtp),
    absoluteErrorPercentExact: decimalString(errorRtp, 6),
    absoluteErrorPercent: presentation(errorRtp),
    exact: ratCmp(chosen.error, ratFromBig(0n)) === 0,
    strategy: {
      objective: request.objective,
      support: chosen.support,
      method: chosen.method,
      enumeratedPairs,
      enumeratedTriples,
      minimumWeight: Object.fromEntries([...floors.entries()].filter(([, value]) => value > 0n).map(([key, value]) => [key, Number(value)])),
    },
  };
}

// ---------------------------------------------------------------------------
// Policy assembly and acceptance checks
// ---------------------------------------------------------------------------

export function assembleDistributionPolicy(input: {
  metadata: GeneratorModelMetadata;
  policyId: string;
  weights: DistributionWeights;
  granularity: number;
}): DistributionPolicy {
  const { metadata } = input;
  const policy: DistributionPolicy = {
    policyId: input.policyId,
    version: 1,
    gameId: metadata.gameId,
    mathProfileId: metadata.modelId,
    mathProfileHash: metadata.modelHash,
    maxWinScope: 'RESOLVED_SPIN',
    maxWinMultiplier: metadata.maxWinMultiplier,
    granularity: input.granularity,
    maxBandMin: metadata.maxBandMin,
    weights: input.weights,
  };
  return policy;
}

export function generatorRequestHash(request: NormalizedGeneratorRequest, metadata: GeneratorModelMetadata): string {
  return sha256Hex(canonicalJson({
    solver: SOLVER_VERSION,
    gameId: metadata.gameId,
    modelId: metadata.modelId,
    modelHash: metadata.modelHash,
    request,
  }));
}

export function policyWeightsSum(weights: DistributionWeights): number {
  return DISTRIBUTION_CLASSES.reduce((sum, classId) => sum + (weights[classId] ?? 0), 0);
}

/**
 * Acceptance checks for one generated payout policy. `VALIDATED` here is an
 * evidence status for a reviewable candidate - it is never an activation.
 */
export function generatorChecks(input: {
  metadata: GeneratorModelMetadata;
  request: NormalizedGeneratorRequest;
  policy: DistributionPolicy;
  solver: Extract<SolverOutcome, { ok: true }>;
  support: {
    reachableBoards: number;
    maxWin: { paidSpinMax: number; freeSpinMax: number; resolvedSpinMax: number };
    ev: { numerator: bigint; denominator: bigint };
    classes: ReadonlyArray<{ class: DistributionClass; members: number; conditionalEv: { numerator: bigint; denominator: bigint } | null }>;
  };
}): MathCheck[] {
  const { metadata, request, policy, solver, support } = input;
  const checks: MathCheck[] = [];
  const push = (id: string, status: MathCheck['status'], detail: string, value?: unknown) =>
    checks.push({ id, status, detail, value });

  const sum = policyWeightsSum(policy.weights);
  push(
    'WEIGHTS_SUM_TO_GRANULARITY',
    sum === policy.granularity ? 'PASS' : 'FAIL',
    `weights sum to ${sum} of the ${policy.granularity}-unit grid`,
    { sum, granularity: policy.granularity },
  );
  const negative = DISTRIBUTION_CLASSES.filter((classId) => !Number.isSafeInteger(policy.weights[classId]) || policy.weights[classId] < 0);
  push(
    'WEIGHTS_NON_NEGATIVE_INTEGERS',
    negative.length === 0 ? 'PASS' : 'FAIL',
    negative.length === 0 ? 'every weight is a non-negative safe integer' : `invalid weights: ${negative.join(', ')}`,
  );

  const unreachableWithWeight = metadata.unreachableClasses.filter((classId) => policy.weights[classId] > 0);
  push(
    'ONLY_REACHABLE_CLASSES_CARRY_WEIGHT',
    unreachableWithWeight.length === 0 ? 'PASS' : 'FAIL',
    unreachableWithWeight.length === 0
      ? `unreachable classes carry zero weight (${metadata.unreachableClasses.join(', ') || 'none'})`
      : `unreachable classes carry weight: ${unreachableWithWeight.join(', ')}`,
  );

  const missingMembers = support.classes
    .filter((entry) => policy.weights[entry.class] > 0 && (entry.members === 0 || entry.conditionalEv === null))
    .map((entry) => entry.class);
  push(
    'WEIGHTED_CLASSES_HAVE_PROVED_EXPECTATION',
    missingMembers.length === 0 ? 'PASS' : 'FAIL',
    missingMembers.length === 0
      ? 'every weighted class has reachable members and a proved expectation'
      : `classes without a proved expectation: ${missingMembers.join(', ')}`,
  );

  const perSpin = support.maxWin;
  push(
    'MAX_WIN_RESOLVED_SPIN_WITHIN_CEILING',
    perSpin.resolvedSpinMax <= metadata.maxWinMultiplier ? 'PASS' : 'FAIL',
    `proved per-resolution max ${perSpin.resolvedSpinMax}x (paid ${perSpin.paidSpinMax}x, free ${perSpin.freeSpinMax}x)` +
      ` vs the declared ${metadata.maxWinMultiplier}x ceiling; the feature aggregate is deliberately uncapped`,
    { ...perSpin, ceiling: metadata.maxWinMultiplier },
  );

  const capUnits = multiplierToUnits(metadata.maxWinMultiplier, 20);
  push(
    'MAX_WIN_CAP_IS_EXACT_ON_THE_SIMULATION_GRID',
    Number.isSafeInteger(capUnits) ? 'PASS' : 'FAIL',
    `cap ${metadata.maxWinMultiplier}x x 20 stake units = ${capUnits} exact simulation units`,
    { capUnits },
  );

  push(
    'EXPECTED_RTP_MATCHES_TARGET',
    solver.absoluteErrorPercent !== null && solver.absoluteErrorPercent <= Number(request.tolerancePercent) ? 'PASS' : 'FAIL',
    `exact expected ${solver.expectedRtpPercentExact}% vs requested ${request.targetRtpPercent}%` +
      ` (exact absolute error ${solver.absoluteErrorPercentExact}pp, tolerance ${request.tolerancePercent}pp)`,
    { expected: solver.expectedRtpPercentExact, target: request.targetRtpPercent, error: solver.absoluteErrorPercentExact },
  );

  const targetIsZero = Number(request.targetRtpPercent) === 0;
  const payingClassWeight = DISTRIBUTION_CLASSES.reduce((sum2, classId) => {
    const entry = metadata.reachableClasses.find((cls) => cls.classId === classId);
    if (!entry) return sum2;
    const ev = presentation(entry.conditionalEv as Rat) ?? 0;
    return ev > 0 ? sum2 + policy.weights[classId] : sum2;
  }, 0);
  push(
    'TARGET_ZERO_IS_A_PROVED_ZERO_RETURN_POLICY',
    !targetIsZero || payingClassWeight === 0 ? 'PASS' : 'FAIL',
    targetIsZero
      ? (payingClassWeight === 0
        ? 'a 0% target carries weight only on classes whose proved expectation is exactly zero'
        : `a 0% target carries ${payingClassWeight} units on classes with a positive proved expectation`)
      : 'not applicable (target is not 0%)',
  );

  const floors = solver.strategy.minimumWeight;
  const floorViolations = Object.entries(floors).filter(([classId, floor]) => policy.weights[classId as DistributionClass] < floor);
  push(
    'REQUESTED_MINIMUM_WEIGHTS_HELD',
    floorViolations.length === 0 ? 'PASS' : 'FAIL',
    floorViolations.length === 0
      ? `minimum weights held: ${JSON.stringify(floors)}`
      : `violations: ${floorViolations.map(([id, floor]) => `${id}>=${floor}`).join(', ')}`,
  );
  const capViolations = Object.entries(request.maximumWeight)
    .filter(([classId, cap]) => policy.weights[classId as DistributionClass] > cap);
  push('REQUESTED_MAXIMUM_WEIGHTS_HELD', capViolations.length === 0 ? 'PASS' : 'FAIL',
    capViolations.length === 0 ? `maximum weights held: ${JSON.stringify(request.maximumWeight)}`
      : `violations: ${capViolations.map(([id, cap]) => `${id}<=${cap}`).join(', ')}`);

  const featureEntry = metadata.reachableClasses.find((entry) => entry.classId === 'FEATURE_TRIGGER');
  push(
    'FEATURE_EXPECTATION_PROVED_OR_ABSENT',
    !featureEntry || (featureEntry.conditionalFeatureEv !== null && featureEntry.conditionalEv !== null) ? 'PASS' : 'FAIL',
    featureEntry
      ? `FEATURE_TRIGGER expectation ${decimalString(featureEntry.conditionalEv as Rat, 6)} (paid ` +
        `${featureEntry.conditionalPaidEv ? decimalString(featureEntry.conditionalPaidEv as Rat, 6) : 'n/a'}, feature ` +
        `${featureEntry.conditionalFeatureEv ? decimalString(featureEntry.conditionalFeatureEv as Rat, 6) : 'unproved'})`
      : 'the declared model reaches no feature-trigger class',
  );

  const hashOnce = distributionPolicyHash(policy);
  const hashTwice = distributionPolicyHash(JSON.parse(JSON.stringify(policy)) as DistributionPolicy);
  push(
    'POLICY_HASH_IS_CANONICAL',
    hashOnce === hashTwice ? 'PASS' : 'FAIL',
    `policy hash ${hashOnce} is stable across a serialization round trip`,
    { policyHash: hashOnce },
  );

  return checks;
}

export function checksPass(checks: readonly MathCheck[]): boolean {
  return checks.every((entry) => entry.status === 'PASS');
}

export { ratAdd, ratSub, ratMul, ratDiv, ratCmp, ratAbs, ratFloor, ratCeil, ratFromBig, ratNormalize, decimalString as ratDecimalString };
export type { Rat };
