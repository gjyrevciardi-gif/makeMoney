import * as core from '../src/casino/platform/math-control/payout-distribution';
import * as mathModule from '../src/casino/games/lucky-lady/lucky-lady.math';
import { loadVerifiedMath } from '../src/casino/games/lucky-lady/lucky-lady.math';
import { LuckyLadyAdapter } from '../src/casino/games/lucky-lady/lucky-lady.adapter';
import { LuckyLadyPayoutService } from '../src/casino/games/lucky-lady/payout/lucky-lady-payout.service';
import { luckyLadyGeneratorModel } from '../src/casino/games/lucky-lady/lucky-lady.policy-generator';
import { canonicalProfileHash } from '../src/casino/platform/math-control/math-control.analytics';
import {
  DISTRIBUTION_CLASSES,
  distributionPolicyHash,
  type DistributionClass,
  type DistributionPolicy,
} from '../src/casino/platform/math-control/payout-distribution';
import type { MathPolicy, MathProfileArtifact } from '../src/casino/platform/math-control/math-control.types';

/**
 * Opt-in global payout distribution - regression evidence.
 *
 * Two things live here and nowhere else:
 *
 * 1. The *original* fixture-hash bug: the runtime fixture hashed an abbreviated
 *    `{maxWinScope, maxWinMultiplier, maxBandMin}` stub while the artifact it
 *    was attached to carried a whole `MathPolicy` and no `maxBandMin` at all, so
 *    `canonicalProfileHash(artifact) !== artifact.canonicalHash`. The reproducer
 *    is retained verbatim (same payload, same profile id, both hashes anchored)
 *    rather than replaced by a fixture that no longer walks the bug.
 * 2. The runtime wiring over serialized in-memory platform ports: the class is
 *    selected once per paid round from the pre-validated support, pinned into
 *    the round's opaque private state, and never re-selected - not by concurrent
 *    identical requests, replay, a JSON reload, the free spins or a retrigger,
 *    and not when the globally active policy changes.
 *
 * This is a test-only harness: there is no database, no HTTP surface and no
 * replay API here. `activeProfile` is a mock port, and the RNG used for the
 * feature continuation is an explicitly scripted test seam.
 */

const { engine, rules, hashes } = loadVerifiedMath();
const strips = rules.reels as Record<string, string[]>;
const reelKeys = Object.keys(strips).sort(
  (a, b) => Number(a.replace('reelStrip', '')) - Number(b.replace('reelStrip', '')),
);
const lines = rules.lines.length;
const USER = 'user-1';
const GAME_ID = 'lucky-lady';
const context = { gameId: GAME_ID, userId: USER, sessionId: '11111111-2222-4333-8444-555555555555' };

type Payload = { stopWeights: Record<string, number[]> };

const payloadFor = (entries: Array<{ stops: readonly number[]; weight: number }>): Payload => {
  const stopWeights: Record<string, number[]> = {};
  reelKeys.forEach((key, index) => {
    const weights = new Array(strips[key].length - 2).fill(0);
    for (const entry of entries) weights[entry.stops[index]] += entry.weight;
    stopWeights[key] = weights;
  });
  return { stopWeights };
};

