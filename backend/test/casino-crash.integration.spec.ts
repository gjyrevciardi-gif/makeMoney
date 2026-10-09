import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { casinoConfig } from '../src/casino/casino.config';
import { CasinoClock } from '../src/casino/casino-clock.service';
import { CasinoFairnessService } from '../src/casino/casino-fairness.service';
import { CasinoRoundService } from '../src/casino/casino-round.service';
import { CasinoConfigService } from '../src/casino/casino-config.service';
import { CasinoGameRegistry } from '../src/casino/casino-game.registry';

import { CrashService } from '../src/casino/games/crash/crash.service';
import { StartCrashDto } from '../src/casino/games/crash/crash.dto';
import { crashElapsedMsToReach } from '../src/casino/games/crash/crash.engine';
import { PrismaService } from '../src/prisma.service';
import { PointsService } from '../src/wallet/points.service';
import { uniqueTestEmail } from './test-identity';

/** A clock the test drives explicitly, so timing is exact and nothing sleeps. */
class FrozenClock extends CasinoClock {
  private current = new Date('2026-01-01T00:00:00.000Z').getTime();
  now() { return new Date(this.current); }
  set(ms: number) { this.current = ms; }
  advance(ms: number) { this.current += ms; }
  get value() { return this.current; }
}

