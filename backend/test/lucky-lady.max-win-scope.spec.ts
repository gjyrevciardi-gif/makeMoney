import { loadVerifiedMath } from '../src/casino/games/lucky-lady/lucky-lady.math';
import { analyzeProfileExact } from '../src/casino/games/lucky-lady/lucky-lady.exact';
import {
  LuckyLadyMathAdapter,
  resolveMaxWinPin,
  resolvedSpinMaximums,
} from '../src/casino/games/lucky-lady/lucky-lady.math-adapter';
import { LuckyLadyAdapter } from '../src/casino/games/lucky-lady/lucky-lady.adapter';
import { defaultSessionConfig } from '../src/casino/platform/math-control/math-control.bankroll';
import { validatePolicy } from '../src/casino/platform/math-control/math-control.policy';
import type {
  MaxWinPin,
  MathPolicy,
  MathProfileArtifact,
  ValidationOptions,
} from '../src/casino/platform/math-control/math-control.types';

/**
 * RESOLVED_SPIN max-win scope, proved against the real Lucky Lady engine.
 *
 * The scope bounds each individual mathematical resolution - one paid spin or
 * one free spin (feature multiplier applied, free stake never zero) - by
 * `maxWinMultiplier` times the locked originating paid stake. The feature chain
 * and its retriggers aggregate without a ceiling.
 */
