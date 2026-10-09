import { BadRequestException, ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CasinoFairnessService } from '../src/casino/casino-fairness.service';
import { CasinoRoundService } from '../src/casino/casino-round.service';
import { CasinoConfigService } from '../src/casino/casino-config.service';
import { CasinoGameRegistry } from '../src/casino/casino-game.registry';

import { PlinkoService } from '../src/casino/games/plinko/plinko.service';
import { PlayPlinkoDto } from '../src/casino/games/plinko/plinko.dto';
import {
  PLINKO_RISKS,
  PLINKO_ROWS,
  PlinkoRisk,
  plinkoBucket,
  plinkoPath,
  plinkoPaytable,
  plinkoPaytableCenti,
  plinkoTheoreticalRtpBps,
} from '../src/casino/games/plinko/plinko.engine';
import { PrismaService } from '../src/prisma.service';
import { PointsService } from '../src/wallet/points.service';
import { uniqueTestEmail } from './test-identity';

describe('server-authoritative plinko (PostgreSQL)', () => {
  const prisma = new PrismaService();
  const fairness = new CasinoFairnessService();
  const rounds = new CasinoRoundService(prisma, fairness);
  const configs = new CasinoConfigService(prisma, new CasinoGameRegistry());
  const plinko = new PlinkoService(rounds, configs);
  const points = new PointsService(prisma);
  const userEmail = uniqueTestEmail('plinko-player');
  const adminEmail = uniqueTestEmail('plinko-admin');
  let userId: string;
  let adminId: string;

  const drop = (overrides: Partial<PlayPlinkoDto> = {}): PlayPlinkoDto => ({
    stake: 100,
    rows: 12,
    risk: 'MEDIUM',
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
    await prisma.user.updateMany({ where: { role: 'USER' }, data: { createdById: admin.id } });
  });

  const fund = (amount = 100_000n) =>
    points.adminGrant(adminId, userId, amount, 'Plinko funding', randomUUID());
  const balance = async () =>
    (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance;
  const ledgerTotal = async () => {
    const entries = await prisma.ledgerEntry.findMany({ where: { wallet: { userId } } });
    return entries.reduce((sum, entry) => sum + entry.amount, 0n);
  };

  type PlinkoState = {
    rows: number;
    risk: PlinkoRisk;
    path: ('L' | 'R')[];
    bucketIndex: number;
    multiplier: string;
    paytable: string[];
    config: { version: string; rtpBps: number };
  };

  it('resolves a drop into a path, bucket and payout in one transaction', async () => {
    await fund();
    const result = await plinko.play(userId, drop());

    const state = result.state as unknown as PlinkoState;
    expect(state.rows).toBe(12);
    expect(state.risk).toBe('MEDIUM');
    expect(state.path).toHaveLength(12);
    expect(state.bucketIndex).toBe(plinkoBucket(state.path));
    expect(state.bucketIndex).toBeGreaterThanOrEqual(0);
    expect(state.bucketIndex).toBeLessThanOrEqual(12);

    const expectedCenti = plinkoPaytableCenti(12, 'MEDIUM')[state.bucketIndex];
    expect(state.multiplier).toBe((expectedCenti / 100).toFixed(2));
    expect(result.payout).toBe(((100n * BigInt(expectedCenti)) / 100n).toString());
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(1);
    expect(await ledgerTotal()).toBe(await balance());
  });

  it('settles every supported board and keeps the wallet equal to its ledger', async () => {
    await fund();
    for (const rows of PLINKO_ROWS) {
      for (const risk of PLINKO_RISKS) {
        const result = await plinko.play(userId, drop({ rows, risk, stake: 10 }));
        const state = result.state as unknown as PlinkoState;
        expect(state.path).toHaveLength(rows);
        expect(state.paytable).toEqual(plinkoPaytable(rows, risk));
        expect(result.gameVersion)
          .toBe(`plinko.v1.r${rows}.${risk.toLowerCase()}.rtp${plinkoTheoreticalRtpBps(rows, risk)}`);
      }
    }
    expect(await prisma.casinoRound.count()).toBe(9);
    expect(await ledgerTotal()).toBe(await balance());
  });

  it.each([
    ['an unsupported row count', { rows: 10 }],
    ['a zero row count', { rows: 0 }],
    ['a negative row count', { rows: -8 }],
  ])('rejects %s', async (_label, overrides) => {
    await fund();
    await expect(plinko.play(userId, drop(overrides))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'UNSUPPORTED_ROWS' }),
    });
    expect(await prisma.casinoRound.count()).toBe(0);
  });

  it('rejects an unsupported risk level', async () => {
    await fund();
    await expect(
      plinko.play(userId, drop({ risk: 'EXTREME' as PlinkoRisk })),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'UNSUPPORTED_RISK' }),
    });
    expect(await prisma.casinoRound.count()).toBe(0);
  });

  it.each([
    ['zero stake', { stake: 0 }],
    ['negative stake', { stake: -25 }],
    ['stake above the maximum', { stake: 1_000_001 }],
  ])('rejects %s', async (_label, overrides) => {
    await fund();
    await expect(plinko.play(userId, drop(overrides))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(await prisma.casinoRound.count()).toBe(0);
  });

  it('refuses a drop the wallet cannot cover and leaves no partial state', async () => {
    await expect(plinko.play(userId, drop())).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.casinoRound.count()).toBe(0);
    expect(await prisma.ledgerEntry.count()).toBe(0);
    expect(await balance()).toBe(0n);
  });

  it('credits a winning drop exactly once', async () => {
    await fund();
    let winner: Awaited<ReturnType<PlinkoService['play']>> | undefined;
    for (let attempt = 0; attempt < 60 && !winner; attempt += 1) {
      // LOW risk pays above 1x in most buckets, so a win arrives quickly
      // without the test depending on any particular path.
      const result = await plinko.play(userId, drop({ rows: 8, risk: 'LOW', stake: 100 }));
      if (result.status === 'WON' && Number(result.payout) > 100) winner = result;
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

  it('never writes a positive credit for a sub-1x bucket', async () => {
    await fund();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await plinko.play(userId, drop({ rows: 16, risk: 'HIGH', stake: 100 }));
    }
    const rounds = await prisma.casinoRound.findMany();
    for (const round of rounds) {
      const state = round.publicState as unknown as PlinkoState;
      const centi = plinkoPaytableCenti(state.rows, state.risk)[state.bucketIndex];
      expect(round.payout).toBe((100n * BigInt(centi)) / 100n);
      const credits = await prisma.ledgerEntry.count({
        where: { type: 'CASINO_WIN', relatedCasinoRoundId: round.id },
      });
      expect(credits).toBe(round.payout > 0n ? 1 : 0);
    }
    expect(await ledgerTotal()).toBe(await balance());
  });

  it('replays a duplicate request without rerolling the path', async () => {
    await fund();
    const payload = drop();
    const first = await plinko.play(userId, payload);
    const second = await plinko.play(userId, payload);

    expect(second.roundId).toBe(first.roundId);
    expect(second.state).toEqual(first.state);
    expect(second.payout).toBe(first.payout);
    expect(await prisma.casinoRound.count()).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(1);
    expect(
      await prisma.ledgerEntry.count({
        where: { type: 'CASINO_WIN', relatedCasinoRoundId: first.roundId },
      }),
    ).toBeLessThanOrEqual(1);
  });

  it('rejects another user reusing an idempotency key', async () => {
    await fund();
    const payload = drop();
    await plinko.play(userId, payload);
    await expect(plinko.play(adminId, payload)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'IDEMPOTENCY_KEY_CONFLICT' }),
    });
  });

  it('reproduces the stored path from the revealed fairness inputs', async () => {
    await fund();
    const result = await plinko.play(userId, drop({ rows: 16, risk: 'HIGH' }));
    const stored = await prisma.casinoRound.findUniqueOrThrow({ where: { id: result.roundId } });
    const state = stored.publicState as unknown as PlinkoState;

    const recomputed = plinkoPath({
      serverSeed: stored.serverSeed,
      domain: `casino:plinko:${stored.gameVersion}`,
      clientSeed: stored.clientSeed,
      nonce: stored.nonce,
    }, state.rows);

    expect(recomputed).toEqual(state.path);
    expect(plinkoBucket(recomputed)).toBe(state.bucketIndex);
    expect(fairness.verifyCommitment(stored.serverSeed, stored.serverSeedHash)).toBe(true);
  });

  it('stores the exact paytable that priced the round', async () => {
    await fund();
    const result = await plinko.play(userId, drop({ rows: 8, risk: 'HIGH' }));
    const state = result.state as unknown as PlinkoState;
    expect(state.paytable).toEqual(plinkoPaytable(8, 'HIGH'));
    expect(state.config.rtpBps).toBe(plinkoTheoreticalRtpBps(8, 'HIGH'));
    expect(state.multiplier).toBe(state.paytable[state.bucketIndex]);
  });

  it('keeps concurrent drops inside the balance', async () => {
    await points.adminGrant(adminId, userId, 1_000n, 'Small funding', randomUUID());
    await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        plinko.play(userId, drop({ stake: 300, rows: 16, risk: 'HIGH' }))),
    );
    expect(await balance()).toBeGreaterThanOrEqual(0n);
    expect(await ledgerTotal()).toBe(await balance());
  });

  it('publishes the authoritative paytables through the public config', async () => {
    const config = plinko.publicConfig();
    expect(config.supportedRows).toEqual([8, 12, 16]);
    expect(config.riskLevels).toEqual(['LOW', 'MEDIUM', 'HIGH']);
    expect(config.boards).toHaveLength(9);
    for (const board of config.boards) {
      expect(board.paytable).toHaveLength(board.rows + 1);
      expect(board.paytable).toEqual(plinkoPaytable(board.rows, board.risk));
      expect(Math.abs(board.rtpBps - config.targetRtpBps))
        .toBeLessThanOrEqual(config.rtpToleranceBps);
    }
    expect(JSON.stringify(config)).not.toContain('serverSeed');
  });
});