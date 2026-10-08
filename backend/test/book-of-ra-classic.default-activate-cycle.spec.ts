import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
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
import { CLASSIC_ID, ClassicProfile, IntRng } from '../src/casino/games/book-of-ra-classic/classic.engine';
import { classicIdentity, defaultClassicProfile } from '../src/casino/games/book-of-ra-classic/classic.math-adapter';
import { LUCKY_LADY_PAYOUT_GAME_ID } from '../src/casino/games/lucky-lady/payout/lucky-lady-payout.types';
import { GamePlatform } from '../src/casino/platform/game-adapter.types';
import { GameCapabilityService } from '../src/casino/platform/game-capability.service';
import { GameJournalService } from '../src/casino/platform/game-journal.service';
import { GameRoundService } from '../src/casino/platform/game-round.service';
import { GameWalletService } from '../src/casino/platform/game-wallet.service';
import { canonicalProfileHash } from '../src/casino/platform/math-control/math-control.analytics';
import { createSimulationRng } from '../src/casino/platform/math-control/math-control.random';
import { GameMathRegistry } from '../src/casino/platform/math-control/math-control.registry';
import { MathControlService, requiredActivationChecks } from '../src/casino/platform/math-control/math-control.service';
import { MathPolicy, MathProfileArtifact } from '../src/casino/platform/math-control/math-control.types';
import { PrismaService } from '../src/prisma.service';
import { PointsService } from '../src/wallet/points.service';
import { uniqueTestEmail } from './test-identity';

const CLASSIC_DEFAULT_PROFILE_ID = 'book-of-ra-classic.rtp50.v1';
const LUCKY_LADY_DEFAULT_PROFILE_ID = 'lucky-lady.rtp50.v1';

/**
 * The identity shape a generated Classic profile uses, pinned to a local
 * fixture so no generator, Monte Carlo or bankroll run is needed here.
 */
const CLASSIC_CANDIDATE_PROFILE_ID = 'book-of-ra-classic.gf0f0f0f0f0f0f0f0f0f0';
const LUCKY_LADY_CANDIDATE_PROFILE_ID = 'lucky-lady.gf0f0f0f0f0f0f0f0f0f0';

/** A pinned `createdAt` so the canonical hash can be derived before the insert. */
const FIXTURE_CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const FIXTURE_ARTIFACT_PATH = 'test-fixture/default-activate-cycle.json';

/**
 * The six derived analytic metadata fields the game adapters quantize before
 * hashing, mirrored here so a seeded payload survives the jsonb round trip
 * exactly as a generated one does. Nothing the runtime draws from changes.
 */
const ANALYTIC_FIELDS = [
  'expectedRtpPercent',
  'triggerProbability',
  'retriggerProbability',
  'featureReturn',
  'maxPaid',
  'maxFree',
] as const;

const intRng = (seed: string): IntRng => {
  const rng = createSimulationRng(seed);
  return (upper) => rng.int(0, upper - 1);
};

/**
 * DEFAULT -> ACTIVATE through the real shared `MathControlService`, with the
 * real admin controller, PostgreSQL and Redis.
 *
 * The pointer this exercises is the documented bug: `activate()` inside a
 * transaction that already holds a pointer wrote the profile identity but left
 * `kind` on the `DEFAULT` tombstone it was leaving, so the runtime seam
 * (`activeProfile`) kept answering null for a profile that was genuinely
 * active - and kept a panel payout candidate id that no longer applied.
 *
 * `kind` is the existing contract, not a new enum: the column defaults to
 * `GENERATED`, the Lucky Lady panel writes `GENERATED` for CUSTOM, and the
 * accepted DEFAULT reset writes the `DEFAULT` tombstone. CUSTOM is therefore
 * `kind !== 'DEFAULT'` with a non-null `profileRowId`, exactly as the panel's
 * own probe reads it.
 *
 * The candidate rows are seeded pre-validated fixtures (no generator, Monte
 * Carlo or bankroll run): a shipped artifact body, the real engine identity, a
 * hash re-derived with the production `canonicalProfileHash`, and a passing
 * validation carrying exactly the check ids the activation gate requires.
 * Every gate the production code applies still evaluates for real.
 */