describe('RESOLVED_SPIN max-win scope', () => {
  const { engine, rules, hashes } = loadVerifiedMath();
  const strips = rules.reels as Record<string, string[]>;
  const reelKeys = Object.keys(strips).sort(
    (a, b) => Number(a.replace('reelStrip', '')) - Number(b.replace('reelStrip', '')),
  );
  const lines = rules.lines.length;
  const adapter = new LuckyLadyMathAdapter();

  const boardFor = (stops: readonly number[]) => {
    const board: Record<string, unknown> = { rp: [...stops] };
    reelKeys.forEach((key, index) => {
      const strip = strips[key];
      const stop = stops[index];
      board[`reel${index + 1}`] = [strip[stop], strip[stop + 1], strip[stop + 2], String(rules.emptyRow)];
    });
    return board as never;
  };

  /** A profile whose reachable boards are exactly the listed (stops, weight) pairs. */
  const payloadForWeighted = (entries: Array<{ stops: readonly number[]; weight: number }>) => {
    const stopWeights: Record<string, number[]> = {};
    reelKeys.forEach((key, index) => {
      const weights = new Array(strips[key].length - 2).fill(0);
      for (const entry of entries) weights[entry.stops[index]] += entry.weight;
      stopWeights[key] = weights;
    });
    return { stopWeights };
  };
  const payloadFor = (stops: readonly number[]) => payloadForWeighted([{ stops, weight: 1 }]);

  /**
   * Real stop combinations, found once by scanning the accepted evaluator over
   * the original strips. Each is re-evaluated below, so the evidence is the
   * engine's own output rather than a cached constant.
   */
  /**
   * Real board whose per-resolution ceiling is exactly 50x: 150 units of line
   * wins (20x) plus a 4-scatter pattern worth 50 units, so a free spin with the
   * x3 feature multiplier reaches 3 x 150 / 10 + 50 / 10 = 50x.
   */
  const CEILING_50_BOARD = [67, 51, 13, 33, 33];
  /** Real triggerable board whose cross-product ceiling stays well under 50x. */
  const TRIGGER_BOARD = [28, 59, 23, 57, 101];
  /** A completely dead board, used to keep a feature payload subcritical. */
  const ZERO_BOARD = [63, 119, 102, 60, 108];

  const policyFor = (maxWinScope: MathPolicy['maxWinScope'], maxWinMultiplier: number, maxWinEnabled?: boolean): MathPolicy => ({
    gameId: 'lucky-lady',
    targetRtpPercent: 50,
    maxWinMultiplier,
    maxWinScope,
    ...(maxWinEnabled === undefined ? {} : { maxWinEnabled }),
    pacing: 'BALANCED',
    customPacing: null,
    hitRate: { mode: 'AUTO' },
    partialReturn: 'LOW',
    volatility: 'MED',
    bigWinMinMultiplier: 10,
    bigWinMaxMultiplier: 50,
    featureContribution: { minPercent: 0, maxPercent: 60 },
    presets: [],
  });

  const artifactFor = (payload: unknown, policy: MathPolicy): MathProfileArtifact => ({
    schemaVersion: 1,
    profileId: 'lucky-lady.max-win-scope.probe',
    gameId: 'lucky-lady',
    engineSha256: hashes.engineSha256,
    rulesSha256: hashes.rulesSha256,
    policy,
    payload,
    canonicalHash: '0'.repeat(64),
    createdAt: new Date(0).toISOString(),
  });

  const optionsFor = (): ValidationOptions => ({
    validationSeedPrefix: 'max-win-scope:validation',
    bankrollSeedPrefix: 'max-win-scope:bankroll',
    monteCarloRounds: 200,
    bankrollSessions: 5,
    sessionConfig: {
      ...defaultSessionConfig(),
      horizonPaidSpins: 100,
      aliveCheckpoints: [100],
      balanceCheckpoints: [100],
      ruinCheckpoints: [100],
    },
    rtpTolerancePercent: 5,
  });

  const capCheck = async (policy: MathPolicy, artifact: MathProfileArtifact) => {
    const outcome = await adapter.validateProfile(policy, artifact, optionsFor());
    const check = outcome.checks.find((entry) => entry.id === 'MAX_WIN_RESOLVED_SPIN_WITHIN_CEILING');
    expect(check).toBeDefined();
    return check!;
  };

  it('proves a real reachable 50x paid spin and enforces the 49.99 / 50 / 50.01 boundary', async () => {
    // The board is real: 150 units of line wins and a 3-scatter pattern.
    const evaluation = engine.evaluate(rules, boardFor(CEILING_50_BOARD), { bet: 1, lines });
    expect(evaluation.baseWin).toBe(150);
    expect(evaluation.scatterCount).toBe(3);
    expect((evaluation.baseWin + evaluation.scatterWin) / lines).toBeCloseTo(20, 10);
    // Paired with a dead board so the simulated chain stays subcritical while
    // the support proof still sees the 50x resolution.
    const payload = payloadForWeighted([
      { stops: CEILING_50_BOARD, weight: 1 },
      { stops: ZERO_BOARD, weight: 1000 },
    ]);

    const analysis = analyzeProfileExact(rules, engine, payload, 4_096);
    const perSpin = resolvedSpinMaximums(analysis);
    expect(analysis.reachableBoards).toBe(32);
    // The paid spin reaches 20x and the free spin reaches exactly 50x: the
    // per-resolution ceiling is 50, driven by the free spin, not by a sample.
    expect(perSpin.paid).toBeCloseTo(20, 10);
    expect(perSpin.free).toBeCloseTo(50, 10);
    expect(perSpin.ceiling).toBeCloseTo(50, 10);

    const rejected = await capCheck(policyFor('RESOLVED_SPIN', 49.99, true), artifactFor(payload, policyFor('RESOLVED_SPIN', 49.99, true)));
    expect(rejected.status).toBe('FAIL');
    expect(String(rejected.detail)).toMatch(/50\.0000x/);

    const exact = await capCheck(policyFor('RESOLVED_SPIN', 50, true), artifactFor(payload, policyFor('RESOLVED_SPIN', 50, true)));
    expect(exact.status).toBe('PASS');

    const above = await capCheck(policyFor('RESOLVED_SPIN', 50.01, true), artifactFor(payload, policyFor('RESOLVED_SPIN', 50.01, true)));
    expect(above.status).toBe('PASS');

    // The cap is expressed against the locked paid stake: 50 x 0.20 PTS = 10 PTS.
    const paidStakeUnits = 20;
    expect((perSpin.ceiling! * paidStakeUnits) / 100).toBeCloseTo(10, 10);
    expect((exact.value as Record<string, unknown>).provedFreeSpinMax).toBeCloseTo(50, 10);
  });

  it('accepts a feature profile where paid and free spins are individually inside the cap but the chain aggregates above it', async () => {
    // A real triggerable board that still pays at most the cap on the paid spin.
    const evaluation = engine.evaluate(rules, boardFor(TRIGGER_BOARD), { bet: 1, lines });
    expect(evaluation.scatterCount).toBeGreaterThanOrEqual(3);
    expect(evaluation.totalWin).toBeLessThanOrEqual(500);
    const dead = engine.evaluate(rules, boardFor(ZERO_BOARD), { bet: 1, lines });
    expect(dead.totalWin).toBe(0);
    expect(dead.scatterCount).toBe(0);
    // The trigger board is reachable, but heavily outweighed so the simulated
    // chain stays subcritical while the support proof still sees the trigger.
    const payload = payloadForWeighted([
      { stops: TRIGGER_BOARD, weight: 1 },
      { stops: ZERO_BOARD, weight: 1000 },
    ]);
    const analysis = analyzeProfileExact(rules, engine, payload, 4_096);
    const perSpin = resolvedSpinMaximums(analysis);

    // Every single resolution is inside 50x ...
    expect(analysis.triggerProbability).toBeGreaterThan(0);
    expect(analysis.reachableBoards).toBe(32);
    expect(perSpin.paid).toBeLessThanOrEqual(50);
    expect(perSpin.free).not.toBeNull();
    expect(perSpin.free!).toBeLessThanOrEqual(50);
    // ... while the 15-spin award alone already aggregates past the per-spin cap,
    // and the aggregate is deliberately uncapped (a retrigger can extend it).
    const award = rules.constants.slotFreeCount;
    expect(award * perSpin.free!).toBeGreaterThan(50);
    expect(analysis.maxRoundMultiplier).toBe(Number.POSITIVE_INFINITY);

    const check = await capCheck(policyFor('RESOLVED_SPIN', 50, true), artifactFor(payload, policyFor('RESOLVED_SPIN', 50, true)));
    expect(check.status).toBe('PASS');
    expect((check.value as Record<string, unknown>).provedFreeSpinMax).toBeCloseTo(perSpin.free!, 10);

    const outcome = await adapter.validateProfile(
      policyFor('RESOLVED_SPIN', 50, true),
      artifactFor(payload, policyFor('RESOLVED_SPIN', 50, true)),
      optionsFor(),
    );
    const uncapped = outcome.checks.find((entry) => entry.id === 'MAX_WIN_AGGREGATE_DELIBERATELY_UNCAPPED');
    expect(uncapped?.status).toBe('PASS');
    // The whole-round identity is not asserted under this scope.
    expect(outcome.checks.find((entry) => entry.id === 'RTP_WITHIN_BOUND_TIMES_HIT_RATE')).toBeUndefined();
  });

  it('freezes the cap a round was opened with when a different cap is selected later', () => {
    const fifty = policyFor('RESOLVED_SPIN', 50, true);
    const twenty = policyFor('RESOLVED_SPIN', 20, true);
    const openedAtFifty = resolveMaxWinPin(fifty, 'lucky-lady.rtp50.new', 'a'.repeat(64));
    const storedRoundPin = JSON.parse(JSON.stringify(openedAtFifty)) as typeof openedAtFifty;

    expect(openedAtFifty).toEqual({
      maxWinEnabled: true,
      maxWinScope: 'RESOLVED_SPIN',
      maxWinMultiplier: 50,
      profileId: 'lucky-lady.rtp50.new',
      profileHash: 'a'.repeat(64),
    });

    // A new round under the new cap gets 20 ...
    const openedAtTwenty = resolveMaxWinPin(twenty, 'lucky-lady.rtp20.new', 'b'.repeat(64));
    expect(openedAtTwenty.maxWinMultiplier).toBe(20);

    // ... and the already-opened round keeps 50, byte for byte.
    expect(storedRoundPin).toEqual(openedAtFifty);
    expect(JSON.parse(JSON.stringify(storedRoundPin))).toEqual(openedAtFifty);
    // Resolving a pin is pure: it never mutates the policy it reads.
    expect(fifty.maxWinMultiplier).toBe(50);
    expect(twenty.maxWinMultiplier).toBe(20);
  });

  it('keeps legacy and missing metadata inert and never reinterprets it', () => {
    const legacy = policyFor('PAID_ROUND_BEFORE_OPTIONAL_GAMBLE', 50);
    const legacyPin = resolveMaxWinPin(legacy, 'lucky-lady.rtp50.v1', 'c'.repeat(64));
    expect(legacyPin.maxWinEnabled).toBe(false);
    expect(legacyPin.maxWinScope).toBe('PAID_ROUND_BEFORE_OPTIONAL_GAMBLE');

    const resolvedSpinWithoutFlag = policyFor('RESOLVED_SPIN', 50);
    expect(resolveMaxWinPin(resolvedSpinWithoutFlag, 'p', 'd'.repeat(64)).maxWinEnabled).toBe(false);
    // Generation adds the explicit flag for a new RESOLVED_SPIN profile; that is
    // asserted by the analyzer path rather than by reinterpreting stored data.
    expect(resolvedSpinWithoutFlag.maxWinEnabled).toBeUndefined();
  });
});


