import { ConflictException } from '@nestjs/common';
import { BetType, Prisma } from '@prisma/client';
import { placementFingerprint } from '../src/bets/bet-idempotency';
import { BetsService } from '../src/bets/bets.service';
import { PlaceBetDto } from '../src/bets/place-bet.dto';
import { PrismaService } from '../src/prisma.service';
import { EventOdds } from '../src/sports/domain';
import { SportsService } from '../src/sports/sports.service';
import { PointsService } from '../src/wallet/points.service';
import { CasinoConfigService } from '../src/casino/casino-config.service';
import { CasinoGameRegistry } from '../src/casino/casino-game.registry';
import { uniqueTestEmail } from './test-identity';

/**
 * A3 sports idempotency ownership.
 *
 * Every assertion below drives the real PostgreSQL transaction path of
 * `BetsService.place` (and the legacy `PointsService.placeSportsBet`) against
 * the isolated test database. Concurrency is ordered with explicit deferred
 * barriers or a deterministic create-time injection; nothing sleeps or retries
 * until a race happens to appear.
 */
describe('sports idempotency ownership (PostgreSQL)', () => {
  const prisma = new PrismaService();
  const sports = { getEventOdds: jest.fn() } as unknown as SportsService;
  const configs = new CasinoConfigService(prisma, new CasinoGameRegistry());
  const bets = new BetsService(prisma, sports, configs);
  const points = new PointsService(prisma);
  const bettorEmail = uniqueTestEmail('idem-bettor');
  const attackerEmail = uniqueTestEmail('idem-attacker');
  const adminEmail = uniqueTestEmail('idem-admin');
  let userId: string; let attackerId: string; let adminId: string;

  const odds = (eventId = 'event-1', price = '2.15'): EventOdds => ({
    event: { provider: 'fixture', providerEventId: eventId, sportKey: 'soccer_epl', sportName: 'Premier League', homeTeam: 'Home', awayTeam: 'Away', startTime: '2099-01-01T12:00:00.000Z', status: 'UPCOMING' },
    bookmaker: { key: 'fixture', name: 'Fixture' },
    markets: [{ key: 'h2h', name: 'Match Winner', selections: [{ key: 'home', name: 'Home', price }, { key: 'draw', name: 'Draw', price: '3.4' }] }],
    fetchedAt: new Date().toISOString(),
    staleAt: new Date(Date.now() + 30_000).toISOString(),
  });
  // `null` means "the caller supplied no price"; the default echoes `2.15`.
  const selection = (eventId = 'event-1', displayedOdds: string | null = '2.15') => ({ eventId, sportKey: 'soccer_epl', marketKey: 'h2h', selectionKey: 'home', displayedOdds: displayedOdds ?? undefined });
  const input = (overrides: Partial<PlaceBetDto> = {}): PlaceBetDto => ({ type: BetType.SINGLE, stake: 100, selections: [selection()], idempotencyKey: crypto.randomUUID(), ...overrides });

  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "LedgerEntry", "BetLeg", "Bet", "AuditLog", "RefreshToken", "Wallet", "User" CASCADE');
    jest.clearAllMocks();
    (sports.getEventOdds as jest.Mock).mockImplementation(async (_sport, id) => odds(id));
    const bettor = await prisma.user.create({ data: { email: bettorEmail, passwordHash: 'x', wallet: { create: {} } } });
    userId = bettor.id;
    const attacker = await prisma.user.create({ data: { email: attackerEmail, passwordHash: 'x', wallet: { create: {} } } });
    attackerId = attacker.id;
    const admin = await prisma.user.create({ data: { email: adminEmail, passwordHash: 'x', role: 'ADMIN', wallet: { create: {} } } });
    adminId = admin.id;
    await prisma.user.updateMany({ where: { role: 'USER' }, data: { createdById: admin.id } });
  });

  const fund = (targetUserId: string, amount = 1000n) => points.adminGrant(adminId, targetUserId, amount, 'Integration funding', crypto.randomUUID());
  const balanceOf = async (targetUserId: string) => (await prisma.wallet.findUniqueOrThrow({ where: { userId: targetUserId } })).balance;
  const ledgerSum = async (targetUserId: string) =>
    (await prisma.ledgerEntry.findMany({ where: { wallet: { userId: targetUserId } } }))
      .reduce((sum, entry) => sum + entry.amount, 0n);
  /** Lossless projection so two whole stored rows can be compared byte for byte. */
  const projection = (value: unknown) =>
    JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item));
  const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };

  /**
   * A Prisma stand-in that keeps every real statement - wallets, debits, SQL and
   * the unique index - but holds each transaction inside its idempotency lookup
   * until both racers have observed `null`.
   *
   * The wrapped `bet.findUnique` still performs the real query; only a real
   * `null` result is parked, so both requests provably miss the duplicate lookup
   * before either is allowed to debit. `wallet.updateMany` is observed (never
   * altered) so a test can show which conditional debit updated zero rows.
   */
  const racingClient = () => {
    const bothMissed = deferred();
    const release = deferred();
    const walletUpdates: number[] = [];
    const aborts: unknown[] = [];
    let nullLookups = 0;
    const wrapBet = (model: Record<string | symbol, unknown>) => new Proxy(model, {
      get(target, method) {
        const fn = Reflect.get(target, method);
        if (typeof fn !== 'function') return fn;
        if (method !== 'findUnique') return (fn as (...inner: unknown[]) => unknown).bind(target);
        return async (args: unknown) => {
          const found = await (fn as (...inner: unknown[]) => unknown).call(target, args);
          if (found !== null) return found;
          nullLookups += 1;
          if (nullLookups === 2) bothMissed.resolve();
          await release.promise;
          return found;
        };
      },
    });
    const wrapWallet = (model: Record<string | symbol, unknown>) => new Proxy(model, {
      get(target, method) {
        const fn = Reflect.get(target, method);
        if (typeof fn !== 'function') return fn;
        if (method !== 'updateMany') return (fn as (...inner: unknown[]) => unknown).bind(target);
        return async (args: unknown) => {
          const result = await (fn as (...inner: unknown[]) => unknown).call(target, args);
          walletUpdates.push(Number((result as { count?: unknown }).count ?? -1));
          return result;
        };
      },
    });
    const client = {
      bet: prisma.bet,
      betLeg: prisma.betLeg,
      $transaction: (fn: (tx: unknown) => Promise<unknown>, opts?: unknown) => {
        const run = prisma.$transaction(async (tx) => {
          const proxy = new Proxy(tx, {
            get: (target, prop) => {
              if (prop === 'bet') return wrapBet(target.bet as unknown as Record<string | symbol, unknown>);
              if (prop === 'wallet') return wrapWallet(target.wallet as unknown as Record<string | symbol, unknown>);
              return (target as unknown as Record<string | symbol, unknown>)[prop];
            },
          });
          return fn(proxy);
        }, opts as never);
        return run.catch((error: unknown) => {
          aborts.push(error);
          throw error;
        });
      },
    } as unknown as PrismaService;
    return {
      client,
      nullLookups: () => nullLookups,
      walletUpdateCounts: () => [...walletUpdates],
      aborts: () => [...aborts],
      waitForBothMisses: () => bothMissed.promise,
      release: release.resolve,
    };
  };

  const conflictFrom = async (promise: Promise<unknown>): Promise<ConflictException> => {
    try {
      await promise;
    } catch (error) {
      return error as ConflictException;
    }
    throw new Error('expected the call to reject with a conflict');
  };
  const expectGenericConflict = (error: ConflictException, forbidden: string[] = []) => {
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getStatus()).toBe(409);
    const body = JSON.stringify(error.getResponse());
    expect(body).toContain('IDEMPOTENCY_KEY_CONFLICT');
    for (const value of forbidden) expect(body).not.toContain(value);
  };

  it('rejects a cross-owner replay of an existing key with a generic conflict and no leakage (pre-check path)', async () => {
    await fund(userId);
    await fund(attackerId);
    const payload = input();
    const winner = await bets.place(userId, payload);
    const conflict = await conflictFrom(bets.place(attackerId, { ...payload }));
    expectGenericConflict(conflict, [winner.id, userId]);
    expect(await prisma.bet.count()).toBe(1);
    expect(await balanceOf(attackerId)).toBe(1000n);
    expect(await prisma.ledgerEntry.count({ where: { wallet: { userId: attackerId }, type: 'SPORTS_BET' } })).toBe(0);
  });

  it('replays an identical same-owner request from the pre-check without a fresh provider lookup', async () => {
    await fund(userId);
    const payload = input();
    const first = await bets.place(userId, payload);
    expect(sports.getEventOdds).toHaveBeenCalledTimes(1);
    const second = await bets.place(userId, payload);
    expect(second.id).toBe(first.id);
    // A differently-written but numerically identical price is the same request.
    const normalized = await bets.place(userId, { ...payload, selections: [selection('event-1', '2.1500')] });
    expect(normalized.id).toBe(first.id);
    expect(sports.getEventOdds).toHaveBeenCalledTimes(1);
    expect(await prisma.bet.count()).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { relatedBetId: first.id, type: 'SPORTS_BET' } })).toBe(1);
    expect(await balanceOf(userId)).toBe(900n);
  });

  it('replays an identical same-owner request found inside the transaction when the pre-check misses', async () => {
    await fund(userId);
    const payload = input();
    const first = await bets.place(userId, payload);
    // Force only the pre-check to miss, mirroring a race that started before
    // the first request committed; the in-transaction lookup is the real one.
    const spy = jest.spyOn(prisma.bet, 'findUnique').mockResolvedValueOnce(null);
    const second = await bets.place(userId, payload);
    spy.mockRestore();
    expect(second.id).toBe(first.id);
    expect(await prisma.bet.count()).toBe(1);
    expect(await prisma.betLeg.count()).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { type: 'SPORTS_BET' } })).toBe(1);
    expect(await balanceOf(userId)).toBe(900n);
  });

  it('resolves a unique-violation race by returning the persisted same-owner bet (P2002 path)', async () => {
    await fund(userId);
    const payload = input();
    const state = { createAttempts: 0, injected: false };
    const client = {
      bet: prisma.bet,
      $transaction: (fn: (tx: unknown) => Promise<unknown>, opts?: unknown) => prisma.$transaction(async (tx) => {
        const bet = {
          findUnique: async () => null,
          create: async (args: { data: Prisma.BetUncheckedCreateInput & { legs?: unknown } }) => {
            state.createAttempts += 1;
            if (!state.injected) {
              // A concurrent transaction committed the row between our read
              // and our insert; reproduce that exact ordering deterministically.
              state.injected = true;
              await prisma.bet.create({ data: { ...args.data, userId } });
            }
            return tx.bet.create(args as never);
          },
        };
        const proxy = new Proxy(tx, { get: (target, prop) => (prop === 'bet' ? bet : (target as unknown as Record<string, unknown>)[prop as string]) });
        return fn(proxy);
      }, opts as never),
    } as unknown as PrismaService;
    const racingBets = new BetsService(client, sports, configs);
    const result = await racingBets.place(userId, payload);
    expect(state.createAttempts).toBe(1);
    expect(await prisma.bet.count({ where: { idempotencyKey: payload.idempotencyKey } })).toBe(1);
    expect(result.userId).toBe(userId);
    expect(result.idempotencyKey).toBe(payload.idempotencyKey);
    // The loser's own debit rolled back with its transaction.
    expect(await prisma.ledgerEntry.count({ where: { type: 'SPORTS_BET' } })).toBe(0);
    expect(await balanceOf(userId)).toBe(1000n);
  });

  it('rolls back the loser of a cross-owner unique-violation race with no debit or ledger row (P2002 path)', async () => {
    await fund(attackerId);
    const payload = input();
    const state = { injected: false };
    const client = {
      bet: prisma.bet,
      $transaction: (fn: (tx: unknown) => Promise<unknown>, opts?: unknown) => prisma.$transaction(async (tx) => {
        const bet = {
          findUnique: async () => null,
          create: async (args: { data: Prisma.BetUncheckedCreateInput & { legs?: unknown } }) => {
            if (!state.injected) {
              state.injected = true;
              await prisma.bet.create({ data: { ...args.data, userId } });
            }
            return tx.bet.create(args as never);
          },
        };
        const proxy = new Proxy(tx, { get: (target, prop) => (prop === 'bet' ? bet : (target as unknown as Record<string, unknown>)[prop as string]) });
        return fn(proxy);
      }, opts as never),
    } as unknown as PrismaService;
    const racingBets = new BetsService(client, sports, configs);
    const conflict = await conflictFrom(racingBets.place(attackerId, payload));
    const winner = await prisma.bet.findUniqueOrThrow({ where: { idempotencyKey: payload.idempotencyKey } });
    expectGenericConflict(conflict, [winner.id, userId]);
    expect(winner.userId).toBe(userId);
    expect(await prisma.bet.count()).toBe(1);
    expect(await balanceOf(attackerId)).toBe(1000n);
    expect(await prisma.ledgerEntry.count({ where: { wallet: { userId: attackerId }, type: 'SPORTS_BET' } })).toBe(0);
  });

  it('treats a changed payload on an existing key as a conflict without another provider lookup', async () => {
    await fund(userId);
    const payload = input();
    await bets.place(userId, payload);
    expect(sports.getEventOdds).toHaveBeenCalledTimes(1);
    const changedStake = await conflictFrom(bets.place(userId, { ...payload, stake: 200 }));
    const changedOdds = await conflictFrom(bets.place(userId, { ...payload, selections: [selection('event-1', '2.16')] }));
    const droppedOdds = await conflictFrom(bets.place(userId, { ...payload, selections: [selection('event-1', null)] }));
    const changedSelection = await conflictFrom(bets.place(userId, { ...payload, selections: [{ ...selection(), selectionKey: 'draw', displayedOdds: '3.4' }] }));
    for (const conflict of [changedStake, changedOdds, droppedOdds, changedSelection]) expectGenericConflict(conflict);
    expect(sports.getEventOdds).toHaveBeenCalledTimes(1);
    expect(await prisma.bet.count()).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { type: 'SPORTS_BET' } })).toBe(1);
    expect(await balanceOf(userId)).toBe(900n);
  });

  it('creates exactly one bet, debit and ledger row for identical concurrent placement', async () => {
    await fund(userId);
    const payload = input();
    const racing = racingClient();
    const racingBets = new BetsService(racing.client, sports, configs);
    const pending = Promise.allSettled([racingBets.place(userId, payload), racingBets.place(userId, payload)]);
    await racing.waitForBothMisses();
    expect(racing.nullLookups()).toBe(2);
    racing.release();
    const results = await pending;
    const values = results.filter(result => result.status === 'fulfilled').map(result => (result as PromiseFulfilledResult<{ id: string }>).value.id);
    expect(values).toHaveLength(2);
    expect(new Set(values).size).toBe(1);
    expect(await prisma.bet.count({ where: { idempotencyKey: payload.idempotencyKey } })).toBe(1);
    expect(await prisma.betLeg.count()).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { type: 'SPORTS_BET' } })).toBe(1);
    expect(await balanceOf(userId)).toBe(900n);
  });

  it('lets exactly one owner win a concurrent key race and leaves the other untouched', async () => {
    await fund(userId);
    await fund(attackerId);
    const key = crypto.randomUUID();
    const racing = racingClient();
    const racingBets = new BetsService(racing.client, sports, configs);
    const pending = Promise.allSettled([
      racingBets.place(userId, input({ idempotencyKey: key })),
      racingBets.place(attackerId, input({ idempotencyKey: key })),
    ]);
    await racing.waitForBothMisses();
    expect(racing.nullLookups()).toBe(2);
    racing.release();
    const results = await pending;
    const fulfilled = results.filter(result => result.status === 'fulfilled');
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(await prisma.bet.count({ where: { idempotencyKey: key } })).toBe(1);
    const winner = await prisma.bet.findUniqueOrThrow({ where: { idempotencyKey: key } });
    const loserId = winner.userId === userId ? attackerId : userId;
    expectGenericConflict(rejected[0].reason as ConflictException, [winner.id, winner.userId]);
    expect(await balanceOf(winner.userId)).toBe(900n);
    expect(await balanceOf(loserId)).toBe(1000n);
    expect(await prisma.ledgerEntry.count({ where: { type: 'SPORTS_BET' } })).toBe(1);
  });

  it('fails closed on an unprovable legacy row and preserves it for retrieval', async () => {
    await fund(userId);
    const key = crypto.randomUUID();
    const legacy = await prisma.bet.create({
      data: {
        userId, type: BetType.SINGLE, stake: 100n, potentialPayout: 215n, totalOdds: new Prisma.Decimal('2.15'),
        idempotencyKey: key, idempotencyCanonicalHash: null,
        legs: { create: [{ provider: 'fixture', providerEventId: 'event-1', sportKey: 'soccer_epl', homeTeam: 'Home', awayTeam: 'Away', eventStartTime: new Date('2099-01-01T12:00:00.000Z'), marketKey: 'h2h', marketName: 'Match Winner', selectionKey: 'home', selectionName: 'Home', acceptedOdds: new Prisma.Decimal('2.15') }] },
      },
      include: { legs: true },
    });
    // The migration left this row without a fingerprint, so the request that
    // produced it cannot be proven: an omitted `displayedOdds` and an echoed one
    // persist identically. Every retry fails closed - including a byte-identical
    // one - and no replay is ever fabricated from legs.
    const identical = await conflictFrom(bets.place(userId, input({ idempotencyKey: key })));
    const withoutPrice = await conflictFrom(bets.place(userId, input({ idempotencyKey: key, selections: [selection('event-1', null)] })));
    const changedStake = await conflictFrom(bets.place(userId, input({ idempotencyKey: key, stake: 200 })));
    const changedPrice = await conflictFrom(bets.place(userId, input({ idempotencyKey: key, selections: [selection('event-1', '2.16')] })));
    const otherOwner = await conflictFrom(bets.place(attackerId, input({ idempotencyKey: key })));
    for (const conflict of [identical, withoutPrice, changedStake, changedPrice, otherOwner]) {
      expectGenericConflict(conflict, [legacy.id, userId]);
    }
    // The refusal happens before any provider lookup and the legacy row (with
    // its legs) stays exactly as it was for history and retrieval.
    expect(sports.getEventOdds).not.toHaveBeenCalled();
    expect(await prisma.bet.count()).toBe(1);
    expect(await prisma.betLeg.count()).toBe(1);
    const stored = await prisma.bet.findUniqueOrThrow({ where: { id: legacy.id }, include: { legs: true } });
    expect(stored.idempotencyCanonicalHash).toBeNull();
    expect(stored.legs).toHaveLength(1);
    expect(await prisma.ledgerEntry.count({ where: { type: 'SPORTS_BET' } })).toBe(0);
    expect(await balanceOf(userId)).toBe(1000n);
  });

  it('placeSportsBet replays only the same owner and the exact same stake and payout', async () => {
    await fund(userId);
    const key = crypto.randomUUID();
    const first = await points.placeSportsBet(userId, 100n, 250n, key);
    const replay = await points.placeSportsBet(userId, 100n, 250n, key);
    expect(replay.id).toBe(first.id);
    expect(await prisma.bet.count()).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { type: 'SPORTS_BET' } })).toBe(1);
    expect(await balanceOf(userId)).toBe(900n);
    const changedStake = await conflictFrom(points.placeSportsBet(userId, 200n, 500n, key));
    const changedPayout = await conflictFrom(points.placeSportsBet(userId, 100n, 500n, key));
    const otherOwner = await conflictFrom(points.placeSportsBet(attackerId, 100n, 250n, key));
    for (const conflict of [changedStake, changedPayout, otherOwner]) expectGenericConflict(conflict, [first.id, userId]);
    expect(await prisma.bet.count()).toBe(1);
    expect(await balanceOf(userId)).toBe(900n);
  });

  it('answers the loser of an identical race funded with exactly one stake', async () => {
    // Exactly one stake in the wallet. Both requests provably miss the duplicate
    // lookup (the barrier holds inside the real lookup and only releases once both
    // nulls are observed), so one of them must lose the conditional wallet debit
    // with zero rows updated - the rollback cause the recovery has to handle -
    // and still receive the winner's stored bet.
    await fund(userId, 100n);
    const payload = input();
    const racing = racingClient();
    const racingBets = new BetsService(racing.client, sports, configs);
    const pending = Promise.all([racingBets.place(userId, payload), racingBets.place(userId, payload)]);
    await racing.waitForBothMisses();
    expect(racing.nullLookups()).toBe(2);
    racing.release();
    const results = await pending;
    // Both answer with the same complete stored bet - id, owner, stake, payout,
    // fingerprint and legs.
    expect(projection(results[0])).toBe(projection(results[1]));
    expect(results[0].idempotencyKey).toBe(payload.idempotencyKey);
    // The losing transaction's conditional debit updated zero rows: this is the
    // insufficient-balance rollback, not a unique-index violation.
    expect(racing.walletUpdateCounts().sort()).toEqual([0, 1]);
    expect(await prisma.bet.count({ where: { idempotencyKey: payload.idempotencyKey } })).toBe(1);
    expect(await prisma.betLeg.count()).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { type: 'SPORTS_BET' } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { relatedBetId: results[0].id } })).toBe(1);
    expect(await balanceOf(userId)).toBe(0n);
    expect(await ledgerSum(userId)).toBe(await balanceOf(userId));
  });

  it('lets exactly one of two concurrent changed-payload requests win the shared key', async () => {
    await fund(userId);
    const key = crypto.randomUUID();
    const racing = racingClient();
    const racingBets = new BetsService(racing.client, sports, configs);
    const pending = Promise.allSettled([
      racingBets.place(userId, input({ idempotencyKey: key, stake: 100 })),
      racingBets.place(userId, input({ idempotencyKey: key, stake: 200 })),
    ]);
    await racing.waitForBothMisses();
    expect(racing.nullLookups()).toBe(2);
    racing.release();
    const results = await pending;
    const fulfilled = results.filter(result => result.status === 'fulfilled');
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const winner = (fulfilled[0] as PromiseFulfilledResult<{ id: string; stake: bigint }>).value;
    expectGenericConflict(rejected[0].reason as ConflictException, [winner.id, userId]);
    const stored = await prisma.bet.findUniqueOrThrow({ where: { idempotencyKey: key } });
    expect(stored.id).toBe(winner.id);
    expect(await prisma.bet.count({ where: { idempotencyKey: key } })).toBe(1);
    expect(await prisma.betLeg.count()).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { type: 'SPORTS_BET' } })).toBe(1);
    expect(await balanceOf(userId)).toBe(1000n - stored.stake);
    expect(await ledgerSum(userId)).toBe(await balanceOf(userId));
  });

  it('recovers a P2034 abort by returning only the identical committed bet', async () => {
    await fund(userId);
    const payload = input();
    const aborting = {
      bet: prisma.bet,
      $transaction: async () => {
        // The identical placement committed while this attempt was aborting.
        await bets.place(userId, payload);
        throw new Prisma.PrismaClientKnownRequestError('serialization conflict', { code: 'P2034', clientVersion: 'test' });
      },
    } as unknown as PrismaService;
    const recovered = await new BetsService(aborting, sports, configs).place(userId, payload);
    expect(recovered.idempotencyKey).toBe(payload.idempotencyKey);
    expect(await prisma.bet.count()).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { type: 'SPORTS_BET' } })).toBe(1);
    expect(await balanceOf(userId)).toBe(900n);

    // The same recovery refuses a changed payload instead of replaying it.
    const other = input();
    const abortingOther = {
      bet: prisma.bet,
      $transaction: async () => {
        await bets.place(userId, other);
        throw new Prisma.PrismaClientKnownRequestError('serialization conflict', { code: 'P2034', clientVersion: 'test' });
      },
    } as unknown as PrismaService;
    const conflict = await conflictFrom(new BetsService(abortingOther, sports, configs).place(userId, { ...other, stake: 300 }));
    expectGenericConflict(conflict, [userId]);
    expect(await prisma.bet.count()).toBe(2);
    expect(await prisma.ledgerEntry.count({ where: { type: 'SPORTS_BET' } })).toBe(2);
    expect(await balanceOf(userId)).toBe(800n);
  });

  it('placeSportsBet recovers a serialization conflict only for the same owner, stake and payout', async () => {
    await fund(userId);
    const key = crypto.randomUUID();
    const aborting = {
      bet: prisma.bet,
      betLeg: prisma.betLeg,
      $transaction: async () => {
        await points.placeSportsBet(userId, 100n, 250n, key);
        throw new Prisma.PrismaClientKnownRequestError('serialization conflict', { code: 'P2034', clientVersion: 'test' });
      },
    } as unknown as PrismaService;
    const raced = new PointsService(aborting);
    const replayed = await raced.placeSportsBet(userId, 100n, 250n, key);
    expect(replayed.idempotencyKey).toBe(key);
    expect(await prisma.bet.count()).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { type: 'SPORTS_BET' } })).toBe(1);
    expect(await balanceOf(userId)).toBe(900n);

    // Every mismatch after the same recovery is the generic conflict: changed
    // stake, changed payout and another owner.
    const key2 = crypto.randomUUID();
    const aborting2 = {
      bet: prisma.bet,
      betLeg: prisma.betLeg,
      $transaction: async () => {
        await points.placeSportsBet(userId, 100n, 250n, key2);
        throw new Prisma.PrismaClientKnownRequestError('serialization conflict', { code: 'P2034', clientVersion: 'test' });
      },
    } as unknown as PrismaService;
    const raced2 = new PointsService(aborting2);
    for (const conflict of [
      await conflictFrom(raced2.placeSportsBet(userId, 200n, 250n, key2)),
      await conflictFrom(raced2.placeSportsBet(userId, 100n, 400n, key2)),
      await conflictFrom(raced2.placeSportsBet(attackerId, 100n, 250n, key2)),
    ]) {
      expectGenericConflict(conflict, [userId]);
    }
    expect(await prisma.bet.count({ where: { idempotencyKey: key2 } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { type: 'SPORTS_BET' } })).toBe(2);
  });

  it('never replays a full-selection placement through the narrow placeSportsBet helper', async () => {
    await fund(userId);
    const payload = input();
    const placed = await bets.place(userId, payload);
    // Same key, same owner, same stake and same payout as the stored placement -
    // and still refused, because this helper never saw the selections and must
    // not validate a full-selection bet with a narrower rule.
    const conflict = await conflictFrom(
      points.placeSportsBet(userId, BigInt(payload.stake), placed.potentialPayout, payload.idempotencyKey),
    );
    expectGenericConflict(conflict, [placed.id, userId]);
    expect(await prisma.bet.count()).toBe(1);
    expect(await prisma.betLeg.count()).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { type: 'SPORTS_BET' } })).toBe(1);
    expect(await balanceOf(userId)).toBe(900n);
  });

  it('refuses a foreign owner found by the transaction lookup when the pre-check misses', async () => {
    await fund(userId);
    await fund(attackerId);
    const payload = input();
    const winner = await bets.place(userId, payload);
    // Force only the pre-check to miss. The in-transaction lookup is the real one
    // and must refuse the foreign row with the same generic conflict and no
    // debit or ledger row for the attacker.
    const spy = jest.spyOn(prisma.bet, 'findUnique').mockResolvedValueOnce(null);
    const conflict = await conflictFrom(bets.place(attackerId, { ...payload }));
    spy.mockRestore();
    expectGenericConflict(conflict, [winner.id, userId]);
    expect(await prisma.bet.count()).toBe(1);
    expect(await balanceOf(attackerId)).toBe(1000n);
    expect(await prisma.ledgerEntry.count({ where: { wallet: { userId: attackerId }, type: 'SPORTS_BET' } })).toBe(0);
  });

  it('answers the loser of an identical concurrent placeSportsBet with exactly one stake', async () => {
    await fund(userId, 100n);
    const key = crypto.randomUUID();
    const racing = racingClient();
    const racingPoints = new PointsService(racing.client);
    const pending = Promise.allSettled([
      racingPoints.placeSportsBet(userId, 100n, 250n, key),
      racingPoints.placeSportsBet(userId, 100n, 250n, key),
    ]);
    await racing.waitForBothMisses();
    expect(racing.nullLookups()).toBe(2);
    racing.release();
    const results = await pending;
    // The helper is Serializable, so the loser may lose the wallet race either as
    // a zero-row conditional debit or as a serialization abort; both are recovered
    // by the same owner/stake/payout validation, so the deterministic claim is the
    // outcome: two answers for one stored row, one debit, and a wallet that the
    // ledger still explains.
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2);
    const fulfilled = results as Array<PromiseFulfilledResult<{ id: string; idempotencyKey: string }>>;
    expect(fulfilled[0].value.id).toBe(fulfilled[1].value.id);
    expect(fulfilled[0].value.idempotencyKey).toBe(key);
    expect(racing.aborts()).toHaveLength(1);
    expect(await prisma.bet.count({ where: { idempotencyKey: key } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { type: 'SPORTS_BET' } })).toBe(1);
    expect(await balanceOf(userId)).toBe(0n);
    expect(await ledgerSum(userId)).toBe(await balanceOf(userId));
  });

  it('placeSportsBet recovers the identical row from its own insufficient-balance message', async () => {
    await fund(userId);
    const key = crypto.randomUUID();
    const aborting = {
      bet: prisma.bet,
      betLeg: prisma.betLeg,
      $transaction: async () => {
        await points.placeSportsBet(userId, 100n, 250n, key);
        // The exact error the helper's conditional debit throws: a plain string,
        // which Nest normalises to `{ message, error, statusCode }`.
        throw new ConflictException('INSUFFICIENT_VIRTUAL_BALANCE');
      },
    } as unknown as PrismaService;
    const recovered = await new PointsService(aborting).placeSportsBet(userId, 100n, 250n, key);
    expect(recovered.idempotencyKey).toBe(key);
    expect(await prisma.bet.count()).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { type: 'SPORTS_BET' } })).toBe(1);
    expect(await balanceOf(userId)).toBe(900n);
    expect(await ledgerSum(userId)).toBe(await balanceOf(userId));
  });
});
