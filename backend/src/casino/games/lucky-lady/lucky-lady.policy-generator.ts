import { canonicalProfileHash } from '../../platform/math-control/math-control.analytics';
import {
  DISTRIBUTION_CLASSES,
  distributionPolicyHash,
  validateDistributionPolicy,
  type DistributionClass,
  type DistributionPolicy,
  type DistributionWeights,
} from '../../platform/math-control/payout-distribution';
import {
  assembleDistributionPolicy,
  checksPass,
  fractionToGridUnits,
  generatorChecks,
  generatorRequestHash,
  policyWeightsSum,
  SOLVER_VERSION,
  solvePayoutPolicyWeights,
  validateGeneratorRequest,
  type GeneratorModelMetadata,
  type GeneratorObjective,
  type NormalizedGeneratorRequest,
} from '../../platform/math-control/payout-policy-generator';
import {
  runPolicyBankroll,
  type PolicyBankrollReport,
  type PolicyRoundObservation,
} from '../../platform/math-control/payout-policy-bankroll';
import type {
  ConstraintReason,
  MathCheck,
  MathProfileArtifact,
  SessionConfig,
} from '../../platform/math-control/math-control.types';
import { buildDistributionSupport, type DistributionSupport } from './lucky-lady.distribution';
import { luckyLadyPolicySessionFactory } from './lucky-lady.distribution-session';
import { analyzeProfileExact, type LlProfilePayload } from './lucky-lady.exact';
import { loadVerifiedMath, type RulesTable } from './lucky-lady.math';

/**
 * Lucky Lady's contribution to the automatic payout-policy generator.
 *
 * The shared solver is game-agnostic; this file declares the *bounded Lucky
 * Lady generator model* it solves over, derives each class's exact conditional
 * expectation from the accepted support builder, and runs the resulting policy
 * through the accepted bankroll simulator.
 *
 * The declared model is deliberately NOT the accepted golden dense RTP50
 * profile: that profile's pre-draw weights cover every stop of every reel, so a
 * bounded exact enumeration cannot represent it (the evidence run records that
 * refusal verbatim). This model is a small, fully enumerable sparse profile
 * whose every reachable paid and free resolution stays inside a 50x
 * per-resolution ceiling and whose feature chain is subcritical.
 */

export const LUCKY_LADY_GENERATOR_MODEL_ID = 'lucky-lady.model.bounded-generator.v1';
/** Documented ceiling the model is declared and proved against. */
export const LUCKY_LADY_GENERATOR_CAP = 50;
export const LUCKY_LADY_GENERATOR_MAX_BAND_MIN = 20;

/** Declared sparse stop weights: 108 reachable boards, all inside 50x. */
const MODEL_STOP_WEIGHTS: Record<string, ReadonlyArray<readonly [number, number]>> = {
  reelStrip1: [[63, 1], [67, 1_000], [119, 1]],
  reelStrip2: [[15, 1], [51, 1_000], [119, 1]],
  reelStrip3: [[13, 1], [57, 1], [102, 1_000]],
  reelStrip4: [[25, 1], [33, 1_000]],
  reelStrip5: [[29, 1], [33, 1_000]],
};

const reelKeysFor = (rules: RulesTable): string[] => {
  const strips = rules.reels as Record<string, string[]>;
  return Object.keys(strips).sort(
    (a, b) => Number(a.replace('reelStrip', '')) - Number(b.replace('reelStrip', '')),
  );
};

function modelPayload(rules: RulesTable, maxWinMultiplier: number): LlProfilePayload {
  const strips = rules.reels as Record<string, string[]>;
  const stopWeights: Record<string, number[]> = {};
  // Reuse the already proved loss/partial/small support for the smaller cap.
  // These are pre-draw reel weights, never a filter on generated payouts.
  const lowerCapBoards = [[120, 58, 23, 5, 116], [70, 119, 63, 118, 95], [38, 61, 49, 73, 122]];
  for (const [reelIndex, reelKey] of reelKeysFor(rules).entries()) {
    const weights = new Array(strips[reelKey].length - 2).fill(0);
    if (maxWinMultiplier === 20) {
      for (const board of lowerCapBoards) weights[board[reelIndex]] += 1;
    } else {
      for (const [stop, weight] of MODEL_STOP_WEIGHTS[reelKey] ?? []) weights[stop] += weight;
    }
    if (!weights.some((weight) => weight > 0)) throw new Error(`GENERATOR_MODEL_STOPS_MISSING: ${reelKey}`);
    stopWeights[reelKey] = weights;
  }
  return { stopWeights };
}

export type LuckyLadyGeneratorModel = {
  modelId: string;
  artifact: MathProfileArtifact;
  payload: LlProfilePayload;
  /** The declared model's own complete-round return under its own weights. */
  declaredReturnPercent: number;
  provenance: string[];
};

const cachedModels = new Map<number, LuckyLadyGeneratorModel>();

