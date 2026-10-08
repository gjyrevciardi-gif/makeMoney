import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma.service';
import { CasinoConfigService } from '../src/casino/casino-config.service';
import { CasinoGameRegistry } from '../src/casino/casino-game.registry';
import { GameCapabilityService } from '../src/casino/platform/game-capability.service';
import { GameJournalService } from '../src/casino/platform/game-journal.service';
import { GameRoundService } from '../src/casino/platform/game-round.service';
import { GameWalletService } from '../src/casino/platform/game-wallet.service';
import { GamePlatform } from '../src/casino/platform/game-adapter.types';
import { createSimulationRng } from '../src/casino/platform/math-control/math-control.random';
import { CLASSIC_ID, IntRng, playRound } from '../src/casino/games/book-of-ra-classic/classic.engine';
import { ClassicAdapter, ClassicState } from '../src/casino/games/book-of-ra-classic/classic.adapter';
import { defaultClassicProfile } from '../src/casino/games/book-of-ra-classic/classic.math-adapter';
import { PointsService } from '../src/wallet/points.service';
import { uniqueTestEmail } from './test-identity';

/**
 * Focused wallet / replay / recovery verification for Book of Ra Classic.
 *
 * It uses the real adapter and the real shared storage (GameJournalService,
 * GameWalletService, GameRoundService over PostgreSQL) and never truncates or
 * resets an existing table: every run creates its own unique fixture users, so
 * it is safe to run against an already-populated test database.
 *
 * The only test seam is the constructor `rng`, exactly as the production module
 * never supplies it. Seeds are discovery fixtures from
 * `games/book-of-ra-classic/scripts/find-fixture-seeds.cjs`.
 */
const WIN_SEED = 'classic-2'; // paid win, no feature
const FEATURE_SEED = 'classic-312'; // ten free games, expanding symbol P_3
const RETRIGGER_SEED = 'classic-2879'; // twenty free games, expanding symbol K

const intRng = (seed: string): IntRng => {
  const rng = createSimulationRng(seed);
  return (upper) => rng.int(0, upper - 1);
};

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

type Snapshot = {
  version: number;
  roundId: string;
  phase: string;
  balance: number;
  pendingWin: number;
  bet: { slotBet: number; slotLines: number } | null;
  result: { serverResponse: Record<string, unknown> } | null;
  free: { total: number; current: number; remaining: number; multiplier: number };
  gamble: { attempts: number; cards: string[] };
  settlement: { collected: boolean };
  profile: { id: string; hash: string; version: number };
  actionId: string | null;
  receipt: { event: string | null; delivered: boolean; acked: boolean };
};

type Protocol = {
  responseEvent: string;
  responseType?: string;
  serverResponse?: Record<string, unknown>;
  recovery: Snapshot;
};

