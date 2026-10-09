import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadVerifiedMath } from '../src/casino/games/lucky-lady/lucky-lady.math';
import {
  buildDistributionSupport,
  selectDistributionOutcome,
  type DistributionIdentity,
} from '../src/casino/games/lucky-lady/lucky-lady.distribution';
import {
  DISTRIBUTION_CLASSES,
  createCryptoMassSelector,
  createDeterministicMassSelector,
  distributionPolicyHash,
  ordinaryClassForMultiplier,
  validateDistributionPolicy,
  type DistributionClass,
  type DistributionPolicy,
  type MassSelector,
} from '../src/casino/platform/math-control/payout-distribution';
import { canonicalProfileHash } from '../src/casino/platform/math-control/math-control.analytics';
import { bigRational } from '../src/casino/platform/math-control/math-control.rational';

/**
 * Global payout distribution core: Model A classes, exact integer weights, real
 * reachable support, entry validation, immutability and selection.
 */
describe('global payout distribution core', () => {
  const { engine, rules, hashes } = loadVerifiedMath();
  const strips = rules.reels as Record<string, string[]>;
  const reelKeys = Object.keys(strips).sort(
    (a, b) => Number(a.replace('reelStrip', '')) - Number(b.replace('reelStrip', '')),
  );
  const lines = rules.lines.length;

  /** Real stop combinations, one per class, re-evaluated by the engine below. */
  const BOARD = {
    LOSS: [120, 58, 23, 5, 116],
    PARTIAL_LOW: [70, 119, 63, 118, 95],
    PARTIAL_HIGH: [72, 87, 118, 3, 55],
    BREAK_EVEN: [97, 80, 32, 64, 11],
    SMALL: [38, 61, 49, 73, 122],
    MEDIUM: [85, 72, 47, 80, 37],
    BIG: [11, 50, 52, 100, 116],
    MAX: [28, 35, 109, 7, 47],
    FEATURE_TRIGGER: [91, 38, 27, 68, 15],
  } as const;
  const CEILING_50 = [67, 51, 13, 33, 33];
  const DEAD = [63, 119, 102, 60, 108];

  const boardFor = (stops: readonly number[]) => {
    const board: Record<string, unknown> = { rp: [...stops] };
    reelKeys.forEach((key, index) => {
      const strip = strips[key];
      const stop = stops[index];
      board[`reel${index + 1}`] = [strip[stop], strip[stop + 1], strip[stop + 2], String(rules.emptyRow)];
    });
    return board as never;
  };
  const evaluate = (stops: readonly number[]) => engine.evaluate(rules, boardFor(stops), { bet: 1, lines });

  const payload = (mix: Array<{ stops: readonly number[]; weight?: number }>) => {
    const stopWeights: Record<string, number[]> = {};
    reelKeys.forEach((key, index) => {
      const weights = new Array(strips[key].length - 2).fill(0);
      for (const entry of mix) weights[entry.stops[index]] += entry.weight ?? 1;
      stopWeights[key] = weights;
    });
    return { stopWeights };
  };

  /**
   * Honest fixture identity: a real canonical hash of this test artifact, never
   * the golden dense RTP50 profile hash.
   */
  const FIXTURE_ID = 'lucky-lady.test.distribution-fixture';
  const identityFor = (policyValue: DistributionPolicy, mix: Parameters<typeof payload>[0]): DistributionIdentity => {
    const payloadValue = payload(mix);
    const hash = canonicalProfileHash({
      schemaVersion: 1,
      profileId: FIXTURE_ID,
      gameId: 'lucky-lady',
      engineSha256: hashes.engineSha256,
      rulesSha256: hashes.rulesSha256,
      policy: { maxWinScope: 'RESOLVED_SPIN', maxWinMultiplier: policyValue.maxWinMultiplier, maxBandMin: policyValue.maxBandMin },
      payload: payloadValue,
    });
    return { profileId: FIXTURE_ID, profileHash: hash, payload: payloadValue };
  };

  const policy = (overrides: Partial<DistributionPolicy> = {}): DistributionPolicy => ({
    policyId: 'lucky-lady.distribution',
    version: 1,
    gameId: 'lucky-lady',
    mathProfileId: FIXTURE_ID,
    mathProfileHash: '0'.repeat(64),
    maxWinScope: 'RESOLVED_SPIN',
    maxWinMultiplier: 60,
    granularity: 10_000,
    maxBandMin: 20,
    weights: weightsFor({}),
    ...overrides,
  });

  function weightsFor(overrides: Partial<Record<DistributionClass, number>>): DistributionPolicy['weights'] {
    return DISTRIBUTION_CLASSES.reduce(
      (accumulator, cls) => ({ ...accumulator, [cls]: overrides[cls] ?? 0 }),
      {} as DistributionPolicy['weights'],
    );
  }

  /** Build with the fixture's real hash bound into the policy. */
  const build = (
    policyOverrides: Partial<DistributionPolicy>,
    mix: Parameters<typeof payload>[0],
    maxBoards?: number,
  ) => {
    const draft = policy(policyOverrides);
    const fixture = identityFor(draft, mix);
    const bound = { ...draft, mathProfileId: fixture.profileId, mathProfileHash: fixture.profileHash };
    return buildDistributionSupport(fixture, bound, maxBoards === undefined ? {} : { maxBoards });
  };

  it('proves every canonical class with the real engine and rejects above-cap labels', () => {
    const bounds = { maxBandMin: 50, maxWinMultiplier: 60 };
    const classify = (stops: readonly number[]) => {
      const evaluation = evaluate(stops);
      return evaluation.scatterCount >= 3
        ? 'FEATURE_TRIGGER'
        : ordinaryClassForMultiplier(evaluation.totalWin / lines, bounds);
    };
    expect(classify(BOARD.LOSS)).toBe('LOSS');
    expect(classify(BOARD.PARTIAL_LOW)).toBe('PARTIAL_LOW');
    expect(classify(BOARD.PARTIAL_HIGH)).toBe('PARTIAL_HIGH');
    expect(classify(BOARD.BREAK_EVEN)).toBe('BREAK_EVEN');
    expect(classify(BOARD.SMALL)).toBe('SMALL');
    expect(classify(BOARD.MEDIUM)).toBe('MEDIUM');
    expect(classify(BOARD.BIG)).toBe('BIG');
    expect(classify(BOARD.MAX)).toBe('MAX');
    expect(evaluate(BOARD.FEATURE_TRIGGER).scatterCount).toBeGreaterThanOrEqual(3);
    expect(ordinaryClassForMultiplier(1, bounds)).toBe('BREAK_EVEN');
    expect(ordinaryClassForMultiplier(1.0001, bounds)).toBe('SMALL');
    expect(ordinaryClassForMultiplier(4.9999, bounds)).toBe('SMALL');
    expect(ordinaryClassForMultiplier(5, bounds)).toBe('MEDIUM');
    expect(ordinaryClassForMultiplier(19.9999, bounds)).toBe('MEDIUM');
    expect(ordinaryClassForMultiplier(20, bounds)).toBe('BIG');
    expect(ordinaryClassForMultiplier(49.9999, bounds)).toBe('BIG');
    expect(ordinaryClassForMultiplier(50, bounds)).toBe('MAX');
    expect(ordinaryClassForMultiplier(60, bounds)).toBe('MAX');
    // Above the cap is a rejection, never a MAX label.
    expect(() => ordinaryClassForMultiplier(60.0001, bounds)).toThrow(/DISTRIBUTION_MULTIPLIER_ABOVE_CAP/);
    expect(() => ordinaryClassForMultiplier(Number.POSITIVE_INFINITY, bounds)).toThrow(/DISTRIBUTION_MULTIPLIER_INVALID/);
    expect(() => ordinaryClassForMultiplier(Number.NaN, bounds)).toThrow(/DISTRIBUTION_MULTIPLIER_INVALID/);
  });

  it('LOSS 100 selects only real zero-return, scatter-free boards', () => {
    const built = build({ weights: weightsFor({ LOSS: 10_000 }) }, [{ stops: BOARD.LOSS }]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const selector = createDeterministicMassSelector(11n);
    for (let index = 0; index < 25; index += 1) {
      const choice = selectDistributionOutcome(built.support, selector);
      expect(choice.class).toBe('LOSS');
      const evaluation = evaluate(choice.stops);
      expect(evaluation.totalWin).toBe(0);
      expect(evaluation.scatterCount).toBe(0);
    }
    expect(built.support.ev.numerator).toBe(0n);
  });

  it('SMALL 100 selects only real boards strictly between 1x and 5x', () => {
    const built = build({ weights: weightsFor({ SMALL: 10_000 }) }, [{ stops: BOARD.SMALL }]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const selector = createDeterministicMassSelector(12n);
    for (let index = 0; index < 25; index += 1) {
      const choice = selectDistributionOutcome(built.support, selector);
      expect(choice.class).toBe('SMALL');
      const multiplier = evaluate(choice.stops).totalWin / lines;
      expect(multiplier).toBeGreaterThan(1);
      expect(multiplier).toBeLessThan(5);
    }
  });

  it('selects a known 50/25/25 mixture within a stated seeded tolerance', () => {
    const built = build(
      { weights: weightsFor({ LOSS: 5_000, PARTIAL_LOW: 2_500, SMALL: 2_500 }) },
      [{ stops: BOARD.LOSS }, { stops: BOARD.PARTIAL_LOW }, { stops: BOARD.SMALL }],
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const selector = createDeterministicMassSelector(2026n);
    const counts: Record<string, number> = { LOSS: 0, PARTIAL_LOW: 0, SMALL: 0 };
    const draws = 2_000;
    for (let index = 0; index < draws; index += 1) {
      const choice = selectDistributionOutcome(built.support, selector);
      counts[choice.class] += 1;
      const multiplier = evaluate(choice.stops).totalWin / lines;
      expect(ordinaryClassForMultiplier(multiplier, { maxBandMin: 20, maxWinMultiplier: 60 })).toBe(choice.class);
    }
    // Seeded tolerance: +/- 5 percentage points at n = 2000.
    expect(counts.LOSS / draws).toBeGreaterThan(0.45);
    expect(counts.LOSS / draws).toBeLessThan(0.55);
    expect(counts.PARTIAL_LOW / draws).toBeGreaterThan(0.20);
    expect(counts.PARTIAL_LOW / draws).toBeLessThan(0.30);
    expect(counts.SMALL / draws).toBeGreaterThan(0.20);
    expect(counts.SMALL / draws).toBeLessThan(0.30);
  });

  it('places the exact 50/25/25 cumulative class boundaries', () => {
    const built = build(
      { weights: weightsFor({ LOSS: 5_000, BREAK_EVEN: 2_500, SMALL: 2_500 }) },
      [{ stops: BOARD.LOSS }, { stops: BOARD.BREAK_EVEN }, { stops: BOARD.SMALL }],
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    // The selector is called twice per outcome: once for the class boundary and
    // once for the member inside the chosen class.
    const scripted = (value: bigint): MassSelector => {
      let calls = 0;
      return { nextBelow: () => (calls++ === 0 ? value : 0n) };
    };
    // Cumulative: [0,5000) LOSS, [5000,7500) BREAK_EVEN, [7500,10000) SMALL.
    expect(selectDistributionOutcome(built.support, scripted(0n)).class).toBe('LOSS');
    expect(selectDistributionOutcome(built.support, scripted(4_999n)).class).toBe('LOSS');
    expect(selectDistributionOutcome(built.support, scripted(5_000n)).class).toBe('BREAK_EVEN');
    expect(selectDistributionOutcome(built.support, scripted(7_499n)).class).toBe('BREAK_EVEN');
    expect(selectDistributionOutcome(built.support, scripted(7_500n)).class).toBe('SMALL');
    expect(selectDistributionOutcome(built.support, scripted(9_999n)).class).toBe('SMALL');
  });

  it('rejects weights that do not total exactly 100 percent or are not exact numbers', () => {
    const under = validateDistributionPolicy(policy({ weights: weightsFor({ LOSS: 9_999 }) }));
    expect(under.ok).toBe(false);
    if (!under.ok) expect(under.reasons.map((entry) => entry.constraint)).toContain('WEIGHTS_TOTAL_INVALID');
    const over = validateDistributionPolicy(policy({ weights: weightsFor({ LOSS: 10_001 }) }));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.reasons.map((entry) => entry.constraint)).toContain('WEIGHTS_TOTAL_INVALID');
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      const result = validateDistributionPolicy(policy({ weights: weightsFor({ LOSS: bad as number, SMALL: 10_000 }) }));
      expect(result.ok).toBe(false);
    }
  });

  it('refuses unreachable classes instead of silently carrying their weight', () => {
    const noTrigger = build(
      { weights: weightsFor({ LOSS: 5_000, FEATURE_TRIGGER: 5_000 }) },
      [{ stops: BOARD.LOSS }, { stops: BOARD.SMALL }],
    );
    expect(noTrigger.ok).toBe(false);
    if (!noTrigger.ok) expect(noTrigger.reasons.map((entry) => entry.constraint)).toContain('DISTRIBUTION_CLASS_UNREACHABLE');

    const lowCap = validateDistributionPolicy(policy({ maxWinMultiplier: 15, weights: weightsFor({ SMALL: 10_000 }) }));
    expect(lowCap.ok).toBe(true);
    const lowCapWithBig = validateDistributionPolicy(policy({
      maxWinMultiplier: 15,
      weights: weightsFor({ SMALL: 9_000, BIG: 1_000 }),
    }));
    expect(lowCapWithBig.ok).toBe(false);
    if (!lowCapWithBig.ok) {
      expect(lowCapWithBig.reasons.map((entry) => entry.constraint)).toContain('CLASS_UNREACHABLE_UNDER_CAP');
    }
  });

  it('enforces the per-resolution cap across the paid and free dimensions', () => {
    const mix = [{ stops: CEILING_50, weight: 1 }, { stops: DEAD, weight: 1_000 }];
    const refused = build(
      { maxWinMultiplier: 30, weights: weightsFor({ FEATURE_TRIGGER: 10_000 }) },
      mix,
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reasons.map((entry) => entry.constraint)).toContain('RESOLVED_SPIN_EXCEEDS_CAP');

    const accepted = build(
      { maxWinMultiplier: 55, weights: weightsFor({ FEATURE_TRIGGER: 10_000 }) },
      mix,
    );
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.support.maxWin.paidSpinMax).toBeCloseTo(20, 10);
      expect(accepted.support.maxWin.freeSpinMax).toBeCloseTo(50, 10);
      expect(accepted.support.maxWin.resolvedSpinMax).toBeLessThanOrEqual(55);
    }
  });

  it('includes the whole feature chain behind a real trigger and executes the same support payload', () => {
    const mix = [
      { stops: BOARD.LOSS, weight: 1_000 },
      { stops: BOARD.FEATURE_TRIGGER, weight: 1 },
    ];
    const supportPayload = payload(mix);
    const draft = policy({ maxWinMultiplier: 5_000, weights: weightsFor({ LOSS: 5_000, FEATURE_TRIGGER: 5_000 }) });
    const fixture = identityFor(draft, mix);
    const built = buildDistributionSupport(
      fixture,
      { ...draft, mathProfileId: fixture.profileId, mathProfileHash: fixture.profileHash },
      {},
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const trigger = built.support.classes.find((entry) => entry.class === 'FEATURE_TRIGGER')!;
    expect(trigger.conditionalFeatureEv).not.toBeNull();
    expect(Number(trigger.conditionalEv!.numerator) / Number(trigger.conditionalEv!.denominator))
      .toBeGreaterThan(Number(trigger.conditionalPaidEv!.numerator) / Number(trigger.conditionalPaidEv!.denominator));

    expect(built.support.membersByClass.FEATURE_TRIGGER.length).toBeGreaterThan(0);
    const selector = createDeterministicMassSelector(7n);
    let choice = selectDistributionOutcome(built.support, selector);
    for (let attempt = 0; attempt < 100 && choice.class !== 'FEATURE_TRIGGER'; attempt += 1) {
      choice = selectDistributionOutcome(built.support, selector);
    }
    expect(choice.class).toBe('FEATURE_TRIGGER');

    // Execute the SAME support payload: only the initial five stop draws are
    // forced, every later draw (free spins and retriggers) is delegated.
    const forced = forcedThenDelegatedRng(choice.stops, supportPayload, 5n);
    const round = engine.playRound(rules, supportPayload, { bet: 1, lines, rng: forced.rng, capture: true });
    expect(round.board.rp).toEqual(choice.stops);
    expect(round.feature.triggered).toBe(true);
    expect(round.feature.spins).toBeGreaterThanOrEqual(rules.constants.slotFreeCount);
    expect(forced.delegatedCalls()).toBeGreaterThan(0);
  });

  it('computes the exact EV of a real loss/small/high-band mixture from an independent enumeration', () => {
    const mix = [
      { stops: BOARD.LOSS, weight: 1 },
      { stops: BOARD.SMALL, weight: 3 },
      { stops: BOARD.BIG, weight: 5 },
    ];
    // Independent enumeration first: the cartesian product of the same
    // candidate stops, totalled exactly here.
    const candidates = reelKeys.map((key, reelIndex) => {
      const entries = new Map<number, bigint>();
      for (const entry of mix) {
        const stop = entry.stops[reelIndex];
        entries.set(stop, (entries.get(stop) ?? 0n) + BigInt(entry.weight ?? 1));
      }
      void key;
      return [...entries.entries()].map(([stop, weight]) => ({ stop, weight }));
    });
    const perClass = new Map<string, { mass: bigint; units: bigint }>();
    let totalMass = 0n;
    const walk = (index: number, stops: number[], mass: bigint) => {
      if (index === reelKeys.length) {
        const evaluation = evaluate(stops);
        const cls = evaluation.scatterCount >= 3
          ? 'FEATURE_TRIGGER'
          : ordinaryClassForMultiplier(evaluation.totalWin / lines, { maxBandMin: 20, maxWinMultiplier: 5_000 });
        const current = perClass.get(cls) ?? { mass: 0n, units: 0n };
        current.mass += mass;
        current.units += mass * BigInt(evaluation.totalWin);
        perClass.set(cls, current);
        totalMass += mass;
        return;
      }
      for (const candidate of candidates[index]) walk(index + 1, [...stops, candidate.stop], mass * candidate.weight);
    };
    walk(0, [], 1n);
    const covered = [...perClass.keys()];
    expect(covered.length).toBeGreaterThan(1);
    expect(covered.some((cls) => cls === 'MEDIUM' || cls === 'BIG' || cls === 'MAX')).toBe(true);

    // Spread the policy weights over the classes the real enumeration proved
    // reachable, then require the builder's EV to match this independent total.
    const share = Math.floor(10_000 / covered.length);
    const spread = Object.fromEntries(
      covered.map((cls, index) => [cls, index === covered.length - 1 ? 10_000 - share * (covered.length - 1) : share]),
    ) as Partial<Record<DistributionClass, number>>;
    const built = build({ maxWinMultiplier: 5_000, weights: weightsFor(spread) }, mix);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(totalMass).toBe(built.support.totalBoardMass);
    let expectedNumerator = 0n;
    let expectedDenominator = 1n;
    for (const [cls, value] of perClass) {
      const policyWeight = BigInt(built.support.policy.weights[cls as DistributionClass]);
      if (policyWeight === 0n) continue;
      const term = bigRational(policyWeight * value.units, 10_000n * value.mass * BigInt(lines));
      expectedNumerator = expectedNumerator * term.denominator + term.numerator * expectedDenominator;
      expectedDenominator *= term.denominator;
    }
    expect(built.support.ev.numerator * expectedDenominator).toBe(expectedNumerator * built.support.ev.denominator);
    expect(built.support.ev.numerator).toBeGreaterThan(0n);
  });

  it('fails closed when the reachable support exceeds the bounded enumeration limit', () => {
    const built = build(
      { weights: weightsFor({ LOSS: 10_000 }) },
      [{ stops: BOARD.LOSS }, { stops: BOARD.SMALL }],
      1,
    );
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.reasons.map((entry) => entry.constraint)).toContain('DISTRIBUTION_SUPPORT_TOO_LARGE');
  });

  it('validates at the support-builder entry and cannot be bypassed', () => {
    const badWeights = { ...policy(), weights: { ...weightsFor({ LOSS: 10_000 }), SMALL: Number.NaN } } as DistributionPolicy;
    const bypass = buildDistributionSupport({ profileId: FIXTURE_ID, profileHash: 'a'.repeat(64), payload: payload([{ stops: BOARD.LOSS }]) }, badWeights);
    expect(bypass.ok).toBe(false);
    if (!bypass.ok) expect(bypass.reasons.length).toBeGreaterThan(0);

    const missingGame = { ...policy({ weights: weightsFor({ LOSS: 10_000 }) }) } as Record<string, unknown>;
    delete missingGame.gameId;
    const noGame = buildDistributionSupport(
      { profileId: FIXTURE_ID, profileHash: 'a'.repeat(64), payload: payload([{ stops: BOARD.LOSS }]) },
      missingGame as never,
    );
    expect(noGame.ok).toBe(false);
  });

  it('freezes the published policy and proof against caller mutation', () => {
    const draft = policy({ weights: weightsFor({ LOSS: 10_000 }) });
    const fixture = identityFor(draft, [{ stops: BOARD.LOSS }]);
    const input = { ...draft, mathProfileId: fixture.profileId, mathProfileHash: fixture.profileHash };
    const built = buildDistributionSupport(fixture, input, {});
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const hashBefore = built.support.policyHash;
    expect(Object.isFrozen(built.support.policy)).toBe(true);
    expect(Object.isFrozen(built.support.policy.weights)).toBe(true);
    // Mutating the caller's input cannot change the published identity.
    input.weights.LOSS = 1;
    input.maxWinMultiplier = 9_999;
    expect(built.support.policyHash).toBe(hashBefore);
    expect(built.support.policy.weights.LOSS).toBe(10_000);
    // The support itself is frozen too.
    expect(Object.isFrozen(built.support)).toBe(true);
  });

  it('keeps an originating policy reference stable when a different policy is selected', () => {
    const supportA = build(
      { policyId: 'lucky-lady.distribution.a', weights: weightsFor({ LOSS: 10_000 }) },
      [{ stops: BOARD.LOSS }],
    );
    const supportB = build(
      { policyId: 'lucky-lady.distribution.b', weights: weightsFor({ SMALL: 10_000 }) },
      [{ stops: BOARD.SMALL }],
    );
    expect(supportA.ok && supportB.ok).toBe(true);
    if (!supportA.ok || !supportB.ok) return;
    expect(supportA.support.policyHash).not.toBe(supportB.support.policyHash);
    expect(supportA.support.policyHash).toBe(distributionPolicyHash(supportA.support.policy));
    const picked = selectDistributionOutcome(supportA.support, createDeterministicMassSelector(3n));
    const fingerprint = JSON.stringify({ class: picked.class, stops: picked.stops });
    selectDistributionOutcome(supportB.support, createDeterministicMassSelector(3n));
    expect(JSON.stringify({ class: picked.class, stops: picked.stops })).toBe(fingerprint);
    expect(supportA.support.policyHash).toBe(distributionPolicyHash(supportA.support.policy));
  });

  it('produces identical selections for identical and concurrent draws without shared state', async () => {
    const built = build(
      { weights: weightsFor({ LOSS: 5_000, SMALL: 5_000 }) },
      [{ stops: BOARD.LOSS }, { stops: BOARD.SMALL }],
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const first = selectDistributionOutcome(built.support, createDeterministicMassSelector(99n));
    const second = selectDistributionOutcome(built.support, createDeterministicMassSelector(99n));
    expect(second).toEqual(first);
    const concurrent = await Promise.all([
      Promise.resolve().then(() => selectDistributionOutcome(built.support, createDeterministicMassSelector(99n))),
      Promise.resolve().then(() => selectDistributionOutcome(built.support, createDeterministicMassSelector(99n))),
    ]);
    expect(concurrent[0]).toEqual(first);
    expect(concurrent[1]).toEqual(first);
  });

  it('refuses a divergent feature chain rather than inventing an EV', () => {
    const built = build(
      { maxWinMultiplier: 1_000, weights: weightsFor({ FEATURE_TRIGGER: 10_000 }) },
      [{ stops: BOARD.FEATURE_TRIGGER }],
    );
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.reasons.map((entry) => entry.constraint)).toContain('CLASS_EV_UNKNOWN');
  });

  it('rejects player, session, balance, history and seed inputs', () => {
    for (const field of ['userId', 'playerId', 'sessionId', 'balance', 'history', 'seed']) {
      const result = validateDistributionPolicy({ ...policy(), [field]: 'x' } as never);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasons.map((entry) => entry.constraint)).toContain('UNKNOWN_FIELD');
    }
  });

  it('draws bounded OS randomness above 2^48 and 2^96 without modulo bias or out-of-range calls', () => {
    for (const mass of [2n ** 48n, 2n ** 48n + 1n, 2n ** 96n + 7n]) {
      const maxima: number[] = [];
      let counter = 0;
      const selector = createCryptoMassSelector((maxExclusive) => {
        // crypto.randomInt rejects anything above 2^48 - 1.
        expect(maxExclusive).toBeGreaterThan(0);
        expect(maxExclusive).toBeLessThanOrEqual(2 ** 48);
        maxima.push(maxExclusive);
        counter += 1;
        return counter % maxExclusive;
      });
      for (let index = 0; index < 20; index += 1) {
        const value = selector.nextBelow(mass);
        expect(value).toBeGreaterThanOrEqual(0n);
        expect(value).toBeLessThan(mass);
      }
      expect(maxima.length).toBeGreaterThanOrEqual(20);
    }

    // Rejection boundary: the first candidate is out of range, the second is in.
    const draws = [2 ** 47 - 1, 1, 0, 0];
    let cursor = 0;
    const rejecting = createCryptoMassSelector(() => draws[cursor++]);
    expect(rejecting.nextBelow(2n ** 47n + 1n)).toBe(0n);
    expect(cursor).toBe(4);
  });

  it('keeps the production selector seedless while tests inject their own source', () => {
    const source = readFileSync(
      join(__dirname, '..', 'src', 'casino', 'platform', 'math-control', 'payout-distribution.ts'),
      'utf8',
    );
    expect(source).toContain("import { randomInt } from 'node:crypto'");
    expect(source).toContain('randomInt(maxExclusive)');
    expect(source).toContain('CRYPTO_CHUNK_BITS');
    expect(source).toMatch(/createCryptoMassSelector\(\s*draw: \(maxExclusive: number\) => number = \(maxExclusive\) => randomInt\(maxExclusive\)/);
    expect(source).not.toMatch(/createCryptoMassSelector\([^)]*seed/i);
  });

  /** First five draws pick the selected board, then real draws take over. */
  function forcedThenDelegatedRng(stops: readonly number[], payloadValue: { stopWeights?: Record<string, number[]> }, seed: bigint) {
    const delegated = createDeterministicMassSelector(seed);
    const forcedDraws: number[] = [];
    reelKeys.forEach((key, index) => {
      const weights = payloadValue.stopWeights![key];
      let before = 0;
      for (let position = 0; position < stops[index]; position += 1) before += weights[position];
      forcedDraws.push(before + 1);
    });
    let cursor = 0;
    let delegatedCalls = 0;
    return {
      rng: {
        int: (min: number, max: number) => {
          if (cursor < forcedDraws.length) return forcedDraws[cursor++];
          delegatedCalls += 1;
          return min + Number(delegated.nextBelow(BigInt(max - min + 1)));
        },
      },
      delegatedCalls: () => delegatedCalls,
    };
  }
});