export function luckyLadyGeneratorModel(maxWinMultiplier = 50): LuckyLadyGeneratorModel {
  if (maxWinMultiplier !== 20 && maxWinMultiplier !== 50) throw new Error('GENERATOR_MAX_WIN_UNSUPPORTED');
  const cachedModel = cachedModels.get(maxWinMultiplier);
  if (cachedModel) return cachedModel;
  const { engine, rules, hashes } = loadVerifiedMath();
  const payload = modelPayload(rules, maxWinMultiplier);
  const modelId = maxWinMultiplier === 50 ? LUCKY_LADY_GENERATOR_MODEL_ID : 'lucky-lady.model.bounded-generator.max20.v1';
  const analysis = analyzeProfileExact(rules, engine, payload, 4_096);
  const declaredReturnPercent = Number(analysis.totalRtpPercent.toFixed(6));
  const artifact: MathProfileArtifact = {
    schemaVersion: 1,
    profileId: modelId,
    gameId: 'lucky-lady',
    engineSha256: hashes.engineSha256,
    rulesSha256: hashes.rulesSha256,
    policy: {
      gameId: 'lucky-lady',
      // The declared model's own complete-round return, not a calibration goal.
      targetRtpPercent: declaredReturnPercent,
      maxWinMultiplier,
      maxWinScope: 'RESOLVED_SPIN',
      maxWinEnabled: true,
      pacing: 'BALANCED',
      customPacing: null,
      hitRate: { mode: 'AUTO' },
      partialReturn: 'LOW',
      volatility: 'MED',
      bigWinMinMultiplier: 10,
      bigWinMaxMultiplier: maxWinMultiplier,
      featureContribution: { minPercent: 0, maxPercent: 60 },
      presets: [],
    },
    payload,
    canonicalHash: '',
    createdAt: new Date(0).toISOString(),
  };
  artifact.canonicalHash = canonicalProfileHash(artifact);
  const builtModel: LuckyLadyGeneratorModel = {
    modelId,
    artifact,
    payload,
    declaredReturnPercent,
    provenance: [
      'Declared bounded Lucky Lady generator model: a sparse pre-draw weighting over the accepted vendored strips and evaluator.',
      'Not the accepted golden dense RTP50 profile - that profile cannot be enumerated inside the bounded index and is recorded as unsupported.',
      `Every reachable paid and free resolution is proved inside a ${maxWinMultiplier}x RESOLVED_SPIN ceiling by the accepted support builder.`,
      'The feature chain is subcritical, so the FEATURE_TRIGGER expectation is finite and proved (never sampled).',
      'Only the global requested cap chooses the declared support; no player attribute selects weights or outcomes.',
    ],
  };
  cachedModels.set(maxWinMultiplier, builtModel);
  return builtModel;
}

export type LuckyLadyGeneratorMetadata = {
  metadata: GeneratorModelMetadata;
  support: DistributionSupport;
  /** The provisional policy the support was proved under (reachability probe). */
  probePolicy: DistributionPolicy;
  analysis: {
    declaredReturnPercent: number;
    triggerProbability: number;
    expectedFeatureSpins: number | null;
    featureDiverges: boolean;
    maxFreeSpinMultiplier: number;
    maxBoardMultiplier: number;
  };
};

const cachedMetadataByCap = new Map<number, LuckyLadyGeneratorMetadata>();

/**
 * Probe a policy down to the classes the model can actually reach.
 *
 * The accepted support builder refuses a class that carries weight but has no
 * reachable member, so the reachable set is derived from the builder's own
 * refusals instead of a parallel classification.
 */
function probeReachability(model: LuckyLadyGeneratorModel): { support: DistributionSupport; probePolicy: DistributionPolicy } {
  const payload = model.payload;
  const active = new Set<DistributionClass>(DISTRIBUTION_CLASSES);
  for (let attempt = 0; attempt <= DISTRIBUTION_CLASSES.length; attempt += 1) {
    const weights = {} as DistributionWeights;
    for (const classId of DISTRIBUTION_CLASSES) weights[classId] = active.has(classId) ? 1 : 0;
    const granularity = active.size;
    const probePolicy: DistributionPolicy = {
      policyId: 'lucky-lady.model.probe',
      version: 1,
      gameId: 'lucky-lady',
      mathProfileId: model.modelId,
      mathProfileHash: model.artifact.canonicalHash,
      maxWinScope: 'RESOLVED_SPIN',
      maxWinMultiplier: model.artifact.policy.maxWinMultiplier,
      granularity,
      maxBandMin: LUCKY_LADY_GENERATOR_MAX_BAND_MIN,
      weights,
    };
    const built = buildDistributionSupport(
      { profileId: probePolicy.mathProfileId, profileHash: probePolicy.mathProfileHash, payload },
      probePolicy,
      { maxBoards: 4_096 },
    );
    if (built.ok) return { support: built.support, probePolicy };
    const unreachable = built.reasons
      .filter((reason) => reason.constraint === 'DISTRIBUTION_CLASS_UNREACHABLE')
      .map((reason) => reason.requested.split('=')[0] as DistributionClass)
      .filter((classId) => active.has(classId));
    if (unreachable.length === 0) {
      throw new Error(
        `GENERATOR_MODEL_SUPPORT_REFUSED: ${built.reasons.map((reason) => reason.constraint).join(', ')}`,
      );
    }
    for (const classId of unreachable) active.delete(classId);
  }
  throw new Error('GENERATOR_MODEL_REACHABILITY_UNRESOLVED');
}

export function luckyLadyGeneratorMetadata(maxWinMultiplier = 50): LuckyLadyGeneratorMetadata {
  const cachedMetadata = cachedMetadataByCap.get(maxWinMultiplier);
  if (cachedMetadata) return cachedMetadata;
  const model = luckyLadyGeneratorModel(maxWinMultiplier);
  const { engine, rules } = loadVerifiedMath();
  const { support, probePolicy } = probeReachability(model);
  const analysis = analyzeProfileExact(rules, engine, model.payload, 4_096);

  const reachable = support.classes.filter((entry) => entry.members > 0);
  const metadata: GeneratorModelMetadata = {
    gameId: 'lucky-lady',
    modelId: model.modelId,
    modelHash: model.artifact.canonicalHash,
    engineSha256: model.artifact.engineSha256,
    rulesSha256: model.artifact.rulesSha256,
    maxWinScope: 'RESOLVED_SPIN',
    maxWinMultiplier,
    maxBandMin: LUCKY_LADY_GENERATOR_MAX_BAND_MIN,
    reachableClasses: reachable.map((entry) => ({
      classId: entry.class,
      conditionalEv: entry.conditionalEv as { numerator: bigint; denominator: bigint },
      conditionalPaidEv: entry.conditionalPaidEv as { numerator: bigint; denominator: bigint } | null,
      conditionalFeatureEv: entry.conditionalFeatureEv as { numerator: bigint; denominator: bigint } | null,
    })),
    unreachableClasses: DISTRIBUTION_CLASSES.filter((classId) => !reachable.some((entry) => entry.class === classId)),
    notes: [
      ...model.provenance,
      `The accepted support builder proved ${support.reachableBoards} reachable boards; ` +
        `unreachable classes: ${DISTRIBUTION_CLASSES.filter((classId) => !reachable.some((entry) => entry.class === classId)).join(', ')}.`,
    ],
  };
  const result: LuckyLadyGeneratorMetadata = {
    metadata,
    support,
    probePolicy,
    analysis: {
      declaredReturnPercent: model.declaredReturnPercent,
      triggerProbability: analysis.triggerProbability,
      expectedFeatureSpins: analysis.expectedFeatureSpins,
      featureDiverges: analysis.featureDiverges,
      maxFreeSpinMultiplier: analysis.maxFreeSpinMultiplier,
      maxBoardMultiplier: analysis.maxBoardMultiplier,
    },
  };
  cachedMetadataByCap.set(maxWinMultiplier, result);
  return result;
}

