import { randomInt } from 'node:crypto';
import { canonicalJson, sha256Hex } from './math-control.analytics';
import { bigRational, type BigRational } from './math-control.rational';
import type { ConstraintReason } from './math-control.types';

/**
 * Global payout distribution core.
 *
 * A distribution policy states, in exact integer units, how often each canonical
 * payout class should occur. It is a *selection* policy over pre-validated
 * reachable outcomes - never a rejection sampler, never a truncation and never
 * a target-RTP generator: the class is chosen first, then a real reachable
 * outcome inside that class is executed by the game's own mathematics.
 *
 * Model A classes (mutually exclusive, exhaustive, weight sum exactly 100%):
 *
 *   LOSS            X = 0
 *   PARTIAL_LOW     0 < X < 0.5
 *   PARTIAL_HIGH    0.5 <= X < 1
 *   BREAK_EVEN      X = 1
 *   SMALL           1 < X < 5
 *   MEDIUM          5 <= X < 20
 *   BIG             20 <= X < maxBandMin
 *   MAX             maxBandMin <= X <= maxWinMultiplier
 *   FEATURE_TRIGGER the outcome triggers the adapter-defined feature
 *
 * Ordinary bands EXCLUDE triggering boards; FEATURE_TRIGGER is a separate
 * top-level class whose payout is the triggering board's native paid return
 * plus the conditional whole-chain feature expectation. `maxBandMin` is
 * immutable and may never be below 20, so a cap below 20 makes the high bands
 * unreachable instead of overlapping.
 */

export const DISTRIBUTION_CLASSES = [
  'LOSS',
  'PARTIAL_LOW',
  'PARTIAL_HIGH',
  'BREAK_EVEN',
  'SMALL',
  'MEDIUM',
  'BIG',
  'MAX',
  'FEATURE_TRIGGER',
] as const;
export type DistributionClass = (typeof DISTRIBUTION_CLASSES)[number];
export type OrdinaryDistributionClass = Exclude<DistributionClass, 'FEATURE_TRIGGER'>;

/** The immutable floor for the BIG/MAX boundary. */
export const MAX_BAND_MIN_FLOOR = 20;

/**
 * Largest chunk `crypto.randomInt` accepts (2^48 - 1 is its inclusive maximum,
 * so the exclusive upper bound must stay at or below 2^47 to leave headroom for
 * the `+ 1` convention used by the chunked draw).
 */
const CRYPTO_RANDOM_INT_MAX_EXCLUSIVE = 2 ** 47;
const CRYPTO_CHUNK_BITS = 47n;

export type DistributionBandBounds = {
  /** Immutable start of the MAX band; >= 20. */
  maxBandMin: number;
  /** The RESOLVED_SPIN ceiling this distribution is bound to. */
  maxWinMultiplier: number;
};

export type DistributionWeights = Record<DistributionClass, number>;

export type DistributionPolicy = {
  policyId: string;
  version: number;
  /** Registry id of the game this policy belongs to. */
  gameId: string;
  /** The immutable mathematics this policy may select outcomes from. */
  mathProfileId: string;
  mathProfileHash: string;
  /** Only the per-resolution scope is compatible with a class distribution. */
  maxWinScope: 'RESOLVED_SPIN';
  maxWinMultiplier: number;
  /** Exact units that represent probability 1.0 (for example 10000 = basis points). */
  granularity: number;
  maxBandMin: number;
  /** Exact non-negative integer units; the nine weights must sum to `granularity`. */
  weights: DistributionWeights;
};

const POLICY_KEYS = new Set([
  'policyId',
  'version',
  'gameId',
  'mathProfileId',
  'mathProfileHash',
  'maxWinScope',
  'maxWinMultiplier',
  'granularity',
  'maxBandMin',
  'weights',
]);

const WEIGHT_KEYS = new Set<string>(DISTRIBUTION_CLASSES);
const MAX_GRANULARITY = 1_000_000_000;

/** Classes that cannot contain any outcome under these bounds. */
export function unreachableClasses(bounds: DistributionBandBounds): Set<DistributionClass> {
  const unreachable = new Set<DistributionClass>();
  if (bounds.maxWinMultiplier <= 1) {
    unreachable.add('SMALL');
    unreachable.add('MEDIUM');
    unreachable.add('BIG');
    unreachable.add('MAX');
  } else if (bounds.maxWinMultiplier < 5) {
    unreachable.add('MEDIUM');
    unreachable.add('BIG');
    unreachable.add('MAX');
  } else if (bounds.maxWinMultiplier < MAX_BAND_MIN_FLOOR) {
    unreachable.add('BIG');
    unreachable.add('MAX');
  } else if (bounds.maxWinMultiplier < bounds.maxBandMin) {
    unreachable.add('MAX');
  }
  return unreachable;
}

