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
const DELUXE_GAME_ID = 'book-of-ra-deluxe';
const CLASSIC_PROFILE_A = 'book-of-ra-classic.ghistoryfixturea';
const CLASSIC_PROFILE_B = 'book-of-ra-classic.ghistoryfixtureb';
const LUCKY_LADY_DEFAULT_PROFILE_ID = 'lucky-lady.rtp50.v1';

/** A pinned `createdAt` so the canonical hash can be derived before the insert. */
const FIXTURE_CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const FIXTURE_ARTIFACT_PATH = 'test-fixture/shared-history-rollback.json';

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
 * The generic shared HISTORY and ROLLBACK routes for a game whose lifecycle is
 * owned by the shared control plane (Book of Ra Classic), plus the backward
 * compatibility of the legacy Lucky Lady panel routes they generalise.
 *
 * Every candidate is a seeded, pre-validated fixture (a shipped artifact body,
 * the real engine identity, a hash re-derived with the production
 * `canonicalProfileHash`, and a passing validation carrying exactly the check
 * ids the activation gate requires). No generator, Monte Carlo or bankroll run
 * happens here, and every production gate still evaluates for real - including
 * on the profile a rollback restores.
 */
describe('book of ra classic shared history + rollback (PostgreSQL + Redis)', () => {
  const prisma = new PrismaService();
  let app: INestApplication;
  let auth: AuthService;
  let math: MathControlService;
  let configs: CasinoConfigService;
  let points: PointsService;
  let redis: RedisService;

  const password = 'correct-horse-battery';
  const adminEmail = uniqueTestEmail('classic-history-admin');
  const playerEmail = uniqueTestEmail('classic-history-player');
  let adminToken: string;
  let adminId: string;
  let playerToken: string;
  let playerId: string;

  /**
   * The ledger and audit tables are append-only by trigger, so their rows can
   * only be removed by TRUNCATE. The list is exactly the state this spec can
   * create (a wallet, a session, one paid round and its ledger entries) plus the
   * game-scoped mathematics rows; it is the same boundary the accepted Classic
   * DEFAULT spec uses in this gate database.
   */
  const TRUNCATE =
    'TRUNCATE TABLE "LuckyLadyPayoutActivation", "GameActiveMathProfile", "GameMathProfileValidation", ' +
    '"GameMathProfile", "GamePreparedOutcome", "GameSession", "CasinoTransaction", "CasinoRoundAction", ' +
    '"CasinoRound", "LedgerEntry", "RefreshToken", "AuditLog", "Wallet", "User" CASCADE';

  beforeAll(async () => {
    process.env.SPORTS_SETTLEMENT_ENABLED = 'false';
    // The recorded scope decision: without it any paying profile is refused.
    process.env.MATH_CONTROL_GAMBLE_SCOPE_DECISION = 'EXCLUDE_OPTIONAL_GAMBLE';
    await prisma.$connect();
    await prisma.$executeRawUnsafe(TRUNCATE);
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
    await redis.client.flushdb();
    const hash = await argon2.hash(password);
    const [admin, player] = await Promise.all([
      prisma.user.create({ data: { email: adminEmail, passwordHash: hash, role: 'SUPER_ADMIN', wallet: { create: {} } } }),
      prisma.user.create({ data: { email: playerEmail, passwordHash: hash, wallet: { create: {} } } }),
    ]);
    adminId = admin.id;
    playerId = player.id;
    adminToken = (await auth.login(adminEmail, password)).pair.accessToken;
    playerToken = (await auth.login(playerEmail, password)).pair.accessToken;
  }, 120_000);

  afterAll(async () => {
    if (app) await app.close();
    // Leave the shared test database empty so an unrelated spec that expects a
    // pristine game still sees one.
    await prisma.$executeRawUnsafe(TRUNCATE).catch(() => undefined);
    await prisma.$disconnect();
    delete process.env.SPORTS_SETTLEMENT_ENABLED;
    delete process.env.MATH_CONTROL_GAMBLE_SCOPE_DECISION;
  }, 60_000);

  /** Only this spec's own game state, so no test depends on another test's rows. */
  beforeEach(async () => {
    await prisma.gameActiveMathProfile.deleteMany({ where: { gameId: { in: [CLASSIC_ID, LUCKY_LADY_PAYOUT_GAME_ID] } } });
    await prisma.luckyLadyPayoutActivation.deleteMany({ where: { gameId: { in: [CLASSIC_ID, LUCKY_LADY_PAYOUT_GAME_ID] } } });
    await prisma.gameMathProfileValidation.deleteMany({ where: { gameId: CLASSIC_ID } });
    await prisma.gameMathProfile.deleteMany({ where: { gameId: CLASSIC_ID } });
    // The admin throttle is per actor and shared across routes; a fresh window
    // keeps each test's HTTP calls independent of how many the previous one made.
    await redis.client.flushdb();
  }, 60_000);

  const bearer = (token: string) => `Bearer ${token}`;
  const server = () => app.getHttpServer();

  const pointer = (gameId: string) => prisma.gameActiveMathProfile.findUnique({ where: { gameId } });

  const current = async (gameId: string) =>
    (await request(server()).get(`/admin/casino/math/${gameId}`).set('authorization', bearer(adminToken)).expect(200)).body;

  const history = async (gameId: string, query = '') =>
    (await request(server())
      .get(`/admin/casino/math/${gameId}/history${query}`)
      .set('authorization', bearer(adminToken))
      .expect(200)).body as { gameId: string; entries: Array<Record<string, unknown>> };

  const activationChecks = (scope: string, provedMax: number) =>
    requiredActivationChecks(scope).map((id) => ({
      id,
      status: 'PASS',
      ...(id === 'MAX_WIN_PROVEN_WITHIN_CEILING' ? { value: { provedMax } } : {}),
    }));

  /**
   * The fixture's expected return, read from the artifact's own recorded
   * analytic metadata (the per-line `expectedRtpPercent` the Classic adapter
   * publishes on the payload) rather than re-derived by a generator, a Monte
   * Carlo run or a validation rerun.
   */
  const fixtureExpectedRtpPercent = (artifact: MathProfileArtifact): number => {
    const payload = artifact.payload as ClassicProfile;
    return Number(payload.tables['9'].expectedRtpPercent);
  };

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
        // The stored analytic object follows the real preview contract
        // (`ProfileAnalysis`): `exactRtpPercent` carries the artifact's own
        // recorded expected return, so the PREVIEW proof compares against this
        // fixture value instead of restating the requested target.
        analytic: {
          kind: 'SHARED_HISTORY_FIXTURE',
          exactRtpPercent: fixtureExpectedRtpPercent(artifact),
        } as Prisma.InputJsonValue,
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
  const classicCandidate = (profileId: string): MathProfileArtifact => {
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
      profileId,
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
   * The production runtime seam for a NEW paid round: a real ClassicAdapter over
   * the shared service, one real session and one real bet.
   */
  const playPaidRound = async (tokenHash: string, requestId: string, rngSeed: string) => {
    const registry = new CasinoGameRegistry();
    const capabilities = new GameCapabilityService(prisma, registry, configs);
    const platform: GamePlatform = {
      capabilities,
      wallet: new GameWalletService(),
      journal: new GameJournalService(prisma, capabilities),
      rounds: new GameRoundService(prisma),
    };
    const adapter = new ClassicAdapter(prisma, platform, configs, math, { rng: intRng(rngSeed) });
    await points.adminGrant(adminId, playerId, 10_000n, 'Classic shared history round funding', `grant-${requestId}`);
    const account = await prisma.user.findUniqueOrThrow({ where: { id: playerId }, select: { authVersion: true } });
    const session = await prisma.gameSession.create({
      data: {
        userId: playerId,
        gameId: CLASSIC_ID,
        tokenHash,
        expiresAt: new Date(Date.now() + 3_600_000),
        // Bound to the fixture account's session version (A2: an unbound
        // session fails closed instead of playing).
        authVersion: account.authVersion,
      },
    });
    const context = { gameId: CLASSIC_ID, userId: playerId, sessionId: session.id } as never;
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
    const round = await prisma.casinoRound.findFirstOrThrow({ where: { userId: playerId } });
    return { settings, played, state: round.privateState as unknown as ClassicState };
  };

  const activate = async (profileId: string, expectedVersion?: number) =>
    (await request(server())
      .post(`/admin/casino/math/${CLASSIC_ID}/profiles/${encodeURIComponent(profileId)}/activate`)
      .set('authorization', bearer(adminToken))
      .send(expectedVersion === undefined ? {} : { expectedVersion })
      .expect(201)).body;

  const restoreDefault = async (body: Record<string, unknown> = {}) =>
    (await request(server())
      .post(`/admin/casino/math/${CLASSIC_ID}/default`)
      .set('authorization', bearer(adminToken))
      .send(body)
      .expect(201)).body;

  const rollback = async (body: Record<string, unknown> = {}) =>
    (await request(server())
      .post(`/admin/casino/math/${CLASSIC_ID}/rollback`)
      .set('authorization', bearer(adminToken))
      .send(body)
      .expect(201)).body;

  it('records this game\'s own DEFAULT/GENERATED transitions in history', async () => {
    const a = classicCandidate(CLASSIC_PROFILE_A);
    const b = classicCandidate(CLASSIC_PROFILE_B);
    await seedValidatedProfile(a);
    await seedValidatedProfile(b);

    expect((await restoreDefault()).mode).toBe('DEFAULT');
    expect((await activate(CLASSIC_PROFILE_A)).profileId).toBe(CLASSIC_PROFILE_A);
    expect((await restoreDefault()).mode).toBe('DEFAULT');
    expect((await activate(CLASSIC_PROFILE_B)).profileId).toBe(CLASSIC_PROFILE_B);

    const body = await history(CLASSIC_ID);
    expect(body.gameId).toBe(CLASSIC_ID);
    expect(body.entries.map((entry) => entry.version)).toEqual([4, 3, 2, 1]);
    expect(body.entries.map((entry) => entry.action)).toEqual(['ACTIVATE', 'DEFAULT', 'ACTIVATE', 'DEFAULT']);
    expect(body.entries.map((entry) => entry.kind)).toEqual(['GENERATED', 'DEFAULT', 'GENERATED', 'DEFAULT']);
    expect(body.entries.map((entry) => entry.profileId)).toEqual([CLASSIC_PROFILE_B, null, CLASSIC_PROFILE_A, null]);
    expect(body.entries[0].profileHash).toBe(b.canonicalHash);
    expect(body.entries[2].profileHash).toBe(a.canonicalHash);
    // Every entry is an immutable recorded transition of this game, with a
    // pre-state snapshot; no other game's identity leaks in.
    expect(body.entries.every((entry) => typeof entry.id === 'string' && typeof entry.actionId === 'string')).toBe(true);
    expect(body.entries[1].previous).toMatchObject({ kind: 'GENERATED', version: 2, profileId: CLASSIC_PROFILE_A });
    expect(body.entries[3].previous).toEqual({ kind: 'DEFAULT', version: 0, profileId: null });
    expect(JSON.stringify(body)).not.toMatch(/lucky-lady/);
    expect(JSON.stringify(body)).not.toMatch(/deluxe/i);

    // The limit is honoured and stays scoped to this game.
    expect((await history(CLASSIC_ID, '?limit=2')).entries.map((entry) => entry.version)).toEqual([4, 3]);

    // With no recorded transition the rollback refuses rather than guessing.
    await prisma.luckyLadyPayoutActivation.deleteMany({ where: { gameId: CLASSIC_ID } });
    const nothing = await request(server())
      .post(`/admin/casino/math/${CLASSIC_ID}/rollback`)
      .set('authorization', bearer(adminToken))
      .send({})
      .expect(409);
    expect(nothing.body.code).toBe('GAME_MATH_NOTHING_TO_ROLLBACK');
  });

  it('rolls back to A, pins the next paid round to A, and touches no other game', async () => {
    const a = classicCandidate(CLASSIC_PROFILE_A);
    const b = classicCandidate(CLASSIC_PROFILE_B);
    await seedValidatedProfile(a);
    await seedValidatedProfile(b);

    await restoreDefault();
    await activate(CLASSIC_PROFILE_A);
    const second = await activate(CLASSIC_PROFILE_B);
    expect(second.profileId).toBe(CLASSIC_PROFILE_B);

    // A real other-game state so the isolation check is a real comparison.
    await prisma.gameActiveMathProfile.create({
      data: {
        gameId: LUCKY_LADY_PAYOUT_GAME_ID,
        profileRowId: null,
        profileId: LUCKY_LADY_DEFAULT_PROFILE_ID,
        profileHash: 'a'.repeat(64),
        validationId: null,
        kind: 'DEFAULT',
        payoutCandidateId: null,
        version: 7,
        activatedBy: adminId,
      },
    });
    await prisma.luckyLadyPayoutActivation.create({
      data: {
        gameId: LUCKY_LADY_PAYOUT_GAME_ID,
        actionId: 'll-isolation-seed-0001',
        action: 'DEFAULT',
        version: 7,
        previous: { semantics: 'seed', mode: 'DEFAULT', version: 6 } as Prisma.InputJsonValue,
        actorId: adminId,
      },
    });
    const other = {
      pointer: await prisma.gameActiveMathProfile.findMany({ where: { gameId: LUCKY_LADY_PAYOUT_GAME_ID } }),
      history: await prisma.luckyLadyPayoutActivation.count({ where: { gameId: LUCKY_LADY_PAYOUT_GAME_ID } }),
      audit: await prisma.auditLog.count({ where: { targetId: LUCKY_LADY_PAYOUT_GAME_ID } }),
    };

    // The pointer stands at version 3 (DEFAULT v1, A v2, B v3).
    const rolled = await rollback({ actionId: 'classic-rollback-0001', expectedVersion: 3 });
    expect(rolled).toMatchObject({
      gameId: CLASSIC_ID,
      action: 'ROLLBACK',
      replay: false,
      version: 4,
      kind: 'GENERATED',
      profileId: CLASSIC_PROFILE_A,
      profileHash: a.canonicalHash,
      candidateId: null,
    });
    expect(rolled.validationId).toEqual(expect.any(String));
    expect(rolled.activatedAt).toEqual(expect.any(String));

    // CURRENT proves the restored profile and the new monotonic revision.
    const currentAfter = await current(CLASSIC_ID);
    expect(currentAfter.active).toMatchObject({
      kind: 'GENERATED',
      version: 4,
      profileId: CLASSIC_PROFILE_A,
      profileHash: a.canonicalHash,
      payoutCandidateId: null,
    });
    await expect(math.activeProfile(CLASSIC_ID)).resolves.toMatchObject({ version: 4 });
    expect((await math.activeProfile(CLASSIC_ID))?.artifact.canonicalHash).toBe(a.canonicalHash);

    // The rollback itself is an immutable history entry with clear prior-version
    // semantics: it replaced version 3 (B) and restored version 2 (A).
    const entries = (await history(CLASSIC_ID)).entries;
    expect(entries[0]).toMatchObject({
      action: 'ROLLBACK',
      kind: 'GENERATED',
      version: 4,
      profileId: CLASSIC_PROFILE_A,
      target: { kind: 'GENERATED', version: 2, profileId: CLASSIC_PROFILE_A },
      previous: { kind: 'GENERATED', version: 3, profileId: CLASSIC_PROFILE_B },
    });
    expect(entries.map((entry) => entry.version)).toEqual([4, 3, 2, 1]);

    // An exact replay of the action id returns the recorded transition.
    const replay = await rollback({ actionId: 'classic-rollback-0001', expectedVersion: 3 });
    expect(replay).toMatchObject({ replay: true, version: 4, profileId: CLASSIC_PROFILE_A });
    expect((await history(CLASSIC_ID)).entries.length).toBe(4);

    // The next NEW paid round pins exactly the restored artifact.
    const round = await playPaidRound('f'.repeat(64), 'classic-history-round-1', 'classic-history-seed-1');
    expect(round.settings.serverResponse.mathConfig).toMatchObject({
      activeMathProfile: CLASSIC_PROFILE_A,
      profileHash: a.canonicalHash,
    });
    expect(round.played.recovery.profile).toEqual({ id: CLASSIC_PROFILE_A, hash: a.canonicalHash, version: 4 });
    expect(round.state).toMatchObject({ profileId: CLASSIC_PROFILE_A });

    // ---- the exact chain continues past the rollback: an EXPLICIT DEFAULT,
    // then a fresh ACTIVATE of B. A rollback onto DEFAULT is a different
    // transition and is deliberately not substituted for the explicit reset.
    const explicitDefault = await restoreDefault({
      actionId: 'classic-default-after-rollback-0001',
      expectedVersion: 4,
    });
    expect(explicitDefault).toMatchObject({
      mode: 'DEFAULT',
      version: 5,
      profileId: CLASSIC_DEFAULT_PROFILE_ID,
      profileHash: defaultClassicProfile().hash,
    });
    expect(await pointer(CLASSIC_ID)).toMatchObject({
      kind: 'DEFAULT',
      profileRowId: null,
      profileId: CLASSIC_DEFAULT_PROFILE_ID,
      profileHash: defaultClassicProfile().hash,
      version: 5,
    });
    // The runtime seam falls back to the game's registered default; CURRENT
    // reports the registered default identity at the new revision.
    await expect(math.activeProfile(CLASSIC_ID)).resolves.toBeNull();
    expect((await current(CLASSIC_ID)).active).toMatchObject({
      kind: 'DEFAULT',
      version: 5,
      profileId: CLASSIC_DEFAULT_PROFILE_ID,
      profileHash: defaultClassicProfile().hash,
    });

    // ACTIVATE B again: the live state is genuinely B and the stale DEFAULT is
    // gone from the runtime seam.
    const reactivated = await activate(CLASSIC_PROFILE_B, 5);
    expect(reactivated).toMatchObject({ profileId: CLASSIC_PROFILE_B, version: 6 });
    expect(await pointer(CLASSIC_ID)).toMatchObject({
      kind: 'GENERATED',
      profileRowId: expect.any(String),
      profileId: CLASSIC_PROFILE_B,
      profileHash: b.canonicalHash,
      payoutCandidateId: null,
      version: 6,
    });
    const effective = await math.activeProfile(CLASSIC_ID);
    expect(effective?.version).toBe(6);
    expect(effective?.artifact.canonicalHash).toBe(b.canonicalHash);
    expect((await current(CLASSIC_ID)).active).toMatchObject({
      kind: 'GENERATED',
      version: 6,
      profileId: CLASSIC_PROFILE_B,
      profileHash: b.canonicalHash,
    });

    // The whole chain is one monotonic, game-scoped history: no version is
    // skipped and no other game's identity leaks in.
    const chain = (await history(CLASSIC_ID)).entries;
    expect(chain.map((entry) => [entry.action, entry.kind, entry.version])).toEqual([
      ['ACTIVATE', 'GENERATED', 6],
      ['DEFAULT', 'DEFAULT', 5],
      ['ROLLBACK', 'GENERATED', 4],
      ['ACTIVATE', 'GENERATED', 3],
      ['ACTIVATE', 'GENERATED', 2],
      ['DEFAULT', 'DEFAULT', 1],
    ]);
    expect(chain.map((entry) => entry.profileId)).toEqual([
      CLASSIC_PROFILE_B,
      null,
      CLASSIC_PROFILE_A,
      CLASSIC_PROFILE_B,
      CLASSIC_PROFILE_A,
      null,
    ]);
    expect(JSON.stringify(chain)).not.toMatch(/lucky-lady/);
    expect(JSON.stringify(chain)).not.toMatch(/deluxe/i);

    // No cross-game mutation and nothing unintegrated was touched, across the
    // entire transition chain.
    expect(await prisma.gameActiveMathProfile.findMany({ where: { gameId: LUCKY_LADY_PAYOUT_GAME_ID } })).toEqual(other.pointer);
    expect(await prisma.luckyLadyPayoutActivation.count({ where: { gameId: LUCKY_LADY_PAYOUT_GAME_ID } })).toBe(other.history);
    expect(await prisma.auditLog.count({ where: { targetId: LUCKY_LADY_PAYOUT_GAME_ID } })).toBe(other.audit);
    expect(await prisma.gameActiveMathProfile.count({ where: { gameId: DELUXE_GAME_ID } })).toBe(0);
  });

  it('rolls back onto the registered DEFAULT, then activates B with no stale tombstone', async () => {
    const a = classicCandidate(CLASSIC_PROFILE_A);
    const b = classicCandidate(CLASSIC_PROFILE_B);
    await seedValidatedProfile(a);
    await seedValidatedProfile(b);

    await restoreDefault();
    await activate(CLASSIC_PROFILE_A);
    const rolled = await rollback({ actionId: 'classic-rollback-0002' });
    expect(rolled).toMatchObject({
      action: 'ROLLBACK',
      version: 3,
      kind: 'DEFAULT',
      profileId: CLASSIC_DEFAULT_PROFILE_ID,
      profileHash: defaultClassicProfile().hash,
      candidateId: null,
    });

    // The game is on the DEFAULT tombstone carrying its own registered default
    // identity, and the runtime seam returns null for it.
    expect(await pointer(CLASSIC_ID)).toMatchObject({
      kind: 'DEFAULT',
      profileRowId: null,
      profileId: CLASSIC_DEFAULT_PROFILE_ID,
      profileHash: defaultClassicProfile().hash,
      version: 3,
    });
    await expect(math.activeProfile(CLASSIC_ID)).resolves.toBeNull();
    const currentDefault = await current(CLASSIC_ID);
    expect(currentDefault.active).toMatchObject({ kind: 'DEFAULT', version: 3, profileId: CLASSIC_DEFAULT_PROFILE_ID });

    // Activating B again produces a GENUINE CUSTOM state, not the stale tombstone.
    const reactivated = await activate(CLASSIC_PROFILE_B, 3);
    expect(reactivated).toMatchObject({ profileId: CLASSIC_PROFILE_B, version: 4 });
    expect(await pointer(CLASSIC_ID)).toMatchObject({
      kind: 'GENERATED',
      profileRowId: expect.any(String),
      profileId: CLASSIC_PROFILE_B,
      profileHash: b.canonicalHash,
      payoutCandidateId: null,
      version: 4,
    });
    expect((await math.activeProfile(CLASSIC_ID))?.artifact.canonicalHash).toBe(b.canonicalHash);
    const currentCustom = await current(CLASSIC_ID);
    expect(currentCustom.active).toMatchObject({ kind: 'GENERATED', version: 4, profileId: CLASSIC_PROFILE_B });

    const entries = (await history(CLASSIC_ID)).entries;
    expect(entries.map((entry) => [entry.action, entry.kind, entry.version])).toEqual([
      ['ACTIVATE', 'GENERATED', 4],
      ['ROLLBACK', 'DEFAULT', 3],
      ['ACTIVATE', 'GENERATED', 2],
      ['DEFAULT', 'DEFAULT', 1],
    ]);
    // The rollback undid the activation of A, so it restored the DEFAULT state
    // that activation replaced (the game's own registered default identity).
    expect(entries[1].target).toEqual({ kind: 'DEFAULT', version: 1, profileId: null });
    expect(entries[0].previous).toEqual({ kind: 'DEFAULT', version: 3, profileId: null });
  });

  it('serves the real PREVIEW detail with zero activation effect', async () => {
    const a = classicCandidate(CLASSIC_PROFILE_A);
    await seedValidatedProfile(a);
    await activate(CLASSIC_PROFILE_A);
    await restoreDefault();

    const before = await current(CLASSIC_ID);
    const beforePointer = await pointer(CLASSIC_ID);
    const beforeHistory = (await history(CLASSIC_ID)).entries.length;

    const preview = (await request(server())
      .get(`/admin/casino/math/${CLASSIC_ID}/profiles/${encodeURIComponent(CLASSIC_PROFILE_A)}`)
      .set('authorization', bearer(adminToken))
      .expect(200)).body;
    expect(preview.profile).toMatchObject({
      gameId: CLASSIC_ID,
      profileId: CLASSIC_PROFILE_A,
      canonicalHash: a.canonicalHash,
      status: 'VALIDATED',
    });
    expect(Number(preview.profile.targetRtpPercent)).toBe(a.policy.targetRtpPercent);
    expect(Number(preview.profile.maxWinMultiplier)).toBe(a.policy.maxWinMultiplier);
    // Explicit expected-RTP proof through the real PREVIEW payload: the stored
    // analytic object exposes the fixture's own recorded expected return under
    // the actual `ProfileAnalysis` field, coherent with this profile's expected
    // target (the accepted 0.01pp validation tolerance) and identity - never a
    // restatement of `targetRtpPercent`.
    const fixtureRtpPercent = fixtureExpectedRtpPercent(a);
    const previewAnalytic = preview.profile.analytic as { exactRtpPercent?: number | null };
    expect(previewAnalytic.exactRtpPercent).toBeCloseTo(fixtureRtpPercent, 8);
    expect(Math.abs(Number(previewAnalytic.exactRtpPercent) - a.policy.targetRtpPercent)).toBeLessThanOrEqual(0.01);
    expect(preview.profile.profileId).toBe(CLASSIC_PROFILE_A);
    expect(preview.profile.policy).toMatchObject({ gameId: CLASSIC_ID, maxWinScope: 'RESOLVED_SPIN', maxWinEnabled: true });
    expect(preview.validations[0]).toMatchObject({ result: 'PASS', metrics: { grade: 'ACTIVATION' } });
    expect(preview.active).toBe(false);
    expect(JSON.stringify(preview)).not.toMatch(/lucky-lady/);
    expect(JSON.stringify(preview)).not.toMatch(/deluxe/i);

    // Reading a candidate is not an activation: CURRENT, the pointer and the
    // history are all byte-identical afterwards.
    expect(await current(CLASSIC_ID)).toEqual(before);
    expect(await pointer(CLASSIC_ID)).toEqual(beforePointer);
    expect((await history(CLASSIC_ID)).entries.length).toBe(beforeHistory);
  });

  it('keeps the legacy Lucky Lady routes and delegates the generic rollback to its panel', async () => {
    // A candidate-less CUSTOM state recorded by the shared lifecycle, exactly the
    // shape the panel's own history holds: the rollback target is DEFAULT.
    await prisma.gameActiveMathProfile.create({
      data: {
        gameId: LUCKY_LADY_PAYOUT_GAME_ID,
        profileRowId: null,
        profileId: 'lucky-lady.rtp50.v1',
        profileHash: 'b'.repeat(64),
        validationId: null,
        kind: 'DEFAULT',
        payoutCandidateId: null,
        version: 1,
        activatedBy: adminId,
      },
    });
    await prisma.luckyLadyPayoutActivation.create({
      data: {
        gameId: LUCKY_LADY_PAYOUT_GAME_ID,
        actionId: 'll-legacy-seed-activate-0001',
        action: 'ACTIVATE',
        candidateRowId: null,
        candidateId: null,
        modelProfileId: 'lucky-lady.rtp60.v1',
        modelHash: 'c'.repeat(64),
        version: 1,
        previous: {
          semantics: 'ACTIVATE:lucky-lady.rtp60.v1:expected=any',
          mode: 'DEFAULT',
          version: 0,
          profileId: null,
          candidateId: null,
          policyId: null,
          targetRtpPercent: null,
        } as Prisma.InputJsonValue,
        actorId: adminId,
      },
    });

    // Legacy history route: unchanged endpoint, unchanged ordering, unchanged shape.
    const legacyHistory = (await request(server())
      .get(`/admin/casino/math/${LUCKY_LADY_PAYOUT_GAME_ID}/payout/history`)
      .set('authorization', bearer(adminToken))
      .expect(200)).body;
    expect(legacyHistory.gameId).toBe(LUCKY_LADY_PAYOUT_GAME_ID);
    expect(legacyHistory.entries.map((entry: { action: string }) => entry.action)).toEqual(['ACTIVATE']);
    expect(legacyHistory.entries[0].previous.mode).toBe('DEFAULT');

    // Legacy rollback route: still the panel's own transition, still appending
    // one row and still landing on DEFAULT.
    const legacyRollback = (await request(server())
      .post(`/admin/casino/math/${LUCKY_LADY_PAYOUT_GAME_ID}/payout/rollback`)
      .set('authorization', bearer(adminToken))
      .send({ actionId: 'll-legacy-rollback-0001' })
      .expect(201)).body;
    expect(legacyRollback).toMatchObject({ action: 'ROLLBACK', replay: false, active: { mode: 'DEFAULT' } });
    expect(await prisma.luckyLadyPayoutActivation.count({ where: { gameId: LUCKY_LADY_PAYOUT_GAME_ID } })).toBe(2);

    // The generic route for a panel-owned game runs that same panel transition.
    const delegated = await math.rollback(adminId, LUCKY_LADY_PAYOUT_GAME_ID, { actionId: 'll-generic-rollback-0001' });
    expect(delegated).toMatchObject({ gameId: LUCKY_LADY_PAYOUT_GAME_ID, action: 'ROLLBACK', replay: false, kind: 'DEFAULT' });
    const genericHistory = await history(LUCKY_LADY_PAYOUT_GAME_ID);
    expect(genericHistory.entries.map((entry) => [entry.actionId, entry.action, entry.kind, entry.version])).toEqual([
      ['ll-generic-rollback-0001', 'ROLLBACK', 'DEFAULT', 3],
      ['ll-legacy-rollback-0001', 'ROLLBACK', 'DEFAULT', 2],
      ['ll-legacy-seed-activate-0001', 'ACTIVATE', 'GENERATED', 1],
    ]);
  });

  it('is ADMIN-only on the shared history and rollback routes and 404s an unintegrated game', async () => {
    const player = request(server());
    await player
      .get(`/admin/casino/math/${CLASSIC_ID}/history`)
      .set('authorization', bearer(playerToken))
      .expect(403);
    await player
      .post(`/admin/casino/math/${CLASSIC_ID}/rollback`)
      .set('authorization', bearer(playerToken))
      .send({})
      .expect(403);
    expect(await prisma.gameActiveMathProfile.count({ where: { gameId: CLASSIC_ID } })).toBe(0);

    const admin = request(server());
    const missingHistory = await admin
      .get(`/admin/casino/math/${DELUXE_GAME_ID}/history`)
      .set('authorization', bearer(adminToken))
      .expect(404);
    expect(missingHistory.body.code).toBe('GAME_MATH_NOT_INTEGRATED');
    const missingRollback = await admin
      .post(`/admin/casino/math/${DELUXE_GAME_ID}/rollback`)
      .set('authorization', bearer(adminToken))
      .send({})
      .expect(404);
    expect(missingRollback.body.code).toBe('GAME_MATH_NOT_INTEGRATED');
    expect(await prisma.gameActiveMathProfile.count({ where: { gameId: DELUXE_GAME_ID } })).toBe(0);
  });
});
