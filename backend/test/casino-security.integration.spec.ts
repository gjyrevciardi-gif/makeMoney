import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { BigIntInterceptor } from '../src/common/bigint.interceptor';
import { RedisService } from '../src/common/redis.service';
import { MinesService } from '../src/casino/games/mines/mines.service';
import { PrismaService } from '../src/prisma.service';
import { PointsService } from '../src/wallet/points.service';

describe('casino security boundaries (PostgreSQL + Redis)', () => {
  const prisma = new PrismaService();
  let app: INestApplication;
  let auth: AuthService;
  let points: PointsService;
  let mines: MinesService;
  let redis: RedisService;
  let userId: string;
  let otherId: string;
  let adminId: string;

  const password = 'correct-horse-battery';

  beforeAll(async () => {
    process.env.CASINO_DICE_RTP_BPS = '9700';
    process.env.CASINO_MINES_RTP_BPS = '9700';
    process.env.SPORTS_SETTLEMENT_ENABLED = 'false';
    await prisma.$connect();
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(new BigIntInterceptor());
    await app.init();
    auth = app.get(AuthService);
    points = app.get(PointsService);
    mines = app.get(MinesService);
    redis = app.get(RedisService);
    await redis.ensureConnected();
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
    delete process.env.SPORTS_SETTLEMENT_ENABLED;
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "CasinoGameConfigVersion", "CasinoGameConfig", "PlatformSettings", "CasinoTransaction", "CasinoRoundAction", "CasinoRound", "CasinoGameFavorite", "LedgerEntry", "BetLeg", "Bet", "AuditLog", "RefreshToken", "Wallet", "User" CASCADE',
    );
    await redis.client.flushdb();
    const hash = await argon2.hash(password);
    const user = await prisma.user.create({
      data: { email: 'casino-user@example.test', passwordHash: hash, wallet: { create: {} } },
    });
    const other = await prisma.user.create({
      data: { email: 'casino-other@example.test', passwordHash: hash, wallet: { create: {} } },
    });
    const admin = await prisma.user.create({
      data: {
        email: 'casino-admin@example.test',
        passwordHash: hash,
        role: 'ADMIN',
        wallet: { create: {} },
      },
    });
    userId = user.id;
    otherId = other.id;
    adminId = admin.id;
    await points.adminGrant(adminId, userId, 10_000n, 'Security test funding', randomUUID());
    await points.adminGrant(adminId, otherId, 10_000n, 'Security test funding', randomUUID());
  });

  const token = async (email: string) => (await auth.login(email, password)).pair.accessToken;
  const server = () => app.getHttpServer();
  const balance = async (id: string) =>
    (await prisma.wallet.findUniqueOrThrow({ where: { userId: id } })).balance;

  describe('authoritative fields cannot be submitted', () => {
    it.each([
      ['payout', { payout: 999_999 }],
      ['multiplier', { multiplier: 1_000 }],
      ['result', { result: 1 }],
      ['roll', { roll: 0 }],
      ['won', { won: true }],
      ['userId', { userId: '00000000-0000-4000-8000-000000000000' }],
      ['role', { role: 'ADMIN' }],
      ['balance', { balance: 1_000_000 }],
      ['status', { status: 'WON' }],
    ])('rejects a dice request carrying %s', async (_label, forged) => {
      const accessToken = await token('casino-user@example.test');
      const response = await request(server())
        .post('/casino/dice/play')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          stake: 100,
          mode: 'ROLL_UNDER',
          target: 5_000,
          idempotencyKey: randomUUID(),
          ...forged,
        });

      expect(response.status).toBe(400);
      expect(await prisma.casinoRound.count()).toBe(0);
      expect(await balance(userId)).toBe(10_000n);
    });

    it('rejects a mines reveal that claims the cell is safe', async () => {
      const accessToken = await token('casino-user@example.test');
      const round = await mines.start(userId, {
        stake: 100,
        mines: 5,
        idempotencyKey: randomUUID(),
      });

      const response = await request(server())
        .post(`/casino/mines/${round.roundId}/reveal`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ cell: 0, safe: true, idempotencyKey: randomUUID() });

      expect(response.status).toBe(400);
      expect(await prisma.casinoRoundAction.count()).toBe(0);
    });

    it('rejects a mines start that supplies its own board', async () => {
      const accessToken = await token('casino-user@example.test');
      const response = await request(server())
        .post('/casino/mines/start')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          stake: 100,
          mines: 5,
          minePositions: [0, 1, 2, 3, 4],
          idempotencyKey: randomUUID(),
        });

      expect(response.status).toBe(400);
      expect(await prisma.casinoRound.count()).toBe(0);
    });

    it('rejects malformed idempotency keys and out-of-range cells', async () => {
      const accessToken = await token('casino-user@example.test');
      const round = await mines.start(userId, {
        stake: 100,
        mines: 5,
        idempotencyKey: randomUUID(),
      });

      await request(server())
        .post('/casino/dice/play')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ stake: 100, mode: 'ROLL_UNDER', target: 5_000, idempotencyKey: 'not-a-uuid' })
        .expect(400);
      await request(server())
        .post(`/casino/mines/${round.roundId}/reveal`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ cell: 25, idempotencyKey: randomUUID() })
        .expect(400);
      await request(server())
        .post(`/casino/mines/${round.roundId}/reveal`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ cell: -1, idempotencyKey: randomUUID() })
        .expect(400);
    });
  });

  describe('hidden state', () => {
    it('never exposes the board or the raw seed of an open round on any read path', async () => {
      const accessToken = await token('casino-user@example.test');
      const adminToken = await token('casino-admin@example.test');
      const round = await mines.start(userId, {
        stake: 100,
        mines: 5,
        idempotencyKey: randomUUID(),
      });
      const stored = await prisma.casinoRound.findUniqueOrThrow({ where: { id: round.roundId } });
      const secret = stored.serverSeed;

      const paths: [string, string][] = [
        [`/casino/rounds/${round.roundId}`, accessToken],
        ['/casino/history', accessToken],
        ['/casino/mines/active', accessToken],
        ['/admin/casino/rounds', adminToken],
      ];
      for (const [path, bearer] of paths) {
        const response = await request(server())
          .get(path)
          .set('Authorization', `Bearer ${bearer}`)
          .expect(200);
        const serialized = JSON.stringify(response.body);
        expect(serialized).not.toContain(secret);
        expect(serialized).not.toContain('minePositions');
        expect(serialized).not.toContain('privateState');
      }
    });

    it('refuses to verify an open round and reveals the seed once it is terminal', async () => {
      const accessToken = await token('casino-user@example.test');
      const round = await mines.start(userId, {
        stake: 100,
        mines: 5,
        idempotencyKey: randomUUID(),
      });

      await request(server())
        .get(`/casino/rounds/${round.roundId}/verification`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);

      const bombs = (
        await prisma.casinoRound.findUniqueOrThrow({ where: { id: round.roundId } })
      ).privateState as unknown as { minePositions: number[] };
      await mines.reveal(userId, round.roundId, {
        cell: bombs.minePositions[0],
        idempotencyKey: randomUUID(),
      });

      const verification = await request(server())
        .get(`/casino/rounds/${round.roundId}/verification`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(verification.body.commitmentValid).toBe(true);
      expect(verification.body.serverSeed).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('ownership isolation', () => {
    it('hides another player round and refuses actions against it', async () => {
      const intruder = await token('casino-other@example.test');
      const round = await mines.start(userId, {
        stake: 100,
        mines: 5,
        idempotencyKey: randomUUID(),
      });

      await request(server())
        .get(`/casino/rounds/${round.roundId}`)
        .set('Authorization', `Bearer ${intruder}`)
        .expect(404);
      await request(server())
        .post(`/casino/mines/${round.roundId}/reveal`)
        .set('Authorization', `Bearer ${intruder}`)
        .send({ cell: 0, idempotencyKey: randomUUID() })
        .expect(404);
      await request(server())
        .post(`/casino/mines/${round.roundId}/cashout`)
        .set('Authorization', `Bearer ${intruder}`)
        .send({ idempotencyKey: randomUUID() })
        .expect(404);

      expect(await balance(otherId)).toBe(10_000n);
      expect(
        await prisma.ledgerEntry.count({ where: { wallet: { userId: otherId }, type: 'CASINO_WIN' } }),
      ).toBe(0);
    });

    it('requires authentication for every casino route', async () => {
      await request(server()).get('/casino/history').expect(401);
      await request(server()).post('/casino/dice/play').send({}).expect(401);
      await request(server()).get('/casino/mines/active').expect(401);
    });
  });

  describe('administrative boundary', () => {
    it('denies casino administration to a USER and allows it for an ADMIN', async () => {
      const userToken = await token('casino-user@example.test');
      const adminToken = await token('casino-admin@example.test');

      await request(server())
        .get('/admin/casino/rounds')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
      await request(server())
        .get('/admin/casino/performance')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);

      await request(server())
        .get('/admin/casino/rounds')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      await request(server())
        .get('/admin/casino/performance')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('exposes no casino mutation route to an administrator', async () => {
      const adminToken = await token('casino-admin@example.test');
      const round = await mines.start(userId, {
        stake: 100,
        mines: 5,
        idempotencyKey: randomUUID(),
      });

      for (const path of [
        `/admin/casino/rounds/${round.roundId}`,
        `/admin/casino/rounds/${round.roundId}/settle`,
        `/admin/casino/rounds/${round.roundId}/payout`,
      ]) {
        const response = await request(server())
          .post(path)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ status: 'WON', payout: 999_999 });
        expect(response.status).toBe(404);
      }
      const stored = await prisma.casinoRound.findUniqueOrThrow({ where: { id: round.roundId } });
      expect(stored.status).toBe('OPEN');
      expect(stored.payout).toBe(0n);
    });

    it('reports theoretical and observed return without altering any round', async () => {
      const accessToken = await token('casino-user@example.test');
      const adminToken = await token('casino-admin@example.test');
      for (let round = 0; round < 5; round += 1) {
        await request(server())
          .post('/casino/dice/play')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ stake: 100, mode: 'ROLL_UNDER', target: 5_000, idempotencyKey: randomUUID() })
          .expect(201);
      }

      const response = await request(server())
        .get('/admin/casino/performance')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const dice = response.body.games.find(
        (game: { gameType: string }) => game.gameType === 'DICE',
      );
      expect(dice.configVersion).toBe('dice.v1.rtp9700');
      expect(dice.theoreticalRtpBps).toBe(9_700);
      expect(dice.houseEdgeBps).toBe(300);
      expect(dice.rounds).toBe(5);
      expect(dice.totalWagered).toBe('500');
      expect(Number(dice.observedRtp)).toBeGreaterThanOrEqual(0);
    });
  });

  describe('cross-game wallet safety', () => {
    it('keeps concurrent spending across dice and mines within the balance', async () => {
      const accessToken = await token('casino-user@example.test');
      // Each attempt stakes the entire 10,000 balance. The dice target pays a
      // sub-1.0 multiplier, so even a winning dice round cannot leave enough
      // behind to fund the mines round, and mines credits nothing until a
      // cashout. Exactly one may therefore succeed, whichever settles first.
      const attempts = await Promise.allSettled([
        request(server())
          .post('/casino/dice/play')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ stake: 10_000, mode: 'ROLL_UNDER', target: 9_899, idempotencyKey: randomUUID() }),
        request(server())
          .post('/casino/mines/start')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ stake: 10_000, mines: 5, idempotencyKey: randomUUID() }),
      ]);

      const accepted = attempts.filter(
        (attempt) => attempt.status === 'fulfilled' && attempt.value.status < 400,
      );
      expect(accepted.length).toBe(1);
      expect(await balance(userId)).toBeGreaterThanOrEqual(0n);

      const debits = await prisma.ledgerEntry.findMany({
        where: { wallet: { userId }, type: 'CASINO_BET' },
      });
      expect(debits.reduce((sum, entry) => sum + -entry.amount, 0n)).toBeLessThanOrEqual(10_000n);
    });

    it('never allows the wallet to go negative under sustained concurrency', async () => {
      const accessToken = await token('casino-user@example.test');
      // 30 concurrent attempts at 500 points against a 10,000 balance: more
      // than the wallet can fund, so some must be refused.
      await Promise.allSettled(
        Array.from({ length: 30 }, () =>
          request(server())
            .post('/casino/dice/play')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
              stake: 500,
              mode: 'ROLL_UNDER',
              target: 9_899,
              idempotencyKey: randomUUID(),
            }),
        ),
      );

      const current = await balance(userId);
      expect(current).toBeGreaterThanOrEqual(0n);
      const entries = await prisma.ledgerEntry.findMany({ where: { wallet: { userId } } });
      expect(entries.reduce((sum, entry) => sum + entry.amount, 0n)).toBe(current);
    });
  });
});
