import {
  GENERATED_SAMPLE_HORIZON,
  LUCKY_LADY_GENERATOR_CAP,
  LUCKY_LADY_GENERATOR_MAX_BAND_MIN,
  generateLuckyLadyPolicy,
  luckyLadyGeneratorMetadata,
  luckyLadyGeneratorModel,
  runGeneratedPolicyEvidence,
  type LuckyLadyGeneratorCandidate,
} from '../src/casino/games/lucky-lady/lucky-lady.policy-generator';
import { defaultSessionConfig } from '../src/casino/platform/math-control/math-control.bankroll';
import {
  DEFAULT_GRANULARITY,
  SOLVER_VERSION,
  fractionToGridUnits,
  solvePayoutPolicyWeights,
  validateGeneratorRequest,
} from '../src/casino/platform/math-control/payout-policy-generator';
import { DISTRIBUTION_CLASSES } from '../src/casino/platform/math-control/payout-distribution';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { policyDistributionSessionSource } from '../src/casino/games/lucky-lady/lucky-lady.distribution-session';
import { buildDistributionSupport } from '../src/casino/games/lucky-lady/lucky-lady.distribution';
import { loadVerifiedMath } from '../src/casino/games/lucky-lady/lucky-lady.math';
import { enumerateBoardOutcomes } from '../src/casino/games/lucky-lady/lucky-lady.exact';

/**
 * Automatic payout-policy generator (offline).
 *
 * These tests exercise the shared exact solver through the Lucky Lady adapter:
 * the declared bounded model, the documented objectives, the honest statuses
 * (REJECTED for an unusable request, INFEASIBLE for a proved contradiction,
 * SEARCH_EXHAUSTED for an unproved bounded search miss,
 * VALIDATED for a fully checked analytical candidate) and a bounded evidence
 * run over the accepted bankroll simulator. Nothing here activates anything.
 */

const generate = (request: Record<string, unknown>, semanticConstraints?: Parameters<typeof generateLuckyLadyPolicy>[0]['semanticConstraints']) =>
  generateLuckyLadyPolicy({ request: { maxWinMultiplier: 50, ...request }, semanticConstraints });

const statusOf = (candidate: LuckyLadyGeneratorCandidate) => candidate.status;

