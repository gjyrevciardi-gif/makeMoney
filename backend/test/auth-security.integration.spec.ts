import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma.service';
import { RATE_LIMITS, RateLimitService } from '../src/common/rate-limit.service';
import { uniqueTestEmail } from './test-identity';

describe('authentication and authorization security', () => {
  const prisma = new PrismaService();
  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  const auth = new AuthService(prisma, jwt);
  let app: INestApplication;
  const userEmail = uniqueTestEmail('user-security');
  const adminEmail = uniqueTestEmail('admin-security');
  let userId: string;
  let adminId: string;

  async function createApp() {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const nest = module.createNestApplication();
    nest.use(cookieParser());
    nest.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await nest.init();
    return nest;
  }
  const rawCookie = (response: request.Response) => {
    const header = response.headers['set-cookie'] as unknown as string[];
    return header[0].split(';')[0];
  };

  beforeAll(async () => { await prisma.$connect(); app = await createApp(); });
  afterAll(async () => { if (app) await app.close(); await prisma.$disconnect(); });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "LedgerEntry", "BetLeg", "Bet", "AuditLog", "RefreshToken", "Wallet", "User" CASCADE');
    const user = await auth.register(userEmail, 'correct-horse-battery'); userId = user.id;
    const admin = await prisma.user.create({ data: { email: adminEmail, passwordHash: await import('argon2').then(a => a.hash('correct-horse-battery')), role: 'ADMIN', wallet: { create: {} } } }); adminId = admin.id;
  });

  it('runs login → refresh → reuse detection, hashes tokens, and revokes the family', async () => {
    const login = await request(app.getHttpServer()).post('/auth/login').send({ email: userEmail, password: 'correct-horse-battery' }).expect(201);
    expect(login.body.accessToken).toBeTruthy();
    expect(login.body.refreshToken).toBeUndefined();
    expect(login.headers['set-cookie'][0]).toEqual(expect.stringContaining('Path=/auth'));
    expect(login.headers['set-cookie'][0]).toEqual(expect.stringContaining('HttpOnly'));
    const original = rawCookie(login);
    const refresh = await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', original).expect(201);
    const rotated = rawCookie(refresh);
    expect(refresh.body.accessToken).toBeTruthy();
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', original).expect(403);
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', rotated).expect(403);
    const records = await prisma.refreshToken.findMany();
    expect(records.every(r => r.revokedAt !== null)).toBe(true);
    expect(records.every(r => r.tokenHash.length === 64)).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'REFRESH_REUSE_DETECTED' } })).toBeGreaterThanOrEqual(1);
    const auditJson = JSON.stringify(await prisma.auditLog.findMany());
    expect(auditJson).not.toContain(original.split('=')[1]);
    expect(auditJson).not.toContain(rotated.split('=')[1]);
  });

  it('rejects an expired refresh token', async () => {
    const pair = await auth.issueTokenPair(userId, 'USER');
    await prisma.refreshToken.updateMany({ data: { expiresAt: new Date(0) } });
    await expect(auth.rotateRefreshToken(pair.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('makes logout idempotent with a token, twice, and without a cookie', async () => {
    const pair = await auth.issueTokenPair(userId, 'USER');
    await auth.revokeFamily(pair.refreshToken); await auth.revokeFamily(pair.refreshToken); await auth.revokeFamily();
    await request(app.getHttpServer()).post('/auth/logout').expect(201);
  });

  it('denies USER admin access and records permission denial', async () => {
    const token = (await auth.login(userEmail, 'correct-horse-battery')).pair.accessToken;
    await request(app.getHttpServer()).get('/admin/users').set('Authorization', `Bearer ${token}`).expect(403);
    await request(app.getHttpServer()).post(`/admin/users/${userId}/coins`).set('Authorization', `Bearer ${token}`).send({ amount: 10, reason: 'forbidden', idempotencyKey: '7545247e-6c63-4231-b9a0-5e35df184abb' }).expect(403);
    expect(await prisma.auditLog.count({ where: { actorId: userId, action: 'PERMISSION_DENIED' } })).toBe(2);
    expect(await prisma.ledgerEntry.count()).toBe(0);
  });

  it('rejects a demoted ADMIN using an old access token', async () => {
    const token = (await auth.login(adminEmail, 'correct-horse-battery')).pair.accessToken;
    await prisma.user.update({ where: { id: adminId }, data: { role: 'USER' } });
    await request(app.getHttpServer()).post(`/admin/users/${userId}/coins`).set('Authorization', `Bearer ${token}`).send({ amount: 1, reason: 'x', idempotencyKey: '8d16eabf-68eb-47e8-8beb-9b24ac31ff01' }).expect(403);
  });

  it('does not expose another user bet and bounds pagination', async () => {
    const token = (await auth.login(userEmail, 'correct-horse-battery')).pair.accessToken;
    const bet = await prisma.bet.create({ data: { userId: adminId, stake: 1, potentialPayout: 1, idempotencyKey: 'private-bet' } });
    await request(app.getHttpServer()).get(`/bets/${bet.id}`).set('Authorization', `Bearer ${token}`).expect(404);
    await request(app.getHttpServer()).get('/wallet/me/ledger?limit=1000000').set('Authorization', `Bearer ${token}`).expect(400);
  });

  it('allows ADMIN list access without leaking password or token hashes', async () => {
    const token = (await auth.login(adminEmail, 'correct-horse-battery')).pair.accessToken;
    const response = await request(app.getHttpServer()).get('/admin/users').set('Authorization', `Bearer ${token}`).expect(200);
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|tokenHash|refreshToken/);
  });

  it('uses Redis for temporary login throttling and isolates authenticated user quotas', async () => {
    for (let attempt = 0; attempt < RATE_LIMITS.loginFailures.limit; attempt++) await request(app.getHttpServer()).post('/auth/login').send({ email: 'nobody@example.test', password: 'incorrect-password' }).expect(401);
    await request(app.getHttpServer()).post('/auth/login').send({ email: 'nobody@example.test', password: 'incorrect-password' }).expect(429);
    const limiter = app.get(RateLimitService);
    for (let attempt = 0; attempt < RATE_LIMITS.bet.limit; attempt++) await limiter.consume('bet-test', userId, RATE_LIMITS.bet);
    await expect(limiter.consume('bet-test', userId, RATE_LIMITS.bet)).rejects.toMatchObject({ status: 429 });
    await expect(limiter.consume('bet-test', adminId, RATE_LIMITS.bet)).resolves.toBeUndefined();
  });

  it('rejects client-supplied identity and payout fields', async () => {
    const token = (await auth.login(userEmail, 'correct-horse-battery')).pair.accessToken;
    await request(app.getHttpServer()).post('/bets').set('Authorization', `Bearer ${token}`).send({ stake: 1, idempotencyKey: '9ce265c4-9080-48be-bb5b-2f38c520f99c', userId: adminId, payout: 999999 }).expect(400);
  });
});