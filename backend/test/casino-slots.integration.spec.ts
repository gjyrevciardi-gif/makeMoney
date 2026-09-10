import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CasinoFairnessService } from '../src/casino/casino-fairness.service';
import { CasinoRoundService } from '../src/casino/casino-round.service';
import { CasinoConfigService } from '../src/casino/casino-config.service';
import { CasinoGameRegistry } from '../src/casino/casino-game.registry';

import { SlotsService } from '../src/casino/games/slots/slots.service';
import { SpinSlotDto } from '../src/casino/games/slots/slot.dto';
import { FOOLS_GOLD_RUSH_V1, slotVersion } from '../src/casino/games/slots/slot.definitions';
import {
  buildMatrix,
  deriveStops,
  evaluateLines,
  evaluateScatter,
  slotDomain,
  slotPayout,
} from '../src/casino/games/slots/slot.engine';
import { PrismaService } from '../src/prisma.service';
import { PointsService } from '../src/wallet/points.service';
import { uniqueTestEmail } from './test-identity';

describe("server-authoritative slots: Fool's Gold Rush (PostgreSQL)", () => {
  const prisma = new PrismaService();
  const fairness = new CasinoFairnessService();
  const rounds = new CasinoRoundService(prisma, fairness);
  const configs = new CasinoConfigService(prisma, new CasinoGameRegistry());
  const slots = new SlotsService(rounds, configs);
  const points = new PointsService(prisma);
  const game = FOOLS_GOLD_RUSH_V1;
  const version = slotVersion(game);
  const userEmail = uniqueTestEmail('slots-player');
  const adminEmail = uniqueTestEmail('slots-admin');
  let userId: string;
  let adminId: string;

  const spin = (overrides: Partial<SpinSlotDto> = {}): SpinSlotDto => ({
    stake: 100,
    idempotencyKey: randomUUID(),
    ...overrides,
  });

  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "CasinoGameConfigVersion", "CasinoGameConfig", "PlatformSettings", "CasinoTransaction", "CasinoRoundAction", "CasinoRound", "CasinoGameFavorite", "LedgerEntry", "BetLeg", "Bet", "AuditLog", "RefreshToken", "Wallet", "User" CASCADE',
    );
    const user = await prisma.user.create({
      data: { email: userEmail, passwordHash: 'x', wallet: { create: {} } },
    });
    const admin = await prisma.user.create({
      data: { email: adminEmail, passwordHash: 'x', role: 'ADMIN', wallet: { create: {} } },
    });
    userId = user.id;
    adminId = admin.id;
  });

  const fund = (amount = 100_000n) =>
    points.adminGrant(adminId, userId, amount, 'Slots funding', randomUUID());
  const balance = async () =>
    (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance;
  const ledgerTotal = async () => {
    const entries = await prisma.ledgerEntry.findMany({ where: { wallet: { userId } } });
    return entries.reduce((sum, entry) => sum + entry.amount, 0n);
  };

  type SlotState = {
    gameId: string;
    stops: number[];
    matrix: string[][];
    lineWins: { lineId: number; symbolId: string; count: number; multiplierCenti: number }[];
    scatterWin: { count: number; multiplierCenti: number } | null;
    returnNumerator: number;
    totalMultiplier: string;
    capped: boolean;
    config: { version: string; rtpBps: number; paylineCount: number };
  };

  it('settles a spin into stops, matrix and payout in one transaction', async () => {
    await fund();
    const result = await slots.spin(userId, game.gameId, spin());

    const state = result.state as unknown as SlotState;
    expect(state.gameId).toBe('fools-gold-rush');
    expect(state.stops).toHaveLength(5);
    expect(state.matrix).toHaveLength(3);
    expect(state.matrix[0]).toHaveLength(5);
    state.stops.forEach((stop, reel) => {
      expect(stop).toBeGreaterThanOrEqual(0);
      expect(stop).toBeLessThan(game.strips[reel].length);
    });
    // The stored matrix must be exactly what the stops produce.
    expect(state.matrix).toEqual(buildMatrix(game, state.stops));
    expect(result.gameVersion).toBe(version);
    expect(state.config.rtpBps).toBe(9_499);
    expect(state.config.paylineCount).toBe(20);
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(1);
    expect(await ledgerTotal()).toBe(await balance());
  });

  it('pays exactly the engine result and never more', async () => {
    await fund();
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const result = await slots.spin(userId, game.gameId, spin({ stake: 200 }));
      const state = result.state as unknown as SlotState;
      const expected = slotPayout(game, 200n, state.returnNumerator);
      expect(result.payout).toBe(expected.toString());
      // The recorded wins must reproduce the recorded numerator.
      const lines = evaluateLines(game, state.matrix);
      const scatter = evaluateScatter(game, state.matrix);
      const lineSum = lines.reduce((sum, win) => sum + win.multiplierCenti, 0);
      const scatterSum = scatter ? scatter.multiplierCenti * 20 : 0;
      expect(state.returnNumerator).toBe(lineSum + scatterSum);
      expect(state.lineWins).toHaveLength(lines.length);
    }
    expect(await ledgerTotal()).toBe(await balance());
  });

  it('credits a winning spin exactly once', async () => {
    await fund();
    let winner: Awaited<ReturnType<SlotsService['spin']>> | undefined;
    for (let attempt = 0; attempt < 60 && !winner; attempt += 1) {
      const result = await slots.spin(userId, game.gameId, spin({ stake: 200 }));
      if (result.status === 'WON' && Number(result.payout) > 0) winner = result;
    }
    expect(winner).toBeDefined();
    expect(
      await prisma.ledgerEntry.count({
        where: { type: 'CASINO_WIN', relatedCasinoRoundId: winner!.roundId },
      }),
    ).toBe(1);
    expect(
      await prisma.casinoTransaction.count({ where: { type: 'WIN', roundId: winner!.roundId } }),
    ).toBe(1);
    expect(await ledgerTotal()).toBe(await balance());
  });

  it('writes no positive credit for a losing spin', async () => {
    await fund();
    let loser: Awaited<ReturnType<SlotsService['spin']>> | undefined;
    for (let attempt = 0; attempt < 60 && !loser; attempt += 1) {
      const result = await slots.spin(userId, game.gameId, spin({ stake: 100 }));
      if (result.status === 'LOST') loser = result;
    }
    expect(loser).toBeDefined();
    expect(loser!.payout).toBe('0');
    expect(
      await prisma.ledgerEntry.count({
        where: { type: 'CASINO_WIN', relatedCasinoRoundId: loser!.roundId },
      }),
    ).toBe(0);
    const stored = await prisma.casinoRound.findUniqueOrThrow({ where: { id: loser!.roundId } });
    expect(stored.payout).toBe(0n);
    expect(stored.status).toBe('LOST');
  });

  it.each([
    ['zero stake', { stake: 0 }],
    ['negative stake', { stake: -100 }],
    ['stake above the maximum', { stake: 1_000_001 }],
    ['stake below one point per line', { stake: 19 }],
  ])('rejects %s', async (_label, overrides) => {
    await fund();
    await expect(slots.spin(userId, game.gameId, spin(overrides)))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.casinoRound.count()).toBe(0);
  });

  it('accepts the exact minimum stake of one point per payline', async () => {
    await fund();
    const result = await slots.spin(userId, game.gameId, spin({ stake: 20 }));
    expect(result.stake).toBe('20');
  });

  it('rejects an unknown slot game', async () => {
    await fund();
    await expect(slots.spin(userId, 'not-a-game', spin()))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(await prisma.casinoRound.count()).toBe(0);
  });

  it('refuses a spin the wallet cannot cover and leaves no partial accounting', async () => {
    await expect(slots.spin(userId, game.gameId, spin()))
      .rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.casinoRound.count()).toBe(0);
    expect(await prisma.ledgerEntry.count()).toBe(0);
    expect(await balance()).toBe(0n);
  });

  it('replays a duplicate idempotency key without respinning', async () => {
    await fund();
    const payload = spin();
    const first = await slots.spin(userId, game.gameId, payload);
    const second = await slots.spin(userId, game.gameId, payload);

    expect(second.roundId).toBe(first.roundId);
    expect(second.state).toEqual(first.state);
    expect(second.payout).toBe(first.payout);
    expect((second.state as unknown as SlotState).stops)
      .toEqual((first.state as unknown as SlotState).stops);
    expect(await prisma.casinoRound.count()).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(1);
    expect(
      await prisma.ledgerEntry.count({
        where: { type: 'CASINO_WIN', relatedCasinoRoundId: first.roundId },
      }),
    ).toBeLessThanOrEqual(1);
  });

  it('does not reroll when concurrent duplicates arrive', async () => {
    await fund();
    const payload = spin({ stake: 500 });
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, () => slots.spin(userId, game.gameId, payload)),
    );
    const settled = attempts
      .filter((attempt): attempt is PromiseFulfilledResult<Awaited<ReturnType<SlotsService['spin']>>> =>
        attempt.status === 'fulfilled')
      .map((attempt) => attempt.value);
    expect(settled.length).toBeGreaterThan(0);
    const distinct = new Set(settled.map((round) => round.roundId));
    expect(distinct.size).toBe(1);
    expect(await prisma.casinoRound.count()).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(1);
    expect(await ledgerTotal()).toBe(await balance());
  });

  it('rejects another user reusing an idempotency key', async () => {
    await fund();
    const payload = spin();
    await slots.spin(userId, game.gameId, payload);
    await expect(slots.spin(adminId, game.gameId, payload)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'IDEMPOTENCY_KEY_CONFLICT' }),
    });
  });

  it('reproduces stops, matrix and payout from the revealed fairness inputs', async () => {
    await fund();
    const result = await slots.spin(userId, game.gameId, spin({ stake: 400 }));
    const stored = await prisma.casinoRound.findUniqueOrThrow({ where: { id: result.roundId } });
    const state = stored.publicState as unknown as SlotState;

    const recomputedStops = deriveStops({
      serverSeed: stored.serverSeed,
      domain: slotDomain(game, stored.gameVersion),
      clientSeed: stored.clientSeed,
      nonce: stored.nonce,
    }, game);

    expect(recomputedStops).toEqual(state.stops);
    const recomputedMatrix = buildMatrix(game, recomputedStops);
    expect(recomputedMatrix).toEqual(state.matrix);
    const lines = evaluateLines(game, recomputedMatrix);
    const scatter = evaluateScatter(game, recomputedMatrix);
    const numerator = lines.reduce((sum, win) => sum + win.multiplierCenti, 0)
      + (scatter ? scatter.multiplierCenti * 20 : 0);
    expect(numerator).toBe(state.returnNumerator);
    expect(slotPayout(game, stored.stake, numerator)).toBe(stored.payout);
    expect(fairness.verifyCommitment(stored.serverSeed, stored.serverSeedHash)).toBe(true);
  });

  it('records the configuration version on every round', async () => {
    await fund();
    const result = await slots.spin(userId, game.gameId, spin());
    const stored = await prisma.casinoRound.findUniqueOrThrow({ where: { id: result.roundId } });
    expect(stored.gameVersion).toBe('fools-gold-rush.v1.rtp9499');
    expect(stored.gameType).toBe('SLOTS');
  });

  it('keeps concurrent spins inside the balance', async () => {
    await points.adminGrant(adminId, userId, 1_000n, 'Small funding', randomUUID());
    await Promise.allSettled(
      Array.from({ length: 12 }, () => slots.spin(userId, game.gameId, spin({ stake: 300 }))),
    );
    expect(await balance()).toBeGreaterThanOrEqual(0n);
    expect(await ledgerTotal()).toBe(await balance());
    for (const round of await prisma.casinoRound.findMany()) {
      expect(round.payout).toBeGreaterThanOrEqual(0n);
    }
  });

  it('validates its definitions on module init', () => {
    expect(() => slots.onModuleInit()).not.toThrow();
  });

  it('publishes safe public config without any seed material', async () => {
    const config = await slots.gameConfig(game.gameId);
    expect(config.gameId).toBe('fools-gold-rush');
    expect(config.version).toBe(version);
    expect(config.paylineCount).toBe(20);
    expect(config.rtpBps).toBe(9_499);
    expect(config.rtpPercent).toBe('94.993125');
    expect(config.houseEdgeBps).toBe(501);
    expect(config.minStake).toBe('20');
    expect(config.volatility).toBe('LOW');
    expect(config.maxWinMultiplier).toBe('2000.00');
    expect(JSON.stringify(config)).not.toContain('serverSeed');
    await expect(slots.gameConfig('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
