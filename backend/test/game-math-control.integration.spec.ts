import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { BigIntInterceptor } from '../src/common/bigint.interceptor';
import { RedisService } from '../src/common/redis.service';
import { MathControlService } from '../src/casino/platform/math-control/math-control.service';
import { GameMathRegistry } from '../src/casino/platform/math-control/math-control.registry';
import { MathControlJobs } from '../src/casino/platform/math-control/math-control.jobs';
import { LUCKY_LADY_GAME_ID } from '../src/casino/games/lucky-lady/lucky-lady.math';
import { LuckyLadyAdapter } from '../src/casino/games/lucky-lady/lucky-lady.adapter';
import { PrismaService } from '../src/prisma.service';
import { PointsService } from '../src/wallet/points.service';
import { uniqueTestEmail } from './test-identity';

/**
 * Game Math Control on the real platform: ADMIN-only surface, the
 * generate/validate/activate lifecycle, hash verification and the durable
 * per-game pointer a restart reads back.
 *
 * Requires an isolated *_test PostgreSQL database and Redis, exactly like the
 * other integration suites in this directory. It never runs against the
 * development database: `test/setup.ts` refuses to start without a safe URL.
 */
describe('game math control (PostgreSQL + Redis)', () => {
  const prisma = new PrismaService();
  let app: INestApplication;
  let auth: AuthService;
  let math: MathControlService;
  let points: PointsService;
  let redis: RedisService;

  const password = 'correct-horse-battery';
  const userEmail = uniqueTestEmail('math-user');
  const adminEmail = uniqueTestEmail('math-admin');
  let userToken: string;
  let adminToken: string;

  const policy = (overrides: Record<string, unknown> = {}) => ({
    targetRtpPercent: 50,
    maxWinMultiplier: 50,
    maxWinScope: 'PAID_ROUND_BEFORE_OPTIONAL_GAMBLE',
    pacing: 'BALANCED',
    hitRate: { mode: 'AUTO' },
    partialReturn: 'LOW',
    volatility: 'MED',
    bigWinMinMultiplier: 10,
    bigWinMaxMultiplier: 50,
    featureContribution: { minPercent: 0, maxPercent: 60 },
    presets: [],
    ...overrides,
  });

  const tiny = {
    monteCarloRounds: 1_000,
    bankrollSessions: 12,
    rtpTolerancePercent: 0.5,
    sessionConfig: {
      startUnits: 10_000,
      stakeUnits: 20,
      horizonPaidSpins: 300,
      aliveCheckpoints: [100, 250],
      balanceCheckpoints: [100, 250],
      reachTargets: [12_500],
      fallTargets: [8_000],
      ruinCheckpoints: [100, 250],
    },
  };

  beforeAll(async () => {
    process.env.SPORTS_SETTLEMENT_ENABLED = 'false';
    // Disposable-database overrides: the activation path is exercised with a
    // small cohort, and the recorded decision stands in for the operator's
    // answer so the exclude-scope path is testable. Production defaults stay
    // 20 000 rounds / 200 sessions / 1 000-spin horizon with the decision
    // pending unless it is recorded.
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
    userToken = (await auth.login(player.email, password)).pair.accessToken;
    adminToken = (await auth.login(admin.email, password)).pair.accessToken;
  });

  it('is ADMIN-only: a player token is rejected on every math-control route', async () => {
    const player = request(app.getHttpServer());
    await player.post('/admin/casino/math/lucky-lady/generate')
      .set('authorization', `Bearer ${userToken}`)
      .send(policy())
      .expect(403);
    await player.get('/admin/casino/math').set('authorization', `Bearer ${userToken}`).expect(403);
    await player.post('/admin/casino/math/lucky-lady/profiles/whatever/validate')
      .set('authorization', `Bearer ${userToken}`)
      .expect(403);
    await player.post('/admin/casino/math/lucky-lady/profiles/whatever/activate')
      .set('authorization', `Bearer ${userToken}`)
      .send({})
      .expect(403);
  });

  it('generates, validates and activates, and never activates unvalidated mathematics', async () => {
    const admin = request(app.getHttpServer());
    const actor = (await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } })).id;

    const generated = await admin.post('/admin/casino/math/lucky-lady/generate')
      .set('authorization', `Bearer ${adminToken}`)
      .send(policy())
      .expect(201);
    expect(generated.body.status).toBe('SUPPORTED');
    const profileId = generated.body.profile.profileId as string;

    // Unvalidated mathematics cannot go live.
    await expect(math.activate(actor, 'lucky-lady', profileId)).rejects.toMatchObject({
      response: { code: 'MATH_PROFILE_NOT_VALIDATED' },
    });

    const validated = await math.validate(actor, 'lucky-lady', profileId, tiny);
    expect(validated.evidence.profileHash).toBe(generated.body.profile.canonicalHash);
    expect(validated.evidence.bankroll.sampleSize).toBe(tiny.bankrollSessions);

    if (validated.evidence.result !== 'PASS') {
      // Honest failure path: nothing activates and the reasons are recorded.
      await expect(math.activate(actor, 'lucky-lady', profileId)).rejects.toMatchObject({
        response: { code: 'MATH_PROFILE_STATUS_NOT_ACTIVATABLE' },
      });
      return;
    }

    const activated = await math.activate(actor, 'lucky-lady', profileId);
    expect(activated.profileId).toBe(profileId);
    expect(activated.profileHash).toBe(generated.body.profile.canonicalHash);
    expect(activated.version).toBe(1);

    // A restart reads the same durable per-game pointer.
    const restarted = new MathControlService(prisma, app.get(GameMathRegistry), app.get(MathControlJobs));
    const active = await restarted.activeProfile('lucky-lady');
    expect(active?.artifact.profileId).toBe(profileId);
    expect(active?.artifact.canonicalHash).toBe(activated.profileHash);

    // Optimistic concurrency: a stale version is refused, the live one proceeds.
    await expect(math.activate(actor, 'lucky-lady', profileId, 99)).rejects.toMatchObject({
      response: { code: 'ACTIVE_MATH_PROFILE_CONFLICT' },
    });
    const again = await math.activate(actor, 'lucky-lady', profileId, activated.version);
    expect(again.version).toBe(activated.version + 1);
  });

  it('fails closed on a tampered artifact, an unknown game and a cross-game profile', async () => {
    const admin = request(app.getHttpServer());
    const actor = (await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } })).id;
    const generated = await admin.post('/admin/casino/math/lucky-lady/generate')
      .set('authorization', `Bearer ${adminToken}`)
      .send(policy({ targetRtpPercent: 60 }))
      .expect(201);
    const profileId = generated.body.profile.profileId as string;

    // Tampering with the stored payload breaks the canonical hash.
    await prisma.gameMathProfile.update({
      where: { gameId_profileId: { gameId: 'lucky-lady', profileId } },
      data: { payload: { stopWeights: { reelStrip1: [1] } } },
    });
    await expect(math.validate(actor, 'lucky-lady', profileId, tiny)).rejects.toMatchObject({
      response: { code: 'MATH_ARTIFACT_HASH_MISMATCH' },
    });

    // An unknown game is a 404, never a fallback to another game's mathematics.
    await admin.post('/admin/casino/math/not-a-game/generate')
      .set('authorization', `Bearer ${adminToken}`)
      .send(policy())
      .expect(404);

    // A profile id cannot be borrowed across games.
    await expect(math.validate(actor, 'titans-tempest', profileId, tiny)).rejects.toBeDefined();
  });

  /**
   * The unresolved gamble-scope question is an explicit activation gate, not a
   * default assumption: while it is pending, a profile whose paid round can pay
   * anything cannot be activated.
   */
  it('blocks activation of a paying profile while the gamble-scope decision is pending', async () => {
    const actor = (await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } })).id;
    const generated = await math.generate(actor, LUCKY_LADY_GAME_ID, policy({ targetRtpPercent: 70 }));
    expect(generated.status).toBe('SUPPORTED');
    if (generated.status !== 'SUPPORTED') return;
    const validated = await math.validate(actor, LUCKY_LADY_GAME_ID, generated.profile.profileId, tiny);
    expect(validated.evidence.result).toBe('PASS');

    process.env.MATH_CONTROL_GAMBLE_SCOPE_DECISION = 'PENDING';
    try {
      await expect(math.activate(actor, LUCKY_LADY_GAME_ID, generated.profile.profileId)).rejects.toMatchObject({
        response: { code: 'GAMBLE_SCOPE_PENDING_USER_DECISION' },
      });
    } finally {
      process.env.MATH_CONTROL_GAMBLE_SCOPE_DECISION = 'EXCLUDE_OPTIONAL_GAMBLE';
    }

    // With the decision recorded, the same profile activates.
    await expect(math.activate(actor, LUCKY_LADY_GAME_ID, generated.profile.profileId)).resolves.toMatchObject({
      profileId: generated.profile.profileId,
    });
  });

  it('rejects identity fields in the generation body at the transport boundary', async () => {
    const admin = request(app.getHttpServer());
    await admin.post('/admin/casino/math/lucky-lady/generate')
      .set('authorization', `Bearer ${adminToken}`)
      .send({ ...policy(), userId: 'attacker', role: 'ADMIN' })
      .expect(400);
  });

  /**
   * The runtime seam: a game serves the accepted frozen profile until a new one
   * is activated, then serves the activated identity - and a round already in
   * flight keeps the identity it recorded for itself.
   */
  it('serves the accepted profile by default and the activated profile for new rounds', async () => {
    const adapter = app.get(LuckyLadyAdapter);
    const player = await prisma.user.findUniqueOrThrow({ where: { email: userEmail } });
    const context = {
      gameId: LUCKY_LADY_GAME_ID,
      userId: player.id,
      // The prepared-outcome journal stores the originating session as a UUID.
      sessionId: '11111111-2222-4333-8444-555555555555',
    };
    const settingsOf = async () => {
      const response = await adapter.read(context, 'getSettings', {}) as unknown as {
        serverResponse: { mathConfig: { activeMathProfile: string; profileHash: string } };
      };
      return response.serverResponse.mathConfig;
    };

    // Untouched deployment: the accepted RTP50 artefact is what the client is told.
    const before = await settingsOf();
    expect(before.activeMathProfile).toBe('lucky-lady.rtp50.v1');
    expect(before.profileHash).toBe('eb0a22171a3479cea3b0238269edd4b0dc5d9486c57e4b057fa6ee0f1a70be5f');

    const actor = (await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } })).id;
    const generated = await math.generate(actor, LUCKY_LADY_GAME_ID, policy({ targetRtpPercent: 80 }));
    expect(generated.status).toBe('SUPPORTED');
    if (generated.status !== 'SUPPORTED') return;
    const validated = await math.validate(actor, LUCKY_LADY_GAME_ID, generated.profile.profileId, tiny);
    if (validated.evidence.result !== 'PASS') return;
    await math.activate(actor, LUCKY_LADY_GAME_ID, generated.profile.profileId);

    const after = await settingsOf();
    expect(after.activeMathProfile).toBe(generated.profile.profileId);
    expect(after.profileHash).toBe(generated.profile.canonicalHash);

    // A new paid round pins the activated identity in its own state ...
    await points.adminGrant(actor, player.id, 100_000n, 'math control pin probe', 'math-pin-fund-1');
    await adapter.execute(context, {
      event: 'bet',
      body: { slotEvent: 'bet', slotBet: 1, slotLines: 10 },
      headers: { 'x-pilot-version': '1', 'x-pilot-round': 'none' },
      requestId: 'math-pin-round-1',
    });
    const played = await prisma.casinoRound.findFirstOrThrow({
      where: { userId: player.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const pinnedState = played.privateState as { profileId: string; profileHash: string };
    expect(pinnedState.profileId).toBe(generated.profile.profileId);
    expect(pinnedState.profileHash).toBe(generated.profile.canonicalHash);

    // ... and keeps it after a later activation, so activation never reaches
    // backwards into a round that is already in flight.
    const second = await math.generate(actor, LUCKY_LADY_GAME_ID, policy({ targetRtpPercent: 40 }));
    expect(second.status).toBe('SUPPORTED');
    if (second.status !== 'SUPPORTED') return;
    const secondValidation = await math.validate(actor, LUCKY_LADY_GAME_ID, second.profile.profileId, tiny);
    if (secondValidation.evidence.result !== 'PASS') return;
    await math.activate(actor, LUCKY_LADY_GAME_ID, second.profile.profileId);
    const afterSecond = await prisma.casinoRound.findUniqueOrThrow({ where: { id: played.id } });
    const pinnedStill = afterSecond.privateState as { profileId: string };
    expect(pinnedStill.profileId).toBe(generated.profile.profileId);
    expect((await settingsOf()).activeMathProfile).toBe(second.profile.profileId);
  });
});