describe('server-authoritative crash (PostgreSQL)', () => {
  const prisma = new PrismaService();
  const fairness = new CasinoFairnessService();
  const rounds = new CasinoRoundService(prisma, fairness);
  const clock = new FrozenClock();
  const configs = new CasinoConfigService(prisma, new CasinoGameRegistry());
  const crash = new CrashService(prisma, rounds, clock, configs);
  const points = new PointsService(prisma);
  const userEmail = uniqueTestEmail('crash-player');
  const otherEmail = uniqueTestEmail('crash-other');
  const adminEmail = uniqueTestEmail('crash-admin');
  let userId: string;
  let otherId: string;
  let adminId: string;

  const config = () => casinoConfig().crash;
  const start = (overrides: Partial<StartCrashDto> = {}): StartCrashDto => ({
    stake: 100,
    idempotencyKey: randomUUID(),
    ...overrides,
  });

  beforeAll(async () => {
    process.env.CASINO_CRASH_RTP_BPS = '9700';
    await prisma.$connect();
  });
  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "CasinoGameConfigVersion", "CasinoGameConfig", "PlatformSettings", "CasinoTransaction", "CasinoRoundAction", "CasinoRound", "CasinoGameFavorite", "LedgerEntry", "BetLeg", "Bet", "AuditLog", "RefreshToken", "Wallet", "User" CASCADE',
    );
    clock.set(new Date('2026-01-01T00:00:00.000Z').getTime());
    const user = await prisma.user.create({
      data: { email: userEmail, passwordHash: 'x', wallet: { create: {} } },
    });
    const other = await prisma.user.create({
      data: { email: otherEmail, passwordHash: 'x', wallet: { create: {} } },
    });
    const admin = await prisma.user.create({
      data: { email: adminEmail, passwordHash: 'x', role: 'ADMIN', wallet: { create: {} } },
    });
    userId = user.id;
    otherId = other.id;
    adminId = admin.id;
    await prisma.user.updateMany({ where: { role: 'USER' }, data: { createdById: admin.id } });
  });

  const fund = (target = userId, amount = 100_000n) =>
    points.adminGrant(adminId, target, amount, 'Crash funding', randomUUID());
  const balance = async (target = userId) =>
    (await prisma.wallet.findUniqueOrThrow({ where: { userId: target } })).balance;
  const ledgerTotal = async (target = userId) => {
    const entries = await prisma.ledgerEntry.findMany({ where: { wallet: { userId: target } } });
    return entries.reduce((sum, entry) => sum + entry.amount, 0n);
  };
  /** The hidden crash point, read straight from the database. */
  const hiddenCrashPoint = async (roundId: string) => {
    const round = await prisma.casinoRound.findUniqueOrThrow({ where: { id: roundId } });
    return (round.privateState as unknown as { crashPointCenti: number }).crashPointCenti;
  };
  /** Opens a round whose crash point is high enough to leave room to play. */
  const startRunnableRound = async (overrides: Partial<StartCrashDto> = {}, minCenti = 500) => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const round = await crash.start(userId, start(overrides));
      if (round.status === 'OPEN' && (await hiddenCrashPoint(round.roundId)) >= minCenti) {
        return round;
      }
      // Settle the unusable round so the next attempt can open one.
      clock.advance(600_000);
      await crash.active(userId);
      clock.set(clock.value - 600_000);
    }
    throw new Error('could not open a runnable crash round');
  };

  it('opens a round, debits once, and hides the crash point and seed', async () => {
    await fund();
    const round = await startRunnableRound();

    expect(round.status).toBe('OPEN');
    expect(round.payout).toBe('0');
    expect(
      await prisma.ledgerEntry.count({
        where: { type: 'CASINO_BET', relatedCasinoRoundId: round.roundId },
      }),
    ).toBe(1);
    expect(await ledgerTotal()).toBe(await balance());

    const serialized = JSON.stringify(round);
    expect(serialized).not.toContain('crashPointCenti');
    expect(round.fairness).not.toHaveProperty('serverSeed');
    expect(round.fairness).not.toHaveProperty('revealedState');
    expect(round.crash.crashPoint).toBeNull();
    expect(round.timing.startedAt).toBe(new Date(clock.value).toISOString());
    expect(round.timing.currentMultiplier).toBe('1.00');
  });

  it('advances the reported multiplier with the server clock alone', async () => {
    await fund();
    const round = await startRunnableRound({}, 1_000);

    clock.advance(crashElapsedMsToReach(200, config()));
    const later = await crash.active(userId);
    expect(later?.timing.currentMultiplier).toBe('2.00');
    expect(later?.status).toBe('OPEN');
    expect(later?.roundId).toBe(round.roundId);
  });

  it.each([
    ['zero stake', { stake: 0 }],
    ['negative stake', { stake: -10 }],
    ['stake above the maximum', { stake: 1_000_001 }],
  ])('rejects %s', async (_label, overrides) => {
    await fund();
    await expect(crash.start(userId, start(overrides))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(await prisma.casinoRound.count()).toBe(0);
  });

  it.each([
    ['below the minimum', 100],
    ['above the maximum', 1_000_001],
  ])('rejects an auto-cashout %s', async (_label, autoCashoutCenti) => {
    await fund();
    await expect(
      crash.start(userId, start({ autoCashoutCenti })),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVALID_AUTO_CASHOUT' }),
    });
    expect(await prisma.casinoRound.count()).toBe(0);
  });

  it('refuses a round the wallet cannot cover and leaves no partial state', async () => {
    await expect(crash.start(userId, start())).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.casinoRound.count()).toBe(0);
    expect(await prisma.ledgerEntry.count()).toBe(0);
  });

  it('replays a duplicate start without opening a second round or deducting twice', async () => {
    await fund();
    const payload = start();
    const first = await crash.start(userId, payload);
    const second = await crash.start(userId, payload);

    expect(second.roundId).toBe(first.roundId);
    expect(await prisma.casinoRound.count()).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(1);
  });

  it('refuses a second concurrent round for the same player', async () => {
    await fund();
    await startRunnableRound();
    await expect(crash.start(userId, start())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ROUND_ALREADY_OPEN' }),
    });
  });

  it('cashes out at the authoritative multiplier and credits exactly once', async () => {
    await fund();
    const round = await startRunnableRound({ stake: 100 }, 1_000);
    const afterStart = await balance();

    clock.advance(crashElapsedMsToReach(200, config()));
    const settled = await crash.cashout(userId, round.roundId, {
      idempotencyKey: randomUUID(),
    });

    expect(settled.status).toBe('CASHED_OUT');
    expect(settled.crash.cashoutMultiplier).toBe('2.00');
    expect(settled.multiplier).toBe('2');
    expect(settled.payout).toBe('200');
    expect(await balance()).toBe(afterStart + 200n);
    expect(
      await prisma.ledgerEntry.count({
        where: { type: 'CASINO_WIN', relatedCasinoRoundId: round.roundId },
      }),
    ).toBe(1);
    expect(await ledgerTotal()).toBe(await balance());
    // The seed and the crash point are revealed only now.
    expect(settled.fairness).toHaveProperty('serverSeed');
    expect(settled.crash.crashPoint).not.toBeNull();
  });

  it('loses a cashout that arrives after the crash and credits nothing', async () => {
    await fund();
    const round = await startRunnableRound();
    const crashPoint = await hiddenCrashPoint(round.roundId);

    clock.advance(crashElapsedMsToReach(crashPoint, config()));
    const settled = await crash.cashout(userId, round.roundId, {
      idempotencyKey: randomUUID(),
    });

    expect(settled.status).toBe('LOST');
    expect(settled.payout).toBe('0');
    expect(settled.crash.outcome).toBe('LOST');
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_WIN' } })).toBe(0);
    expect(await ledgerTotal()).toBe(await balance());
  });

  it('applies the boundary rule: the last tick before the crash still wins', async () => {
    await fund();
    const current = config();
    const round = await startRunnableRound({ stake: 100 }, 500);
    const crashPoint = await hiddenCrashPoint(round.roundId);
    const crashAt = crashElapsedMsToReach(crashPoint, current);

    // One tick earlier the curve is strictly below the crash point.
    clock.advance(crashAt - current.tickMs);
    const settled = await crash.cashout(userId, round.roundId, {
      idempotencyKey: randomUUID(),
    });
    expect(settled.status).toBe('CASHED_OUT');
    const cashoutCenti = Math.round(Number(settled.crash.cashoutMultiplier) * 100);
    expect(cashoutCenti).toBeLessThan(crashPoint);
  });

  it('busts instantly when the crash point sits at the floor', async () => {
    await fund();
    let instant: Awaited<ReturnType<CrashService['start']>> | undefined;
    for (let attempt = 0; attempt < 400 && !instant; attempt += 1) {
      const round = await crash.start(userId, start({ stake: 1 }));
      if (round.status === 'LOST') instant = round;
      else {
        clock.advance(600_000);
        await crash.active(userId);
        clock.set(clock.value - 600_000);
      }
    }
    expect(instant).toBeDefined();
    expect(instant!.payout).toBe('0');
    expect(instant!.crash.crashPoint).toBe('1.00');
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_WIN' } })).toBe(0);
  });

  it('replays a retried cashout instead of settling twice', async () => {
    await fund();
    const round = await startRunnableRound({ stake: 100 }, 1_000);
    const afterStart = await balance();
    clock.advance(crashElapsedMsToReach(200, config()));

    const key = randomUUID();
    const first = await crash.cashout(userId, round.roundId, { idempotencyKey: key });
    const replay = await crash.cashout(userId, round.roundId, { idempotencyKey: key });

    expect(replay.payout).toBe(first.payout);
    expect(replay.status).toBe(first.status);
    expect(
      await prisma.ledgerEntry.count({
        where: { type: 'CASINO_WIN', relatedCasinoRoundId: round.roundId },
      }),
    ).toBe(1);
    expect(await balance()).toBe(afterStart + 200n);
  });

  it('settles exactly once when cashouts arrive simultaneously', async () => {
    await fund();
    const round = await startRunnableRound({ stake: 100 }, 1_000);
    const afterStart = await balance();
    clock.advance(crashElapsedMsToReach(200, config()));

    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        crash.cashout(userId, round.roundId, { idempotencyKey: randomUUID() })),
    );

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(
      await prisma.ledgerEntry.count({
        where: { type: 'CASINO_WIN', relatedCasinoRoundId: round.roundId },
      }),
    ).toBe(1);
    expect(
      await prisma.casinoTransaction.count({ where: { type: 'WIN', roundId: round.roundId } }),
    ).toBe(1);
    expect(await balance()).toBe(afterStart + 200n);
    expect(await ledgerTotal()).toBe(await balance());
  });

  it('cannot cash out a round that already finished', async () => {
    await fund();
    const round = await startRunnableRound({ stake: 100 }, 1_000);
    clock.advance(crashElapsedMsToReach(200, config()));
    await crash.cashout(userId, round.roundId, { idempotencyKey: randomUUID() });

    await expect(
      crash.cashout(userId, round.roundId, { idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'ROUND_NOT_OPEN' }) });
  });

  it('restores an open round after a refresh and reports nothing when idle', async () => {
    await fund();
    const round = await startRunnableRound({}, 1_000);
    clock.advance(1_000);

    const restored = await crash.active(userId);
    expect(restored?.roundId).toBe(round.roundId);
    expect(restored?.status).toBe('OPEN');
    expect(JSON.stringify(restored)).not.toContain('crashPointCenti');
    expect(restored?.fairness).not.toHaveProperty('serverSeed');

    clock.advance(600_000);
    await crash.active(userId);
    expect(await crash.active(userId)).toBeNull();
  });

  it('resolves a round that crashed while the player was disconnected', async () => {
    await fund();
    const round = await startRunnableRound({ stake: 100 });
    const crashPoint = await hiddenCrashPoint(round.roundId);

    // The player is gone; the server clock passes the crash point anyway.
    clock.advance(crashElapsedMsToReach(crashPoint, config()) + 5_000);
    const before = await balance();
    const recovered = await crash.active(userId);

    // The reconnecting client is told what happened, then the round is gone.
    expect(recovered?.status).toBe('LOST');
    expect(recovered?.crash.outcome).toBe('LOST');
    expect(await crash.active(userId)).toBeNull();
    const stored = await prisma.casinoRound.findUniqueOrThrow({ where: { id: round.roundId } });
    expect(stored.status).toBe('LOST');
    expect(stored.payout).toBe(0n);
    expect(await balance()).toBe(before);
  });

  it('settles abandoned rounds in the background sweep with no wallet credit', async () => {
    await fund();
    const round = await startRunnableRound({ stake: 100 });
    const crashPoint = await hiddenCrashPoint(round.roundId);

    // Nothing is due yet.
    expect(await crash.settleDue()).toEqual({ scanned: 1, settled: 0 });

    clock.advance(crashElapsedMsToReach(crashPoint, config()));
    const swept = await crash.settleDue();
    expect(swept).toEqual({ scanned: 1, settled: 1 });

    const stored = await prisma.casinoRound.findUniqueOrThrow({ where: { id: round.roundId } });
    expect(stored.status).toBe('LOST');
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_WIN' } })).toBe(0);
    // The sweep is idempotent.
    expect(await crash.settleDue()).toEqual({ scanned: 0, settled: 0 });
  });

  it('auto-cashes out at the chosen target when it is below the crash point', async () => {
    await fund();
    const round = await startRunnableRound({ stake: 100, autoCashoutCenti: 200 }, 500);
    const afterStart = await balance();
    expect(round.crash.autoCashout).toBe('2.00');

    clock.advance(crashElapsedMsToReach(200, config()));
    const settled = await crash.settleDue();
    expect(settled.settled).toBe(1);

    const stored = await prisma.casinoRound.findUniqueOrThrow({ where: { id: round.roundId } });
    expect(stored.status).toBe('CASHED_OUT');
    expect(stored.payout).toBe(200n);
    expect(await balance()).toBe(afterStart + 200n);
    const state = stored.publicState as unknown as { automatic: boolean; cashoutCenti: number };
    expect(state.automatic).toBe(true);
    expect(state.cashoutCenti).toBe(200);
  });

  it('loses when the auto-cashout sits at or above the crash point', async () => {
    await fund();
    // A very high target cannot be reached before almost any crash point.
    const round = await startRunnableRound(
      { stake: 100, autoCashoutCenti: config().maxAutoCashoutCenti },
      200,
    );
    const crashPoint = await hiddenCrashPoint(round.roundId);
    expect(crashPoint).toBeLessThan(config().maxAutoCashoutCenti);

    clock.advance(crashElapsedMsToReach(crashPoint, config()));
    await crash.settleDue();

    const stored = await prisma.casinoRound.findUniqueOrThrow({ where: { id: round.roundId } });
    expect(stored.status).toBe('LOST');
    expect(stored.payout).toBe(0n);
  });

  it('lets a manual cashout land before a later auto-cashout target', async () => {
    await fund();
    const round = await startRunnableRound({ stake: 100, autoCashoutCenti: 500 }, 1_000);
    const afterStart = await balance();

    clock.advance(crashElapsedMsToReach(200, config()));
    const settled = await crash.cashout(userId, round.roundId, {
      idempotencyKey: randomUUID(),
    });

    expect(settled.status).toBe('CASHED_OUT');
    expect(settled.crash.cashoutMultiplier).toBe('2.00');
    expect(settled.crash.automatic).toBe(false);
    expect(await balance()).toBe(afterStart + 200n);
  });

  it('isolates rounds between players', async () => {
    await fund();
    await fund(otherId);
    const round = await startRunnableRound({}, 1_000);

    await expect(
      crash.cashout(otherId, round.roundId, { idempotencyKey: randomUUID() }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await crash.active(otherId)).toBeNull();
    expect(await balance(otherId)).toBe(100_000n);
  });

  it('records the configuration version so historical rounds keep their own RTP', async () => {
    await fund();
    const round = await startRunnableRound();
    expect(round.gameVersion).toBe('crash.v1.rtp9700');

    process.env.CASINO_CRASH_RTP_BPS = '9500';
    const stored = await prisma.casinoRound.findUniqueOrThrow({ where: { id: round.roundId } });
    expect(stored.gameVersion).toBe('crash.v1.rtp9700');
    process.env.CASINO_CRASH_RTP_BPS = '9700';
  });

  it('keeps concurrent starts inside the balance', async () => {
    await points.adminGrant(adminId, userId, 1_000n, 'Small funding', randomUUID());
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () => crash.start(userId, start({ stake: 600 }))),
    );
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled').length)
      .toBeGreaterThan(0);
    expect(await balance()).toBeGreaterThanOrEqual(0n);
    expect(await ledgerTotal()).toBe(await balance());
    const debits = await prisma.ledgerEntry.findMany({
      where: { wallet: { userId }, type: 'CASINO_BET' },
    });
    expect(debits.reduce((sum, entry) => sum + -entry.amount, 0n)).toBeLessThanOrEqual(1_000n);
  });
});
