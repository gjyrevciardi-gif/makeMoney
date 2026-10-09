import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../src/prisma.service';
import { CasinoConfigService } from '../src/casino/casino-config.service';
import { CasinoGameRegistry } from '../src/casino/casino-game.registry';
import { GameCapabilityService } from '../src/casino/platform/game-capability.service';
import { GameJournalService } from '../src/casino/platform/game-journal.service';
import { GameRoundService } from '../src/casino/platform/game-round.service';
import { GameWalletService } from '../src/casino/platform/game-wallet.service';
import {
  GamePlatform,
  NewPreparedOutcome,
  TransactionClient,
} from '../src/casino/platform/game-adapter.types';
import { createSimulationRng } from '../src/casino/platform/math-control/math-control.random';
import { CLASSIC_ID, IntRng } from '../src/casino/games/book-of-ra-classic/classic.engine';
import { ClassicAdapter } from '../src/casino/games/book-of-ra-classic/classic.adapter';
import { PointsService } from '../src/wallet/points.service';
import { uniqueTestEmail } from './test-identity';

/**
 * ONE deterministic acceptance test for the same-key concurrent BET race.
 *
 * It proves the EXISTING patched reuse branch in `ClassicAdapter.bet()` runs:
 *
 *   const own = await this.journal.findPreparedIn(tx, key, userId);   // line 360
 *   if (own) { ... return { prepared: true as const }; }              // 361-364
 *
 * Two identical requests share one request identity (derived from the
 * server-side user + request id, never the body) and overlap the real
 * PostgreSQL path. The only ordering device is an explicit two-waiter barrier
 * at the ENTRY of each request's FIRST bet transaction - after its own replay /
 * reconciliation, before the advisory lock - plus the real `afterPrepare` seam,
 * which holds the preparing request's settlement until the duplicate's bet
 * transaction has already returned through the reuse branch. There are no
 * sleeps, no polling and no per-call RNG re-initialisation: one seeded stream is
 * counted across the whole test.
 *
 * Storage is the isolated local fixture only; user, wallet, session and ledger
 * rows are unique per run and created through the real services.
 */
const WIN_SEED = 'classic-2';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Observable trace of one bet transaction, attributed by transaction identity. */
type BetTrace = {
  tag: 'A' | 'B';
  drawsBefore: number;
  drawsAfter: number;
  inserts: number;
  ownLookups: number;
  ownRow: unknown;
  result: unknown;
};