describe('RESOLVED_SPIN pin, feature resolution, recovery and replay (in-memory adapter seams)', () => {
  const { engine, rules, hashes } = loadVerifiedMath();
  const strips = rules.reels as Record<string, string[]>;
  const reelKeys = Object.keys(strips).sort(
    (a, b) => Number(a.replace('reelStrip', '')) - Number(b.replace('reelStrip', '')),
  );
  const TRIGGER_STOPS = [28, 59, 23, 57, 101];
  const DEAD_STOPS = [63, 119, 102, 60, 108];

  const PAYLOAD = (() => {
    const stopWeights: Record<string, number[]> = {};
    reelKeys.forEach((key, index) => {
      const weights = new Array(strips[key].length - 2).fill(0);
      weights[TRIGGER_STOPS[index]] += 1;
      weights[DEAD_STOPS[index]] += 1000;
      stopWeights[key] = weights;
    });
    return { stopWeights };
  })();

  const policyFor = (
    maxWinScope: MathPolicy['maxWinScope'],
    maxWinMultiplier: number,
    maxWinEnabled?: boolean,
  ): MathPolicy => ({
    gameId: 'lucky-lady',
    targetRtpPercent: 50,
    maxWinMultiplier,
    maxWinScope,
    ...(maxWinEnabled === undefined ? {} : { maxWinEnabled }),
    pacing: 'BALANCED',
    customPacing: null,
    hitRate: { mode: 'AUTO' },
    partialReturn: 'LOW',
    volatility: 'MED',
    bigWinMinMultiplier: 10,
    bigWinMaxMultiplier: 50,
    featureContribution: { minPercent: 0, maxPercent: 60 },
    presets: [],
  });

  /** The draw value that selects one stop under the harness weights. */
  const drawFor = (reelIndex: number, stop: number) => {
    const weights = (PAYLOAD.stopWeights as Record<string, number[]>)[reelKeys[reelIndex]];
    let before = 0;
    for (let index = 0; index < stop; index += 1) before += weights[index];
    return before + 1;
  };

  /** A scripted RNG that plays an explicit list of boards and refuses extras. */
  const scriptedRng = (boards: number[][]) => {
    const draws: number[] = [];
    for (const board of boards) {
      board.forEach((stop, reelIndex) => draws.push(drawFor(reelIndex, stop)));
    }
    let cursor = 0;
    return {
      int: (min: number, max: number) => {
        if (cursor >= draws.length) throw new Error('scripted rng exhausted: an unexpected extra draw was requested');
        const value = draws[cursor];
        cursor += 1;
        if (value < min || value > max) throw new Error(`scripted draw ${value} outside ${min}..${max}`);
        return value;
      },
      remaining: () => draws.length - cursor,
    };
  };

  const artifactWithCap = (maxWinMultiplier: number): MathProfileArtifact => ({
    schemaVersion: 1,
    profileId: `lucky-lady.resolved-spin.${maxWinMultiplier}`,
    gameId: 'lucky-lady',
    engineSha256: hashes.engineSha256,
    rulesSha256: hashes.rulesSha256,
    policy: policyFor('RESOLVED_SPIN', maxWinMultiplier, true),
    payload: PAYLOAD,
    canonicalHash: (maxWinMultiplier === 50 ? '5' : '2').repeat(64),
    createdAt: new Date(0).toISOString(),
  });

  const buildHarness = (scripts: Array<ReturnType<typeof scriptedRng>>) => {
    const state = {
      active: null as MathProfileArtifact | null,
      rounds: [] as Array<{ id: string; privateState: Record<string, unknown> }>,
      responses: new Map<string, unknown>(),
      prepared: new Map<string, unknown>(),
      pointerVersion: 0,
    };
    const walletRow = { id: 'wallet-1', userId: 'user-1', balance: 1_000_000n };
    const tx = {
      wallet: { findUnique: async () => walletRow },
      auditLog: { create: async () => undefined },
      casinoRound: { create: async () => ({ id: 'round' }), update: async () => undefined },
      casinoRoundAction: { create: async () => undefined },
    };
    const journal = {
      requestKey: (userId: string, requestId: string) => `${userId}:${requestId}`,
      findReplay: async (_g: string, _u: string, requestId: string) => state.responses.get(requestId) ?? null,
      findReplayIn: async (_t: unknown, _g: string, _u: string, requestId: string) => state.responses.get(requestId) ?? null,
      serialized: async <T>(_g: string, _u: string, work: (client: unknown) => Promise<T>) => work(tx),
      prepareOutcome: async (_t: unknown, outcome: { requestKey: string }) => { state.prepared.set(outcome.requestKey, outcome); },
      findPreparedIn: async (_t: unknown, key: string) => state.prepared.get(key) ?? null,
      findPrepared: async (_u: string, key: string) => state.prepared.get(key) ?? null,
      deletePrepared: async (_t: unknown, key: string) => { state.prepared.delete(key); },
      discardPrepared: async () => undefined,
      listPrepared: async () => [],
      bookAction: async (_t: unknown, params: { requestId: string; response: unknown }) => {
        state.responses.set(params.requestId, params.response);
        return params.response;
      },
      deliveringView: () => ({ actionId: null, event: null, delivered: false, acked: false }),
      acknowledge: async () => ({ actionId: null, accepted: false, reason: 'in-memory harness' }),
      receipt: async () => ({ actionId: null, event: null, delivered: false, acked: false }),
      assertReceiptIn: async () => undefined,
      assertNoForeignPrepared: async () => undefined,
      conflict: (code: string, message: string) => Object.assign(new Error(message), { code }),
      conflictSemantics: () => { throw new Error('CONFLICT_SEMANTICS'); },
    };
    const rounds = {
      currentRound: async () => state.rounds[state.rounds.length - 1] ?? null,
      currentRoundIn: async () => state.rounds[state.rounds.length - 1] ?? null,
      createRound: async (_t: unknown, params: { id: string }) => {
        state.rounds.push({ id: params.id, privateState: {} });
        return { id: params.id, settledAt: null };
      },
      persistRound: async (_t: unknown, round: { id: string }, params: { privateState: unknown }) => {
        const stored = state.rounds.find((entry) => entry.id === round.id)!;
        stored.privateState = params.privateState as Record<string, unknown>;
      },
      ownedRound: async () => { throw new Error('not used'); },
    };
    const wallet = {
      balance: async () => walletRow.balance,
      balancePoints: async () => Number(walletRow.balance),
      debit: async () => undefined,
      credit: async () => undefined,
      refund: async () => undefined,
    };
    const platform = { capabilities: {}, wallet, journal, rounds } as never;
    const configs = { assertPlayable: async () => ({ minStake: 1n, maxStake: 1_000_000n }) } as never;
    const registry = { assertEnabled: () => undefined } as never;
    const mathControl = {
      activeProfile: async () => (state.active
        ? { artifact: state.active, validationId: 'validation-1', version: (state.pointerVersion += 1) }
        : null),
    } as never;
    const prisma = { wallet: tx.wallet } as never;
    let scriptIndex = 0;
    const adapter = new LuckyLadyAdapter(
      prisma, platform, configs, registry,
      { rngFactory: () => scripts[scriptIndex++] as never },
      mathControl,
    );
    return { adapter, state };
  };

  const context = { gameId: 'lucky-lady', userId: 'user-1', sessionId: '11111111-2222-4333-8444-555555555555' };
  const headersFor = (state: { rounds: Array<{ id: string; privateState: Record<string, unknown> }> }) => {
    const current = state.rounds[state.rounds.length - 1];
    const version = (current?.privateState as { version?: number } | undefined)?.version ?? 1;
    return { 'x-pilot-version': String(version), 'x-pilot-round': current?.id ?? 'none' };
  };

  it('pins the cap on a new paid round, resolves 15 free spins with no extra draws, and replays without redrawing', async () => {
    const script = scriptedRng([TRIGGER_STOPS, ...Array.from({ length: 15 }, () => DEAD_STOPS)]);
    const { adapter, state } = buildHarness([script]);
    state.active = artifactWithCap(50);

    const spin = await adapter.execute(context, {
      event: 'bet',
      body: { slotEvent: 'bet', slotBet: 20, slotLines: 10 },
      headers: { 'x-pilot-version': '1', 'x-pilot-round': 'none' },
      requestId: 'pin-round-1',
    }) as { recovery: { roundId: string } };

    const stored = state.rounds[state.rounds.length - 1];
    const pinned = stored.privateState as { maxWin: MaxWinPin | null; freeTotal: number; engineSha256: string };
    expect(pinned.maxWin).toEqual({
      maxWinEnabled: true,
      maxWinScope: 'RESOLVED_SPIN',
      maxWinMultiplier: 50,
      profileId: 'lucky-lady.resolved-spin.50',
      profileHash: '5'.repeat(64),
    });
    expect(pinned.freeTotal).toBe(15);
    // The paid round already resolved the whole 15-spin sequence: nothing is
    // left for the free-spin actions to draw.
    const drawsLeftAfterBet = script.remaining();
    expect(drawsLeftAfterBet).toBe(0);

    for (let index = 0; index < 15; index += 1) {
      await adapter.execute(context, {
        event: 'freespin',
        body: { slotEvent: 'freespin', slotBet: 20, slotLines: 10 },
        headers: headersFor(state),
        requestId: `pin-free-${index}`,
      });
    }
    expect(script.remaining()).toBe(0);

    const settings = await adapter.read(context, 'getSettings', {}) as unknown as { recovery: { roundId: string } };
    expect(settings.recovery.roundId).toBe(stored.id);

    const replayed = await adapter.execute(context, {
      event: 'bet',
      body: { slotEvent: 'bet', slotBet: 20, slotLines: 10 },
      headers: { 'x-pilot-version': '1', 'x-pilot-round': 'none' },
      requestId: 'pin-round-1',
    }) as { recovery: { roundId: string } };
    expect(replayed.recovery.roundId).toBe(stored.id);
    // Recovery and replay performed no draw and created no second round.
    expect(script.remaining()).toBe(0);
    expect(state.rounds.length).toBe(1);
    expect(spin.recovery.roundId).toBe(stored.id);
  });

  it('resolves a 30-spin retrigger chain inside the per-spin cap while the aggregate exceeds it', async () => {
    const script = scriptedRng([TRIGGER_STOPS, TRIGGER_STOPS, ...Array.from({ length: 29 }, () => DEAD_STOPS)]);
    const { adapter, state } = buildHarness([script]);
    state.active = artifactWithCap(50);

    await adapter.execute(context, {
      event: 'bet',
      body: { slotEvent: 'bet', slotBet: 20, slotLines: 10 },
      headers: { 'x-pilot-version': '1', 'x-pilot-round': 'none' },
      requestId: 'retrigger-round-1',
    });

    const stored = state.rounds[state.rounds.length - 1];
    const pinned = stored.privateState as {
      maxWin: MaxWinPin | null;
      freeTotal: number;
      sequence: Array<{ retriggered: boolean }>;
      engineSha256: string;
    };
    expect(pinned.maxWin?.maxWinMultiplier).toBe(50);
    // The paid round resolves the whole chain up front: 15 awarded spins plus
    // one retrigger that the played sequence reveals.
    expect(pinned.freeTotal).toBe(15);
    expect(pinned.sequence.filter((spin) => spin.retriggered)).toHaveLength(1);
    expect(script.remaining()).toBe(0);
    // Playing the sequence (no draws) grows the total to 30 resolved spins.
    for (let index = 0; index < 30; index += 1) {
      const live = state.rounds[state.rounds.length - 1].privateState as { phase: string; freeTotal: number; fsIndex: number };
      if (live.phase !== 'FREE_SPINS') break;
      await adapter.execute(context, {
        event: 'freespin',
        body: { slotEvent: 'freespin', slotBet: 20, slotLines: 10 },
        headers: headersFor(state),
        requestId: `retrigger-free-${index}`,
      });
    }
    const resolved = state.rounds[state.rounds.length - 1].privateState as { freeTotal: number; fsIndex: number };
    expect(resolved.freeTotal).toBe(30);
    expect(script.remaining()).toBe(0);

    const analysis = analyzeProfileExact(rules, engine, PAYLOAD, 4_096);
    const perSpin = resolvedSpinMaximums(analysis);
    expect(perSpin.ceiling).not.toBeNull();
    expect(perSpin.ceiling!).toBeLessThanOrEqual(50);
    expect(resolved.freeTotal * perSpin.ceiling!).toBeGreaterThan(50);
  });

  it('keeps an already-opened round on 50 while a new profile with 20 pins 20', async () => {
    const first = scriptedRng([DEAD_STOPS]);
    const second = scriptedRng([DEAD_STOPS]);
    const { adapter, state } = buildHarness([first, second]);
    state.active = artifactWithCap(50);
    await adapter.execute(context, {
      event: 'bet',
      body: { slotEvent: 'bet', slotBet: 20, slotLines: 10 },
      headers: { 'x-pilot-version': '1', 'x-pilot-round': 'none' },
      requestId: 'lock-round-1',
    });
    const firstRound = state.rounds[0];
    const snapshot = JSON.stringify(firstRound.privateState);
    expect((firstRound.privateState as { maxWin: MaxWinPin }).maxWin.maxWinMultiplier).toBe(50);

    // Select a 20x profile and open a NEW paid round.
    state.active = artifactWithCap(20);
    await adapter.execute(context, {
      event: 'bet',
      body: { slotEvent: 'bet', slotBet: 20, slotLines: 10 },
      headers: headersFor(state),
      requestId: 'lock-round-2',
    });
    const secondRound = state.rounds[1];
    expect((secondRound.privateState as { maxWin: MaxWinPin }).maxWin.maxWinMultiplier).toBe(20);
    // The earlier round is byte-for-byte unchanged: it is never re-capped.
    expect(JSON.stringify(firstRound.privateState)).toBe(snapshot);
    expect((firstRound.privateState as { maxWin: MaxWinPin }).maxWin.maxWinMultiplier).toBe(50);
  });
});

