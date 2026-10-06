import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { AuthorizationService } from '../src/auth/authorization.service';
import { BigIntInterceptor } from '../src/common/bigint.interceptor';
import { RedisService } from '../src/common/redis.service';
import { PrismaService } from '../src/prisma.service';
import { PointsService } from '../src/wallet/points.service';
import { uniqueTestEmail } from './test-identity';

/**
 * P0 closure: administrative PTS security, the exact last-SUPER_ADMIN outcomes
 * (including that a refused change leaves nothing partially applied), and the
 * effect of the database re-check on a disabled account. Requires an isolated
 * *_test PostgreSQL database and Redis.
 */
describe('P0: PTS ledger security, SUPER_ADMIN protection, disabled accounts (PostgreSQL + Redis)', () => {
  jest.setTimeout(120_000);

  const prisma = new PrismaService();
  let app: INestApplication;
  let auth: AuthService;
  let authorization: AuthorizationService;
  let points: PointsService;
  let redis: RedisService;

  const password = 'correct-horse-battery';
  const mails: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const server = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const tokenFor = async (name: string) => (await auth.login(mails[name], password)).pair.accessToken;
  const sumLedger = async (userId: string) => {
    const rows = await prisma.ledgerEntry.findMany({ where: { wallet: { userId } } });
    return rows.reduce((total, row) => total + row.amount, 0n);
  };
  const walletOf = async (userId: string) => (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance;
  const grant = (token: string, userId: string, amount: number, key: string, reason = 'p0 grant') =>
    server().post(`/admin/users/${userId}/coins`).set(bearer(token)).send({ amount, reason, idempotencyKey: key });
  const remove = (token: string, userId: string, amount: number, key: string, reason = 'p0 remove') =>
    server().post(`/admin/users/${userId}/coins/remove`).set(bearer(token)).send({ amount, reason, idempotencyKey: key });

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
    authorization = app.get(AuthorizationService);
    points = app.get(PointsService);
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
      '"Bet", "AuditLog", "RefreshToken", "Wallet", "User" CASCADE',
    );
    await redis.client.flushdb();
    const hash = await argon2.hash(password);
    const specs: [string, Role][] = [
      ['user', Role.USER], ['user2', Role.USER], ['admin', Role.ADMIN], ['admin2', Role.ADMIN],
      ['super', Role.SUPER_ADMIN], ['super2', Role.SUPER_ADMIN],
    ];
    for (const [name, role] of specs) {
      mails[name] = uniqueTestEmail(`p0-${name}`);
      const user = await prisma.user.create({
        data: { email: mails[name], passwordHash: hash, role, wallet: { create: {} } },
      });
      ids[name] = user.id;
    }
  });

  it('refuses USER for administrative PTS on both grant and remove, with no ledger movement', async () => {
    const token = await tokenFor('user');
    await grant(token, ids.user2, 100, randomUUID()).expect(403);
    await remove(token, ids.user2, 1, randomUUID()).expect(403);
    expect(await prisma.ledgerEntry.count()).toBe(0);
    expect(await walletOf(ids.user2)).toBe(0n);
  });

  it.each([['admin'], ['super']])('lets %s adjust a USER: immutable ledger rows, actor identity, balance == ledger sum', async (actor) => {
    const token = await tokenFor(actor);
    const grantKey = randomUUID();
    const removeKey = randomUUID();
    const credited = await grant(token, ids.user, 500, grantKey, 'seed funds').expect(201);
    const debited = await remove(token, ids.user, 120, removeKey, 'correction').expect(201);
    expect(credited.body.ledgerEntryId).toBeDefined();
    expect(debited.body.ledgerEntryId).toBeDefined();

    const entries = await prisma.ledgerEntry.findMany({ where: { wallet: { userId: ids.user } }, orderBy: { createdAt: 'asc' } });
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => [entry.type, entry.amount])).toEqual([['ADMIN_GRANT', 500n], ['ADMIN_REMOVE', -120n]]);
    // Acting administrator is recorded on every ledger row and audit row.
    expect(entries.every((entry) => entry.actorId === ids[actor])).toBe(true);
    expect(entries.map((entry) => entry.reason)).toEqual(['seed funds', 'correction']);
    const audits = await prisma.auditLog.findMany({ where: { action: { in: ['ADMIN_COIN_GRANT', 'ADMIN_COIN_REMOVE'] } } });
    expect(audits).toHaveLength(2);
    expect(audits.every((row) => row.actorId === ids[actor] && row.targetId === ids.user)).toBe(true);

    // The balance is exactly what the ledger says; there is no other writer.
    expect(await walletOf(ids.user)).toBe(380n);
    expect(await sumLedger(ids.user)).toBe(380n);

    // The ledger is append-only at the database level.
    await expect(prisma.$executeRawUnsafe(`UPDATE "LedgerEntry" SET reason = 'tampered' WHERE id = '${entries[0].id}'`))
      .rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE id = '${entries[0].id}'`))
      .rejects.toThrow(/append-only/);
    expect(await sumLedger(ids.user)).toBe(380n);
  });

  it('replays the same grant once, and rejects the same key with changed amount, reason or target', async () => {
    const adminId = ids.admin;
    const key = randomUUID();
    const first = await points.adminGrant(adminId, ids.user, 250n, 'replay', key);
    const again = await points.adminGrant(adminId, ids.user, 250n, 'replay', key);
    expect(again).toMatchObject({ ledgerEntryId: first.ledgerEntryId, duplicate: true });
    expect(await prisma.ledgerEntry.count()).toBe(1);
    expect(await walletOf(ids.user)).toBe(250n);

    await expect(points.adminGrant(adminId, ids.user, 251n, 'replay', key)).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });
    await expect(points.adminGrant(adminId, ids.user, 250n, 'different reason', key)).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });
    await expect(points.adminGrant(adminId, ids.user2, 250n, 'replay', key)).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });
    // A removal cannot reuse a grant's key either.
    await expect(points.adminRemove(adminId, ids.user, 250n, 'replay', key)).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });
    // None of the refused attempts moved anything.
    expect(await prisma.ledgerEntry.count()).toBe(1);
    expect(await walletOf(ids.user)).toBe(250n);
    expect(await walletOf(ids.user2)).toBe(0n);
  });

  it('refuses ADMIN PTS adjustments aimed at ADMIN or SUPER_ADMIN, on grant and remove', async () => {
    const token = await tokenFor('admin');
    for (const target of ['admin2', 'super']) {
      await grant(token, ids[target], 100, randomUUID()).expect(403);
      await remove(token, ids[target], 1, randomUUID()).expect(403);
    }
    expect(await prisma.ledgerEntry.count()).toBe(0);
    expect(await walletOf(ids.admin2)).toBe(0n);
    expect(await walletOf(ids.super)).toBe(0n);
  });

  it('refuses ADMIN any change to a SUPER_ADMIN (demote, disable) and leaves the account untouched', async () => {
    const token = await tokenFor('admin');
    const before = await prisma.user.findUniqueOrThrow({ where: { id: ids.super } });
    await server().post(`/admin/users/${ids.super}/role`).set(bearer(token)).send({ role: Role.USER }).expect(403);
    await server().post(`/admin/users/${ids.super}/role`).set(bearer(token)).send({ role: Role.ADMIN }).expect(403);
    await server().post(`/admin/users/${ids.super}/status`).set(bearer(token)).send({ disabled: true }).expect(403);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: ids.super } });
    expect([after.role, after.disabled]).toEqual([before.role, before.disabled]);
    expect(await prisma.auditLog.count({ where: { action: { in: ['ADMIN_ROLE_GRANTED', 'ADMIN_ROLE_REVOKED', 'ADMIN_USER_STATUS_CHANGED'] } } })).toBe(0);
  });

  it('refuses to remove the last active SUPER_ADMIN and leaves role, status and audit trail unchanged', async () => {
    // Only one ACTIVE SUPER_ADMIN: super2 exists but is disabled.
    await prisma.user.update({ where: { id: ids.super2 }, data: { disabled: true } });
    const auditBefore = await prisma.auditLog.count({ where: { action: { in: ['ADMIN_ROLE_GRANTED', 'ADMIN_ROLE_REVOKED', 'ADMIN_USER_STATUS_CHANGED'] } } });

    await expect(authorization.changeRole(ids.super, ids.super, Role.ADMIN))
      .rejects.toMatchObject({ response: { code: 'LAST_SUPER_ADMIN_REQUIRED' } });
    await expect(authorization.setDisabled(ids.super, ids.super, true))
      .rejects.toMatchObject({ response: { code: 'SELF_DISABLE_FORBIDDEN' } });
    // Re-enabling the other account is the only way to change the invariant, and
    // it is not blocked by it.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: ids.super } });
    expect([after.role, after.disabled]).toEqual([Role.SUPER_ADMIN, false]);
    expect(await prisma.user.count({ where: { role: Role.SUPER_ADMIN, disabled: false } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: { in: ['ADMIN_ROLE_GRANTED', 'ADMIN_ROLE_REVOKED', 'ADMIN_USER_STATUS_CHANGED'] } } })).toBe(auditBefore);
  });

  it('serialises concurrent mutual demotions and mutual disables: exactly one wins, exactly one SUPER_ADMIN stays active', async () => {
    const demotions = await Promise.allSettled([
      authorization.changeRole(ids.super, ids.super2, Role.ADMIN),
      authorization.changeRole(ids.super2, ids.super, Role.ADMIN),
    ]);
    expect(demotions.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect(demotions.filter((entry) => entry.status === 'rejected')).toHaveLength(1);
    expect(await prisma.user.count({ where: { role: Role.SUPER_ADMIN, disabled: false } })).toBe(1);
    // Exactly one demotion was applied and audited; the refused one left no trace.
    expect(await prisma.auditLog.count({ where: { action: 'ADMIN_ROLE_REVOKED' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'ADMIN_ROLE_GRANTED' } })).toBe(0);

    // Restore two SUPER_ADMINs, then race two mutual disables.
    await prisma.user.updateMany({ where: { id: { in: [ids.super, ids.super2] } }, data: { role: Role.SUPER_ADMIN, disabled: false } });
    const disables = await Promise.allSettled([
      authorization.setDisabled(ids.super, ids.super2, true),
      authorization.setDisabled(ids.super2, ids.super, true),
    ]);
    expect(disables.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect(disables.filter((entry) => entry.status === 'rejected')).toHaveLength(1);
    expect(await prisma.user.count({ where: { role: Role.SUPER_ADMIN, disabled: false } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'ADMIN_USER_STATUS_CHANGED' } })).toBe(1);
  });

  it('stops a disabled account at every guarded API immediately, using the database status rather than the token', async () => {
    const adminToken = await tokenFor('admin');
    await server().get('/admin/casino/math').set(bearer(adminToken)).expect(200);
    await prisma.user.update({ where: { id: ids.admin }, data: { disabled: true } });
    await server().get('/admin/casino/math').set(bearer(adminToken)).expect(403);
    await server().post('/casino/lucky-lady/launch').set(bearer(adminToken)).expect(403);
    await grant(adminToken, ids.user, 10, randomUUID()).expect(403);
    expect(await prisma.ledgerEntry.count()).toBe(0);

    const playerToken = await tokenFor('user');
    await server().post('/casino/lucky-lady/launch').set(bearer(playerToken)).expect(201);
    await prisma.user.update({ where: { id: ids.user }, data: { disabled: true } });
    await server().post('/casino/lucky-lady/launch').set(bearer(playerToken)).expect(403);
  });
});