/** Class of an ordinary (non-triggering) paid-board multiple. */
export function ordinaryClassForMultiplier(
  multiplier: number,
  bounds: DistributionBandBounds,
): OrdinaryDistributionClass {
  if (!Number.isFinite(multiplier) || multiplier < 0) {
    throw new Error(`DISTRIBUTION_MULTIPLIER_INVALID: ${multiplier}`);
  }
  if (multiplier > bounds.maxWinMultiplier) {
    throw new Error(`DISTRIBUTION_MULTIPLIER_ABOVE_CAP: ${multiplier} > ${bounds.maxWinMultiplier}`);
  }
  if (multiplier === 0) return 'LOSS';
  if (multiplier < 0.5) return 'PARTIAL_LOW';
  if (multiplier < 1) return 'PARTIAL_HIGH';
  if (multiplier === 1) return 'BREAK_EVEN';
  if (multiplier < 5) return 'SMALL';
  if (multiplier < 20) return 'MEDIUM';
  if (multiplier < bounds.maxBandMin) return 'BIG';
  return 'MAX';
}

type RawPolicy = Record<string, unknown>;

export type DistributionValidation =
  | { ok: true; policy: DistributionPolicy }
  | { ok: false; reasons: ConstraintReason[] };

/**
 * Validate a distribution policy.
 *
 * The accepted shape is a closed whitelist: a client cannot smuggle a player,
 * a session, a balance, a history value or a seed into the selector, and the
 * weights are exact integers that must total exactly the stated granularity.
 */
export function validateDistributionPolicy(raw: unknown): DistributionValidation {
  const reasons: ConstraintReason[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reasons: [fail('DISTRIBUTION_POLICY_INVALID', 'not an object', 'a policy document')] };
  }
  const input = raw as RawPolicy;
  for (const key of Object.keys(input)) {
    if (!POLICY_KEYS.has(key)) {
      reasons.push(fail(
        'UNKNOWN_FIELD',
        key,
        'a closed distribution-policy document',
        `Field "${key}" is not part of the distribution policy; player, session, balance, history and seed inputs are rejected.`,
      ));
    }
  }

  const policyId = input.policyId;
  if (typeof policyId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,119}$/i.test(policyId)) {
    reasons.push(fail('POLICY_ID_INVALID', String(policyId), 'a safe identifier'));
  }
  const version = input.version;
  if (!Number.isSafeInteger(version) || (version as number) < 1) {
    reasons.push(fail('POLICY_VERSION_INVALID', String(version), 'a positive integer'));
  }
  const mathProfileId = input.mathProfileId;
  if (typeof mathProfileId !== 'string' || mathProfileId.length === 0 || mathProfileId.length > 120) {
    reasons.push(fail('MATH_PROFILE_ID_INVALID', String(mathProfileId), 'a profile identifier'));
  }
  const gameId = input.gameId;
  if (typeof gameId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(gameId)) {
    reasons.push(fail('GAME_ID_INVALID', String(gameId), 'a lowercase game identifier'));
  }
  const mathProfileHash = input.mathProfileHash;
  if (typeof mathProfileHash !== 'string' || !/^[0-9a-f]{64}$/.test(mathProfileHash)) {
    reasons.push(fail('MATH_PROFILE_HASH_INVALID', String(mathProfileHash), 'a 64-character hex hash'));
  }
  if (input.maxWinScope !== 'RESOLVED_SPIN') {
    reasons.push(fail(
      'DISTRIBUTION_SCOPE_INVALID',
      String(input.maxWinScope),
      'RESOLVED_SPIN',
      'A class distribution is only defined against the per-resolution max-win scope.',
    ));
  }
  const maxWinMultiplier = input.maxWinMultiplier;
  if (!Number.isFinite(maxWinMultiplier) || (maxWinMultiplier as number) <= 0) {
    reasons.push(fail('MAX_WIN_INVALID', String(maxWinMultiplier), 'a positive finite ceiling'));
  }
  const maxBandMin = input.maxBandMin;
  if (!Number.isFinite(maxBandMin) || (maxBandMin as number) < MAX_BAND_MIN_FLOOR) {
    reasons.push(fail(
      'MAX_BAND_MIN_INVALID',
      String(maxBandMin),
      `>= ${MAX_BAND_MIN_FLOOR}`,
      'The BIG/MAX boundary is immutable and may not be lowered into the MEDIUM band.',
    ));
  }
  const granularity = input.granularity;
  if (!Number.isSafeInteger(granularity) || (granularity as number) < 1 || (granularity as number) > MAX_GRANULARITY) {
    reasons.push(fail('GRANULARITY_INVALID', String(granularity), `integer 1..${MAX_GRANULARITY}`));
  }

  const weightsRaw = input.weights;
  const weights: Partial<DistributionWeights> = {};
  if (!weightsRaw || typeof weightsRaw !== 'object' || Array.isArray(weightsRaw)) {
    reasons.push(fail('WEIGHTS_INVALID', String(weightsRaw), 'one exact integer weight per class'));
  } else {
    const supplied = weightsRaw as Record<string, unknown>;
    for (const key of Object.keys(supplied)) {
      if (!WEIGHT_KEYS.has(key)) {
        reasons.push(fail('WEIGHT_CLASS_UNKNOWN', key, DISTRIBUTION_CLASSES.join(', ')));
      }
    }
    for (const cls of DISTRIBUTION_CLASSES) {
      const value = supplied[cls];
      if (value === undefined) {
        reasons.push(fail('WEIGHT_MISSING', cls, 'an explicit weight (zero is written as 0)'));
        continue;
      }
      if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > MAX_GRANULARITY) {
        reasons.push(fail('WEIGHT_INVALID', `${cls}=${String(value)}`, `integer 0..${MAX_GRANULARITY}`));
        continue;
      }
      weights[cls] = value as number;
    }
  }

  if (reasons.length === 0) {
    const complete = weights as DistributionWeights;
    const total = DISTRIBUTION_CLASSES.reduce((sum, cls) => sum + BigInt(complete[cls]), 0n);
    if (total !== BigInt(granularity as number)) {
      reasons.push(fail(
        'WEIGHTS_TOTAL_INVALID',
        total.toString(),
        BigInt(granularity as number).toString(),
        'The class weights must total exactly 100% of the stated granularity.',
      ));
    }
    if (Number.isFinite(maxWinMultiplier) && Number.isFinite(maxBandMin) && Number.isFinite(granularity)) {
      const bounds = { maxBandMin: maxBandMin as number, maxWinMultiplier: maxWinMultiplier as number };
      // A ceiling below `maxBandMin` is allowed: the high bands simply become
      // unreachable, which the weight check below enforces. The boundary itself
      // is never lowered.
      for (const cls of unreachableClasses(bounds)) {
        if ((complete[cls] ?? 0) > 0) {
          reasons.push(fail(
            'CLASS_UNREACHABLE_UNDER_CAP',
            `${cls}=${complete[cls]}`,
            `${cls}=0`,
            `A ${bounds.maxWinMultiplier}x per-resolution ceiling cannot reach ${cls}; the band is made unreachable rather than overlapped.`,
          ));
        }
      }
    }
  }

  if (reasons.length > 0) return { ok: false, reasons };
  return {
    ok: true,
    policy: {
      policyId: policyId as string,
      version: version as number,
      gameId: gameId as string,
      mathProfileId: mathProfileId as string,
      mathProfileHash: mathProfileHash as string,
      maxWinScope: 'RESOLVED_SPIN',
      maxWinMultiplier: maxWinMultiplier as number,
      granularity: granularity as number,
      maxBandMin: maxBandMin as number,
      weights: weights as DistributionWeights,
    },
  };
}