describe('Book of Ra Classic concurrent same-key bet race (patched reuse branch)', () => {
  const prisma = new PrismaService();
  const registry = new CasinoGameRegistry();
  const configs = new CasinoConfigService(prisma, registry);
  const points = new PointsService(prisma);
  const capabilities = new GameCapabilityService(prisma, registry, configs);
  const realJournal = new GameJournalService(prisma);
  const wallet = new GameWalletService();
  const rounds = new GameRoundService(prisma);

  const stamp = randomUUID().slice(0, 8);
  let adminId: string;
  let userId: string;
  let sessionId: string;

  // ONE stream, created outside every callback, counted across the whole test.
  let rngCalls = 0;
  const rngStream = createSimulationRng(WIN_SEED);
  const countedRng: IntRng = (upper) => {
    rngCalls += 1;
    return rngStream.int(0, upper - 1);
  };

  const balance = async () => (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance;
  const ledgerSum = async () => {
    const rows = await prisma.ledgerEntry.findMany({ where: { wallet: { userId } } });
    return rows.reduce((sum, row) => sum + row.amount, 0n);
  };
  /** The COMPLETE scoped ledger, so post-race comparisons are not count-only. */
  const ledgerSnapshot = async () => {
    const rows = await prisma.ledgerEntry.findMany({
      where: { wallet: { userId } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      amount: row.amount.toString(),
      reason: row.reason,
      idempotencyKey: row.idempotencyKey,
      balanceBefore: row.balanceBefore === null ? null : row.balanceBefore.toString(),
      balanceAfter: row.balanceAfter === null ? null : row.balanceAfter.toString(),
      relatedCasinoRoundId: row.relatedCasinoRoundId,
      gameSessionId: row.gameSessionId,
      actionId: row.actionId,
    }));
  };
  const scoped = async (requestKey: string) => ({
    preparedForKey: await prisma.gamePreparedOutcome.count({ where: { requestKey } }),
    preparedForUser: await prisma.gamePreparedOutcome.count({ where: { userId } }),
    actions: await prisma.casinoRoundAction.count({ where: { idempotencyKey: requestKey } }),
    bets: await prisma.ledgerEntry.count({ where: { wallet: { userId }, type: 'CASINO_BET' } }),
    wins: await prisma.ledgerEntry.count({ where: { wallet: { userId }, type: 'CASINO_WIN' } }),
    rounds: await prisma.casinoRound.count({ where: { userId } }),
  });

  beforeAll(async () => {
    await prisma.$connect();
    // Prove the isolated fixture target before any write: the configured target
    // (local config) AND the live connection (server-side name). Credentials are
    // parsed but never printed.
    const configured = new URL(process.env.DATABASE_URL ?? '');
    const configuredName = configured.pathname.replace(/^\/+/, '').split('/')[0] ?? '';
    const live = await prisma.$queryRawUnsafe(
      'select current_database() as db, inet_server_port() as port',
    ) as Array<{ db: string; port: number | null }>;
    const db = live[0]?.db;
    const serverPort = live[0]?.port;
    const targetOk = configured.hostname === '127.0.0.1'
      && configured.port === '55432'
      && configuredName === 'boc_classic_test'
      && db === 'boc_classic_test';
    if (!targetOk) {
      throw new Error(`REFUSED_UNSAFE_DATABASE: ${configured.hostname}:${configured.port}/${configuredName} live=${db}`);
    }
    // eslint-disable-next-line no-console
    console.log(`[race] isolated storage: 127.0.0.1:55432/as ${db} (server port ${serverPort})`);

    const admin = await prisma.user.create({
      data: { email: uniqueTestEmail(`race-admin-${stamp}`), passwordHash: 'x', role: 'ADMIN', wallet: { create: {} } },
    });
    adminId = admin.id;
    const player = await prisma.user.create({
      data: { email: uniqueTestEmail(`race-player-${stamp}`), passwordHash: 'x', wallet: { create: {} } },
    });
    userId = player.id;
    // Unique fixture funding through the real points path; never an overwrite.
    await points.adminGrant(
      adminId,
      userId,
      2_000n,
      `race fixture ${stamp}`,
      `race-grant-${randomUUID().slice(0, 8)}`,
    );
    sessionId = (await prisma.gameSession.create({
      data: {
        userId,
        gameId: CLASSIC_ID,
        tokenHash: sha256(`race-${randomUUID()}`),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    })).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('overlaps two identical same-key BETS and reuses one authoritative prepared outcome', async () => {
    const balanceBefore = await balance();
    const ledgerBefore = await ledgerSnapshot();

    // --- deterministic harness (test-only decorators over the REAL ports) ----
    const journal = Object.create(realJournal) as GameJournalService;
    const requestAls = new AsyncLocalStorage<{ tag: 'A' | 'B'; serializedCalls: number }>();
    const txTrace = new WeakMap<object, BetTrace>();

    let atBarrier = 0;
    let releaseBoth: () => void = () => {};
    const barrierGate = new Promise<void>((resolve) => { releaseBoth = resolve; });
    let bothWaiting: () => void = () => {};
    const twoWaiting = new Promise<void>((resolve) => { bothWaiting = resolve; });

    const traces: BetTrace[] = [];
    let preparedInserts = 0;
    let afterPrepareCalls = 0;
    let releaseFirst: () => void = () => {};
    const firstHeld = new Promise<void>((resolve) => { releaseFirst = resolve; });

    Object.assign(journal, {
      /**
       * Each request's FIRST transaction is its bet transaction. It waits at
       * this entry - after its own replay lookup and reconciliation, before the
       * advisory lock - until both requests have arrived. Only then are both
       * released; Postgres' transaction-scoped lock decides the single preparer.
       */
      serialized: async <T>(
        gameId: string,
        owner: string,
        work: (tx: TransactionClient) => Promise<T>,
      ): Promise<T> => {
        const store = requestAls.getStore();
        if (!store || store.serializedCalls !== 0) {
          return realJournal.serialized(gameId, owner, work);
        }
        store.serializedCalls += 1;
        const trace: BetTrace = {
          tag: store.tag,
          drawsBefore: -1,
          drawsAfter: -1,
          inserts: 0,
          ownLookups: 0,
          ownRow: null,
          result: null,
        };
        traces.push(trace);
        atBarrier += 1;
        if (atBarrier === 2) bothWaiting();
        await barrierGate;
        return realJournal.serialized(gameId, owner, async (tx) => {
          // This callback cannot be entered before the advisory lock is held, so
          // the global draw counter here isolates exactly this transaction's draws.
          trace.drawsBefore = rngCalls;
          txTrace.set(tx, trace);
          try {
            const result = await work(tx);
            trace.result = result;
            return result;
          } finally {
            txTrace.delete(tx);
            trace.drawsAfter = rngCalls;
          }
        });
      },
      // The REAL insert, attributed to the bet transaction that performed it.
      prepareOutcome: async (tx: TransactionClient, outcome: NewPreparedOutcome) => {
        preparedInserts += 1;
        const trace = txTrace.get(tx);
        if (trace) trace.inserts += 1;
        await realJournal.prepareOutcome(tx, outcome);
      },
      // The REAL lookup, attributed by transaction identity (never a stack).
      findPreparedIn: async (tx: TransactionClient, requestKey: string, owner?: string) => {
        const row = await realJournal.findPreparedIn(tx, requestKey, owner);
        const trace = txTrace.get(tx);
        if (trace) {
          trace.ownLookups += 1;
          trace.ownRow = row;
        }
        return row;
      },
    });

    /**
     * The FIRST `afterPrepare` (the preparing request) holds settlement until
     * the SECOND has run - i.e. until the duplicate's bet transaction has
     * returned through the reuse branch. No transaction waits on a lock it
     * cannot get.
     */
    const afterPrepare = async () => {
      afterPrepareCalls += 1;
      if (afterPrepareCalls === 1) await firstHeld;
      else releaseFirst();
    };

    const platform: GamePlatform = { capabilities, wallet, journal, rounds };
    const adapter = new ClassicAdapter(prisma, platform, configs, undefined, { rng: countedRng, afterPrepare });

    const context = { gameId: CLASSIC_ID, userId, sessionId };
    const requestId = `race-${stamp}-${randomUUID().slice(0, 10)}`;
    const requestKey = `${userId}:${requestId}`;
    const body = { slotEvent: 'bet', slotBet: 1, slotLines: 9 };
    const headers = { 'x-pilot-version': '1', 'x-pilot-round': 'none' };
    const call = (tag: 'A' | 'B') => requestAls.run(
      { tag, serializedCalls: 0 },
      () => adapter.execute(context, { event: 'bet', body, headers, requestId }),
    );

    let released = false;
    const releaseAllGates = () => {
      if (released) return;
      released = true;
      releaseBoth();
      releaseFirst();
    };

    try {
      const runA = call('A');
      const runB = call('B');
      const settledPromise = Promise.allSettled([runA, runB]);

      await twoWaiting; // both requests reached the bet-transaction entry
      expect(atBarrier).toBe(2); // REQUESTS AT BARRIER
      releaseBoth(); // explicit release of both waiters, no ordering timer

      const settled = await settledPromise;

      // --- both callers fulfilled; no P2002 reaches either caller ------------
      expect(settled.map((entry) => entry.status)).toEqual(['fulfilled', 'fulfilled']);
      for (const entry of settled) {
        if (entry.status === 'rejected') expect(String(entry.reason)).not.toContain('P2002');
      }
      const valueA = (settled[0] as PromiseFulfilledResult<unknown>).value;
      const valueB = (settled[1] as PromiseFulfilledResult<unknown>).value;
      const stored = await prisma.casinoRoundAction.findUniqueOrThrow({ where: { idempotencyKey: requestKey } });
      expect(JSON.stringify(valueA)).toBe(JSON.stringify(valueB));
      expect(JSON.stringify(valueA)).toBe(JSON.stringify(stored.payload));
      expect(JSON.stringify(valueB)).toBe(JSON.stringify(stored.payload));

      // --- PATCHED REUSE BRANCH PROOF ---------------------------------------
      // Exactly one bet transaction inserted the prepared outcome; the other
      // saw that row through the REAL `findPreparedIn` inside its own bet
      // transaction and returned `{ prepared: true }` without drawing.
      const reusers = traces.filter((trace) => trace.ownLookups === 1 && trace.ownRow !== null);
      const preparers = traces.filter((trace) => trace.inserts === 1);
      expect(traces.map((trace) => trace.ownLookups)).toEqual([1, 1]);
      expect(preparers).toHaveLength(1);
      expect(reusers).toHaveLength(1); // PATCHED_REUSE_BRANCH_HIT === 1
      expect(preparedInserts).toBe(1);
      expect(afterPrepareCalls).toBe(2);
      expect(reusers[0].tag).not.toBe(preparers[0].tag);
      const reusedRow = reusers[0].ownRow as { kind: string; canonical: string };
      expect(reusedRow.kind).toBe('bet');
      expect(reusedRow.canonical).toBe(stored.canonical);
      expect((preparers[0].result as { prepared?: boolean }).prepared).toBe(true);
      expect((reusers[0].result as { prepared?: boolean }).prepared).toBe(true);
      // Only the preparing request drew; the reuse path returned before any draw.
      expect(reusers[0].drawsAfter).toBe(reusers[0].drawsBefore);
      expect(preparers[0].drawsAfter).toBeGreaterThan(preparers[0].drawsBefore);
      expect(rngCalls).toBe(preparers[0].drawsAfter - preparers[0].drawsBefore);

      // --- exactly one authoritative round / debit / action -----------------
      const counts = await scoped(requestKey);
      expect(counts).toEqual({
        preparedForKey: 0,
        preparedForUser: 0,
        actions: 1,
        bets: 1,
        wins: 0,
        rounds: 1,
      });
      const ledgerAfterRace = await ledgerSnapshot();
      expect(ledgerAfterRace).toHaveLength(ledgerBefore.length + 1);
      const newLedgerRows = ledgerAfterRace.filter(
        (row) => !ledgerBefore.some((before) => before.id === row.id),
      );
      expect(newLedgerRows).toHaveLength(1);
      expect(newLedgerRows[0].type).toBe('CASINO_BET');
      expect(newLedgerRows[0].amount).toBe('-9');
      expect(await balance()).toBe(balanceBefore - 9n);
      expect(await ledgerSum()).toBe(await balance());

      // --- identical sequential replay: zero draw, zero insert, zero tx -----
      const replayJournal = Object.create(realJournal) as GameJournalService;
      let replaySerialized = 0;
      let replayInserts = 0;
      Object.assign(replayJournal, {
        serialized: async <T>(
          gameId: string,
          owner: string,
          work: (tx: TransactionClient) => Promise<T>,
        ): Promise<T> => {
          replaySerialized += 1;
          return realJournal.serialized(gameId, owner, work);
        },
        prepareOutcome: async (tx: TransactionClient, outcome: NewPreparedOutcome) => {
          replayInserts += 1;
          await realJournal.prepareOutcome(tx, outcome);
        },
      });
      const replayAdapter = new ClassicAdapter(
        prisma,
        { capabilities, wallet, journal: replayJournal, rounds },
        configs,
        undefined,
        { rng: () => { throw new Error('UNEXPECTED_RNG_DRAW_ON_REPLAY'); } },
      );

      const rngBeforeReplay = rngCalls;
      const replay = await replayAdapter.execute(context, { event: 'bet', body, headers, requestId });
      expect(JSON.stringify(replay)).toBe(JSON.stringify(stored.payload));
      expect(rngCalls).toBe(rngBeforeReplay);
      expect(replayInserts).toBe(0);
      expect(replaySerialized).toBe(0);
      expect(await scoped(requestKey)).toEqual(counts);
      expect(await ledgerSnapshot()).toEqual(ledgerAfterRace);
      expect(await balance()).toBe(balanceBefore - 9n);

      // --- same key, changed material slotBet: existing conflict, no change --
      const rngBeforeChanged = rngCalls;
      const conflict = await replayAdapter
        .execute(context, { event: 'bet', body: { slotEvent: 'bet', slotBet: 5, slotLines: 9 }, headers, requestId })
        .then(() => null, (error: unknown) => error);
      expect(conflict).toBeInstanceOf(ConflictException);
      const exception = conflict as ConflictException;
      expect(exception.getStatus()).toBe(409);
      expect((exception.getResponse() as { code?: string }).code).toBe('IDEMPOTENCY_KEY_CONFLICT');
      expect(rngCalls).toBe(rngBeforeChanged);
      expect(replayInserts).toBe(0);
      expect(replaySerialized).toBe(0);
      expect(await scoped(requestKey)).toEqual(counts);
      expect(await ledgerSnapshot()).toEqual(ledgerAfterRace);
      expect(await balance()).toBe(balanceBefore - 9n);
      const storedAfterConflict = await prisma.casinoRoundAction.findUniqueOrThrow({
        where: { idempotencyKey: requestKey },
      });
      expect(JSON.stringify(storedAfterConflict.payload)).toBe(JSON.stringify(stored.payload));

      // eslint-disable-next-line no-console
      console.log(`[race] ${JSON.stringify({
        requestsAtBarrier: atBarrier,
        patchBranchHit: reusers.length,
        preparedInserts,
        afterPrepareCalls,
        rngCalls,
        traces: traces.map((trace) => ({
          tag: trace.tag,
          inserts: trace.inserts,
          ownLookupRow: trace.ownRow !== null,
          draws: trace.drawsAfter - trace.drawsBefore,
          result: trace.result,
        })),
        counts,
        replay: { rngCalls: rngCalls - rngBeforeReplay, inserts: replayInserts, serialized: replaySerialized },
        conflict: { status: exception.getStatus(), code: (exception.getResponse() as { code?: string }).code },
      })}`);
    } finally {
      releaseAllGates();
    }
  });
});
