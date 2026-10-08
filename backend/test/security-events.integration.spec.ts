import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { BigIntInterceptor } from '../src/common/bigint.interceptor';
import { RedisService } from '../src/common/redis.service';
import { PrismaService } from '../src/prisma.service';
import { recordWinIfLarge } from '../src/security/security-events';
import { uniqueTestEmail } from './test-identity';

/**
 * Per-administrator ownership of players, and the security notifications written with every PTS
 * movement and large win. Requires an isolated *_test PostgreSQL database and Redis.
 */
describe('player ownership and security notifications (PostgreSQL + Redis)', () => {
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
  const grant = (token: string, userId: string, amount: number, key = randomUUID()) =>
    server().post(`/admin/users/${userId}/coins`).set(bearer(token)).send({ amount, reason: 'cash in ref 1', idempotencyKey: key });
  const remove = (token: string, userId: string, amount: number) =>
    server().post(`/admin/users/${userId}/coins/remove`).set(bearer(token)).send({ amount, reason: 'cash out ref 2', idempotencyKey: randomUUID() });
  const events = (token: string) => server().get('/admin/security/events').set(bearer(token));

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
      'TRUNCATE TABLE "SecurityEvent", "CasinoTransaction", "CasinoRoundAction", "CasinoRound", "LedgerEntry", ' +
      '"BetLeg", "Bet", "AuditLog", "RefreshToken", "UserPasswordVault", "Wallet", "User" CASCADE',
    );
    await redis.client.flushdb();
    const hash = await argon2.hash(seedPassword);
    // boss: SUPER_ADMIN. admin1/admin2: ADMIN. plr1 belongs to admin1, plr2 to admin2, legacy has no owner.
    const specs: [string, Role, string | null][] = [
      ['boss', Role.SUPER_ADMIN, null],
      ['admin1', Role.ADMIN, 'boss'],
      ['admin2', Role.ADMIN, 'boss'],
      ['plr1', Role.USER, 'admin1'],
      ['plr2', Role.USER, 'admin2'],
      ['legacy', Role.USER, null],
    ];
    for (const [name, role, owner] of specs) {
      const user = await prisma.user.create({
        data: {
          username: name,
          email: uniqueTestEmail(`sec-${name}`),
          passwordHash: hash,
          role,
          createdById: owner ? ids[owner] : null,
          wallet: { create: {} },
        },
      });
      ids[name] = user.id;
    }
  });

  it('lets an ADMIN manage only the players they own', async () => {
    const admin1 = await tokenFor('admin1');
    await grant(admin1, ids.plr1, 50).expect(201);

    // Another administrator's player and an ownerless player: refused, and nothing changes.
    await grant(admin1, ids.plr2, 50).expect(403);
    await grant(admin1, ids.legacy, 50).expect(403);
    await remove(admin1, ids.plr2, 1).expect(403);
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: ids.plr2 } })).balance).toBe(0n);

    // Not even visible: lists and reads answer as not found.
    const list = await server().get('/admin/users').set(bearer(admin1)).expect(200);
    expect(list.body.map((u: { username: string }) => u.username)).toEqual(['plr1']);
    await server().get(`/admin/users/${ids.plr2}/detail`).set(bearer(admin1)).expect(404);
    await server().get(`/admin/users/${ids.plr2}/ledger`).set(bearer(admin1)).expect(404);
    await server().post(`/admin/users/${ids.plr2}/password/reveal`).set(bearer(admin1)).expect(404);
    await server().post(`/admin/users/${ids.plr2}/password`).set(bearer(admin1)).send({ password: 'new-password-1' }).expect(404);
    await server().post(`/admin/users/${ids.plr2}/status`).set(bearer(admin1)).send({ disabled: true }).expect(403);

    // A SUPER_ADMIN reaches everyone.
    const boss = await tokenFor('boss');
    const all = await server().get('/admin/users').set(bearer(boss)).expect(200);
    expect(all.body.length).toBe(6);
    await grant(boss, ids.plr2, 10).expect(201);
  });

  it('writes a notification with who, to whom, how much and the balance after, for every grant and removal', async () => {
    const admin1 = await tokenFor('admin1');
    await grant(admin1, ids.plr1, 80).expect(201);
    await remove(admin1, ids.plr1, 30).expect(201);

    const rows = await prisma.securityEvent.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => [r.type, r.severity, r.amount, r.balanceAfter])).toEqual([
      ['PTS_GRANTED', 'INFO', 80n, 80n],
      ['PTS_REMOVED', 'WARNING', 30n, 50n],
    ]);
    for (const row of rows) {
      expect(row.actorId).toBe(ids.admin1);
      expect(row.subjectUserId).toBe(ids.plr1);
      expect(row.ownerAdminId).toBe(ids.admin1);
      expect(row.reason).toMatch(/ref/);
    }
  });

  it('does not write a second notification for a replayed request or a refused one', async () => {
    const admin1 = await tokenFor('admin1');
    const key = randomUUID();
    await grant(admin1, ids.plr1, 40, key).expect(201);
    await grant(admin1, ids.plr1, 40, key).expect(201);
    await grant(admin1, ids.plr2, 40).expect(403);
    await remove(admin1, ids.plr1, 9_999).expect(409);
    expect(await prisma.securityEvent.count()).toBe(1);
  });

  it('raises a notification for a single win of 100 or more, an alert from 200, and nothing below', async () => {
    for (const amount of [99n, 100n, 199n, 200n, 5_000n]) {
      await prisma.$transaction((tx) =>
        recordWinIfLarge(tx, { userId: ids.plr1, amount, balanceAfter: amount, refType: 'CASINO_ROUND', refId: `round-${amount}` }),
      );
    }
    const rows = await prisma.securityEvent.findMany({ orderBy: { amount: 'asc' } });
    expect(rows.map((r) => [r.amount, r.type, r.severity])).toEqual([
      [100n, 'BIG_WIN', 'WARNING'],
      [199n, 'BIG_WIN', 'WARNING'],
      [200n, 'HUGE_WIN', 'ALERT'],
      [5_000n, 'HUGE_WIN', 'ALERT'],
    ]);
    expect(rows[0].actorId).toBeNull();
    expect(rows[0].ownerAdminId).toBe(ids.admin1);
  });

  it('shows each ADMIN only the events about their players, and a SUPER_ADMIN everything', async () => {
    const boss = await tokenFor('boss');
    const admin1 = await tokenFor('admin1');
    const admin2 = await tokenFor('admin2');
    await grant(admin1, ids.plr1, 60).expect(201);
    await grant(admin2, ids.plr2, 70).expect(201);

    const own = await events(admin1).expect(200);
    expect(own.body.unread).toBe(1);
    expect(own.body.items).toHaveLength(1);
    expect(own.body.items[0]).toMatchObject({ type: 'PTS_GRANTED', subject: { username: 'plr1' }, actor: { username: 'admin1' } });

    const all = await events(boss).expect(200);
    expect(all.body.items).toHaveLength(2);
    expect(all.body.unread).toBe(2);

    // A player cannot read the page at all.
    await events(await tokenFor('plr1')).expect(403);
  });

  it('lets an ADMIN acknowledge only their own events, once', async () => {
    const admin1 = await tokenFor('admin1');
    const admin2 = await tokenFor('admin2');
    await grant(admin1, ids.plr1, 60).expect(201);
    const [event] = await prisma.securityEvent.findMany();

    await server().post(`/admin/security/events/${event.id}/acknowledge`).set(bearer(admin2)).expect(404);
    await server().post(`/admin/security/events/${event.id}/acknowledge`).set(bearer(admin1)).expect(201);
    await server().post(`/admin/security/events/${event.id}/acknowledge`).set(bearer(admin1)).expect(404);

    expect((await events(admin1)).body.unread).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'SECURITY_EVENT_ACKNOWLEDGED' } })).toBe(1);
  });

  it('lets a user change their own password, signs them out, and notifies the owning administrator without the password', async () => {
    const change = (token: string, currentPassword: string, newPassword: string) =>
      server().post('/users/me/password').set(bearer(token)).send({ currentPassword, newPassword });
    const player = await tokenFor('plr1');
    await auth.login('plr1', seedPassword); // a second session

    await change(player, 'wrong-password-1', 'brand-new-pass-1').expect(400);
    await change(player, seedPassword, seedPassword).expect(400);
    await change(player, seedPassword, 'short').expect(400);
    await change(player, seedPassword, 'brand-new-pass-1').expect(201);

    // Old password gone, new one works, every session revoked, and the vault follows.
    await expect(auth.login('plr1', seedPassword)).rejects.toBeDefined();
    await auth.login('plr1', 'brand-new-pass-1');
    expect(await prisma.refreshToken.count({ where: { userId: ids.plr1, revokedAt: null } })).toBe(1);

    const event = await prisma.securityEvent.findFirstOrThrow({ where: { type: 'PASSWORD_CHANGED' } });
    expect(event).toMatchObject({ subjectUserId: ids.plr1, actorId: ids.plr1, ownerAdminId: ids.admin1, severity: 'WARNING' });
    expect(JSON.stringify(event, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))).not.toContain('brand-new-pass-1');
    expect(JSON.stringify(await prisma.auditLog.findMany({ where: { action: 'PASSWORD_CHANGED' } }))).not.toContain('brand-new-pass-1');

    // The owner sees it; another administrator does not.
    expect((await events(await tokenFor('admin1'))).body.items.map((e: { type: string }) => e.type)).toContain('PASSWORD_CHANGED');
    expect((await events(await tokenFor('admin2'))).body.items).toHaveLength(0);
    // Without a session there is nothing to change.
    await server().post('/users/me/password').send({ currentPassword: 'x', newPassword: 'brand-new-pass-2' }).expect(401);
  });

  it('throttles repeated wrong current passwords', async () => {
    const token = await tokenFor('plr1');
    const attempt = () => server().post('/users/me/password').set(bearer(token)).send({ currentPassword: 'wrong-password-1', newPassword: 'brand-new-pass-1' });
    for (let index = 0; index < 5; index += 1) await attempt().expect(400);
    await attempt().expect(429);
  });

  it('lets only a SUPER_ADMIN reassign a player, and the new owner then gets access and the events', async () => {
    const boss = await tokenFor('boss');
    const admin1 = await tokenFor('admin1');
    const admin2 = await tokenFor('admin2');
    const assign = (token: string, userId: string, ownerId: string) =>
      server().post(`/admin/users/${userId}/owner`).set(bearer(token)).send({ ownerId });

    await assign(admin1, ids.plr1, ids.admin2).expect(403);
    await assign(boss, ids.plr1, ids.plr2).expect(400);
    await assign(boss, ids.admin2, ids.admin1).expect(400);

    await assign(boss, ids.legacy, ids.admin2).expect(201);
    await grant(admin2, ids.legacy, 5).expect(201);

    await assign(boss, ids.plr1, ids.admin2).expect(201);
    await grant(admin1, ids.plr1, 5).expect(403);
    await grant(admin2, ids.plr1, 5).expect(201);
    const last = await prisma.securityEvent.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    expect(last.ownerAdminId).toBe(ids.admin2);
    expect(await prisma.auditLog.count({ where: { action: 'USER_OWNER_CHANGED' } })).toBe(2);
  });
});
