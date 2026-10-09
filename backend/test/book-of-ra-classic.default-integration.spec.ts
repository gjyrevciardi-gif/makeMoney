import 'reflect-metadata';
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
import { ClassicAdapter, ClassicState } from '../src/casino/games/book-of-ra-classic/classic.adapter';
import { CLASSIC_ID, ClassicProfile, IntRng, RULES, generateProfile as engineGenerateProfile } from '../src/casino/games/book-of-ra-classic/classic.engine';
import { classicIdentity, defaultClassicProfile } from '../src/casino/games/book-of-ra-classic/classic.math-adapter';
import { LuckyLadyPayoutService } from '../src/casino/games/lucky-lady/payout/lucky-lady-payout.service';
import { LUCKY_LADY_PAYOUT_GAME_ID } from '../src/casino/games/lucky-lady/payout/lucky-lady-payout.types';
import { GamePlatform } from '../src/casino/platform/game-adapter.types';
import { GameCapabilityService } from '../src/casino/platform/game-capability.service';
import { GameJournalService } from '../src/casino/platform/game-journal.service';
import { GameRoundService } from '../src/casino/platform/game-round.service';
import { GameWalletService } from '../src/casino/platform/game-wallet.service';
import { canonicalProfileHash } from '../src/casino/platform/math-control/math-control.analytics';
import { createSimulationRng } from '../src/casino/platform/math-control/math-control.random';
import { GameMathRegistry } from '../src/casino/platform/math-control/math-control.registry';
import { MathControlService } from '../src/casino/platform/math-control/math-control.service';
import {
  GAME_MATH_DEFAULT_RESETTERS,
  type GameMathDefaultResetter,
  type MathPolicy,
  type MathProfileArtifact,
} from '../src/casino/platform/math-control/math-control.types';
import { PrismaService } from '../src/prisma.service';
import { PointsService } from '../src/wallet/points.service';
import { uniqueTestEmail } from './test-identity';

const CLASSIC_GAME_ID = 'book-of-ra-classic';
const CLASSIC_DEFAULT_PROFILE_ID = 'book-of-ra-classic.rtp50.v1';
const UNINTEGRATED_GAME_ID = 'book-of-ra-deluxe';

const ANALYTIC_FIELDS = [
  'expectedRtpPercent',
  'triggerProbability',
  'retriggerProbability',
  'featureReturn',
  'maxPaid',
  'maxFree',
] as const;

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

const TRUNCATE = 'TRUNCATE TABLE "LuckyLadyPayoutActivation", "LuckyLadyPayoutValidation", ' +
  '"LuckyLadyPayoutCandidate", "GameActiveMathProfile", "GameMathProfileValidation", "GameMathProfile", ' +
  '"GamePreparedOutcome", "GameSession", "GameLaunchCapability", "CasinoGameConfigVersion", ' +
  '"CasinoGameConfig", "PlatformSettings", "CasinoTransaction", "CasinoRoundAction", "CasinoRound", ' +
  '"CasinoGameFavorite", "LedgerEntry", "BetLeg", "Bet", "AuditLog", "RefreshToken", "Wallet", "User" CASCADE';

/**
 * The shared admin DEFAULT reset (`POST /admin/casino/math/:gameId/default`) and
 * the focused Classic operator lifecycle that proves it.
 *
 * The accepted CURRENT/DEFAULT spec exercises the admin *config* contract, which
 * materialises a game's built-in default but is not a reset. This spec exercises
 * the real reset through the shared controller with PostgreSQL + Redis: a custom
 * pointer becomes the explicit DEFAULT tombstone carrying the game's registered
 * immutable default identity from its own math adapter, CURRENT proves that
 * identity, the runtime falls back to the frozen `book-of-ra-classic.rtp50.v1`
 * artefact, a round in flight keeps its origin mathematics, established history
 * survives, a stale expectedVersion is refused, no other game is touched, and
 * Lucky Lady's own default transition keeps its semantics (the generic route
 * delegates to it).
 */
