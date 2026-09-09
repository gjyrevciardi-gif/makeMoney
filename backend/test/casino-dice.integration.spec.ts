import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CasinoFairnessService } from '../src/casino/casino-fairness.service';
import { CasinoRoundService } from '../src/casino/casino-round.service';
import { CasinoConfigService } from '../src/casino/casino-config.service';
import { CasinoGameRegistry } from '../src/casino/casino-game.registry';

import { DiceService } from '../src/casino/games/dice/dice.service';
import { PlayDiceDto } from '../src/casino/games/dice/dice.dto';
import { PrismaService } from '../src/prisma.service';
import { PointsService } from '../src/wallet/points.service';

describe('server-authoritative dice (PostgreSQL)', () => {
  const prisma = new PrismaService();
  const fairness = new CasinoFairnessService();
  const rounds = new CasinoRoundService(prisma, fairness);
  const configs = new CasinoConfigService(prisma, new CasinoGameRegistry());
  const dice = new DiceService(rounds, configs);
  const points = new PointsService(prisma);
  let userId: string;
  let adminId: string;

  const play = (overrides: Partial<PlayDiceDto> = {}): PlayDiceDto => ({
    stake: 100,
    mode: 'ROLL_UNDER',
    target: 5_000,
    idempotencyKey: randomUUID(),
    ...overrides,
  });

  beforeAll(async () => {
    process.env.CASINO_DICE_RTP_BPS = '9700';
    await prisma.$connect();
  });
  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "CasinoGameConfigVersion", "CasinoGameConfig", "PlatformSettings", "CasinoTransaction", "CasinoRoundAction", "CasinoRound", "CasinoGameFavorite", "LedgerEntry", "BetLeg", "Bet", "AuditLog", "RefreshToken", "Wallet", "User" CASCADE',
    );
    const user = await prisma.user.create({
      data: { email: 'dice-player@example.test', passwordHash: 'x', wallet: { create: {} } },
    });
    const admin = await prisma.user.create({
      data: { email: 'dice-admin@example.test', passwordHash: 'x', role: 'ADMIN', wallet: { create: {} } },
    });
    userId = user.id;
    adminId = admin.id;
  });

  const fund = (amount = 10_000n) =>
    points.adminGrant(adminId, userId, amount, 'Dice test funding', randomUUID());
  const balance = async () =>
    (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance;

  it('resolves a round entirely server-side and records one bet ledger entry', async () => {
    await fund();
    const result = await dice.play(userId, play());

    expect(result.status === 'WON' || result.status === 'LOST').toBe(true);
    const state = result.state as Record<string, unknown>;
    expect(state.roll).toBeGreaterThanOrEqual(0);
    expect(state.roll).toBeLessThan(10_000);
    expect(state.won).toBe(result.status === 'WON');
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(1);
    expect(await prisma.casinoTransaction.count({ where: { type: 'BET' } })).toBe(1);
  });

  it('applies the exact configured multiplier and floors the payout', async () => {
    await fund();
    // No target can force a win, so the assertion is on the mapping rather than
    // on a predicted roll: 9700/5000 = 1.94, and floor(101 * 1.94) = 195.
    const result = await dice.play(userId, play({ target: 5_000, stake: 101 }));
    if (result.status === 'WON') {
      expect(result.multiplier).toBe('1.94');
      expect(result.payout).toBe('195');
    } else {
      expect(result.multiplier).toBe('0');
      expect(result.payout).toBe('0');
    }
  });

  it('credits a winning payout exactly once and keeps the wallet equal to its ledger', async () => {
    await fund(10_000n);
    let winner: Awaited<ReturnType<DiceService['play']>> | undefined;
    for (let attempt = 0; attempt < 40 && !winner; attempt += 1) {
      // 98.99% of rolls win at this target, so a win arrives quickly without
      // the test depending on any particular roll.
      const result = await dice.play(userId, play({ target: 9_899, stake: 100 }));
      if (result.status === 'WON') winner = result;
    }
    expect(winner).toBeDefined();
    // 9700/9899 = 0.97989695..., floored against a stake of 100.
    expect(winner!.multiplier).toBe('0.97989695');
    expect(winner!.payout).toBe('97');
    expect(
      await prisma.ledgerEntry.count({
        where: { type: 'CASINO_WIN', relatedCasinoRoundId: winner!.roundId },
      }),
    ).toBe(1);
    expect(
      await prisma.ledgerEntry.count({
        where: { type: 'CASINO_BET', relatedCasinoRoundId: winner!.roundId },
      }),
    ).toBe(1);

    const entries = await prisma.ledgerEntry.findMany({ where: { wallet: { userId } } });
    const ledgerTotal = entries.reduce((sum, entry) => sum + entry.amount, 0n);
    expect(await balance()).toBe(ledgerTotal);
  });

  it('writes no positive credit for a losing round', async () => {
    await fund(1_000n);
    let losses = 0;
    for (let attempt = 0; attempt < 40 && losses === 0; attempt += 1) {
      const result = await dice.play(userId, play({ target: 100, stake: 1 }));
      if (result.status === 'LOST') losses += 1;
    }
    expect(losses).toBeGreaterThan(0);
    const credits = await prisma.ledgerEntry.findMany({ where: { type: 'CASINO_WIN' } });
    for (const credit of credits) expect(credit.amount).toBeGreaterThan(0n);
    const lost = await prisma.casinoRound.findMany({ where: { status: 'LOST' } });
    for (const round of lost) expect(round.payout).toBe(0n);
  });

  it.each([
    ['zero stake', { stake: 0 }],
    ['negative stake', { stake: -50 }],
    ['stake above maximum', { stake: 1_000_001 }],
  ])('rejects %s', async (_label, overrides) => {
    await fund();
    await expect(dice.play(userId, play(overrides))).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.casinoRound.count()).toBe(0);
  });

  it.each([
    ['below the minimum target', 99],
    ['above the maximum target', 9_900],
  ])('rejects a target %s', async (_label, target) => {
    await fund();
    await expect(dice.play(userId, play({ target }))).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.casinoRound.count()).toBe(0);
  });

  it('accepts the exact minimum and maximum targets', async () => {
    await fund();
    await expect(dice.play(userId, play({ target: 100 }))).resolves.toBeDefined();
    await expect(dice.play(userId, play({ target: 9_899 }))).resolves.toBeDefined();
  });

  it('refuses to play without sufficient virtual points and leaves no partial state', async () => {
    await expect(dice.play(userId, play())).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.casinoRound.count()).toBe(0);
    expect(await prisma.ledgerEntry.count()).toBe(0);
    expect(await balance()).toBe(0n);
  });

  it('replays a duplicate idempotency key without rolling again or deducting twice', async () => {
    await fund(1_000n);
    const payload = play();
    const first = await dice.play(userId, payload);
    const second = await dice.play(userId, payload);

    expect(second.roundId).toBe(first.roundId);
    expect(second.state).toEqual(first.state);
    expect(second.payout).toBe(first.payout);
    expect(await prisma.casinoRound.count()).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(1);
  });

  it('rejects another user reusing an idempotency key', async () => {
    await fund(1_000n);
    const payload = play();
    await dice.play(userId, payload);
    await expect(dice.play(adminId, payload)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'IDEMPOTENCY_KEY_CONFLICT' }),
    });
  });

  it('rejects a cross-user replay when a concurrent idempotency preflight becomes stale', async () => {
    await fund(1_000n);
    await points.adminGrant(adminId, adminId, 1_000n, 'Contender funding', randomUUID());

    const sharedKey = randomUUID();
    const contenderBalanceBefore =
      (await prisma.wallet.findUniqueOrThrow({ where: { userId: adminId } })).balance;
    const contenderLedgerBefore = await prisma.ledgerEntry.count({
      where: { wallet: { userId: adminId } },
    });

    let signalTransactionQueued!: () => void;
    const transactionQueued = new Promise<void>((resolve) => {
      signalTransactionQueued = resolve;
    });
    let releaseTransaction!: () => void;
    const transactionGate = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });

    // Delay only the contender's transaction after its outer lookup returned
    // no round. The owner can then commit the shared key, reproducing the
    // exact TOCTOU window against real PostgreSQL deterministically.
    const delayedPrisma = {
      casinoRound: prisma.casinoRound,
      $transaction: async (
        callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options?: { maxWait?: number; timeout?: number },
      ) => {
        signalTransactionQueued();
        await transactionGate;
        return prisma.$transaction(callback, options);
      },
    } as unknown as PrismaService;
    const contenderDice = new DiceService(
      new CasinoRoundService(delayedPrisma, new CasinoFairnessService()),
      configs,
    );
    const contenderPromise = contenderDice
      .play(adminId, play({ idempotencyKey: sharedKey }))
      .then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason: unknown) => ({ status: 'rejected' as const, reason }),
      );

    await transactionQueued;
    let ownerRound: Awaited<ReturnType<DiceService['play']>>;
    try {
      ownerRound = await dice.play(userId, play({ idempotencyKey: sharedKey }));
    } finally {
      releaseTransaction();
    }
    const contender = await contenderPromise;

    expect(contender.status).toBe('rejected');
    if (contender.status !== 'rejected') throw new Error('cross-user replay unexpectedly succeeded');
    expect(contender.reason).toMatchObject({
      response: expect.objectContaining({ code: 'IDEMPOTENCY_KEY_CONFLICT' }),
    });
    const storedRounds = await prisma.casinoRound.findMany();
    expect(storedRounds).toHaveLength(1);
    expect(storedRounds[0]).toMatchObject({ id: ownerRound.roundId, userId });
    const rejectedResponse = JSON.stringify(
      (contender.reason as { response?: unknown }).response,
    );
    expect(rejectedResponse).not.toContain(ownerRound.roundId);
    expect(rejectedResponse).not.toContain(storedRounds[0].serverSeed);
    expect(rejectedResponse).not.toContain('privateState');
    expect(await prisma.casinoRound.count({ where: { userId: adminId } })).toBe(0);
    expect(await prisma.casinoTransaction.count({ where: { userId: adminId } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { wallet: { userId: adminId } } })).toBe(
      contenderLedgerBefore,
    );
    expect(
      (await prisma.wallet.findUniqueOrThrow({ where: { userId: adminId } })).balance,
    ).toBe(contenderBalanceBefore);
  });

  it('prevents concurrent overspending in real PostgreSQL', async () => {
    await fund(1_000n);
    // Both attempts stake the entire balance at a sub-1.0 multiplier, so
    // whichever settles first cannot leave enough behind to fund the other,
    // whether it wins or loses. Exactly one may therefore succeed.
    const attempts = await Promise.allSettled([
      dice.play(userId, play({ stake: 1_000, target: 9_899 })),
      dice.play(userId, play({ stake: 1_000, target: 9_899 })),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.casinoRound.count()).toBe(1);
    expect(await balance()).toBeGreaterThanOrEqual(0n);
  });

  it('never lets concurrent play drive the wallet negative', async () => {
    await fund(1_000n);
    await Promise.allSettled(
      Array.from({ length: 12 }, () => dice.play(userId, play({ stake: 300, target: 9_899 }))),
    );
    const current = await balance();
    expect(current).toBeGreaterThanOrEqual(0n);
    const entries = await prisma.ledgerEntry.findMany({ where: { wallet: { userId } } });
    expect(entries.reduce((sum, entry) => sum + entry.amount, 0n)).toBe(current);
  });

  it('stores the configuration version so historical rounds keep their own RTP', async () => {
    await fund();
    const result = await dice.play(userId, play());
    expect(result.gameVersion).toBe('dice.v1.rtp9700');
    const state = result.state as { config: { rtpBps: number; houseEdgeBps: number } };
    expect(state.config.rtpBps).toBe(9_700);
    expect(state.config.houseEdgeBps).toBe(300);

    // The active configuration is now persisted and operator-controlled, so the
    // environment no longer reprices a live game on its own. Changing the
    // environment mid-run must leave both the round and the active version
    // exactly as they were; repricing happens by activating a new version,
    // which the administrator configuration suite covers.
    process.env.CASINO_DICE_RTP_BPS = '9500';
    const later = await dice.play(userId, play());
    expect(later.gameVersion).toBe('dice.v1.rtp9700');
    const stored = await prisma.casinoRound.findUniqueOrThrow({ where: { id: result.roundId } });
    expect(stored.gameVersion).toBe('dice.v1.rtp9700');
    process.env.CASINO_DICE_RTP_BPS = '9700';
  });

  it('reveals the server seed only after settlement and it verifies against the commitment', async () => {
    await fund();
    const result = await dice.play(userId, play());
    const revealed = result.fairness as { serverSeed?: string; serverSeedHash: string };
    expect(revealed.serverSeed).toBeDefined();
    expect(fairness.verifyCommitment(revealed.serverSeed!, revealed.serverSeedHash)).toBe(true);
  });
});