function fail(
  constraint: string,
  requested: string,
  achievable: string,
  detail = 'The distribution policy was rejected.',
): ConstraintReason {
  return { constraint, requested, achievable, detail };
}

/**
 * Immutable canonical identity.
 *
 * Binds the policy id and version to the exact mathematics (profile id + hash),
 * the RESOLVED_SPIN ceiling, the class bounds and the exact weights. Nothing
 * about a player, a session, a balance or a seed can enter it.
 */
export function distributionPolicyHash(policy: DistributionPolicy): string {
  return sha256Hex(canonicalJson({
    schemaVersion: 1,
    policyId: policy.policyId,
    version: policy.version,
    gameId: policy.gameId,
    mathProfileId: policy.mathProfileId,
    mathProfileHash: policy.mathProfileHash,
    maxWinScope: policy.maxWinScope,
    maxWinMultiplier: policy.maxWinMultiplier,
    granularity: policy.granularity,
    maxBandMin: policy.maxBandMin,
    weights: DISTRIBUTION_CLASSES.map((cls) => [cls, policy.weights[cls]]),
  }));
}

/** Exact class probability in units of the granularity. */
export function classWeight(policy: DistributionPolicy, cls: DistributionClass): number {
  return policy.weights[cls];
}

/** Exact class probability as a rational. */
export function classProbability(policy: DistributionPolicy, cls: DistributionClass): BigRational {
  return bigRational(BigInt(policy.weights[cls]), BigInt(policy.granularity));
}

/** A source of unbiased integers in `[0, mass)`. */
export type MassSelector = { nextBelow: (mass: bigint) => bigint };

/**
 * Production selector: the OS CSPRNG through `crypto.randomInt`, which is
 * unbiased and never seedable from a request. The optional parameter exists for
 * tests only; nothing in the HTTP surface can supply it.
 */
