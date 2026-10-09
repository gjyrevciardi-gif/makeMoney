import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { currentStep, totpCode } from '../src/auth/totp';
import { BigIntInterceptor } from '../src/common/bigint.interceptor';
import { RedisService } from '../src/common/redis.service';
import { PrismaService } from '../src/prisma.service';
import { uniqueTestEmail } from './test-identity';

describe('RFC 6238 test vector', () => {
  it('matches the published SHA-1 value for time 59 s (6 digits of 94287082)', () => {
    // Secret "12345678901234567890" in base32.
    expect(totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', Math.floor(59 / 30))).toBe('287082');
  });
});

/** Google Authenticator for administrators. Requires an isolated *_test PostgreSQL database and Redis. */
describe('administrator two-factor (PostgreSQL + Redis)', () => {
  jest.setTimeout(120_000);

  const prisma = new PrismaService();
  let app: INestApplication;
  let auth: AuthService;
  let redis: RedisService;

  const seedPassword = 'correct-horse-battery';
  const ids: Record<string, string> = {};
  const server = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const tokenFor = async (name: string) => (await auth.login(name, seedPassword)).pair.accessToken;
  const login = (name: string) => server().post('/auth/login').send({ identifier: name, password: seedPassword });
  const second = (mfaToken: string, code: string) => server().post('/auth/login/2fa').send({ mfaToken, code });

  /** Enrol through the API; returns the secret and recovery codes. */
  async function enroll(name: string) {
    const token = await tokenFor(name);
    const setup = await server().post('/auth/2fa/setup').set(bearer(token)).expect(201);
    const secret = setup.body.secret as string;
    const enabled = await server().post('/auth/2fa/enable').set(bearer(token)).send({ code: totpCode(secret, currentStep()) }).expect(201);
    return { secret, recoveryCodes: enabled.body.recoveryCodes as string[] };
  }

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
    delete process.env.ADMIN_MFA_REQUIRED;
  });

  beforeEach(async () => {
    delete process.env.ADMIN_MFA_REQUIRED;
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "SecurityEvent", "UserRecoveryCode", "UserTotp", "LedgerEntry", "AuditLog", "RefreshToken", "UserPasswordVault", "Wallet", "User" CASCADE',
    );
    await redis.client.flushdb();
    const hash = await argon2.hash(seedPassword);
    for (const [name, role] of [['boss', Role.SUPER_ADMIN], ['admin1', Role.ADMIN], ['admin2', Role.ADMIN], ['player', Role.USER]] as const) {
      const user = await prisma.user.create({
        data: { username: name, email: uniqueTestEmail(`mfa-${name}`), passwordHash: hash, role, wallet: { create: {} } },
      });
      ids[name] = user.id;
    }
  });

  it('stores the secret encrypted, and refuses a player', async () => {
    const { secret } = await enroll('admin1');
    const row = await prisma.userTotp.findUniqueOrThrow({ where: { userId: ids.admin1 } });
    expect(row.enabledAt).not.toBeNull();
    expect(JSON.stringify(row)).not.toContain(secret);
    await server().post('/auth/2fa/setup').set(bearer(await tokenFor('player'))).expect(403);
    expect(await prisma.userRecoveryCode.count({ where: { userId: ids.admin1 } })).toBe(10);
  });

  it('rejects a wrong enrolment code and does not turn two-factor on', async () => {
    const token = await tokenFor('admin1');
    const setup = await server().post('/auth/2fa/setup').set(bearer(token)).expect(201);
    const wrong = totpCode(setup.body.secret, currentStep() + 50);
    await server().post('/auth/2fa/enable').set(bearer(token)).send({ code: wrong }).expect(400);
    expect((await server().get('/auth/2fa/status').set(bearer(token)).expect(200)).body).toEqual({ enabled: false, recoveryCodesLeft: 0 });
  });

  it('asks for a second step at login: no session until a valid code, and the challenge is not an access token', async () => {
    const { secret } = await enroll('admin1');

    const first = await login('admin1').expect(201);
    expect(first.body.mfaRequired).toBe(true);
    expect(first.body.accessToken).toBeUndefined();
    expect(first.headers['set-cookie']).toBeUndefined();

    await server().get('/auth/2fa/status').set(bearer(first.body.mfaToken)).expect(401);
    await second(first.body.mfaToken, '000000').expect(401);
    await second('not-a-real-token-not-a-real-token', '123456').expect(401);

    // The next step is inside the drift window and newer than the one used to enrol.
    const code = totpCode(secret, currentStep() + 1);
    const done = await second(first.body.mfaToken, code).expect(201);
    expect(done.body.accessToken).toEqual(expect.any(String));
    expect(done.body.user.role).toBe('ADMIN');
    expect(done.headers['set-cookie']?.[0]).toContain('refresh_token=');

    // The same code cannot be used again.
    await second(first.body.mfaToken, code).expect(401);
    expect(await prisma.auditLog.count({ where: { action: 'MFA_LOGIN_FAILED' } })).toBeGreaterThanOrEqual(2);
  });

  it('accepts each recovery code once', async () => {
    const { recoveryCodes } = await enroll('admin1');
    const challenge = (await login('admin1')).body.mfaToken as string;

    await second(challenge, recoveryCodes[0]).expect(201);
    await second(challenge, recoveryCodes[0]).expect(401);
    await second(challenge, recoveryCodes[1].toLowerCase().replace('-', ' ')).expect(201);
    expect((await prisma.userRecoveryCode.count({ where: { userId: ids.admin1, usedAt: null } }))).toBe(8);
    expect(await prisma.auditLog.count({ where: { action: 'MFA_RECOVERY_USED' } })).toBe(2);
  });

  it('locks the second step after repeated wrong codes', async () => {
    await enroll('admin1');
    const challenge = (await login('admin1')).body.mfaToken as string;
    for (let attempt = 0; attempt < 5; attempt += 1) await second(challenge, '111111').expect(401);
    await second(challenge, '111111').expect(429);
  });

  it('with ADMIN_MFA_REQUIRED an administrator without two-factor cannot use admin routes, but can still enrol', async () => {
    process.env.ADMIN_MFA_REQUIRED = 'true';
    const token = await tokenFor('admin1');
    const refused = await server().get('/admin/users').set(bearer(token)).expect(403);
    expect(JSON.stringify(refused.body)).toContain('MFA');
    await server().get('/auth/2fa/status').set(bearer(token)).expect(200);

    await server().post('/auth/2fa/setup').set(bearer(token)).then(async (setup) => {
      await server().post('/auth/2fa/enable').set(bearer(token)).send({ code: totpCode(setup.body.secret, currentStep()) }).expect(201);
    });
    await server().get('/admin/users').set(bearer(token)).expect(200);
    // A player is unaffected.
    await server().get('/users/me').set(bearer(await tokenFor('player'))).expect(200);
  });

  it('lets only a SUPER_ADMIN reset another administrator, and never themselves', async () => {
    await enroll('admin1');
    const boss = await tokenFor('boss');
    const reset = (token: string, id: string) => server().post(`/admin/users/${id}/mfa/reset`).set(bearer(token));

    await reset(await tokenFor('admin2'), ids.admin1).expect(403);
    await reset(boss, ids.boss).expect(403);
    await reset(boss, ids.admin1).expect(201);

    expect(await prisma.userTotp.count({ where: { userId: ids.admin1 } })).toBe(0);
    expect(await prisma.userRecoveryCode.count({ where: { userId: ids.admin1 } })).toBe(0);
    expect((await login('admin1').expect(201)).body.accessToken).toEqual(expect.any(String));
    expect(await prisma.auditLog.count({ where: { action: 'MFA_RESET' } })).toBe(1);
  });
});
