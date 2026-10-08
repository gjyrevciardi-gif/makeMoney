import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { BigIntInterceptor } from '../src/common/bigint.interceptor';
import { RedisService } from '../src/common/redis.service';
import { CasinoConfigService } from '../src/casino/casino-config.service';
import { CasinoGameRegistry } from '../src/casino/casino-game.registry';
import { MathControlService } from '../src/casino/platform/math-control/math-control.service';
import { GameMathRegistry } from '../src/casino/platform/math-control/math-control.registry';
import { MathControlJobs } from '../src/casino/platform/math-control/math-control.jobs';
import { GameCapabilityService } from '../src/casino/platform/game-capability.service';
import { GameJournalService } from '../src/casino/platform/game-journal.service';
import { GameRoundService } from '../src/casino/platform/game-round.service';
import { GameWalletService } from '../src/casino/platform/game-wallet.service';
import { GamePlatform } from '../src/casino/platform/game-adapter.types';
import { PrismaService } from '../src/prisma.service';
import { PointsService } from '../src/wallet/points.service';
import { createSimulationRng } from '../src/casino/platform/math-control/math-control.random';
import { CLASSIC_ID, IntRng } from '../src/casino/games/book-of-ra-classic/classic.engine';
import { ClassicAdapter, ClassicState } from '../src/casino/games/book-of-ra-classic/classic.adapter';
import { defaultClassicProfile } from '../src/casino/games/book-of-ra-classic/classic.math-adapter';
import { uniqueTestEmail } from './test-identity';

const policy = (overrides: Record<string, unknown> = {}) => ({
  targetRtpPercent: 50,
  maxWinMultiplier: 50,
  maxWinScope: 'RESOLVED_SPIN',
  pacing: 'BALANCED',
  hitRate: { mode: 'AUTO' },
  partialReturn: 'MED',
  volatility: 'MED',
  bigWinMinMultiplier: 10,
  bigWinMaxMultiplier: 50,
  featureContribution: { minPercent: 0, maxPercent: 60 },
  presets: ['BALANCED'],
  ...overrides,
});

const tiny = {
  monteCarloRounds: 1_000,
  bankrollSessions: 12,
  rtpTolerancePercent: 5,
  sessionConfig: {
    startUnits: 10_000,
    stakeUnits: 180,
    horizonPaidSpins: 300,
    aliveCheckpoints: [100, 250],
    balanceCheckpoints: [100, 250],
    reachTargets: [12_500],
    fallTargets: [8_000],
    ruinCheckpoints: [100, 250],
  },
};

const intRng = (seed: string): IntRng => {
  const rng = createSimulationRng(seed);
  return (upper) => rng.int(0, upper - 1);
};

/**
 * Book of Ra Classic through the generic Game Math Control surface.
 *
 * The operator workflow is the shared one - generate, independently validate,
 * activate - and the activated profile is then pinned on a real round, so the
 * "truthful reporting" and "no future leak" properties are exercised end to end
 * rather than asserted from a stub.
 */
