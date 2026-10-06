import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';
import { LuckyLadyAdapter } from '../src/casino/games/lucky-lady/lucky-lady.adapter';
import { LUCKY_LADY_GAME_ID } from '../src/casino/games/lucky-lady/lucky-lady.math';
import { LuckyLadyPayoutService } from '../src/casino/games/lucky-lady/payout/lucky-lady-payout.service';
import { RedisService } from '../src/common/redis.service';
import { PointsService } from '../src/wallet/points.service';
import { uniqueTestEmail } from './test-identity';

// One real candidate generation (~80 s) is part of this run; everything else is short.
jest.setTimeout(900_000);

/*
 * AVAILABILITY + INTEGRITY GATE for concurrent NEW paid rounds.
 *
 * Every scenario must complete all of its rounds with zero pool timeouts and zero
 * other errors, and keep integrity (one coherent DEFAULT-or-CUSTOM snapshot per
 * round, one debit, one action row, no redraw, balance == ledger, identical replay).
 *
 * The pool-1 scenario is the deterministic proof that a paid round never needs a
 * second pooled connection while its own transaction holds one: with a single
 * connection, any nested acquisition deadlocks until the pool timeout.
 *
 * Takes about 3 minutes (it generates one real candidate). Run it explicitly,
 * against an isolated *_test database, from `backend/`:
 *
 *   npm run test -- test/p1-snapshot-concurrency.integration.spec.ts --verbose
 */

const GOLDEN_PROFILE = 'lucky-lady.rtp50.v1';
const GOLDEN_HASH = 'eb0a22171a3479cea3b0238269edd4b0dc5d9486c57e4b057fa6ee0f1a70be5f';
const BASE_URL = process.env.DATABASE_URL as string;

const withPool = (limit: number, timeoutSeconds: number) => {
  const url = new URL(BASE_URL);
  url.searchParams.set('connection_limit', String(limit));
  url.searchParams.set('pool_timeout', String(timeoutSeconds));
  return url.toString();
};

type Metrics = {
  scenario: string; pool: number; concurrentRounds: number; flipping: boolean;
  completed: number; failed: number; poolOrTransactionStartErrors: number; otherErrors: number;
  errorSamples: string[]; durationMs: number;
  roundsWritten: number; usersWithMoreThanOneRound: number; duplicateDebits: number; duplicateActionRows: number;
  coherentDefault: number; coherentCustom: number; mixedSnapshots: number;
  balanceLedgerMismatches: number; failedRoundsWithSideEffects: number;
  replays: number; replayResponseMismatches: number; replayNewLedgerRows: number; flips: number;
};

