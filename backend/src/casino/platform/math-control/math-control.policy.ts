import {
  MAX_WIN_SCOPES,
  PACING_MODES,
  RETURN_TIERS,
  type ConstraintReason,
  type HitRatePolicy,
  type MathPolicy,
  type PacingMode,
  type PolicyValidationResult,
  type ReturnTier,
} from './math-control.types';

/**
 * Bounded policy validation and preset defaults.
 *
 * Two rules matter more than any individual bound:
 *
 *  1. The accepted shape is a *whitelist*. An attempt to smuggle `userId`,
 *     `actorId`, `role`, `balance`, `history`, `seed` or anything else that is
 *     not control-plane policy is rejected outright rather than ignored.
 *  2. A preset supplies defaults only. Every value the operator states
 *     explicitly wins over the preset, and the merge order is fixed so the same
 *     request always produces the same policy.
 */

export type MathPresetName =
  | 'BALANCED'
  | 'RETENTION'
  | 'RECYCLE'
  | 'VOLATILE';

export const MATH_PRESETS: Record<MathPresetName, Partial<Omit<MathPolicy, 'gameId' | 'presets'>>> = {
  BALANCED: {
    pacing: 'BALANCED',
    hitRate: { mode: 'AUTO' },
    partialReturn: 'MED',
    volatility: 'MED',
    bigWinMinMultiplier: 10,
    bigWinMaxMultiplier: 50,
    featureContribution: { minPercent: 0, maxPercent: 60 },
    maxWinMultiplier: 50,
    maxWinScope: 'PAID_ROUND_BEFORE_OPTIONAL_GAMBLE',
  },
  RETENTION: {
    pacing: 'RETENTION',
    hitRate: { mode: 'RANGE', min: 0.35, max: 0.75 },
    partialReturn: 'HIGH',
    volatility: 'LOW',
    bigWinMinMultiplier: 10,
    bigWinMaxMultiplier: 50,
    featureContribution: { minPercent: 0, maxPercent: 40 },
    maxWinMultiplier: 50,
    maxWinScope: 'PAID_ROUND_BEFORE_OPTIONAL_GAMBLE',
  },
  RECYCLE: {
    pacing: 'RECYCLE',
    hitRate: { mode: 'RANGE', min: 0.05, max: 0.35 },
    partialReturn: 'LOW',
    volatility: 'HIGH',
    bigWinMinMultiplier: 12,
    bigWinMaxMultiplier: 100,
    featureContribution: { minPercent: 20, maxPercent: 80 },
    maxWinMultiplier: 100,
    maxWinScope: 'PAID_ROUND_BEFORE_OPTIONAL_GAMBLE',
  },
  VOLATILE: {
    pacing: 'VOLATILE',
    hitRate: { mode: 'RANGE', min: 0.02, max: 0.25 },
    partialReturn: 'LOW',
    volatility: 'HIGH',
    bigWinMinMultiplier: 20,
    bigWinMaxMultiplier: 250,
    featureContribution: { minPercent: 20, maxPercent: 90 },
    maxWinMultiplier: 250,
    maxWinScope: 'PAID_ROUND_BEFORE_OPTIONAL_GAMBLE',
  },
};

export const PRESET_NAMES = Object.keys(MATH_PRESETS) as MathPresetName[];

const POLICY_KEYS = new Set([
  'gameId',
  'targetRtpPercent',
  'maxWinMultiplier',
  'maxWinScope',
  // Explicit max-win metadata. It is transported verbatim: absence stays
  // absence (legacy semantics and hash), a boolean is preserved, anything else
  // is rejected rather than coerced.
  'maxWinEnabled',
  'pacing',
  'customPacing',
  'hitRate',
  'partialReturn',
  'volatility',
  'bigWinMinMultiplier',
  'bigWinMaxMultiplier',
  'featureContribution',
  'presets',
]);

/** Nested shapes are whitelisted too: a smuggled field is rejected, not ignored. */
const NESTED_KEYS: Record<string, Set<string>> = {
  customPacing: new Set(['zeroWeight', 'partialWeight', 'breakEvenWeight', 'winWeight']),
  hitRate: new Set(['mode', 'target', 'min', 'max']),
  featureContribution: new Set(['minPercent', 'maxPercent']),
};

function unknownNestedKeys(value: unknown, keys: Set<string>, label: string): ConstraintReason[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>)
    .filter((key) => !keys.has(key))
    .map((key) => ({
      constraint: 'UNKNOWN_FIELD',
      requested: `${label}.${key}`,
      achievable: `only ${[...keys].join(', ')}`,
      detail: `Field "${label}.${key}" is not part of the generation policy and is rejected rather than ignored.`,
    }));
}

