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
import { PrismaService } from '../src/prisma.service';
import { PointsService } from '../src/wallet/points.service';
import { uniqueTestEmail } from './test-identity';

/**
 * HTTP-level slot security and platform integration: strict DTO rejection of
 * authoritative fields, registry and config exposure, history, admin views, and
 * cross-game wallet safety.
 */
describe('slots security and platform integration (PostgreSQL + Redis)', () => {
  const prisma = new PrismaService();
  let app: INestApplication;
  let auth: AuthService;
  let points: PointsService;
  let redis: RedisService;
  let userId: string;
  let adminId: string;

  const password = 'correct-horse-battery';
  const userEmail = uniqueTestEmail('slot-user');
  const adminEmail = uniqueTestEmail('slot-admin');
  const spinPath = '/casino/slots/fools-gold-rush/spin';

  beforeAll(async () => {
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
    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: hash,
        role: 'ADMIN',
        wallet: { create: {} },
      },
    });
    userId = user.id;
    adminId = admin.id;
    await points.adminGrant(adminId, userId, 10_000n, 'Slot funding', randomUUID());
  });

  const token = async (email: string) => (await auth.login(email, password)).pair.accessToken;
  const server = () => app.getHttpServer();
  const balance = async (id: string) =>
    (await prisma.wallet.findUniqueOrThrow({ where: { userId: id } })).balance;

  describe('authoritative fields cannot be submitted', () => {
    it.each([
      ['reelStops', { reelStops: [0, 0, 0, 0, 0] }],
      ['stops', { stops: [0, 0, 0, 0, 0] }],
      ['matrix', { matrix: [['GOLD', 'GOLD', 'GOLD', 'GOLD', 'GOLD']] }],
      ['symbols', { symbols: ['GOLD'] }],
      ['winningLines', { winningLines: [1, 2, 3] }],
      ['lineWins', { lineWins: [{ lineId: 1 }] }],
      ['multiplier', { multiplier: 1_000 }],
      ['totalMultiplier', { totalMultiplier: '500' }],
      ['payout', { payout: 999_999 }],
      ['result', { result: 'WIN' }],
      ['status', { status: 'WON' }],
      ['gameVersion', { gameVersion: 'fools-gold-rush.v1.rtp9950' }],
      ['serverSeed', { serverSeed: 'a'.repeat(64) }],
      ['userId', { userId: '00000000-0000-4000-8000-000000000000' }],
      ['role', { role: 'ADMIN' }],
      ['balance', { balance: 1_000_000 }],
      ['rtpBps', { rtpBps: 9_950 }],
    ])('rejects a spin carrying %s', async (_label, forged) => {
      const accessToken = await token(userEmail);
      const response = await request(server())
        .post(spinPath)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ stake: 100, idempotencyKey: randomUUID(), ...forged });

      expect(response.status).toBe(400);
      expect(await prisma.casinoRound.count()).toBe(0);
      expect(await balance(userId)).toBe(10_000n);
    });

    it('rejects an invalid stake and a malformed idempotency key', async () => {
      const accessToken = await token(userEmail);
      for (const body of [
        { stake: 0, idempotencyKey: randomUUID() },
        { stake: -50, idempotencyKey: randomUUID() },
        { stake: 1_000_000_001, idempotencyKey: randomUUID() },
        { stake: 100, idempotencyKey: 'not-a-uuid' },
        { idempotencyKey: randomUUID() },
      ]) {
        await request(server())
          .post(spinPath)
          .set('Authorization', `Bearer ${accessToken}`)
          .send(body)
          .expect(400);
      }
      expect(await prisma.casinoRound.count()).toBe(0);
      expect(await balance(userId)).toBe(10_000n);
    });

    it('rejects a stake below one point per payline', async () => {
      const accessToken = await token(userEmail);
      const response = await request(server())
        .post(spinPath)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ stake: 5, idempotencyKey: randomUUID() });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('STAKE_BELOW_MINIMUM');
    });

    it('returns 404 for an unknown slot game and never charges for it', async () => {
      const accessToken = await token(userEmail);
      await request(server())
        .post('/casino/slots/not-a-real-slot/spin')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ stake: 100, idempotencyKey: randomUUID() })
        .expect(404);
      expect(await balance(userId)).toBe(10_000n);
      expect(await prisma.casinoRound.count()).toBe(0);
    });

    it('requires authentication on every slot route', async () => {
      await request(server()).post(spinPath).send({}).expect(401);
      await request(server()).get('/casino/slots/fools-gold-rush/config').expect(401);
    });
  });

  describe('registry and public configuration', () => {
    it('lists eight playable games including both slots', async () => {
      const accessToken = await token(userEmail);
      const response = await request(server())
        .get('/casino/games')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      const games: { gameType: string; enabled: boolean; name: string; route: string }[] =
        response.body.games;
      const playable = games.filter((game) => game.enabled).map((game) => game.gameType).sort();
      expect(playable).toEqual(
        ['BLACKJACK', 'CRASH', 'DICE', 'MINES', 'PLINKO', 'ROULETTE', 'SLOTS', 'SLOTS'],
      );
      const slot = games.find((game) => game.gameType === 'SLOTS');
      expect(slot?.name).toBe("Fool's Gold Rush");
      expect(slot?.route).toBe('/casino/slots/fools-gold-rush');
    });

    it('publishes the full rules through both config endpoints without seed material', async () => {
      const accessToken = await token(userEmail);
      const shared = await request(server())
        .get('/casino/games/SLOTS/config')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(shared.body.games).toHaveLength(2);
      expect(shared.body.games.map((game: { gameId: string }) => game.gameId))
        .toEqual(['fools-gold-rush', 'titans-tempest']);

      const direct = await request(server())
        .get('/casino/slots/fools-gold-rush/config')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(direct.body.version).toBe('fools-gold-rush.v1.rtp9499');
      expect(direct.body.rtpPercent).toBe('94.993125');
      expect(direct.body.paylineCount).toBe(20);
      expect(direct.body.paylines).toHaveLength(20);
      expect(direct.body.symbols).toHaveLength(8);
      expect(direct.body.paytable.GOLD['5']).toBe(100_000);
      expect(direct.body.scatter.minimumCount).toBe(3);
      expect(direct.body.rules.paylineDirection).toBe('LEFT_TO_RIGHT_FROM_REEL_ONE');

      for (const body of [shared.body, direct.body]) {
        const serialized = JSON.stringify(body);
        expect(serialized).not.toContain('serverSeed');
        // Strips stay server-side: publishing them is not required to verify a
        // settled round, which is reproduced from the seed and the version.
        expect(serialized).not.toContain('strips');
      }
    });
  });

  describe('history, verification and admin', () => {
    const play = async (accessToken: string, stake = 200) => {
      const response = await request(server())
        .post(spinPath)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ stake, idempotencyKey: randomUUID() })
        .expect(201);
      return response.body;
    };

    it('shows slot rounds in personal history with their config version', async () => {
      const accessToken = await token(userEmail);
      await play(accessToken);
      const history = await request(server())
        .get('/casino/history?gameType=SLOTS')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(history.body.rounds).toHaveLength(1);
      const round = history.body.rounds[0];
      expect(round.gameType).toBe('SLOTS');
      expect(round.gameVersion).toBe('fools-gold-rush.v1.rtp9499');
      expect(round.state.matrix).toHaveLength(3);
      expect(round.state.stops).toHaveLength(5);
      expect(round.stake).toBe('200');
    });

    it('verifies a settled spin and reveals its seed', async () => {
      const accessToken = await token(userEmail);
      const round = await play(accessToken);
      const verification = await request(server())
        .get(`/casino/rounds/${round.roundId}/verification`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(verification.body.commitmentValid).toBe(true);
      expect(verification.body.serverSeed).toMatch(/^[0-9a-f]{64}$/);
      expect(verification.body.gameVersion).toBe('fools-gold-rush.v1.rtp9499');
      expect(verification.body.revealedState.stops).toEqual(round.state.stops);
    });

    it('reports the slot in admin rounds and performance with its exact theoretical RTP', async () => {
      const accessToken = await token(userEmail);
      const adminToken = await token(adminEmail);
      await play(accessToken, 200);
      await play(accessToken, 200);

      const adminRounds = await request(server())
        .get('/admin/casino/rounds?gameType=SLOTS')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(adminRounds.body.rounds).toHaveLength(2);
      expect(adminRounds.body.rounds[0].player.email).toBe(userEmail);
      expect(adminRounds.body.rounds[0].state.matrix).toHaveLength(3);

      const performance = await request(server())
        .get('/admin/casino/performance')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const slotRow = performance.body.games.find(
        (game: { gameType: string }) => game.gameType === 'SLOTS',
      );
      expect(slotRow.configVersion).toBe('fools-gold-rush.v1.rtp9499');
      expect(slotRow.theoreticalRtpBps).toBe(9_499);
      expect(slotRow.houseEdgeBps).toBe(501);
      expect(slotRow.rounds).toBe(2);
      expect(slotRow.totalWagered).toBe('400');
      expect(slotRow.observedRtp).not.toBeNull();
    });

    it('keeps slot administration closed to a USER', async () => {
      const userToken = await token(userEmail);
      await request(server())
        .get('/admin/casino/rounds?gameType=SLOTS')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
      await request(server())
        .get('/admin/casino/performance')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });

    it('hides another player slot round', async () => {
      const accessToken = await token(userEmail);
      const adminToken = await token(adminEmail);
      const round = await play(accessToken);
      await request(server())
        .get(`/casino/rounds/${round.roundId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('cross-game wallet safety', () => {
    it('never lets concurrent slot, crash and plinko play overdraw the wallet', async () => {
      const accessToken = await token(userEmail);
      // Far more committed than the wallet holds. Instant games may credit a win
      // mid-flight, so the invariant is that accounting closes and the wallet
      // never goes negative, not that a fixed number of requests succeed.
      await Promise.allSettled([
        ...Array.from({ length: 6 }, () => request(server())
          .post(spinPath)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ stake: 700, idempotencyKey: randomUUID() })),
        ...Array.from({ length: 6 }, () => request(server())
          .post('/casino/plinko/play')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ stake: 700, rows: 16, risk: 'HIGH', idempotencyKey: randomUUID() })),
        request(server())
          .post('/casino/crash/start')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ stake: 700, idempotencyKey: randomUUID() }),
      ]);

      const current = await balance(userId);
      expect(current).toBeGreaterThanOrEqual(0n);

      const entries = await prisma.ledgerEntry.findMany({ where: { wallet: { userId } } });
      expect(entries.reduce((sum, entry) => sum + entry.amount, 0n)).toBe(current);

      const debited = entries
        .filter((entry) => entry.type === 'CASINO_BET')
        .reduce((sum, entry) => sum + -entry.amount, 0n);
      const credited = entries
        .filter((entry) => entry.type === 'CASINO_WIN')
        .reduce((sum, entry) => sum + entry.amount, 0n);
      // Every committed debit was funded by the grant plus credits that had
      // already committed; nothing was spent against an uncommitted future win.
      expect(debited).toBeLessThanOrEqual(10_000n + credited);

      // Exactly-once payout still holds for every round involved.
      for (const round of await prisma.casinoRound.findMany()) {
        const credits = await prisma.ledgerEntry.count({
          where: { type: 'CASINO_WIN', relatedCasinoRoundId: round.id },
        });
        expect(credits).toBeLessThanOrEqual(1);
      }
    });
  });
});