// ---------------------------------------------------------------------------
// Request translation (Lucky Lady semantics live here, not in the shared solver)
// ---------------------------------------------------------------------------

export type GeneratorSemanticConstraints = {
  requirePositiveLoss?: boolean;
  requirePositivePartial?: boolean;
  requirePositiveProfit?: boolean;
  minFeatureWeightFraction?: string;
  maxFeatureWeightFraction?: string;
};

/** Documented structural floor applied to every positive-target candidate. */
export const POSITIVE_WEIGHT_FLOOR_FRACTION = '0.01';

function applySemanticConstraints(
  request: NormalizedGeneratorRequest,
  semantic: GeneratorSemanticConstraints,
  metadata: GeneratorModelMetadata,
  usePreferences = true,
): { request: NormalizedGeneratorRequest; applied: string[]; reasons: ConstraintReason[] } {
  const reasons: ConstraintReason[] = [];
  const applied: string[] = [];
  const floor = Math.max(1, Math.floor(request.granularity / 100));
  const minimumWeight = { ...request.minimumWeight };
  const maximumWeight = { ...request.maximumWeight };
  const target = Number(request.targetRtpPercent);
  const reachable = new Set(metadata.reachableClasses.map((entry) => entry.classId));
  const evById = new Map(metadata.reachableClasses.map((entry) => [
    entry.classId,
    Number(entry.conditionalEv.numerator) / Number(entry.conditionalEv.denominator),
  ]));

  if (target > 0) {
    if ((semantic.requirePositiveLoss === true || (usePreferences && semantic.requirePositiveLoss !== false)) && reachable.has('LOSS')) {
      minimumWeight.LOSS = Math.max(minimumWeight.LOSS ?? 0, floor);
      applied.push(`LOSS >= ${floor} units (${POSITIVE_WEIGHT_FLOOR_FRACTION} of the grid)`);
    }
    if (semantic.requirePositivePartial === true || (usePreferences && semantic.requirePositivePartial !== false)) {
      const partials = (['PARTIAL_HIGH', 'PARTIAL_LOW'] as DistributionClass[]).filter((classId) => reachable.has(classId));
      if (partials.length === 0) {
        applied.push('no reachable partial-return class exists in the declared model; partial weight is structurally impossible');
      } else {
        const chosen = partials[0];
        minimumWeight[chosen] = Math.max(minimumWeight[chosen] ?? 0, floor);
        applied.push(`${chosen} >= ${floor} units (${POSITIVE_WEIGHT_FLOOR_FRACTION} of the grid)`);
      }
    }
    if (semantic.requirePositiveProfit === true || (usePreferences && semantic.requirePositiveProfit !== false)) {
      const profitable = metadata.reachableClasses
        .filter((entry) => Number(entry.conditionalEv.numerator) / Number(entry.conditionalEv.denominator) > 1)
        .sort((a, b) => Number(a.conditionalEv.numerator) / Number(a.conditionalEv.denominator)
          - Number(b.conditionalEv.numerator) / Number(b.conditionalEv.denominator));
      if (profitable.length > 0) {
        const chosen = profitable[0].classId;
        minimumWeight[chosen] = Math.max(minimumWeight[chosen] ?? 0, floor);
        applied.push(`${chosen} >= ${floor} units (${POSITIVE_WEIGHT_FLOOR_FRACTION} of the grid, positive-profit floor)`);
      }
    }
  } else {
    applied.push('target 0%: every class with a positive proved expectation must carry zero weight, so no diversification floor is applied');
  }

  if (semantic.minFeatureWeightFraction !== undefined) {
    if (!reachable.has('FEATURE_TRIGGER')) {
      reasons.push({
        constraint: 'FEATURE_WEIGHT_CONSTRAINT_UNSATISFIABLE',
        requested: semantic.minFeatureWeightFraction,
        achievable: 'the declared model reaches no feature-trigger class',
        detail: 'A minimum feature weight was requested for a model with no reachable feature class.',
      });
    } else {
      const units = fractionToGridUnits(semantic.minFeatureWeightFraction, request.granularity);
      minimumWeight.FEATURE_TRIGGER = Math.max(minimumWeight.FEATURE_TRIGGER ?? 0, units);
      applied.push(`FEATURE_TRIGGER >= ${units} units`);
    }
  }
  if (semantic.maxFeatureWeightFraction !== undefined) {
    const units = fractionToGridUnits(semantic.maxFeatureWeightFraction, request.granularity);
    maximumWeight.FEATURE_TRIGGER = Math.min(maximumWeight.FEATURE_TRIGGER ?? request.granularity, units);
    applied.push(`FEATURE_TRIGGER <= ${units} units`);
  }
  for (const [classId, value] of Object.entries(minimumWeight)) {
    if (value > 0 && !reachable.has(classId as DistributionClass)) {
      reasons.push({
        constraint: 'MINIMUM_WEIGHT_UNREACHABLE_CLASS',
        requested: `${classId} >= ${value}`,
        achievable: 'a reachable class',
        detail: `The declared model cannot reach ${classId}; the floor cannot be honoured.`,
      });
    }
  }
  return { request: { ...request, minimumWeight, maximumWeight }, applied, reasons };
}

// ---------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------