const MAX_MULTIPLIER = 1_000_000_000;
const MAX_TOTAL_WEIGHT = 1_000_000;

type RawPolicy = Record<string, unknown>;

function failAll(errors: ConstraintReason[]): PolicyValidationResult {
  return { ok: false, errors };
}

/**
 * Merge presets and explicit values without ever letting a default win.
 *
 * Explicit values are read first; a preset only fills what is absent.
 */
export function applyPresets(raw: RawPolicy): { merged: RawPolicy; applied: MathPresetName[] } {
  const requested = Array.isArray(raw.presets) ? (raw.presets as unknown[]) : [];
  const applied: MathPresetName[] = [];
  const merged: RawPolicy = {};
  for (const name of requested) {
    if (typeof name !== 'string' || !(name in MATH_PRESETS)) continue;
    const preset = MATH_PRESETS[name as MathPresetName];
    applied.push(name as MathPresetName);
    for (const [key, value] of Object.entries(preset)) {
      if (merged[key] === undefined) merged[key] = value;
    }
  }
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'presets') continue;
    if (value !== undefined) merged[key] = value;
  }
  merged.presets = applied;
  return { merged, applied };
}

/** Validate and normalise a generation request. */
export function validatePolicy(input: RawPolicy): PolicyValidationResult {
  const unknown = Object.keys(input).filter((key) => !POLICY_KEYS.has(key));
  if (unknown.length > 0) {
    return failAll(
      unknown.map((key) => ({
        constraint: 'UNKNOWN_FIELD',
        requested: key,
        achievable: 'a bounded policy document',
        detail:
          `Field "${key}" is not part of the generation policy. Generation input is policy and game ` +
          'maths only: no user, session, wallet, balance, history, round or seed value is accepted.',
      })),
    );
  }

  const { merged, applied } = applyPresets(input);
  const errors: ConstraintReason[] = [];

  // Preset names are a closed set: an unknown name is refused, never dropped.
  const requestedPresets = Array.isArray(input.presets) ? (input.presets as unknown[]) : [];
  for (const name of requestedPresets) {
    if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(MATH_PRESETS, name)) {
      errors.push({
        constraint: 'PRESET_UNKNOWN',
        requested: String(name),
        achievable: PRESET_NAMES.join(', '),
        detail: 'Presets supply defaults only, and only known preset names are accepted.',
      });
    }
  }

  errors.push(...unknownNestedKeys(merged.customPacing, NESTED_KEYS.customPacing, 'customPacing'));
  errors.push(...unknownNestedKeys(merged.hitRate, NESTED_KEYS.hitRate, 'hitRate'));
  errors.push(...unknownNestedKeys(merged.featureContribution, NESTED_KEYS.featureContribution, 'featureContribution'));
  errors.push(...hitRateShapeErrors(merged.hitRate));

  const gameId = merged.gameId;
  if (typeof gameId !== 'string' || gameId.length === 0 || gameId.length > 64 || !/^[a-z0-9-]+$/.test(gameId)) {
    errors.push({
      constraint: 'GAME_ID_INVALID',
      requested: String(gameId),
      achievable: 'a lowercase registry id',
      detail: 'The game must be a known registry id consisting of lowercase letters, digits and dashes.',
    });
  }

  const target = merged.targetRtpPercent;
  if (typeof target !== 'number' || !Number.isFinite(target) || target < 0 || target > 100) {
    errors.push({
      constraint: 'TARGET_RTP_OUT_OF_RANGE',
      requested: String(target),
      achievable: '0..100 percent',
      detail: 'Target return is requested in percent and must be between 0 and 100 inclusive.',
    });
  }

  const maxWin = merged.maxWinMultiplier;
  if (typeof maxWin !== 'number' || !Number.isFinite(maxWin) || maxWin < 1 || maxWin > MAX_MULTIPLIER) {
    errors.push({
      constraint: 'MAX_WIN_OUT_OF_RANGE',
      requested: String(maxWin),
      achievable: `1..${MAX_MULTIPLIER} stake multiples`,
      detail: 'The advertised maximum win ceiling must be a finite stake multiple of at least 1.',
    });
  }

  const scope = merged.maxWinScope;
  if (typeof scope !== 'string' || !(MAX_WIN_SCOPES as readonly string[]).includes(scope)) {
    errors.push({
      constraint: 'MAX_WIN_SCOPE_INVALID',
      requested: String(scope),
      achievable: MAX_WIN_SCOPES.join(', '),
      detail:
        'The ceiling must state what it covers. A game with an unbounded optional gamble cannot honestly ' +
        'advertise a total-return ceiling.',
    });
  }

  // Max-win metadata: absent stays absent; a present value must be a boolean.
  if (merged.maxWinEnabled !== undefined && typeof merged.maxWinEnabled !== 'boolean') {
    errors.push({
      constraint: 'MAX_WIN_ENABLED_INVALID',
      requested: JSON.stringify(merged.maxWinEnabled),
      achievable: 'true, false, or the field omitted',
      detail: 'maxWinEnabled is explicit metadata: it is never coerced from a string or a number.',
    });
  }

  const pacing = merged.pacing;
  if (typeof pacing !== 'string' || !(PACING_MODES as readonly string[]).includes(pacing)) {
    errors.push({
      constraint: 'PACING_INVALID',
      requested: String(pacing),
      achievable: PACING_MODES.join(', '),
      detail: 'Pacing selects a pre-draw distribution shape; it never schedules or targets an outcome.',
    });
  }

  const custom = merged.customPacing ?? null;
  if (pacing === 'CUSTOM') {
    if (!custom || typeof custom !== 'object') {
      errors.push({
        constraint: 'CUSTOM_PACING_REQUIRED',
        requested: 'none',
        achievable: 'zero/partial/break-even/win weights',
        detail: 'Custom pacing requires explicit relative weights for each payout class.',
      });
    } else {
      const weights = custom as Record<string, unknown>;
      const keys = ['zeroWeight', 'partialWeight', 'breakEvenWeight', 'winWeight'];
      let total = 0;
      let valid = true;
      for (const key of keys) {
        const value = weights[key];
        if (
          typeof value !== 'number' || !Number.isSafeInteger(value) ||
          value < 0 || value > MAX_TOTAL_WEIGHT
        ) {
          valid = false;
          errors.push({
            constraint: 'CUSTOM_PACING_WEIGHT_INVALID',
            requested: `${key}=${String(value)}`,
            achievable: `integer 0..${MAX_TOTAL_WEIGHT}`,
            detail: 'Custom pacing weights are bounded non-negative integers; fractions are refused rather than rounded.',
          });
        } else {
          total += value;
        }
      }
      if (total > MAX_TOTAL_WEIGHT * keys.length) {
        errors.push({
          constraint: 'CUSTOM_PACING_TOTAL_INVALID',
          requested: String(total),
          achievable: `at most ${MAX_TOTAL_WEIGHT * keys.length}`,
          detail: 'The custom pacing weights must stay inside the bounded integer range.',
        });
      }
      if (valid && total <= 0) {
        errors.push({
          constraint: 'CUSTOM_PACING_ALL_ZERO',
          requested: '0,0,0,0',
          achievable: 'at least one positive weight',
          detail: 'Custom pacing must leave at least one payout class reachable.',
        });
      }
    }
  } else if (custom !== null && custom !== undefined) {
    errors.push({
      constraint: 'CUSTOM_PACING_NOT_APPLICABLE',
      requested: String(pacing),
      achievable: 'customPacing omitted unless pacing is CUSTOM',
      detail: 'Custom weights are only meaningful when pacing is CUSTOM.',
    });
  }

  const hitRate = merged.hitRate;
  if (!isValidHitRate(hitRate)) {
    errors.push({
      constraint: 'HIT_RATE_INVALID',
      requested: JSON.stringify(hitRate ?? null),
      achievable: '{mode:AUTO} | {mode:EXPLICIT,target:0..1} | {mode:RANGE,min,max:0..1}',
      detail: 'AUTO leaves the hit rate free; EXPLICIT and RANGE state a bounded target in 0..1.',
    });
  }

  const tierChecks: Array<[string, string, string]> = [
    ['partialReturn', 'PARTIAL_RETURN_INVALID', 'partial return'],
    ['volatility', 'VOLATILITY_INVALID', 'volatility'],
  ];
  for (const [key, constraint, label] of tierChecks) {
    const value = merged[key];
    if (typeof value !== 'string' || !(RETURN_TIERS as readonly string[]).includes(value)) {
      errors.push({
        constraint,
        requested: String(value),
        achievable: RETURN_TIERS.join(', '),
        detail: `${label} must be one of LOW, MED or HIGH.`,
      });
    }
  }

  const bigMin = merged.bigWinMinMultiplier;
  const bigMax = merged.bigWinMaxMultiplier;
  if (
    typeof bigMin !== 'number' || typeof bigMax !== 'number' ||
    !Number.isFinite(bigMin) || !Number.isFinite(bigMax) ||
    bigMin < 1 || bigMax > MAX_MULTIPLIER || bigMax < bigMin
  ) {
    errors.push({
      constraint: 'BIG_WIN_BOUNDS_INVALID',
      requested: `${String(bigMin)}..${String(bigMax)}`,
      achievable: `1 <= min <= max <= ${MAX_MULTIPLIER}`,
      detail: 'The big-win band must be a finite, ordered multiplier window above 1x.',
    });
  }

  const contribution = merged.featureContribution;
  if (!contribution || typeof contribution !== 'object') {
    errors.push({
      constraint: 'FEATURE_CONTRIBUTION_INVALID',
      requested: String(contribution),
      achievable: '{minPercent:0..100, maxPercent:minPercent..100}',
      detail: 'Feature contribution states how much of total return must come from feature play.',
    });
  } else {
    const { minPercent, maxPercent } = contribution as Record<string, unknown>;
    if (
      typeof minPercent !== 'number' || typeof maxPercent !== 'number' ||
      !Number.isFinite(minPercent) || !Number.isFinite(maxPercent) ||
      minPercent < 0 || maxPercent > 100 || maxPercent < minPercent
    ) {
      errors.push({
        constraint: 'FEATURE_CONTRIBUTION_INVALID',
        requested: JSON.stringify(contribution),
        achievable: '0 <= minPercent <= maxPercent <= 100',
        detail: 'Feature contribution bands are percentages of total return.',
      });
    }
  }

  const presets = merged.presets;
  if (
    !Array.isArray(presets) || presets.length > 8 ||
    presets.some((name) => typeof name !== 'string') ||
    new Set(presets).size !== presets.length
  ) {
    errors.push({
      constraint: 'PRESETS_INVALID',
      requested: JSON.stringify(presets ?? null),
      achievable: `up to 8 unique names from ${PRESET_NAMES.join(', ')}`,
      detail: 'Presets supply defaults only and must be a bounded, unique list of known names.',
    });
  }

  if (errors.length > 0) return failAll(errors);

  return {
    ok: true,
    appliedPresets: applied,
    policy: {
      gameId: gameId as string,
      targetRtpPercent: target as number,
      maxWinMultiplier: maxWin as number,
      maxWinScope: scope as MathPolicy['maxWinScope'],
      ...(merged.maxWinEnabled === undefined ? {} : { maxWinEnabled: merged.maxWinEnabled as boolean }),
      pacing: pacing as PacingMode,
      customPacing: pacing === 'CUSTOM' ? (custom as MathPolicy['customPacing']) : null,
      hitRate: hitRate as HitRatePolicy,
      partialReturn: merged.partialReturn as ReturnTier,
      volatility: merged.volatility as ReturnTier,
      bigWinMinMultiplier: bigMin as number,
      bigWinMaxMultiplier: bigMax as number,
      featureContribution: {
        minPercent: (contribution as { minPercent: number }).minPercent,
        maxPercent: (contribution as { maxPercent: number }).maxPercent,
      },
      presets: [...(presets as string[])],
    },
  };
}

