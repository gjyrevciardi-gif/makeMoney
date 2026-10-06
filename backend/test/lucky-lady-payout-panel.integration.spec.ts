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
import { LuckyLadyPayoutService } from '../src/casino/games/lucky-lady/payout/lucky-lady-payout.service';
import { LUCKY_LADY_GAME_ID, loadVerifiedMath } from '../src/casino/games/lucky-lady/lucky-lady.math';
import { LuckyLadyAdapter } from '../src/casino/games/lucky-lady/lucky-lady.adapter';
import { PrismaService } from '../src/prisma.service';
import { PointsService } from '../src/wallet/points.service';
import { uniqueTestEmail } from './test-identity';

// A single evidence run is a real 80-session x 5 000-spin bankroll cohort
// through the accepted simulator, so the whole-suite timeout is generous.
jest.setTimeout(900_000);

/**
 * Admin RTP Control panel lifecycle on the real platform.
 *
 * ADMIN-only surface, database role checks, candidate generation + preview,
 * tamper rejection, validated-only activation with CAS and replay, the runtime
 * pin for NEW paid rounds, append-only history across a restart, honest
 * unsupported reasons, and the immutable golden default.
 *
 * Requires an isolated *_test PostgreSQL database and Redis, like the other
 * integration suites. `MATH_CONTROL_JOB_TIMEOUT_MS` is raised because the real
 * 80 x 5 000 evidence run is intentional.
 */