describe('book of ra classic shared admin DEFAULT reset (PostgreSQL + Redis)', () => {
  const prisma = new PrismaService();
  let app: INestApplication;
  let auth: AuthService;
  let math: MathControlService;
  let configs: CasinoConfigService;
  let points: PointsService;
  let redis: RedisService;

  const password = 'correct-horse-battery';
  const userEmail = uniqueTestEmail('classic-default-user');
  const adminEmail = uniqueTestEmail('classic-default-admin');
  let userToken: string;
  let adminToken: string;
  let userId: string;
  let adminId: string;

  beforeAll(async () => {
    process.env.SPORTS_SETTLEMENT_ENABLED = 'false';
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
  }, 120_000);

  afterAll(async () => {
    if (app) await app.close();
    // Leave the shared test database empty so an unrelated spec that expects a
    // pristine game (a never-activated Classic, a never-used panel) still sees one.
    await prisma.$executeRawUnsafe(TRUNCATE).catch(() => undefined);
    await prisma.$disconnect();
    delete process.env.SPORTS_SETTLEMENT_ENABLED;
    delete process.env.MATH_CONTROL_MIN_MC_ROUNDS;
    delete process.env.MATH_CONTROL_MIN_SESSIONS;
    delete process.env.MATH_CONTROL_MIN_HORIZON;
    delete process.env.MATH_CONTROL_GAMBLE_SCOPE_DECISION;
  }, 60_000);

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(TRUNCATE);
    await redis.client.flushdb();
    const hash = await argon2.hash(password);
    const [player, admin] = await Promise.all([
      prisma.user.create({ data: { email: userEmail, passwordHash: hash, wallet: { create: {} } } }),
      prisma.user.create({ data: { email: adminEmail, passwordHash: hash, role: 'SUPER_ADMIN', wallet: { create: {} } } }),
    ]);
    userId = player.id;
    adminId = admin.id;
    userToken = (await auth.login(player.email, password)).pair.accessToken;
    adminToken = (await auth.login(admin.email, password)).pair.accessToken;
  }, 60_000);

  const bearer = (token: string) => `Bearer ${token}`;
  const server = () => app.getHttpServer();

  /** Seed Lucky Lady state so a cross-game comparison is a real comparison. */
  const seedOtherGame = async () => {
    await prisma.luckyLadyPayoutActivation.create({
      data: {
        gameId: LUCKY_LADY_PAYOUT_GAME_ID,
        actionId: 'll-seed-action-0001',
        action: 'DEFAULT',
        version: 1,
        previous: { semantics: 'seed', mode: 'DEFAULT', version: 0 },
        actorId: adminId,
      },
    });
    await prisma.gameActiveMathProfile.create({
      data: {
        gameId: LUCKY_LADY_PAYOUT_GAME_ID,
        profileRowId: null,
        profileId: 'lucky-lady.rtp50.v1',
        profileHash: 'a'.repeat(64),
        validationId: null,
        kind: 'DEFAULT',
        payoutCandidateId: null,
        version: 1,
        activatedBy: adminId,
      },
    });
    await prisma.auditLog.create({
      data: {
        actorId: adminId,
        targetType: 'CASINO_MATH_CONTROL',
        targetId: LUCKY_LADY_PAYOUT_GAME_ID,
        action: 'CASINO_MATH_PAYOUT_LIFECYCLE',
        result: 'OK',
        metadata: { action: 'DEFAULT', seed: true },
      },
    });
    return {
      pointer: await prisma.gameActiveMathProfile.findMany({ where: { gameId: LUCKY_LADY_PAYOUT_GAME_ID } }),
      history: await prisma.luckyLadyPayoutActivation.count({ where: { gameId: LUCKY_LADY_PAYOUT_GAME_ID } }),
      audit: await prisma.auditLog.count({ where: { targetId: LUCKY_LADY_PAYOUT_GAME_ID } }),
    };
  };

  it('is ADMIN-only on the shared DEFAULT route and creates nothing for a player', async () => {
    await request(server())
      .post(`/admin/casino/math/${CLASSIC_GAME_ID}/default`)
      .set('authorization', bearer(userToken))
      .send({})
      .expect(403);
    expect(await prisma.gameActiveMathProfile.count({ where: { gameId: CLASSIC_GAME_ID } })).toBe(0);
    await expect(math.activeProfile(CLASSIC_GAME_ID)).resolves.toBeNull();
  });

  it('answers an unintegrated game with the established NOT_INTEGRATED contract', async () => {
    const response = await request(server())
      .post(`/admin/casino/math/${UNINTEGRATED_GAME_ID}/default`)
      .set('authorization', bearer(adminToken))
      .send({})
      .expect(404);
    expect(response.body.code).toBe('GAME_MATH_NOT_INTEGRATED');
    expect(await prisma.gameActiveMathProfile.count({ where: { gameId: UNINTEGRATED_GAME_ID } })).toBe(0);
  });

  it('exposes the registered default identity through the game adapter mapping', () => {
    const registry = app.get(GameMathRegistry);
    expect(registry.adapter(CLASSIC_GAME_ID).defaultProfile?.()).toEqual({
      profileId: CLASSIC_DEFAULT_PROFILE_ID,
      profileHash: defaultClassicProfile().hash,
    });
    // No Deluxe fallback and no borrowed identity.
    expect(registry.has(UNINTEGRATED_GAME_ID)).toBe(false);
  });

  it('treats a non-DEFAULT pointer as control ON even when its profile is a zero-return one', async () => {
    // Synthetic local fixture (no production data): the pointer kind and profile
    // row decide DEFAULT vs control ON, never an RTP value. A zero-return custom
    // profile must be replaced by an explicit DEFAULT, not mistaken for "already
    // default".
    await prisma.gameMathProfile.create({
      data: {
        gameId: CLASSIC_GAME_ID,
        profileId: 'book-of-ra-classic.rtp0.fixture',
        canonicalHash: 'f'.repeat(64),
        engineSha256: 'e'.repeat(64),
        rulesSha256: 'r'.repeat(64),
        targetRtpPercent: 0,
        measuredRtpPercent: 0,
        maxWinMultiplier: 50,
        policy: {},
        analytic: {},
        payload: {},
        status: 'VALIDATED',
        generatedBy: adminId,
      },
    });
    await prisma.gameActiveMathProfile.create({
      data: {
        gameId: CLASSIC_GAME_ID,
        profileRowId: null,
        profileId: 'book-of-ra-classic.rtp0.fixture',
        profileHash: 'h'.repeat(64),
        validationId: null,
        kind: 'GENERATED',
        payoutCandidateId: null,
        version: 4,
        activatedBy: adminId,
      },
    });

    const before = await request(server())
      .get(`/admin/casino/math/${CLASSIC_GAME_ID}`)
      .set('authorization', bearer(adminToken))
      .expect(200);
    expect(before.body.active).toMatchObject({ kind: 'GENERATED', version: 4, profileId: 'book-of-ra-classic.rtp0.fixture' });

    const reset = await request(server())
      .post(`/admin/casino/math/${CLASSIC_GAME_ID}/default`)
      .set('authorization', bearer(adminToken))
      .send({ expectedVersion: 4 })
      .expect(201);
    expect(reset.body).toMatchObject({
      mode: 'DEFAULT',
      version: 5,
      profileId: CLASSIC_DEFAULT_PROFILE_ID,
      profileHash: defaultClassicProfile().hash,
    });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { targetId: CLASSIC_GAME_ID, action: 'CASINO_MATH_PAYOUT_LIFECYCLE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.metadata).toMatchObject({
      action: 'DEFAULT',
      from: 'CUSTOM',
      previousProfileId: 'book-of-ra-classic.rtp0.fixture',
      defaultProfileId: CLASSIC_DEFAULT_PROFILE_ID,
      version: 5,
    });
    // The fixture profile row itself is immutable history and is never deleted.
    expect(await prisma.gameMathProfile.count({ where: { gameId: CLASSIC_GAME_ID } })).toBe(1);
  });

  it('generates a storage-stable Classic profile, validates, activates, and resets to the registered default', async () => {
    const admin = request(server());
    const generated = await admin.post(`/admin/casino/math/${CLASSIC_ID}/generate`)
      .set('authorization', bearer(adminToken))
      .send(policy())
      .expect(201);
    expect(generated.body.status).toBe('SUPPORTED');
    const profileId = generated.body.profile.profileId as string;
    const profileHash = generated.body.profile.canonicalHash as string;
    expect(Number(generated.body.profile.targetRtpPercent)).toBe(50);
    expect(Number(generated.body.profile.maxWinMultiplier)).toBeGreaterThanOrEqual(18);

    // ---- bounded-precision structural proof -------------------------------
    // The same deterministic engine output, before normalisation, must be
    // identical everywhere except the six derived analytic metadata fields.
    const raw = engineGenerateProfile(50, 50);
    const stored = await prisma.gameMathProfile.findUniqueOrThrow({
      where: { gameId_profileId: { gameId: CLASSIC_ID, profileId } },
    });
    const storedPayload = stored.payload as unknown as ClassicProfile;
    expect(storedPayload.schema).toBe(raw.schema);
    expect(storedPayload.gameId).toBe(raw.gameId);
    expect(storedPayload.targetRtpPercent).toBe(raw.targetRtpPercent);
    expect(storedPayload.maxWinScope).toBe(raw.maxWinScope);
    expect(storedPayload.maxWinMultiplier).toBe(raw.maxWinMultiplier);
    expect(storedPayload.mass).toBe(raw.mass);
    for (let lines = 1; lines <= RULES.paylines.length; lines += 1) {
      const before = raw.tables[String(lines)];
      const after = storedPayload.tables[String(lines)];
      // Non-analytic payout data is byte-identical: stop windows, masses, free support.
      expect(after.paidZero).toEqual(before.paidZero);
      expect(after.paidPositive).toEqual(before.paidPositive);
      expect(after.free).toEqual(before.free);
      expect(after.positiveMass).toBe(before.positiveMass);
      for (const field of ANALYTIC_FIELDS) {
        const delta = Math.abs(Number(after[field]) - Number(before[field]));
        expect(delta).toBeLessThanOrEqual(5e-10);
      }
    }

    // ---- real Prisma/PostgreSQL round trip re-derives the stored hash -------
    const rebuilt: MathProfileArtifact = {
      schemaVersion: 1,
      profileId: stored.profileId,
      gameId: stored.gameId,
      engineSha256: stored.engineSha256,
      rulesSha256: stored.rulesSha256,
      policy: stored.policy as unknown as MathPolicy,
      payload: stored.payload,
      canonicalHash: stored.canonicalHash,
      createdAt: stored.createdAt.toISOString(),
    };
    expect(stored.canonicalHash).toBe(profileHash);
    expect(canonicalProfileHash(rebuilt)).toBe(profileHash);
    expect(stored.engineSha256).toBe(classicIdentity().engineSha256);

    // ---- focused validate + activate rerun --------------------------------
    const validated = await math.validate(adminId, CLASSIC_ID, profileId, tiny);
    expect(validated.evidence.profileHash).toBe(profileHash);
    expect(validated.evidence.result).toBe('PASS');
    const activated = await math.activate(adminId, CLASSIC_ID, profileId);
    expect(activated.profileId).toBe(profileId);
    const active = await math.activeProfile(CLASSIC_ID);
    expect(active?.artifact.canonicalHash).toBe(profileHash);

    // ---- one paid action + same-session recovery --------------------------
    const registry = new CasinoGameRegistry();
    const platform: GamePlatform = {
      capabilities: new GameCapabilityService(prisma, registry, configs),
      wallet: new GameWalletService(),
      journal: new GameJournalService(prisma),
      rounds: new GameRoundService(prisma),
    };
    const adapter = new ClassicAdapter(prisma, platform, configs, math, { rng: intRng('classic-default-0') });
    await points.adminGrant(adminId, userId, 10_000n, 'Classic DEFAULT reset funding', 'grant-classic-default-1');
    const session = await prisma.gameSession.create({
      data: {
        userId,
        gameId: CLASSIC_ID,
        tokenHash: 'd'.repeat(64),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const context = { gameId: CLASSIC_ID, userId, sessionId: session.id } as never;
    const request_ = {
      event: 'bet',
      body: { slotEvent: 'bet', slotBet: 1, slotLines: 9 },
      headers: { 'x-pilot-version': '1', 'x-pilot-round': 'none' },
      requestId: 'classic-default-round-1',
    };
    const settings = await adapter.read(context, 'getSettings', {}) as unknown as {
      serverResponse: { mathConfig: { activeMathProfile: string; profileHash: string } };
    };
    expect(settings.serverResponse.mathConfig.activeMathProfile).toBe(profileId);
    const played = await adapter.execute(context, request_) as unknown as {
      serverResponse: { Balance: string };
      recovery: { profile: { id: string; hash: string; version: number } };
    };
    expect(played.serverResponse).toBeDefined();
    expect(played.recovery.profile).toEqual({ id: profileId, hash: profileHash, version: activated.version });
    const round = await prisma.casinoRound.findFirstOrThrow({ where: { userId } });
    const state = round.privateState as unknown as ClassicState;
    expect(state.profileId).toBe(profileId);
    expect(state.profileHash).toBe(profileHash);

    // Same Classic session, identical request: the stored response is replayed,
    // nothing is redrawn and no second round is created.
    const replay = await adapter.execute(context, request_);
    expect(JSON.stringify(replay)).toBe(JSON.stringify(played));
    expect(await prisma.casinoRound.count({ where: { userId } })).toBe(1);

    // ---- reset to DEFAULT and prove the registered identity ---------------
    const other = await seedOtherGame();
    const reset = await admin.post(`/admin/casino/math/${CLASSIC_ID}/default`)
      .set('authorization', bearer(adminToken))
      .send({ expectedVersion: activated.version })
      .expect(201);
    expect(reset.body).toMatchObject({
      gameId: CLASSIC_GAME_ID,
      mode: 'DEFAULT',
      version: activated.version + 1,
      profileId: CLASSIC_DEFAULT_PROFILE_ID,
      profileHash: defaultClassicProfile().hash,
      validationId: null,
    });
    expect(reset.body.note).toContain(CLASSIC_DEFAULT_PROFILE_ID);

    const current = await request(server())
      .get(`/admin/casino/math/${CLASSIC_GAME_ID}`)
      .set('authorization', bearer(adminToken))
      .expect(200);
    expect(current.body.active).toMatchObject({
      kind: 'DEFAULT',
      version: activated.version + 1,
      profileRowId: null,
      profileId: CLASSIC_DEFAULT_PROFILE_ID,
      profileHash: defaultClassicProfile().hash,
    });
    await expect(math.activeProfile(CLASSIC_GAME_ID)).resolves.toBeNull();
    const afterSettings = await adapter.read(context, 'getSettings', {}) as unknown as {
      serverResponse: { mathConfig: { activeMathProfile: string; profileHash: string } };
    };
    expect(afterSettings.serverResponse.mathConfig.activeMathProfile).toBe(CLASSIC_DEFAULT_PROFILE_ID);
    expect(afterSettings.serverResponse.mathConfig.profileHash).toBe(defaultClassicProfile().hash);

    // The round already in flight keeps the mathematics it opened under, and
    // immutable history survives: the profile, its validation and audit rows.
    const stillInFlight = await prisma.casinoRound.findFirstOrThrow({ where: { userId } });
    expect((stillInFlight.privateState as unknown as ClassicState).profileId).toBe(profileId);
    expect(await prisma.gameMathProfile.count({ where: { gameId: CLASSIC_ID } })).toBe(1);
    expect(await prisma.gameMathProfileValidation.count({ where: { gameId: CLASSIC_ID } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { targetId: CLASSIC_GAME_ID, action: 'CASINO_MATH_PROFILE_ACTIVATED' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { targetId: CLASSIC_GAME_ID, action: 'CASINO_MATH_PAYOUT_LIFECYCLE' } })).toBe(1);

    // No cross-game mutation: the other game's pointer, history and audit are untouched.
    expect(await prisma.gameActiveMathProfile.findMany({ where: { gameId: LUCKY_LADY_PAYOUT_GAME_ID } }))
      .toEqual(other.pointer);
    expect(await prisma.luckyLadyPayoutActivation.count({ where: { gameId: LUCKY_LADY_PAYOUT_GAME_ID } }))
      .toBe(other.history);
    expect(await prisma.auditLog.count({ where: { targetId: LUCKY_LADY_PAYOUT_GAME_ID } }))
      .toBe(other.audit);

    // A stale expectedVersion is refused even though the game is now on default.
    const stale = await admin.post(`/admin/casino/math/${CLASSIC_ID}/default`)
      .set('authorization', bearer(adminToken))
      .send({ expectedVersion: activated.version })
      .expect(409);
    expect(stale.body.code).toBe('ACTIVE_MATH_PROFILE_CONFLICT');
  }, 180_000);

  it('keeps Lucky Lady default semantics and delegates the generic route to its own panel', async () => {
    // The wiring registers the panel as the DEFAULT-reset delegate for its game.
    const resetters = app.get<GameMathDefaultResetter[]>(GAME_MATH_DEFAULT_RESETTERS);
    expect(resetters).toHaveLength(1);
    expect(resetters[0]).toBeInstanceOf(LuckyLadyPayoutService);
    expect(resetters[0].gameId).toBe(LUCKY_LADY_PAYOUT_GAME_ID);

    // Legacy panel route: unchanged endpoint and unchanged semantics.
    const legacy = await request(server())
      .post(`/admin/casino/math/${LUCKY_LADY_PAYOUT_GAME_ID}/payout/default`)
      .set('authorization', bearer(adminToken))
      .send({ actionId: 'll-legacy-default-0001' })
      .expect(201);
    expect(legacy.body).toMatchObject({ gameId: LUCKY_LADY_PAYOUT_GAME_ID, action: 'DEFAULT', replay: false });
    expect(legacy.body.active.mode).toBe('DEFAULT');
    expect(await prisma.luckyLadyPayoutActivation.count({ where: { gameId: LUCKY_LADY_PAYOUT_GAME_ID } })).toBe(1);

    // Generic route: same transaction and history, projected into the shared shape.
    const generic = await request(server())
      .post(`/admin/casino/math/${LUCKY_LADY_PAYOUT_GAME_ID}/default`)
      .set('authorization', bearer(adminToken))
      .send({ actionId: 'll-generic-default-0001' })
      .expect(201);
    expect(generic.body).toMatchObject({ gameId: LUCKY_LADY_PAYOUT_GAME_ID, mode: 'DEFAULT' });
    const history = await prisma.luckyLadyPayoutActivation.findMany({
      where: { gameId: LUCKY_LADY_PAYOUT_GAME_ID },
      orderBy: [{ version: 'desc' }],
    });
    // Two rows prove the generic route ran the panel transition itself, not a bare
    // pointer write that would have left the panel history empty.
    expect(history.map((row) => row.actionId)).toEqual(['ll-generic-default-0001', 'll-legacy-default-0001']);
    expect(history.every((row) => row.action === 'DEFAULT')).toBe(true);
    await expect(math.activeProfile(LUCKY_LADY_PAYOUT_GAME_ID)).resolves.toBeNull();
    expect(await prisma.auditLog.count({
      where: { targetId: LUCKY_LADY_PAYOUT_GAME_ID, action: 'CASINO_MATH_PAYOUT_LIFECYCLE' },
    })).toBe(2);

    // A player token is rejected on the generic route for the panel-owned game too.
    await request(server())
      .post(`/admin/casino/math/${LUCKY_LADY_PAYOUT_GAME_ID}/default`)
      .set('authorization', bearer(userToken))
      .send({ actionId: 'll-player-token-0001' })
      .expect(403);
  }, 60_000);

  it('materialises the registered default once and is idempotent afterwards', async () => {
    const first = await request(server())
      .post(`/admin/casino/math/${CLASSIC_GAME_ID}/default`)
      .set('authorization', bearer(adminToken))
      .send({})
      .expect(201);
    expect(first.body).toMatchObject({
      mode: 'DEFAULT',
      version: 1,
      profileId: CLASSIC_DEFAULT_PROFILE_ID,
      profileHash: defaultClassicProfile().hash,
    });
    const second = await request(server())
      .post(`/admin/casino/math/${CLASSIC_GAME_ID}/default`)
      .set('authorization', bearer(adminToken))
      .send({ expectedVersion: 1 })
      .expect(201);
    expect(second.body).toMatchObject({ mode: 'DEFAULT', version: 1, profileId: CLASSIC_DEFAULT_PROFILE_ID });
    expect(await prisma.auditLog.count({
      where: { targetId: CLASSIC_GAME_ID, action: 'CASINO_MATH_PAYOUT_LIFECYCLE' },
    })).toBe(1);
    expect(await prisma.gameActiveMathProfile.count({ where: { gameId: CLASSIC_GAME_ID } })).toBe(1);
    // A stale guard on an already-default game is still refused.
    await request(server())
      .post(`/admin/casino/math/${CLASSIC_GAME_ID}/default`)
      .set('authorization', bearer(adminToken))
      .send({ expectedVersion: 5 })
      .expect(409);
  });
});
