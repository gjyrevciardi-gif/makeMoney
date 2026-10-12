import { BadRequestException, ForbiddenException, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AUTH_VERSION_CLAIM, AuthService } from '../src/auth/auth.service';
import { AuthorizationService } from '../src/auth/authorization.service';
import { PasswordVaultService } from '../src/auth/password-vault.service';
import { UserAccountsService } from '../src/auth/user-accounts.service';
import { PrismaService } from '../src/prisma.service';
import { uniqueTestEmail } from './test-identity';

/**
 * Session revocation is a database-backed counter (`User.authVersion`), not a
 * timestamp: every access token carries the version it was issued under and the
 * guard requires an exact match against the account row. These tests exercise
 * the counter through the real HTTP stack and the real database.
 */
describe('auth session revocation (authVersion)', () => {
  const prisma = new PrismaService();
  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  const auth = new AuthService(prisma, jwt);
  // Two extra clients stand in for two app instances sharing one database, so
  // the refresh/logout race exercises the real row lock rather than one
  // client's own transaction scheduling.
  const workerA = new PrismaService();
  const workerB = new PrismaService();
  const barrier = new PrismaService();
  const authA = new AuthService(workerA, jwt);
  const authB = new AuthService(workerB, jwt);
  let accountsA: UserAccountsService;
  let accountsB: UserAccountsService;
  let app: INestApplication;
  const userEmail = uniqueTestEmail('revocation-user');
  const adminEmail = uniqueTestEmail('revocation-admin');
  const password = 'correct-horse-battery';
  let userId: string;

  async function createApp() {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const nest = module.createNestApplication();
    nest.use(cookieParser());
    nest.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await nest.init();
    return nest;
  }
  const rawCookie = (response: request.Response) => (response.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
  /** The raw refresh token value the service methods take, not the cookie header. */
  const tokenOf = (response: request.Response) => rawCookie(response).split('=')[1];
  const login = (email: string, secret = password) =>
    request(app.getHttpServer()).post('/auth/login').send({ email, password: secret });
  /** `/wallet/me` is behind AccessGuard only, so it is a clean token probe. */
  const probe = (token: string) => request(app.getHttpServer()).get('/wallet/me').set('Authorization', `Bearer ${token}`);
  const versionOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id }, select: { authVersion: true } })).authVersion;
  /**
   * Hold the account row lock from a third connection. The lock-ready signal
   * fires only after the `FOR UPDATE` succeeded, so callers get evidence the
   * lock is held instead of a sleep.
   */
  const holdUserLock = async () => {
    let release!: () => void; let acquired!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const locked = new Promise<void>((resolve) => { acquired = resolve; });
    const held = barrier.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      acquired();
      await gate;
    });
    await locked;
    return { release, held };
  };
  /**
   * Wait until `count` sessions are parked on a lock. This database belongs to
   * this suite alone, so the only waiting sessions are the two under test.
   */
  const waitForLockWaiters = async (count: number) => {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const [row] = await prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
      `;
      if (row.n >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`the account row lock never queued ${count} waiter(s)`);
  };

  beforeAll(async () => {
    await Promise.all([prisma.$connect(), workerA.$connect(), workerB.$connect(), barrier.$connect()]);
    app = await createApp();
    // Two accounts services on separate clients so a password race is a real
    // database race rather than one client's transaction scheduling.
    accountsA = new UserAccountsService(workerA, app.get(AuthorizationService), app.get(PasswordVaultService));
    accountsB = new UserAccountsService(workerB, app.get(AuthorizationService), app.get(PasswordVaultService));
  });
  afterAll(async () => {
    if (app) await app.close();
    await Promise.all([prisma.$disconnect(), workerA.$disconnect(), workerB.$disconnect(), barrier.$disconnect()]);
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "LedgerEntry", "BetLeg", "Bet", "AuditLog", "RefreshToken", "Wallet", "User" CASCADE');
    userId = (await auth.register(userEmail, password)).id;
  });

  it('accepts a live token and rejects the same token after logout', async () => {
    const session = await login(userEmail).expect(201);
    const token = session.body.accessToken as string;
    await probe(token).expect(200);
    await request(app.getHttpServer()).post('/auth/logout').set('Cookie', rawCookie(session)).expect(201);
    await probe(token).expect(401);
    expect(await versionOf(userId)).toBe(1);
  });

  it('rejects a missing, malformed, negative or stale version claim', async () => {
    const current = await versionOf(userId);
    const sign = (payload: Record<string, unknown>) => jwt.signAsync({ sub: userId, role: 'USER', ...payload });
    await probe(await sign({})).expect(401);
    await probe(await sign({ [AUTH_VERSION_CLAIM]: '0' })).expect(401);
    await probe(await sign({ [AUTH_VERSION_CLAIM]: 1.5 })).expect(401);
    await probe(await sign({ [AUTH_VERSION_CLAIM]: -1 })).expect(401);
    await probe(await sign({ [AUTH_VERSION_CLAIM]: current + 1 })).expect(401);
    // The exact current version is the only value that passes.
    await probe(await sign({ [AUTH_VERSION_CLAIM]: current })).expect(200);
    await prisma.user.update({ where: { id: userId }, data: { authVersion: { increment: 1 } } });
    await probe(await sign({ [AUTH_VERSION_CLAIM]: current })).expect(401);
  });

  it('signs every device out at once and revokes every refresh token', async () => {
    const first = await login(userEmail).expect(201);
    const second = await login(userEmail).expect(201);
    await probe(first.body.accessToken).expect(200);
    await probe(second.body.accessToken).expect(200);
    await request(app.getHttpServer()).post('/auth/logout').set('Cookie', rawCookie(first)).expect(201);
    await probe(first.body.accessToken).expect(401);
    await probe(second.body.accessToken).expect(401);
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', rawCookie(first)).expect(403);
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', rawCookie(second)).expect(403);
    const records = await prisma.refreshToken.findMany({ where: { userId } });
    expect(records.length).toBe(2);
    expect(records.every((r) => r.revokedAt !== null)).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'LOGOUT', targetId: userId } })).toBe(1);
  });

  it('does not mint a session from a refresh token presented after logout', async () => {
    const session = await login(userEmail).expect(201);
    await request(app.getHttpServer()).post('/auth/logout').set('Cookie', rawCookie(session)).expect(201);
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', rawCookie(session)).expect(403);
    await probe(session.body.accessToken).expect(401);
    // A later login is a genuinely new session at the new version.
    const relogin = await login(userEmail).expect(201);
    await probe(relogin.body.accessToken).expect(200);
    expect(await versionOf(userId)).toBe(1);
  });

  it('invalidates a token minted by a refresh that linearized before logout', async () => {
    const session = await login(userEmail).expect(201);
    const original = tokenOf(session);
    const rotated = await auth.rotateRefreshToken(original);
    await probe(rotated.accessToken).expect(200);
    await auth.revokeFamily(original);
    await probe(rotated.accessToken).expect(401);
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', `refresh_token=${rotated.refreshToken}`).expect(403);
    expect(await versionOf(userId)).toBe(1);
  });

  it('keeps refresh rotation and family reuse detection', async () => {
    const session = await login(userEmail).expect(201);
    const original = rawCookie(session);
    const refresh = await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', original).expect(201);
    const rotated = rawCookie(refresh);
    await probe(refresh.body.accessToken).expect(200);
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', original).expect(403);
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', rotated).expect(403);
    const records = await prisma.refreshToken.findMany({ where: { userId } });
    expect(records.every((r) => r.revokedAt !== null)).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'REFRESH_REUSE_DETECTED' } })).toBeGreaterThanOrEqual(1);
  });

  it('revokes the current session when the user changes their own password', async () => {
    const session = await login(userEmail).expect(201);
    const token = session.body.accessToken as string;
    await probe(token).expect(200);
    await request(app.getHttpServer()).post('/users/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: password, newPassword: 'a-fresh-horse-battery' })
      .expect(201);
    await probe(token).expect(401);
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', rawCookie(session)).expect(403);
    await login(userEmail, password).expect(401);
    const relogin = await login(userEmail, 'a-fresh-horse-battery').expect(201);
    await probe(relogin.body.accessToken).expect(200);
    expect(await versionOf(userId)).toBe(1);
  });

  it('revokes the target session when an administrator sets the password', async () => {
    const admin = await prisma.user.create({
      data: { email: adminEmail, passwordHash: await argon2.hash(password, { type: argon2.argon2id }), role: 'ADMIN', wallet: { create: {} } },
    });
    await prisma.user.updateMany({ where: { role: 'USER' }, data: { createdById: admin.id } });
    const adminSession = await login(adminEmail).expect(201);
    const session = await login(userEmail).expect(201);
    await probe(session.body.accessToken).expect(200);
    await request(app.getHttpServer()).post(`/admin/users/${userId}/password`)
      .set('Authorization', `Bearer ${adminSession.body.accessToken}`)
      .send({ password: 'admin-set-horse-battery' })
      .expect(201);
    await probe(session.body.accessToken).expect(401);
    const relogin = await login(userEmail, 'admin-set-horse-battery').expect(201);
    await probe(relogin.body.accessToken).expect(200);
    // The administrator's own session is untouched by the target's revocation.
    await probe(adminSession.body.accessToken).expect(200);
    expect(await versionOf(admin.id)).toBe(0);
  });

  it('keeps a disabled user blocked on access and refresh', async () => {
    const session = await login(userEmail).expect(201);
    await prisma.user.update({ where: { id: userId }, data: { disabled: true } });
    await probe(session.body.accessToken).expect(403);
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', rawCookie(session)).expect(403);
    await login(userEmail).expect(403);
  });

  it('keeps the counter exact across rapid logins and logouts in the same second', async () => {
    const first = await login(userEmail).expect(201);
    await request(app.getHttpServer()).post('/auth/logout').set('Cookie', rawCookie(first)).expect(201);
    const second = await login(userEmail).expect(201);
    await request(app.getHttpServer()).post('/auth/logout').set('Cookie', rawCookie(second)).expect(201);
    const third = await login(userEmail).expect(201);
    await probe(first.body.accessToken).expect(401);
    await probe(second.body.accessToken).expect(401);
    await probe(third.body.accessToken).expect(200);
    expect(await versionOf(userId)).toBe(2);
  });

  /**
   * The refresh/logout race has two legitimate linearizations, decided by the
   * account row lock. Each ordering is driven deterministically: the first
   * caller must be observed parked on the lock (`waitForLockWaiters(1)`) before
   * the second is launched, so the lock queue — not launch timing or a sleep —
   * fixes who wins.
   */
  it('linearizes a refresh before a logout and still invalidates its new token', async () => {
    const before = await versionOf(userId);
    const session = await login(userEmail).expect(201);
    const cookie = tokenOf(session);
    const { release, held } = await holdUserLock();
    const pending: Promise<unknown>[] = [];
    try {
      const refresh = authA.rotateRefreshToken(cookie);
      pending.push(refresh);
      await waitForLockWaiters(1);
      const logout = authB.revokeFamily(cookie);
      pending.push(logout);
      await waitForLockWaiters(2);
      release();
      const rotated = await refresh;
      await logout;
      await held;
      // The rotation committed first, yet its token is dead the moment the
      // logout bumps the version: the guard rejects by version, not timestamp.
      await probe(rotated.accessToken).expect(401);
      await probe(session.body.accessToken).expect(401);
      // Exactly one invalidation: the version update is atomic and never twice.
      expect(await versionOf(userId)).toBe(before + 1);
      expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { action: 'LOGOUT', targetId: userId } })).toBe(1);
      // The refresh genuinely won, so its success is recorded and then revoked.
      expect(await prisma.auditLog.count({ where: { action: 'REFRESH_SUCCESS', actorId: userId } })).toBe(1);
    } finally {
      release();
      await Promise.allSettled(pending);
      await held.catch(() => undefined);
    }
  });

  it('rejects a refresh that queues behind a logout as a revoked family', async () => {
    const before = await versionOf(userId);
    const session = await login(userEmail).expect(201);
    const cookie = tokenOf(session);
    const { release, held } = await holdUserLock();
    const pending: Promise<unknown>[] = [];
    try {
      const logout = authB.revokeFamily(cookie);
      pending.push(logout);
      await waitForLockWaiters(1);
      // Attach the settlement handler immediately so the rejection is captured
      // and asserted explicitly rather than surfacing as an unhandled promise.
      const refresh = authA.rotateRefreshToken(cookie).then(
        (pair) => ({ ok: true as const, pair }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      pending.push(refresh);
      await waitForLockWaiters(2);
      release();
      await logout;
      await held;
      // The logout committed first and revoked the row, so the queued refresh
      // sees a revoked token: the documented reuse error, not a swallowed one.
      const outcome = await refresh;
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('the refresh must have lost the race');
      expect(outcome.error).toBeInstanceOf(ForbiddenException);
      expect((outcome.error as ForbiddenException).message).toBe('REFRESH_TOKEN_REUSE_DETECTED');
      // No new session survives, and the original access token is dead.
      await probe(session.body.accessToken).expect(401);
      expect(await versionOf(userId)).toBe(before + 1);
      expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { action: 'LOGOUT', targetId: userId } })).toBe(1);
      // The refresh never minted a session, so no rotation success was recorded.
      expect(await prisma.auditLog.count({ where: { action: 'REFRESH_SUCCESS', actorId: userId } })).toBe(0);
    } finally {
      release();
      await Promise.allSettled(pending);
      await held.catch(() => undefined);
    }
  });

  it('binds an MFA challenge to the session version at read and at issuance', async () => {
    const challenge = await auth.issueMfaChallenge(userId, await versionOf(userId));
    const read = await auth.readMfaChallenge(challenge);
    expect(read).toEqual({ userId, authVersion: await versionOf(userId) });
    await prisma.user.update({ where: { id: userId }, data: { authVersion: { increment: 1 } } });
    // The challenge is refused once the version moved, and a challenge read
    // before the move cannot finish a session afterwards either.
    await expect(auth.readMfaChallenge(challenge)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(auth.startSessionFor(read.userId, { authVersion: read.authVersion })).rejects.toBeInstanceOf(UnauthorizedException);
    const fresh = await auth.readMfaChallenge(await auth.issueMfaChallenge(userId, await versionOf(userId)));
    await expect(auth.startSessionFor(fresh.userId, { authVersion: fresh.authVersion })).resolves.toBeDefined();
  });

  it('does not issue a session from a password proof invalidated before issuance', async () => {
    const verified = await auth.verifyCredentials(userEmail, password);
    const session = await login(userEmail).expect(201);
    await request(app.getHttpServer()).post('/users/me/password')
      .set('Authorization', `Bearer ${session.body.accessToken}`)
      .send({ currentPassword: password, newPassword: 'rotated-horse-battery' })
      .expect(201);
    // The snapshot the login controller would have carried is stale by now.
    await expect(auth.startSessionFor(verified.id, { authVersion: verified.authVersion, passwordHash: verified.passwordHash }))
      .rejects.toBeInstanceOf(UnauthorizedException);
    // The same call succeeds once the proof matches the account again.
    const fresh = await auth.verifyCredentials(userEmail, 'rotated-horse-battery');
    await expect(auth.startSessionFor(fresh.id, { authVersion: fresh.authVersion, passwordHash: fresh.passwordHash })).resolves.toBeDefined();
  });

  it('lets exactly one of two concurrent own-password changes win', async () => {
    const before = await versionOf(userId);
    const results = await Promise.allSettled([
      accountsA.changeOwnPassword(userId, password, 'first-horse-battery'),
      accountsB.changeOwnPassword(userId, password, 'second-horse-battery'),
    ]);
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(results.filter((result) => result.status === 'fulfilled').length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reason).toBeInstanceOf(BadRequestException);
    expect(await versionOf(userId)).toBe(before + 1);
    expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'PASSWORD_CHANGED', targetId: userId } })).toBe(1);
  });

  it('leaves a family-reuse rejection audited but does not invent a session', async () => {
    const session = await login(userEmail).expect(201);
    const cookie = tokenOf(session);
    await auth.rotateRefreshToken(cookie);
    await expect(auth.rotateRefreshToken(cookie)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await prisma.auditLog.count({ where: { action: 'REFRESH_REUSE_DETECTED', result: 'REVOKED' } })).toBe(1);
    expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
  });
});
