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
import { CrashService } from '../src/casino/games/crash/crash.service';
import { PrismaService } from '../src/prisma.service';
import { PointsService } from '../src/wallet/points.service';
import { uniqueTestEmail } from './test-identity';

/**
 * HTTP-level security for the two Milestone 3 games: strict DTO rejection of
 * authoritative fields, hidden-state secrecy for an in-flight Crash round,
 * ownership isolation, and cross-game wallet safety.
 */
describe('crash and plinko security boundaries (PostgreSQL + Redis)', () => {
  const prisma = new PrismaService();
  let app: INestApplication;
  let auth: AuthService;
  let points: PointsService;
  let crash: CrashService;
  let redis: RedisService;
  let userId: string;
  let otherId: string;
  let adminId: string;

  const password = 'correct-horse-battery';
  const userEmail = uniqueTestEmail('m3-user');
  const otherEmail = uniqueTestEmail('m3-other');
  const adminEmail = uniqueTestEmail('m3-admin');

  beforeAll(async () => {
    process.env.CASINO_CRASH_RTP_BPS = '9700';
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
    crash = app.get(CrashService);
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
      data: { email: userEmail, passwordHash: hash, wallet: { create: {} } },
    });
    const other = await prisma.user.create({
      data: { email: otherEmail, passwordHash: hash, wallet: { create: {} } },
    });
    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: hash,
        role: 'ADMIN',
        wallet: { create: {} },
      },
    });
    userId = user.id;
    otherId = other.id;
    adminId = admin.id;
    await points.adminGrant(adminId, userId, 10_000n, 'M3 funding', randomUUID());
    await points.adminGrant(adminId, otherId, 10_000n, 'M3 funding', randomUUID());
  });

  const token = async (email: string) => (await auth.login(email, password)).pair.accessToken;
  const server = () => app.getHttpServer();
  const balance = async (id: string) =>
    (await prisma.wallet.findUniqueOrThrow({ where: { userId: id } })).balance;

  /** Opens a Crash round that is actually running, skipping instant busts. */
  const openRunningRound = async () => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const round = await crash.start(userId, { stake: 100, idempotencyKey: randomUUID() });
      if (round.status === 'OPEN') return round;
    }
    throw new Error('could not open a running crash round');
  };

  describe('authoritative fields cannot be submitted', () => {
    it.each([
      ['crashPoint', { crashPoint: 1_000 }],
      ['currentMultiplier', { currentMultiplier: 500 }],
      ['cashoutMultiplier', { cashoutMultiplier: 500 }],
      ['elapsedMs', { elapsedMs: 99_999 }],
      ['startedAt', { startedAt: '2020-01-01T00:00:00.000Z' }],
      ['payout', { payout: 999_999 }],
      ['status', { status: 'CASHED_OUT' }],
      ['serverSeed', { serverSeed: 'a'.repeat(64) }],
      ['userId', { userId: '00000000-0000-4000-8000-000000000000' }],
      ['role', { role: 'ADMIN' }],
      ['balance', { balance: 1_000_000 }],
    ])('rejects a crash start carrying %s', async (_label, forged) => {
      const accessToken = await token(userEmail);
      const response = await request(server())
        .post('/casino/crash/start')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ stake: 100, idempotencyKey: randomUUID(), ...forged });

      expect(response.status).toBe(400);
      expect(await prisma.casinoRound.count()).toBe(0);
      expect(await balance(userId)).toBe(10_000n);
    });

    it.each([
      ['cashoutMultiplier', { cashoutMultiplier: 500 }],
      ['currentMultiplier', { currentMultiplier: 500 }],
      ['elapsedMs', { elapsedMs: 99_999 }],
      ['payout', { payout: 999_999 }],
      ['status', { status: 'CASHED_OUT' }],
    ])('rejects a crash cashout carrying %s', async (_label, forged) => {
      const accessToken = await token(userEmail);
      const round = await openRunningRound();

      const response = await request(server())
        .post(`/casino/crash/${round.roundId}/cashout`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ idempotencyKey: randomUUID(), ...forged });

      expect(response.status).toBe(400);
      expect(await prisma.casinoRoundAction.count()).toBe(0);
      const stored = await prisma.casinoRound.findUniqueOrThrow({
        where: { id: round.roundId },
      });
      expect(stored.status).toBe('OPEN');
      expect(stored.payout).toBe(0n);
    });

    it('rejects an auto-cashout outside the allowed bounds', async () => {
      const accessToken = await token(userEmail);
      for (const autoCashoutCenti of [100, 0, -200, 1_000_001]) {
        await request(server())
          .post('/casino/crash/start')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ stake: 100, autoCashoutCenti, idempotencyKey: randomUUID() })
          .expect(400);
      }
      expect(await prisma.casinoRound.count()).toBe(0);
    });

    it.each([
      ['path', { path: ['R', 'R', 'R'] }],
      ['bucketIndex', { bucketIndex: 0 }],
      ['multiplier', { multiplier: 1_000 }],
      ['payout', { payout: 999_999 }],
      ['result', { result: 5 }],
      ['status', { status: 'WON' }],
      ['serverSeed', { serverSeed: 'a'.repeat(64) }],
      ['userId', { userId: '00000000-0000-4000-8000-000000000000' }],
      ['role', { role: 'ADMIN' }],
      ['balance', { balance: 1_000_000 }],
    ])('rejects a plinko drop carrying %s', async (_label, forged) => {
      const accessToken = await token(userEmail);
      const response = await request(server())
        .post('/casino/plinko/play')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          stake: 100,
          rows: 12,
          risk: 'MEDIUM',
          idempotencyKey: randomUUID(),
          ...forged,
        });

      expect(response.status).toBe(400);
      expect(await prisma.casinoRound.count()).toBe(0);
      expect(await balance(userId)).toBe(10_000n);
    });

    it('rejects an unsupported plinko board through the API', async () => {
      const accessToken = await token(userEmail);
      for (const body of [
        { stake: 100, rows: 10, risk: 'MEDIUM' },
        { stake: 100, rows: 0, risk: 'MEDIUM' },
        { stake: 100, rows: 12, risk: 'EXTREME' },
        { stake: 100, rows: 12, risk: 'medium' },
      ]) {
        await request(server())
          .post('/casino/plinko/play')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ ...body, idempotencyKey: randomUUID() })
          .expect(400);
      }
      expect(await prisma.casinoRound.count()).toBe(0);
    });

    it('rejects a malformed idempotency key on both games', async () => {
      const accessToken = await token(userEmail);
      await request(server())
        .post('/casino/crash/start')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ stake: 100, idempotencyKey: 'not-a-uuid' })
        .expect(400);
      await request(server())
        .post('/casino/plinko/play')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ stake: 100, rows: 12, risk: 'MEDIUM', idempotencyKey: 'not-a-uuid' })
        .expect(400);
      expect(await prisma.casinoRound.count()).toBe(0);
    });
  });

  describe('crash hidden state', () => {
    it('never exposes the crash point or the raw seed of a running round', async () => {
      const accessToken = await token(userEmail);
      const adminToken = await token(adminEmail);
      const round = await openRunningRound();
      const stored = await prisma.casinoRound.findUniqueOrThrow({
        where: { id: round.roundId },
      });
      const secret = stored.serverSeed;

      const paths: [string, string][] = [
        [`/casino/rounds/${round.roundId}`, accessToken],
        ['/casino/history?gameType=CRASH', accessToken],
        ['/casino/crash/active', accessToken],
        ['/admin/casino/rounds?gameType=CRASH', adminToken],
      ];
      for (const [path, bearer] of paths) {
        const response = await request(server())
          .get(path)
          .set('Authorization', `Bearer ${bearer}`)
          .expect(200);
        const serialized = JSON.stringify(response.body);
        expect(serialized).not.toContain(secret);
        expect(serialized).not.toContain('crashPointCenti');
        expect(serialized).not.toContain('privateState');
      }
    });

    it('refuses to verify a running round and reveals it once terminal', async () => {
      const accessToken = await token(userEmail);
      const round = await openRunningRound();

      await request(server())
        .get(`/casino/rounds/${round.roundId}/verification`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);

      // Force the round past its crash point through the authoritative sweep.
      await prisma.casinoRound.update({
        where: { id: round.roundId },
        data: {
          publicState: {
            ...(round.state as Record<string, unknown>),
            startedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
          },
        },
      });
      await crash.settleDue();

      const verification = await request(server())
        .get(`/casino/rounds/${round.roundId}/verification`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(verification.body.commitmentValid).toBe(true);
      expect(verification.body.serverSeed).toMatch(/^[0-9a-f]{64}$/);
      expect(verification.body.revealedState.crashPointCenti).toBeGreaterThanOrEqual(100);
    });

    it('does not leak an open plinko or crash round to another player', async () => {
      const intruder = await token(otherEmail);
      const round = await openRunningRound();

      await request(server())
        .get(`/casino/rounds/${round.roundId}`)
        .set('Authorization', `Bearer ${intruder}`)
        .expect(404);
      await request(server())
        .post(`/casino/crash/${round.roundId}/cashout`)
        .set('Authorization', `Bearer ${intruder}`)
        .send({ idempotencyKey: randomUUID() })
        .expect(404);
      const active = await request(server())
        .get('/casino/crash/active')
        .set('Authorization', `Bearer ${intruder}`)
        .expect(200);
      expect(active.body).toEqual({});
      expect(await balance(otherId)).toBe(10_000n);
    });

    it('requires authentication on every new route', async () => {
      await request(server()).post('/casino/crash/start').send({}).expect(401);
      await request(server()).get('/casino/crash/active').expect(401);
      await request(server()).post('/casino/plinko/play').send({}).expect(401);
    });
  });

  describe('registry, history and admin', () => {
    it('lists crash and plinko among the playable games', async () => {
      const accessToken = await token(userEmail);
      const response = await request(server())
        .get('/casino/games')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      const games: { gameType: string; enabled: boolean }[] = response.body.games;
      const playable = games.filter((game) => game.enabled).map((game) => game.gameType).sort();
      // Slots became playable in the following milestone; the full roster is
      // asserted in the slots suite, so this one only guards its own games.
      expect(playable).toEqual(expect.arrayContaining(['CRASH', 'PLINKO']));
      expect(playable).toEqual(
        ['BLACKJACK', 'CRASH', 'DICE', 'MINES', 'PLINKO', 'ROULETTE', 'SLOTS'],
      );
    });

    it('publishes safe public config for both games without any seed', async () => {
      const accessToken = await token(userEmail);
      for (const gameType of ['CRASH', 'PLINKO']) {
        const response = await request(server())
          .get(`/casino/games/${gameType}/config`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);
        const serialized = JSON.stringify(response.body);
        expect(serialized).not.toContain('serverSeed');
        expect(serialized).not.toContain('crashPoint');
      }
    });

    it('shows terminal crash and plinko rounds in history and admin performance', async () => {
      const accessToken = await token(userEmail);
      const adminToken = await token(adminEmail);
      await request(server())
        .post('/casino/plinko/play')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ stake: 100, rows: 8, risk: 'LOW', idempotencyKey: randomUUID() })
        .expect(201);

      const history = await request(server())
        .get('/casino/history?gameType=PLINKO')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(history.body.rounds).toHaveLength(1);
      const plinkoRound = history.body.rounds[0];
      expect(plinkoRound.state.rows).toBe(8);
      expect(plinkoRound.state.risk).toBe('LOW');
      expect(plinkoRound.state.bucketIndex).toBeGreaterThanOrEqual(0);
      expect(plinkoRound.state.paytable).toHaveLength(9);

      const performance = await request(server())
        .get('/admin/casino/performance')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const plinkoRow = performance.body.games.find(
        (game: { gameType: string }) => game.gameType === 'PLINKO',
      );
      expect(plinkoRow.configVersion).toBe('plinko.v1.r8.low.rtp9700');
      expect(plinkoRow.theoreticalRtpBps).toBe(9_700);
      expect(plinkoRow.houseEdgeBps).toBe(300);
      expect(plinkoRow.totalWagered).toBe('100');
    });

    it('keeps casino administration closed to a USER', async () => {
      const userToken = await token(userEmail);
      await request(server())
        .get('/admin/casino/rounds?gameType=CRASH')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
      await request(server())
        .get('/admin/casino/performance')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });
  });

  describe('cross-game wallet safety', () => {
    it('keeps concurrent crash and plinko spending inside the balance', async () => {
      const accessToken = await token(userEmail);
      // Both requests stake the entire balance. Plinko is an instant game that
      // may credit a win inside its own transaction, so "exactly one succeeds"
      // is not an invariant here; what must always hold is that spending never
      // outruns the funds that were actually available.
      const attempts = await Promise.allSettled([
        request(server())
          .post('/casino/crash/start')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ stake: 10_000, idempotencyKey: randomUUID() }),
        request(server())
          .post('/casino/plinko/play')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ stake: 10_000, rows: 16, risk: 'HIGH', idempotencyKey: randomUUID() }),
      ]);

      const accepted = attempts.filter(
        (attempt) => attempt.status === 'fulfilled' && attempt.value.status < 400,
      );
      expect(accepted.length).toBeGreaterThanOrEqual(1);
      expect(await balance(userId)).toBeGreaterThanOrEqual(0n);

      const entries = await prisma.ledgerEntry.findMany({ where: { wallet: { userId } } });
      const debited = entries
        .filter((entry) => entry.type === 'CASINO_BET')
        .reduce((sum, entry) => sum + -entry.amount, 0n);
      const credited = entries
        .filter((entry) => entry.type === 'CASINO_WIN')
        .reduce((sum, entry) => sum + entry.amount, 0n);

      // Accounting closes exactly, and a second full-balance debit could only
      // ever have been funded by a credit that committed before it.
      expect(entries.reduce((sum, entry) => sum + entry.amount, 0n))
        .toBe(await balance(userId));
      expect(debited).toBeLessThanOrEqual(10_000n + credited);
      if (accepted.length === 2) expect(credited).toBeGreaterThanOrEqual(10_000n);
    });

    it('never lets sustained plinko concurrency drive the wallet negative', async () => {
      const accessToken = await token(userEmail);
      await Promise.allSettled(
        Array.from({ length: 20 }, () =>
          request(server())
            .post('/casino/plinko/play')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ stake: 1_000, rows: 16, risk: 'HIGH', idempotencyKey: randomUUID() })),
      );
      const current = await balance(userId);
      expect(current).toBeGreaterThanOrEqual(0n);
      const entries = await prisma.ledgerEntry.findMany({ where: { wallet: { userId } } });
      expect(entries.reduce((sum, entry) => sum + entry.amount, 0n)).toBe(current);
    });
  });
});