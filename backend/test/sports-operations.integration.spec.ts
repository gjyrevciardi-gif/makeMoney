import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { RedisService } from '../src/common/redis.service';
import { SportsOperationsService } from '../src/operations/sports-operations.service';
import { PrismaService } from '../src/prisma.service';
import {
  NormalizedEventResult,
  SPORTS_RESULT_PROVIDER,
  SportsResultProvider,
} from '../src/settlement/result-provider';
import { SettlementService } from '../src/settlement/settlement.service';
import { SettlementWorker } from '../src/settlement/settlement.worker';
import { uniqueTestEmail } from './test-identity';

describe('sportsbook operational monitoring and reconciliation (PostgreSQL + Redis)', () => {
  const prisma = new PrismaService();
  const provider: jest.Mocked<SportsResultProvider> = { getEventResult: jest.fn() };
  let app: INestApplication;
  let auth: AuthService;
  let operations: SportsOperationsService;
  let settlement: SettlementService;
  let worker: SettlementWorker;
  let redis: RedisService;
  const userEmail = uniqueTestEmail('operations-user');
  const adminEmail = uniqueTestEmail('operations-admin');
  let userId: string;
  let adminId: string;

  async function createApp() {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SPORTS_RESULT_PROVIDER)
      .useValue(provider)
      .compile();
    const nest = module.createNestApplication();
    nest.use(cookieParser());
    nest.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await nest.init();
    return nest;
  }

  async function accessToken(email: string) {
    return (await auth.login(email, 'correct-horse-battery')).pair.accessToken;
  }

  async function createOpenBet(options: {
    eventId: string;
    eventStartTime?: Date;
    marketKey?: string;
    selectionKey?: string;
    odds?: string;
  }) {
    const odds = options.odds ?? '2';
    return prisma.bet.create({
      data: {
        userId,
        stake: 100,
        type: 'SINGLE',
        totalOdds: odds,
        potentialPayout: 200,
        idempotencyKey: `operations:${options.eventId}`,
        legs: {
          create: {
            provider: 'fixture',
            providerEventId: options.eventId,
            sportKey: 'soccer',
            homeTeam: 'Home',
            awayTeam: 'Away',
            eventStartTime:
              options.eventStartTime ?? new Date(Date.now() - 2 * 60 * 60_000),
            marketKey: options.marketKey ?? 'h2h',
            marketName: options.marketKey ?? 'h2h',
            selectionKey: options.selectionKey ?? 'home',
            selectionName: options.selectionKey ?? 'Home',
            acceptedOdds: odds,
          },
        },
      },
      include: { legs: true },
    });
  }

  const finalResult = (
    eventId: string,
    homeScore = 2,
    awayScore = 0,
  ): NormalizedEventResult => ({
    provider: 'fixture',
    providerEventId: eventId,
    status: 'FINAL',
    homeScore,
    awayScore,
    completedAt: new Date(),
  });

  beforeAll(async () => {
    process.env.SPORTS_STALE_BET_AFTER_MINUTES = '60';
    process.env.SPORTS_SETTLEMENT_ENABLED = 'false';
    await prisma.$connect();
    app = await createApp();
    auth = app.get(AuthService);
    operations = app.get(SportsOperationsService);
    settlement = app.get(SettlementService);
    worker = app.get(SettlementWorker);
    redis = app.get(RedisService);
    await redis.ensureConnected();
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
    delete process.env.SPORTS_STALE_BET_AFTER_MINUTES;
    delete process.env.SPORTS_SETTLEMENT_ENABLED;
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "SportsResultConflict", "SportsSettlementAttempt", "SportsEventResult", "LedgerEntry", "BetLeg", "Bet", "AuditLog", "RefreshToken", "Wallet", "User" CASCADE',
    );
    await redis.client.flushdb();
    jest.clearAllMocks();
    const user = await prisma.user.create({
      data: {
        email: userEmail,
        passwordHash: await argon2.hash('correct-horse-battery'),
        wallet: { create: { balance: 900 } },
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: await argon2.hash('correct-horse-battery'),
        role: 'ADMIN',
        wallet: { create: {} },
      },
    });
    userId = user.id;
    adminId = admin.id;
  });

  it('reports only sufficiently old OPEN bets as stale without mutating domain or wallet state', async () => {
    const stale = await createOpenBet({ eventId: 'stale-event' });
    const future = await createOpenBet({
      eventId: 'future-event',
      eventStartTime: new Date(Date.now() + 2 * 60 * 60_000),
    });
    const token = await accessToken(adminEmail);
    const before = await prisma.wallet.findUniqueOrThrow({ where: { userId } });

    const response = await request(app.getHttpServer())
      .get('/admin/sports/bets/stale?limit=25')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const serialized = JSON.stringify(response.body);
    expect(serialized).toContain(stale.id);
    expect(serialized).toContain('stale-event');
    expect(serialized).not.toContain(future.id);
    expect(serialized).not.toContain('future-event');
    expect(serialized).toMatch(
      /WAITING_FOR_FINAL_RESULT|NO_RESULT_RETURNED|NOT_YET_PROCESSED/,
    );
    expect((await prisma.bet.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe(
      'OPEN',
    );
    expect((await prisma.bet.findUniqueOrThrow({ where: { id: future.id } })).status).toBe(
      'OPEN',
    );
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance).toBe(
      before.balance,
    );
    expect(await prisma.ledgerEntry.count()).toBe(0);
  });

  it('makes a provider failure visible while preserving the OPEN bet and wallet', async () => {
    const bet = await createOpenBet({ eventId: 'failed-provider-event' });
    provider.getEventResult.mockRejectedValue(new Error('provider temporarily unavailable'));
    const before = await prisma.wallet.findUniqueOrThrow({ where: { userId } });

    await worker.runScheduledCycle();

    const storedAttempt = await prisma.sportsSettlementAttempt.findFirst({
      where: { providerEventId: 'failed-provider-event' },
      orderBy: { createdAt: 'desc' },
    });
    expect(storedAttempt).toMatchObject({ status: 'FAILED' });
    expect((await prisma.bet.findUniqueOrThrow({ where: { id: bet.id } })).status).toBe(
      'OPEN',
    );
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance).toBe(
      before.balance,
    );
    expect(await prisma.ledgerEntry.count()).toBe(0);

    const token = await accessToken(adminEmail);
    const failures = await request(app.getHttpServer())
      .get('/admin/sports/settlement/failures?limit=25')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(JSON.stringify(failures.body)).toContain('failed-provider-event');
  });

  it('runs repeated authoritative event reconciliation through exactly-once settlement', async () => {
    const bet = await createOpenBet({ eventId: 'reconcile-win' });
    provider.getEventResult.mockResolvedValue(finalResult('reconcile-win'));
    const token = await accessToken(adminEmail);

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app.getHttpServer())
          .post('/admin/sports/events/fixture/reconcile-win/reconcile')
          .set('Authorization', `Bearer ${token}`),
      ),
    );
    expect(responses.every((response) => response.status === 201)).toBe(true);

    const stored = await prisma.bet.findUniqueOrThrow({ where: { id: bet.id } });
    expect(stored.status).toBe('WON');
    expect(stored.actualPayout).toBe(200n);
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance).toBe(
      1100n,
    );
    expect(
      await prisma.ledgerEntry.count({
        where: { relatedBetId: bet.id, type: 'SPORTS_WIN' },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          actorId: adminId,
          action: 'ADMIN_EVENT_RECONCILIATION_REQUESTED',
        },
      }),
    ).toBe(10);
  });

  it('refunds a repeatedly reconciled cancelled event exactly once', async () => {
    const bet = await createOpenBet({ eventId: 'reconcile-void' });
    provider.getEventResult.mockResolvedValue({
      provider: 'fixture',
      providerEventId: 'reconcile-void',
      status: 'CANCELLED',
    });
    const token = await accessToken(adminEmail);

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app.getHttpServer())
          .post('/admin/sports/events/fixture/reconcile-void/reconcile')
          .set('Authorization', `Bearer ${token}`),
      ),
    );
    expect(responses.every((response) => response.status === 201)).toBe(true);

    expect((await prisma.bet.findUniqueOrThrow({ where: { id: bet.id } })).status).toBe(
      'VOID',
    );
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance).toBe(
      1000n,
    );
    expect(
      await prisma.ledgerEntry.count({
        where: { relatedBetId: bet.id, type: 'BET_VOID_REFUND' },
      }),
    ).toBe(1);
  });

  it('denies reconciliation to USER at both controller and service boundaries', async () => {
    await createOpenBet({ eventId: 'forbidden-reconcile' });
    provider.getEventResult.mockResolvedValue(finalResult('forbidden-reconcile'));
    const token = await accessToken(userEmail);

    await request(app.getHttpServer())
      .post('/admin/sports/events/fixture/forbidden-reconcile/reconcile')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    await expect(
      operations.reconcile(userId, 'fixture', 'forbidden-reconcile'),
    ).rejects.toMatchObject({ status: 403 });

    expect(provider.getEventResult).not.toHaveBeenCalled();
    expect((await prisma.bet.findFirstOrThrow()).status).toBe('OPEN');
    expect(await prisma.ledgerEntry.count()).toBe(0);
  });

  it('rejects a provider result whose identity does not match the requested event', async () => {
    const bet = await createOpenBet({ eventId: 'expected-event' });
    provider.getEventResult.mockResolvedValue(finalResult('different-event'));
    const token = await accessToken(adminEmail);

    const response = await request(app.getHttpServer())
      .post('/admin/sports/events/fixture/expected-event/reconcile')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect((await prisma.bet.findUniqueOrThrow({ where: { id: bet.id } })).status).toBe(
      'OPEN',
    );
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance).toBe(
      900n,
    );
    expect(await prisma.sportsEventResult.count()).toBe(0);
    expect(await prisma.ledgerEntry.count()).toBe(0);
  });

  it('persists result conflicts for admin visibility without reversing a payout', async () => {
    const bet = await createOpenBet({ eventId: 'conflicted-event' });
    await settlement.ingest(finalResult('conflicted-event', 2, 0));
    const balanceAfterWin = (
      await prisma.wallet.findUniqueOrThrow({ where: { userId } })
    ).balance;

    await settlement.ingest(finalResult('conflicted-event', 0, 2));

    expect((await prisma.bet.findUniqueOrThrow({ where: { id: bet.id } })).status).toBe(
      'WON',
    );
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance).toBe(
      balanceAfterWin,
    );
    expect(
      await prisma.ledgerEntry.count({ where: { relatedBetId: bet.id } }),
    ).toBe(1);
    expect(
      await prisma.sportsResultConflict.count({
        where: { provider: 'fixture', providerEventId: 'conflicted-event' },
      }),
    ).toBe(1);

    const token = await accessToken(adminEmail);
    const conflicts = await request(app.getHttpServer())
      .get('/admin/sports/conflicts?limit=25')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const serialized = JSON.stringify(conflicts.body);
    expect(serialized).toContain('conflicted-event');
    expect(serialized).toContain(bet.id);
  });

  it('allows only one worker instance to scan while a shared Redis lock is held', async () => {
    await createOpenBet({ eventId: 'worker-lock-event' });
    let providerStarted!: () => void;
    let releaseProvider!: () => void;
    const started = new Promise<void>((resolve) => (providerStarted = resolve));
    const release = new Promise<void>((resolve) => (releaseProvider = resolve));
    provider.getEventResult.mockImplementation(async () => {
      providerStarted();
      await release;
      return null;
    });

    const secondApp = await createApp();
    try {
      const secondWorker = secondApp.get(SettlementWorker);
      const firstCycle = worker.runScheduledCycle();
      await started;
      const secondCycle = secondWorker.runScheduledCycle();
      releaseProvider();
      const outcomes = await Promise.all([firstCycle, secondCycle]);

      expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([
        'SKIPPED_LOCKED',
        'SUCCESS',
      ]);
      expect(provider.getEventResult).toHaveBeenCalledTimes(1);
    } finally {
      releaseProvider();
      await secondApp.close();
    }
  });

  it('protects and sanitizes provider/worker operational status', async () => {
    const userToken = await accessToken(userEmail);
    await request(app.getHttpServer())
      .get('/admin/sports/providers/status')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);

    const adminToken = await accessToken(adminEmail);
    const response = await request(app.getHttpServer())
      .get('/admin/sports/providers/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const serialized = JSON.stringify(response.body);
    expect(serialized).toContain('settlementWorker');
    for (const secret of [
      process.env.THE_ODDS_API_KEY,
      process.env.DATABASE_URL,
      process.env.REDIS_URL,
      process.env.JWT_ACCESS_SECRET,
    ].filter((value): value is string => Boolean(value))) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toMatch(
      /THE_ODDS_API_KEY|DATABASE_URL|REDIS_URL|JWT_ACCESS_SECRET|passwordHash|tokenHash/,
    );
  });

  it('serves the dashboard overview to an administrator only', async () => {
    await request(app.getHttpServer()).get('/admin/sports/overview').expect(401);

    const userToken = await accessToken(userEmail);
    await request(app.getHttpServer())
      .get('/admin/sports/overview')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
    // The service re-checks the persisted role, so the guard is not the only gate.
    await expect(operations.overview(userId)).rejects.toMatchObject({ status: 403 });

    const adminToken = await accessToken(adminEmail);
    const response = await request(app.getHttpServer())
      .get('/admin/sports/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // The dashboard reads exactly these nine keys. A missing one renders its
    // card blank instead of as a number, which is how this endpoint's absence
    // went unnoticed in the first place.
    expect(Object.keys(response.body).sort()).toEqual([
      'eventsAwaitingResult',
      'lossesLast24h',
      'openBets',
      'resultConflicts',
      'settledLast24h',
      'settlementFailuresLast24h',
      'staleOpenBets',
      'voidsLast24h',
      'winsLast24h',
    ]);
    for (const value of Object.values(response.body)) expect(typeof value).toBe('number');
  });

  it('counts open, stale, settled and failed sportsbook work from authoritative rows', async () => {
    // The stale threshold is 60 minutes here and the helper starts events two
    // hours ago, so this one is stale and the future-dated one is merely open.
    await createOpenBet({ eventId: 'overview-stale' });
    await createOpenBet({
      eventId: 'overview-fresh',
      eventStartTime: new Date(Date.now() + 60 * 60_000),
    });

    const settle = async (eventId: string, status: 'WON' | 'LOST' | 'VOID', settledAt: Date) => {
      const bet = await createOpenBet({ eventId });
      await prisma.bet.update({ where: { id: bet.id }, data: { status, settledAt } });
    };
    await settle('overview-won', 'WON', new Date());
    await settle('overview-lost', 'LOST', new Date());
    await settle('overview-void', 'VOID', new Date());
    // Outside the 24 hour window the cards describe.
    await settle('overview-old', 'WON', new Date(Date.now() - 30 * 60 * 60_000));

    const attempt = (status: 'FAILED' | 'SUCCESS', resolvedAt: Date | null) =>
      prisma.sportsSettlementAttempt.create({
        data: {
          provider: 'fixture',
          providerEventId: 'overview-stale',
          attemptType: 'SETTLEMENT',
          status,
          startedAt: new Date(),
          resolvedAt,
        },
      });
    await attempt('FAILED', null);
    // Already dealt with, so it is no longer outstanding.
    await attempt('FAILED', new Date());
    await attempt('SUCCESS', null);

    await prisma.sportsResultConflict.create({
      data: { provider: 'fixture', providerEventId: 'overview-stale', storedResult: {}, conflictingResult: {} },
    });
    await prisma.sportsResultConflict.create({
      data: {
        provider: 'fixture',
        providerEventId: 'overview-fresh',
        storedResult: {},
        conflictingResult: {},
        acknowledgedAt: new Date(),
      },
    });

    // One of the two open events already has a terminal result, so it is
    // waiting on settlement rather than on the provider.
    await prisma.sportsEventResult.create({
      data: { provider: 'fixture', providerEventId: 'overview-stale', status: 'FINAL', homeScore: 1, awayScore: 0 },
    });

    const adminToken = await accessToken(adminEmail);
    const response = await request(app.getHttpServer())
      .get('/admin/sports/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body).toEqual({
      openBets: 2,
      staleOpenBets: 1,
      settledLast24h: 3,
      winsLast24h: 1,
      lossesLast24h: 1,
      voidsLast24h: 1,
      settlementFailuresLast24h: 1,
      resultConflicts: 1,
      eventsAwaitingResult: 1,
    });
  });

  it('answers without touching the odds provider, so an outage cannot blank the dashboard', async () => {
    provider.getEventResult.mockRejectedValue(new Error('provider unavailable'));
    const adminToken = await accessToken(adminEmail);

    const response = await request(app.getHttpServer())
      .get('/admin/sports/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(provider.getEventResult).not.toHaveBeenCalled();
    expect(response.body.openBets).toBe(0);
    expect(response.body.eventsAwaitingResult).toBe(0);
  });
});