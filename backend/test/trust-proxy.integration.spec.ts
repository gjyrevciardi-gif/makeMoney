import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { parseTrustProxyAllowlist } from '../src/common/environment';
import { RATE_LIMITS } from '../src/common/rate-limit.service';
import { RedisService } from '../src/common/redis.service';
import { PrismaService } from '../src/prisma.service';

/**
 * The rate limiter keys on the client IP, which comes from `req.ip`. When the
 * proxy is trusted that value is `X-Forwarded-For`; the whole point of naming
 * the proxy peers is that a client connecting directly cannot forge the header
 * and hand itself a fresh budget.
 *
 * Requires an isolated *_test PostgreSQL database and Redis.
 */
describe('trusted proxy and rate-limit identity (PostgreSQL + Redis)', () => {
  jest.setTimeout(120_000);

  const prisma = new PrismaService();
  let app: INestApplication;
  let redis: RedisService;
  const server = () => request(app.getHttpServer());
  const setTrustProxy = (allowlist: string) =>
    app.getHttpAdapter().getInstance().set('trust proxy', parseTrustProxyAllowlist(allowlist));
  const attempt = (forwardedFor: string) =>
    server()
      .post('/auth/login')
      .set('X-Forwarded-For', forwardedFor)
      .send({ identifier: 'nobody@example.test', password: 'incorrect-password' });

  beforeAll(async () => {
    process.env.SPORTS_SETTLEMENT_ENABLED = 'false';
    await prisma.$connect();
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    redis = app.get(RedisService);
    await redis.ensureConnected();
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
    delete process.env.SPORTS_SETTLEMENT_ENABLED;
  });

  beforeEach(async () => {
    await redis.client.flushdb();
    setTrustProxy('10.0.0.0/8');
  });

  it('ignores X-Forwarded-For when the peer is not a trusted proxy', async () => {
    // Each request claims a different client address, but the real peer is what
    // counts: the shared budget fills and the next attempt is refused.
    for (let index = 0; index < RATE_LIMITS.loginFailures.limit; index += 1) {
      await attempt(`203.0.113.${index + 1}`).expect(401);
    }
    await attempt('203.0.113.250').expect(429);
  });

  it('believes X-Forwarded-For from the configured proxy and limits each client separately', async () => {
    setTrustProxy('127.0.0.0/8');
    // Five different claimed clients each keep their own budget.
    for (let index = 0; index < RATE_LIMITS.loginFailures.limit; index += 1) {
      await attempt(`203.0.113.${index + 1}`).expect(401);
    }
    // One client can still be throttled on its own identity...
    for (let index = 0; index < RATE_LIMITS.loginFailures.limit; index += 1) {
      await attempt('203.0.113.250').expect(401);
    }
    await attempt('203.0.113.250').expect(429);
    // ...while another client stays unaffected.
    await attempt('203.0.113.251').expect(401);
  });
});
