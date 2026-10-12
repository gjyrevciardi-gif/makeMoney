import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { RedisService } from '../src/common/redis.service';
import { PrismaService } from '../src/prisma.service';
import { uniqueTestEmail } from './test-identity';

/**
 * Browser-origin contract for the auth mutations. A cross-site page cannot read
 * an httpOnly refresh cookie, so the cookie itself is not the only defence: the
 * request's `Origin` must be one the API was configured to serve.
 *
 * Requires an isolated *_test PostgreSQL database and Redis.
 */
describe('auth mutation origin enforcement (PostgreSQL + Redis)', () => {
  jest.setTimeout(120_000);

  const ORIGIN = 'http://localhost:3000';
  const prisma = new PrismaService();
  let app: INestApplication;
  let auth: AuthService;
  let redis: RedisService;
  let email: string;
  const password = 'correct-horse-battery';
  const server = () => request(app.getHttpServer());
  const refreshCookieOf = (response: request.Response) => {
    const raw = ([] as string[]).concat(response.headers['set-cookie'] ?? []).find((value) => value.startsWith('refresh_token='));
    return raw ? raw.split(';')[0] : '';
  };
  const login = (origin?: string) => {
    const call = server().post('/auth/login').send({ email, password });
    return origin === undefined ? call : call.set('Origin', origin);
  };

  beforeAll(async () => {
    process.env.SPORTS_SETTLEMENT_ENABLED = 'false';
    process.env.CORS_ORIGINS = ORIGIN;
    await prisma.$connect();
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    auth = app.get(AuthService);
    redis = app.get(RedisService);
    await redis.ensureConnected();
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
    delete process.env.SPORTS_SETTLEMENT_ENABLED;
    delete process.env.CORS_ORIGINS;
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "SecurityEvent", "UserRecoveryCode", "UserTotp", "LedgerEntry", "AuditLog", "RefreshToken", "UserPasswordVault", "Wallet", "User" CASCADE',
    );
    await redis.client.flushdb();
    email = uniqueTestEmail('origin');
    await auth.register(email, password);
  });

  it('permits a login from an allowed origin', async () => {
    const response = await login(ORIGIN).expect(201);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(refreshCookieOf(response)).not.toBe('');
  });

  it('permits a login with no Origin (non-browser client)', async () => {
    await login().expect(201);
  });

  it('rejects a present but unlisted Origin, including a same-site sibling', async () => {
    for (const origin of ['https://evil.example', 'http://localhost:3001', 'null']) {
      const refused = await login(origin).expect(403);
      expect(refused.body).toMatchObject({ code: 'CSRF_ORIGIN_REJECTED' });
      expect(refreshCookieOf(refused)).toBe('');
    }
    expect(await prisma.refreshToken.count()).toBe(0);
  });

  it('applies the same check to logout and registration', async () => {
    await server().post('/auth/logout').set('Cookie', 'refresh_token=whatever').set('Origin', 'https://evil.example').expect(403);
    await server()
      .post('/auth/register')
      .set('Origin', 'https://evil.example')
      .send({ email: uniqueTestEmail('origin-register'), password })
      .expect(403);
  });

  it('permits refresh only from an allowed origin when it carries the cookie', async () => {
    const cookie = refreshCookieOf(await login(ORIGIN).expect(201));
    await server().post('/auth/refresh').set('Cookie', cookie).set('Origin', 'https://evil.example').expect(403);
    // The refused request never rotated, so the original cookie is still usable.
    const rotated = await server().post('/auth/refresh').set('Cookie', cookie).set('Origin', ORIGIN).expect(201);
    expect(rotated.body.accessToken).toEqual(expect.any(String));
  });

  it('in production requires a trusted Origin for cookie-bearing refresh and logout', async () => {
    const cookie = refreshCookieOf(await login(ORIGIN).expect(201));
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const refresh = await server().post('/auth/refresh').set('Cookie', cookie).expect(403);
      expect(refresh.body).toMatchObject({ code: 'CSRF_ORIGIN_REQUIRED' });
      const logout = await server().post('/auth/logout').set('Cookie', cookie).expect(403);
      expect(logout.body).toMatchObject({ code: 'CSRF_ORIGIN_REQUIRED' });
      // An untrusted Origin is refused the same way.
      await server().post('/auth/refresh').set('Cookie', cookie).set('Origin', 'https://evil.example').expect(403);
      // With the trusted Origin the rotation still works.
      await server().post('/auth/refresh').set('Cookie', cookie).set('Origin', ORIGIN).expect(201);
      // A non-cookie client may still omit the header (no cookie to abuse).
      await server().post('/auth/logout').expect(201);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
});
