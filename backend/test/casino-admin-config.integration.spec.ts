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
import { CasinoClock } from '../src/casino/casino-clock.service';
import { CasinoConfigService } from '../src/casino/casino-config.service';
import { CrashService } from '../src/casino/games/crash/crash.service';
import { MinesService } from '../src/casino/games/mines/mines.service';
import { SlotsService } from '../src/casino/games/slots/slots.service';
import { diceMultiplier, diceProbability } from '../src/casino/games/dice/dice.engine';
import { casinoConfig } from '../src/casino/casino.config';
import { FOOLS_GOLD_RUSH_PROFILES } from '../src/casino/games/slots/slot.definitions';
import { analyseSlotRtp } from '../src/casino/games/slots/slot.rtp';
import {
  buildMatrix,
  deriveStops,
  slotDomain,
} from '../src/casino/games/slots/slot.engine';
import { PrismaService } from '../src/prisma.service';
import { PointsService } from '../src/wallet/points.service';
import { uniqueTestEmail } from './test-identity';

/**
 * The administrator control centre.
 *
 * Two properties matter most here and are asserted repeatedly: an operator can
 * only change *future* configuration, and a version's mathematics is immutable
 * once written, so a round already played or already running keeps exactly the
 * numbers it was opened under.
 */
describe('super admin casino configuration (PostgreSQL + Redis)', () => {
  const prisma = new PrismaService();
  let app: INestApplication;
  let auth: AuthService;
  let points: PointsService;
  let configs: CasinoConfigService;
  let mines: MinesService;
  let crash: CrashService;
  let slots: SlotsService;
  let clock: CasinoClock;
  let redis: RedisService;
  const userEmail = uniqueTestEmail('cfg-user');
  const adminEmail = uniqueTestEmail('cfg-admin');
  let userId: string;
  let adminId: string;

  const password = 'correct-horse-battery';

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
    configs = app.get(CasinoConfigService);
    mines = app.get(MinesService);
    crash = app.get(CrashService);
    slots = app.get(SlotsService);
    clock = app.get(CasinoClock);
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
    const [user, admin] = await Promise.all([
      prisma.user.create({
        data: { email: userEmail, passwordHash: hash, wallet: { create: {} } },
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
    adminId = admin.id;
    await points.adminGrant(adminId, userId, 200_000n, 'Config funding', randomUUID());
  });

  const token = async (email: string) => (await auth.login(email, password)).pair.accessToken;
  const server = () => app.getHttpServer();
  const admin = () => token(adminEmail);
  const balance = async (id = userId) =>
    (await prisma.wallet.findUniqueOrThrow({ where: { userId: id } })).balance;

  /** Creates a draft and activates it, returning the activated version. */
  const publish = async (
    gameId: string,
    body: Record<string, unknown>,
    expectedCurrentVersion?: number,
  ) => {
    const bearer = await admin();
    const draft = await request(server())
      .post(`/admin/casino/config/${gameId}/versions`)
      .set('Authorization', `Bearer ${bearer}`)
      .send(body)
      .expect(201);
    const activated = await request(server())
      .post(`/admin/casino/config/${gameId}/versions/${draft.body.versionId}/activate`)
      .set('Authorization', `Bearer ${bearer}`)
      .send(expectedCurrentVersion === undefined ? {} : { expectedCurrentVersion })
      .expect(201);
    return { draft: draft.body, activated: activated.body };
  };

  describe('seeding and read surface', () => {
    it('seeds every game from the built-in mathematics on first read', async () => {
      const bearer = await admin();
      const response = await request(server())
        .get('/admin/casino/config')
        .set('Authorization', `Bearer ${bearer}`)
        .expect(200);

      expect(response.body.games).toHaveLength(8);
      const dice = response.body.games.find((game: { gameId: string }) => game.gameId === 'dice');
      expect(dice.enabled).toBe(true);
      expect(dice.maintenance).toBe(false);
      expect(dice.rtpControl).toBe('DIRECT');
      expect(dice.activeVersion.version).toBe(1);
      // The seed reuses the label the engine already emits, so historical rounds
      // still resolve to a matching configuration.
      expect(dice.activeVersion.label).toBe('dice.v1.rtp9700');
      expect(dice.activeVersion.status).toBe('ACTIVE');
      expect(dice.activeVersion.houseEdgeBps).toBe(300);
      expect(response.body.platform.casinoMaintenance).toBe(false);
    });

    it('classifies how each game may be configured', async () => {
      const bearer = await admin();
      const response = await request(server())
        .get('/admin/casino/config')
        .set('Authorization', `Bearer ${bearer}`)
        .expect(200);
      const control = Object.fromEntries(
        response.body.games.map((game: { gameId: string; rtpControl: string }) =>
          [game.gameId, game.rtpControl]),
      );
      expect(control).toEqual({
        dice: 'DIRECT',
        mines: 'DIRECT',
        crash: 'DIRECT',
        plinko: 'PROFILE',
        'fools-gold-rush': 'PROFILE',
        'titans-tempest': 'CANONICAL',
        roulette: 'CANONICAL',
        blackjack: 'RULE_BASED',
      });
    });

    it('lists version history with authorship and lifecycle timestamps', async () => {
      const bearer = await admin();
      await publish('dice', { minStake: 1, maxStake: 500_000, rtpBps: 9_000, reason: 'Trim' });
      const history = await request(server())
        .get('/admin/casino/config/dice/versions')
        .set('Authorization', `Bearer ${bearer}`)
        .expect(200);

      expect(history.body.versions).toHaveLength(2);
      const [latest, first] = history.body.versions;
      expect(latest.version).toBe(2);
      expect(latest.status).toBe('ACTIVE');
      expect(latest.reason).toBe('Trim');
      expect(latest.createdBy.email).toBe(adminEmail);
      expect(latest.activatedAt).toBeTruthy();
      expect(first.status).toBe('SUPERSEDED');
      expect(first.supersededAt).toBeTruthy();
    });
  });

  describe('authorisation', () => {
    const mutations = (): [string, string, Record<string, unknown>][] => [
      ['post', '/admin/casino/config/dice/versions', { minStake: 1, maxStake: 100, rtpBps: 9_000 }],
      ['post', '/admin/casino/config/dice/preview', { minStake: 1, maxStake: 100, rtpBps: 9_000 }],
      ['patch', '/admin/casino/config/dice/status', { enabled: false }],
      ['patch', '/admin/platform/maintenance', { casinoMaintenance: true }],
    ];

    it('refuses every configuration mutation to a USER', async () => {
      const bearer = await token(userEmail);
      for (const [method, path, body] of mutations()) {
        await (request(server()) as never as Record<string, Function>)[method](path)
          .set('Authorization', `Bearer ${bearer}`)
          .send(body)
          .expect(403);
      }
      await request(server())
        .get('/admin/casino/config')
        .set('Authorization', `Bearer ${bearer}`)
        .expect(403);
      expect(await prisma.casinoGameConfigVersion.count({ where: { status: 'DRAFT' } })).toBe(0);
    });

    it('refuses a demoted administrator still holding a valid token', async () => {
      // A token proves who signed in, not what they may do now.
      const bearer = await admin();
      await request(server())
        .get('/admin/casino/config')
        .set('Authorization', `Bearer ${bearer}`)
        .expect(200);

      await prisma.user.update({ where: { id: adminId }, data: { role: 'USER' } });

      for (const [method, path, body] of mutations()) {
        await (request(server()) as never as Record<string, Function>)[method](path)
          .set('Authorization', `Bearer ${bearer}`)
          .send(body)
          .expect(403);
      }
      await request(server())
        .post(`/admin/users/${userId}/coins`)
        .set('Authorization', `Bearer ${bearer}`)
        .send({ amount: 100, reason: 'stale token', idempotencyKey: randomUUID() })
        .expect(403);

      const versions = await prisma.casinoGameConfigVersion.count();
      // Only the seeded versions created by the earlier authorised read exist.
      expect(versions).toBeGreaterThan(0);
      expect(await prisma.casinoGameConfigVersion.count({ where: { status: 'DRAFT' } })).toBe(0);
    });

    it('rejects a body that tries to supply the acting administrator', async () => {
      const bearer = await admin();
      for (const forged of [
        { adminId: randomUUID() },
        { actorId: randomUUID() },
        { createdByAdminId: randomUUID() },
        { createdBy: randomUUID() },
        { role: 'ADMIN' },
        { status: 'ACTIVE' },
        { label: 'dice.v9.rtp9950' },
        { version: 99 },
      ]) {
        await request(server())
          .post('/admin/casino/config/dice/versions')
          .set('Authorization', `Bearer ${bearer}`)
          .send({ minStake: 1, maxStake: 1_000, rtpBps: 9_000, ...forged })
          .expect(400);
      }
      expect(await prisma.casinoGameConfigVersion.count({ where: { status: 'DRAFT' } })).toBe(0);
    });
  });

  describe('validation', () => {
    const bad = async (gameId: string, body: Record<string, unknown>, code?: string) => {
      const bearer = await admin();
      const response = await request(server())
        .post(`/admin/casino/config/${gameId}/versions`)
        .set('Authorization', `Bearer ${bearer}`)
        .send(body);
      expect(response.status).toBe(400);
      if (code) expect(response.body.code).toBe(code);
    };

    it('rejects impossible stake limits', async () => {
      await bad('dice', { minStake: 0, maxStake: 100, rtpBps: 9_000 });
      await bad('dice', { minStake: 500, maxStake: 100, rtpBps: 9_000 }, 'INVALID_STAKE_LIMITS');
    });

    it('rejects an RTP outside the platform bounds rather than clamping it', async () => {
      await bad('dice', { minStake: 1, maxStake: 1_000, rtpBps: 4_999 }, 'RTP_OUT_OF_RANGE');
      await bad('dice', { minStake: 1, maxStake: 1_000, rtpBps: 9_951 }, 'RTP_OUT_OF_RANGE');
      await bad('dice', { minStake: 1, maxStake: 1_000 }, 'RTP_REQUIRED');
    });

    it('rejects invalid mine counts', async () => {
      await bad('mines', {
        minStake: 1, maxStake: 1_000, rtpBps: 9_000,
        gameSpecific: { allowedMines: [] },
      }, 'INVALID_MINE_COUNTS');
      await bad('mines', {
        minStake: 1, maxStake: 1_000, rtpBps: 9_000,
        gameSpecific: { allowedMines: [0, 5] },
      }, 'INVALID_MINE_COUNTS');
      await bad('mines', {
        minStake: 1, maxStake: 1_000, rtpBps: 9_000,
        gameSpecific: { allowedMines: [3, 3] },
      }, 'INVALID_MINE_COUNTS');
    });

    it('rejects an unsafe crash configuration', async () => {
      const base = { minStake: 1, maxStake: 1_000, rtpBps: 9_000 };
      await bad('crash', {
        ...base,
        gameSpecific: { maxMultiplierCenti: 100, minAutoCashoutCenti: 101, maxAutoCashoutCenti: 100 },
      }, 'INVALID_CRASH_CONFIG');
      await bad('crash', {
        ...base,
        gameSpecific: { maxMultiplierCenti: 5_000, minAutoCashoutCenti: 100, maxAutoCashoutCenti: 5_000 },
      }, 'INVALID_CRASH_CONFIG');
      await bad('crash', {
        ...base,
        gameSpecific: { maxMultiplierCenti: 5_000, minAutoCashoutCenti: 200, maxAutoCashoutCenti: 9_000 },
      }, 'INVALID_CRASH_CONFIG');
    });

    it('refuses to dial the canonical roulette wheel', async () => {
      await bad('roulette', {
        minStake: 1, maxStake: 1_000, rtpBps: 5_000,
      }, 'ROULETTE_RTP_IS_CANONICAL');
      await bad('roulette', {
        minStake: 1, maxStake: 1_000, rtpBps: 9_730,
        gameSpecific: { pockets: 38, maxBetsPerSpin: 20 },
      }, 'ROULETTE_WHEEL_IS_FIXED');
    });

    it('refuses to dial blackjack and validates its rules instead', async () => {
      await bad('blackjack', {
        minStake: 1, maxStake: 1_000, rtpBps: 8_000,
      }, 'BLACKJACK_RTP_IS_RULE_BASED');
      await bad('blackjack', {
        minStake: 1, maxStake: 1_000,
        gameSpecific: { decks: 0, dealerStandsOnSoft17: true, blackjackPayoutNumerator: 3, blackjackPayoutDenominator: 2, doubleDownEnabled: true },
      }, 'INVALID_BLACKJACK_RULES');
      await bad('blackjack', {
        minStake: 1, maxStake: 1_000,
        gameSpecific: { decks: 6, dealerStandsOnSoft17: true, blackjackPayoutNumerator: 1, blackjackPayoutDenominator: 2, doubleDownEnabled: true },
      }, 'INVALID_BLACKJACK_RULES');
    });

    it('refuses an unknown slot or plinko profile', async () => {
      await bad('fools-gold-rush', {
        minStake: 20, maxStake: 1_000, gameSpecific: { profile: 'JACKPOT' },
      }, 'UNKNOWN_SLOT_PROFILE');
      await bad('plinko', {
        minStake: 1, maxStake: 1_000, gameSpecific: { profile: 'V2' },
      }, 'UNKNOWN_PLINKO_PROFILE');
    });

    it('refuses an unknown game', async () => {
      const bearer = await admin();
      await request(server())
        .post('/admin/casino/config/not-a-game/versions')
        .set('Authorization', `Bearer ${bearer}`)
        .send({ minStake: 1, maxStake: 100, rtpBps: 9_000 })
        .expect(404);
    });

    it('previews a candidate without persisting it', async () => {
      const bearer = await admin();
      const preview = await request(server())
        .post('/admin/casino/config/dice/preview')
        .set('Authorization', `Bearer ${bearer}`)
        .send({ minStake: 5, maxStake: 5_000, rtpBps: 7_500 })
        .expect(201);

      expect(preview.body.valid).toBe(true);
      expect(preview.body.proposedLabel).toBe('dice.v2.rtp7500');
      expect(preview.body.rtpBps).toBe(7_500);
      expect(preview.body.houseEdgeBps).toBe(2_500);
      expect(preview.body.appliesTo).toBe('NEW_ROUNDS_ONLY');
      expect(await prisma.casinoGameConfigVersion.count({ where: { status: 'DRAFT' } })).toBe(0);
    });
  });

  describe('drafting and activation', () => {
    it('creates a draft that is inert until explicitly activated', async () => {
      const bearer = await admin();
      const draft = await request(server())
        .post('/admin/casino/config/dice/versions')
        .set('Authorization', `Bearer ${bearer}`)
        .send({ minStake: 1, maxStake: 1_000, rtpBps: 8_000, reason: 'Trial' })
        .expect(201);

      expect(draft.body.status).toBe('DRAFT');
      expect(draft.body.label).toBe('dice.v2.rtp8000');
      // Still on the seeded version until someone activates the draft.
      expect((await configs.effective('dice')).rtpBps).toBe(9_700);

      await request(server())
        .post(`/admin/casino/config/dice/versions/${draft.body.versionId}/activate`)
        .set('Authorization', `Bearer ${bearer}`)
        .send({})
        .expect(201);
      expect((await configs.effective('dice')).rtpBps).toBe(8_000);
      expect((await configs.effective('dice')).versionLabel).toBe('dice.v2.rtp8000');
    });

    it('keeps exactly one active version and supersedes the previous one', async () => {
      await publish('dice', { minStake: 1, maxStake: 1_000, rtpBps: 9_000 });
      await publish('dice', { minStake: 1, maxStake: 1_000, rtpBps: 8_000 });

      const config = await prisma.casinoGameConfig.findUniqueOrThrow({ where: { gameId: 'dice' } });
      const active = await prisma.casinoGameConfigVersion.findMany({
        where: { gameConfigId: config.id, status: 'ACTIVE' },
      });
      expect(active).toHaveLength(1);
      expect(active[0].version).toBe(3);
      expect(config.activeVersionId).toBe(active[0].id);
    });

    it('rejects a stale activation instead of silently overwriting', async () => {
      const bearer = await admin();
      const first = await request(server())
        .post('/admin/casino/config/dice/versions')
        .set('Authorization', `Bearer ${bearer}`)
        .send({ minStake: 1, maxStake: 1_000, rtpBps: 9_000 })
        .expect(201);
      const second = await request(server())
        .post('/admin/casino/config/dice/versions')
        .set('Authorization', `Bearer ${bearer}`)
        .send({ minStake: 1, maxStake: 1_000, rtpBps: 8_000 })
        .expect(201);

      // Administrator A activates from version 1.
      await request(server())
        .post(`/admin/casino/config/dice/versions/${first.body.versionId}/activate`)
        .set('Authorization', `Bearer ${bearer}`)
        .send({ expectedCurrentVersion: 1 })
        .expect(201);

      // Administrator B still believes version 1 is live.
      const stale = await request(server())
        .post(`/admin/casino/config/dice/versions/${second.body.versionId}/activate`)
        .set('Authorization', `Bearer ${bearer}`)
        .send({ expectedCurrentVersion: 1 });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('CONFIG_VERSION_CONFLICT');
      expect((await configs.effective('dice')).rtpBps).toBe(9_000);
    });

    it('leaves exactly one active version when activations race', async () => {
      const bearer = await admin();
      const drafts = await Promise.all([9_000, 8_500, 8_000, 7_500].map((rtpBps) =>
        request(server())
          .post('/admin/casino/config/dice/versions')
          .set('Authorization', `Bearer ${bearer}`)
          .send({ minStake: 1, maxStake: 1_000, rtpBps })
          .expect(201)));

      await Promise.allSettled(drafts.map((draft) =>
        request(server())
          .post(`/admin/casino/config/dice/versions/${draft.body.versionId}/activate`)
          .set('Authorization', `Bearer ${bearer}`)
          .send({})));

      const config = await prisma.casinoGameConfig.findUniqueOrThrow({ where: { gameId: 'dice' } });
      const active = await prisma.casinoGameConfigVersion.findMany({
        where: { gameConfigId: config.id, status: 'ACTIVE' },
      });
      expect(active).toHaveLength(1);
      expect(config.activeVersionId).toBe(active[0].id);
      // The audit trail agrees with what actually committed.
      const activations = await prisma.auditLog.findMany({
        where: { action: 'CASINO_CONFIG_ACTIVATED' },
        orderBy: { createdAt: 'desc' },
      });
      const latest = activations[0].metadata as { newLabel: string };
      expect(latest.newLabel).toBe(active[0].label);
    });

    it('refuses to reactivate a superseded version', async () => {
      const bearer = await admin();
      const { activated } = await publish('dice', { minStake: 1, maxStake: 1_000, rtpBps: 9_000 });
      await publish('dice', { minStake: 1, maxStake: 1_000, rtpBps: 8_000 });
      const response = await request(server())
        .post(`/admin/casino/config/dice/versions/${activated.versionId}/activate`)
        .set('Authorization', `Bearer ${bearer}`)
        .send({});
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('CONFIG_VERSION_SUPERSEDED');
    });
  });

  describe('configuration immutability', () => {
    it('never mutates a version, and the database refuses if code tried', async () => {
      const { activated } = await publish('dice', {
        minStake: 1, maxStake: 1_000, rtpBps: 9_000,
      });
      const before = await prisma.casinoGameConfigVersion.findUniqueOrThrow({
        where: { id: activated.versionId },
      });

      await publish('dice', { minStake: 7, maxStake: 2_000, rtpBps: 6_000 });
      const after = await prisma.casinoGameConfigVersion.findUniqueOrThrow({
        where: { id: activated.versionId },
      });
      expect(after.rtpBps).toBe(before.rtpBps);
      expect(after.minStake).toBe(before.minStake);
      expect(after.maxStake).toBe(before.maxStake);
      expect(after.label).toBe(before.label);
      expect(after.status).toBe('SUPERSEDED');

      // Even a direct write is refused by the append-only trigger.
      await expect(prisma.casinoGameConfigVersion.update({
        where: { id: activated.versionId },
        data: { rtpBps: 5_000 },
      })).rejects.toThrow();
    });

    it('keeps a played round tied to the version that priced it', async () => {
      const accessToken = await token(userEmail);
      const first = await request(server())
        .post('/casino/dice/play')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ stake: 100, mode: 'ROLL_UNDER', target: 5_000, idempotencyKey: randomUUID() })
        .expect(201);
      expect(first.body.gameVersion).toBe('dice.v1.rtp9700');

      await publish('dice', { minStake: 1, maxStake: 1_000, rtpBps: 5_000 });

      const stored = await prisma.casinoRound.findUniqueOrThrow({
        where: { id: first.body.roundId },
      });
      expect(stored.gameVersion).toBe('dice.v1.rtp9700');
      expect((stored.publicState as { config: { rtpBps: number } }).config.rtpBps).toBe(9_700);

      const second = await request(server())
        .post('/casino/dice/play')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ stake: 100, mode: 'ROLL_UNDER', target: 5_000, idempotencyKey: randomUUID() })
        .expect(201);
      expect(second.body.gameVersion).toBe('dice.v2.rtp5000');
    });
  });

  describe('return configuration per game', () => {
    it('prices new dice rounds at the activated return, mathematically', async () => {
      await publish('dice', { minStake: 1, maxStake: 1_000, rtpBps: 5_000 });
      const effective = await configs.effective('dice');
      expect(effective.rtpBps).toBe(5_000);

      // Verify the mathematics rather than sampling outcomes: the dice formula
      // returns exactly the configured RTP in expectation at every target.
      const shaped = { ...casinoConfig().dice, rtpBps: 5_000 };
      for (const target of [200, 1_000, 5_000, 9_000]) {
        const expected = diceProbability('ROLL_UNDER', target, shaped)
          .mul(diceMultiplier('ROLL_UNDER', target, shaped));
        expect(Number(expected.toFixed(6))).toBeCloseTo(0.5, 6);
      }

      const accessToken = await token(userEmail);
      const played = await request(server())
        .post('/casino/dice/play')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ stake: 100, mode: 'ROLL_UNDER', target: 5_000, idempotencyKey: randomUUID() })
        .expect(201);
      expect(played.body.gameVersion).toBe('dice.v2.rtp5000');
      // 5000bps / 5000 winning outcomes = 1.00x
      expect(played.body.state.quotedMultiplier).toBe('1');
    });

    it('applies new mines limits and return only to new rounds', async () => {
      const opened = await mines.start(userId, {
        stake: 100, mines: 5, idempotencyKey: randomUUID(),
      });
      expect(opened.gameVersion).toBe('mines.v1.rtp9700');

      await publish('mines', {
        minStake: 1, maxStake: 1_000, rtpBps: 6_000,
        gameSpecific: { allowedMines: [3, 5] },
      });

      // The in-flight ladder keeps the mathematics it was opened under.
      const board = await prisma.casinoRound.findUniqueOrThrow({ where: { id: opened.roundId } });
      const bombs = (board.privateState as { minePositions: number[] }).minePositions;
      const safe = Array.from({ length: 25 }, (_, index) => index)
        .find((index) => !bombs.includes(index))!;
      const revealed = await mines.reveal(userId, opened.roundId, {
        cell: safe, idempotencyKey: randomUUID(),
      });
      expect(revealed.progress.currentMultiplier).toBe('1.2125');
      const cashed = await mines.cashout(userId, opened.roundId, {
        idempotencyKey: randomUUID(),
      });
      expect(cashed.multiplier).toBe('1.2125');
      expect(cashed.payout).toBe('121');

      // A new round uses the new version, and the new mine list is enforced.
      const next = await mines.start(userId, {
        stake: 100, mines: 3, idempotencyKey: randomUUID(),
      });
      expect(next.gameVersion).toBe('mines.v2.rtp6000');
      await mines.cashout(userId, next.roundId, { idempotencyKey: randomUUID() })
        .catch(() => undefined);
      await expect(mines.start(userId, {
        stake: 100, mines: 10, idempotencyKey: randomUUID(),
      })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'INVALID_MINE_COUNT' }),
      });
    });

    it('keeps a running crash round on its own curve and cap', async () => {
      let opened = await crash.start(userId, { stake: 100, idempotencyKey: randomUUID() });
      for (let attempt = 0; attempt < 60 && opened.status !== 'OPEN'; attempt += 1) {
        opened = await crash.start(userId, { stake: 100, idempotencyKey: randomUUID() });
      }
      expect(opened.status).toBe('OPEN');
      expect(opened.gameVersion).toBe('crash.v1.rtp9700');
      const originalMax = opened.timing.maxMultiplier;

      await publish('crash', {
        minStake: 1, maxStake: 1_000, rtpBps: 5_000,
        gameSpecific: {
          maxMultiplierCenti: 20_000, minAutoCashoutCenti: 101, maxAutoCashoutCenti: 20_000,
        },
      });

      const recovered = await crash.active(userId);
      expect(recovered?.gameVersion).toBe('crash.v1.rtp9700');
      // The cap it is running under is unchanged by the activation.
      expect(recovered?.timing.maxMultiplier).toBe(originalMax);
    });

    it('activates an approved slot profile and reports its exact computed return', async () => {
      const bearer = await admin();
      const analysis = analyseSlotRtp(FOOLS_GOLD_RUSH_PROFILES.REDUCED);
      expect(analysis.rtpBps).toBe(7_456);

      await publish('fools-gold-rush', {
        minStake: 20, maxStake: 100_000, gameSpecific: { profile: 'REDUCED' },
      });
      const detail = await request(server())
        .get('/admin/casino/config/fools-gold-rush')
        .set('Authorization', `Bearer ${bearer}`)
        .expect(200);
      expect(detail.body.activeVersion.rtpBps).toBe(7_456);
      expect(detail.body.activeVersion.houseEdgeBps).toBe(2_544);

      const config = await slots.gameConfig('fools-gold-rush');
      expect(config.rtpBps).toBe(7_456);
      expect(config.rtpPercent).toBe('74.555672');
    });

    it('every approved slot profile matches its own exact calculator result', () => {
      for (const [name, definition] of Object.entries(FOOLS_GOLD_RUSH_PROFILES)) {
        const analysis = analyseSlotRtp(definition);
        expect(analysis.rtpBps).toBe(definition.declaredRtpBps);
        expect(analysis.rtpBps).toBeGreaterThanOrEqual(5_000);
        expect(analysis.rtpBps).toBeLessThanOrEqual(9_950);
        expect(name.length).toBeGreaterThan(0);
      }
    });

    it('keeps a historical slot spin verifiable after a profile change', async () => {
      const accessToken = await token(userEmail);
      const spun = await request(server())
        .post('/casino/slots/fools-gold-rush/spin')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ stake: 200, idempotencyKey: randomUUID() })
        .expect(201);
      expect(spun.body.gameVersion).toBe('fools-gold-rush.v1.rtp9499');

      await publish('fools-gold-rush', {
        minStake: 20, maxStake: 100_000, gameSpecific: { profile: 'MINIMAL' },
      });

      // The old spin still reproduces from the profile it recorded.
      const stored = await prisma.casinoRound.findUniqueOrThrow({
        where: { id: spun.body.roundId },
      });
      expect(stored.gameVersion).toBe('fools-gold-rush.v1.rtp9499');
      const original = FOOLS_GOLD_RUSH_PROFILES.STANDARD;
      const stops = deriveStops({
        serverSeed: stored.serverSeed,
        domain: slotDomain(original, stored.gameVersion),
        clientSeed: stored.clientSeed,
        nonce: stored.nonce,
      }, original);
      const state = stored.publicState as { stops: number[]; matrix: string[][] };
      expect(stops).toEqual(state.stops);
      expect(buildMatrix(original, stops)).toEqual(state.matrix);

      const next = await request(server())
        .post('/casino/slots/fools-gold-rush/spin')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ stake: 200, idempotencyKey: randomUUID() })
        .expect(201);
      expect(next.body.gameVersion).toBe('fools-gold-rush.v3.rtp5067');
    });

    it('validates the plinko profile against every board exact return', async () => {
      const bearer = await admin();
      await publish('plinko', { minStake: 1, maxStake: 50_000, gameSpecific: { profile: 'V1' } });
      const detail = await request(server())
        .get('/admin/casino/config/plinko')
        .set('Authorization', `Bearer ${bearer}`)
        .expect(200);
      expect(detail.body.rtpControl).toBe('PROFILE');
      expect(detail.body.activeVersion.gameSpecific.profile).toBe('V1');
    });
  });

  describe('availability', () => {
    it('blocks a disabled game server-side and leaves no ledger effect', async () => {
      const bearer = await admin();
      const accessToken = await token(userEmail);
      const before = await balance();

      await request(server())
        .patch('/admin/casino/config/dice/status')
        .set('Authorization', `Bearer ${bearer}`)
        .send({ enabled: false })
        .expect(200);

      const blocked = await request(server())
        .post('/casino/dice/play')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ stake: 100, mode: 'ROLL_UNDER', target: 5_000, idempotencyKey: randomUUID() });
      expect(blocked.status).toBe(503);
      expect(blocked.body.code).toBe('CASINO_GAME_DISABLED');
      expect(await balance()).toBe(before);
      expect(await prisma.casinoRound.count()).toBe(0);

      await request(server())
        .patch('/admin/casino/config/dice/status')
        .set('Authorization', `Bearer ${bearer}`)
        .send({ enabled: true })
        .expect(200);
      await request(server())
        .post('/casino/dice/play')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ stake: 100, mode: 'ROLL_UNDER', target: 5_000, idempotencyKey: randomUUID() })
        .expect(201);
    });

    it('lets an existing mines round finish while maintenance blocks new ones', async () => {
      const bearer = await admin();
      const opened = await mines.start(userId, {
        stake: 100, mines: 5, idempotencyKey: randomUUID(),
      });

      await request(server())
        .patch('/admin/casino/config/mines/status')
        .set('Authorization', `Bearer ${bearer}`)
        .send({ maintenance: true })
        .expect(200);

      // A committed stake must never be trapped by maintenance.
      const board = await prisma.casinoRound.findUniqueOrThrow({ where: { id: opened.roundId } });
      const bombs = (board.privateState as { minePositions: number[] }).minePositions;
      const safe = Array.from({ length: 25 }, (_, index) => index)
        .find((index) => !bombs.includes(index))!;
      await mines.reveal(userId, opened.roundId, { cell: safe, idempotencyKey: randomUUID() });
      const cashed = await mines.cashout(userId, opened.roundId, {
        idempotencyKey: randomUUID(),
      });
      expect(cashed.status).toBe('CASHED_OUT');

      await expect(mines.start(userId, {
        stake: 100, mines: 5, idempotencyKey: randomUUID(),
      })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CASINO_GAME_MAINTENANCE' }),
      });

      await request(server())
        .patch('/admin/casino/config/mines/status')
        .set('Authorization', `Bearer ${bearer}`)
        .send({ maintenance: false })
        .expect(200);
      await expect(mines.start(userId, {
        stake: 100, mines: 5, idempotencyKey: randomUUID(),
      })).resolves.toBeDefined();
    });

    it('blocks every new casino round under global maintenance', async () => {
      const bearer = await admin();
      const accessToken = await token(userEmail);
      await request(server())
        .patch('/admin/platform/maintenance')
        .set('Authorization', `Bearer ${bearer}`)
        .send({ casinoMaintenance: true })
        .expect(200);

      for (const [path, body] of [
        ['/casino/dice/play', { stake: 100, mode: 'ROLL_UNDER', target: 5_000 }],
        ['/casino/plinko/play', { stake: 100, rows: 8, risk: 'LOW' }],
        ['/casino/slots/fools-gold-rush/spin', { stake: 100 }],
      ] as [string, Record<string, unknown>][]) {
        const response = await request(server())
          .post(path)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ ...body, idempotencyKey: randomUUID() });
        expect(response.status).toBe(503);
        expect(response.body.code).toBe('CASINO_MAINTENANCE');
      }
      expect(await prisma.casinoRound.count()).toBe(0);

      await request(server())
        .patch('/admin/platform/maintenance')
        .set('Authorization', `Bearer ${bearer}`)
        .send({ casinoMaintenance: false })
        .expect(200);
      await request(server())
        .post('/casino/dice/play')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ stake: 100, mode: 'ROLL_UNDER', target: 5_000, idempotencyKey: randomUUID() })
        .expect(201);
    });

    it('blocks new sports bets under sportsbook maintenance', async () => {
      const bearer = await admin();
      await request(server())
        .patch('/admin/platform/maintenance')
        .set('Authorization', `Bearer ${bearer}`)
        .send({ sportsbookMaintenance: true })
        .expect(200);
      const settings = await configs.platformSettings();
      expect(settings.sportsbookMaintenance).toBe(true);
      await expect(configs.assertSportsbookOpen()).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'SPORTSBOOK_MAINTENANCE' }),
      });

      await request(server())
        .patch('/admin/platform/maintenance')
        .set('Authorization', `Bearer ${bearer}`)
        .send({ sportsbookMaintenance: false })
        .expect(200);
      await expect(configs.assertSportsbookOpen()).resolves.toBeUndefined();
    });
  });

  describe('audit', () => {
    it('records every mutation with before and after, and no secrets', async () => {
      const bearer = await admin();
      await publish('dice', { minStake: 1, maxStake: 1_000, rtpBps: 9_000, reason: 'Tighten' });
      await request(server())
        .patch('/admin/casino/config/dice/status')
        .set('Authorization', `Bearer ${bearer}`)
        .send({ enabled: false })
        .expect(200);
      await request(server())
        .patch('/admin/platform/maintenance')
        .set('Authorization', `Bearer ${bearer}`)
        .send({ casinoMaintenance: true })
        .expect(200);

      const actions = await prisma.auditLog.findMany({
        where: { actorId: adminId },
        orderBy: { createdAt: 'asc' },
      });
      const kinds = actions.map((entry) => entry.action);
      expect(kinds).toContain('CASINO_CONFIG_CREATED');
      expect(kinds).toContain('CASINO_CONFIG_ACTIVATED');
      expect(kinds).toContain('CASINO_GAME_DISABLED');
      expect(kinds).toContain('PLATFORM_MAINTENANCE_CHANGED');

      const activation = actions.find((entry) => entry.action === 'CASINO_CONFIG_ACTIVATED');
      const metadata = activation!.metadata as Record<string, unknown>;
      expect(metadata.previousLabel).toBe('dice.v1.rtp9700');
      expect(metadata.newLabel).toBe('dice.v2.rtp9000');
      expect(metadata.appliesTo).toBe('NEW_ROUNDS_ONLY');

      const serialized = JSON.stringify(actions);
      expect(serialized).not.toContain('serverSeed');
      expect(serialized).not.toContain('passwordHash');
      expect(serialized).not.toContain('minePositions');
    });
  });

  describe('analytics', () => {
    it('reports wagered, returned, house result and observed return without double counting', async () => {
      const accessToken = await token(userEmail);
      for (let spin = 0; spin < 5; spin += 1) {
        await request(server())
          .post('/casino/dice/play')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ stake: 100, mode: 'ROLL_UNDER', target: 5_000, idempotencyKey: randomUUID() })
          .expect(201);
      }
      const bearer = await admin();
      const analytics = await request(server())
        .get('/admin/casino/analytics?period=ALL')
        .set('Authorization', `Bearer ${bearer}`)
        .expect(200);

      const rounds = await prisma.casinoRound.findMany();
      const wagered = rounds.reduce((sum, round) => sum + round.stake, 0n);
      const returned = rounds.reduce((sum, round) => sum + round.payout, 0n);
      expect(analytics.body.totals.totalRounds).toBe(5);
      expect(analytics.body.totals.totalWagered).toBe(wagered.toString());
      expect(analytics.body.totals.totalReturned).toBe(returned.toString());
      expect(analytics.body.totals.houseResult).toBe((wagered - returned).toString());
      expect(analytics.body.totals.wins + analytics.body.totals.losses).toBe(5);
      expect(analytics.body.totals.activeRounds).toBe(0);

      const dice = analytics.body.games.find((game: { gameType: string }) => game.gameType === 'DICE');
      expect(dice.configVersion).toBe('dice.v1.rtp9700');
      expect(dice.theoreticalRtpBps).toBe(9_700);
      expect(dice.totalWagered).toBe(wagered.toString());
    });

    it('bounds a window and separates theoretical from observed', async () => {
      const accessToken = await token(userEmail);
      await request(server())
        .post('/casino/dice/play')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ stake: 100, mode: 'ROLL_UNDER', target: 5_000, idempotencyKey: randomUUID() })
        .expect(201);
      // Age the round beyond the 24 hour window.
      await prisma.casinoRound.updateMany({
        data: { createdAt: new Date(Date.now() - 48 * 3_600_000) },
      });

      const bearer = await admin();
      const recent = await request(server())
        .get('/admin/casino/analytics?period=24H')
        .set('Authorization', `Bearer ${bearer}`)
        .expect(200);
      expect(recent.body.totals.totalRounds).toBe(0);
      expect(recent.body.since).toBeTruthy();

      const all = await request(server())
        .get('/admin/casino/analytics?period=ALL')
        .set('Authorization', `Bearer ${bearer}`)
        .expect(200);
      expect(all.body.totals.totalRounds).toBe(1);
      expect(all.body.since).toBeNull();
      expect(all.body.note).toContain('never adjusted');
    });

    it('refuses an unknown window', async () => {
      const bearer = await admin();
      await request(server())
        .get('/admin/casino/analytics?period=FOREVER')
        .set('Authorization', `Bearer ${bearer}`)
        .expect(400);
    });
  });

  describe('player wallet controls', () => {
    it('grants through the immutable ledger, exactly once on retry', async () => {
      const bearer = await admin();
      const key = randomUUID();
      const before = await balance();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await request(server())
          .post(`/admin/users/${userId}/coins`)
          .set('Authorization', `Bearer ${bearer}`)
          .send({ amount: 500, reason: 'Goodwill', idempotencyKey: key })
          .expect(201);
      }
      expect(await balance()).toBe(before + 500n);
      const entries = await prisma.ledgerEntry.findMany({
        where: { wallet: { userId }, type: 'ADMIN_GRANT', reason: 'Goodwill' },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].actorId).toBe(adminId);
    });

    it('removes through the ledger and refuses to overdraw', async () => {
      const bearer = await admin();
      const before = await balance();
      await request(server())
        .post(`/admin/users/${userId}/coins/remove`)
        .set('Authorization', `Bearer ${bearer}`)
        .send({ amount: 1_000, reason: 'Correction', idempotencyKey: randomUUID() })
        .expect(201);
      expect(await balance()).toBe(before - 1_000n);

      const overdraw = await request(server())
        .post(`/admin/users/${userId}/coins/remove`)
        .set('Authorization', `Bearer ${bearer}`)
        .send({ amount: 999_999_999, reason: 'Too much', idempotencyKey: randomUUID() });
      expect(overdraw.status).toBe(409);
      expect(await balance()).toBe(before - 1_000n);

      const entries = await prisma.ledgerEntry.findMany({
        where: { wallet: { userId }, type: 'ADMIN_REMOVE' },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].amount).toBe(-1_000n);
    });

    it('exposes a player detail view without any secret material', async () => {
      const bearer = await admin();
      const accessToken = await token(userEmail);
      await request(server())
        .post('/casino/dice/play')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ stake: 100, mode: 'ROLL_UNDER', target: 5_000, idempotencyKey: randomUUID() })
        .expect(201);

      const detail = await request(server())
        .get(`/admin/users/${userId}/detail`)
        .set('Authorization', `Bearer ${bearer}`)
        .expect(200);
      expect(detail.body.user.email).toBe(userEmail);
      expect(detail.body.user.wallet.balance).toBeTruthy();
      expect(detail.body.ledger.length).toBeGreaterThan(0);
      expect(detail.body.casinoRounds).toHaveLength(1);
      const serialized = JSON.stringify(detail.body);
      expect(serialized).not.toContain('passwordHash');
      expect(serialized).not.toContain('tokenHash');
    });

    it('searches users without exposing credentials', async () => {
      const bearer = await admin();
      const found = await request(server())
        .get('/admin/users?search=cfg-user')
        .set('Authorization', `Bearer ${bearer}`)
        .expect(200);
      expect(found.body).toHaveLength(1);
      expect(found.body[0].email).toBe(userEmail);
      expect(JSON.stringify(found.body)).not.toContain('passwordHash');
    });
  });
});