export function createCryptoMassSelector(
  draw: (maxExclusive: number) => number = (maxExclusive) => randomInt(maxExclusive),
): MassSelector {
  return {
    nextBelow(mass: bigint) {
      if (mass <= 0n) throw new Error('DISTRIBUTION_MASS_INVALID');
      if (mass === 1n) return 0n;
      // Rejection over a power-of-two window: only the random draw can be
      // rejected, never a game outcome. `crypto.randomInt` is unbiased and
      // supports up to 2^48, so wider masses are drawn 48 bits at a time.
      const bits = BigInt(mass.toString(2).length);
      for (;;) {
        let value = 0n;
        let taken = 0n;
        while (taken < bits) {
          const chunk = bits - taken > CRYPTO_CHUNK_BITS ? CRYPTO_CHUNK_BITS : bits - taken;
          const size = Number(chunk);
          value = (value << chunk) + BigInt(draw(Math.min(2 ** size, CRYPTO_RANDOM_INT_MAX_EXCLUSIVE)));
          taken += BigInt(chunk);
        }
        if (value < mass) return value;
      }
    },
  };
}

/**
 * Deterministic selector for tests and reproducibility harnesses.
 *
 * It is deliberately a separate factory: production code paths never accept a
 * seed, and the HTTP surface has no way to construct one.
 */
export function createDeterministicMassSelector(seed: bigint): MassSelector {
  let state = seed | 1n;
  const next48 = () => {
    state = (state * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
    return (state >> 16n) & ((1n << 48n) - 1n);
  };
  const nextBelowBits = (bits: number) => {
    const mask = (1n << BigInt(bits)) - 1n;
    let value = 0n;
    let taken = 0;
    while (taken < bits) {
      const chunk = Math.min(48, bits - taken);
      value = (value << BigInt(chunk)) | (next48() & ((1n << BigInt(chunk)) - 1n));
      taken += chunk;
    }
    return value & mask;
  };
  return {
    nextBelow(mass: bigint) {
      if (mass <= 0n) throw new Error('DISTRIBUTION_MASS_INVALID');
      if (mass === 1n) return 0n;
      // Masses can exceed 2^48 (a five-reel weight product does), so the draw
      // is assembled from 48-bit chunks and only the *random* value is retried.
      const bits = mass.toString(2).length;
      for (;;) {
        const value = nextBelowBits(bits);
        if (value < mass) return value;
      }
    },
  };
}

/** Select a class from the policy's exact integer weights. */
export function selectDistributionClass(policy: DistributionPolicy, selector: MassSelector): DistributionClass {
  let target = selector.nextBelow(BigInt(policy.granularity));
  for (const cls of DISTRIBUTION_CLASSES) {
    const weight = BigInt(policy.weights[cls]);
    if (target < weight) return cls;
    target -= weight;
  }
  throw new Error('DISTRIBUTION_CLASS_SELECTION_FAILED');
}

/** Select an index from exact non-negative integer masses. */
export function selectByMass(masses: readonly bigint[], selector: MassSelector): number {
  let total = 0n;
  for (const mass of masses) total += mass;
  if (total <= 0n) throw new Error('DISTRIBUTION_MASS_TOTAL_INVALID');
  let target = selector.nextBelow(total);
  for (let index = 0; index < masses.length; index += 1) {
    if (target < masses[index]) return index;
    target -= masses[index];
  }
  throw new Error('DISTRIBUTION_MASS_SELECTION_FAILED');
}

export type DistributionEvResult =
  | { ok: true; ev: BigRational }
  | { ok: false; reasons: ConstraintReason[] };

/**
 * Expected value of the policy: sum over classes of the exact class probability
 * times the class's actual conditional payout expectation. A class with a
 * positive weight and no known conditional expectation is refused - never
 * assumed.
 */
export function calculateDistributionEv(
  policy: DistributionPolicy,
  conditionalEv: Partial<Record<DistributionClass, BigRational>>,
  unknown: Partial<Record<DistributionClass, string>> = {},
): DistributionEvResult {
  const reasons: ConstraintReason[] = [];
  let numerator = 0n;
  let denominator = 1n;
  for (const cls of DISTRIBUTION_CLASSES) {
    if (policy.weights[cls] === 0) continue;
    const value = conditionalEv[cls];
    if (!value) {
      reasons.push(fail(
        'CLASS_EV_UNKNOWN',
        `${cls}=${policy.weights[cls]}`,
        'a proved conditional payout expectation',
        unknown[cls] ?? 'The class has a positive weight but no computed conditional expectation.',
      ));
      continue;
    }
    const term = bigRational(BigInt(policy.weights[cls]) * value.numerator, BigInt(policy.granularity) * value.denominator);
    numerator = numerator * term.denominator + term.numerator * denominator;
    denominator *= term.denominator;
  }
  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, ev: bigRational(numerator, denominator) };
}