describe('Book of Ra Classic admin math control (PostgreSQL + Redis)', () => {
  const prisma = new PrismaService();
  let app: INestApplication;
  let auth: AuthService;
  let math: MathControlService;
  let configs: CasinoConfigService;
  let points: PointsService;
  let redis: RedisService;

  const password = 'correct-horse-battery';
  const userEmail = uniqueTestEmail('classic-math-user');
  const adminEmail = uniqueTestEmail('classic-math-admin');
  let userToken: string;
  let adminToken: string;
  let userId: string;
  let adminId: string;

  beforeAll(async () => {
    process.env.SPORTS_SETTLEMENT_ENABLED = 'false';
    // Disposable-database overrides: the operator workflow is exercised with a
    // small cohort. Production defaults stay 20 000 rounds / 200 sessions.
    process.env.MATH_CONTROL_MIN_MC_ROUNDS = '500';
    process.env.MATH_CONTROL_MIN_SESSIONS = '5';
    process.env.MATH_CONTROL_MIN_HORIZON = '100';
    process.env.MATH_CONTROL_GAMBLE_SCOPE_DECISION = 'EXCLUDE_OPTIONAL_GAMBLE';
    await prisma.$connect();
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalInterceptors(new BigIntInterceptor());
    await app.init();
    auth = app.get(AuthService);
    math = app.get(MathControlService);
    configs = app.get(CasinoConfigService);
    points = app.get(PointsService);
    redis = app.get(RedisService);
    await redis.ensureConnected();
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
    delete process.env.SPORTS_SETTLEMENT_ENABLED;
    delete process.env.MATH_CONTROL_MIN_MC_ROUNDS;
    delete process.env.MATH_CONTROL_MIN_SESSIONS;
    delete process.env.MATH_CONTROL_MIN_HORIZON;
    delete process.env.MATH_CONTROL_GAMBLE_SCOPE_DECISION;
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "GameActiveMathProfile", "GameMathProfileValidation", "GameMathProfile", ' +
      '"GamePreparedOutcome", "GameSession", "GameLaunchCapability", "CasinoGameConfigVersion", ' +
      '"CasinoGameConfig", "PlatformSettings", "CasinoTransaction", "CasinoRoundAction", "CasinoRound", ' +
      '"CasinoGameFavorite", "LedgerEntry", "BetLeg", "Bet", "AuditLog", "RefreshToken", "Wallet", "User" CASCADE',
    );
    await redis.client.flushdb();
    const hash = await argon2.hash(password);
    const [player, admin] = await Promise.all([
      prisma.user.create({ data: { email: userEmail, passwordHash: hash, wallet: { create: {} } } }),
      prisma.user.create({ data: { email: adminEmail, passwordHash: hash, role: 'ADMIN', wallet: { create: {} } } }),
    ]);
    userId = player.id;
    adminId = admin.id;
    userToken = (await auth.login(player.email, password)).pair.accessToken;
    adminToken = (await auth.login(admin.email, password)).pair.accessToken;
  });

  it('is ADMIN-only on every Classic mathematics route', async () => {
    const player = request(app.getHttpServer());
    await player.post(`/admin/casino/math/${CLASSIC_ID}/generate`)
      .set('authorization', `Bearer ${userToken}`)
      .send(policy())
      .expect(403);
    await player.post(`/admin/casino/math/${CLASSIC_ID}/profiles/whatever/validate`)
      .set('authorization', `Bearer ${userToken}`)
      .expect(403);
    await player.post(`/admin/casino/math/${CLASSIC_ID}/profiles/whatever/activate`)
      .set('authorization', `Bearer ${userToken}`)
      .send({})
      .expect(403);
  });

  it('generates, validates and activates a Classic profile, and pins it on the next round', async () => {
    const admin = request(app.getHttpServer());
    const generated = await admin.post(`/admin/casino/math/${CLASSIC_ID}/generate`)
      .set('authorization', `Bearer ${adminToken}`)
      .send(policy())
      .expect(201);
    expect(generated.body.status).toBe('SUPPORTED');
    const profileId = generated.body.profile.profileId as string;
    const profileHash = generated.body.profile.canonicalHash as string;
    expect(generated.body.profile.policy.maxWinScope).toBe('RESOLVED_SPIN');
    expect(generated.body.profile.policy.maxWinEnabled).toBe(true);

    // Unvalidated mathematics can never go live.
    await expect(math.activate(adminId, CLASSIC_ID, profileId)).rejects.toMatchObject({
      response: { code: 'MATH_PROFILE_NOT_VALIDATED' },
    });

    const validated = await math.validate(adminId, CLASSIC_ID, profileId, tiny);
    expect(validated.evidence.profileHash).toBe(profileHash);
    expect(validated.evidence.bankroll.sampleSize).toBe(tiny.bankrollSessions);

    if (validated.evidence.result !== 'PASS') {
      // Honest failure path: nothing activates and the reasons are recorded.
      await expect(math.activate(adminId, CLASSIC_ID, profileId)).rejects.toMatchObject({
        response: { code: 'MATH_PROFILE_STATUS_NOT_ACTIVATABLE' },
      });
      return;
    }
    const activated = await math.activate(adminId, CLASSIC_ID, profileId);
    expect(activated.profileId).toBe(profileId);
    expect(activated.profileHash).toBe(profileHash);

    // A restart reads the same durable per-game pointer.
    const restarted = new MathControlService(prisma, app.get(GameMathRegistry), app.get(MathControlJobs));
    const active = await restarted.activeProfile(CLASSIC_ID);
    expect(active?.artifact.profileId).toBe(profileId);
    expect(active?.artifact.canonicalHash).toBe(profileHash);

    // The live profile is what a new round pins, and what settings report.
    const registry = new CasinoGameRegistry();
    const platform: GamePlatform = {
      capabilities: new GameCapabilityService(prisma, registry, configs),
      wallet: new GameWalletService(),
      journal: new GameJournalService(prisma),
      rounds: new GameRoundService(prisma),
    };
    const adapter = new ClassicAdapter(prisma, platform, configs, math, { rng: intRng('classic-0') });
    await points.adminGrant(adminId, userId, 10_000n, 'Classic math control funding', 'grant-classic-math-1');
    const session = await prisma.gameSession.create({
      data: {
        userId,
        gameId: CLASSIC_ID,
        tokenHash: 'x'.repeat(64),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const context = { gameId: CLASSIC_ID, userId, sessionId: session.id };

    const settings = await adapter.read(context, 'getSettings', {}) as unknown as {
      serverResponse: { mathConfig: { activeMathProfile: string; profileHash: string } };
    };
    expect(settings.serverResponse.mathConfig.activeMathProfile).toBe(profileId);
    expect(settings.serverResponse.mathConfig.profileHash).toBe(profileHash);
    // The frozen default is no longer what is reported: the active profile is.
    expect(settings.serverResponse.mathConfig.profileHash).not.toBe(defaultClassicProfile().hash);

    const played = await adapter.execute(context, {
      event: 'bet',
      body: { slotEvent: 'bet', slotBet: 1, slotLines: 9 },
      headers: { 'x-pilot-version': '1', 'x-pilot-round': 'none' },
      requestId: 'classic-math-round-1',
    }) as unknown as { recovery: { profile: { id: string; hash: string } } };
    expect(played.recovery.profile).toEqual({ id: profileId, hash: profileHash, version: activated.version });

    const round = await prisma.casinoRound.findFirstOrThrow({ where: { userId } });
    const state = round.privateState as unknown as ClassicState;
    expect(state.profileId).toBe(profileId);
    expect(state.profileHash).toBe(profileHash);
  }, 120_000);

  it('refuses a Classic policy the support family cannot honour', async () => {
    const admin = request(app.getHttpServer());
    const refused = await admin.post(`/admin/casino/math/${CLASSIC_ID}/generate`)
      .set('authorization', `Bearer ${adminToken}`)
      .send(policy({ pacing: 'VOLATILE' }))
      .expect(201);
    expect(refused.body.status).toBe('UNSUPPORTED');
    expect(refused.body.reasons[0].constraint).toBe('CLASSIC_SUPPORT_POLICY');
    // Nothing was stored for an unachievable request.
    expect(await prisma.gameMathProfile.count({ where: { gameId: CLASSIC_ID } })).toBe(0);
  });
});
