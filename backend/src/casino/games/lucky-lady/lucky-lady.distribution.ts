import { LUCKY_LADY_GAME_ID, loadVerifiedMath } from './lucky-lady.math';
import { analyzeProfileExact, enumerateBoardOutcomes, type LlProfilePayload } from './lucky-lady.exact';
import { resolvedSpinMaximums } from './lucky-lady.math-adapter';
import { bigRational, bigRationalToDecimalString, type BigRational } from '../../platform/math-control/math-control.rational';
import {
  DISTRIBUTION_CLASSES,
  calculateDistributionEv,
  classProbability,
  distributionPolicyHash,
  ordinaryClassForMultiplier,
  selectByMass,
  selectDistributionClass,
  validateDistributionPolicy,
  type DistributionClass,
  type DistributionPolicy,
  type MassSelector,
} from '../../platform/math-control/payout-distribution';
import type { ConstraintReason } from '../../platform/math-control/math-control.types';

/**
 * Lucky Lady's contribution to the global payout distribution core.
 *
 * The reachable support is enumerated with the accepted evaluator over the
 * profile's real pre-draw weights; each reachable board is classified with the
 * canonical Model A boundaries, and every conditional expectation (including
 * the whole feature chain behind a trigger) is computed exactly from that same
 * enumeration. Unsupported, too-large or unprovable supports are refused rather
 * than approximated, and selection never rejects or truncates an outcome.
 */

export type DistributionIdentity = {
  profileId: string;
  profileHash: string;
  payload: LlProfilePayload;
};

/**
 * Lucky Lady's own trigger rule: a paid board awards the feature at three or
 * more scatters. It belongs to the game, not to the shared distribution core.
 */
export const LUCKY_LADY_FEATURE_TRIGGER_SCATTERS = 3;

/** Deep copy + freeze so a published policy, hash or proof cannot be mutated. */
function deepFrozen<T>(value: T): T {
  const copy = structuredClone(value) as T;
  const freeze = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    for (const child of Object.values(node as Record<string, unknown>)) freeze(child);
    Object.freeze(node);
  };
  freeze(copy);
  return copy;
}

export type ClassMember = { stops: number[]; weight: bigint };

export type ClassSupport = {
  class: DistributionClass;
  policyWeight: number;
  probabilityExact: string;
  boardMass: bigint;
  members: number;
  conditionalPaidEv: BigRational | null;
  conditionalFeatureEv: BigRational | null;
  conditionalEv: BigRational | null;
  unknownReason?: string;
};

export type DistributionSupport = {
  policy: DistributionPolicy;
  policyHash: string;
  reachableBoards: number;
  totalBoardMass: bigint;
  classes: ClassSupport[];
  ev: BigRational;
  evDecimal: string;
  triggerProbabilityExact: BigRational;
  /** Per-resolution maxima proved for this profile under the policy ceiling. */
  maxWin: { paidSpinMax: number; freeSpinMax: number; resolvedSpinMax: number };
  /** Reachable members per class, kept so selection draws a prevalidated board. */
  membersByClass: Record<DistributionClass, ClassMember[]>;
};

export type DistributionSupportResult =
  | { ok: true; support: DistributionSupport }
  | { ok: false; reasons: ConstraintReason[] };