describe('RESOLVED_SPIN metadata gates and strict cap arithmetic', () => {
  const { engine, rules, hashes } = loadVerifiedMath();
  const strips = rules.reels as Record<string, string[]>;
  const reelKeys = Object.keys(strips).sort(
    (a, b) => Number(a.replace('reelStrip', '')) - Number(b.replace('reelStrip', '')),
  );
  const lines = rules.lines.length;
  const adapter = new LuckyLadyMathAdapter();
  const DEAD = [63, 119, 102, 60, 108];
  const EXACT_50 = [67, 51, 13, 33, 33];
  const ABOVE_50 = [21, 27, 13, 30, 1];

  const payloadFor = (stops: readonly number[], weight = 1, deadWeight = 1000) => {
    const stopWeights: Record<string, number[]> = {};
    reelKeys.forEach((key, index) => {
      const weights = new Array(strips[key].length - 2).fill(0);
      weights[stops[index]] += weight;
      weights[DEAD[index]] += deadWeight;
      stopWeights[key] = weights;
    });
    return { stopWeights };
  };

  const optionsFor = (): ValidationOptions => ({
    validationSeedPrefix: 'metadata:validation',
    bankrollSeedPrefix: 'metadata:bankroll',
    monteCarloRounds: 200,
    bankrollSessions: 5,
    sessionConfig: {
      ...defaultSessionConfig(),
      horizonPaidSpins: 100,
      aliveCheckpoints: [100],
      balanceCheckpoints: [100],
      ruinCheckpoints: [100],
    },
    rtpTolerancePercent: 5,
  });

  const policy = (overrides: Partial<MathPolicy> = {}): MathPolicy => ({
    gameId: 'lucky-lady',
    targetRtpPercent: 50,
    maxWinMultiplier: 50,
    maxWinScope: 'RESOLVED_SPIN',
    maxWinEnabled: true,
    pacing: 'BALANCED',
    customPacing: null,
    hitRate: { mode: 'AUTO' },
    partialReturn: 'LOW',
    volatility: 'MED',
    bigWinMinMultiplier: 10,
    bigWinMaxMultiplier: 50,
    featureContribution: { minPercent: 0, maxPercent: 60 },
    presets: [],
    ...overrides,
  });

  const artifact = (stops: readonly number[], policyValue: MathPolicy): MathProfileArtifact => ({
    schemaVersion: 1,
    profileId: 'lucky-lady.metadata.probe',
    gameId: 'lucky-lady',
    engineSha256: hashes.engineSha256,
    rulesSha256: hashes.rulesSha256,
    policy: policyValue,
    payload: payloadFor(stops),
    canonicalHash: '9'.repeat(64),
    createdAt: new Date(0).toISOString(),
  });

  const checkById = async (policyValue: MathPolicy, stops: readonly number[]) => {
    const outcome = await adapter.validateProfile(policyValue, artifact(stops, policyValue), optionsFor());
    return outcome.checks;
  };

  it('transports maxWinEnabled verbatim and rejects a non-boolean', () => {
    const withTrue = validatePolicy(policy({ maxWinEnabled: true }) as never);
    expect(withTrue.ok).toBe(true);
    if (withTrue.ok) expect(withTrue.policy.maxWinEnabled).toBe(true);

    const withFalse = validatePolicy(policy({ maxWinEnabled: false }) as never);
    expect(withFalse.ok).toBe(true);
    if (withFalse.ok) expect(withFalse.policy.maxWinEnabled).toBe(false);

    const absentPolicy = policy();
    delete (absentPolicy as { maxWinEnabled?: boolean }).maxWinEnabled;
    const absent = validatePolicy(absentPolicy as never);
    expect(absent.ok).toBe(true);
    if (absent.ok) expect('maxWinEnabled' in absent.policy).toBe(false);

    const invalid = validatePolicy(policy({ maxWinEnabled: 'yes' as unknown as boolean }) as never);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.errors.map((entry) => entry.constraint)).toContain('MAX_WIN_ENABLED_INVALID');
  });

  it('fails closed on missing, invalid or unasserted metadata for the new scope', async () => {
    const missingPolicy = policy();
    delete (missingPolicy as { maxWinEnabled?: boolean }).maxWinEnabled;
    const missing = await checkById(missingPolicy, EXACT_50);
    expect(missing.find((entry) => entry.id === 'MAX_WIN_METADATA_MISSING')?.status).toBe('FAIL');

    const unasserted = await checkById(policy({ maxWinEnabled: false }), EXACT_50);
    expect(unasserted.find((entry) => entry.id === 'MAX_WIN_METADATA_NOT_ASSERTED')?.status).toBe('UNSUPPORTED');
    expect(unasserted.find((entry) => entry.id === 'MAX_WIN_RESOLVED_SPIN_WITHIN_CEILING')).toBeUndefined();

    const invalidPolicy = policy({ maxWinEnabled: 'yes' as unknown as boolean });
    const invalid = await checkById(invalidPolicy, EXACT_50);
    expect(invalid.find((entry) => entry.id === 'MAX_WIN_METADATA_INVALID')?.status).toBe('FAIL');
  });

  it('applies a fixed cap of 50 with no tolerance to below, exact and above profiles', async () => {
    const below = analyzeProfileExact(rules, engine, payloadFor(EXACT_50, 1, 0), 4_096);
    // A real profile whose per-resolution ceiling is far below the cap.
    const lowPayload = analyzeProfileExact(rules, engine, payloadFor(DEAD.length ? [28, 59, 23, 57, 101] : DEAD), 4_096);
    expect(resolvedSpinMaximums(lowPayload).ceiling!).toBeLessThan(50);

    const belowChecks = await checkById(policy(), [28, 59, 23, 57, 101]);
    expect(belowChecks.find((entry) => entry.id === 'MAX_WIN_RESOLVED_SPIN_WITHIN_CEILING')?.status).toBe('PASS');

    const exactChecks = await checkById(policy(), EXACT_50);
    const exact = exactChecks.find((entry) => entry.id === 'MAX_WIN_RESOLVED_SPIN_WITHIN_CEILING');
    expect(exact?.status).toBe('PASS');
    expect((exact?.value as { provedResolvedSpinMax: number }).provedResolvedSpinMax).toBeCloseTo(50, 10);

    const aboveChecks = await checkById(policy(), ABOVE_50);
    const above = aboveChecks.find((entry) => entry.id === 'MAX_WIN_RESOLVED_SPIN_WITHIN_CEILING');
    expect(above?.status).toBe('FAIL');
    const aboveValue = (above?.value as { provedResolvedSpinMax: number }).provedResolvedSpinMax;
    expect(aboveValue).toBeGreaterThan(50);
    expect(String(above?.detail)).toContain('no tolerance');
    // The strict comparison rejects a value only 1.2x above the cap.
    expect(aboveValue).toBeLessThan(60);
    expect(below.reachableBoards).toBeGreaterThan(0);
  });

  it('treats a non-finite reachable free maximum as unprovable instead of falling back to the paid maximum', () => {
    const real = analyzeProfileExact(rules, engine, payloadFor(EXACT_50), 4_096);
    const nonFinite = resolvedSpinMaximums({ ...real, maxFreeSpinMultiplier: Number.POSITIVE_INFINITY });
    expect(nonFinite.free).toBeNull();
    expect(nonFinite.ceiling).toBeNull();
    expect(String(nonFinite.basis)).toContain('unprovable');

    // Free spins that provably cannot be reached impose no bound: 0 is a proof,
    // not a fallback.
    const unreachable = resolvedSpinMaximums({ ...real, triggerProbability: 0, maxFreeSpinMultiplier: 123 });
    expect(unreachable.free).toBe(0);
    expect(unreachable.ceiling).toBeCloseTo(real.maxBoardMultiplier, 10);
  });
});
