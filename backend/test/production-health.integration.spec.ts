import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { RedisService } from '../src/common/redis.service';
import { PrismaService } from '../src/prisma.service';
import { SportsService } from '../src/sports/sports.service';

describe('production health probes (PostgreSQL + Redis)', () => {
  let app: INestApplication;
  let redis: RedisService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    redis = app.get(RedisService);
    await redis.ensureConnected();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('reports liveness without touching any dependency', async () => {
    const response = await request(app.getHttpServer()).get('/health/live').expect(200);

    expect(response.body.status).toBe('ok');
    expect(response.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('reports readiness once PostgreSQL and Redis both answer', async () => {
    const response = await request(app.getHttpServer()).get('/health/ready').expect(200);

    expect(response.body).toEqual({
      status: 'ok',
      checks: { database: true, redis: true },
    });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('carries a correlation ID on every probe and echoes a supplied one', async () => {
    const generated = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const supplied = await request(app.getHttpServer())
      .get('/health/live')
      .set('x-request-id', 'deploy-check-42')
      .expect(200);
    expect(supplied.headers['x-request-id']).toBe('deploy-check-42');
  });

  it('stays ready while the external odds provider is failing', async () => {
    // Readiness governs whether this instance receives traffic at all. A broken
    // third-party feed degrades the sportsbook alone, so it must not pull the
    // casino, wallet, and auth routes out of the load balancer with it.
    const sports = app.get(SportsService);
    const getSports = jest
      .spyOn(sports, 'getSports')
      .mockRejectedValue(new Error('odds provider unavailable'));

    try {
      await expect(sports.getSports()).rejects.toThrow('odds provider unavailable');

      const response = await request(app.getHttpServer()).get('/health/ready').expect(200);
      expect(response.body.status).toBe('ok');
    } finally {
      getSports.mockRestore();
    }
  });

  it('reports unavailable when a dependency cannot answer', async () => {
    const prisma = app.get(PrismaService);
    const query = jest
      .spyOn(prisma, '$queryRaw')
      .mockRejectedValue(new Error('database unreachable'));

    try {
      const response = await request(app.getHttpServer()).get('/health/ready').expect(503);
      expect(response.body).toEqual({
        status: 'unavailable',
        checks: { database: false, redis: true },
      });
    } finally {
      query.mockRestore();
    }
  });
});