export function buildDistributionSupport(
  identity: DistributionIdentity,
  policy: DistributionPolicy,
  options: { maxBoards?: number } = {},
): DistributionSupportResult {
  const reasons: ConstraintReason[] = [];
  const { engine, rules } = loadVerifiedMath();
  const lines = rules.lines.length;
  const maxBoards = options.maxBoards ?? 4_096;

  // Entry validation: a direct call can never bypass the policy contract.
  const validated = validateDistributionPolicy(policy);
  if (!validated.ok) return { ok: false, reasons: validated.reasons };
  const boundPolicy = validated.policy;
  if (boundPolicy.gameId !== LUCKY_LADY_GAME_ID) {
    reasons.push(reason(
      'GAME_BINDING_MISMATCH',
      boundPolicy.gameId,
      LUCKY_LADY_GAME_ID,
      'A distribution policy is bound to one game; this adapter builds support only for its own.',
    ));
  }

  if (identity.profileId !== policy.mathProfileId || identity.profileHash !== policy.mathProfileHash) {
    reasons.push(reason(
      'MATH_PROFILE_MISMATCH',
      `${identity.profileId}/${identity.profileHash}`,
      `${policy.mathProfileId}/${policy.mathProfileHash}`,
      'A distribution policy may only select outcomes from the exact mathematics it names.',
    ));
  }

  let boards;
  let totalBoardMass = 0n;
  try {
    const enumerated = enumerateBoardOutcomes(rules, engine, identity.payload, maxBoards);
    boards = enumerated.boards;
    totalBoardMass = enumerated.totalWeight;
  } catch (error) {
    return {
      ok: false,
      reasons: [reason(
        'DISTRIBUTION_SUPPORT_TOO_LARGE',
        (error as Error).message,
        `an enumerable reachable support (<= ${maxBoards} boards)`,
        'The reachable outcome set could not be enumerated exactly, so no distribution is claimed for it.',
      )],
    };
  }

  const bounds = { maxBandMin: boundPolicy.maxBandMin, maxWinMultiplier: boundPolicy.maxWinMultiplier };
  const members = new Map<DistributionClass, ClassMember[]>();
  const mass = new Map<DistributionClass, bigint>();
  const paidUnits = new Map<DistributionClass, bigint>();
  for (const cls of DISTRIBUTION_CLASSES) {
    members.set(cls, []);
    mass.set(cls, 0n);
    paidUnits.set(cls, 0n);
  }
  let lineUnits = 0n;
  let freeSpinUnits = 0n;
  for (const board of boards) {
    const cls: DistributionClass = board.evaluation.scatterCount >= LUCKY_LADY_FEATURE_TRIGGER_SCATTERS
      ? 'FEATURE_TRIGGER'
      : ordinaryClassForMultiplier(board.evaluation.totalWin / lines, bounds);
    members.get(cls)!.push({ stops: [...board.stops], weight: board.weight });
    mass.set(cls, mass.get(cls)! + board.weight);
    paidUnits.set(cls, paidUnits.get(cls)! + board.weight * BigInt(board.evaluation.totalWin));
    lineUnits += board.weight * BigInt(board.evaluation.baseWin);
    // A free spin multiplies the line wins by the feature multiplier and pays
    // its scatter win unmultiplied, exactly as the engine does.
    freeSpinUnits += board.weight * (
      BigInt(rules.constants.slotFreeMpl) * BigInt(board.evaluation.baseWin) + BigInt(board.evaluation.scatterWin)
    );
  }

  // RESOLVED_SPIN proof first: no selection may exceed the ceiling.
  const analysis = analyzeProfileExact(rules, engine, identity.payload, maxBoards);
  const perSpin = resolvedSpinMaximums(analysis);
  if (perSpin.ceiling === null) {
    reasons.push(reason('RESOLVED_SPIN_UNPROVABLE', 'unprovable', `${boundPolicy.maxWinMultiplier}x`, perSpin.basis));
  } else if (perSpin.ceiling > boundPolicy.maxWinMultiplier) {
    reasons.push(reason(
      'RESOLVED_SPIN_EXCEEDS_CAP',
      `${perSpin.ceiling}x`,
      `${boundPolicy.maxWinMultiplier}x`,
      perSpin.basis,
    ));
  }

  if (totalBoardMass === 0n) {
    return { ok: false, reasons: [reason('DISTRIBUTION_SUPPORT_EMPTY', '0', '>= 1 reachable board')] };
  }

  const triggerMass = mass.get('FEATURE_TRIGGER')!;
  const triggerProbability = bigRational(triggerMass, totalBoardMass);
  const chainDiverges = triggerMass * BigInt(rules.constants.slotFreeCount) >= totalBoardMass;

  const conditionalEv: Partial<Record<DistributionClass, BigRational>> = {};
  const unknown: Partial<Record<DistributionClass, string>> = {};
  const classes: ClassSupport[] = [];
  for (const cls of DISTRIBUTION_CLASSES) {
    const classMass = mass.get(cls)!;
    const policyWeight = boundPolicy.weights[cls];
    const probability = classProbability(boundPolicy, cls);
    if (classMass === 0n) {
      if (policyWeight > 0) {
        reasons.push(reason(
          'DISTRIBUTION_CLASS_UNREACHABLE',
          `${cls}=${policyWeight}`,
          `${cls}=0`,
          'The class carries weight but no reachable outcome of this profile lands in it.',
        ));
        unknown[cls] = 'unreachable class';
      }
      classes.push({
        class: cls,
        policyWeight,
        probabilityExact: bigRationalToDecimalString(probability, 10),
        boardMass: 0n,
        members: 0,
        conditionalPaidEv: null,
        conditionalFeatureEv: null,
        conditionalEv: null,
        ...(policyWeight > 0 ? { unknownReason: 'unreachable class' } : {}),
      });
      continue;
    }

    const paidEv = bigRational(paidUnits.get(cls)!, classMass * BigInt(lines));
    let featureEv: BigRational | null = null;
    if (cls === 'FEATURE_TRIGGER') {
      if (chainDiverges) {
        unknown[cls] = 'the feature chain diverges: 15 x triggerProbability >= 1, so no finite feature EV exists';
      } else {
        const meanFreeSpinUnits = bigRational(freeSpinUnits, totalBoardMass);
        const expectedSpins = bigRational(
          BigInt(rules.constants.slotFreeCount) * totalBoardMass,
          totalBoardMass - BigInt(rules.constants.slotFreeCount) * triggerMass,
        );
        featureEv = bigRational(
          expectedSpins.numerator * meanFreeSpinUnits.numerator,
          expectedSpins.denominator * meanFreeSpinUnits.denominator * BigInt(lines),
        );
      }
    }

    const total = featureEv === null
      ? paidEv
      : bigRational(
          paidEv.numerator * featureEv.denominator + featureEv.numerator * paidEv.denominator,
          paidEv.denominator * featureEv.denominator,
        );
    if (cls === 'FEATURE_TRIGGER' && featureEv === null) unknown[cls] = unknown[cls] ?? 'feature EV unknown';
    else conditionalEv[cls] = total;

    classes.push({
      class: cls,
      policyWeight,
      probabilityExact: bigRationalToDecimalString(probability, 10),
      boardMass: classMass,
      members: members.get(cls)!.length,
      conditionalPaidEv: paidEv,
      conditionalFeatureEv: featureEv,
      conditionalEv: featureEv === null && cls === 'FEATURE_TRIGGER' ? null : total,
      ...(featureEv === null && cls === 'FEATURE_TRIGGER' ? { unknownReason: unknown[cls] } : {}),
    });
  }

  if (reasons.length > 0) return { ok: false, reasons };

  const evResult = calculateDistributionEv(boundPolicy, conditionalEv, unknown);
  if (!evResult.ok) return { ok: false, reasons: evResult.reasons };

  return {
    ok: true,
    support: deepFrozen({
      policy: deepFrozen(boundPolicy),
      policyHash: distributionPolicyHash(boundPolicy),
      reachableBoards: boards.length,
      totalBoardMass,
      classes,
      ev: evResult.ev,
      evDecimal: bigRationalToDecimalString(evResult.ev, 6),
      triggerProbabilityExact: triggerProbability,
      maxWin: {
        paidSpinMax: perSpin.paid,
        freeSpinMax: perSpin.free ?? 0,
        resolvedSpinMax: perSpin.ceiling ?? 0,
      },
      membersByClass: Object.fromEntries(
        DISTRIBUTION_CLASSES.map((cls) => [cls, members.get(cls)!]),
      ) as Record<DistributionClass, ClassMember[]>,
    }),
  };
}

