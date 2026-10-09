import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma.service';
import { PointsService } from '../src/wallet/points.service';
import { JwtService } from '@nestjs/jwt';
import { uniqueTestEmail } from './test-identity';

describe('zero-start virtual point rules (PostgreSQL integration)', () => {
  const prisma = new PrismaService();
  const auth = new AuthService(prisma, new JwtService({ secret: 'integration-test-secret-not-for-production' }));
  const points = new PointsService(prisma);
  const userEmail = uniqueTestEmail('user');
  const adminEmail = uniqueTestEmail('admin');
  let userId: string;
  let adminId: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    // TRUNCATE is test-database teardown; production ledger rows reject UPDATE/DELETE.
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "LedgerEntry", "BetLeg", "Bet", "AuditLog", "RefreshToken", "Wallet", "User" CASCADE');
    const user = await auth.register(userEmail, 'correct-horse-battery');
    userId = user.id;
    const admin = await prisma.user.create({ data: { email: adminEmail, passwordHash: 'operator-created', role: 'ADMIN', wallet: { create: {} } } });
    adminId = admin.id;
    await prisma.user.updateMany({ where: { role: 'USER' }, data: { createdById: admin.id } });
  });

  it('creates a new account with an exact zero balance and no positive ledger entry', async () => {
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId }, include: { entries: true } });
    expect(wallet.balance).toBe(0n);
    expect(wallet.entries).toEqual([]);
  });

  it('registering twice never creates points', async () => {
    await expect(auth.register(userEmail, 'correct-horse-battery')).rejects.toBeDefined();
    expect(await prisma.ledgerEntry.count()).toBe(0);
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance).toBe(0n);
  });

  it('does not allow a USER to grant points to themselves', async () => {
    await expect(points.adminGrant(userId, userId, 10_000n, 'self grant', 'self-grant-key')).rejects.toBeInstanceOf(ForbiddenException);
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance).toBe(0n);
  });

  it('rejects a sports bet at zero with INSUFFICIENT_VIRTUAL_BALANCE', async () => {
    await expect(points.placeSportsBet(userId, 1n, 2n, 'zero-bet-key')).rejects.toMatchObject({ message: 'INSUFFICIENT_VIRTUAL_BALANCE' });
    expect(await prisma.bet.count({ where: { userId } })).toBe(0);
  });

  it('applies and audits an ADMIN grant exactly once', async () => {
    await points.adminGrant(adminId, userId, 10_000n, 'Tournament allocation', 'grant-key');
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance).toBe(10_000n);
    expect(await prisma.ledgerEntry.count({ where: { wallet: { userId }, type: 'ADMIN_GRANT' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { actorId: adminId, action: 'ADMIN_COIN_GRANT' } })).toBe(1);
  });

  it('does not duplicate points for a repeated admin-grant idempotency key', async () => {
    await points.adminGrant(adminId, userId, 10_000n, 'Tournament allocation', 'same-grant-key');
    const repeated = await points.adminGrant(adminId, userId, 10_000n, 'Tournament allocation', 'same-grant-key');
    expect(repeated.duplicate).toBe(true);
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance).toBe(10_000n);
  });

  it('credits the calculated sportsbook payout exactly once', async () => {
    await points.adminGrant(adminId, userId, 100n, 'Test stake', 'stake-grant');
    const bet = await points.placeSportsBet(userId, 100n, 250n, 'winning-bet');
    await points.settleSportsWin(bet.id, 'settle-winning-bet');
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance).toBe(250n);
    expect(await prisma.ledgerEntry.count({ where: { relatedBetId: bet.id, type: 'SPORTS_WIN' } })).toBe(1);
  });

  it('does not duplicate winnings when settlement is retried', async () => {
    await points.adminGrant(adminId, userId, 100n, 'Test stake', 'retry-stake-grant');
    const bet = await points.placeSportsBet(userId, 100n, 250n, 'retry-winning-bet');
    await points.settleSportsWin(bet.id, 'same-settlement-key');
    const retried = await points.settleSportsWin(bet.id, 'same-settlement-key');
    expect(retried.duplicate).toBe(true);
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance).toBe(250n);
    expect(await prisma.ledgerEntry.count({ where: { relatedBetId: bet.id, type: 'SPORTS_WIN' } })).toBe(1);
  });
});