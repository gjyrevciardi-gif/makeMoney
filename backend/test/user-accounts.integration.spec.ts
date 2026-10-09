import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { PasswordVaultService } from '../src/auth/password-vault.service';
import { BigIntInterceptor } from '../src/common/bigint.interceptor';
import { RedisService } from '../src/common/redis.service';
import { PrismaService } from '../src/prisma.service';
import { uniqueTestEmail } from './test-identity';

/**
 * Administrator-managed accounts on the real platform: public registration is off
 * by default, ADMIN creates USERs and only SUPER_ADMIN creates ADMINs, accounts log
 * in by username, and an administrator can set and reveal passwords through an
 * encrypted vault. Requires an isolated *_test PostgreSQL database and Redis.
 */
describe('administrator-managed accounts (PostgreSQL + Redis)', () => {
  jest.setTimeout(120_000);

  const prisma = new PrismaService();
  let app: INestApplication;
  let auth: AuthService;
  let vault: PasswordVaultService;
  let redis: RedisService;

  const seedPassword = 'correct-horse-battery';
  const ids: Record<string, string> = {};
  const server = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const tokenFor = async (name: string) => (await auth.login(name, seedPassword)).pair.accessToken;
  const create = (token: string, body: Record<string, unknown>) => server().post('/admin/users').set(bearer(token)).send(body);
  const setPassword = (token: string, userId: string, password: string) =>
    server().post(`/admin/users/${userId}/password`).set(bearer(token)).send({ password });
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
    vault = app.get(PasswordVaultService);
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

  it('lets an ADMIN create a USER with a lowercase username, a wallet, an audit row and an encrypted vault entry', async () => {
    const password = 'Winter-2026!';
    const res = await create(await tokenFor('admin1'), { username: '  Mark.Smith ', password }).expect(201);
    expect(res.body).toMatchObject({ username: 'mark.smith', role: 'USER' });
    expect(res.body.generatedPassword).toBeUndefined();

    const user = await prisma.user.findUniqueOrThrow({ where: { username: 'mark.smith' }, include: { wallet: true, passwordVault: true } });
    expect(user.role).toBe('USER');
    expect(user.createdById).toBe(ids.admin1);
    expect(user.email).toBeNull();
    expect(user.wallet?.balance).toBe(0n);
    expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
    // Encrypted at rest: neither the vault row nor any audit row contains the password.
    expect(JSON.stringify(user.passwordVault)).not.toContain(password);
    expect(JSON.stringify(await prisma.auditLog.findMany())).not.toContain(password);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'USER_CREATED' } });
    expect(audit).toMatchObject({ actorId: ids.admin1, targetId: user.id });
    expect(await vault.decrypt(user.id, user.passwordVault!)).toBe(password);
  });

  it('generates a password when none is given, returns it once, and it logs in and can be revealed', async () => {
    const res = await create(await tokenFor('admin1'), { username: 'generated.one' }).expect(201);
    const generated = res.body.generatedPassword as string;
    expect(generated).toHaveLength(12);
    await login('generated.one', generated).expect(201);
    const shown = await reveal(await tokenFor('admin1'), res.body.id).expect(201);
    expect(shown.body.password).toBe(generated);
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

  it('lets an ADMIN set a USER password: old one stops working, sessions are revoked, the vault follows', async () => {
    await login('player', seedPassword).expect(201);
    expect(await prisma.refreshToken.count({ where: { userId: ids.player, revokedAt: null } })).toBeGreaterThan(0);

    await setPassword(await tokenFor('admin1'), ids.player, 'brand-new-pass').expect(201);
    await login('player', seedPassword).expect(401);
    expect(await prisma.refreshToken.count({ where: { userId: ids.player, revokedAt: null } })).toBe(0);
    await login('player', 'brand-new-pass').expect(201);
    expect((await reveal(await tokenFor('admin1'), ids.player).expect(201)).body.password).toBe('brand-new-pass');
    expect(await prisma.auditLog.count({ where: { action: 'PASSWORD_SET_BY_ADMIN', targetId: ids.player, actorId: ids.admin1 } })).toBe(1);
    expect(JSON.stringify(await prisma.auditLog.findMany())).not.toContain('brand-new-pass');

    await setPassword(await tokenFor('admin1'), ids.player, 'short').expect(400);
  });

  it('keeps the role hierarchy for set and reveal: ADMIN reaches USERs only, SUPER_ADMIN reaches everyone, USER nobody', async () => {
    const admin = await tokenFor('admin1');
    // An ADMIN cannot even tell another ADMIN or a SUPER_ADMIN exists.
    for (const target of ['admin2', 'boss']) {
      await setPassword(admin, ids[target], 'whatever-123').expect(404);
      await reveal(admin, ids[target]).expect(404);
    }
    await setPassword(await tokenFor('player'), ids.admin1, 'whatever-123').expect(403);
    await reveal(await tokenFor('player'), ids.admin1).expect(403);

    const boss = await tokenFor('boss');
    await setPassword(boss, ids.admin2, 'set-by-boss-1').expect(201);
    expect((await reveal(boss, ids.admin2).expect(201)).body.password).toBe('set-by-boss-1');
    await login('admin2', 'set-by-boss-1').expect(201);
  });

  it('audits every reveal without ever recording the password, and says so for a password from before the vault', async () => {
    const admin = await tokenFor('admin1');
    // Seeded users have a password hash but no vault row (set before the vault existed).
    const legacy = await reveal(admin, ids.player).expect(404);
    expect(legacy.body).toMatchObject({ code: 'PASSWORD_NOT_AVAILABLE' });
    expect(await prisma.auditLog.count({ where: { action: 'PASSWORD_REVEALED' } })).toBe(0);

    await setPassword(admin, ids.player, 'now-viewable-1').expect(201);
    await reveal(admin, ids.player).expect(201);
    await reveal(admin, ids.player).expect(201);
    const rows = await prisma.auditLog.findMany({ where: { action: 'PASSWORD_REVEALED' } });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.actorId === ids.admin1 && row.targetId === ids.player)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('now-viewable-1');
  });

  it('binds each ciphertext to its owner and refuses a tampered or relocated one', async () => {
    const admin = await tokenFor('admin1');
    await setPassword(admin, ids.player, 'owner-secret-1').expect(201);
    const row = await prisma.userPasswordVault.findUniqueOrThrow({ where: { userId: ids.player } });
    // Copied onto another user's id it fails authentication.
    expect(() => vault.decrypt(ids.admin2, row)).toThrow();
    // A flipped ciphertext byte fails authentication too.
    const flipped = Buffer.from(row.ciphertext, 'base64');
    flipped[0] ^= 0xff;
    expect(() => vault.decrypt(ids.player, { ...row, ciphertext: flipped.toString('base64') })).toThrow();
    expect(vault.decrypt(ids.player, row)).toBe('owner-secret-1');
  });

  it('fails closed with 503 and creates nothing when the vault key is missing', async () => {
    const original = process.env.PASSWORD_VAULT_KEY;
    try {
      delete process.env.PASSWORD_VAULT_KEY;
      await create(await tokenFor('admin1'), { username: 'no.key', password: 'long-enough-1' }).expect(503);
      await setPassword(await tokenFor('admin1'), ids.player, 'long-enough-1').expect(503);
      expect(await prisma.user.count({ where: { username: 'no.key' } })).toBe(0);
      // The password hash was not changed either.
      await login('player', seedPassword).expect(201);
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