describe('P1: snapshot transaction under concurrent NEW paid rounds (isolated PostgreSQL + Redis)', () => {
  const admin = new PrismaClient({ datasourceUrl: BASE_URL });
  const results: Metrics[] = [];
  let adminId: string;
  let candidate: { candidateId: string; modelProfileId: string; modelHash: string; policyHash: string; policyId: string };

  const build = async (pool: number): Promise<INestApplication> => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = withPool(pool, 10);
    try {
      const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
      const app = module.createNestApplication();
      await app.init();
      return app;
    } finally {
      process.env.DATABASE_URL = previous;
    }
  };

  beforeAll(async () => {
    process.env.SPORTS_SETTLEMENT_ENABLED = 'false';
    process.env.MATH_CONTROL_GAMBLE_SCOPE_DECISION = 'EXCLUDE_OPTIONAL_GAMBLE';
    process.env.MATH_CONTROL_JOB_TIMEOUT_MS = '600000';
    process.env.MATH_CONTROL_INPROCESS = '1';
    await admin.$connect();
    await admin.$executeRawUnsafe(
      'TRUNCATE TABLE "LuckyLadyPayoutActivation", "LuckyLadyPayoutValidation", "LuckyLadyPayoutCandidate", ' +
      '"GameActiveMathProfile", "GameMathProfileValidation", "GameMathProfile", "GamePreparedOutcome", ' +
      '"GameSession", "GameLaunchCapability", "CasinoGameConfigVersion", "CasinoGameConfig", "PlatformSettings", ' +
      '"CasinoTransaction", "CasinoRoundAction", "CasinoRound", "CasinoGameFavorite", "LedgerEntry", "BetLeg", ' +
      '"Bet", "AuditLog", "RefreshToken", "Wallet", "User" CASCADE',
    );
    adminId = (await admin.user.create({
      data: { email: uniqueTestEmail('p1-conc-admin'), passwordHash: 'x', role: 'ADMIN', wallet: { create: {} } },
    })).id;

    // One validated CUSTOM candidate, generated and activated through the real service.
    const app = await build(10);
    try {
      const payout = app.get(LuckyLadyPayoutService);
      const generated = await payout.generate(adminId, { targetRtpPercent: 70, maxWinMultiplier: 50, style: 'RETENTION' });
      expect(generated.status).toBe('VALIDATED');
      if (generated.status !== 'VALIDATED') return;
      await payout.activate(adminId, generated.candidate.candidateId, { actionId: 'p1-conc-activate-0000' });
      const row = await admin.luckyLadyPayoutCandidate.findFirstOrThrow({ where: { candidateId: generated.candidate.candidateId } });
      candidate = {
        candidateId: row.candidateId,
        modelProfileId: row.modelProfileId,
        modelHash: row.modelHash,
        policyHash: row.policyHash,
        policyId: (row.distributionPolicy as unknown as { policyId: string }).policyId,
      };
    } finally {
      await app.close();
    }
  });

  afterAll(async () => {
    await admin.$disconnect();
    delete process.env.SPORTS_SETTLEMENT_ENABLED;
    delete process.env.MATH_CONTROL_GAMBLE_SCOPE_DECISION;
    delete process.env.MATH_CONTROL_JOB_TIMEOUT_MS;
    delete process.env.MATH_CONTROL_INPROCESS;
    // eslint-disable-next-line no-console
    console.log(`P1_CONCURRENCY_RESULTS ${JSON.stringify(results, null, 2)}`);
    try {
      writeFileSync(join(__dirname, '..', '..', 'docs', 'agent-work', 'p0-verification', 'evidence', 'p1-snapshot-concurrency-metrics.json'), JSON.stringify(results, null, 2));
    } catch { /* evidence file is best effort; the console copy is authoritative */ }
  });

  const scenario = async (label: string, pool: number, count: number, flipping: boolean) => {
    const app = await build(pool);
    const redis = app.get(RedisService);
    await redis.ensureConnected();
    try {
      const adapter = app.get(LuckyLadyAdapter);
      const payout = app.get(LuckyLadyPayoutService);
      const points = app.get(PointsService);

      const users: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const user = await admin.user.create({
          data: { email: uniqueTestEmail(`p1-conc-${label}-${index}`), passwordHash: 'x', wallet: { create: {} } },
        });
        await points.adminGrant(adminId, user.id, 100_000n, 'p1 concurrency funding', `p1-fund-${label}-${index}`);
        users.push(user.id);
      }

      const request = (userId: string) => ({
        context: { gameId: LUCKY_LADY_GAME_ID, userId, sessionId: '11111111-2222-4333-8444-555555555555' },
        input: {
          event: 'bet',
          body: { slotEvent: 'bet', slotBet: 1, slotLines: 10 },
          headers: { 'x-pilot-version': '1', 'x-pilot-round': 'none' },
          requestId: `p1-${label}-${userId}`,
        },
      });

      // Flip DEFAULT <-> CUSTOM while the rounds are in flight.
      let flips = 0;
      let running = flipping;
      const flipper = (async () => {
        let toDefault = true;
        while (running) {
          try {
            if (toDefault) await payout.restoreDefault(adminId, { actionId: `p1-${label}-flip-${flips}` });
            else await payout.activate(adminId, candidate.candidateId, { actionId: `p1-${label}-flip-${flips}` });
            flips += 1;
            toDefault = !toDefault;
          } catch { /* a flip losing a race is not a failure of the rounds under test */ }
          await new Promise((resolve) => setTimeout(resolve, 15));
        }
      })();

      const started = Date.now();
      const settled = await Promise.allSettled(users.map((userId) => {
        const { context, input } = request(userId);
        return adapter.execute(context, input as never);
      }));
      const durationMs = Date.now() - started;
      running = false;
      await flipper;

      const failures = settled.flatMap((entry) => (entry.status === 'rejected' ? [String((entry.reason as Error)?.message ?? entry.reason)] : []));
      const poolErrors = failures.filter((message) => /connection pool|P2024|P2028|Unable to start a transaction|Timed out fetching|Transaction API error|Transaction not found/i.test(message));

      // ---- integrity, read through the independent admin client ----
      const completedUsers = users.filter((_, index) => settled[index].status === 'fulfilled');
      const failedUsers = users.filter((_, index) => settled[index].status === 'rejected');
      const rounds = await admin.casinoRound.findMany({ where: { userId: { in: users } } });
      const perUser = new Map<string, number>();
      rounds.forEach((round) => perUser.set(round.userId, (perUser.get(round.userId) ?? 0) + 1));

      let coherentDefault = 0;
      let coherentCustom = 0;
      let mixed = 0;
      for (const round of rounds) {
        const state = round.privateState as { profileId?: string; profileHash?: string; maxWin?: unknown; distribution?: { policyHash?: string; policyId?: string } | null };
        const isDefault = state.profileId === GOLDEN_PROFILE && state.profileHash === GOLDEN_HASH && !state.distribution && !state.maxWin;
        const isCustom = state.profileId === candidate.modelProfileId && state.profileHash === candidate.modelHash
          && state.distribution?.policyHash === candidate.policyHash && state.distribution?.policyId === candidate.policyId;
        if (isDefault) coherentDefault += 1; else if (isCustom) coherentCustom += 1; else mixed += 1;
      }

      const ledger = await admin.ledgerEntry.findMany({ where: { wallet: { userId: { in: users } }, type: 'CASINO_BET' }, include: { wallet: true } });
      const betsPerUser = new Map<string, number>();
      ledger.forEach((entry) => betsPerUser.set(entry.wallet.userId, (betsPerUser.get(entry.wallet.userId) ?? 0) + 1));
      const duplicateDebits = [...betsPerUser.values()].filter((value) => value > 1).length;

      const wallets = await admin.wallet.findMany({ where: { userId: { in: users } } });
      let mismatches = 0;
      for (const wallet of wallets) {
        const entries = await admin.ledgerEntry.findMany({ where: { walletId: wallet.id } });
        if (entries.reduce((total, entry) => total + entry.amount, 0n) !== wallet.balance) mismatches += 1;
      }

      const actions = await admin.casinoRoundAction.findMany({ where: { userId: { in: users }, gameId: LUCKY_LADY_GAME_ID } });
      const actionsPerUser = new Map<string, number>();
      actions.forEach((entry) => actionsPerUser.set(entry.userId, (actionsPerUser.get(entry.userId) ?? 0) + 1));
      const duplicateActionRows = [...actionsPerUser.values()].filter((value) => value > 1).length;

      const failedWithEffects = failedUsers.filter((userId) => (perUser.get(userId) ?? 0) > 0 || (betsPerUser.get(userId) ?? 0) > 0).length;

      // ---- replay: same request id again, concurrently; no redraw, no second debit ----
      const ledgerBefore = await admin.ledgerEntry.count({ where: { wallet: { userId: { in: users } } } });
      const replays = await Promise.allSettled(completedUsers.map((userId) => {
        const { context, input } = request(userId);
        return adapter.execute(context, input as never);
      }));
      let replayMismatches = 0;
      replays.forEach((entry, index) => {
        const original = settled[users.indexOf(completedUsers[index])];
        if (entry.status !== 'fulfilled' || original.status !== 'fulfilled'
          || JSON.stringify(entry.value) !== JSON.stringify(original.value)) replayMismatches += 1;
      });
      const ledgerAfter = await admin.ledgerEntry.count({ where: { wallet: { userId: { in: users } } } });

      const metrics: Metrics = {
        scenario: label, pool, concurrentRounds: count, flipping,
        completed: completedUsers.length, failed: failedUsers.length,
        poolOrTransactionStartErrors: poolErrors.length, otherErrors: failures.length - poolErrors.length,
        errorSamples: [...new Set(failures.map((message) => message.slice(0, 160)))].slice(0, 3), durationMs,
        roundsWritten: rounds.length, usersWithMoreThanOneRound: [...perUser.values()].filter((value) => value > 1).length,
        duplicateDebits, duplicateActionRows, coherentDefault, coherentCustom, mixedSnapshots: mixed,
        balanceLedgerMismatches: mismatches, failedRoundsWithSideEffects: failedWithEffects,
        replays: replays.length, replayResponseMismatches: replayMismatches, replayNewLedgerRows: ledgerAfter - ledgerBefore, flips,
      };
      results.push(metrics);
      return metrics;
    } finally {
      await app.close();
    }
  };

  const assertIntegrity = (metrics: Metrics) => {
    expect(metrics.poolOrTransactionStartErrors).toBe(0);
    expect(metrics.otherErrors).toBe(0);
    expect(metrics.completed).toBe(metrics.concurrentRounds);
    expect(metrics.failed).toBe(0);
    expect(metrics.mixedSnapshots).toBe(0);
    expect(metrics.duplicateDebits).toBe(0);
    expect(metrics.duplicateActionRows).toBe(0);
    expect(metrics.usersWithMoreThanOneRound).toBe(0);
    expect(metrics.balanceLedgerMismatches).toBe(0);
    expect(metrics.failedRoundsWithSideEffects).toBe(0);
    expect(metrics.roundsWritten).toBe(metrics.completed);
    expect(metrics.replayResponseMismatches).toBe(0);
    expect(metrics.replayNewLedgerRows).toBe(0);
  };

  it('baseline: default-sized pool (17), 12 concurrent paid rounds', async () => {
    assertIntegrity(await scenario('baseline-pool17-n12', 17, 12, false));
  });

  it('above pool size with the active policy flipping mid-flight: pool 17, 40 concurrent paid rounds', async () => {
    assertIntegrity(await scenario('flipping-pool17-n40', 17, 40, true));
  });

  it('threshold probe: pool 5, 12 concurrent paid rounds, flipping', async () => {
    assertIntegrity(await scenario('probe-pool5-n12', 5, 12, true));
  });

  it('zero nested acquisition proof: pool 1, 3 concurrent paid rounds', async () => {
    assertIntegrity(await scenario('proof-pool1-n3', 1, 3, false));
  });
});