export type GeneratorCandidateStatus = 'VALIDATED' | 'GENERATED' | 'INFEASIBLE' | 'SEARCH_EXHAUSTED' | 'REJECTED';
export type GeneratorStage = 'GENERATING' | 'GENERATED' | 'VALIDATING' | 'VALIDATED' | 'INFEASIBLE' | 'SEARCH_EXHAUSTED' | 'REJECTED';

export type LuckyLadyGeneratorCandidate = {
  status: GeneratorCandidateStatus;
  activation: false;
  testOnly: true;
  stages: Array<{ stage: GeneratorStage; detail: string }>;
  request: {
    raw: unknown;
    normalized: NormalizedGeneratorRequest | null;
    semanticConstraints: GeneratorSemanticConstraints;
    appliedFloors: string[];
  };
  requestHash: string | null;
  solver: {
    version: string;
    objective: GeneratorObjective | null;
    support: string[];
    method: string | null;
    enumeratedPairs: number;
    enumeratedTriples: number;
  };
  model: {
    modelId: string;
    modelHash: string;
    engineSha256: string;
    rulesSha256: string;
    maxWinScope: string;
    maxWinMultiplier: number;
    maxBandMin: number;
    reachableClasses: GeneratorModelMetadata['reachableClasses'];
    unreachableClasses: DistributionClass[];
    declaredReturnPercent: number;
    triggerProbability: number;
    expectedFeatureSpins: number | null;
    featureDiverges: boolean;
    notes: string[];
    provenance: string[];
  } | null;
  expected: {
    rtpPercentExact: string;
    rtpPercent: number | null;
    absoluteErrorPercentExact: string;
    absoluteErrorPercent: number | null;
    tolerancePercent: string;
  } | null;
  policy: DistributionPolicy | null;
  policyHash: string | null;
  policyId: string | null;
  weights: DistributionWeights | null;
  checks: MathCheck[];
  reasons: ConstraintReason[];
};

const policyIdFor = (objective: GeneratorObjective, target: string, hash: string): string => {
  const tag = target.replace('.', 'p');
  return `lucky-lady.gen.${objective.toLowerCase()}.rtp${tag}.${hash.slice(0, 10)}`;
};

