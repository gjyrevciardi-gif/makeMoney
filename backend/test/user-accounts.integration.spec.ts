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
 * Administrator-managed accounts on the real platform: public registration is off
 * by default, ADMIN creates USERs and only SUPER_ADMIN creates ADMINs, accounts log
 * in by username, and an administrator can set (but never read back) passwords.
 * Only the Argon2id hash is persisted. Requires an isolated *_test PostgreSQL
 * database and Redis.
 */
describe('administrator-managed accounts (PostgreSQL + Redis)', () => {
  jest.setTimeout(120_000);

  const prisma = new PrismaService();
  let app: INestApplication;
  let auth: AuthService;
  let redis: RedisService;

  const seedPassword = 'correct-horse-battery';
  const ids: Record<string, string> = {};
  const server = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  /** Rows carry BigInt columns (wallet balance, event amount); keep them dumpable. */
  const dump = (value: unknown) => JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item));
  const tokenFor = async (name: string) => (await auth.login(name, seedPassword)).pair.accessToken;
  const create = (token: string, body: Record<string, unknown>) => server().post('/admin/users').set(bearer(token)).send(body);
  const setPassword = (token: string, userId: string, password: string) =>
    server().post(`/admin/users/${userId}/password`).set(bearer(token)).send({ password });
  /** The reveal route was removed in milestone A1; every call must fall through to 404. */
  const reveal = (token: string, userId: string) => server().post(`/admin/users/${userId}/password/reveal`).set(bearer(token));
  const login = (identifier: string, password: string) => server().post('/auth/login').send({ identifier, password });

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
      '"Bet", "AuditLog", "RefreshToken", "UserPasswordVault", "Wallet", "User" CASCADE',
    );
    await redis.client.flushdb();
    const hash = await argon2.hash(seedPassword);
    const specs: [string, Role][] = [['boss', Role.SUPER_ADMIN], ['admin1', Role.ADMIN], ['admin2', Role.ADMIN], ['player', Role.USER]];
    for (const [name, role] of specs) {
      const user = await prisma.user.create({
        data: { username: name, email: uniqueTestEmail(`acct-${name}`), passwordHash: hash, role, wallet: { create: {} } },
      });
      ids[name] = user.id;
    }
    // Players belong to the administrator who funds them (an ADMIN manages only their own players).
    await prisma.user.update({ where: { id: ids.player }, data: { createdById: ids.admin1 } });
  });

  it('keeps public registration off unless it is explicitly enabled', async () => {
    const original = process.env.REGISTRATION_ENABLED;
    try {
      process.env.REGISTRATION_ENABLED = 'false';
      await server().post('/auth/register').send({ email: 'someone@example.test', password: 'long-enough-1' }).expect(403);
      delete process.env.REGISTRATION_ENABLED;
      await server().post('/auth/register').send({ email: 'someone@example.test', password: 'long-enough-1' }).expect(403);
      expect(await prisma.user.count({ where: { email: 'someone@example.test' } })).toBe(0);
    } finally {
      process.env.REGISTRATION_ENABLED = original;
    }
  });

  it('lets an ADMIN create a USER with a lowercase username, a wallet and an audit row, storing only the hash', async () => {
    const password = 'Winter-2026!';
    const res = await create(await tokenFor('admin1'), { username: '  Mark.Smith ', password }).expect(201);
    expect(res.body).toMatchObject({ username: 'mark.smith', role: 'USER' });
    expect(res.body.generatedPassword).toBeUndefined();

    const user = await prisma.user.findUniqueOrThrow({ where: { username: 'mark.smith' }, include: { wallet: true } });
    expect(user.role).toBe('USER');
    expect(user.createdById).toBe(ids.admin1);
    expect(user.email).toBeNull();
    expect(user.wallet?.balance).toBe(0n);
    expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
    // No reversible copy exists at all: the retired vault table stays empty and no
    // audit row contains the password.
    expect(await prisma.userPasswordVault.count()).toBe(0);
    expect(dump(user)).not.toContain(password);
    expect(JSON.stringify(await prisma.auditLog.findMany())).not.toContain(password);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'USER_CREATED' } });
    expect(audit).toMatchObject({ actorId: ids.admin1, targetId: user.id });
  });

  it('generates a password when none is given, returns it once, and it logs in but is never retrievable again', async () => {
    const res = await create(await tokenFor('admin1'), { username: 'generated.one' }).expect(201);
    const generated = res.body.generatedPassword as string;
    expect(generated).toHaveLength(12);
    await login('generated.one', generated).expect(201);
    // It is answerable by Argon2id, and by nothing else: no stored copy, no reveal.
    const stored = await prisma.user.findUniqueOrThrow({ where: { username: 'generated.one' } });
    expect(await argon2.verify(stored.passwordHash, generated)).toBe(true);
    expect(await prisma.userPasswordVault.count()).toBe(0);
    expect(JSON.stringify(stored)).not.toContain(generated);
    expect(JSON.stringify(await prisma.auditLog.findMany())).not.toContain(generated);
    await reveal(await tokenFor('admin1'), res.body.id).expect(404);
    await reveal(await tokenFor('boss'), res.body.id).expect(404);
  });

  it('enforces who can create what: USER no, ADMIN creates USERs only, SUPER_ADMIN creates ADMINs, nobody creates a SUPER_ADMIN here', async () => {
    const body = (username: string, role?: Role) => ({ username, password: 'long-enough-1', ...(role ? { role } : {}) });
    await create(await tokenFor('player'), body('by.player')).expect(403);
    await create(await tokenFor('admin1'), body('admin.makes.admin', Role.ADMIN)).expect(403);
    await create(await tokenFor('admin1'), body('admin.makes.super', Role.SUPER_ADMIN)).expect(400);
    await create(await tokenFor('boss'), body('boss.makes.super', Role.SUPER_ADMIN)).expect(400);
    const made = await create(await tokenFor('boss'), body('new.admin', Role.ADMIN)).expect(201);
    expect(made.body.role).toBe('ADMIN');
    expect(await prisma.user.count({ where: { username: { in: ['by.player', 'admin.makes.admin', 'admin.makes.super', 'boss.makes.super'] } } })).toBe(0);
  });

  it('validates usernames and passwords and treats usernames case-insensitively', async () => {
    const token = await tokenFor('admin1');
    for (const username of ['ab', 'has space', 'bad/char', 'x'.repeat(33)]) {
      await create(token, { username, password: 'long-enough-1' }).expect(400);
    }
    await create(token, { username: 'valid.name', password: 'short' }).expect(400);
    await create(token, { username: 'Valid.Name', password: 'long-enough-1' }).expect(201);
    await create(token, { username: 'VALID.NAME', password: 'long-enough-1' }).expect(409);
    // The database also refuses an unnormalised name even if application code were bypassed.
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "User" (id, username, "passwordHash", role) VALUES (gen_random_uuid(), 'Mixed.Case', 'x', 'USER')`,
    )).rejects.toThrow(/User_username_format/);
  });

  it('logs in by username (any case) or by legacy email, and rejects a wrong password or a disabled account', async () => {
    await login('PLAYER', seedPassword).expect(201);
    const email = (await prisma.user.findUniqueOrThrow({ where: { id: ids.player } })).email as string;
    await login(email, seedPassword).expect(201);
    await server().post('/auth/login').send({ email, password: seedPassword }).expect(201);
    await login('player', 'not-the-password').expect(401);
    await prisma.user.update({ where: { id: ids.player }, data: { disabled: true } });
    await login('player', seedPassword).expect(403);
  });

  it('lets an ADMIN set a USER password: old one stops working, sessions are revoked, and no copy is stored', async () => {
    await login('player', seedPassword).expect(201);
    expect(await prisma.refreshToken.count({ where: { userId: ids.player, revokedAt: null } })).toBeGreaterThan(0);

    await setPassword(await tokenFor('admin1'), ids.player, 'brand-new-pass').expect(201);
    await login('player', seedPassword).expect(401);
    expect(await prisma.refreshToken.count({ where: { userId: ids.player, revokedAt: null } })).toBe(0);
    await login('player', 'brand-new-pass').expect(201);
    expect(await prisma.userPasswordVault.count()).toBe(0);
    await reveal(await tokenFor('admin1'), ids.player).expect(404);
    expect(await prisma.auditLog.count({ where: { action: 'PASSWORD_SET_BY_ADMIN', targetId: ids.player, actorId: ids.admin1 } })).toBe(1);
    expect(JSON.stringify(await prisma.auditLog.findMany())).not.toContain('brand-new-pass');

    await setPassword(await tokenFor('admin1'), ids.player, 'short').expect(400);
  });

  it('keeps the role hierarchy for set password: ADMIN reaches USERs only, SUPER_ADMIN reaches everyone, USER nobody', async () => {
    const admin = await tokenFor('admin1');
    // An ADMIN cannot even tell another ADMIN or a SUPER_ADMIN exists.
    for (const target of ['admin2', 'boss']) {
      await setPassword(admin, ids[target], 'whatever-123').expect(404);
    }
    await setPassword(await tokenFor('player'), ids.admin1, 'whatever-123').expect(403);

    const boss = await tokenFor('boss');
    await setPassword(boss, ids.admin2, 'set-by-boss-1').expect(201);
    await login('admin2', 'set-by-boss-1').expect(201);
  });

  it('closes the reveal endpoint for every role and never writes a reveal audit row', async () => {
    const admin = await tokenFor('admin1');
    const boss = await tokenFor('boss');
    const player = await tokenFor('player');
    const anonymous = server();
    // The route is gone: no role can reach it, and an unauthenticated call cannot
    // even reach a guard that would answer 403.
    await reveal(admin, ids.player).expect(404);
    await reveal(boss, ids.admin2).expect(404);
    await reveal(player, ids.player).expect(404);
    await anonymous.post(`/admin/users/${ids.player}/password/reveal`).expect(404);
    // Passing a bad target id must not resurrect a service-level lookup either.
    await reveal(admin, 'not-a-uuid').expect(404);
    expect(await prisma.auditLog.count({ where: { action: 'PASSWORD_REVEALED' } })).toBe(0);
    expect(await prisma.userPasswordVault.count()).toBe(0);
  });

  it('stores no plaintext or encrypted password copy on create, admin reset or own change', async () => {
    const admin = await tokenFor('admin1');
    const createPassword = 'create-secret-1';
    const resetPassword = 'reset-secret-1';
    const ownPassword = 'own-secret-1';
    await create(admin, { username: 'no.vault', password: createPassword }).expect(201);
    await setPassword(admin, ids.player, resetPassword).expect(201);
    const player = await login('player', resetPassword).expect(201);
    await server().post('/users/me/password')
      .set(bearer(player.body.accessToken))
      .send({ currentPassword: resetPassword, newPassword: ownPassword })
      .expect(201);

    expect(await prisma.userPasswordVault.count()).toBe(0);
    const everything = dump({
      users: await prisma.user.findMany(),
      vault: await prisma.userPasswordVault.findMany(),
      audits: await prisma.auditLog.findMany(),
      events: await prisma.securityEvent.findMany(),
    });
    for (const secret of [seedPassword, createPassword, resetPassword, ownPassword]) {
      expect(everything).not.toContain(secret);
    }
    await login('player', ownPassword).expect(201);
  });

  it('creates and sets passwords when PASSWORD_VAULT_KEY is not configured (MFA is unused)', async () => {
    const original = process.env.PASSWORD_VAULT_KEY;
    const admin = await tokenFor('admin1');
    try {
      delete process.env.PASSWORD_VAULT_KEY;
      const generated = await create(admin, { username: 'no.key' }).expect(201);
      await login('no.key', generated.body.generatedPassword as string).expect(201);
      await setPassword(admin, ids.player, 'works-without-key-1').expect(201);
      await login('player', seedPassword).expect(401);
      await login('player', 'works-without-key-1').expect(201);
      expect(await prisma.userPasswordVault.count()).toBe(0);
    } finally {
      process.env.PASSWORD_VAULT_KEY = original;
    }
  });

  it('lets an ADMIN rename a USER, audits it, and refuses a taken name', async () => {
    const admin = await tokenFor('admin1');
    await server().post(`/admin/users/${ids.player}/username`).set(bearer(admin)).send({ username: 'Renamed.Player' }).expect(201);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.player } })).username).toBe('renamed.player');
    expect(await prisma.auditLog.count({ where: { action: 'USER_USERNAME_CHANGED', targetId: ids.player } })).toBe(1);
    await server().post(`/admin/users/${ids.player}/username`).set(bearer(admin)).send({ username: 'ADMIN2' }).expect(409);
    await server().post(`/admin/users/${ids.admin2}/username`).set(bearer(admin)).send({ username: 'sneaky.rename' }).expect(404);
  });
});
