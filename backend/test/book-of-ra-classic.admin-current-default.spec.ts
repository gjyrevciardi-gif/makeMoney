import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { BigIntInterceptor } from '../src/common/bigint.interceptor';
import { RedisService } from '../src/common/redis.service';
import { CasinoConfigService } from '../src/casino/casino-config.service';
import { GAME_CONFIG_SPECS } from '../src/casino/casino-config.defaults';
import { CasinoGameRegistry } from '../src/casino/casino-game.registry';
import { CLASSIC_ID } from '../src/casino/games/book-of-ra-classic/classic.engine';
import { classicIdentity } from '../src/casino/games/book-of-ra-classic/classic.math-adapter';
import { MathControlService } from '../src/casino/platform/math-control/math-control.service';
import { PrismaService } from '../src/prisma.service';
import { uniqueTestEmail } from './test-identity';

const CLASSIC_GAME_ID = 'book-of-ra-classic';
const CLASSIC_DEFAULT_PROFILE_ID = 'book-of-ra-classic.rtp50.v1';
const OTHER_GAME_ID = 'lucky-lady';

/**
 * Admin CURRENT / DEFAULT for `book-of-ra-classic`, through the real admin
 * controllers and services.
 *
 * The order under test is CURRENT (admin math control for the game) -> DEFAULT
 * (the admin config contract materialising the game's built-in default) ->
 * CURRENT again (both surfaces report the same state, and no other game moved).
 * Nothing here generates, validates, activates, rolls back or previews.
 */