export function generateLuckyLadyPolicy(input: {
  request: unknown;
  semanticConstraints?: GeneratorSemanticConstraints;
}): LuckyLadyGeneratorCandidate {
  const callerSemantics: GeneratorSemanticConstraints = input.semanticConstraints ?? {};
  const emptyCandidate = (
    status: GeneratorCandidateStatus,
    reasons: ConstraintReason[],
    stages: LuckyLadyGeneratorCandidate['stages'],
    semantics: GeneratorSemanticConstraints = callerSemantics,
  ): LuckyLadyGeneratorCandidate => ({
    status,
    activation: false,
    testOnly: true,
    stages,
    request: { raw: input.request, normalized: null, semanticConstraints: semantics, appliedFloors: [] },
    requestHash: null,
    solver: { version: SOLVER_VERSION, objective: null, support: [], method: null, enumeratedPairs: 0, enumeratedTriples: 0 },
    model: null,
    expected: null,
    policy: null,
    policyHash: null,
    policyId: null,
    weights: null,
    checks: [],
    reasons,
  });

  const raw = input.request;
  const validation = validateGeneratorRequest(raw && typeof raw === 'object' && !Array.isArray(raw)
    ? { gameId: 'lucky-lady', ...raw } : raw);
  if (!validation.ok) {
    return emptyCandidate('REJECTED', validation.reasons, [{ stage: 'GENERATING', detail: 'request refused before any solve' }]);
  }
  const normalized = validation.request;
  if (normalized.gameId !== 'lucky-lady' || ![20, 50].includes(normalized.maxWinMultiplier)) {
    return emptyCandidate('REJECTED', [{ constraint: 'GENERATOR_MODEL_UNSUPPORTED',
      requested: `${normalized.gameId}/${normalized.maxWinMultiplier}x`, achievable: 'lucky-lady with requested MaxWin20 or MaxWin50',
      detail: 'This bounded adapter has proofs for these two declared supports only; no other cap is silently substituted.' }],
      [{ stage: 'GENERATING', detail: 'unsupported game/cap refused' }]);
  }
  const semanticConstraints: GeneratorSemanticConstraints = { ...validation.semantic, ...callerSemantics };
  const built = luckyLadyGeneratorMetadata(normalized.maxWinMultiplier);
  const model = luckyLadyGeneratorModel(normalized.maxWinMultiplier);
  let translated = applySemanticConstraints(normalized, semanticConstraints, built.metadata);
  if (translated.reasons.length > 0) {
    return emptyCandidate('INFEASIBLE', translated.reasons, [{ stage: 'INFEASIBLE', detail: 'positive minimum on an unreachable class' }], semanticConstraints);
  }

  let solved = solvePayoutPolicyWeights({ metadata: built.metadata, request: translated.request });
  if (!solved.ok) {
    // Pacing preferences may not turn a feasible target into an infeasible one.
    // Explicit caller floors/caps and requirePositive* constraints remain hard.
    translated = applySemanticConstraints(normalized, semanticConstraints, built.metadata, false);
    translated.applied.push('Default pacing floors relaxed; all explicit caller bounds retained.');
    solved = solvePayoutPolicyWeights({ metadata: built.metadata, request: translated.request });
  }
  const requestHash = generatorRequestHash(translated.request, built.metadata);
  const baseModel = {
    modelId: built.metadata.modelId,
    modelHash: built.metadata.modelHash,
    engineSha256: built.metadata.engineSha256,
    rulesSha256: built.metadata.rulesSha256,
    maxWinScope: built.metadata.maxWinScope,
    maxWinMultiplier: built.metadata.maxWinMultiplier,
    maxBandMin: built.metadata.maxBandMin,
    reachableClasses: built.metadata.reachableClasses,
    unreachableClasses: built.metadata.unreachableClasses,
    declaredReturnPercent: built.analysis.declaredReturnPercent,
    triggerProbability: built.analysis.triggerProbability,
    expectedFeatureSpins: built.analysis.expectedFeatureSpins,
    featureDiverges: built.analysis.featureDiverges,
    notes: built.metadata.notes,
    provenance: model.provenance,
  };

  if (!solved.ok) {
    return {
      ...emptyCandidate(solved.status, solved.reasons, [
        { stage: 'GENERATING', detail: `request ${requestHash.slice(0, 12)} accepted` },
        { stage: solved.status, detail: solved.reasons.map((reason) => reason.constraint).join(', ') },
      ]),
      request: { raw: input.request, normalized: translated.request, semanticConstraints, appliedFloors: translated.applied },
      requestHash,
      model: baseModel,
    };
  }

  const policyHashPreview = distributionPolicyHash({
    policyId: 'lucky-lady.gen.preview',
    version: 1,
    gameId: 'lucky-lady',
    mathProfileId: built.metadata.modelId,
    mathProfileHash: built.metadata.modelHash,
    maxWinScope: 'RESOLVED_SPIN',
    maxWinMultiplier: built.metadata.maxWinMultiplier,
    granularity: translated.request.granularity,
    maxBandMin: built.metadata.maxBandMin,
    weights: solved.weights,
  });
  const policyId = policyIdFor(translated.request.objective, translated.request.targetRtpPercent, policyHashPreview);
  const policy = assembleDistributionPolicy({
    metadata: built.metadata,
    policyId,
    weights: solved.weights,
    granularity: translated.request.granularity,
  });

  // Accepted policy validation, then the support proof under the final weights.
  const acceptedPolicy = validateDistributionPolicy(policy);
  const supportRebuilt = buildDistributionSupport(
    { profileId: policy.mathProfileId, profileHash: policy.mathProfileHash, payload: model.payload },
    policy,
    { maxBoards: 4_096 },
  );
  const checks: MathCheck[] = [];
  checks.push({
    id: 'ACCEPTED_POLICY_VALIDATION',
    status: acceptedPolicy.ok ? 'PASS' : 'FAIL',
    detail: acceptedPolicy.ok
      ? 'the accepted distribution-policy validator accepted the generated policy'
      : acceptedPolicy.reasons.map((reason) => reason.constraint).join(', '),
  });
  checks.push({
    id: 'SUPPORT_PROOF_UNDER_FINAL_WEIGHTS',
    status: supportRebuilt.ok ? 'PASS' : 'FAIL',
    detail: supportRebuilt.ok
      ? `the accepted support builder proved ${supportRebuilt.support.reachableBoards} boards and the per-resolution ceiling`
      : supportRebuilt.reasons.map((reason) => reason.constraint).join(', '),
  });
  if (supportRebuilt.ok) {
    checks.push(...generatorChecks({
      metadata: built.metadata,
      request: translated.request,
      policy: supportRebuilt.support.policy,
      solver: solved,
      support: supportRebuilt.support,
    }));
    const evById = new Map(built.metadata.reachableClasses.map((entry) => [
      entry.classId,
      Number(entry.conditionalEv.numerator) / Number(entry.conditionalEv.denominator),
    ]));
    const profitWeight = DISTRIBUTION_CLASSES.reduce(
      (sum, classId) => sum + ((evById.get(classId) ?? 0) > 1 ? supportRebuilt.support.policy.weights[classId] : 0),
      0,
    );
    const target = Number(translated.request.targetRtpPercent);
    const profitFloor = Object.entries(translated.request.minimumWeight).reduce((sum, [id, floor]) =>
      sum + ((evById.get(id as DistributionClass) ?? 0) > 1 ? floor : 0), 0);
    checks.push({
      id: 'POSITIVE_PROFIT_WEIGHT_WHEN_TARGET_POSITIVE',
      status: target === 0 || profitWeight >= profitFloor ? 'PASS' : 'FAIL',
      detail: target === 0
        ? 'target 0%: no profitable class may carry weight'
        : `${profitWeight} grid units on classes with a proved expectation above 1x (floor ${profitFloor})`,
    });
    const lossWeight = supportRebuilt.support.policy.weights.LOSS ?? 0;
    checks.push({
      id: 'POSITIVE_LOSS_WEIGHT_WHEN_TARGET_POSITIVE',
      status: target === 0 || lossWeight >= (translated.request.minimumWeight.LOSS ?? 0) ? 'PASS' : 'FAIL',
      detail: `LOSS weight ${lossWeight} units`,
    });
  }

  const passed = checksPass(checks.filter((entry) => entry.id !== 'SUPPORT_PROOF_UNDER_FINAL_WEIGHTS')) && supportRebuilt.ok && acceptedPolicy.ok;
  const stages: LuckyLadyGeneratorCandidate['stages'] = [
    { stage: 'GENERATING', detail: `request ${requestHash.slice(0, 12)} accepted; objective ${translated.request.objective}` },
    { stage: 'GENERATED', detail: `solved ${policyWeightsSum(policy.weights)} grid units across ${solved.strategy.support.join('+')} (${solved.strategy.method})` },
    { stage: 'VALIDATING', detail: `${checks.length} acceptance checks` },
    passed
      ? { stage: 'VALIDATED', detail: 'every analytical check passed; activation is not part of this pipeline' }
      : { stage: 'REJECTED', detail: checks.filter((entry) => entry.status !== 'PASS').map((entry) => entry.id).join(', ') },
  ];

  return {
    status: passed ? 'VALIDATED' : 'REJECTED',
    activation: false,
    testOnly: true,
    stages,
    request: { raw: input.request, normalized: translated.request, semanticConstraints, appliedFloors: translated.applied },
    requestHash,
    solver: {
      version: SOLVER_VERSION,
      objective: translated.request.objective,
      support: solved.strategy.support,
      method: solved.strategy.method,
      enumeratedPairs: solved.strategy.enumeratedPairs,
      enumeratedTriples: solved.strategy.enumeratedTriples,
    },
    model: baseModel,
    expected: {
      rtpPercentExact: solved.expectedRtpPercentExact,
      rtpPercent: solved.expectedRtpPercent,
      absoluteErrorPercentExact: solved.absoluteErrorPercentExact,
      absoluteErrorPercent: solved.absoluteErrorPercent,
      tolerancePercent: translated.request.tolerancePercent,
    },
    policy,
    policyHash: distributionPolicyHash(policy),
    policyId,
    weights: { ...policy.weights },
    checks,
    reasons: checks
      .filter((entry) => entry.status !== 'PASS')
      .map((entry) => ({
        constraint: entry.id,
        requested: 'a passing acceptance check',
        achievable: entry.detail,
        detail: entry.detail,
      })),
  };
}