describe('Book of Ra Classic wallet, replay and recovery (real shared storage)', () => {
  const prisma = new PrismaService();
  const registry = new CasinoGameRegistry();
  const configs = new CasinoConfigService(prisma, registry);
  const points = new PointsService(prisma);
  const capabilities = new GameCapabilityService(prisma, registry, configs);
  const platform: GamePlatform = {
    capabilities,
    wallet: new GameWalletService(),
    journal: new GameJournalService(prisma),
    rounds: new GameRoundService(prisma),
  };

  // Unique per run: no row created by another run is ever read, moved or removed.
  const stamp = randomUUID().slice(0, 8);
  const adminEmail = uniqueTestEmail(`classic-wallet-admin-${stamp}`);
  let userId: string;
  let adminId: string;
  let sessionId: string;
  const funded = 5_000n;

  let rngCalls = 0;
  const countingRng = (seed: string): IntRng => {
    const base = intRng(seed);
    return (upper) => {
      rngCalls += 1;
      return base(upper);
    };
  };
  const adapterWith = (rng?: IntRng) =>
    new ClassicAdapter(prisma, platform, configs, undefined, rng ? { rng } : {});
  /** A reload: a brand-new adapter instance over the same durable storage. */
  const reloadedAdapter = () =>
    new ClassicAdapter(prisma, platform, configs, undefined, {
      rng: () => {
        throw new Error('UNEXPECTED_RNG_DRAW_AFTER_RESTART');
      },
    });

  const context = () => ({ gameId: CLASSIC_ID, userId, sessionId });
  const nextRequestId = () => `wrr-${stamp}-${randomUUID().slice(0, 12)}`;

  const balance = async () =>
    (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance;
  const ledgerSum = async () => {
    const rows = await prisma.ledgerEntry.findMany({ where: { wallet: { userId } } });
    return rows.reduce((sum, row) => sum + row.amount, 0n);
  };
  const ledgerRows = async (type?: string) =>
    prisma.ledgerEntry.findMany({
      where: { wallet: { userId }, ...(type ? { type: type as never } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

  type Ctx = { version: string; round: string };
  const call = async (
    adapter: ClassicAdapter,
    event: string,
    body: Record<string, unknown>,
    ctx: Ctx,
    requestId = nextRequestId(),
  ) => {
    const response = await adapter.execute(context(), {
      event,
      body: { slotEvent: event, ...body },
      headers: { 'x-pilot-version': ctx.version, 'x-pilot-round': ctx.round },
      requestId,
    }) as Protocol;
    // Acknowledge the presentation receipt exactly as the recovered client does.
    if (response.recovery?.actionId) {
      await adapter.read(context(), 'ack', { actionId: response.recovery.actionId });
    }
    return {
      response,
      requestId,
      ctx: { version: String(response.recovery.version), round: response.recovery.roundId },
    };
  };
  const fresh = (): Ctx => ({ version: '1', round: 'none' });

  beforeAll(async () => {
    await prisma.$connect();
    const admin = await prisma.user.create({
      data: { email: adminEmail, passwordHash: 'x', role: 'ADMIN', wallet: { create: {} } },
    });
    adminId = admin.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /**
   * A brand-new fixture player for every test. Nothing existing is truncated,
   * reset or reused: each test reads and writes only its own rows.
   */
  beforeEach(async () => {
    const player = await prisma.user.create({
      data: { email: uniqueTestEmail(`classic-wallet-${stamp}`), passwordHash: 'x', wallet: { create: {} } },
    });
    userId = player.id;
    // Supported ledger funding only: the audited admin grant path, never a
    // direct balance write.
    await points.adminGrant(adminId, userId, funded, `Classic wallet fixture ${stamp}`, `grant-${stamp}-${randomUUID().slice(0, 8)}`);
    sessionId = (await prisma.gameSession.create({
      data: {
        userId,
        gameId: CLASSIC_ID,
        tokenHash: sha256(`fixture-${randomUUID()}`),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    })).id;
    expect(await balance()).toBe(funded);
    rngCalls = 0;
  });

  it('paid spin debits exactly once, and a duplicate identity never debits again', async () => {
    const adapter = adapterWith(countingRng(WIN_SEED));
    const predicted = playRound(defaultClassicProfile().payload, 2, 9, intRng(WIN_SEED));
    const requestId = nextRequestId();
    const before = await balance();

    const first = await call(adapter, 'bet', { slotBet: 2, slotLines: 9 }, fresh(), requestId);
    expect(first.response.responseEvent).toBe('spin');
    expect((first.response.serverResponse as { reelsSymbols: { reel1: string[] } }).reelsSymbols.reel1)
      .toEqual(predicted.spins[0].board[0]);

    const bets = await ledgerRows('CASINO_BET');
    expect(bets).toHaveLength(1);
    expect(bets[0].amount).toBe(-18n);
    expect(await balance()).toBe(before - 18n);
    // Identical identity + identical semantics returns the stored document.
    const drawsAfterFirst = rngCalls;
    const replay = await call(adapter, 'bet', { slotBet: 2, slotLines: 9 }, fresh(), requestId);
    // Stored-JSON equality: the replay returns the database's own document.
    const storedBet = await prisma.casinoRoundAction.findUniqueOrThrow({
      where: { idempotencyKey: `${userId}:${requestId}` },
    });
    expect(JSON.stringify(replay.response)).toBe(JSON.stringify(first.response));
    expect(JSON.stringify(replay.response)).toBe(JSON.stringify(storedBet.payload));
    expect(rngCalls).toBe(drawsAfterFirst);
    expect(await ledgerRows('CASINO_BET')).toHaveLength(1);
    expect(await prisma.casinoRound.count({ where: { userId } })).toBe(1);

    // The positive paid win is credited exactly once through the supported collect
    // path, and repeating the collect under the same identity changes nothing.
    const pending = first.response.recovery.pendingWin;
    expect(pending).toBeGreaterThan(0);
    const collectId = nextRequestId();
    const collected = await call(adapter, 'recoveryCollect', {}, replay.ctx, collectId);
    expect(collected.response.responseEvent).toBe('recoveryAck');
    expect(collected.response.recovery.phase).toBe('IDLE');
    const wins = await ledgerRows('CASINO_WIN');
    expect(wins).toHaveLength(1);
    expect(wins[0].amount).toBe(BigInt(pending));
    expect(await balance()).toBe(before - 18n + BigInt(pending));
    expect(await ledgerSum()).toBe(await balance());
    const storedCollect = await prisma.casinoRoundAction.findUniqueOrThrow({
      where: { idempotencyKey: `${userId}:${collectId}` },
    });
    const collectReplay = await call(adapter, 'recoveryCollect', {}, replay.ctx, collectId);
    expect(JSON.stringify(collectReplay.response)).toBe(JSON.stringify(storedCollect.payload));
    expect(await ledgerRows('CASINO_WIN')).toHaveLength(1);
    expect(rngCalls).toBe(drawsAfterFirst);
  });

  it('changed semantics under the same request identity is refused as a conflict', async () => {
    const adapter = adapterWith(countingRng(WIN_SEED));
    const requestId = nextRequestId();
    await call(adapter, 'bet', { slotBet: 1, slotLines: 9 }, fresh(), requestId);
    const betsBefore = (await ledgerRows('CASINO_BET')).length;
    await expect(
      adapter.execute(context(), {
        event: 'bet',
        body: { slotEvent: 'bet', slotBet: 5, slotLines: 9 },
        headers: { 'x-pilot-version': '1', 'x-pilot-round': 'none' },
        requestId,
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });
    expect((await ledgerRows('CASINO_BET')).length).toBe(betsBefore);
  });

  it('never debits during free games and credits the accumulated feature win exactly once', async () => {
    const adapter = adapterWith(countingRng(FEATURE_SEED));
    const predicted = playRound(defaultClassicProfile().payload, 1, 9, intRng(FEATURE_SEED));
    expect(predicted.freeSpins).toBe(10);
    const before = await balance();

    let round = await call(adapter, 'bet', { slotBet: 1, slotLines: 9 }, fresh());
    expect(round.response.recovery.phase).toBe('FREE_SPINS');
    expect(round.response.recovery.free.total).toBe(10);
    const betsAfterPaid = (await ledgerRows('CASINO_BET')).length;
    expect((await ledgerRows('CASINO_BET')).at(-1)?.amount).toBe(-9n);

    for (let index = 1; index <= 10; index += 1) {
      round = await call(adapter, 'freespin', { slotBet: 1, slotLines: 9 }, round.ctx);
      // A free game is never a second wager.
      expect((await ledgerRows('CASINO_BET')).length).toBe(betsAfterPaid);
      expect(round.response.recovery.free.current).toBe(index);
    }
    expect(round.response.recovery.phase).toBe('PENDING_WIN');
    expect(round.response.recovery.pendingWin).toBe(predicted.totalWin);
    // Nothing is credited before the collect.
    expect(await ledgerRows('CASINO_WIN')).toHaveLength(0);
    expect(await balance()).toBe(before - 9n);

    const collected = await call(adapter, 'recoveryCollect', {}, round.ctx);
    expect(collected.response.responseEvent).toBe('recoveryAck');
    expect(collected.response.recovery.phase).toBe('IDLE');
    expect(collected.response.recovery.pendingWin).toBe(0);
    const wins = await ledgerRows('CASINO_WIN');
    expect(wins).toHaveLength(1);
    expect(wins[0].amount).toBe(BigInt(predicted.totalWin));
    expect(await balance()).toBe(before - 9n + BigInt(predicted.totalWin));

    // Collect is idempotent on replay: still exactly one credit.
    await call(adapter, 'recoveryCollect', {}, round.ctx, collected.requestId);
    expect(await ledgerRows('CASINO_WIN')).toHaveLength(1);
  });

  it('preserves pending free games, the expanding symbol and the accumulated feature win across a reload', async () => {
    const adapter = adapterWith(countingRng(RETRIGGER_SEED));
    const predicted = playRound(defaultClassicProfile().payload, 1, 9, intRng(RETRIGGER_SEED));
    expect(predicted.retriggers).toBe(1);
    expect(predicted.freeSpins).toBe(20);

    let round = await call(adapter, 'bet', { slotBet: 1, slotLines: 9 }, fresh());
    for (let index = 1; index <= 4; index += 1) {
      round = await call(adapter, 'freespin', { slotBet: 1, slotLines: 9 }, round.ctx);
    }
    const before = round.response.recovery;
    const symbolBefore = (before.result?.serverResponse as { expSymbol?: string }).expSymbol;
    expect(before.free.current).toBe(4);
    // The allowance may already have been extended by the retrigger.
    expect(before.free.remaining).toBe(before.free.total - before.free.current);
    expect(before.free.total).toBeGreaterThanOrEqual(10);
    expect(symbolBefore).toBe(predicted.special);

    // A reload is a brand-new adapter over the same storage, with a generator
    // that throws if anything tries to redraw the round.
    const restart = reloadedAdapter();
    const reloaded = await restart.read(context(), 'getSettings', {}) as unknown as Protocol;
    expect(reloaded.recovery.roundId).toBe(before.roundId);
    expect(reloaded.recovery.phase).toBe('FREE_SPINS');
    expect(reloaded.recovery.free).toEqual(before.free);
    expect(reloaded.recovery.pendingWin).toBe(before.pendingWin);
    expect((reloaded.recovery.result?.serverResponse as { expSymbol?: string }).expSymbol).toBe(symbolBefore);
    // The board the client must redraw is the last resolved one, not a new draw.
    expect((reloaded.recovery.result?.serverResponse as { reelsSymbols: unknown }).reelsSymbols)
      .toEqual((before.result?.serverResponse as { reelsSymbols: unknown }).reelsSymbols);

    // The feature continues from the stored plan: the next free game is the one
    // the plan already contains, and the retrigger has already been accounted.
    let resumed = await call(restart, 'freespin', { slotBet: 1, slotLines: 9 }, {
      version: String(reloaded.recovery.version),
      round: reloaded.recovery.roundId,
    });
    expect(resumed.response.recovery.free.current).toBe(5);
    for (let index = 5; index < predicted.freeSpins; index += 1) {
      resumed = await call(restart, 'freespin', { slotBet: 1, slotLines: 9 }, resumed.ctx);
    }
    const completed = resumed.response.recovery;
    expect(completed.phase).toBe('PENDING_WIN');
    expect(completed.pendingWin).toBe(predicted.totalWin);
    expect(completed.free).toEqual({ total: 20, current: 20, remaining: 0, multiplier: 1 });
    expect((await ledgerRows('CASINO_BET'))).toHaveLength(1);

    const collected = await call(restart, 'recoveryCollect', {}, resumed.ctx);
    expect(collected.response.recovery.phase).toBe('IDLE');
    expect(collected.response.recovery.settlement.collected).toBe(true);
    const wins = await ledgerRows('CASINO_WIN');
    expect(wins.at(-1)?.amount).toBe(BigInt(predicted.totalWin));

    // Reload again *after* the feature completed and after the collect: the
    // completed round must be stable, with no draw and no re-credit.
    const afterCollect = await reloadedAdapter().read(context(), 'getSettings', {}) as unknown as Protocol;
    expect(afterCollect.recovery.roundId).toBe(before.roundId);
    expect(afterCollect.recovery.phase).toBe('IDLE');
    expect(afterCollect.recovery.settlement.collected).toBe(true);
    expect(afterCollect.recovery.pendingWin).toBe(0);
    expect(afterCollect.recovery.free).toEqual({ total: 20, current: 20, remaining: 0, multiplier: 1 });
    expect(JSON.stringify(afterCollect.recovery.result))
      .toBe(JSON.stringify(collected.response.recovery.result));
    expect((afterCollect.recovery.result?.serverResponse as { expSymbol?: string }).expSymbol)
      .toBe(symbolBefore);
    expect(await ledgerRows('CASINO_WIN')).toHaveLength(1);
  });

  it('reconciles the ledger with the wallet and never redraws a prepared outcome', async () => {
    const adapter = adapterWith(countingRng(WIN_SEED));
    const requestId = nextRequestId();
    // A post-prepare failure leaves the prepared outcome durable; the very next
    // authoritative read must settle it without drawing anything again.
    const failing = new ClassicAdapter(prisma, platform, configs, undefined, {
      rng: countingRng(WIN_SEED),
      afterPrepare: () => {
        throw new Error('INJECTED_POST_PREPARE_FAILURE');
      },
    });
    const openingBalance = await balance();
    const openingLedger = await ledgerSum();
    await expect(failing.execute(context(), {
      event: 'bet',
      body: { slotEvent: 'bet', slotBet: 1, slotLines: 9 },
      headers: { 'x-pilot-version': '1', 'x-pilot-round': 'none' },
      requestId,
    })).rejects.toThrow('INJECTED_POST_PREPARE_FAILURE');
    const preparedKey = `${userId}:${requestId}`;
    const preparedFor = () => prisma.gamePreparedOutcome.count({ where: { requestKey: preparedKey } });
    expect(await preparedFor()).toBe(1);
    // The round was genuinely drawn before the failure, so the baseline for the
    // "no redraw" claim is the counter *after* preparation, not before it.
    const drawsAfterPrepare = rngCalls;
    expect(drawsAfterPrepare).toBeGreaterThan(0);

    const restarted = reloadedAdapter();
    const recovered = await restarted.read(context(), 'getSettings', {}) as unknown as Protocol;
    expect(recovered.recovery.phase).toBe('PENDING_WIN');
    expect(recovered.recovery.pendingWin).toBeGreaterThan(0);
    // The durable prepared outcome for this identity is consumed, not left
    // pending: the journal's own read returns nothing for that key.
    expect(await new GameJournalService(prisma).findPrepared(userId, preparedKey)).toBeNull();
    expect(await preparedFor()).toBe(0);
    // No new draw happened: the failing adapter's stream had already produced the
    // round, and the reconciliation reused it.
    expect(rngCalls).toBe(drawsAfterPrepare);

    // The ledger is the authoritative record of the wallet.
    expect(await ledgerSum()).toBe(await balance());
    // Compare both deltas: the funding row is in the ledger total, not in the
    // movement this test made.
    expect((await balance()) - openingBalance).toBe((await ledgerSum()) - openingLedger);
    void adapter;
  });

  it('collapses two concurrent identical requests to one debit and one stored response', async () => {
    const requestId = nextRequestId();
    const betsBefore = (await ledgerRows('CASINO_BET')).length;
    const before = await balance();
    const request = {
      event: 'bet',
      body: { slotEvent: 'bet', slotBet: 1, slotLines: 9 },
      headers: { 'x-pilot-version': '1', 'x-pilot-round': 'none' },
      requestId,
    };
    // Test-only barrier through the existing constructor seam: the FIRST
    // settlement is held after its preparation has committed. `afterPrepare`
    // runs outside the serialized transaction, so holding it never holds the
    // advisory lock and the duplicate can reach its own-prepared path.
    let held = false;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const adapter = new ClassicAdapter(prisma, platform, configs, undefined, {
      rng: countingRng(WIN_SEED),
      afterPrepare: async () => {
        if (!held) {
          held = true;
          await gate;
        }
      },
    });
    const requestKey = `${userId}:${requestId}`;
    const waitFor = async (probe: () => Promise<boolean>, label: string) => {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (await probe()) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`BARRIER_TIMEOUT: ${label}`);
    };

    const first = adapter.execute(context(), request);
    // The first request has prepared its drawn round and is held before settlement.
    await waitFor(async () => (await prisma.gamePreparedOutcome.count({ where: { requestKey } })) === 1,
      'first request prepared');
    const drawsAfterPrepare = rngCalls;
    expect(drawsAfterPrepare).toBeGreaterThan(0);
    const second = adapter.execute(context(), request);
    // The duplicate settles the same prepared outcome, so a round appears while
    // the first request is still held: the interleaving is real, not timing luck.
    await waitFor(async () => (await prisma.casinoRound.count({ where: { userId } })) === 1,
      'duplicate reached the own-prepared path');
    release();
    const settled = await Promise.allSettled([first, second]);

    const fulfilled = settled.filter((entry) => entry.status === 'fulfilled') as Array<
      PromiseFulfilledResult<Protocol>
    >;
    const rejected = settled.filter((entry) => entry.status === 'rejected') as Array<PromiseRejectedResult>;
    // Unexpected errors must surface their full stack, never be swallowed.
    if (rejected.length) {
      throw new Error(`UNEXPECTED_REJECTION: ${rejected[0].reason?.stack ?? rejected[0].reason}`);
    }
    expect(fulfilled).toHaveLength(2);
    expect(JSON.stringify(fulfilled[0].value)).toBe(JSON.stringify(fulfilled[1].value));
    expect((await ledgerRows('CASINO_BET')).length).toBe(betsBefore + 1);
    expect(await balance()).toBe(before - 9n);
    expect(await prisma.casinoRound.count({ where: { userId } })).toBe(1);
    expect(await prisma.casinoRoundAction.count({ where: { idempotencyKey: requestKey } })).toBe(1);
    expect(await prisma.gamePreparedOutcome.count({ where: { requestKey } })).toBe(0);
    expect(rngCalls).toBe(drawsAfterPrepare);
    const storedBet = await prisma.casinoRoundAction.findUniqueOrThrow({
      where: { idempotencyKey: requestKey },
    });
    expect(JSON.stringify(fulfilled[0].value)).toBe(JSON.stringify(storedBet.payload));
    expect(await ledgerSum()).toBe(await balance());
  });

  it('collapses two concurrent identical collects to one credit and one stored response', async () => {
    const adapter = adapterWith(countingRng(WIN_SEED));
    const bet = await call(adapter, 'bet', { slotBet: 1, slotLines: 9 }, fresh());
    const pending = bet.response.recovery.pendingWin;
    expect(pending).toBeGreaterThan(0);
    const collectId = nextRequestId();
    const request = {
      event: 'recoveryCollect',
      body: { slotEvent: 'recoveryCollect' },
      headers: { 'x-pilot-version': bet.ctx.version, 'x-pilot-round': bet.ctx.round },
      requestId: collectId,
    };
    const settled = await Promise.allSettled([
      adapter.execute(context(), request),
      adapter.execute(context(), request),
    ]);
    const fulfilled = settled.filter((entry) => entry.status === 'fulfilled') as Array<
      PromiseFulfilledResult<Protocol>
    >;
    const rejected = settled.filter((entry) => entry.status === 'rejected') as Array<PromiseRejectedResult>;
    const stored = await prisma.casinoRoundAction.findUniqueOrThrow({
      where: { idempotencyKey: `${userId}:${collectId}` },
    });
    if (rejected.length === 0) {
      expect(fulfilled).toHaveLength(2);
      expect(JSON.stringify(fulfilled[0].value)).toBe(JSON.stringify(fulfilled[1].value));
      expect(JSON.stringify(fulfilled[0].value)).toBe(JSON.stringify(stored.payload));
    } else {
      // Only the documented conflict is acceptable for a losing race, and a
      // retry must then return the stored document unchanged.
      expect(rejected).toHaveLength(1);
      expect((rejected[0].reason as { response?: { code?: string } }).response?.code)
        .toBe('IDEMPOTENCY_KEY_CONFLICT');
      const retry = await adapter.execute(context(), request) as Protocol;
      expect(JSON.stringify(retry)).toBe(JSON.stringify(stored.payload));
    }
    const wins = await ledgerRows('CASINO_WIN');
    expect(wins).toHaveLength(1);
    expect(wins[0].amount).toBe(BigInt(pending));
    expect(await balance()).toBe(funded - 9n + BigInt(pending));
    expect(await ledgerSum()).toBe(await balance());
  });

  it('records the durable state the assertions above relied on', async () => {
    const adapter = adapterWith(countingRng(WIN_SEED));
    await call(adapter, 'bet', { slotBet: 1, slotLines: 9 }, fresh());
    const rounds = await prisma.casinoRound.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'asc' }],
    });
    expect(rounds.length).toBeGreaterThanOrEqual(1);
    for (const round of rounds) {
      const state = round.privateState as unknown as ClassicState;
      // Every round is pinned to the frozen profile and the running evaluator.
      expect(state.profileId).toBe('book-of-ra-classic.rtp50.v1');
      expect(state.profileHash).toMatch(/^[0-9a-f]{64}$/);
      expect(state.engineSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(state.plan.spins.length).toBeGreaterThanOrEqual(1);
    }
    const bets = await ledgerRows('CASINO_BET');
    const wins = await ledgerRows('CASINO_WIN');
    // Every movement is a shared-ledger row with provenance, never a bare write.
    for (const row of [...bets, ...wins]) {
      expect(row.idempotencyKey.length).toBeGreaterThan(0);
      expect(row.gameSessionId).toBe(sessionId);
      expect(row.actionId).not.toBeNull();
      // Provenance is complete: the row carries the exact before/after it wrote.
      expect(row.balanceBefore).not.toBeNull();
      expect(row.balanceAfter).not.toBeNull();
      expect((row.balanceAfter as bigint) - (row.balanceBefore as bigint)).toBe(row.amount);
    }
  });
});