describe('Book of Ra Classic admin CURRENT/DEFAULT (PostgreSQL + Redis)', () => {
  const prisma = new PrismaService();
  let app: INestApplication;
  let auth: AuthService;
  let configs: CasinoConfigService;
  let math: MathControlService;
  let redis: RedisService;

  const password = 'correct-horse-battery';
  const adminEmail = uniqueTestEmail('classic-current-default-admin');
  let adminId: string;
  let adminToken: string;

  beforeAll(async () => {
    process.env.SPORTS_SETTLEMENT_ENABLED = 'false';
    await prisma.$connect();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalInterceptors(new BigIntInterceptor());
    await app.init();
    auth = app.get(AuthService);
    configs = app.get(CasinoConfigService);
    math = app.get(MathControlService);
    redis = app.get(RedisService);
    await redis.ensureConnected();
  }, 120_000);

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
    delete process.env.SPORTS_SETTLEMENT_ENABLED;
  });

  beforeEach(async () => {
    const passwordHash = await argon2.hash(password);
    const admin = await prisma.user.upsert({
      where: { email: adminEmail },
      update: { passwordHash, role: 'SUPER_ADMIN', disabled: false },
      create: {
        email: adminEmail,
        passwordHash,
        role: 'SUPER_ADMIN',
        wallet: { create: {} },
      },
    });
    adminId = admin.id;
    adminToken = (await auth.login(adminEmail, password)).pair.accessToken;
  }, 60_000);

  const bearer = () => `Bearer ${adminToken}`;
  const server = () => app.getHttpServer();

  it('CURRENT: the admin math surface reports book-of-ra-classic and its own mathematics', async () => {
    const response = await request(server())
      .get(`/admin/casino/math/${CLASSIC_GAME_ID}`)
      .set('Authorization', bearer())
      .expect(200);

    expect(response.body.gameId).toBe(CLASSIC_GAME_ID);
    // Never activated: the game runs its own accepted default mathematics.
    expect(response.body.active).toBeNull();
    expect(response.body.profiles).toEqual([]);
    const capabilities = response.body.capabilities.capabilities;
    expect(capabilities.gameId).toBe(CLASSIC_GAME_ID);
    expect(capabilities.engineSha256).toBe(classicIdentity().engineSha256);
    expect(capabilities.rulesSha256).toBe(classicIdentity().rulesSha256);
    expect(Array.isArray(response.body.capabilities.reachableOutcomeClasses)).toBe(true);

    // The runtime seam a new paid round pins, called as a real service operation.
    await expect(math.activeProfile(CLASSIC_GAME_ID)).resolves.toBeNull();

    // The game is registered under its own id, not the Deluxe game id.
    const entry = new CasinoGameRegistry().findById(CLASSIC_GAME_ID);
    expect(entry?.id).toBe(CLASSIC_GAME_ID);
    expect(entry?.gameType).toBe('SLOTS');
    expect(new CasinoGameRegistry().findById('book-of-ra-deluxe')).toBeUndefined();
  }, 60_000);

  it('DEFAULT: the admin config contract materialises the built-in book-of-ra-classic.rtp50.v1 default', async () => {
    // Start from a never-configured game so the default is created by this call.
    await prisma.casinoGameConfigVersion.deleteMany({ where: { config: { gameId: CLASSIC_GAME_ID } } });
    await prisma.casinoGameConfig.deleteMany({ where: { gameId: CLASSIC_GAME_ID } });
    expect(await prisma.casinoGameConfig.count({ where: { gameId: CLASSIC_GAME_ID } })).toBe(0);
    expect(await prisma.casinoGameConfigVersion.count({ where: { config: { gameId: CLASSIC_GAME_ID } } })).toBe(0);

    const response = await request(server())
      .get(`/admin/casino/config/${CLASSIC_GAME_ID}`)
      .set('Authorization', bearer())
      .expect(200);

    expect(response.body.gameId).toBe(CLASSIC_GAME_ID);
    expect(response.body.name).toBe('Book of Ra Classic');
    expect(response.body.rtpControl).toBe(GAME_CONFIG_SPECS[CLASSIC_GAME_ID].rtpControl);
    expect(response.body.rtpControl).toBe('PROFILE');
    expect(response.body.enabled).toBe(true);
    expect(response.body.maintenance).toBe(false);
    expect(response.body.baseline).toMatchObject({
      label: 'book-of-ra-classic.v1',
      rtpBps: 5_000,
      gameSpecific: { profile: CLASSIC_DEFAULT_PROFILE_ID },
    });
    expect(response.body.activeVersion).toMatchObject({
      version: 1,
      status: 'ACTIVE',
      label: 'book-of-ra-classic.v1',
      rtpBps: 5_000,
      houseEdgeBps: 5_000,
      gameSpecific: { profile: CLASSIC_DEFAULT_PROFILE_ID },
    });

    // The default is persisted, not computed for the response only.
    const row = await prisma.casinoGameConfig.findUniqueOrThrow({
      where: { gameId: CLASSIC_GAME_ID },
      include: { activeVersion: true },
    });
    expect(row.activeVersion?.version).toBe(1);
    expect(row.activeVersion?.status).toBe('ACTIVE');
    expect(row.activeVersion?.label).toBe('book-of-ra-classic.v1');
    expect(row.activeVersion?.gameSpecificConfig).toEqual({ profile: CLASSIC_DEFAULT_PROFILE_ID });

    // Materialising the default activates nothing on the math surface.
    await expect(math.activeProfile(CLASSIC_GAME_ID)).resolves.toBeNull();
  }, 60_000);

  it('CURRENT again: state holds for Classic and nothing moved for the other game', async () => {
    const otherConfigBefore = await prisma.casinoGameConfig.findMany({
      where: { gameId: OTHER_GAME_ID },
      include: { activeVersion: true },
    });
    const otherPointerBefore = await prisma.gameActiveMathProfile.findUnique({ where: { gameId: OTHER_GAME_ID } });
    const otherProfilesBefore = await prisma.gameMathProfile.count({ where: { gameId: OTHER_GAME_ID } });

    const config = await request(server())
      .get(`/admin/casino/config/${CLASSIC_GAME_ID}`)
      .set('Authorization', bearer())
      .expect(200);
    expect(config.body.gameId).toBe(CLASSIC_GAME_ID);
    expect(config.body.rtpControl).toBe('PROFILE');
    expect(config.body.activeVersion.status).toBe('ACTIVE');
    expect(config.body.activeVersion.label).toBe('book-of-ra-classic.v1');
    expect(config.body.activeVersion.gameSpecific.profile).toBe(CLASSIC_DEFAULT_PROFILE_ID);

    const mathState = await request(server())
      .get(`/admin/casino/math/${CLASSIC_GAME_ID}`)
      .set('Authorization', bearer())
      .expect(200);
    expect(mathState.body.gameId).toBe(CLASSIC_GAME_ID);
    expect(mathState.body.active).toBeNull();
    expect(mathState.body.profiles).toEqual([]);
    expect(mathState.body.capabilities.capabilities.gameId).toBe(CLASSIC_GAME_ID);
    expect(mathState.body.capabilities.capabilities.engineSha256).toBe(classicIdentity().engineSha256);
    await expect(math.activeProfile(CLASSIC_GAME_ID)).resolves.toBeNull();

    // The persisted Classic state is the one the previous CURRENT read reported.
    const row = await prisma.casinoGameConfig.findUniqueOrThrow({
      where: { gameId: CLASSIC_GAME_ID },
      include: { activeVersion: true },
    });
    expect(row.activeVersion?.gameSpecificConfig).toEqual({ profile: CLASSIC_DEFAULT_PROFILE_ID });

    // Cross-game isolation: the Classic default touched no other game.
    expect(await prisma.casinoGameConfig.findMany({
      where: { gameId: OTHER_GAME_ID },
      include: { activeVersion: true },
    })).toEqual(otherConfigBefore);
    expect(await prisma.gameActiveMathProfile.findUnique({ where: { gameId: OTHER_GAME_ID } }))
      .toEqual(otherPointerBefore);
    expect(await prisma.gameMathProfile.count({ where: { gameId: OTHER_GAME_ID } })).toBe(otherProfilesBefore);
    expect(await prisma.gameMathProfile.count({ where: { gameId: CLASSIC_GAME_ID } })).toBe(0);
  }, 60_000);
});