describe('book of ra classic DEFAULT -> ACTIVATE -> DEFAULT -> ACTIVATE (PostgreSQL + Redis)', () => {
  const prisma = new PrismaService();
  let app: INestApplication;
  let auth: AuthService;
  let math: MathControlService;
  let configs: CasinoConfigService;
  let points: PointsService;
  let redis: RedisService;

  const password = 'correct-horse-battery';
  const adminEmail = uniqueTestEmail('classic-activate-admin');
  const playerOneEmail = uniqueTestEmail('classic-activate-player-one');
  const playerTwoEmail = uniqueTestEmail('classic-activate-player-two');
  let adminToken: string;
  let adminId: string;
  let playerOneId: string;
  let playerTwoId: string;

  /** Cleanup scoped to this spec's own identifiers; no unrelated table is truncated. */
  const cleanup = async () => {
    const games = [CLASSIC_ID, LUCKY_LADY_PAYOUT_GAME_ID];
    const userIds = (
      await prisma.user.findMany({ where: { email: { in: [adminEmail, playerOneEmail, playerTwoEmail] } } })
    ).map((user) => user.id);
    const attempts: Array<Promise<unknown>> = [
      prisma.gameActiveMathProfile.deleteMany({ where: { gameId: { in: games } } }),
      prisma.gameMathProfileValidation.deleteMany({ where: { gameId: { in: games } } }),
      prisma.gameMathProfile.deleteMany({ where: { gameId: { in: games } } }),
      prisma.luckyLadyPayoutActivation.deleteMany({ where: { gameId: LUCKY_LADY_PAYOUT_GAME_ID } }),
      prisma.auditLog.deleteMany({ where: { targetId: { in: games } } }),
      prisma.casinoRound.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.gameSession.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.user.deleteMany({ where: { id: { in: userIds } } }),
    ];
    for (const attempt of attempts) await attempt.catch(() => undefined);
  };

  beforeAll(async () => {
    process.env.SPORTS_SETTLEMENT_ENABLED = 'false';
    // The recorded scope decision: without it any paying profile is refused.
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
    await cleanup();
  }, 120_000);

  afterAll(async () => {
    if (app) await app.close();
    await cleanup();
    await prisma.$disconnect();
    delete process.env.SPORTS_SETTLEMENT_ENABLED;
    delete process.env.MATH_CONTROL_GAMBLE_SCOPE_DECISION;
  }, 60_000);

  beforeEach(async () => {
    const hash = await argon2.hash(password);
    const [admin, playerOne, playerTwo] = await Promise.all([
      prisma.user.create({ data: { email: adminEmail, passwordHash: hash, role: 'SUPER_ADMIN', wallet: { create: {} } } }),
      prisma.user.create({ data: { email: playerOneEmail, passwordHash: hash, wallet: { create: {} } } }),
      prisma.user.create({ data: { email: playerTwoEmail, passwordHash: hash, wallet: { create: {} } } }),
    ]);
    adminId = admin.id;
    playerOneId = playerOne.id;
    playerTwoId = playerTwo.id;
    adminToken = (await auth.login(adminEmail, password)).pair.accessToken;
  }, 60_000);

  const bearer = (token: string) => `Bearer ${token}`;
  const server = () => app.getHttpServer();

  const pointer = (gameId: string) => prisma.gameActiveMathProfile.findUnique({ where: { gameId } });

  const activationChecks = (scope: string, provedMax: number) =>
    requiredActivationChecks(scope).map((id) => ({
      id,
      status: 'PASS',
      ...(id === 'MAX_WIN_PROVEN_WITHIN_CEILING' ? { value: { provedMax } } : {}),
    }));

  const seedValidatedProfile = async (artifact: MathProfileArtifact) => {
    const row = await prisma.gameMathProfile.create({
      data: {
        gameId: artifact.gameId,
        profileId: artifact.profileId,
        canonicalHash: artifact.canonicalHash,
        engineSha256: artifact.engineSha256,
        rulesSha256: artifact.rulesSha256,
        targetRtpPercent: new Prisma.Decimal(artifact.policy.targetRtpPercent.toFixed(6)),
        measuredRtpPercent: null,
        maxWinMultiplier: new Prisma.Decimal(artifact.policy.maxWinMultiplier.toFixed(6)),
        policy: artifact.policy as unknown as Prisma.InputJsonValue,
        analytic: { kind: 'DEFAULT_ACTIVATE_FIXTURE' } as Prisma.InputJsonValue,
        payload: artifact.payload as Prisma.InputJsonValue,
        status: 'VALIDATED',
        generatedBy: adminId,
        createdAt: FIXTURE_CREATED_AT,
      },
    });
    await prisma.gameMathProfileValidation.create({
      data: {
        profileRowId: row.id,
        gameId: artifact.gameId,
        profileId: artifact.profileId,
        profileHash: artifact.canonicalHash,
        result: 'PASS',
        metrics: { grade: 'ACTIVATION' } as Prisma.InputJsonValue,
        bankroll: { fixture: true } as Prisma.InputJsonValue,
        checks: activationChecks(artifact.policy.maxWinScope, artifact.policy.maxWinMultiplier) as unknown as Prisma.InputJsonValue,
        runs: { fixture: true } as Prisma.InputJsonValue,
        artifactPath: FIXTURE_ARTIFACT_PATH,
        validatedBy: adminId,
      },
    });
    return row;
  };

  /** The shipped frozen Classic artifact, re-hashed through the production path. */
  const classicCandidate = (): MathProfileArtifact => {
    const frozen = defaultClassicProfile();
    const payload = JSON.parse(JSON.stringify(frozen.payload)) as ClassicProfile;
    for (const table of Object.values(payload.tables)) {
      for (const field of ANALYTIC_FIELDS) {
        table[field] = Math.round(Number(table[field]) * 1e9) / 1e9;
      }
    }
    const policy: MathPolicy = {
      gameId: CLASSIC_ID,
      targetRtpPercent: payload.targetRtpPercent,
      maxWinMultiplier: payload.maxWinMultiplier,
      maxWinScope: 'RESOLVED_SPIN',
      maxWinEnabled: true,
      customPacing: null,
      pacing: 'BALANCED',
      hitRate: { mode: 'AUTO' },
      partialReturn: 'MED',
      volatility: 'MED',
      bigWinMinMultiplier: 10,
      bigWinMaxMultiplier: 50,
      featureContribution: { minPercent: 0, maxPercent: 60 },
      presets: ['BALANCED'],
    };
    const artifact: MathProfileArtifact = {
      schemaVersion: 1,
      profileId: CLASSIC_CANDIDATE_PROFILE_ID,
      gameId: CLASSIC_ID,
      ...classicIdentity(),
      policy,
      payload: payload as unknown as MathProfileArtifact['payload'],
      canonicalHash: '',
      createdAt: FIXTURE_CREATED_AT.toISOString(),
    };
    artifact.canonicalHash = canonicalProfileHash(artifact);
    return artifact;
  };

  /**
   * A Lucky Lady candidate carrying the registered Lucky Lady engine identity,
   * so the shared gates evaluate against the real adapter rather than a stub.
   */
  const luckyLadyCandidate = (): MathProfileArtifact => {
    const identity = app.get(GameMathRegistry).adapter(LUCKY_LADY_PAYOUT_GAME_ID).identity();
    const policy: MathPolicy = {
      gameId: LUCKY_LADY_PAYOUT_GAME_ID,
      targetRtpPercent: 50,
      maxWinMultiplier: 50,
      maxWinScope: 'PAID_ROUND_BEFORE_OPTIONAL_GAMBLE',
      maxWinEnabled: true,
      customPacing: null,
      pacing: 'BALANCED',
      hitRate: { mode: 'AUTO' },
      partialReturn: 'MED',
      volatility: 'MED',
      bigWinMinMultiplier: 10,
      bigWinMaxMultiplier: 50,
      featureContribution: { minPercent: 0, maxPercent: 60 },
      presets: ['BALANCED'],
    };
    const artifact: MathProfileArtifact = {
      schemaVersion: 1,
      profileId: LUCKY_LADY_CANDIDATE_PROFILE_ID,
      gameId: LUCKY_LADY_PAYOUT_GAME_ID,
      engineSha256: identity.engineSha256,
      rulesSha256: identity.rulesSha256,
      policy,
      payload: {
        kind: 'LUCKY_LADY_DEFAULT_ACTIVATE_FIXTURE',
        gameId: LUCKY_LADY_PAYOUT_GAME_ID,
        profileId: LUCKY_LADY_DEFAULT_PROFILE_ID,
        targetRtpPercent: 50,
      } as unknown as MathProfileArtifact['payload'],
      canonicalHash: '',
      createdAt: FIXTURE_CREATED_AT.toISOString(),
    };
    artifact.canonicalHash = canonicalProfileHash(artifact);
    return artifact;
  };

  /**
   * The production runtime seam for a NEW paid round: a real ClassicAdapter over
   * the shared service, one real session and one real bet.
   */
  const playPaidRound = async (userId: string, tokenHash: string, requestId: string, rngSeed: string) => {
    const registry = new CasinoGameRegistry();
    const platform: GamePlatform = {
      capabilities: new GameCapabilityService(prisma, registry, configs),
      wallet: new GameWalletService(),
      journal: new GameJournalService(prisma),
      rounds: new GameRoundService(prisma),
    };
    const adapter = new ClassicAdapter(prisma, platform, configs, math, { rng: intRng(rngSeed) });
    await points.adminGrant(adminId, userId, 10_000n, 'Classic DEFAULT->ACTIVATE round funding', `grant-${requestId}`);
    const session = await prisma.gameSession.create({
      data: { userId, gameId: CLASSIC_ID, tokenHash, expiresAt: new Date(Date.now() + 3_600_000) },
    });
    const context = { gameId: CLASSIC_ID, userId, sessionId: session.id } as never;
    const settings = await adapter.read(context, 'getSettings', {}) as unknown as {
      serverResponse: { mathConfig: { activeMathProfile: string; profileHash: string } };
    };
    const played = await adapter.execute(context, {
      event: 'bet',
      body: { slotEvent: 'bet', slotBet: 1, slotLines: 9 },
      headers: { 'x-pilot-version': '1', 'x-pilot-round': 'none' },
      requestId,
    }) as unknown as {
      serverResponse: { Balance: string };
      recovery: { profile: { id: string; hash: string; version: number } };
    };
    const round = await prisma.casinoRound.findFirstOrThrow({ where: { userId } });
    return { settings, played, state: round.privateState as unknown as ClassicState };
  };

  it('keeps CUSTOM live across two DEFAULT -> ACTIVATE cycles and two new paid rounds', async () => {
    expect(defaultClassicProfile().id).toBe(CLASSIC_DEFAULT_PROFILE_ID);
    const candidate = classicCandidate();
    await seedValidatedProfile(candidate);
    const { profileId, canonicalHash: profileHash } = candidate;

    // A. DEFAULT: the shared reset materialises the registered default identity.
    const firstDefault = await math.resetToDefault(adminId, CLASSIC_ID, {});
    expect(firstDefault).toMatchObject({
      gameId: CLASSIC_ID,
      mode: 'DEFAULT',
      version: 1,
      profileId: CLASSIC_DEFAULT_PROFILE_ID,
      profileHash: defaultClassicProfile().hash,
      validationId: null,
    });
    expect(await pointer(CLASSIC_ID)).toMatchObject({ kind: 'DEFAULT', profileRowId: null, version: 1 });
    await expect(math.activeProfile(CLASSIC_ID)).resolves.toBeNull();

    // B. ACTIVATE the validated custom candidate through the shared lifecycle.
    const firstActivation = await math.activate(adminId, CLASSIC_ID, profileId);
    expect(firstActivation).toMatchObject({ gameId: CLASSIC_ID, profileId, profileHash, version: 2 });

    // C. the persisted pointer and the real admin CURRENT surface report CUSTOM.
    expect(await pointer(CLASSIC_ID)).toMatchObject({
      kind: 'GENERATED',
      profileRowId: expect.any(String),
      profileId,
      profileHash,
      validationId: expect.any(String),
      payoutCandidateId: null,
      version: 2,
    });
    const currentAfterFirst = await request(server())
      .get(`/admin/casino/math/${CLASSIC_ID}`)
      .set('authorization', bearer(adminToken))
      .expect(200);
    expect(currentAfterFirst.body.active).toMatchObject({ kind: 'GENERATED', version: 2, profileId, profileHash });
    const liveAfterFirst = await math.activeProfile(CLASSIC_ID);
    expect(liveAfterFirst?.artifact.canonicalHash).toBe(profileHash);
    expect(liveAfterFirst?.version).toBe(2);

    // D. a NEW paid round pins the custom profile.
    const firstRound = await playPaidRound(playerOneId, 'd'.repeat(64), 'classic-activate-round-1', 'classic-activate-seed-1');
    expect(firstRound.settings.serverResponse.mathConfig).toMatchObject({ activeMathProfile: profileId, profileHash });
    expect(firstRound.played.recovery.profile).toEqual({ id: profileId, hash: profileHash, version: 2 });
    expect(firstRound.state).toMatchObject({ profileId, profileHash });
    expect(firstRound.played.serverResponse).toBeDefined();

    // E. DEFAULT again, with the same registered identity.
    const secondDefault = await math.resetToDefault(adminId, CLASSIC_ID, { expectedVersion: firstActivation.version });
    expect(secondDefault).toMatchObject({ mode: 'DEFAULT', version: 3, profileId: CLASSIC_DEFAULT_PROFILE_ID });

    // F. the pointer is the DEFAULT tombstone and the runtime seam is null again.
    expect(await pointer(CLASSIC_ID)).toMatchObject({ kind: 'DEFAULT', profileRowId: null, version: 3 });
    await expect(math.activeProfile(CLASSIC_ID)).resolves.toBeNull();
    const currentAfterDefault = await request(server())
      .get(`/admin/casino/math/${CLASSIC_ID}`)
      .set('authorization', bearer(adminToken))
      .expect(200);
    expect(currentAfterDefault.body.active).toMatchObject({
      kind: 'DEFAULT',
      version: 3,
      profileRowId: null,
      profileId: CLASSIC_DEFAULT_PROFILE_ID,
    });

    // G. ACTIVATE the same valid candidate a second time.
    const secondActivation = await math.activate(adminId, CLASSIC_ID, profileId);
    expect(secondActivation).toMatchObject({ profileId, profileHash, version: 4 });

    // H. CUSTOM is live again rather than a stale DEFAULT tombstone.
    expect(await pointer(CLASSIC_ID)).toMatchObject({ kind: 'GENERATED', profileId, profileHash, version: 4 });
    const liveAfterSecond = await math.activeProfile(CLASSIC_ID);
    expect(liveAfterSecond?.artifact.canonicalHash).toBe(profileHash);
    expect(liveAfterSecond?.version).toBe(4);

    // I. a second NEW paid round pins the custom profile again.
    const secondRound = await playPaidRound(playerTwoId, 'e'.repeat(64), 'classic-activate-round-2', 'classic-activate-seed-2');
    expect(secondRound.settings.serverResponse.mathConfig).toMatchObject({ activeMathProfile: profileId, profileHash });
    expect(secondRound.played.recovery.profile).toEqual({ id: profileId, hash: profileHash, version: 4 });
    expect(secondRound.state).toMatchObject({ profileId, profileHash });

    // History survives both cycles: two distinct paid rounds, one immutable
    // profile row, one validation, and exactly the two shared transitions each way.
    expect(await prisma.casinoRound.count({ where: { userId: { in: [playerOneId, playerTwoId] } } })).toBe(2);
    expect(await prisma.gameMathProfile.count({ where: { gameId: CLASSIC_ID } })).toBe(1);
    expect(await prisma.gameMathProfileValidation.count({ where: { gameId: CLASSIC_ID } })).toBe(1);
    expect(await prisma.auditLog.count({
      where: { targetId: CLASSIC_ID, action: 'CASINO_MATH_PROFILE_ACTIVATED' },
    })).toBe(2);
    expect(await prisma.auditLog.count({
      where: { targetId: CLASSIC_ID, action: 'CASINO_MATH_PAYOUT_LIFECYCLE' },
    })).toBe(2);
  }, 180_000);

  it('reports a live CUSTOM profile for Lucky Lady after the shared DEFAULT -> ACTIVATE cycle', async () => {
    const candidate = luckyLadyCandidate();
    await seedValidatedProfile(candidate);
    const { profileId, canonicalHash: profileHash } = candidate;

    const reset = await math.resetToDefault(adminId, LUCKY_LADY_PAYOUT_GAME_ID, { actionId: 'll-shared-default-0001' });
    expect(reset).toMatchObject({ gameId: LUCKY_LADY_PAYOUT_GAME_ID, mode: 'DEFAULT' });
    expect(await pointer(LUCKY_LADY_PAYOUT_GAME_ID)).toMatchObject({ kind: 'DEFAULT', profileRowId: null });
    await expect(math.activeProfile(LUCKY_LADY_PAYOUT_GAME_ID)).resolves.toBeNull();

    const activated = await math.activate(adminId, LUCKY_LADY_PAYOUT_GAME_ID, profileId);
    expect(activated).toMatchObject({ gameId: LUCKY_LADY_PAYOUT_GAME_ID, profileId, profileHash });
    expect(await pointer(LUCKY_LADY_PAYOUT_GAME_ID)).toMatchObject({
      kind: 'GENERATED',
      profileRowId: expect.any(String),
      profileId,
      profileHash,
      payoutCandidateId: null,
      version: 2,
    });
    const live = await math.activeProfile(LUCKY_LADY_PAYOUT_GAME_ID);
    expect(live?.artifact.canonicalHash).toBe(profileHash);
    expect(live?.version).toBe(2);
  }, 120_000);
});
