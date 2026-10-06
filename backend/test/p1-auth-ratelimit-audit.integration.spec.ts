import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { BigIntInterceptor } from '../src/common/bigint.interceptor';
import { RedisService } from '../src/common/redis.service';
import { PrismaService } from '../src/prisma.service';
import { uniqueTestEmail } from './test-identity';

/**
 * P1 hardening: a disabled account gets no new session and cannot rotate a
 * refresh token; the user-management routes share the admin rate budget; role
 * changes are audited with a truthful action. Requires an isolated *_test
 * PostgreSQL database and Redis.
 */
describe('P1: disabled-account auth, user-admin rate limit, audit semantics (PostgreSQL + Redis)', () => {
  jest.setTimeout(120_000);

  const prisma = new PrismaService();
  let app: INestApplication;
  let auth: AuthService;
  let redis: RedisService;

  const password = 'correct-horse-battery';
  const mails: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const server = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const tokenFor = async (name: string) => (await auth.login(mails[name], password)).pair.accessToken;
  const refreshCookieOf = (response: request.Response) => {
    const raw = ([] as string[]).concat(response.headers['set-cookie'] ?? []).find((value) => value.startsWith('refresh_token='));
    return raw ? raw.split(';')[0] : '';
  };
  const httpLogin = (name: string, pass = password) => server().post('/auth/login').send({ email: mails[name], password: pass });
  const setRole = (token: string, userId: string, role: Role) => server().post(`/admin/users/${userId}/role`).set(bearer(token)).send({ role });
  const setStatus = (token: string, userId: string, disabled: boolean) => server().post(`/admin/users/${userId}/status`).set(bearer(token)).send({ disabled });
  const unrevoked = (userId: string) => prisma.refreshToken.count({ where: { userId, revokedAt: null } });

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
    const specs: [string, Role][] = [['user', Role.USER], ['user2', Role.USER], ['admin', Role.ADMIN], ['super', Role.SUPER_ADMIN]];
    for (const [name, role] of specs) {
      mails[name] = uniqueTestEmail(`p1-${name}`);
      ids[name] = (await prisma.user.create({ data: { email: mails[name], passwordHash: hash, role, wallet: { create: {} } } })).id;
    }
  });

  it('gives a disabled account no new session, without disclosing status to a wrong password', async () => {
    await setStatus(await tokenFor('admin'), ids.user, true).expect(201);

    const refused = await httpLogin('user').expect(403);
    // The global filter sanitizes bodies; the audit row below records the precise reason.
    expect(refused.body).toMatchObject({ code: 'FORBIDDEN' });
    expect(refreshCookieOf(refused)).toBe('');
    expect(await unrevoked(ids.user)).toBe(0);
    expect(await prisma.refreshToken.count({ where: { userId: ids.user, revokedAt: null } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { actorId: ids.user, action: 'LOGIN_FAILED', result: 'ACCOUNT_DISABLED' } })).toBe(1);

    // Without the password the response is the ordinary invalid-credentials one.
    const wrong = await httpLogin('user', 'not-the-right-password').expect(401);
    expect(JSON.stringify(wrong.body)).not.toContain('ACCOUNT_DISABLED');

    // Enabling restores sign-in; the database is the only authority.
    await setStatus(await tokenFor('super'), ids.user, false).expect(201);
    await httpLogin('user').expect(201);
  });

  it('disabling revokes every refresh token in the same transaction, so a disabled account cannot rotate', async () => {
    const login = await httpLogin('user').expect(201);
    const cookie = refreshCookieOf(login);
    expect(cookie).not.toBe('');
    const accessToken = login.body.accessToken as string;
    await server().get('/casino/games').set(bearer(accessToken)).expect(200);
    expect(await unrevoked(ids.user)).toBe(1);

    await setStatus(await tokenFor('admin'), ids.user, true).expect(201);
    expect(await unrevoked(ids.user)).toBe(0);

    // Refresh is refused, and the already-issued access token fails every guarded API.
    await server().post('/auth/refresh').set('Cookie', cookie).expect((response) => {
      if (![401, 403].includes(response.status)) throw new Error(`refresh returned ${response.status}`);
    });
    await server().get('/casino/games').set(bearer(accessToken)).expect(403);
    expect(await prisma.refreshToken.count({ where: { userId: ids.user, revokedAt: null } })).toBe(0);
  });

  it('refuses refresh for a disabled account even when no token was revoked, and revokes its family', async () => {
    const login = await httpLogin('user').expect(201);
    const cookie = refreshCookieOf(login);
    // Status flipped directly (not through the admin service): the refresh path itself must re-check.
    await prisma.user.update({ where: { id: ids.user }, data: { disabled: true } });
    expect(await unrevoked(ids.user)).toBe(1);

    const refused = await server().post('/auth/refresh').set('Cookie', cookie).expect(403);
    // The global filter sanitizes bodies; the audit row below records the precise reason.
    expect(refused.body).toMatchObject({ code: 'FORBIDDEN' });
    expect(refreshCookieOf(refused)).toBe('');
    expect(await unrevoked(ids.user)).toBe(0);
    expect(await prisma.auditLog.count({ where: { actorId: ids.user, result: 'ACCOUNT_DISABLED' } })).toBe(1);

    // After re-enabling, the old cookie stays dead and a fresh login works.
    await prisma.user.update({ where: { id: ids.user }, data: { disabled: false } });
    await server().post('/auth/refresh').set('Cookie', cookie).expect(403);
    await httpLogin('user').expect(201);
  });

  it('applies the shared admin rate budget to role and status changes', async () => {
    const token = await tokenFor('admin');
    // 10 role changes + 10 status changes on a USER target consume the 20/minute budget...
    for (let index = 0; index < 10; index += 1) await setRole(token, ids.user2, Role.USER).expect(201);
    for (let index = 0; index < 10; index += 1) await setStatus(token, ids.user2, false).expect(201);
    // ...so the next privileged mutation, on either route, is throttled before it runs.
    await setRole(token, ids.user2, Role.USER).expect(429);
    await setStatus(token, ids.user2, true).expect(429);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.user2 } })).disabled).toBe(false);

    // The budget is per actor: another administrator is unaffected.
    await setRole(await tokenFor('super'), ids.user2, Role.USER).expect(201);
  });

  it('audits promotion, demotion and status changes with their own actions and keeps history intact', async () => {
    const historic = await prisma.auditLog.create({
      data: { actorId: ids.super, targetType: 'USER', targetId: ids.user2, action: 'ADMIN_ROLE_GRANTED', result: 'SUCCESS', metadata: { from: 'ADMIN', to: 'USER', note: 'pre-migration demotion' } },
    });
    const token = await tokenFor('super');

    await setRole(token, ids.user, Role.ADMIN).expect(201);
    await setRole(token, ids.user, Role.USER).expect(201);
    await setStatus(token, ids.user, true).expect(201);

    const rows = await prisma.auditLog.findMany({
      where: { targetId: ids.user, action: { in: ['ADMIN_ROLE_GRANTED', 'ADMIN_ROLE_REVOKED', 'ADMIN_USER_STATUS_CHANGED'] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((row) => [row.action, (row.metadata as { from?: string; to?: string } | null)?.from, (row.metadata as { to?: string } | null)?.to]))
      .toEqual([
        ['ADMIN_ROLE_GRANTED', 'USER', 'ADMIN'],
        ['ADMIN_ROLE_REVOKED', 'ADMIN', 'USER'],
        ['ADMIN_USER_STATUS_CHANGED', undefined, undefined],
      ]);
    expect(rows.every((row) => row.actorId === ids.super)).toBe(true);

    // The historical row was not rewritten.
    const untouched = await prisma.auditLog.findUniqueOrThrow({ where: { id: historic.id } });
    expect(untouched.action).toBe('ADMIN_ROLE_GRANTED');
    expect(untouched.metadata).toEqual(historic.metadata);
  });
});