const policyFor = (maxWinMultiplier: number, maxWinEnabled?: boolean): MathPolicy => ({
  gameId: GAME_ID,
  targetRtpPercent: 50,
  maxWinMultiplier,
  maxWinScope: 'RESOLVED_SPIN',
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

/** A real canonical hash of the *final* artifact object - never the stub. */
const artifactFor = (profileId: string, payload: unknown, policy: MathPolicy): MathProfileArtifact => {
  const artifact: MathProfileArtifact = {
    schemaVersion: 1,
    profileId,
    gameId: GAME_ID,
    engineSha256: hashes.engineSha256,
    rulesSha256: hashes.rulesSha256,
    policy,
    payload,
    canonicalHash: '',
    createdAt: new Date(0).toISOString(),
  };
  artifact.canonicalHash = canonicalProfileHash(artifact);
  return artifact;
};

const weightsFor = (
  overrides: Partial<Record<DistributionClass, number>>,
): DistributionPolicy['weights'] =>
  DISTRIBUTION_CLASSES.reduce(
    (accumulator, cls) => ({ ...accumulator, [cls]: overrides[cls] ?? 0 }),
    {} as DistributionPolicy['weights'],
  );

const distributionPolicy = (overrides: Partial<DistributionPolicy> = {}): DistributionPolicy => ({
  policyId: 'lucky-lady.test.policy.a',
  version: 1,
  gameId: GAME_ID,
  mathProfileId: 'unbound',
  mathProfileHash: '0'.repeat(64),
  maxWinScope: 'RESOLVED_SPIN',
  maxWinMultiplier: 50,
  granularity: 10_000,
  maxBandMin: 20,
  weights: weightsFor({}),
  ...overrides,
});

// ---------------------------------------------------------------------------
// 1. The original fixture-hash bug, reproduced
// ---------------------------------------------------------------------------

describe('runtime fixture hash regression (original bug reproducer)', () => {
  /** The exact original runtime fixture: one LOSS board and one SMALL board. */
  const OLD_LOSS = [120, 58, 23, 5, 116];
  const OLD_SMALL = [38, 61, 49, 73, 122];
  const OLD_PROFILE_ID = 'lucky-lady.test.runtime-fixture';

  /** The two hashes the reviewer captured from the buggy fixture. */
  const STORED_STUB_HASH = 'a98070554ba907746fe2da5b7e96326e8ab3d7d064eba4de23a4522860f7370b';
  const CORRECTED_HASH = '99bf4dea2eb55071c10642a9783d73fc1ee9bbcf17431e60f641f68a098d66ee';

  /** The stub that was hashed: a policy-shaped reduction with `maxBandMin`. */
  const stubPolicy = { maxWinScope: 'RESOLVED_SPIN', maxWinMultiplier: 50, maxBandMin: 20 };

  const fullPolicy = policyFor(50, true);
  /** Two *independent* but structurally identical payload objects. */
  const beforePayload = payloadFor([{ stops: OLD_LOSS, weight: 1 }, { stops: OLD_SMALL, weight: 1 }]);
  const afterPayload = JSON.parse(JSON.stringify(beforePayload)) as Payload;
  const correctedArtifact = artifactFor(OLD_PROFILE_ID, beforePayload, fullPolicy);
  const beforeArtifact = { ...correctedArtifact, policy: stubPolicy };

  it('reproduces the old hash mismatch and derives the corrected hash from the final artifact', () => {
    // The old fixture stored the stub hash on an artifact carrying the full
    // MathPolicy, so the artifact could be published with a hash that its own
    // canonical function never produces.
    const buggyArtifact = { ...correctedArtifact, canonicalHash: canonicalProfileHash(beforeArtifact) };
    expect(buggyArtifact.canonicalHash).toBe(STORED_STUB_HASH);
    expect(canonicalProfileHash(buggyArtifact)).not.toBe(buggyArtifact.canonicalHash);

    // The corrected fixture is hashed from the final artifact object itself.
    expect(correctedArtifact.canonicalHash).toBe(CORRECTED_HASH);

    // Only the hash-input policy metadata differs: identical identity, engine,
    // rules and payload.
    expect(beforeArtifact.schemaVersion).toBe(correctedArtifact.schemaVersion);
    expect(beforeArtifact.profileId).toBe(correctedArtifact.profileId);
    expect(beforeArtifact.gameId).toBe(correctedArtifact.gameId);
    expect(beforeArtifact.engineSha256).toBe(correctedArtifact.engineSha256);
    expect(beforeArtifact.rulesSha256).toBe(correctedArtifact.rulesSha256);
    expect(beforeArtifact.payload).toEqual(correctedArtifact.payload);
    expect(canonicalProfileHash(beforeArtifact)).not.toBe(canonicalProfileHash(correctedArtifact));
  });

  it('runs the same seeded native engine over the before/after payload objects with an equal draw trace', () => {
    expect(beforePayload).not.toBe(afterPayload);
    expect(afterPayload).toEqual(beforePayload);

    const run = (payload: unknown, seed: string) => {
      const trace: Array<{ min: number; max: number; value: number }> = [];
      const base = engine.createRng(seed);
      const rng = {
        int(min: number, max: number) {
          const value = base.int(min, max);
          trace.push({ min, max, value });
          return value;
        },
      };
      const round = engine.playRound(rules, payload as never, { bet: 1, lines, rng, capture: true });
      return { round, trace };
    };

    const before = run(beforePayload, 'hash-regression:seed');
    const after = run(afterPayload, 'hash-regression:seed');
    expect(before.trace.length).toBeGreaterThan(0);
    expect(before.trace).toEqual(after.trace);
    expect(after.round.board).toEqual(before.round.board);
    expect(after.round.mainEval).toEqual(before.round.mainEval);
    expect(after.round.feature).toEqual(before.round.feature);
    expect(after.round.totalWin).toBe(before.round.totalWin);
  });

  it('keeps the artifact hash invariant to key order and binds the distribution hash canonically', () => {
    const reorderedPolicy = Object.fromEntries(Object.entries(fullPolicy).reverse());
    expect(canonicalProfileHash({ ...correctedArtifact, policy: reorderedPolicy })).toBe(CORRECTED_HASH);

    const orderedWeights = weightsFor({ LOSS: 5_000, SMALL: 5_000 });
    const reorderedWeights = Object.fromEntries(
      [...DISTRIBUTION_CLASSES].reverse().map((cls) => [cls, orderedWeights[cls]]),
    ) as DistributionPolicy['weights'];
    const base = distributionPolicy({
      policyId: 'lucky-lady.test.policy.hash',
      mathProfileId: correctedArtifact.profileId,
      mathProfileHash: correctedArtifact.canonicalHash,
      weights: orderedWeights,
    });

    // Reordered weights are the same policy; a repeat is the same policy.
    expect(distributionPolicyHash({ ...base, weights: reorderedWeights })).toBe(distributionPolicyHash(base));
    expect(distributionPolicyHash({ ...base })).toBe(distributionPolicyHash(base));

    // Only the authoritative policy id moves the distribution identity, and it
    // never touches the math artifact's own hash or payload.
    const renamed = distributionPolicyHash({ ...base, policyId: 'lucky-lady.test.policy.hash.other' });
    expect(renamed).not.toBe(distributionPolicyHash(base));
    expect(canonicalProfileHash(correctedArtifact)).toBe(CORRECTED_HASH);
    expect(correctedArtifact.payload).toEqual(beforePayload);
  });
});

// ---------------------------------------------------------------------------
// 2. Runtime wiring over serialized in-memory platform ports
// ---------------------------------------------------------------------------

type StoredState = {
  version: number;
  phase: string;
  bet: number;
  lines: number;
  roundId: string;
  main: { board: { rp: number[] }; win: number; scatterCount: number };
  sequence: Array<{ index: number; retriggered: boolean; spinWin: number }>;
  fsIndex: number;
  freeTotal: number;
  pendingWin: number;
  bonusWin: number;
  payout: number;
  profileId: string;
  profileHash: string;
  profileVersion: number;
  maxWin: Record<string, unknown> | null;
  distribution: { policyId: string; policyHash: string; selectedClass: string } | null;
};

type Recovery = {
  roundId: string;
  version: number;
  phase: string;
  pendingWin: number;
  free: { total: number; current: number; remaining: number; multiplier: number };
  profile: { id: string; hash: string; version: number };
  result: { responseEvent: string; serverResponse: Record<string, unknown> } | null;
};

type SpinResult = { responseEvent: string; responseType?: string; recovery: Recovery };

type RoundRow = { id: string; userId: string; privateState: unknown };
type PreparedRow = Record<string, unknown>;
type ResponseRow = { userId: string; requestId: string; canonical: string; response: unknown };

type HarnessState = {
  active: { artifact: MathProfileArtifact; validationId: string; version: number } | null;
  config: { distributionPolicy: DistributionPolicy; distributionPolicyHash?: string } | null;
  rounds: RoundRow[];
  prepared: PreparedRow[];
  responses: ResponseRow[];
  balance: string;
};

type Counters = { debits: number; credits: number; activeProfileReads: number; rngFactories: number };
type ScriptedRng = { int: (min: number, max: number) => number; remaining: () => number };
type Runtime = { index: number; scripts: Array<() => ScriptedRng> };

const drawsForBoard = (payload: Payload, stops: readonly number[]): number[] =>
  reelKeys.map((key, index) => {
    const weights = payload.stopWeights[key];
    let before = 0;
    for (let position = 0; position < stops[index]; position += 1) before += weights[position];
    if (weights[stops[index]] <= 0) throw new Error(`unreachable stop ${key}#${stops[index]}`);
    return before + 1;
  });

/** Plays an explicit list of boards and refuses any draw beyond it. */
const scriptedRng = (payload: Payload, boards: ReadonlyArray<readonly number[]>): ScriptedRng => {
  const draws: number[] = [];
  for (const board of boards) draws.push(...drawsForBoard(payload, board));
  let cursor = 0;
  return {
    int(min: number, max: number) {
      if (cursor >= draws.length) throw new Error('RNG_EXHAUSTED: an unexpected extra draw was requested');
      const value = draws[cursor];
      cursor += 1;
      if (value < min || value > max) throw new Error(`scripted draw ${value} outside ${min}..${max}`);
      return value;
    },
    remaining: () => draws.length - cursor,
  };
};

const buildHarness = (
  state: HarnessState,
  runtime: Runtime,
  counters: Counters,
  hooks: { beforeSettle?: (info: { requestKey: string; kind: string }) => void | Promise<void> } = {},
  payoutControl?: LuckyLadyPayoutService,
) => {
  let chain: Promise<unknown> = Promise.resolve();
  const tx = {
    wallet: { findUnique: async () => ({ id: 'wallet-1', userId: USER, balance: BigInt(state.balance) }) },
    auditLog: { create: async () => undefined },
    casinoRound: { create: async () => ({ id: 'round' }), update: async () => undefined },
    casinoRoundAction: { create: async () => undefined },
  };
  const serialized = <T,>(_gameId: string, _userId: string, work: (client: unknown) => Promise<T>): Promise<T> => {
    const run = chain.then(() => work(tx));
    chain = run.then(() => undefined, () => undefined);
    return run;
  };
  const findResponse = (userId: string, requestId: string) =>
    state.responses.find((entry) => entry.userId === userId && entry.requestId === requestId) ?? null;
  const conflict = (code: string, message: string) => Object.assign(new Error(message), { code });

  const journal = {
    requestKey: (userId: string, requestId: string) => `${userId}:${requestId}`,
    unscopedRequestId: (userId: string, key: string) => key.slice(userId.length + 1),
    findReplay: async (_gameId: string, userId: string, requestId: string, canonical: string) => {
      const entry = findResponse(userId, requestId);
      if (!entry) return null;
      if (entry.canonical !== canonical) throw conflict('CONFLICT_SEMANTICS', 'Different semantics for the same request.');
      return entry.response;
    },
    findReplayIn: async (_tx: unknown, gameId: string, userId: string, requestId: string, canonical: string) =>
      journal.findReplay(gameId, userId, requestId, canonical),
    serialized,
    prepareOutcome: async (_tx: unknown, outcome: PreparedRow) => {
      state.prepared.push({ ...outcome });
    },
    findPreparedIn: async (_tx: unknown, key: string, userId: string) =>
      state.prepared.find((row) => row.userId === userId && row.requestKey === key) ?? null,
    findPrepared: async (userId: string, key: string) =>
      state.prepared.find((row) => row.userId === userId && row.requestKey === key) ?? null,
    listPrepared: async (userId: string, _gameId: string) =>
      state.prepared.filter((row) => row.userId === userId),
    deletePrepared: async (_tx: unknown, key: string) => {
      state.prepared = state.prepared.filter((row) => row.requestKey !== key);
    },
    discardPrepared: async (_gameId: string, _userId: string, key: string) => {
      state.prepared = state.prepared.filter((row) => row.requestKey !== key);
    },
    assertNoForeignPrepared: async (_tx: unknown, _gameId: string, userId: string, key: string) => {
      const foreign = state.prepared.find((row) => row.userId === userId && row.requestKey !== key);
      if (foreign) throw conflict('FOREIGN_PREPARED_ACTION', 'Another prepared action is already in flight.');
    },
    assertReceiptIn: async () => undefined,
    deliveringView: (_requestId: string, event: string) => ({ actionId: null, event, delivered: false, acked: false }),
    receipt: async () => ({ actionId: null, event: null, delivered: false, acked: false }),
    acknowledge: async () => ({ actionId: null, accepted: false, reason: 'in-memory harness' }),
    bookAction: async (
      _tx: unknown,
      params: { userId: string; requestId: string; canonical: string; response: unknown },
    ) => {
      state.responses.push({
        userId: params.userId,
        requestId: params.requestId,
        canonical: params.canonical,
        response: params.response,
      });
      return params.response;
    },
    conflict,
    conflictSemantics: () => {
      throw conflict('CONFLICT_SEMANTICS', 'Different semantics for the same request.');
    },
  };

  const lastRoundFor = (userId: string) =>
    [...state.rounds].reverse().find((row) => row.userId === userId) ?? null;
  const rounds = {
    currentRoundIn: async (_tx: unknown, _gameId: string, userId: string) => lastRoundFor(userId),
    currentRound: async (_db: unknown, _gameId: string, userId: string) => lastRoundFor(userId),
    createRound: async (_tx: unknown, params: { id: string; userId: string; privateState: unknown }) => {
      state.rounds.push({ id: params.id, userId: params.userId, privateState: params.privateState });
      return { id: params.id, settledAt: null };
    },
    persistRound: async (_tx: unknown, round: { id: string }, params: { privateState: unknown }) => {
      const stored = state.rounds.find((row) => row.id === round.id);
      if (stored) stored.privateState = params.privateState;
    },
    ownedRound: async () => {
      throw new Error('ownedRound is not used by this harness');
    },
  };

  const wallet = {
    balance: async () => BigInt(state.balance),
    balancePoints: async () => Number(BigInt(state.balance)),
    debit: async (_tx: unknown, params: { amount: bigint }) => {
      counters.debits += 1;
      state.balance = (BigInt(state.balance) - BigInt(params.amount)).toString();
    },
    credit: async (_tx: unknown, params: { amount: bigint }) => {
      counters.credits += 1;
      state.balance = (BigInt(state.balance) + BigInt(params.amount)).toString();
    },
    refund: async (_tx: unknown, params: { amount: bigint }) => {
      state.balance = (BigInt(state.balance) + BigInt(params.amount)).toString();
    },
  };

  const platform = { capabilities: {}, wallet, journal, rounds };
  const configs = {
    assertPlayable: async () => ({
      minStake: 1n,
      maxStake: 1_000_000n,
      ...(state.config ? { gameSpecific: state.config } : {}),
    }),
  };
  const registry = { assertEnabled: () => undefined };
  const mathControl = {
    activeProfile: async () => {
      counters.activeProfileReads += 1;
      if (!state.active) return null;
      // The mock verifies the fixture the way the real service does: a declared
      // hash that its own canonical function does not reproduce is refused.
      const recomputed = canonicalProfileHash(state.active.artifact);
      if (recomputed !== state.active.artifact.canonicalHash) {
        throw new Error(`FIXTURE_ARTIFACT_HASH_MISMATCH: ${recomputed}`);
      }
      return { ...state.active };
    },
  };

  const adapter = new LuckyLadyAdapter(
    { wallet: tx.wallet } as never,
    platform as never,
    configs as never,
    registry as never,
    {
      rngFactory: () => {
        counters.rngFactories += 1;
        const script = runtime.scripts[runtime.index];
        if (!script) throw new Error('RNG_EXHAUSTED: no further draw source was scripted');
        runtime.index += 1;
        return script();
      },
      hooks,
    },
    mathControl as never,
    payoutControl,
  );

  return { adapter, state };
};

type Harness = ReturnType<typeof buildHarness>;

const barrier = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
};

/** MVCC read-port double, not a database integration test. The service must
 * request RepeatableRead; the first pointer read captures the committed rows.
 * Barriers allow a DEFAULT commit on either side of that read. */
const snapshotService = (
  state: HarnessState,
  gates: { beforeRead?: () => Promise<void>; afterRead?: () => Promise<void> } = {},
  panelCandidate?: { candidateId: string; modelProfileId: string; modelHash: string;
    policyHash: string; maxWinMultiplier: number; distributionPolicy: DistributionPolicy; targetRtpPercent: number },
) => {
  const reads = { pointer: 0, model: 0, config: 0 };
  const prisma = {
    $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>, options: unknown) => {
      expect(options).toEqual({ isolationLevel: 'RepeatableRead' });
      let captured: HarnessState;
      const tx = {
        gameActiveMathProfile: { findUnique: async () => {
          reads.pointer += 1;
          await gates.beforeRead?.();
          captured = JSON.parse(JSON.stringify(state));
          await gates.afterRead?.();
          return captured.active ? {
            kind: 'GENERATED', version: captured.active.version, validationId: captured.active.validationId,
            profileRowId: 'model-row', profileId: captured.active.artifact.profileId,
            profileHash: captured.active.artifact.canonicalHash,
            payoutCandidateId: panelCandidate?.candidateId ?? null,
          } : { kind: 'DEFAULT', profileRowId: null, version: 2 };
        } },
        gameMathProfile: { findUnique: async () => {
          reads.model += 1;
          const artifact = captured.active!.artifact;
          return { ...artifact, createdAt: new Date(artifact.createdAt) };
        } },
        casinoGameConfig: { findUnique: async () => {
          reads.config += 1;
          return { activeVersion: { gameSpecificConfig: captured.config ?? {} } };
        } },
        luckyLadyPayoutCandidate: { findUnique: async () => panelCandidate },
      };
      return work(tx);
    }),
  };
  const service = new LuckyLadyPayoutService(prisma as never, {} as never);
  return { service, reads };
};

