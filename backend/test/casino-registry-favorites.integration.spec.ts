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
import {
  CASINO_GAME_IDS,
  CasinoGameRegistry,
  validateCasinoGameEntries,
} from '../src/casino/casino-game.registry';
import { DiceService } from '../src/casino/games/dice/dice.service';
import { PrismaService } from '../src/prisma.service';
import { PointsService } from '../src/wallet/points.service';
import { uniqueTestEmail } from './test-identity';

/**
 * Casino registry, search, favorites and recent games.
 *
 * These cover the lobby surface end to end: the catalogue itself, the filters
 * that drive it, and the per-user preferences behind it, including the
 * ownership boundaries that keep one player's preferences private.
 */
describe('casino registry, search, favorites and recent games (PostgreSQL + Redis)', () => {
  const prisma = new PrismaService();
  const registry = new CasinoGameRegistry();
  let app: INestApplication;
  let auth: AuthService;
  let points: PointsService;
  let dice: DiceService;
  let redis: RedisService;
  let userId: string;
  let otherId: string;
  let adminId: string;

  const password = 'correct-horse-battery';
  const userEmail = uniqueTestEmail('lobby-user');
  const otherEmail = uniqueTestEmail('lobby-other');
  const adminEmail = uniqueTestEmail('lobby-admin');

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
    dice = app.get(DiceService);
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
    const [user, other, admin] = await Promise.all([
      prisma.user.create({
        data: { email: userEmail, passwordHash: hash, wallet: { create: {} } },
      }),
      prisma.user.create({
        data: { email: otherEmail, passwordHash: hash, wallet: { create: {} } },
      }),
      prisma.user.create({
        data: {
          email: adminEmail,
          passwordHash: hash,
          role: 'ADMIN',
          wallet: { create: {} },
        },
      }),
    ]);
    userId = user.id;
    otherId = other.id;
    adminId = admin.id;
    await prisma.user.updateMany({ where: { role: 'USER' }, data: { createdById: admin.id } });
    await points.adminGrant(adminId, userId, 50_000n, 'Lobby funding', randomUUID());
  });

  const token = async (email: string) => (await auth.login(email, password)).pair.accessToken;
  const server = () => app.getHttpServer();

  describe('the registry catalogue', () => {
    it('validates its own entries and exposes every declared game', () => {
      expect(() => validateCasinoGameEntries(registry.list())).not.toThrow();
      expect(registry.list()).toHaveLength(CASINO_GAME_IDS.length);
      const ids = registry.list().map((game) => game.id).sort();
      expect(ids).toEqual([...CASINO_GAME_IDS].sort());
    });

    it('keeps identifiers, slugs and routes unique', () => {
      const games = registry.list();
      expect(new Set(games.map((game) => game.id)).size).toBe(games.length);
      expect(new Set(games.map((game) => game.slug)).size).toBe(games.length);
      expect(new Set(games.map((game) => game.route)).size).toBe(games.length);
    });

    it('lets one settlement type back several games', () => {
      // SLOTS covers two slot families with entirely different mathematics, so
      // a type is no longer one-to-one with a game. Ids stay the unique key.
      const slots = registry.list().filter((game) => game.gameType === 'SLOTS');
      expect(slots.length).toBeGreaterThan(1);
      expect(new Set(slots.map((game) => game.id)).size).toBe(slots.length);
    });

    it('resolves a game by id and by type, and refuses an unknown one', () => {
      expect(registry.findById('dice')?.gameType).toBe('DICE');
      expect(registry.findById('titans-tempest')?.gameType).toBe('SLOTS');
      expect(registry.find('SLOTS')?.gameType).toBe('SLOTS');
      expect(registry.findById('not-a-game')).toBeUndefined();
      expect(() => registry.require('not-a-game')).toThrow();
    });

    it('publishes stake limits and a config version for every game', () => {
      for (const game of registry.list()) {
        expect(BigInt(game.minStake)).toBeGreaterThan(0n);
        expect(BigInt(game.maxStake)).toBeGreaterThanOrEqual(BigInt(game.minStake));
        expect(game.gameVersion.length).toBeGreaterThan(0);
      }
    });
  });

  describe('search and filters', () => {
    it('filters by category', () => {
      const originals = registry.list({ category: 'ORIGINALS' });
      expect(originals.length).toBeGreaterThan(0);
      expect(originals.every((game) => game.category === 'ORIGINALS')).toBe(true);
      expect(registry.list({ category: 'SLOTS' }).map((game) => game.id))
        .toEqual(['fools-gold-rush', 'titans-tempest', 'lucky-lady']);
    });

    it('filters by featured flag', () => {
      expect(registry.list({ featured: true }).every((game) => game.featured)).toBe(true);
      expect(registry.list({ featured: false }).every((game) => !game.featured)).toBe(true);
    });

    it('matches names, ids, descriptions, categories and keywords', () => {
      expect(registry.list({ search: 'dice' }).map((game) => game.id)).toContain('dice');
      expect(registry.list({ search: "fool's gold" }).map((game) => game.id))
        .toContain('fools-gold-rush');
      expect(registry.list({ search: 'table games' }).every(
        (game) => game.category === 'TABLE_GAMES',
      )).toBe(true);
    });

    it('is case and separator insensitive, and returns nothing for no match', () => {
      expect(registry.list({ search: 'DICE' }).map((game) => game.id)).toContain('dice');
      expect(registry.list({ search: '  Dice  ' }).map((game) => game.id)).toContain('dice');
      expect(registry.list({ search: 'table_games' }).length)
        .toBe(registry.list({ search: 'table games' }).length);
      expect(registry.list({ search: 'zzzz-nothing' })).toEqual([]);
    });

    it('applies filters through the API without leaking anything sensitive', async () => {
      const accessToken = await token(userEmail);
      const response = await request(server())
        .get('/casino/games?category=ORIGINALS&search=crash')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(response.body.games.map((game: { gameType: string }) => game.gameType))
        .toEqual(['CRASH']);
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain('serverSeed');
      expect(serialized).not.toContain('strips');
    });

    it('rejects an unknown category rather than silently ignoring it', async () => {
      const accessToken = await token(userEmail);
      await request(server())
        .get('/casino/games?category=NOT_A_CATEGORY')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);
    });
  });

  describe('favorites', () => {
    it('adds, lists and removes a favorite', async () => {
      const accessToken = await token(userEmail);

      const added = await request(server())
        .post('/casino/games/dice/favorite')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(201);
      expect(added.body.favorite).toBe(true);

      const listed = await request(server())
        .get('/casino/favorites')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(listed.body.games.map((game: { id: string }) => game.id)).toEqual(['dice']);

      await request(server())
        .delete('/casino/games/dice/favorite')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      const empty = await request(server())
        .get('/casino/favorites')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(empty.body.games).toEqual([]);
    });

    it('is idempotent on repeat and a no-op when removing an absent favorite', async () => {
      const accessToken = await token(userEmail);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await request(server())
          .post('/casino/games/mines/favorite')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({})
          .expect(201);
      }
      expect(await prisma.casinoGameFavorite.count({ where: { userId } })).toBe(1);

      await request(server())
        .delete('/casino/games/crash/favorite')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(await prisma.casinoGameFavorite.count({ where: { userId } })).toBe(1);
    });

    it('refuses an unknown game', async () => {
      const accessToken = await token(userEmail);
      await request(server())
        .post('/casino/games/not-a-game/favorite')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(404);
      expect(await prisma.casinoGameFavorite.count()).toBe(0);
    });

    it('keeps one player favorites private to that player', async () => {
      const mine = await token(userEmail);
      const theirs = await token(otherEmail);
      await request(server())
        .post('/casino/games/plinko/favorite')
        .set('Authorization', `Bearer ${mine}`)
        .send({})
        .expect(201);

      const otherList = await request(server())
        .get('/casino/favorites')
        .set('Authorization', `Bearer ${theirs}`)
        .expect(200);
      expect(otherList.body.games).toEqual([]);
      expect(await prisma.casinoGameFavorite.count({ where: { userId: otherId } })).toBe(0);
    });

    it('requires authentication', async () => {
      await request(server()).get('/casino/favorites').expect(401);
      await request(server()).post('/casino/games/dice/favorite').send({}).expect(401);
      await request(server()).delete('/casino/games/dice/favorite').expect(401);
    });
  });

  describe('recent games', () => {
    it('lists only games the player actually played, most recent first', async () => {
      const accessToken = await token(userEmail);
      const empty = await request(server())
        .get('/casino/recent')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(empty.body.games).toEqual([]);

      await dice.play(userId, {
        stake: 100, mode: 'ROLL_UNDER', target: 5_000, idempotencyKey: randomUUID(),
      });
      await request(server())
        .post('/casino/plinko/play')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ stake: 100, rows: 8, risk: 'LOW', idempotencyKey: randomUUID() })
        .expect(201);

      const recent = await request(server())
        .get('/casino/recent')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      const ids = recent.body.games.map((game: { id: string }) => game.id);
      expect(ids).toEqual(['plinko', 'dice']);
      expect(recent.body.games[0].lastPlayedAt).toBeTruthy();
    });

    it('collapses repeated play of one game into a single entry', async () => {
      const accessToken = await token(userEmail);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await dice.play(userId, {
          stake: 100, mode: 'ROLL_UNDER', target: 5_000, idempotencyKey: randomUUID(),
        });
      }
      const recent = await request(server())
        .get('/casino/recent')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(recent.body.games.map((game: { id: string }) => game.id)).toEqual(['dice']);
    });

    it('never shows one player rounds to another', async () => {
      const theirs = await token(otherEmail);
      await dice.play(userId, {
        stake: 100, mode: 'ROLL_UNDER', target: 5_000, idempotencyKey: randomUUID(),
      });
      const recent = await request(server())
        .get('/casino/recent')
        .set('Authorization', `Bearer ${theirs}`)
        .expect(200);
      expect(recent.body.games).toEqual([]);
    });

    it('bounds the returned list', async () => {
      const accessToken = await token(userEmail);
      await dice.play(userId, {
        stake: 100, mode: 'ROLL_UNDER', target: 5_000, idempotencyKey: randomUUID(),
      });
      await request(server())
        .get('/casino/recent?limit=0')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);
      const capped = await request(server())
        .get('/casino/recent?limit=1')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(capped.body.games.length).toBeLessThanOrEqual(1);
    });
  });
});
