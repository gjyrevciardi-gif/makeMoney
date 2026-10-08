import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { casinoConfig } from '../src/casino/casino.config';
import { CasinoFairnessService } from '../src/casino/casino-fairness.service';
import { CasinoRoundService } from '../src/casino/casino-round.service';
import { CasinoConfigService } from '../src/casino/casino-config.service';
import { CasinoGameRegistry } from '../src/casino/casino-game.registry';

import { MinesService } from '../src/casino/games/mines/mines.service';
import { StartMinesDto } from '../src/casino/games/mines/mines.dto';
import { PrismaService } from '../src/prisma.service';
import { PointsService } from '../src/wallet/points.service';
import { uniqueTestEmail } from './test-identity';

describe('server-authoritative mines (PostgreSQL)', () => {
  const prisma = new PrismaService();
  const fairness = new CasinoFairnessService();
  const rounds = new CasinoRoundService(prisma, fairness);
  const configs = new CasinoConfigService(prisma, new CasinoGameRegistry());
  const mines = new MinesService(prisma, rounds, configs);
  const points = new PointsService(prisma);
  const userEmail = uniqueTestEmail('mines-player');
  const otherEmail = uniqueTestEmail('mines-other');
  const adminEmail = uniqueTestEmail('mines-admin');
  let userId: string;
  let otherUserId: string;
  let adminId: string;

  const start = (overrides: Partial<StartMinesDto> = {}): StartMinesDto => ({
    stake: 100,
    mines: 5,
    idempotencyKey: randomUUID(),
    ...overrides,
  });

  beforeAll(async () => {
    process.env.CASINO_MINES_RTP_BPS = '9700';
    await prisma.$connect();
  });
  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "CasinoGameConfigVersion", "CasinoGameConfig", "PlatformSettings", "CasinoTransaction", "CasinoRoundAction", "CasinoRound", "CasinoGameFavorite", "LedgerEntry", "BetLeg", "Bet", "AuditLog", "RefreshToken", "Wallet", "User" CASCADE',
    );
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
    otherUserId = other.id;
    adminId = admin.id;
    await prisma.user.updateMany({ where: { role: 'USER' }, data: { createdById: admin.id } });
  });

  const fund = (target = userId, amount = 10_000n) =>
    points.adminGrant(adminId, target, amount, 'Mines test funding', randomUUID());
  const balance = async (target = userId) =>
    (await prisma.wallet.findUniqueOrThrow({ where: { userId: target } })).balance;

  /** The authoritative hidden board, read straight from the database. */
  const hiddenMines = async (roundId: string) => {
    const round = await prisma.casinoRound.findUniqueOrThrow({ where: { id: roundId } });
    return (round.privateState as unknown as { minePositions: number[] }).minePositions;
  };
  const firstSafeCell = async (roundId: string, exclude: number[] = []) => {
    const bombs = await hiddenMines(roundId);
    const cell = Array.from({ length: 25 }, (_, index) => index)
      .find((index) => !bombs.includes(index) && !exclude.includes(index));
    if (cell === undefined) throw new Error('no safe cell available');
    return cell;
  };

  it('opens a round, debits the stake once, and hides the board from the projection', async () => {
    await fund();
    const round = await mines.start(userId, start());

    expect(round.status).toBe('OPEN');
    expect(round.payout).toBe('0');
    expect(await balance()).toBe(9_900n);
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(1);

    const serialized = JSON.stringify(round);
    expect(serialized).not.toContain('minePositions');
    expect(serialized).not.toContain('serverSeed"');
    expect(round.fairness).not.toHaveProperty('serverSeed');
    expect(round.fairness).not.toHaveProperty('revealedState');
    expect(round.fairness.serverSeedHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['zero mines', 0],
    ['too many mines', 25],
  ])('rejects %s', async (_label, mineCount) => {
    await fund();
    await expect(mines.start(userId, start({ mines: mineCount }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(await prisma.casinoRound.count()).toBe(0);
  });

  it('rejects a stake the wallet cannot cover and leaves no round behind', async () => {
    await expect(mines.start(userId, start())).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.casinoRound.count()).toBe(0);
    expect(await prisma.ledgerEntry.count()).toBe(0);
  });

  it('advances the multiplier on a safe reveal and keeps the round open', async () => {
    await fund();
    const round = await mines.start(userId, start({ mines: 5, stake: 100 }));
    const safe = await firstSafeCell(round.roundId);

    const revealed = await mines.reveal(userId, round.roundId, {
      cell: safe,
      idempotencyKey: randomUUID(),
    });

    expect(revealed.status).toBe('OPEN');
    expect(revealed.progress.revealedCount).toBe(1);
    expect(revealed.progress.canCashout).toBe(true);
    // 0.97 * C(25,1)/C(20,1) = 0.97 * 25/20 = 1.2125
    expect(revealed.progress.currentMultiplier).toBe('1.2125');
    expect(revealed.progress.potentialPayout).toBe('121');
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_WIN' } })).toBe(0);
  });

  it('loses the round on a mine and pays nothing', async () => {
    await fund();
    const round = await mines.start(userId, start({ mines: 5, stake: 100 }));
    const bombs = await hiddenMines(round.roundId);

    const result = await mines.reveal(userId, round.roundId, {
      cell: bombs[0],
      idempotencyKey: randomUUID(),
    });

    expect(result.status).toBe('LOST');
    expect(result.payout).toBe('0');
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_WIN' } })).toBe(0);
    expect(await balance()).toBe(9_900n);
    // The board is revealed only now that the round is finished.
    expect(result.fairness).toHaveProperty('serverSeed');
    expect(JSON.stringify(result.fairness)).toContain('minePositions');
  });

  it('cashes out at the authoritative multiplier and credits exactly once', async () => {
    await fund();
    const round = await mines.start(userId, start({ mines: 5, stake: 100 }));
    const safe = await firstSafeCell(round.roundId);
    await mines.reveal(userId, round.roundId, { cell: safe, idempotencyKey: randomUUID() });

    const cashed = await mines.cashout(userId, round.roundId, { idempotencyKey: randomUUID() });

    expect(cashed.status).toBe('CASHED_OUT');
    expect(cashed.multiplier).toBe('1.2125');
    expect(cashed.payout).toBe('121');
    expect(await balance()).toBe(10_021n);
    expect(
      await prisma.ledgerEntry.count({
        where: { type: 'CASINO_WIN', relatedCasinoRoundId: round.roundId },
      }),
    ).toBe(1);
  });

  it('refuses a cashout before anything has been revealed', async () => {
    await fund();
    const round = await mines.start(userId, start());
    await expect(
      mines.cashout(userId, round.roundId, { idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'NOTHING_REVEALED' }) });
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_WIN' } })).toBe(0);
  });

  it('replays a retried reveal instead of revealing twice', async () => {
    await fund();
    const round = await mines.start(userId, start());
    const safe = await firstSafeCell(round.roundId);
    const key = randomUUID();

    const first = await mines.reveal(userId, round.roundId, { cell: safe, idempotencyKey: key });
    const replay = await mines.reveal(userId, round.roundId, { cell: safe, idempotencyKey: key });

    expect(replay.progress.revealedCount).toBe(first.progress.revealedCount);
    expect(replay.state).toEqual(first.state);
    expect(await prisma.casinoRoundAction.count({ where: { action: 'REVEAL' } })).toBe(1);
  });

  it('rejects the same cell through a different request', async () => {
    await fund();
    const round = await mines.start(userId, start());
    const safe = await firstSafeCell(round.roundId);
    await mines.reveal(userId, round.roundId, { cell: safe, idempotencyKey: randomUUID() });

    await expect(
      mines.reveal(userId, round.roundId, { cell: safe, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CELL_ALREADY_REVEALED' }),
    });
    const stored = await prisma.casinoRound.findUniqueOrThrow({ where: { id: round.roundId } });
    expect((stored.publicState as unknown as { revealed: number[] }).revealed).toHaveLength(1);
  });

  it('credits exactly one payout when cashouts arrive simultaneously', async () => {
    await fund();
    const round = await mines.start(userId, start({ mines: 5, stake: 100 }));
    const safe = await firstSafeCell(round.roundId);
    await mines.reveal(userId, round.roundId, { cell: safe, idempotencyKey: randomUUID() });

    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        mines.cashout(userId, round.roundId, { idempotencyKey: randomUUID() }),
      ),
    );

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(
      await prisma.ledgerEntry.count({
        where: { type: 'CASINO_WIN', relatedCasinoRoundId: round.roundId },
      }),
    ).toBe(1);
    expect(
      await prisma.casinoTransaction.count({
        where: { type: 'WIN', roundId: round.roundId },
      }),
    ).toBe(1);
    expect(await balance()).toBe(10_021n);
    const stored = await prisma.casinoRound.findUniqueOrThrow({ where: { id: round.roundId } });
    expect(stored.status).toBe('CASHED_OUT');
  });

  it('cannot reveal or cash out a round that already finished', async () => {
    await fund();
    const round = await mines.start(userId, start());
    const bombs = await hiddenMines(round.roundId);
    await mines.reveal(userId, round.roundId, { cell: bombs[0], idempotencyKey: randomUUID() });

    await expect(
      mines.reveal(userId, round.roundId, { cell: bombs[1] ?? 0, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'ROUND_NOT_OPEN' }) });
    await expect(
      mines.cashout(userId, round.roundId, { idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'ROUND_NOT_OPEN' }) });
  });

  it('auto-settles as a win when every safe cell is cleared', async () => {
    await fund();
    const config = casinoConfig().mines;
    const round = await mines.start(userId, start({ mines: 24, stake: 100 }));
    const safe = await firstSafeCell(round.roundId);

    const result = await mines.reveal(userId, round.roundId, {
      cell: safe,
      idempotencyKey: randomUUID(),
    });

    expect(result.status).toBe('WON');
    // 0.97 * C(25,1)/C(1,1) = 24.25
    expect(result.multiplier).toBe('24.25');
    expect(result.payout).toBe('2425');
    expect(config.cells - 24).toBe(1);
    expect(
      await prisma.ledgerEntry.count({
        where: { type: 'CASINO_WIN', relatedCasinoRoundId: round.roundId },
      }),
    ).toBe(1);
  });

  it('restores an open round after a refresh and reports nothing when idle', async () => {
    await fund();
    const round = await mines.start(userId, start());
    const safe = await firstSafeCell(round.roundId);
    await mines.reveal(userId, round.roundId, { cell: safe, idempotencyKey: randomUUID() });

    const restored = await mines.active(userId);
    expect(restored?.roundId).toBe(round.roundId);
    expect(restored?.progress.revealedCount).toBe(1);
    expect(JSON.stringify(restored)).not.toContain('minePositions');

    await mines.cashout(userId, round.roundId, { idempotencyKey: randomUUID() });
    expect(await mines.active(userId)).toBeNull();
  });

  it('refuses to open a second concurrent round for the same player', async () => {
    await fund();
    await mines.start(userId, start());
    await expect(mines.start(userId, start())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ROUND_ALREADY_OPEN' }),
    });
    expect(await prisma.casinoRound.count()).toBe(1);
  });

  it('isolates rounds between players', async () => {
    await fund();
    await fund(otherUserId);
    const round = await mines.start(userId, start());
    const safe = await firstSafeCell(round.roundId);

    await expect(
      mines.reveal(otherUserId, round.roundId, { cell: safe, idempotencyKey: randomUUID() }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      mines.cashout(otherUserId, round.roundId, { idempotencyKey: randomUUID() }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await mines.active(otherUserId)).toBeNull();
    expect(await balance(otherUserId)).toBe(10_000n);
  });
});