const lastRound = (state: HarnessState): StoredState =>
  state.rounds[state.rounds.length - 1].privateState as unknown as StoredState;

const headersFor = (state: HarnessState) => {
  const current = state.rounds.filter((row) => row.userId === USER).pop();
  const version = (current?.privateState as StoredState | undefined)?.version ?? 1;
  return { 'x-pilot-version': String(version), 'x-pilot-round': current?.id ?? 'none' };
};

const betRequest = (requestId: string, headers: Record<string, string> = { 'x-pilot-version': '1', 'x-pilot-round': 'none' }) => ({
  event: 'bet',
  body: { slotEvent: 'bet', slotBet: 20, slotLines: 10 },
  headers,
  requestId,
});

const freeRequest = (requestId: string, headers: Record<string, string>) => ({
  event: 'freespin',
  body: { slotEvent: 'freespin', slotBet: 20, slotLines: 10 },
  headers,
  requestId,
});

/** Serialize the mutable rows to JSON and rebuild *fresh* ports and adapter. */
const reloadHarness = (harness: Harness, runtime: Runtime, counters: Counters, hooks?: Parameters<typeof buildHarness>[3]) =>
  buildHarness(JSON.parse(JSON.stringify(harness.state)) as HarnessState, runtime, counters, hooks);