// ---------------------------------------------------------------------------
// Evidence run: accepted bankroll simulator over the generated policy
// ---------------------------------------------------------------------------

export type GeneratedPolicyReport = {
  testOnly: true;
  activation: false;
  status: GeneratorCandidateStatus;
  generatedAt: string;
  generator: {
    solverVersion: string;
    requestHash: string | null;
    request: LuckyLadyGeneratorCandidate['request'];
    solver: LuckyLadyGeneratorCandidate['solver'];
    expected: LuckyLadyGeneratorCandidate['expected'];
    policyId: string | null;
    policyHash: string | null;
    weights: DistributionWeights | null;
    checks: MathCheck[];
    stages: LuckyLadyGeneratorCandidate['stages'];
    reasons: ConstraintReason[];
    model: LuckyLadyGeneratorCandidate['model'];
  };
  statistical: {
    measuredRtpPercentExact: string;
    measuredRtpPercent: number | null;
    standardErrorPercent: number | null;
    interval95Percent: [number, number] | null;
    absoluteDifferencePercent: number | null;
    verdict: 'PASS' | 'INSUFFICIENT_PRECISION' | 'NOT_RUN';
    tolerance: string;
  } | null;
  bankroll: PolicyBankrollReport | null;
  warnings: string[];
};

export const GENERATED_SAMPLE_SESSIONS = 80;
export const GENERATED_SAMPLE_HORIZON = 5_000;
/** Pragmatic statistical acceptance: |measured - exact| <= 3 standard errors + 0.5pp. */
export const STATISTICAL_TOLERANCE_PERCENT = 0.5;

export function runGeneratedPolicyEvidence(
  candidate: LuckyLadyGeneratorCandidate,
  options: { sessions?: number; horizonPaidSpins?: number; seedPrefix: string; generatedAt: string; sessionConfig: SessionConfig },
): GeneratedPolicyReport {
  const warnings = [
    'Offline generator evidence: activation is never part of this pipeline; the candidate stays a reviewable artifact.',
    'The bankroll sample is bounded and predeclared; the seed prefix and sample size are recorded, and no seed is searched.',
    'Session proportions carry Wilson 95% intervals limited by the session count; the RTP interval is a normal approximation ' +
      'over observed paid rounds while the number of rounds is bankroll-dependent (optional stopping), so it is approximate.',
  ];
  if (!candidate.policy || !candidate.model || candidate.status === 'REJECTED' || candidate.status === 'INFEASIBLE') {
    return {
      testOnly: true,
      activation: false,
      status: candidate.status,
      generatedAt: options.generatedAt,
      generator: {
        solverVersion: SOLVER_VERSION,
        requestHash: candidate.requestHash,
        request: candidate.request,
        solver: candidate.solver,
        expected: candidate.expected,
        policyId: candidate.policyId,
        policyHash: candidate.policyHash,
        weights: candidate.weights,
        checks: candidate.checks,
        stages: candidate.stages,
        reasons: candidate.reasons,
        model: candidate.model,
      },
      statistical: null,
      bankroll: null,
      warnings,
    };
  }

  const model = luckyLadyGeneratorModel(candidate.policy.maxWinMultiplier);
  if (candidate.policy.mathProfileId !== model.modelId || candidate.policy.mathProfileHash !== model.artifact.canonicalHash) {
    throw new Error('GENERATED_POLICY_MODEL_BINDING_MISMATCH');
  }
  const rebuilt = buildDistributionSupport(
    { profileId: candidate.policy.mathProfileId, profileHash: candidate.policy.mathProfileHash, payload: model.payload },
    candidate.policy,
    { maxBoards: 4_096 },
  );
  if (!rebuilt.ok) throw new Error(`GENERATED_POLICY_SUPPORT_REFUSED: ${rebuilt.reasons.map((r) => r.constraint).join(', ')}`);
  const { rules, engine } = loadVerifiedMath();
  const config: SessionConfig = {
    ...options.sessionConfig,
    horizonPaidSpins: options.horizonPaidSpins ?? GENERATED_SAMPLE_HORIZON,
  };
  const { report: bankroll } = runPolicyBankroll({
    gameId: 'lucky-lady',
    policy: candidate.policy,
    support: rebuilt.support,
    config,
    sessions: options.sessions ?? GENERATED_SAMPLE_SESSIONS,
    seedPrefix: options.seedPrefix,
    generatedAt: options.generatedAt,
    sessionSourceFactory: luckyLadyPolicySessionFactory({
      support: rebuilt.support,
      payload: model.payload,
      config,
      rules,
      engine,
    }),
  });

  const measured = bankroll.measured.rtpPercent;
  const expected = candidate.expected?.rtpPercent ?? null;
  const standardError = bankroll.measured.rtpStandardErrorPercent;
  const difference = measured === null || expected === null ? null : Math.abs(measured - expected);
  const statisticalTolerance = 3 * (standardError ?? 0) + STATISTICAL_TOLERANCE_PERCENT;
  const verdict = difference === null
    ? 'NOT_RUN'
    : difference <= statisticalTolerance ? 'PASS' : 'INSUFFICIENT_PRECISION';

  return {
    testOnly: true,
    activation: false,
    status: candidate.status === 'VALIDATED' && verdict === 'PASS' ? 'VALIDATED' : 'GENERATED',
    generatedAt: options.generatedAt,
    generator: {
      solverVersion: SOLVER_VERSION,
      requestHash: candidate.requestHash,
      request: candidate.request,
      solver: candidate.solver,
      expected: candidate.expected,
      policyId: candidate.policyId,
      policyHash: candidate.policyHash,
      weights: candidate.weights,
      checks: candidate.checks,
      stages: candidate.stages,
      reasons: candidate.reasons,
      model: candidate.model,
    },
    statistical: {
      measuredRtpPercentExact: bankroll.measured.rtpPercentExact,
      measuredRtpPercent: measured,
      standardErrorPercent: standardError,
      interval95Percent: bankroll.measured.rtp95IntervalPercent,
      absoluteDifferencePercent: difference,
      verdict,
      tolerance: `3 x standard error + ${STATISTICAL_TOLERANCE_PERCENT}pp`,
    },
    bankroll,
    warnings: candidate.status === 'VALIDATED' && verdict === 'PASS'
      ? warnings
      : [...warnings, `Candidate status ${candidate.status} with statistical verdict ${verdict}: it is not reported as VALIDATED.`],
  };
}