/**
 * Select one pre-validated outcome.
 *
 * The class is drawn from the policy's exact integer weights and the board from
 * the class's real pre-draw masses, so the selected outcome is already inside
 * the proved support: nothing is rejected, truncated or redrawn afterwards.
 */
export function selectDistributionOutcome(
  support: DistributionSupport,
  selector: MassSelector,
): { class: DistributionClass; stops: number[]; weight: bigint } {
  const cls = selectDistributionClass(support.policy, selector);
  const members = support.membersByClass[cls];
  if (!members || members.length === 0) {
    throw new Error(`DISTRIBUTION_CLASS_HAS_NO_MEMBERS: ${cls}`);
  }
  const index = selectByMass(members.map((member) => member.weight), selector);
  const member = members[index];
  return { class: cls, stops: [...member.stops], weight: member.weight };
}

/**
 * The exact draw values that select the given reel stops under this profile.
 *
 * Used by the server-only RNG wrapper: only the initial paid board is forced,
 * and every later draw (free spins and retriggers) is delegated to the original
 * generator and the same profile.
 */
export function forcedStopDraws(payload: LlProfilePayload, stops: readonly number[]): number[] {
  const { rules } = loadVerifiedMath();
  const strips = rules.reels as Record<string, string[]>;
  const reelKeys = Object.keys(strips).sort(
    (a, b) => Number(a.replace('reelStrip', '')) - Number(b.replace('reelStrip', '')),
  );
  return reelKeys.map((key, index) => {
    const supplied = payload.stopWeights?.[key];
    const stopCount = (payload.strips?.[key] ?? strips[key]).length - 2;
    const weights = supplied ?? new Array(stopCount).fill(1);
    if (weights.length !== stopCount) throw new Error(`FORCED_DRAW_WEIGHT_LENGTH: ${key}`);
    let before = 0;
    for (let position = 0; position < stops[index]; position += 1) before += weights[position];
    if (weights[stops[index]] <= 0) throw new Error(`FORCED_DRAW_UNREACHABLE_STOP: ${key}#${stops[index]}`);
    return before + 1;
  });
}

/**
 * Wrap a generator so the first five draws select the chosen paid board and
 * every subsequent draw comes from the original generator.
 */
export function withForcedInitialStops<T extends { int: (min: number, max: number) => number }>(
  base: T,
  payload: LlProfilePayload,
  stops: readonly number[],
): T {
  const forced = forcedStopDraws(payload, stops);
  let cursor = 0;
  return {
    ...base,
    int(min: number, max: number) {
      if (cursor < forced.length) {
        const value = forced[cursor];
        cursor += 1;
        if (value < min || value > max) {
          throw new Error(`FORCED_DRAW_OUT_OF_RANGE: ${value} outside ${min}..${max}`);
        }
        return value;
      }
      return base.int(min, max);
    },
  };
}

function reason(
  constraint: string,
  requested: string,
  achievable: string,
  detail = 'The distribution policy was rejected for this mathematics.',
): ConstraintReason {
  return { constraint, requested, achievable, detail };
}
