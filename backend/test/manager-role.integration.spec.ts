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
import { uniqueTestEmail } from './test-identity';

/**
 * The MANAGER role: an administrator creates and controls managers; a manager runs only their own
 * players with points an administrator gave them, and can create none. Requires an isolated *_test
 * PostgreSQL database and Redis.
 */
describe('manager role and point transfers (PostgreSQL + Redis)', () => {
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
  const balanceOf = async (name: string) => (await prisma.wallet.findUniqueOrThrow({ where: { userId: ids[name] } })).balance;
  const grant = (token: string, name: string, amount: number) =>
    server().post(`/admin/users/${ids[name]}/coins`).set(bearer(token)).send({ amount, reason: 'cash in ref 1', idempotencyKey: randomUUID() });
  const give = (token: string, name: string, amount: number, key = randomUUID()) =>
    server().post(`/admin/users/${ids[name]}/coins/give`).set(bearer(token)).send({ amount, reason: 'cash in ref 7', idempotencyKey: key });
  const take = (token: string, name: string, amount: number) =>
    server().post(`/admin/users/${ids[name]}/coins/take`).set(bearer(token)).send({ amount, reason: 'cash out ref 8', idempotencyKey: randomUUID() });

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
      '"AuditLog", "RefreshToken", "UserPasswordVault", "Wallet", "User" CASCADE',
    );
    await redis.client.flushdb();
    const hash = await argon2.hash(seedPassword);
    // boss > adminA > mgr1 > plr1 ; adminA > plrA ; boss > adminB > mgr2 > plr2 ; legacy has no owner.
    const specs: [string, Role, string | null][] = [
      ['boss', Role.SUPER_ADMIN, null],
      ['adminA', Role.ADMIN, 'boss'],
      ['adminB', Role.ADMIN, 'boss'],
      ['mgr1', Role.MANAGER, 'adminA'],
      ['mgr2', Role.MANAGER, 'adminB'],
      ['plr1', Role.USER, 'mgr1'],
      ['plr2', Role.USER, 'mgr2'],
      ['plrA', Role.USER, 'adminA'],
      ['legacy', Role.USER, null],
    ];
    for (const [name, role, owner] of specs) {
      const user = await prisma.user.create({
        data: { username: name.toLowerCase(), email: uniqueTestEmail(`mgr-${name}`), passwordHash: hash, role, createdById: owner ? ids[owner] : null, wallet: { create: {} } },
      });
      ids[name] = user.id;
    }
  });

  it('lets an administrator create managers, but not a manager create managers or administrators', async () => {
    const create = (token: string, body: Record<string, unknown>) => server().post('/admin/users').set(bearer(token)).send(body);
    const adminA = await tokenFor('adminA');
    const made = await create(adminA, { username: 'newmgr', role: 'MANAGER' }).expect(201);
    expect(made.body.role).toBe('MANAGER');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: made.body.id } })).createdById).toBe(ids.adminA);

    const mgr1 = await tokenFor('mgr1');
    await create(mgr1, { username: 'sneaky', role: 'MANAGER' }).expect(403);
    await create(mgr1, { username: 'sneaky2', role: 'ADMIN' }).expect(403);
    const player = await create(mgr1, { username: 'freshplayer' }).expect(201);
    expect(player.body.role).toBe('USER');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: player.body.id } })).createdById).toBe(ids.mgr1);
  });

  it('shows each level only its own part of the tree', async () => {
    const names = async (token: string) =>
      ((await server().get('/admin/users').set(bearer(token)).expect(200)).body as { username: string }[]).map((u) => u.username).sort();

    expect(await names(await tokenFor('adminA'))).toEqual(['mgr1', 'plr1', 'plra']);
    expect(await names(await tokenFor('adminB'))).toEqual(['mgr2', 'plr2']);
    expect(await names(await tokenFor('mgr1'))).toEqual(['plr1']);
    expect((await names(await tokenFor('boss'))).length).toBe(9);

    const mgr1 = await tokenFor('mgr1');
    await server().get(`/admin/users/${ids.plr2}/detail`).set(bearer(mgr1)).expect(404);
    await server().get(`/admin/users/${ids.plrA}/detail`).set(bearer(mgr1)).expect(404);
    await server().get(`/admin/users/${ids.plr1}/detail`).set(bearer(mgr1)).expect(200);
    await server().get(`/admin/users/${ids.mgr2}/detail`).set(bearer(await tokenFor('adminA'))).expect(404);
  });

  it('lets an administrator control a manager and the manager\'s players, and nobody else', async () => {
    const adminA = await tokenFor('adminA');
    const adminB = await tokenFor('adminB');
    const mgr1 = await tokenFor('mgr1');
    await server().post(`/admin/users/${ids.mgr1}/password`).set(bearer(adminA)).send({ password: 'manager-pass-1' }).expect(201);
    expect((await server().post(`/admin/users/${ids.mgr1}/password/reveal`).set(bearer(adminA)).expect(201)).body.password).toBe('manager-pass-1');
    await server().post(`/admin/users/${ids.plr1}/password`).set(bearer(adminA)).send({ password: 'player-pass-1' }).expect(201);
    await server().post(`/admin/users/${ids.mgr1}/password`).set(bearer(adminB)).send({ password: 'hostile-pass-1' }).expect(404);
    await server().post(`/admin/users/${ids.mgr1}/status`).set(bearer(adminB)).send({ disabled: true }).expect(403);

    // A manager cannot touch the administrator above them.
    await server().post(`/admin/users/${ids.adminA}/password`).set(bearer(mgr1)).send({ password: 'hostile-pass-2' }).expect(404);

    // An administrator promotes their own player to manager, but cannot make an administrator.
    await server().post(`/admin/users/${ids.plrA}/role`).set(bearer(adminA)).send({ role: 'MANAGER' }).expect(201);
    await server().post(`/admin/users/${ids.plrA}/role`).set(bearer(adminA)).send({ role: 'ADMIN' }).expect(403);
  });

  it('never lets a manager create or destroy points directly', async () => {
    const mgr1 = await tokenFor('mgr1');
    await grant(mgr1, 'plr1', 100).expect(403);
    await server().post(`/admin/users/${ids.plr1}/coins/remove`).set(bearer(mgr1)).send({ amount: 1, reason: 'x', idempotencyKey: randomUUID() }).expect(403);
    await server().get('/admin/audit').set(bearer(mgr1)).expect(403);
    expect(await balanceOf('plr1')).toBe(0n);
    // A player cannot use the transfer routes either.
    await give(await tokenFor('plr1'), 'plr1', 1).expect(403);
  });

  it('moves only points the manager holds: give, take back, no overdraw, and the total never changes', async () => {
    const adminA = await tokenFor('adminA');
    const mgr1 = await tokenFor('mgr1');

    // With nothing in the manager's wallet there is nothing to give.
    await give(mgr1, 'plr1', 10).expect(409);
    await grant(adminA, 'mgr1', 500).expect(201);

    await give(mgr1, 'plr1', 200).expect(201);
    expect([await balanceOf('mgr1'), await balanceOf('plr1')]).toEqual([300n, 200n]);
    await give(mgr1, 'plr1', 400).expect(409);
    expect([await balanceOf('mgr1'), await balanceOf('plr1')]).toEqual([300n, 200n]);

    await take(mgr1, 'plr1', 50).expect(201);
    expect([await balanceOf('mgr1'), await balanceOf('plr1')]).toEqual([350n, 150n]);
    await take(mgr1, 'plr1', 151).expect(409);

    const entries = await prisma.ledgerEntry.findMany({ where: { type: { in: ['TRANSFER_IN', 'TRANSFER_OUT'] } }, orderBy: { createdAt: 'asc' } });
    expect(entries.map((e) => [e.type, e.amount])).toEqual([
      ['TRANSFER_OUT', -200n], ['TRANSFER_IN', 200n], ['TRANSFER_OUT', -50n], ['TRANSFER_IN', 50n],
    ]);
    expect(entries.every((e) => e.actorId === ids.mgr1)).toBe(true);
    expect(entries.reduce((sum, e) => sum + e.amount, 0n)).toBe(0n);

    // Every wallet still equals its own ledger.
    for (const name of ['mgr1', 'plr1']) {
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: ids[name] } });
      const sum = await prisma.ledgerEntry.aggregate({ where: { walletId: wallet.id }, _sum: { amount: true } });
      expect(sum._sum.amount).toBe(wallet.balance);
    }
  });

  it('replays one transfer exactly once and rejects a changed replay', async () => {
    await grant(await tokenFor('adminA'), 'mgr1', 300).expect(201);
    const mgr1 = await tokenFor('mgr1');
    const key = randomUUID();
    await give(mgr1, 'plr1', 100, key).expect(201);
    await give(mgr1, 'plr1', 100, key).expect(201);
    await give(mgr1, 'plr1', 250, key).expect(409);
    expect([await balanceOf('mgr1'), await balanceOf('plr1')]).toEqual([200n, 100n]);
    expect(await prisma.ledgerEntry.count({ where: { type: 'TRANSFER_OUT' } })).toBe(1);
  });

  it('refuses a transfer to anyone who is not the manager\'s own player', async () => {
    await grant(await tokenFor('adminA'), 'mgr1', 300).expect(201);
    const mgr1 = await tokenFor('mgr1');
    for (const other of ['plr2', 'plrA', 'legacy', 'mgr2', 'adminA', 'boss']) {
      await give(mgr1, other, 5).expect(403);
    }
    expect(await balanceOf('mgr1')).toBe(300n);
    expect(await prisma.ledgerEntry.count({ where: { type: { in: ['TRANSFER_IN', 'TRANSFER_OUT'] } } })).toBe(0);
  });

  it('keeps concurrent transfers from overdrawing the manager', async () => {
    await grant(await tokenFor('adminA'), 'mgr1', 100).expect(201);
    const mgr1 = await tokenFor('mgr1');
    const results = await Promise.all(Array.from({ length: 6 }, () => give(mgr1, 'plr1', 40)));
    const accepted = results.filter((r) => r.status === 201).length;
    expect(accepted).toBeLessThanOrEqual(2);
    const [manager, player] = [await balanceOf('mgr1'), await balanceOf('plr1')];
    expect(manager + player).toBe(100n);
    expect(manager >= 0n).toBe(true);
  });

  it('notifies the manager and the administrator above them, and no other administrator', async () => {
    const adminA = await tokenFor('adminA');
    const mgr1 = await tokenFor('mgr1');
    await grant(adminA, 'mgr1', 300).expect(201);
    await give(mgr1, 'plr1', 120).expect(201);
    await take(mgr1, 'plr1', 20).expect(201);

    const types = async (token: string) =>
      ((await server().get('/admin/security/events').set(bearer(token)).expect(200)).body.items as { type: string }[]).map((e) => e.type).sort();
    expect(await types(adminA)).toEqual(['PTS_GRANTED', 'PTS_RECLAIMED', 'PTS_TRANSFERRED']);
    expect(await types(mgr1)).toEqual(['PTS_RECLAIMED', 'PTS_TRANSFERRED']);
    expect(await types(await tokenFor('adminB'))).toEqual([]);
    expect((await types(await tokenFor('boss'))).length).toBe(3);

    const event = await prisma.securityEvent.findFirstOrThrow({ where: { type: 'PTS_TRANSFERRED' } });
    expect(event).toMatchObject({ actorId: ids.mgr1, subjectUserId: ids.plr1, ownerAdminId: ids.mgr1, topOwnerId: ids.adminA, amount: 120n, balanceAfter: 120n });
  });

  it('lets the database refuse a transfer entry with no actor or the wrong sign', async () => {
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: ids.plr1 } });
    await expect(prisma.ledgerEntry.create({ data: { walletId: wallet.id, type: 'TRANSFER_IN', amount: 5n, reason: 'x', idempotencyKey: 'raw-1:in' } })).rejects.toBeDefined();
    await expect(prisma.ledgerEntry.create({ data: { walletId: wallet.id, type: 'TRANSFER_IN', amount: -5n, reason: 'x', actorId: ids.mgr1, idempotencyKey: 'raw-2:in' } })).rejects.toBeDefined();
  });
});