export type { PolicyRoundObservation };

// ---------------------------------------------------------------------------
// Markdown rendering for a generated candidate report
// ---------------------------------------------------------------------------

const num = (value: number | null | undefined, digits = 4): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  const fixed = value.toFixed(digits);
  if (value !== 0 && Number(fixed) === 0) return value.toExponential(3);
  return fixed;
};
const pct = (value: number | null | undefined, digits = 4) => `${num(value, digits)}%`;

export function renderGeneratedPolicyMarkdown(report: GeneratedPolicyReport): string {
  const { generator, statistical, bankroll } = report;
  const lines: string[] = [
    `# ${generator.policyId ?? 'unsolved candidate'} - generated payout policy`,
    '',
    `- Status: **${report.status}** (activation: **${report.activation}**, testOnly: **${report.testOnly}**)`,
    `- Generated at: ${report.generatedAt}`,
    `- Request: \`${JSON.stringify(generator.request.raw)}\``,
    `- Normalized request: target ${generator.request.normalized?.targetRtpPercent ?? 'n/a'}%, objective ` +
      `${generator.request.normalized?.objective ?? 'n/a'}, granularity ${generator.request.normalized?.granularity ?? 'n/a'}, ` +
      `tolerance ${generator.request.normalized?.tolerancePercent ?? 'n/a'}pp`,
    `- Solver: ${generator.solverVersion}; method ${generator.solver.method ?? 'n/a'}; support ${generator.solver.support.join('+') || 'n/a'}; ` +
      `enumerated ${generator.solver.enumeratedPairs} pairs / ${generator.solver.enumeratedTriples} triples`,
    `- Request hash: \`${generator.requestHash ?? 'n/a'}\``,
    `- Policy: \`${generator.policyId ?? 'n/a'}\` hash \`${generator.policyHash ?? 'n/a'}\``,
    `- Model: \`${generator.model?.modelId ?? 'n/a'}\` hash \`${generator.model?.modelHash ?? 'n/a'}\``,
    `- Declared model return under its own weights: ${num(generator.model?.declaredReturnPercent, 6)}%; ` +
      `feature trigger probability ${num(generator.model?.triggerProbability, 8)}; expected feature spins ` +
      `${num(generator.model?.expectedFeatureSpins, 4)}; feature chain diverges: ${generator.model?.featureDiverges}`,
    `- Unreachable classes in the declared model: ${generator.model?.unreachableClasses.join(', ') ?? 'n/a'}`,
    '',
    '## Expected return',
    '',
    `- Expected (exact support): ${generator.expected?.rtpPercentExact ?? 'n/a'}%`,
    `- Exact absolute error against the request: ${generator.expected?.absoluteErrorPercentExact ?? 'n/a'}pp ` +
      `(tolerance ${generator.expected?.tolerancePercent ?? 'n/a'}pp)`,
    statistical
      ? `- Measured over the bounded sample: ${statistical.measuredRtpPercentExact}% ` +
        `(standard error ${pct(statistical.standardErrorPercent, 4)}; 95% interval ` +
        `${statistical.interval95Percent
          ? `${pct(statistical.interval95Percent[0], 3)} - ${pct(statistical.interval95Percent[1], 3)}`
          : 'n/a'})`
      : '- Measured: not run',
    statistical
      ? `- Statistical verdict: **${statistical.verdict}** (|measured - expected| = ` +
        `${num(statistical.absoluteDifferencePercent, 4)}pp, tolerance ${statistical.tolerance})`
      : '- Statistical verdict: not run',
    '',
    '## Class weights',
    '',
    '| Class | Weight (grid units) | Configured share | Proved expectation |',
    '| --- | ---: | ---: | ---: |',
    ...DISTRIBUTION_CLASSES.map((classId) => {
      const weight = generator.weights?.[classId] ?? 0;
      const share = generator.request.normalized
        ? (weight / generator.request.normalized.granularity) * 100
        : 0;
      const entry = generator.model?.reachableClasses.find((cls) => cls.classId === classId);
      const ev = entry ? Number(entry.conditionalEv.numerator) / Number(entry.conditionalEv.denominator) : null;
      return `| ${classId} | ${weight} | ${pct(share, 4)} | ${ev === null ? 'unreachable' : num(ev, 6)} |`;
    }),
    '',
    '## Acceptance checks',
    '',
    ...generator.checks.map((check) => `- **${check.status}** \`${check.id}\`: ${check.detail}`),
    '',
    '## Pipeline stages',
    '',
    ...generator.stages.map((stage) => `- ${stage.stage}: ${stage.detail}`),
    '',
  ];

  if (bankroll) {
    lines.push(
      '## Bankroll sample (accepted simulator, simulation-only denomination)',
      '',
      `- Sessions: ${bankroll.sample.sessions}; horizon: ${bankroll.sample.horizonPaidSpins} paid spins; ` +
        `censored ${bankroll.sample.censoredCount}; ruined ${bankroll.sample.ruinedCount}`,
      `- Seeds: prefix \`${bankroll.sample.seedPrefix}\` (${bankroll.sample.seedFirst} .. ${bankroll.sample.seedLast})`,
      `- Initial balance ${(bankroll.sample.config.startUnits / 100).toFixed(2)} PTS (${bankroll.sample.config.startUnits} units); ` +
        `paid stake ${(bankroll.sample.config.stakeUnits / 100).toFixed(2)} PTS (${bankroll.sample.config.stakeUnits} units)`,
      `- Spins: ${bankroll.spins.paidSpinsTotal} paid + ${bankroll.spins.freeSpinsTotal} free = ` +
        `${bankroll.spins.resolvedSpinsTotal} resolved`,
      `- Ledger identity (exact units): opening ${bankroll.measured.openingUnitsExact} + returned ` +
        `${bankroll.measured.returnedUnitsExact} - wager ${bankroll.measured.paidWagerUnitsExact} = closing ` +
        `${bankroll.measured.closingUnitsExact} (exact: ${bankroll.measured.ledgerIdentityHolds})`,
      `- Paid spins per session: mean ${num(bankroll.spins.perSessionPaidSpins.mean, 1)}, median ` +
        `${num(bankroll.spins.perSessionPaidSpins.median, 1)}, p90 ${num(bankroll.spins.perSessionPaidSpins.p90, 1)}`,
      `- Turnover (paid only): mean ${bankroll.turnover.perSessionPts.meanExact} PTS, median ` +
        `${bankroll.turnover.perSessionPts.medianExact} PTS, p90 ${bankroll.turnover.perSessionPts.p90Exact} PTS`,
      `- House per session: mean wager ${num(bankroll.house.meanWagerPtsPerSession, 4)} PTS, mean payout ` +
        `${num(bankroll.house.meanPayoutPtsPerSession, 4)} PTS, mean net ${num(bankroll.house.meanNetPtsPerSession, 4)} PTS`,
      `- Drawdown (units): mean ${num(bankroll.drawdown.mean, 1)}, median ${num(bankroll.drawdown.median, 1)}, ` +
        `p90 ${num(bankroll.drawdown.p90, 1)}, p95 ${num(bankroll.drawdown.p95, 1)}`,
      `- Paid-event full loss ${pct(bankroll.paidEvents.fullLoss.rate * 100, 2)}; hit ` +
        `${pct(bankroll.paidEvents.hit.rate * 100, 2)}; partial ${pct(bankroll.paidEvents.partial.rate * 100, 2)}; profitable ` +
        `${pct(bankroll.paidEvents.profitable.rate * 100, 2)}`,
      `- Feature triggered ${pct(bankroll.paidEvents.featureTriggered.rate * 100, 4)} of paid rounds; retriggered ` +
        `${pct(bankroll.paidEvents.retriggered.rate * 100, 4)}; native class mismatches ${bankroll.paidEvents.nativeClassMismatches}`,
      `- Max observed paid resolved spin ${bankroll.maxObserved.paidSpinUnitsExact} units; free resolved spin ` +
        `${bankroll.maxObserved.freeSpinUnitsExact} units (cap ${bankroll.maxObserved.capUnitsExact}); feature aggregate ` +
        `${bankroll.maxObserved.featureAggregateUnitsExact} units (deliberately uncapped)`,
      '',
      '| N | Alive@N (observed) | Balance mean | Ruin by N | Ruin observed |',
      '| ---: | ---: | ---: | ---: | ---: |',
      ...Array.from(new Set([
        ...Object.keys(bankroll.survival),
        ...Object.keys(bankroll.balance),
        ...Object.keys(bankroll.ruin),
      ])).map(Number).sort((a, b) => a - b).map((checkpoint) => {
        const alive = bankroll.survival[String(checkpoint)];
        const balance = bankroll.balance[String(checkpoint)];
        const ruin = bankroll.ruin[String(checkpoint)];
        return `| ${checkpoint} | ${alive && alive.rate !== null ? pct(alive.rate * 100, 2) : 'unobserved'} ` +
          `(${alive?.observed ?? 0}) | ${balance ? num(balance.mean, 1) : 'not requested'} | ` +
          `${ruin && !ruin.beyondHorizon && ruin.rate !== null ? pct(ruin.rate * 100, 2) : 'unknown'} | ` +
          `${ruin?.observed ?? 0} |`;
      }),
      '',
      `- FULL_LOSS dry spell: pooled mean ${num(bankroll.drySpells.fullLoss.meanRunLength, 2)} ` +
        `(denominator ${bankroll.drySpells.fullLoss.meanRunLengthDenominator} runs); longest per session mean ` +
        `${num(bankroll.drySpells.fullLoss.longestPerSession.mean, 2)}, p90 ` +
        `${num(bankroll.drySpells.fullLoss.longestPerSession.p90, 1)}, p99 ` +
        `${num(bankroll.drySpells.fullLoss.longestPerSessionP99, 1)}`,
      `- NON_PROFITABLE dry spell: pooled mean ${num(bankroll.drySpells.nonProfitable.meanRunLength, 2)} ` +
        `(denominator ${bankroll.drySpells.nonProfitable.meanRunLengthDenominator} runs); longest per session mean ` +
        `${num(bankroll.drySpells.nonProfitable.longestPerSession.mean, 2)}, p90 ` +
        `${num(bankroll.drySpells.nonProfitable.longestPerSession.p90, 1)}, p99 ` +
        `${num(bankroll.drySpells.nonProfitable.longestPerSessionP99, 1)}`,
      '',
      ...Object.entries(bankroll.reach).map(([key, value]) => `- reached ${Number(key) / 100} PTS: ${pct(value * 100, 2)}`),
      ...Object.entries(bankroll.fallBelow).map(([key, value]) => `- fell below ${Number(key) / 100} PTS: ${pct(value * 100, 2)}`),
      '',
    );
  }

  lines.push('## Warnings', '', ...report.warnings.map((warning) => `- ${warning}`), '');
  return lines.join('\n');
}