function isValidHitRate(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.mode === 'AUTO') return true;
  if (candidate.mode === 'EXPLICIT') {
    const target = candidate.target;
    return typeof target === 'number' && Number.isFinite(target) && target >= 0 && target <= 1;
  }
  if (candidate.mode === 'RANGE') {
    const { min, max } = candidate;
    return (
      typeof min === 'number' && typeof max === 'number' &&
      Number.isFinite(min) && Number.isFinite(max) &&
      min >= 0 && max <= 1 && max >= min
    );
  }
  return false;
}

/** Contradictory hit-rate fields: one mode may only carry its own fields. */
function hitRateShapeErrors(value: unknown): ConstraintReason[] {
  if (!value || typeof value !== 'object') return [];
  const candidate = value as Record<string, unknown>;
  const errors: ConstraintReason[] = [];
  const reject = (field: string, mode: string) => errors.push({
    constraint: 'HIT_RATE_FIELD_CONTRADICTS_MODE',
    requested: `${mode} with ${field}`,
    achievable: 'only the fields the selected mode defines',
    detail: `Field "${field}" is not meaningful for hit-rate mode ${mode}.`,
  });
  if (candidate.mode === 'AUTO') {
    if (candidate.target !== undefined || candidate.min !== undefined || candidate.max !== undefined) {
      reject('target/min/max', 'AUTO');
    }
  } else if (candidate.mode === 'EXPLICIT') {
    if (candidate.min !== undefined || candidate.max !== undefined) reject('min/max', 'EXPLICIT');
  } else if (candidate.mode === 'RANGE') {
    if (candidate.target !== undefined) reject('target', 'RANGE');
  }
  return errors;
}