describe('opt-in distribution runtime (serialized in-memory ports, JSON reload)', () => {
  let classSpy: jest.SpyInstance;
  let generationSpy: jest.SpyInstance;

  beforeEach(() => {
    classSpy = jest.spyOn(core, 'selectDistributionClass');
    generationSpy = jest.spyOn(mathModule, 'generateCompleteRound');
  });

  afterEach(() => {
    classSpy.mockRestore();
    generationSpy.mockRestore();
  });

  const DEAD = [63, 119, 102, 60, 108];
  const CEILING_50 = [67, 51, 13, 33, 33];
  /**
   * A sparse feature profile whose *only* triggering board is the 50x ceiling
   * board. Scatters are additive per reel here (reels 1-3 contribute one each,
   * reels 4-5 none), so the FEATURE_TRIGGER class has exactly one reachable
   * member and the class draw resolves to a single, deterministic paid board.
   */
  const FEATURE_DEAD = [63, 119, 102, 33, 33];
  const featurePayload: Payload = (() => {
    const stopWeights: Record<string, number[]> = {};
    reelKeys.forEach((key, index) => {
      const weights = new Array(strips[key].length - 2).fill(0);
      weights[CEILING_50[index]] += 1;
      if (index < 3) weights[DEAD[index]] += 1_000;
      stopWeights[key] = weights;
    });
    return { stopWeights };
  })();
  const lossPayload = payloadFor([{ stops: DEAD, weight: 1 }]);

  const featureArtifact = artifactFor('lucky-lady.test.runtime-fixture.a', featurePayload, policyFor(50, true));
  const lossArtifact = artifactFor('lucky-lady.test.runtime-fixture.b', lossPayload, policyFor(20, true));

  const policyA = distributionPolicy({
    policyId: 'lucky-lady.test.policy.a',
    mathProfileId: featureArtifact.profileId,
    mathProfileHash: featureArtifact.canonicalHash,
    maxWinMultiplier: 50,
    weights: weightsFor({ FEATURE_TRIGGER: 10_000 }),
  });
  const policyB = distributionPolicy({
    policyId: 'lucky-lady.test.policy.b',
    mathProfileId: lossArtifact.profileId,
    mathProfileHash: lossArtifact.canonicalHash,
    maxWinMultiplier: 20,
    weights: weightsFor({ LOSS: 10_000 }),
  });

  const activeFor = (artifact: MathProfileArtifact) => ({ artifact, validationId: `validation-${artifact.profileId}`, version: 1 });

  const newScenario = () => {
    const counters: Counters = { debits: 0, credits: 0, activeProfileReads: 0, rngFactories: 0 };
    const runtime: Runtime = { index: 0, scripts: [] };
    const state: HarnessState = {
      active: activeFor(featureArtifact),
      config: { distributionPolicy: policyA, distributionPolicyHash: distributionPolicyHash(policyA) },
      rounds: [],
      prepared: [],
      responses: [],
      balance: '100000',
    };
    return { counters, runtime, state, harness: buildHarness(state, runtime, counters) };
  };

  it('resolves explicit DEFAULT, ignoring even a stale custom config envelope', async () => {
    const { state } = newScenario();
    state.active = null;
    const port = snapshotService(state);
    const snapshot = await port.service.activePayoutSnapshot(GAME_ID);
    expect(snapshot).toMatchObject({
      mode: 'DEFAULT', profileId: 'lucky-lady.rtp50.v1',
      profileHash: hashes.profileCanonicalHash, version: 2,
      policy: null, policyId: null, policyHash: null, distributionPolicy: null,
    });
    expect(snapshot.modelPayload).toEqual(loadVerifiedMath().profile);
    expect(port.reads).toEqual({ pointer: 1, model: 0, config: 0 });
  });

  it('an absent activation pointer resolves the same immutable default explicitly', async () => {
    const service = new LuckyLadyPayoutService({
      $transaction: async (read: (tx: unknown) => Promise<unknown>) => read({
        gameActiveMathProfile: { findUnique: async () => null },
      }),
    } as never, {} as never);
    expect(await service.activePayoutSnapshot(GAME_ID)).toMatchObject({
      mode: 'DEFAULT', version: 0, profileId: 'lucky-lady.rtp50.v1',
      profileHash: hashes.profileCanonicalHash, modelPayload: loadVerifiedMath().profile,
      distributionPolicy: null, policy: null,
    });
  });

  it('resolves a complete panel CUSTOM snapshot from its exact candidate identity', async () => {
    const { state } = newScenario();
    const model = luckyLadyGeneratorModel(50);
    const policy = distributionPolicy({ mathProfileId: model.modelId,
      mathProfileHash: model.artifact.canonicalHash, weights: weightsFor({ LOSS: 10_000 }) });
    state.active = activeFor(model.artifact);
    const port = snapshotService(state, {}, {
      candidateId: 'snapshot-test-candidate', modelProfileId: model.modelId,
      modelHash: model.artifact.canonicalHash, policyHash: distributionPolicyHash(policy),
      maxWinMultiplier: 50, distributionPolicy: policy, targetRtpPercent: 0,
    });
    const snapshot = await port.service.activePayoutSnapshot(GAME_ID);
    expect(snapshot).toMatchObject({ mode: 'CUSTOM', candidateId: 'snapshot-test-candidate',
      profileId: model.modelId, profileHash: model.artifact.canonicalHash,
      policyId: policy.policyId, policyHash: distributionPolicyHash(policy),
      policy: { maxWinMultiplier: 50, maxWinScope: 'RESOLVED_SPIN' }, distributionPolicy: policy,
    });
    expect(snapshot.modelPayload).toEqual(model.artifact.payload);
    expect(port.reads.config).toBe(0);
  });

  it('DEFAULT committed before a new round pins only the golden payload, with no selector', async () => {
    const scenario = newScenario();
    scenario.state.active = null; // DEFAULT already committed; config deliberately left stale.
    const port = snapshotService(scenario.state);
    const rng = engine.createRng('snapshot-default-round');
    scenario.runtime.scripts.push(() => ({ ...rng, remaining: () => 0 }));
    const harness = buildHarness(scenario.state, scenario.runtime, scenario.counters, {}, port.service);
    const result = await harness.adapter.execute(context, betRequest('default-first-round'));
    expect(lastRound(scenario.state)).toMatchObject({ profileId: 'lucky-lady.rtp50.v1',
      profileHash: hashes.profileCanonicalHash, maxWin: null, distribution: null });
    expect(generationSpy.mock.calls[0][0].weighting).toEqual(loadVerifiedMath().profile);
    expect(classSpy).not.toHaveBeenCalled();
    expect(scenario.counters.activeProfileReads).toBe(0);
    expect(await harness.adapter.execute(context, betRequest('default-first-round'))).toEqual(result);
    expect(port.reads.pointer).toBe(1);
    expect(scenario.counters.debits).toBe(1);
  });

  it.each(['before', 'after'] as const)('barrier: DEFAULT commits %s the snapshot read; never mixes sources', async (order) => {
    const scenario = newScenario();
    scenario.state.active = activeFor(lossArtifact);
    scenario.state.config = { distributionPolicy: policyB, distributionPolicyHash: distributionPolicyHash(policyB) };
    const reached = barrier();
    const resume = barrier();
    const gate = async () => { reached.release(); await resume.promise; };
    const port = snapshotService(scenario.state, order === 'before' ? { beforeRead: gate } : { afterRead: gate });
    const rng = engine.createRng('snapshot-barrier-default');
    scenario.runtime.scripts.push(order === 'before'
      ? () => ({ ...rng, remaining: () => 0 })
      : () => scriptedRng(lossPayload, []));
    const harness = buildHarness(scenario.state, scenario.runtime, scenario.counters, {}, port.service);
    const pending = harness.adapter.execute(context, betRequest(`barrier-${order}-round`));
    await reached.promise;
    scenario.state.active = null;
    scenario.state.config = null; // atomic DEFAULT commit in the port double
    resume.release();
    const original = await pending;
    const stored = lastRound(scenario.state);
    expect(stored.profileId).toBe(order === 'before' ? 'lucky-lady.rtp50.v1' : lossArtifact.profileId);
    expect(stored.profileHash).toBe(order === 'before' ? hashes.profileCanonicalHash : lossArtifact.canonicalHash);
    expect(stored.distribution).toEqual(order === 'before' ? null : {
      policyId: policyB.policyId, policyHash: distributionPolicyHash(policyB), selectedClass: 'LOSS',
    });
    expect(generationSpy.mock.calls[0][0].weighting).toEqual(order === 'before' ? loadVerifiedMath().profile : lossPayload);
    expect(scenario.counters.activeProfileReads).toBe(0);
    const calls = classSpy.mock.calls.length;
    expect(await harness.adapter.execute(context, betRequest(`barrier-${order}-round`))).toEqual(original);
    expect(port.reads.pointer).toBe(1);
    expect(generationSpy).toHaveBeenCalledTimes(1);
    expect(classSpy).toHaveBeenCalledTimes(calls);
    expect(scenario.counters.debits).toBe(1);
    if (order === 'after') {
      // The first (custom LOSS) round settled. A genuinely new round after the
      // committed DEFAULT must not inherit any of its custom distribution.
      const nextRng = engine.createRng('snapshot-next-default');
      scenario.runtime.scripts.push(() => ({ ...nextRng, remaining: () => 0 }));
      await harness.adapter.execute(context, betRequest('after-default-new-round', headersFor(scenario.state)));
      expect(lastRound(scenario.state)).toMatchObject({ profileId: 'lucky-lady.rtp50.v1',
        profileHash: hashes.profileCanonicalHash, maxWin: null, distribution: null });
      expect(port.reads.pointer).toBe(2);
      expect(classSpy).toHaveBeenCalledTimes(calls);
      expect(scenario.counters.debits).toBe(2);
    }
  });

  it('a prepared custom feature survives DEFAULT, reload, retrigger and replay without rereading policy', async () => {
    const scenario = newScenario();
    const port = snapshotService(scenario.state);
    scenario.runtime.scripts.push(() => scriptedRng(featurePayload, [CEILING_50, ...Array.from({ length: 29 }, () => FEATURE_DEAD)]));
    const prepared = barrier();
    const finish = barrier();
    const harness = buildHarness(scenario.state, scenario.runtime, scenario.counters, {
      beforeSettle: async () => { prepared.release(); await finish.promise; },
    }, port.service);
    const pending = harness.adapter.execute(context, betRequest('snapshot-feature-round'));
    await prepared.promise;
    const locked = JSON.parse(JSON.stringify(scenario.state.prepared[0].payload)) as StoredState;
    expect(locked.profileId).toBe(featureArtifact.profileId);
    expect(locked.distribution?.policyHash).toBe(distributionPolicyHash(policyA));
    scenario.state.active = null;
    scenario.state.config = null;
    finish.release();
    const original = await pending;
    const reloadedState = JSON.parse(JSON.stringify(scenario.state)) as HarnessState;
    const reloaded = buildHarness(reloadedState, scenario.runtime, scenario.counters, {}, port.service);
    expect(await reloaded.adapter.execute(context, betRequest('snapshot-feature-round'))).toEqual(original);
    expect(lastRound(reloadedState).freeTotal).toBe(15);
    for (let i = 1; i <= 30; i += 1) {
      const request = freeRequest(`snapshot-free-${i}`, headersFor(reloadedState));
      const response = await reloaded.adapter.execute(context, request);
      expect(lastRound(reloadedState)).toMatchObject({ profileId: locked.profileId,
        profileHash: locked.profileHash, distribution: locked.distribution, maxWin: locked.maxWin,
        freeTotal: 30, fsIndex: i });
      if (i === 1) expect(await reloaded.adapter.execute(context, request)).toEqual(response);
    }
    expect(port.reads.pointer).toBe(1);
    expect(generationSpy).toHaveBeenCalledTimes(1);
    expect(classSpy).toHaveBeenCalledTimes(1);
    expect(scenario.counters.debits).toBe(1);
    expect(scenario.counters.activeProfileReads).toBe(0);
  });

  it('selects and generates exactly once for concurrent identical requests and for a post-reload replay', async () => {
    const scenario = newScenario();
    scenario.state.active = activeFor(lossArtifact);
    scenario.state.config = { distributionPolicy: policyB, distributionPolicyHash: distributionPolicyHash(policyB) };
    scenario.runtime.scripts.push(() => scriptedRng(lossPayload, []));

    const [first, second] = await Promise.all([
      scenario.harness.adapter.execute(context, betRequest('loss-round-1')) as Promise<SpinResult>,
      scenario.harness.adapter.execute(context, betRequest('loss-round-1')) as Promise<SpinResult>,
    ]);

    expect(first.responseEvent).toBe('spin');
    expect(second).toEqual(first);
    expect(classSpy.mock.calls.length).toBe(1);
    expect(generationSpy.mock.calls.length).toBe(1);
    expect(scenario.counters.debits).toBe(1);
    expect(scenario.counters.rngFactories).toBe(1);
    expect(scenario.state.responses.length).toBe(1);
    expect(scenario.state.prepared.length).toBe(0);
    const actionCanonical = scenario.state.responses[0].canonical;
    expect(lastRound(scenario.state).distribution).toEqual({
      policyId: policyB.policyId,
      policyHash: distributionPolicyHash(policyB),
      selectedClass: 'LOSS',
    });

    // A completed request replayed after a JSON reload returns the stored
    // response with no new class selection, generation or debit.
    const reloaded = reloadHarness(scenario.harness, scenario.runtime, scenario.counters);
    const replay = (await reloaded.adapter.execute(context, betRequest('loss-round-1'))) as SpinResult;
    expect(replay).toEqual(first);
    // The stored action canonical travels unchanged through the reload.
    expect(reloaded.state.responses[0].canonical).toBe(actionCanonical);
    expect(reloaded.state.responses.length).toBe(1);
    expect(classSpy.mock.calls.length).toBe(1);
    expect(generationSpy.mock.calls.length).toBe(1);
    expect(scenario.counters.debits).toBe(1);
    expect(scenario.counters.rngFactories).toBe(1);
    expect(reloaded.state.rounds.length).toBe(1);

    // A genuinely new paid round is the second selection of the scenario.
    scenario.runtime.scripts.push(() => scriptedRng(lossPayload, []));
    await reloaded.adapter.execute(context, betRequest('loss-round-2', headersFor(reloaded.state)));
    expect(classSpy.mock.calls.length).toBe(2);
    expect(generationSpy.mock.calls.length).toBe(2);
    expect(scenario.counters.debits).toBe(2);
  });

  it('keeps the originating policy, cap and native board through a JSON reload while the active policy switches', async () => {
    const scenario = newScenario();
    // The paid round is forced onto the real trigger board; the base stream then
    // resolves the whole feature chain: one retrigger followed by 29 dead spins.
    const featureScript = scriptedRng(featurePayload, [CEILING_50, ...Array.from({ length: 29 }, () => FEATURE_DEAD)]);
    scenario.runtime.scripts.push(() => featureScript);

    const opened = (await scenario.harness.adapter.execute(context, betRequest('feature-round-1'))) as SpinResult;
    expect(opened.recovery.phase).toBe('FREE_SPINS');
    expect(classSpy.mock.calls.length).toBe(1);
    expect(generationSpy.mock.calls.length).toBe(1);
    expect(scenario.counters.debits).toBe(1);
    expect(featureScript.remaining()).toBe(0);

    const pinned = lastRound(scenario.state);
    expect(pinned.distribution).toEqual({
      policyId: policyA.policyId,
      policyHash: distributionPolicyHash(policyA),
      selectedClass: 'FEATURE_TRIGGER',
    });
    expect(pinned.maxWin).toEqual({
      maxWinEnabled: true,
      maxWinScope: 'RESOLVED_SPIN',
      maxWinMultiplier: 50,
      profileId: featureArtifact.profileId,
      profileHash: featureArtifact.canonicalHash,
    });
    expect(pinned.freeTotal).toBe(15);
    expect(pinned.fsIndex).toBe(0);
    expect(pinned.sequence.length).toBe(30);
    expect(pinned.main.board.rp).toEqual(CEILING_50);
    const frozen = {
      distribution: pinned.distribution,
      maxWin: pinned.maxWin,
      profileId: pinned.profileId,
      profileHash: pinned.profileHash,
      mainBoard: pinned.main.board.rp,
      mainWin: pinned.main.win,
      payout: pinned.payout,
      freeTotal: pinned.freeTotal,
      sequenceLength: pinned.sequence.length,
      roundId: pinned.roundId,
    };

    // Fresh adapter, fresh port objects, rows reconstructed from JSON only.
    const reloaded = reloadHarness(scenario.harness, scenario.runtime, scenario.counters);
    const afterReload = lastRound(reloaded.state);
    expect({
      distribution: afterReload.distribution,
      maxWin: afterReload.maxWin,
      profileId: afterReload.profileId,
      profileHash: afterReload.profileHash,
      mainBoard: afterReload.main.board.rp,
      mainWin: afterReload.main.win,
      payout: afterReload.payout,
      freeTotal: afterReload.freeTotal,
      sequenceLength: afterReload.sequence.length,
      roundId: afterReload.roundId,
    }).toEqual(frozen);
    expect(afterReload.phase).toBe('FREE_SPINS');

    // Globally switch to policy B on its own honest artifact, cap 20.
    reloaded.state.active = activeFor(lossArtifact);
    reloaded.state.config = { distributionPolicy: policyB, distributionPolicyHash: distributionPolicyHash(policyB) };
    const readsBeforeFeature = scenario.counters.activeProfileReads;

    const firstFree = (await reloaded.adapter.execute(
      context,
      freeRequest('feature-free-1', headersFor(reloaded.state)),
    )) as SpinResult;
    expect(firstFree.recovery.free.total).toBe(30);
    expect(firstFree.recovery.free.current).toBe(1);
    expect(lastRound(reloaded.state).sequence[0].retriggered).toBe(true);
    expect(lastRound(reloaded.state).fsIndex).toBe(1);
    expect(lastRound(reloaded.state).freeTotal).toBe(30);
    // Free spins resolve stored state: no selection, no generation, no lookup.
    expect(classSpy.mock.calls.length).toBe(1);
    expect(generationSpy.mock.calls.length).toBe(1);
    expect(scenario.counters.activeProfileReads).toBe(readsBeforeFeature);
    expect(scenario.counters.rngFactories).toBe(1);

    // The same request id replayed after the reload is the identical response.
    const replayedFree = (await reloaded.adapter.execute(
      context,
      freeRequest('feature-free-1', headersFor(reloaded.state)),
    )) as SpinResult;
    expect(replayedFree).toEqual(firstFree);
    expect(lastRound(reloaded.state).fsIndex).toBe(1);
    expect(lastRound(reloaded.state).freeTotal).toBe(30);
    expect(classSpy.mock.calls.length).toBe(1);
    expect(generationSpy.mock.calls.length).toBe(1);
    expect(scenario.counters.activeProfileReads).toBe(readsBeforeFeature);

    for (let index = 2; index <= 30; index += 1) {
      const spin = (await reloaded.adapter.execute(
        context,
        freeRequest(`feature-free-${index}`, headersFor(reloaded.state)),
      )) as SpinResult;
      const state = lastRound(reloaded.state);
      expect(spin.recovery.profile.id).toBe(featureArtifact.profileId);
      expect(spin.recovery.profile.hash).toBe(featureArtifact.canonicalHash);
      expect(state.distribution).toEqual(frozen.distribution);
      expect(state.maxWin).toEqual(frozen.maxWin);
      expect(state.profileId).toBe(featureArtifact.profileId);
      expect(state.profileHash).toBe(featureArtifact.canonicalHash);
      expect(state.main.board.rp).toEqual(CEILING_50);
      expect(state.fsIndex).toBe(index);
      expect(state.freeTotal).toBe(30);
    }
    expect(lastRound(reloaded.state).phase).toBe('PENDING_WIN');
    expect(classSpy.mock.calls.length).toBe(1);
    expect(generationSpy.mock.calls.length).toBe(1);
    expect(scenario.counters.activeProfileReads).toBe(readsBeforeFeature);
    expect(scenario.counters.rngFactories).toBe(1);

    // A recovery read against the *active* policy B still describes round A.
    const settings = (await reloaded.adapter.read(context, 'getSettings', {})) as {
      recovery: Recovery;
    };
    expect(settings.recovery.roundId).toBe(frozen.roundId);
    expect(settings.recovery.profile.id).toBe(featureArtifact.profileId);
    expect(settings.recovery.profile.hash).toBe(featureArtifact.canonicalHash);
    expect(settings.recovery.phase).toBe('PENDING_WIN');
    expect(settings.recovery.free.total).toBe(30);
    expect(settings.recovery.free.current).toBe(30);
    // The recovery read serves the stored presentations of round A - the paid
    // main board it still holds and the last free spin it presented - never a
    // re-draw under the now-active policy B.
    const recoveredReels = settings.recovery.result?.serverResponse.reelsSymbols as { rp: number[] } | undefined;
    expect(recoveredReels?.rp).toEqual(FEATURE_DEAD);
    expect(lastRound(reloaded.state).main.board.rp).toEqual(CEILING_50);
    expect(settings.recovery.pendingWin).toBe(lastRound(reloaded.state).pendingWin);
    expect(classSpy.mock.calls.length).toBe(1);
    expect(generationSpy.mock.calls.length).toBe(1);
    // getSettings legitimately reports the active maths once; nothing else read
    // the global pointer while the feature was executing.
    expect(scenario.counters.activeProfileReads).toBe(readsBeforeFeature + 1);
    expect(scenario.counters.rngFactories).toBe(1);

    // Collect the pending win so a new paid round may be opened.
    await reloaded.adapter.execute(context, {
      event: 'recoveryCollect',
      body: { slotEvent: 'recoveryCollect' },
      headers: headersFor(reloaded.state),
      requestId: 'feature-collect-1',
    });
    expect(lastRound(reloaded.state).phase).toBe('IDLE');
    expect(classSpy.mock.calls.length).toBe(1);
    expect(generationSpy.mock.calls.length).toBe(1);
    expect(scenario.counters.rngFactories).toBe(1);

    // The next paid round pins policy B and its cap 20 artifact.
    scenario.runtime.scripts.push(() => scriptedRng(lossPayload, []));
    await reloaded.adapter.execute(context, betRequest('loss-round-2', headersFor(reloaded.state)));
    const nextRound = lastRound(reloaded.state);
    expect(nextRound.distribution).toEqual({
      policyId: policyB.policyId,
      policyHash: distributionPolicyHash(policyB),
      selectedClass: 'LOSS',
    });
    expect(nextRound.maxWin).toEqual({
      maxWinEnabled: true,
      maxWinScope: 'RESOLVED_SPIN',
      maxWinMultiplier: 20,
      profileId: lossArtifact.profileId,
      profileHash: lossArtifact.canonicalHash,
    });
    expect(nextRound.profileId).toBe(lossArtifact.profileId);
    expect(nextRound.profileHash).toBe(lossArtifact.canonicalHash);
    expect(classSpy.mock.calls.length).toBe(2);
    expect(generationSpy.mock.calls.length).toBe(2);
  });

  it('recovers a serialized prepared outcome after a reload with no extra selection, draw or debit', async () => {
    const scenario = newScenario();
    scenario.state.active = activeFor(lossArtifact);
    scenario.state.config = { distributionPolicy: policyB, distributionPolicyHash: distributionPolicyHash(policyB) };
    scenario.runtime.scripts.push(() => scriptedRng(lossPayload, []));

    let failOnce = true;
    const failing = buildHarness(scenario.state, scenario.runtime, scenario.counters, {
      beforeSettle: () => {
        if (failOnce) {
          failOnce = false;
          throw new Error('injected failure before settlement');
        }
      },
    });
    await expect(failing.adapter.execute(context, betRequest('prepared-round-1'))).rejects.toThrow(
      /injected failure before settlement/,
    );

    // The draw exists exactly once, and only as a durable prepared row.
    expect(scenario.state.rounds.length).toBe(0);
    expect(scenario.state.prepared.length).toBe(1);
    expect(classSpy.mock.calls.length).toBe(1);
    expect(generationSpy.mock.calls.length).toBe(1);
    expect(scenario.counters.debits).toBe(0);

    const prepared = scenario.state.prepared[0];
    const preparedState = prepared.payload as StoredState;
    const beforeReload = {
      distribution: preparedState.distribution,
      mainBoard: preparedState.main.board.rp,
      mainWin: preparedState.main.win,
      payout: preparedState.payout,
      canonical: prepared.canonical,
    };
    expect(beforeReload.distribution).toEqual({
      policyId: policyB.policyId,
      policyHash: distributionPolicyHash(policyB),
      selectedClass: 'LOSS',
    });

    const reloaded = reloadHarness(scenario.harness, scenario.runtime, scenario.counters);
    const recoveredPrepared = reloaded.state.prepared[0];
    const recoveredState = recoveredPrepared.payload as StoredState;
    expect(recoveredPrepared.canonical).toBe(beforeReload.canonical);
    expect(recoveredState.distribution).toEqual(beforeReload.distribution);
    expect(recoveredState.main.board.rp).toEqual(beforeReload.mainBoard);
    expect(recoveredState.main.win).toBe(beforeReload.mainWin);
    expect(recoveredState.payout).toBe(beforeReload.payout);

    const settled = (await reloaded.adapter.execute(context, betRequest('prepared-round-1'))) as SpinResult;
    expect(settled.responseEvent).toBe('spin');
    expect(reloaded.state.prepared.length).toBe(0);
    expect(reloaded.state.rounds.length).toBe(1);
    expect(classSpy.mock.calls.length).toBe(1);
    expect(generationSpy.mock.calls.length).toBe(1);
    expect(scenario.counters.debits).toBe(1);
    expect(scenario.counters.rngFactories).toBe(1);
    const settledRound = lastRound(reloaded.state);
    expect(settledRound.distribution).toEqual(beforeReload.distribution);
    expect(settledRound.main.board.rp).toEqual(beforeReload.mainBoard);
    expect(settledRound.main.win).toBe(beforeReload.mainWin);

    // A second identical request settles nothing further.
    const second = (await reloaded.adapter.execute(context, betRequest('prepared-round-1'))) as SpinResult;
    expect(second).toEqual(settled);
    expect(classSpy.mock.calls.length).toBe(1);
    expect(generationSpy.mock.calls.length).toBe(1);
    expect(scenario.counters.debits).toBe(1);
  });
});