describe('lucky lady payout panel (PostgreSQL + Redis)', () => {
  const prisma = new PrismaService();
  let app: INestApplication;
  let auth: AuthService;
  let payout: LuckyLadyPayoutService;
  let math: MathControlService;
  let points: PointsService;
  let redis: RedisService;

  const password = 'correct-horse-battery';
  const userEmail = uniqueTestEmail('payout-user');
  const adminEmail = uniqueTestEmail('payout-admin');
  let userToken: string;
  let adminToken: string;

  const GOLDEN_HASH = 'eb0a22171a3479cea3b0238269edd4b0dc5d9486c57e4b057fa6ee0f1a70be5f';

  beforeAll(async () => {
    process.env.SPORTS_SETTLEMENT_ENABLED = 'false';
    process.env.MATH_CONTROL_GAMBLE_SCOPE_DECISION = 'EXCLUDE_OPTIONAL_GAMBLE';
    process.env.MATH_CONTROL_JOB_TIMEOUT_MS = '600000';
    process.env.MATH_CONTROL_INPROCESS = '1';
    await prisma.$connect();
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalInterceptors(new BigIntInterceptor());
    await app.init();
    auth = app.get(AuthService);
    payout = app.get(LuckyLadyPayoutService);
    math = app.get(MathControlService);
    points = app.get(PointsService);
    redis = app.get(RedisService);
    await redis.ensureConnected();
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
    delete process.env.SPORTS_SETTLEMENT_ENABLED;
    delete process.env.MATH_CONTROL_GAMBLE_SCOPE_DECISION;
    delete process.env.MATH_CONTROL_JOB_TIMEOUT_MS;
    delete process.env.MATH_CONTROL_INPROCESS;
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "LuckyLadyPayoutActivation", "LuckyLadyPayoutValidation", "LuckyLadyPayoutCandidate", ' +
      '"GameActiveMathProfile", "GameMathProfileValidation", "GameMathProfile", "GamePreparedOutcome", ' +
      '"GameSession", "GameLaunchCapability", "CasinoGameConfigVersion", "CasinoGameConfig", ' +
      '"PlatformSettings", "CasinoTransaction", "CasinoRoundAction", "CasinoRound", "CasinoGameFavorite", ' +
      '"LedgerEntry", "BetLeg", "Bet", "AuditLog", "RefreshToken", "Wallet", "User" CASCADE',
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

  const adminId = async () => (await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } })).id;

  it('is ADMIN-only and DB-rechecks the role, including a demoted admin', async () => {
    const player = request(app.getHttpServer());
    await player.get('/admin/casino/math/lucky-lady/payout/current').set('authorization', `Bearer ${userToken}`).expect(403);
    await player.post('/admin/casino/math/lucky-lady/payout/generate')
      .set('authorization', `Bearer ${userToken}`)
      .send({ targetRtpPercent: 50, maxWinMultiplier: 50, style: 'BALANCED' })
      .expect(403);
    await player.post('/admin/casino/math/lucky-lady/payout/default')
      .set('authorization', `Bearer ${userToken}`)
      .send({ actionId: 'nope-0000-0000-0000' })
      .expect(403);

    // A token that was valid when minted is rejected once the role is removed,
    // because the service re-reads the role from the database.
    const actor = await adminId();
    await prisma.user.update({ where: { id: actor }, data: { role: 'USER' } });
    await expect(payout.current(actor)).rejects.toMatchObject({ response: { message: 'ADMIN_REQUIRED' } });
    const denied = await prisma.auditLog.findFirst({ where: { action: 'PERMISSION_DENIED', actorId: actor } });
    expect(denied).not.toBeNull();
    await prisma.user.update({ where: { id: actor }, data: { role: 'ADMIN' } });
  });

  it('starts on the immutable golden default, not a generated policy', async () => {
    const actor = await adminId();
    const current = await payout.current(actor);
    expect(current.active.mode).toBe('DEFAULT');
    expect(current.active.profileId).toBeNull();
    expect(current.defaultProfile.profileId).toBe('lucky-lady.rtp50.v1');
    expect(current.defaultProfile.profileHash).toBe(GOLDEN_HASH);
    expect(current.defaultProfile.rtpPercent).toBe(50);
    // First-ever no-pointer state: `activeProfile` returns null, so the game runs
    // its accepted frozen mathematics.
    expect(await math.activeProfile(LUCKY_LADY_GAME_ID)).toBeNull();
  });

  it('refuses an unsupported max-win and reports it honestly', async () => {
    const actor = await adminId();
    await expect(payout.generate(actor, { targetRtpPercent: 70, maxWinMultiplier: 100, style: 'BALANCED' }))
      .rejects.toMatchObject({ response: { code: 'PAYOUT_MAX_WIN_UNSUPPORTED' } });
    await expect(
      request(app.getHttpServer())
        .post('/admin/casino/math/lucky-lady/payout/generate')
        .set('authorization', `Bearer ${adminToken}`)
        .send({ targetRtpPercent: 70, maxWinMultiplier: 100 })
        .expect(400),
    ).resolves.toBeDefined();
  });

  it('generates a VALIDATED candidate with reconciling weights and a stored report', async () => {
    const actor = await adminId();
    const http = request(app.getHttpServer());

    const generated = await http
      .post('/admin/casino/math/lucky-lady/payout/generate')
      .set('authorization', `Bearer ${adminToken}`)
      .send({ targetRtpPercent: 70, maxWinMultiplier: 50, style: 'RETENTION' })
      .expect(201);

    expect(generated.body.status).toBe('VALIDATED');
    const candidateId = generated.body.candidate.candidateId as string;
    const weights = generated.body.candidate.weights as { percent: number }[];
    expect(weights.length).toBeGreaterThan(0);
    expect(Number(weights.reduce((sum, entry) => sum + entry.percent, 0).toFixed(3))).toBe(100);
    expect(generated.body.metrics.verdict).toBe('PASS');
    expect(generated.body.metrics.sampleSessions).toBe(80);

    const preview = await http
      .get(`/admin/casino/math/lucky-lady/payout/candidates/${encodeURIComponent(candidateId)}`)
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(preview.body.candidate.candidateId).toBe(candidateId);
    // Preview must report the stored validation status, not a default GENERATED.
    expect(preview.body.candidate.status).toBe('VALIDATED');
    expect(preview.body.report.testOnly).toBe(true);
    expect(preview.body.report.activation).toBe(false);

    const current = await payout.current(actor);
    expect(current.active.mode).toBe('DEFAULT');
    expect(current.candidateCount).toBe(1);
  });

  it('tracks the exact active candidate across a same-model switch', async () => {
    const actor = await adminId();
    // Both candidates use the same declared bounded model (cap 50); only the
    // solved policy differs. An active pointer must name the exact candidate,
    // not "the latest row built on that model".
    const first = await payout.generate(actor, { targetRtpPercent: 70, maxWinMultiplier: 50, style: 'RETENTION' });
    expect(first.status).toBe('VALIDATED');
    if (first.status !== 'VALIDATED') return;
    await payout.activate(actor, first.candidate.candidateId, { actionId: 'same-model-activate-a', expectedVersion: 0 });

    const second = await payout.generate(actor, { targetRtpPercent: 63.5, maxWinMultiplier: 50, style: 'BALANCED' });
    expect(second.status).toBe('VALIDATED');
    if (second.status !== 'VALIDATED') return;

    // Generating a same-model candidate must not move the active state.
    const afterGenerate = await payout.current(actor);
    expect(afterGenerate.active.policyHash).toBe(first.candidate.policyHash);
    expect(afterGenerate.active.policyHash).not.toBe(second.candidate.policyHash);

    const list = await payout.candidates(actor);
    const firstRow = list.candidates.find((entry) => entry.candidateId === first.candidate.candidateId);
    const secondRow = list.candidates.find((entry) => entry.candidateId === second.candidate.candidateId);
    expect(firstRow?.activated).toBe(true);
    expect(secondRow?.activated).toBe(false);

    // The runtime snapshot is the exact active candidate's distribution.
    const snapshotA = await payout.activePayoutSnapshot('lucky-lady');
    expect(snapshotA?.policyHash).toBe(first.candidate.policyHash);
    expect(snapshotA?.candidateId).toBe(first.candidate.candidateId);

    // Switching to the second candidate moves the snapshot to its distribution
    // even though the model hash is identical.
    await payout.activate(actor, second.candidate.candidateId, { actionId: 'same-model-activate-b', expectedVersion: 1 });
    const snapshotB = await payout.activePayoutSnapshot('lucky-lady');
    expect(snapshotB?.policyHash).toBe(second.candidate.policyHash);
    expect(snapshotB?.candidateId).toBe(second.candidate.candidateId);
    expect(snapshotB?.policyHash).not.toBe(snapshotA?.policyHash);
  });

  it('reports an infeasible request with per-constraint reasons and no candidate', async () => {
    const actor = await adminId();
    const outcome = await payout.generate(actor, {
      targetRtpPercent: 70,
      maxWinMultiplier: 50,
      style: 'CUSTOM',
      constraints: { minFeatureWeightFraction: '0.9' },
    });
    expect(outcome.status).toBe('INFEASIBLE');
    if (outcome.status === 'INFEASIBLE' || outcome.status === 'SEARCH_EXHAUSTED' || outcome.status === 'REJECTED' || outcome.status === 'GENERATED') {
      expect(outcome.message).toMatch(/infeasible/i);
      expect(outcome.reasons.length).toBeGreaterThan(0);
    }
    const current = await payout.current(actor);
    expect(current.active.mode).toBe('DEFAULT');
    expect(current.candidateCount).toBe(0);
  });

  it('refuses activation of an unvalidated or tampered candidate', async () => {
    const actor = await adminId();
    const generated = await payout.generate(actor, { targetRtpPercent: 50, maxWinMultiplier: 50, style: 'BALANCED' });
    expect(generated.status).toBe('VALIDATED');
    if (generated.status !== 'VALIDATED') return;
    const candidateId = generated.candidate.candidateId;

    // Flip the stored validation to a non-passing status: activation must
    // refuse even though the candidate row still exists.
    await prisma.luckyLadyPayoutValidation.updateMany({ where: { gameId: LUCKY_LADY_GAME_ID, candidateId }, data: { status: 'GENERATED' } });
    await expect(
      payout.activate(actor, candidateId, { actionId: 'act-unvalidated-0001' }),
    ).rejects.toMatchObject({ response: { code: 'PAYOUT_CANDIDATE_NOT_VALIDATED' } });

    // Restore a passing validation, then tamper with a *structurally valid*
    // frozen distribution: the hash no longer matches and activation fails closed.
    await prisma.luckyLadyPayoutValidation.updateMany({ where: { gameId: LUCKY_LADY_GAME_ID, candidateId }, data: { status: 'VALIDATED' } });
    const stored = await prisma.luckyLadyPayoutCandidate.findUniqueOrThrow({
      where: { gameId_candidateId: { gameId: LUCKY_LADY_GAME_ID, candidateId } },
    });
    const policy = stored.distributionPolicy as Record<string, unknown>;
    const weights = { ...(policy.weights as Record<string, number>) };
    const firstClass = Object.keys(weights)[0];
    weights[firstClass] = (weights[firstClass] ?? 0) + 1;
    await prisma.luckyLadyPayoutCandidate.updateMany({
      where: { gameId: LUCKY_LADY_GAME_ID, candidateId },
      data: { distributionPolicy: { ...policy, weights } as unknown as object },
    });
    await expect(
      payout.activate(actor, candidateId, { actionId: 'act-tampered-0001' }),
    ).rejects.toMatchObject({ response: { code: 'PAYOUT_DISTRIBUTION_HASH_MISMATCH' } });
  });

  it('activates atomically, replays the same action id, and refuses a stale version', async () => {
    const actor = await adminId();
    const generated = await payout.generate(actor, { targetRtpPercent: 70, maxWinMultiplier: 50, style: 'RETENTION' });
    expect(generated.status).toBe('VALIDATED');
    if (generated.status !== 'VALIDATED') return;
    const candidateId = generated.candidate.candidateId;

    const actionId = 'activate-70-retention-0001';
    const first = await payout.activate(actor, candidateId, { actionId, expectedVersion: 0 });
    expect(first.replay).toBe(false);
    expect(first.version).toBe(1);
    expect(first.active.mode).toBe('CUSTOM');
    expect(first.active.policyHash).toBe(generated.candidate.policyHash);

    // A stale revision is refused.
    await expect(
      payout.activate(actor, candidateId, { actionId: 'activate-stale-0001', expectedVersion: 0 }),
    ).rejects.toMatchObject({ response: { code: 'PAYOUT_ACTIVE_CONFLICT' } });

    // An exact replay of the same action id is idempotent.
    const replay = await payout.activate(actor, candidateId, { actionId, expectedVersion: 0 });
    expect(replay.replay).toBe(true);
    expect(replay.version).toBe(1);

    // The same action id with different semantics conflicts.
    await expect(
      payout.activate(actor, candidateId, { actionId, expectedVersion: 5 }),
    ).rejects.toMatchObject({ response: { code: 'PAYOUT_ACTION_ID_CONFLICT' } });

    // Concurrent double activation is serialised to exactly one transition: one
    // wins, the other loses its CAS rather than duplicating or conflicting.
    const before = await payout.current(actor);
    const settled = await Promise.allSettled([
      payout.activate(actor, candidateId, { actionId: 'concurrent-0001', expectedVersion: before.active.version }),
      payout.activate(actor, candidateId, { actionId: 'concurrent-0002', expectedVersion: before.active.version }),
    ]);
    expect(settled.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter((entry) => entry.status === 'rejected')).toHaveLength(1);
    const after = await payout.current(actor);
    expect(after.active.version).toBe(before.active.version + 1);
  });

  it('pins a NEW paid round to the active policy and keeps it through default and rollback', async () => {
    const adapter = app.get(LuckyLadyAdapter);
    const player = await prisma.user.findUniqueOrThrow({ where: { email: userEmail } });
    const actor = await adminId();
    const context = { gameId: LUCKY_LADY_GAME_ID, userId: player.id, sessionId: '11111111-2222-4333-8444-555555555555' };

    const generated = await payout.generate(actor, { targetRtpPercent: 70, maxWinMultiplier: 50, style: 'RETENTION' });
    expect(generated.status).toBe('VALIDATED');
    if (generated.status !== 'VALIDATED') return;
    const activated = await payout.activate(actor, generated.candidate.candidateId, { actionId: 'pin-activate-0001' });
    expect(activated.active.mode).toBe('CUSTOM');

    await points.adminGrant(actor, player.id, 500_000n, 'payout panel pin probe', 'payout-fund-1');
    await adapter.execute(context, {
      event: 'bet',
      body: { slotEvent: 'bet', slotBet: 1, slotLines: 10 },
      headers: { 'x-pilot-version': '1', 'x-pilot-round': 'none' },
      requestId: 'payout-pin-round-1',
    });
    const played = await prisma.casinoRound.findFirstOrThrow({
      where: { userId: player.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const pinned = played.privateState as { profileId: string; profileHash: string; distribution: unknown };
    expect(pinned.profileId).toBe(generated.candidate.modelId);
    expect(pinned.profileHash).toBe(generated.candidate.modelHash);
    expect(pinned.distribution).not.toBeNull();

    // Acknowledge round 1's authoritative result (the presentation gate).
    const firstAction = await prisma.casinoRoundAction.findFirstOrThrow({
      where: { userId: player.id, gameId: LUCKY_LADY_GAME_ID },
      orderBy: [{ seq: 'desc' }],
    });
    const ackFirst = await adapter.read(context, 'ack', {
      actionId: firstAction.idempotencyKey.slice(`${player.id}:`.length),
    }) as { accepted?: boolean };
    expect(ackFirst.accepted).toBe(true);

    // Round 1 may settle into PENDING_WIN (a paying round). Collect it before a
    // new paid round may open.
    const currentState = await prisma.casinoRound.findUniqueOrThrow({ where: { id: played.id } });
    const currentVersion = (currentState.privateState as { version?: number }).version ?? 1;
    if ((currentState.privateState as { phase?: string }).phase === 'PENDING_WIN') {
      const collected = await adapter.execute(context, {
        event: 'recoveryCollect',
        body: { slotEvent: 'recoveryCollect' },
        headers: { 'x-pilot-version': String(currentVersion), 'x-pilot-round': played.id },
        requestId: 'payout-pin-collect-1',
      }) as { recovery?: { version?: number } };
      expect(collected.recovery).toBeDefined();
    }

    // The last authoritative action (the collect, if one ran) must also be
    // acknowledged before the next paid round opens.
    const latestBeforeDefault = await prisma.casinoRoundAction.findFirstOrThrow({
      where: { userId: player.id, gameId: LUCKY_LADY_GAME_ID },
      orderBy: [{ seq: 'desc' }],
    });
    const ackLatest = await adapter.read(context, 'ack', {
      actionId: latestBeforeDefault.idempotencyKey.slice(`${player.id}:`.length),
    }) as { accepted?: boolean };
    expect(ackLatest.accepted).toBe(true);

    // Default restores the golden maths and clears the runtime distribution, but
    // the old round keeps its pin.
    const restored = await payout.restoreDefault(actor, { actionId: 'pin-default-0001' });
    expect(restored.active.mode).toBe('DEFAULT');
    expect(await math.activeProfile(LUCKY_LADY_GAME_ID)).toBeNull();
    const afterDefault = await prisma.casinoRound.findUniqueOrThrow({ where: { id: played.id } });
    expect((afterDefault.privateState as { profileId: string }).profileId).toBe(generated.candidate.modelId);

    // A NEW round now uses the golden default (no pin). `currentRound` returns
    // the most recent round regardless of settlement, so the guard for round 2
    // names round 1's stored version/id.
    const beforeSecond = await prisma.casinoRound.findUniqueOrThrow({ where: { id: played.id } });
    const secondVersion = (beforeSecond.privateState as { version?: number }).version ?? 1;
    const secondResult = await adapter.execute(context, {
      event: 'bet',
      body: { slotEvent: 'bet', slotBet: 1, slotLines: 10 },
      headers: { 'x-pilot-version': String(secondVersion), 'x-pilot-round': played.id },
      requestId: 'payout-pin-round-2',
    }) as { responseEvent?: string };
    expect(secondResult.responseEvent).toBe('spin');
    const rounds = await prisma.casinoRound.findMany({
      where: { userId: player.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(rounds.length).toBe(2);
    const goldenRound = rounds[1];
    const settings = await adapter.read(context, 'getSettings', {}) as unknown as {
      serverResponse: { mathConfig: { activeMathProfile: string; profileHash: string } };
    };
    expect(settings.serverResponse.mathConfig.activeMathProfile).toBe('lucky-lady.rtp50.v1');
    expect((goldenRound.privateState as { profileId: string }).profileId).toBe('lucky-lady.rtp50.v1');
    expect((goldenRound.privateState as { distribution: unknown }).distribution).toBeNull();

    // Activate the same policy a second time, then default: the previous state
    // at that moment is the custom policy.
    await payout.activate(actor, generated.candidate.candidateId, { actionId: 'pin-reactivate-0001' });
    const defaultAgain = await payout.restoreDefault(actor, { actionId: 'pin-default-0002' });
    expect(defaultAgain.active.mode).toBe('DEFAULT');

    // Rollback undoes the most recent transition (the default) and restores the
    // custom policy that preceded it.
    const rolled = await payout.rollback(actor, { actionId: 'pin-rollback-0001' });
    expect(rolled.active.mode).toBe('CUSTOM');
    expect(rolled.active.modelHash).toBe(generated.candidate.modelHash);

    // A further rollback undoes the custom re-activation, returning to default
    // (a rollback can land on default).
    const rolledAgain = await payout.rollback(actor, { actionId: 'pin-rollback-0002' });
    expect(rolledAgain.active.mode).toBe('DEFAULT');
  });

  it('records append-only history that survives a restart and never deletes on default', async () => {
    const actor = await adminId();
    const generated = await payout.generate(actor, { targetRtpPercent: 50, maxWinMultiplier: 20, style: 'VOLATILE' });
    expect(generated.status).toBe('VALIDATED');
    if (generated.status !== 'VALIDATED') return;
    await payout.activate(actor, generated.candidate.candidateId, { actionId: 'hist-activate-0001' });
    await payout.restoreDefault(actor, { actionId: 'hist-default-0001' });
    await payout.rollback(actor, { actionId: 'hist-rollback-0001' });

    const history = await payout.history(actor);
    expect(history.entries.map((entry) => entry.action)).toEqual(['ROLLBACK', 'DEFAULT', 'ACTIVATE']);
    expect(history.entries[2].previous.mode).toBe('DEFAULT');
    expect(history.entries[0].previous.mode).toBe('DEFAULT');

    // Default did not delete the candidate.
    expect(await prisma.luckyLadyPayoutCandidate.count({ where: { gameId: LUCKY_LADY_GAME_ID } })).toBe(1);

    // A fresh service instance (a restart) reads the same durable history.
    const restarted = new LuckyLadyPayoutService(prisma, app.get(MathControlService)['jobs']);
    const reread = await restarted.history(actor);
    expect(reread.entries.length).toBe(3);
  });

  it('reports SEARCH_EXHAUSTED without implying infeasibility', async () => {
    const reached = await payout.generate(await adminId(), { targetRtpPercent: 63.5, maxWinMultiplier: 50, style: 'BALANCED' });
    if (reached.status === 'SEARCH_EXHAUSTED') {
      expect(reached.message).toMatch(/search-space limit/i);
      expect(reached.message).not.toMatch(/infeasible/i);
      return;
    }
    // The honest alternative outcomes are VALIDATED (the solver found it) or an
    // explicit INFEASIBLE/REJECTED with per-constraint reasons. A REJECTED
    // result must carry reasons rather than an empty refusal.
    expect(['VALIDATED', 'INFEASIBLE', 'REJECTED', 'GENERATED']).toContain(reached.status);
    if (reached.status !== 'VALIDATED') {
      expect(reached.reasons.length).toBeGreaterThan(0);
    }
  });

  it('keeps the golden default immutable across the whole lifecycle', async () => {
    const verified = loadVerifiedMath();
    expect(verified.profile.canonicalHash).toBe(GOLDEN_HASH);
    expect(verified.hashes.profileCanonicalHash).toBe(GOLDEN_HASH);
    expect(verified.profile.targetRtpPercent).toBe(50);
  });
});
