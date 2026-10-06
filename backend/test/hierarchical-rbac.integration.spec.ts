import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { AuthorizationService } from '../src/auth/authorization.service';
import { BigIntInterceptor } from '../src/common/bigint.interceptor';
import { RedisService } from '../src/common/redis.service';
import { PrismaService } from '../src/prisma.service';
import { PointsService } from '../src/wallet/points.service';
import { uniqueTestEmail } from './test-identity';

/**
 * Hierarchical RBAC on the real platform.
 *
 * One central capability mapping, database-backed authorization, target-role
 * checks in the authoritative services, and a shared serialized guard that keeps
 * at least one active SUPER_ADMIN. Requires an isolated *_test PostgreSQL
 * database and Redis.
 */
describe('hierarchical RBAC (PostgreSQL + Redis)', () => {
  jest.setTimeout(120_000);

  const prisma = new PrismaService();
  let app: INestApplication;
  let auth: AuthService;
  let authorization: AuthorizationService;
  let points: PointsService;
  let redis: RedisService;

  const password = 'correct-horse-battery';
  const email = (label: string) => uniqueTestEmail(label);
  let playerEmail: string;
  let player2Email: string;
  let targetEmail: string;
  let disabledEmail: string;
  let adminEmail: string;
  let admin2Email: string;
  let superEmail: string;
  let super2Email: string;

  const tokenFor = async (userEmail: string) => (await auth.login(userEmail, password)).pair.accessToken;
  const server = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    process.env.SPORTS_SETTLEMENT_ENABLED = 'false';
    await prisma.$connect();
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalInterceptors(new BigIntInterceptor());
    await app.init();
    auth = app.get(AuthService);
    authorization = app.get(AuthorizationService);
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
      'TRUNCATE TABLE "LuckyLadyPayoutActivation", "LuckyLadyPayoutValidation", "LuckyLadyPayoutCandidate", ' +
      '"GameActiveMathProfile", "GameMathProfileValidation", "GameMathProfile", "GamePreparedOutcome", ' +
      '"GameSession", "GameLaunchCapability", "CasinoGameConfigVersion", "CasinoGameConfig", "PlatformSettings", ' +
      '"CasinoTransaction", "CasinoRoundAction", "CasinoRound", "CasinoGameFavorite", "LedgerEntry", "BetLeg", ' +
      '"Bet", "AuditLog", "RefreshToken", "Wallet", "User" CASCADE',
    );
    await redis.client.flushdb();
    const hash = await argon2.hash(password);
    playerEmail = email('rbac-player');
    player2Email = email('rbac-player2');
    targetEmail = email('rbac-target');
    disabledEmail = email('rbac-disabled');
    adminEmail = email('rbac-admin');
    admin2Email = email('rbac-admin2');
    superEmail = email('rbac-super');
    super2Email = email('rbac-super2');
    const make = (mail: string, role: Role, disabled = false) =>
      prisma.user.create({ data: { email: mail, passwordHash: hash, role, disabled, wallet: { create: {} } } });
    await Promise.all([
      make(playerEmail, Role.USER),
      make(player2Email, Role.USER),
      make(targetEmail, Role.USER),
      make(disabledEmail, Role.USER, true),
      make(adminEmail, Role.ADMIN),
      make(admin2Email, Role.ADMIN),
      make(superEmail, Role.SUPER_ADMIN),
      make(super2Email, Role.SUPER_ADMIN),
    ]);
  });

  const idOf = async (mail: string) => (await prisma.user.findUniqueOrThrow({ where: { email: mail } })).id;

  it('allows every GAME_PLAY role to launch a game and refuses a disabled account', async () => {
    for (const mail of [playerEmail, adminEmail, superEmail]) {
      await server().post('/casino/lucky-lady/launch').set(bearer(await tokenFor(mail))).expect(201);
    }
    // A disabled account can no longer log in, so model a token issued before it was disabled.
    const staleToken = (await auth.issueTokenPair(await idOf(disabledEmail), Role.USER)).accessToken;
    await server().post('/casino/lucky-lady/launch').set(bearer(staleToken)).expect(403);
  });

  it('gates math control behind GAME_MATH_MANAGE (ADMIN/SUPER_ADMIN yes, USER no)', async () => {
    await server().get('/admin/casino/math').set(bearer(await tokenFor(playerEmail))).expect(403);
    await server().get('/admin/casino/math').set(bearer(await tokenFor(adminEmail))).expect(200);
    await server().get('/admin/casino/math').set(bearer(await tokenFor(superEmail))).expect(200);
  });

  it('reserves PLATFORM_MANAGE (platform maintenance) for SUPER_ADMIN', async () => {
    const patch = () => server().patch('/admin/platform/maintenance').send({ casinoMaintenance: false });
    await patch().set(bearer(await tokenFor(adminEmail))).expect(403);
    await patch().set(bearer(await tokenFor(superEmail))).expect(200);
  });

  it('applies PLAYER_POINTS_MANAGE and the target-role contract', async () => {
    const targetId = await idOf(targetEmail);
    const admin2Id = await idOf(admin2Email);
    const grant = (token: string, userId: string, key: string) =>
      server()
        .post(`/admin/users/${userId}/coins`)
        .set(bearer(token))
        .send({ amount: 100, reason: 'rbac test', idempotencyKey: key });

    await grant(await tokenFor(playerEmail), targetId, '11111111-1111-4111-8111-111111111111').expect(403);
    await grant(await tokenFor(adminEmail), targetId, '22222222-2222-4222-8222-222222222222').expect(201);
    // ADMIN cannot adjust another ADMIN target.
    await grant(await tokenFor(adminEmail), admin2Id, '33333333-3333-4333-8333-333333333333').expect(403);
    // SUPER_ADMIN can.
    await grant(await tokenFor(superEmail), admin2Id, '44444444-4444-4444-8444-444444444444').expect(201);
  });

  it('enforces target-role writes in the service: no ADMIN grant, no self-promotion, SUPER_ADMIN manages ADMIN', async () => {
    const targetId = await idOf(targetEmail);
    const admin2Id = await idOf(admin2Email);
    const adminId = await idOf(adminEmail);
    const setRole = (token: string, userId: string, role: Role) =>
      server().post(`/admin/users/${userId}/role`).set(bearer(token)).send({ role });

    // ADMIN cannot grant ADMIN.
    await setRole(await tokenFor(adminEmail), targetId, Role.ADMIN).expect(403);
    // ADMIN cannot manage an ADMIN target.
    await setRole(await tokenFor(adminEmail), admin2Id, Role.USER).expect(403);
    // ADMIN cannot promote themselves.
    await setRole(await tokenFor(adminEmail), adminId, Role.SUPER_ADMIN).expect(403);
    // SUPER_ADMIN manages ADMIN.
    await setRole(await tokenFor(superEmail), admin2Id, Role.USER).expect(201);
    // SUPER_ADMIN promotes a USER to ADMIN.
    await setRole(await tokenFor(superEmail), targetId, Role.ADMIN).expect(201);
  });

  it('re-reads the actor role inside the points transaction (downgraded admin refused)', async () => {
    const adminId = await idOf(adminEmail);
    const targetId = await idOf(targetEmail);
    // The actor's token still says ADMIN, but the database says USER: the
    // in-transaction re-read must refuse.
    await prisma.user.update({ where: { id: adminId }, data: { role: Role.USER } });
    await expect(points.adminGrant(adminId, targetId, 100n, 'downgraded actor', randomUUID()))
      .rejects.toMatchObject({ response: { message: 'ADMIN_REQUIRED' } });
  });

  it('validates idempotency replays and never bypasses the target check', async () => {
    const adminId = await idOf(adminEmail);
    const targetId = await idOf(targetEmail);
    const otherUserId = await idOf(playerEmail);
    const admin2Id = await idOf(admin2Email);
    const key = randomUUID();

    const first = await points.adminGrant(adminId, targetId, 250n, 'replay test', key);
    expect(first.duplicate).toBe(false);
    // A valid identical duplicate is one credit, not two.
    const again = await points.adminGrant(adminId, targetId, 250n, 'replay test', key);
    expect(again).toMatchObject({ ledgerEntryId: first.ledgerEntryId, duplicate: true });
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: targetId } });
    expect(wallet.balance).toBe(250n);

    // The same key aimed at a different (allowed) target is a conflict, and the
    // other entry is never returned.
    await expect(points.adminGrant(adminId, otherUserId, 250n, 'replay test', key))
      .rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });
    // The same key aimed at a forbidden target trips the target check first.
    await expect(points.adminGrant(adminId, admin2Id, 250n, 'replay test', key))
      .rejects.toMatchObject({ response: { message: 'TARGET_ROLE_FORBIDDEN' } });
    // The same key with a different amount is a conflict.
    await expect(points.adminGrant(adminId, targetId, 999n, 'replay test', key))
      .rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });
  });

  it('limits an ADMIN user listing/detail to USER accounts, while SUPER_ADMIN sees all', async () => {
    const adminToken = await tokenFor(adminEmail);
    const superToken = await tokenFor(superEmail);

    const adminList = await server().get('/admin/users?limit=100').set(bearer(adminToken)).expect(200);
    expect((adminList.body as { role: string }[]).every((entry) => entry.role === 'USER')).toBe(true);

    const superList = await server().get('/admin/users?limit=100').set(bearer(superToken)).expect(200);
    const superRoles = new Set((superList.body as { role: string }[]).map((entry) => entry.role));
    expect(superRoles.has('ADMIN')).toBe(true);
    expect(superRoles.has('SUPER_ADMIN')).toBe(true);

    // An ADMIN cannot read a higher-role account (reported as not-found).
    const superId = await idOf(superEmail);
    await server().get(`/admin/users/${superId}`).set(bearer(adminToken)).expect(404);
  });

  it('rejects a stale-role JWT immediately after a demotion', async () => {
    const adminToken = await tokenFor(adminEmail);
    await server().get('/admin/casino/math').set(bearer(adminToken)).expect(200);

    const adminId = await idOf(adminEmail);
    await authorization.changeRole(await idOf(superEmail), adminId, Role.USER);

    // The same token is now a plain USER token: central authorization re-reads
    // the role from the database and refuses.
    await server().get('/admin/casino/math').set(bearer(adminToken)).expect(403);
  });

  it('keeps at least one active SUPER_ADMIN under demotion/disable, including concurrent removals', async () => {
    const superId = await idOf(superEmail);
    const super2Id = await idOf(super2Email);

    // The last active SUPER_ADMIN cannot be demoted (self-demotion here).
    await prisma.user.update({ where: { id: super2Id }, data: { role: Role.USER } });
    await expect(authorization.changeRole(superId, superId, Role.USER)).rejects.toMatchObject({
      response: { code: 'LAST_SUPER_ADMIN_REQUIRED' },
    });

    // Two SUPER_ADMINs, two concurrent removals (each demoting the other): the
    // shared lock serialises them and the guard refuses the one that would leave
    // zero. At least one active SUPER_ADMIN always remains.
    await prisma.user.update({ where: { id: super2Id }, data: { role: Role.SUPER_ADMIN } });
    const results = await Promise.allSettled([
      authorization.changeRole(superId, super2Id, Role.ADMIN),
      authorization.changeRole(super2Id, superId, Role.ADMIN),
    ]);
    // Exactly one action succeeds and the other is refused, so the serialized
    // guard never leaves zero active SUPER_ADMINs.
    expect(results.filter((entry) => entry.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    expect(results.filter((entry) => entry.status === 'rejected').length).toBeGreaterThanOrEqual(1);
    const remaining = await prisma.user.count({ where: { role: Role.SUPER_ADMIN, disabled: false } });
    expect(remaining).toBeGreaterThanOrEqual(1);
  });

  it('does not let a role grant cross-player access to a game round (IDOR preserved)', async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: playerEmail } });
    const round = await prisma.casinoRound.create({
      data: {
        userId: owner.id,
        gameType: 'DICE',
        gameVersion: 'dice.v1',
        stake: 1n,
        serverSeed: 'seed',
        serverSeedHash: 'hash',
        clientSeed: 'client',
        publicState: {},
        privateState: {},
        idempotencyKey: `rbac-owner:${owner.id}:${Date.now()}`,
      },
    });
    // Another player, and an admin, still cannot read it through the player route.
    await server().get(`/casino/rounds/${round.id}`).set(bearer(await tokenFor(player2Email))).expect(404);
    const adminResponse = await server().get(`/casino/rounds/${round.id}`).set(bearer(await tokenFor(adminEmail)));
    expect([403, 404]).toContain(adminResponse.status);
    // The owner can.
    await server().get(`/casino/rounds/${round.id}`).set(bearer(await tokenFor(playerEmail))).expect(200);
  });
});