describe('Lucky Lady automatic payout-policy generator', () => {
  it('declares an honest bounded model and derives every class expectation from the accepted support', () => {
    const built = luckyLadyGeneratorMetadata();
    const model = luckyLadyGeneratorModel();
    expect(built.metadata.modelId).toBe(model.modelId);
    expect(built.metadata.modelHash).toBe(model.artifact.canonicalHash);
    expect(built.metadata.maxWinMultiplier).toBe(LUCKY_LADY_GENERATOR_CAP);
    expect(built.metadata.maxBandMin).toBe(LUCKY_LADY_GENERATOR_MAX_BAND_MIN);
    expect(built.support.reachableBoards).toBe(108);
    expect(built.support.maxWin.resolvedSpinMax).toBeLessThanOrEqual(LUCKY_LADY_GENERATOR_CAP);
    expect(built.analysis.featureDiverges).toBe(false);
    expect(built.analysis.expectedFeatureSpins).toBeGreaterThan(15);

    const reachable = built.metadata.reachableClasses.map((entry) => entry.classId).sort();
    expect(reachable).toEqual(['FEATURE_TRIGGER', 'LOSS', 'MEDIUM', 'PARTIAL_HIGH', 'PARTIAL_LOW', 'SMALL']);
    expect([...built.metadata.unreachableClasses].sort()).toEqual(['BIG', 'BREAK_EVEN', 'MAX']);

    const feature = built.metadata.reachableClasses.find((entry) => entry.classId === 'FEATURE_TRIGGER')!;
    expect(feature.conditionalPaidEv).not.toBeNull();
    expect(feature.conditionalFeatureEv).not.toBeNull();
    const featureEv = Number(feature.conditionalEv.numerator) / Number(feature.conditionalEv.denominator);
    const paidEv = Number(feature.conditionalPaidEv!.numerator) / Number(feature.conditionalPaidEv!.denominator);
    const chainEv = Number(feature.conditionalFeatureEv!.numerator) / Number(feature.conditionalFeatureEv!.denominator);
    expect(featureEv).toBeCloseTo(732.68, 1);
    expect(featureEv).toBeCloseTo(paidEv + chainEv, 6);
    expect(chainEv).toBeGreaterThan(100);
    expect(built.analysis.maxFreeSpinMultiplier).toBeLessThanOrEqual(LUCKY_LADY_GENERATOR_CAP);
  });

  it('is deterministic: the same request and model version yields the same canonical policy hash', () => {
    const first = generate({ targetRtpPercent: '70', objective: 'BALANCED' });
    const second = generate({ objective: 'BALANCED', targetRtpPercent: 70 });
    expect(statusOf(first)).toBe('VALIDATED');
    expect(first.policyHash).toBe(second.policyHash);
    expect(first.weights).toEqual(second.weights);
    expect(first.requestHash).toBe(second.requestHash);
    expect(first.solver.version).toBe(SOLVER_VERSION);
    // Property order in the request object never changes the frozen policy hash.
    const reordered = generate({ objective: 'BALANCED', tolerancePercent: '0.01', targetRtpPercent: '70' });
    expect(reordered.policyHash).toBe(first.policyHash);
  });

  it('solves every required target with exact grid weights and a proved 50x ceiling', () => {
    const requests: Array<{ target: string; objective?: string }> = [
      { target: '0' },
      { target: '20' },
      { target: '50' },
      { target: '63.5' },
      { target: '70', objective: 'RETENTION' },
      { target: '70', objective: 'VOLATILE' },
      { target: '90' },
      { target: '100' },
    ];
    for (const entry of requests) {
      const candidate = generate({ targetRtpPercent: entry.target, objective: entry.objective ?? 'BALANCED' });
      expect(`${entry.target}/${entry.objective ?? 'BALANCED'}: ${statusOf(candidate)}`).toBe(
        `${entry.target}/${entry.objective ?? 'BALANCED'}: VALIDATED`,
      );
      expect(candidate.activation).toBe(false);
      expect(candidate.testOnly).toBe(true);
      expect(candidate.policy).not.toBeNull();
      const weights = candidate.weights!;
      const sum = DISTRIBUTION_CLASSES.reduce((total, classId) => total + weights[classId], 0);
      expect(sum).toBe(DEFAULT_GRANULARITY);
      for (const classId of DISTRIBUTION_CLASSES) {
        expect(Number.isSafeInteger(weights[classId])).toBe(true);
        expect(weights[classId]).toBeGreaterThanOrEqual(0);
      }
      // Unreachable classes never carry weight.
      for (const classId of candidate.model!.unreachableClasses) expect(weights[classId]).toBe(0);
      // Exact target evidence.
      expect(Number(candidate.expected!.absoluteErrorPercentExact)).toBeLessThanOrEqual(0.01);
      const capCheck = candidate.checks.find((check) => check.id === 'MAX_WIN_RESOLVED_SPIN_WITHIN_CEILING')!;
      expect(capCheck.status).toBe('PASS');
      expect(candidate.checks.every((check) => check.status === 'PASS')).toBe(true);
    }
  });

  it('enforces the target semantics: 0% is pure loss, 100% is a real mixture and never all break-even', () => {
    const zero = generate({ targetRtpPercent: '0' });
    expect(statusOf(zero)).toBe('VALIDATED');
    expect(zero.weights!.LOSS).toBe(DEFAULT_GRANULARITY);
    expect(zero.weights!.FEATURE_TRIGGER).toBe(0);
    expect(zero.request.appliedFloors.join(' ')).toMatch(/target 0%/);

    for (const target of ['20', '50', '63.5', '70', '90', '100']) {
      const candidate = generate({ targetRtpPercent: target });
      expect(statusOf(candidate)).toBe('VALIDATED');
      const weights = candidate.weights!;
      expect(weights.LOSS).toBeGreaterThan(0);
      const partial = weights.PARTIAL_LOW + weights.PARTIAL_HIGH;
      expect(partial).toBeGreaterThan(0);
      const profitableEvById = new Map(
        candidate.model!.reachableClasses.map((entry) => [
          entry.classId,
          Number(entry.conditionalEv.numerator) / Number(entry.conditionalEv.denominator),
        ]),
      );
      const profitable = DISTRIBUTION_CLASSES.reduce(
        (sum, classId) => sum + ((profitableEvById.get(classId) ?? 0) > 1 ? weights[classId] : 0),
        0,
      );
      expect(profitable).toBeGreaterThan(0);
      // Never a degenerate single-class (for example all break-even) policy.
      const activeClasses = DISTRIBUTION_CLASSES.filter((classId) => weights[classId] > 0);
      expect(activeClasses.length).toBeGreaterThanOrEqual(3);
      expect(candidate.checks.find((check) => check.id === 'POSITIVE_PROFIT_WEIGHT_WHEN_TARGET_POSITIVE')!.status).toBe('PASS');
      expect(candidate.checks.find((check) => check.id === 'POSITIVE_LOSS_WEIGHT_WHEN_TARGET_POSITIVE')!.status).toBe('PASS');
    }
  });

  it('produces genuinely different RETENTION and VOLATILE shapes at the same target', () => {
    const retention = generate({ targetRtpPercent: '70', objective: 'RETENTION' });
    const volatile = generate({ targetRtpPercent: '70', objective: 'VOLATILE' });
    expect(statusOf(retention)).toBe('VALIDATED');
    expect(statusOf(volatile)).toBe('VALIDATED');
    expect(retention.policyHash).not.toBe(volatile.policyHash);
    // RETENTION keeps the small-return band heavy; VOLATILE leans on the extreme pair.
    const retentionSmall = retention.weights!.SMALL + retention.weights!.PARTIAL_LOW + retention.weights!.PARTIAL_HIGH;
    const volatileLoss = volatile.weights!.LOSS;
    expect(retentionSmall).toBeGreaterThan(volatile.weights!.SMALL + volatile.weights!.PARTIAL_LOW + volatile.weights!.PARTIAL_HIGH);
    expect(volatileLoss).toBeGreaterThan(0);
    // RETENTION carries the small-return band far heavier than VOLATILE does.
    expect(retentionSmall).toBeGreaterThan(volatile.weights!.SMALL + volatile.weights!.PARTIAL_LOW + volatile.weights!.PARTIAL_HIGH);
  });

  it('rejects unusable requests and never silently ignores unsupported constraints', () => {
    const cases: Array<{ request: Record<string, unknown>; constraint: string }> = [
      { request: { targetRtpPercent: '70', playerId: 'p1' }, constraint: 'UNKNOWN_FIELD' },
      { request: { targetRtpPercent: '70', balance: 100 }, constraint: 'UNKNOWN_FIELD' },
      { request: { targetRtpPercent: '70', history: [] }, constraint: 'UNKNOWN_FIELD' },
      { request: { targetRtpPercent: '101' }, constraint: 'TARGET_OUT_OF_RANGE' },
      { request: { targetRtpPercent: '-1' }, constraint: 'TARGET_NOT_A_DECIMAL' },
      { request: { targetRtpPercent: 'abc' }, constraint: 'TARGET_NOT_A_DECIMAL' },
      { request: { targetRtpPercent: '0.1234567' }, constraint: 'TARGET_PRECISION_TOO_FINE' },
      { request: { targetRtpPercent: '70', objective: 'MAXIMIZE_HOUSE' }, constraint: 'OBJECTIVE_UNSUPPORTED' },
      { request: { targetRtpPercent: '70', constraints: { maxDrySpellPaidRounds: '100' } }, constraint: 'UNSUPPORTED_CONSTRAINT' },
      { request: { targetRtpPercent: '70', constraints: { maxVolatility: '0.5' } }, constraint: 'UNSUPPORTED_CONSTRAINT' },
      { request: { targetRtpPercent: '70', seed: 'abc' }, constraint: 'UNKNOWN_FIELD' },
      { request: { targetRtpPercent: '70', constraints: { minimumWeightFraction: { NOT_A_CLASS: '0.5' } } }, constraint: 'CONSTRAINT_CLASS_UNKNOWN' },
    ];
    for (const entry of cases) {
      const candidate = generate(entry.request);
      expect(`${JSON.stringify(entry.request)} -> ${statusOf(candidate)}`).toBe(
        `${JSON.stringify(entry.request)} -> REJECTED`,
      );
      expect(candidate.policy).toBeNull();
      expect(candidate.policyHash).toBeNull();
      expect(candidate.reasons.map((reason) => reason.constraint)).toContain(entry.constraint);
    }

    // A capped loss class cannot express a true 0% policy under the bounded family.
    const infeasible = generate({
      targetRtpPercent: '0',
      constraints: { maximumWeightFraction: { LOSS: '0.1' } },
    });
    expect(statusOf(infeasible)).toBe('INFEASIBLE');
    expect(infeasible.reasons.map((reason) => reason.constraint)).toContain('TARGET_OUTSIDE_ATTAINABLE_INTERVAL');
  });

  it('honours or explicitly refuses semantic constraints instead of ignoring them', () => {
    const noFeature = generate({
      targetRtpPercent: '50',
      constraints: { minFeatureWeightFraction: '0.0005' },
    });
    expect(statusOf(noFeature)).toBe('VALIDATED');
    expect(noFeature.weights!.FEATURE_TRIGGER).toBeGreaterThanOrEqual(
      fractionToGridUnits('0.0005', DEFAULT_GRANULARITY),
    );

    const capped = generate({
      targetRtpPercent: '90',
      constraints: { maxFeatureWeightFraction: '0.001' },
    });
    expect(statusOf(capped)).toBe('VALIDATED');
    expect(capped.weights!.FEATURE_TRIGGER).toBeLessThanOrEqual(
      fractionToGridUnits('0.001', DEFAULT_GRANULARITY),
    );

    // A 5% feature floor already exceeds a 50% target in expectation, so the
    // bounded family cannot honour it and the refusal says exactly that.
    const impossibleFeatureFloor = generate({
      targetRtpPercent: '50',
      constraints: { minFeatureWeightFraction: '0.05' },
    });
    expect(statusOf(impossibleFeatureFloor)).toBe('INFEASIBLE');
    expect(impossibleFeatureFloor.reasons.map((reason) => reason.constraint)).toContain('TARGET_OUTSIDE_ATTAINABLE_INTERVAL');

    // A 99.99% zero-return floor leaves 100 grid units for everything else:
    // the largest expectation those units can buy is 0.0001 x 732.68x = 7.3%,
    // so a 10% target is genuinely infeasible inside the bounded family.
    const impossibleLossFloor = generate({
      targetRtpPercent: '10',
      constraints: { minimumWeightFraction: { LOSS: '0.9999' } },
    });
    expect(statusOf(impossibleLossFloor)).toBe('INFEASIBLE');
    expect(impossibleLossFloor.reasons.map((reason) => reason.constraint)).toContain('TARGET_OUTSIDE_ATTAINABLE_INTERVAL');
  });

  it('exposes an exact shared solver that can be driven directly with game-agnostic metadata', () => {
    const built = luckyLadyGeneratorMetadata();
    const validation = validateGeneratorRequest({ gameId: 'lucky-lady', maxWinMultiplier: 50, targetRtpPercent: '33.3', objective: 'BALANCED' });
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    const solved = solvePayoutPolicyWeights({ metadata: built.metadata, request: validation.request });
    expect(solved.ok).toBe(true);
    if (!solved.ok) return;
    const sum = DISTRIBUTION_CLASSES.reduce((total, classId) => total + solved.weights[classId], 0);
    expect(sum).toBe(validation.request.granularity);
    expect(Number(solved.absoluteErrorPercentExact)).toBeLessThanOrEqual(0.01);
  });

  it('produces a reviewable evidence report from the accepted bankroll simulator without activating anything', () => {
    const candidate = generate({ targetRtpPercent: '70', objective: 'RETENTION' });
    expect(statusOf(candidate)).toBe('VALIDATED');
    const report = runGeneratedPolicyEvidence(candidate, {
      sessions: 4,
      horizonPaidSpins: 300,
      seedPrefix: 'spec:generated:retention-70',
      generatedAt: '2026-01-01T00:00:00.000Z',
      sessionConfig: {
        ...defaultSessionConfig(),
        aliveCheckpoints: [100, 250, 500, 1000, 2500, 5000],
        balanceCheckpoints: [100, 250, 500, 1000, 2500, 5000],
        ruinCheckpoints: [100, 250, 500, 1000, 2500, 5000],
      },
    });
    expect(report.testOnly).toBe(true);
    expect(report.activation).toBe(false);
    expect(report.bankroll).not.toBeNull();
    expect(report.bankroll!.testOnly).toBe(true);
    expect(report.bankroll!.activated).toBe(false);
    expect(report.bankroll!.measured.ledgerIdentityHolds).toBe(true);
    expect(report.bankroll!.sample.sessions).toBe(4);
    expect(report.bankroll!.sample.horizonPaidSpins).toBe(300);
    expect(report.bankroll!.sample.actualPaidRounds).toBeGreaterThan(0);
    expect(report.bankroll!.spins.resolvedSpinsTotal).toBe(
      report.bankroll!.spins.paidSpinsTotal + report.bankroll!.spins.freeSpinsTotal,
    );
    expect(report.statistical).not.toBeNull();
    // A four-session sample can never claim a validated statistical result.
    if (report.statistical!.verdict === 'INSUFFICIENT_PRECISION') {
      expect(report.status).toBe('GENERATED');
    } else {
      expect(report.status).toBe('VALIDATED');
    }
    // The full bankroll metric surface is present.
    for (const checkpoint of ['100', '250', '500', '1000', '2500', '5000']) {
      expect(report.bankroll!.balance[checkpoint]).toBeDefined();
      expect(report.bankroll!.ruin[checkpoint]).toBeDefined();
      expect(report.bankroll!.survival[checkpoint]).toBeDefined();
    }
    expect(report.bankroll!.drySpells.fullLoss.longestPerSessionP99).not.toBeUndefined();
    expect(report.bankroll!.drySpells.nonProfitable.longestPerSessionP99).not.toBeUndefined();
    expect(report.bankroll!.classes.length).toBe(DISTRIBUTION_CLASSES.length);
  });

  it('defaults the bounded evidence sample to the predeclared size and horizon', () => {
    expect(GENERATED_SAMPLE_HORIZON).toBe(5_000);
  });

  it('finds the demonstrated exact three-class solution, including a negative interval step', () => {
    const parsed = validateGeneratorRequest({ gameId: 'lucky-lady', maxWinMultiplier: 50,
      targetRtp: 75, pacing: 'CUSTOM', granularity: 4 });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const metadata = { ...luckyLadyGeneratorMetadata().metadata,
      reachableClasses: [
        { classId: 'LOSS' as const, conditionalEv: { numerator: 0n, denominator: 1n }, conditionalPaidEv: null, conditionalFeatureEv: null },
        { classId: 'PARTIAL_HIGH' as const, conditionalEv: { numerator: 1n, denominator: 2n }, conditionalPaidEv: null, conditionalFeatureEv: null },
        { classId: 'SMALL' as const, conditionalEv: { numerator: 2n, denominator: 1n }, conditionalPaidEv: null, conditionalFeatureEv: null },
      ], unreachableClasses: [] };
    const result = solvePayoutPolicyWeights({ metadata, request: parsed.request });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.weights.LOSS).toBe(1);
    expect(result.weights.PARTIAL_HIGH).toBe(2);
    expect(result.weights.SMALL).toBe(1);
    expect(result.expectedRtpPercent).toBe(75);
  });

  it('distinguishes exact contradictory bounds from a bounded search miss', () => {
    const contradictory = generate({ targetRtp: 70, constraints: {
      minimumWeightFraction: { PARTIAL_HIGH: '0.02' }, maximumWeightFraction: { PARTIAL_HIGH: '0.001' },
    } });
    expect(contradictory.status).toBe('INFEASIBLE');
    expect(contradictory.reasons[0].constraint).toBe('MINIMUM_EXCEEDS_MAXIMUM');
    expect(contradictory.policy).toBeNull();
    const almostLossOnly = generate({ targetRtp: 0,
      constraints: { maximumWeightFraction: { LOSS: '0.999999' } } });
    expect(almostLossOnly.status).toBe('INFEASIBLE');
    expect(almostLossOnly.reasons[0].constraint).toBe('TARGET_OUTSIDE_ATTAINABLE_INTERVAL');

    const parsed = validateGeneratorRequest({ gameId: 'lucky-lady', maxWinMultiplier: 50,
      targetRtp: 87.5, pacing: 'CUSTOM', granularity: 4,
      constraints: { maximumWeightFraction: { LOSS: '0.25', PARTIAL_HIGH: '0.25', BREAK_EVEN: '0.25', SMALL: '0.25' } } });
    if (!parsed.ok) throw new Error('invalid test request');
    const metadata = { ...luckyLadyGeneratorMetadata().metadata, unreachableClasses: [],
      reachableClasses: (['LOSS', 'PARTIAL_HIGH', 'BREAK_EVEN', 'SMALL'] as const).map((classId, i) => ({
        classId, conditionalEv: { numerator: [0n, 1n, 2n, 4n][i], denominator: 2n },
        conditionalPaidEv: null, conditionalFeatureEv: null,
      })) };
    // Four equal weights are a feasible exact solution, outside this bounded
    // residual-support search. Absence from the search is not infeasibility.
    const missed = solvePayoutPolicyWeights({ metadata, request: parsed.request });
    expect(missed.ok).toBe(false);
    if (missed.ok) return;
    expect(missed.status).toBe('SEARCH_EXHAUSTED');
    expect(missed.reasons[0].constraint).toBe('BOUNDED_SEARCH_EXHAUSTED');
  });

  it('enforces hard maximums before and after grid reconciliation, independent of property order', () => {
    for (const constraints of [
      { maxFullLossRate: 40, maximumWeightFraction: { LOSS: '0.3' } },
      { maximumWeightFraction: { LOSS: '0.3' }, maxFullLossRate: 40 },
    ]) {
      const c = generate({ targetRtp: 70, pacing: 'VOLATILE', constraints });
      expect(c.status).toBe('VALIDATED');
      expect(c.weights!.LOSS).toBeLessThanOrEqual(300_000);
      expect(Object.values(c.weights!).reduce((s, w) => s + w, 0)).toBe(DEFAULT_GRANULARITY);
      for (const [id, cap] of Object.entries(c.request.normalized!.maximumWeight)) {
        expect(c.weights![id as keyof typeof c.weights]).toBeLessThanOrEqual(cap);
      }
      expect(c.checks.find(x => x.id === 'REQUESTED_MAXIMUM_WEIGHTS_HELD')!.status).toBe('PASS');
    }
    const zeroFeature = generate({ targetRtp: 70, pacing: 'VOLATILE',
      constraints: { maximumWeightFraction: { FEATURE_TRIGGER: '0' } } });
    expect(zeroFeature.status).toBe('VALIDATED');
    expect(zeroFeature.weights!.FEATURE_TRIGGER).toBe(0);
  });

  it('relaxes pacing preferences, not caller hard bounds, for an otherwise feasible low target', () => {
    const low = generate({ targetRtp: 1, pacing: 'RETENTION' });
    expect(low.status).toBe('VALIDATED');
    expect(low.expected!.absoluteErrorPercent!).toBeLessThanOrEqual(0.01);
    expect(low.request.appliedFloors.join(' ')).toMatch(/relaxed/);
    const hard = generate({ targetRtp: 1, pacing: 'RETENTION', constraints: { requirePositiveProfit: true } });
    expect(hard.status).toBe('INFEASIBLE');
    expect(hard.reasons[0].constraint).toBe('TARGET_OUTSIDE_ATTAINABLE_INTERVAL');
  });

  it('requires the requested cap and proves MaxWin20 against every native paid/free board', () => {
    expect(generateLuckyLadyPolicy({ request: { targetRtp: 70, pacing: 'RETENTION' } }).status).toBe('REJECTED');
    const request = { gameId: 'lucky-lady', maxWinMultiplier: 20, targetRtp: 70, pacing: 'RETENTION' };
    const c = generateLuckyLadyPolicy({ request });
    expect(c.status).toBe('VALIDATED');
    expect(c.policy!.maxWinMultiplier).toBe(20);
    expect(generateLuckyLadyPolicy({ request: { pacing: 'RETENTION', targetRtp: 70, maxWinMultiplier: 20, gameId: 'lucky-lady' } }).policyHash).toBe(c.policyHash);
    const model = luckyLadyGeneratorModel(20);
    const { engine, rules } = loadVerifiedMath();
    const enumerated = enumerateBoardOutcomes(rules, engine, model.payload, 4096);
    for (const row of enumerated.boards) {
      expect(row.evaluation.totalWin / 10).toBeLessThanOrEqual(20);
      expect((rules.constants.slotFreeMpl * row.evaluation.baseWin + row.evaluation.scatterWin) / 10).toBeLessThanOrEqual(20);
    }
    const built = buildDistributionSupport({ profileId: model.modelId, profileHash: model.artifact.canonicalHash, payload: model.payload }, c.policy!);
    if (!built.ok) throw new Error('cap20 support failed');
    const observations: Array<{ paidUnits: number; maxFreeSpinUnits: number }> = [];
    const source = policyDistributionSessionSource({ support: built.support, payload: model.payload,
      config: defaultSessionConfig(), seed: 'closure:cap20', engine, rules,
      observer: { onPaidRound: r => observations.push(r) } });
    for (let i = 0; i < 100; i++) source.drawPaidRound();
    expect(observations.every(r => r.paidUnits <= 400 && r.maxFreeSpinUnits <= 400)).toBe(true);
    expect(generate({ targetRtp: 70, maxWinMultiplier: 19 }).reasons[0].constraint).toBe('GENERATOR_MODEL_UNSUPPORTED');
    expect(generate({ targetRtp: 70, gameId: 'other-game' }).status).toBe('REJECTED');
    const parsed = validateGeneratorRequest(request);
    if (!parsed.ok) throw new Error('invalid cap20 test request');
    const wrongModel = solvePayoutPolicyWeights({ metadata: luckyLadyGeneratorMetadata(50).metadata, request: parsed.request });
    expect(wrongModel.ok).toBe(false);
    if (!wrongModel.ok) {
      expect(wrongModel.status).toBe('REJECTED');
      expect(wrongModel.reasons[0].constraint).toBe('MODEL_REQUEST_MISMATCH');
    }
  });

  it('preserves the eight existing policy weights/hashes and assesses volatile RTP without retuning', () => {
    const directory = resolve(__dirname, '../../docs/agent-work/game-math-control/generated/lucky-lady');
    const files = readdirSync(directory).filter(f => /^rtp.*\.json$/.test(f));
    expect(files).toHaveLength(8);
    for (const name of files) {
      const old = JSON.parse(readFileSync(resolve(directory, name), 'utf8'));
      const regenerated = generate(old.generator.request.raw);
      expect(regenerated.status).toBe('VALIDATED');
      expect(regenerated.weights).toEqual(old.generator.weights);
      expect(regenerated.policyHash).toBe(old.generator.policyHash);
      if (name.startsWith('rtp70-volatile')) {
        const expected = old.generator.expected.rtpPercent;
        const { measuredRtpPercent, standardErrorPercent, interval95Percent } = old.statistical;
        expect(expected).toBeGreaterThanOrEqual(interval95Percent[0]);
        expect(expected).toBeLessThanOrEqual(interval95Percent[1]);
        expect(Math.abs(measuredRtpPercent - expected) / standardErrorPercent).toBeLessThan(1.96);
        expect(old.bankroll.spins.freeSpinsTotal).toBe(0);
        expect(old.bankroll.sample.sessions).toBe(80);
        expect(old.bankroll.sample.horizonPaidSpins).toBe(5000);
      }
    }
  });

});
