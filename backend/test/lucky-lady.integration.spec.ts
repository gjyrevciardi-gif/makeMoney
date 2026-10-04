import { ForbiddenException, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { BigIntInterceptor } from '../src/common/bigint.interceptor';
import { RedisService } from '../src/common/redis.service';
import { CasinoConfigService } from '../src/casino/casino-config.service';
import { CasinoGameRegistry } from '../src/casino/casino-game.registry';
import {
  LUCKY_LADY_GAME_ID,
  PINNED_ENGINE_SHA256,
  PINNED_PROFILE_FILE_SHA256,
  PINNED_RULES_SHA256,
  createDeterministicRng,
  deterministicRngUsage,
  drawGamble,
  generateCompleteRound,
  loadVerifiedMath,
} from '../src/casino/games/lucky-lady/lucky-lady.math';
import {
  LUCKY_LADY_CAPABILITY,
  LuckyLadyAdapter,
} from '../src/casino/games/lucky-lady/lucky-lady.adapter';
import { GameCapabilityService } from '../src/casino/platform/game-capability.service';
import { GameJournalService } from '../src/casino/platform/game-journal.service';
import { GameRoundService } from '../src/casino/platform/game-round.service';
import { GameWalletService } from '../src/casino/platform/game-wallet.service';
import { GameActionContext, GamePlatform } from '../src/casino/platform/game-adapter.types';
import { PrismaService } from '../src/prisma.service';
import { PointsService } from '../src/wallet/points.service';
import { uniqueTestEmail } from './test-identity';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const FROZEN_PROFILE_HASH = 'eb0a22171a3479cea3b0238269edd4b0dc5d9486c57e4b057fa6ee0f1a70be5f';

/**
 * Deterministic outcome seeds, found by running the accepted evaluator itself
 * (`generateCompleteRound`) over a bounded seed space. A dedicated test proves
 * each one still produces the property it is named for, so a drift in the
 * evaluator or the frozen profile fails loudly instead of silently reselecting.
 */
const WIN_SEED = 'll-0'; // paid win, no feature
const ZERO_SEED = 'll-2'; // no paid win, no feature
const FEATURE_SEED = 'll-2391'; // 15 free spins, no retrigger
const RETRIGGER_SEED = 'll-117402'; // 30 free spins after exactly one retrigger
const GAMBLE_WIN_SEED = 'g-2';
const GAMBLE_LOSE_SEED = 'g-0';

type Protocol = {
  responseEvent: string;
  responseType?: string;
  serverResponse?: Record<string, unknown>;
  recovery: {
    version: number;
    roundId: string;
    phase: string;
    balance: number;
    pendingWin: number;
    actionId: string | null;
    receipt: { event: string | null; delivered: boolean; acked: boolean };
    free: { total: number; current: number; remaining: number; multiplier: number };
    result: { serverResponse: Record<string, unknown> } | null;
  };
};

/**
 * Lucky Lady on the real platform: launch authorization, the native protocol,
 * PostgreSQL settlement, concurrency, recovery and ownership.
 *
 * Deterministic outcome seeds are injected through the service's test-only
 * option. Production always draws fresh OS entropy. The seeds below were found
 * by running the same accepted evaluator the service runs, so nothing here
 * fabricates a board or a payout.
 */
describe('Lucky Lady platform integration (PostgreSQL)', () => {
  const prisma = new PrismaService();
  const registry = new CasinoGameRegistry();
  const configs = new CasinoConfigService(prisma, registry);
  const points = new PointsService(prisma);

  let seedQueue: string[] = [];
  let draws = 0;
  let injectedFailures = 0;
  let injectedCommitFailures = 0;
  let requestCounter = 0;
  const sessions = new Map<string, string>();

  // ---- The reusable game-integration layer, composed exactly as the module ----
  const capabilities = new GameCapabilityService(prisma, registry, configs);
  const platform: GamePlatform = {
    capabilities,
    wallet: new GameWalletService(),
    journal: new GameJournalService(prisma),
    rounds: new GameRoundService(prisma),
  };
  const contextFor = (actor: string, sessionId: string): GameActionContext => ({
    gameId: LUCKY_LADY_GAME_ID,
    userId: actor,
    sessionId,
  });

  /**
   * The adapter contract is what the platform calls, so this suite drives the
   * same behaviour through the same boundary: `handleGameplay` is the adapter's
   * `execute`, the session-bound reads are its `read`, and launch/session are
   * the shared capability service. Every assertion below is unchanged.
   */
  const apiOf = (adapter: LuckyLadyAdapter) => ({
    handleGameplay: (
      context: { userId: string; sessionId: string },
      event: string,
      body: Record<string, unknown>,
      headers: Record<string, string | undefined>,
      requestId: string,
    ) => adapter.execute(contextFor(context.userId, context.sessionId), { event, body, headers, requestId }) as Promise<Protocol>,
    settings: async (actor: string) => adapter.read(contextFor(actor, await sid(actor)), 'getSettings', {}) as Promise<Protocol>,
    acknowledge: async (actor: string, body: Record<string, unknown>) =>
      adapter.read(contextFor(actor, await sid(actor)), 'ack', body) as Promise<{
        responseEvent: string;
        actionId: string | null;
        accepted: boolean;
        reason?: string;
      }>,
    issueLaunch: (actor: string) =>
      capabilities.issueLaunch(actor, {
        gameId: LUCKY_LADY_GAME_ID,
        scope: LUCKY_LADY_CAPABILITY.scope,
        ttlMs: LUCKY_LADY_CAPABILITY.launchTtlMs,
        gamePath: LUCKY_LADY_CAPABILITY.gamePath,
      }),
    exchangeLaunch: (token: string) =>
      capabilities.exchangeLaunch(token, {
        gameId: LUCKY_LADY_GAME_ID,
        scope: LUCKY_LADY_CAPABILITY.scope,
        sessionTtlMs: LUCKY_LADY_CAPABILITY.sessionTtlMs,
      }),
    assertSession: (token: string) => capabilities.assertSession(token, LUCKY_LADY_GAME_ID),
  });

  const game = apiOf(new LuckyLadyAdapter(prisma, platform, configs, registry, {
    // Deterministic generation is an explicit test seam. The production
    // provider supplies the OS CSPRNG instead.
    rngFactory: () => {
      draws += 1;
      const seed = seedQueue.shift();
      // Running out of queued seeds means an unexpected draw happened - the
      // strongest available assertion that no RNG ran.
      if (!seed) throw new Error('UNEXPECTED_RNG_DRAW');
      return createDeterministicRng(seed);
    },
    hooks: {
      beforeSettle: () => {
        if (injectedFailures > 0) {
          injectedFailures -= 1;
          throw new Error('INJECTED_SETTLEMENT_FAILURE');
        }
      },
      afterDebit: () => {
        if (injectedCommitFailures > 0) {
          injectedCommitFailures -= 1;
          throw new Error('INJECTED_POST_DEBIT_FAILURE');
        }
      },
    },
  }));

  /** The production configuration: no injected rng, no hooks. */
  const productionGame = () => apiOf(new LuckyLadyAdapter(prisma, platform, configs, registry));

  const userEmail = uniqueTestEmail('lucky-player');
  const rivalEmail = uniqueTestEmail('lucky-rival');
  const adminEmail = uniqueTestEmail('lucky-admin');
  let userId: string;
  let rivalId: string;
  let adminId: string;

  const nextRequestId = () =>
    `req-${Date.now().toString(36)}-${(requestCounter += 1)}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    seedQueue = [];
    draws = 0;
    injectedFailures = 0;
    injectedCommitFailures = 0;
    sessions.clear();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "GamePreparedOutcome", "GameSession", "GameLaunchCapability", "CasinoGameConfigVersion", "CasinoGameConfig", "PlatformSettings", "CasinoTransaction", "CasinoRoundAction", "CasinoRound", "CasinoGameFavorite", "LedgerEntry", "BetLeg", "Bet", "AuditLog", "RefreshToken", "Wallet", "User" CASCADE',
    );
    const [player, rival, admin] = await Promise.all([
      prisma.user.create({ data: { email: userEmail, passwordHash: 'x', wallet: { create: {} } } }),
      prisma.user.create({ data: { email: rivalEmail, passwordHash: 'x', wallet: { create: {} } } }),
      prisma.user.create({ data: { email: adminEmail, passwordHash: 'x', role: 'ADMIN', wallet: { create: {} } } }),
    ]);
    userId = player.id;
    rivalId = rival.id;
    adminId = admin.id;
  });

  const fund = (amount = 100_000n, target = userId) =>
    points.adminGrant(adminId, target, amount, 'Lucky Lady funding', nextRequestId());

  /** A bound gameplay capability, created directly for service-level tests. */
  const sid = async (actor = userId) => {
    const existing = sessions.get(actor);
    if (existing) return existing;
    const token = `session-${actor.slice(0, 8)}-${Math.random().toString(36).slice(2, 12)}`;
    const row = await prisma.gameSession.create({
      data: {
        userId: actor,
        gameId: LUCKY_LADY_GAME_ID,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    sessions.set(actor, row.id);
    return row.id;
  };

  const balance = async (target = userId) =>
    (await prisma.wallet.findUniqueOrThrow({ where: { userId: target } })).balance;

  const ledgerTotal = async (target = userId) => {
    const entries = await prisma.ledgerEntry.findMany({ where: { wallet: { userId: target } } });
    return entries.reduce((sum, entry) => sum + entry.amount, 0n);
  };

  type Ctx = { version: string; round: string };

  /** Plays one action as the recovered client would, then acknowledges it. */
  const act = async (
    event: string,
    body: Record<string, unknown>,
    ctx: Ctx,
    requestId = nextRequestId(),
    actor = userId,
  ) => {
    const response = (await game.handleGameplay(
      { userId: actor, sessionId: await sid(actor) },
      event,
      { slotEvent: event, ...body },
      { 'x-pilot-version': ctx.version, 'x-pilot-round': ctx.round },
      requestId,
    )) as unknown as Protocol;
    if (response.recovery?.actionId) {
      await game.acknowledge(actor, { actionId: response.recovery.actionId });
    }
    return {
      response,
      requestId,
      ctx: { version: String(response.recovery.version), round: response.recovery.roundId },
    };
  };

  const fresh = (): Ctx => ({ version: '1', round: 'none' });

  const roundFor = (seed: string) => generateCompleteRound({ rng: createDeterministicRng(seed), bet: 1, lines: 10 }).round;

  it('still selects the documented deterministic seeds from the accepted evaluator', () => {
    const win = roundFor(WIN_SEED);
    expect(win.mainEval.totalWin).toBeGreaterThan(0);
    expect(win.feature.spins).toBe(0);
    const zero = roundFor(ZERO_SEED);
    expect(zero.mainEval.totalWin).toBe(0);
    expect(zero.feature.spins).toBe(0);
    const feature = roundFor(FEATURE_SEED);
    expect(feature.feature.spins).toBe(15);
    expect(feature.feature.retriggers).toBe(0);
    const retrigger = roundFor(RETRIGGER_SEED);
    expect(retrigger.feature.spins).toBe(30);
    expect(retrigger.feature.retriggers).toBe(1);
    expect(retrigger.feature.sequence.filter((spin) => spin.retriggered)).toHaveLength(1);
    expect(drawGamble({ rng: createDeterministicRng(GAMBLE_WIN_SEED), choice: 'red' }).win).toBe(true);
    expect(drawGamble({ rng: createDeterministicRng(GAMBLE_LOSE_SEED), choice: 'red' }).win).toBe(false);
  });

  it('never enters the deterministic generator from the production configuration', async () => {
    await fund();
    const before = deterministicRngUsage.calls;

    // Explicit test injection does enter the deterministic path.
    // A zero-win round returns to IDLE, so the next paid round is allowed.
    seedQueue = [ZERO_SEED];
    const injected = await act('bet', { slotBet: 1, slotLines: 10 }, fresh());
    const afterInjected = deterministicRngUsage.calls;
    expect(afterInjected).toBeGreaterThan(before);

    // The production configuration draws from the OS CSPRNG instead: the
    // simulation PRNG is never entered.
    const production = productionGame();
    const settled = (await production.handleGameplay(
      { userId, sessionId: await sid() },
      'bet',
      { slotEvent: 'bet', slotBet: 1, slotLines: 10 },
      { 'x-pilot-version': injected.ctx.version, 'x-pilot-round': injected.ctx.round },
      nextRequestId(),
    )) as unknown as Protocol;
    expect(settled.responseEvent).toBe('spin');
    expect(deterministicRngUsage.calls).toBe(afterInjected);
  });

  it('uses whole platform points for the native stake ladder', async () => {
    await fund();
    const settings = await game.settings(userId);
    const native = settings.serverResponse as unknown as {
      Bet: number[];
      Line: number[];
      mathConfig: { stakeUnit: string };
    };
    expect(native.Bet).toEqual([1, 2, 5, 10, 20]);
    expect(native.Line).toEqual([10]);
    expect(native.mathConfig.stakeUnit).toBe('WHOLE_POINTS');

    // A zero-win paid round returns to IDLE, so a second paid round is allowed.
    seedQueue = [ZERO_SEED];
    const bet = await act('bet', { slotBet: 1, slotLines: 10 }, fresh());
    // The recovery payload carries the same whole-point units the client shows.
    expect((bet.response.recovery as unknown as { bet: unknown }).bet).toEqual({ slotBet: 1, slotLines: 10 });
    const debit = await prisma.ledgerEntry.findFirstOrThrow({ where: { type: 'CASINO_BET' } });
    expect(debit.amount).toBe(-10n);

    seedQueue = [WIN_SEED];
    const maxBet = await act('bet', { slotBet: 20, slotLines: 10 }, bet.ctx);
    expect((maxBet.response.recovery as unknown as { bet: unknown }).bet).toEqual({ slotBet: 20, slotLines: 10 });
    const debits = await prisma.ledgerEntry.findMany({ where: { type: 'CASINO_BET' }, orderBy: { createdAt: 'asc' } });
    expect(debits.map((entry) => entry.amount)).toEqual([-10n, -200n]);
  });

  it('keeps the round pinned to the profile it was played under', async () => {
    await fund();
    seedQueue = [WIN_SEED];
    const bet = await act('bet', { slotBet: 1, slotLines: 10 }, fresh());
    const round = await prisma.casinoRound.findFirstOrThrow({ where: { userId } });
    const state = round.privateState as unknown as {
      profileId: string;
      profileHash: string;
      profileVersion: number;
    };
    expect(state.profileId).toBe('lucky-lady.rtp50.v1');
    expect(state.profileHash).toBe(FROZEN_PROFILE_HASH);
    expect(state.profileVersion).toBe(1);

    const snapshot = (await game.settings(userId)).recovery as unknown as {
      profile: { id: string; hash: string; version: number };
    };
    expect(snapshot.profile).toEqual({
      id: state.profileId,
      hash: state.profileHash,
      version: state.profileVersion,
    });
    expect(bet.response.recovery.phase).toBe('PENDING_WIN');
  });

  it('keeps the accepted evaluator, rules and frozen profile byte-identical', () => {
    const math = loadVerifiedMath();
    expect(math.hashes.engineSha256).toBe(PINNED_ENGINE_SHA256);
    expect(math.hashes.rulesSha256).toBe(PINNED_RULES_SHA256);
    expect(math.hashes.profileFileSha256).toBe(PINNED_PROFILE_FILE_SHA256);
    expect(math.hashes.profileCanonicalHash).toBe(FROZEN_PROFILE_HASH);
    expect(math.profile.validatedLines).toBe(10);
    expect(math.profile.targetRtpPercent).toBe(50);
    expect(registry.findById(LUCKY_LADY_GAME_ID)?.minStake).toBe('10');
    expect(registry.findById(LUCKY_LADY_GAME_ID)?.maxStake).toBe('200');
    expect(registry.findById(LUCKY_LADY_GAME_ID)?.gameVersion).toBe('lucky-lady.rtp50.v1');
  });

  it('issues a one-time launch only to an enabled USER and stores only its hash', async () => {
    await expect(game.issueLaunch(adminId)).rejects.toBeInstanceOf(ForbiddenException);

    const { token } = await game.issueLaunch(userId);
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const rows = await prisma.gameLaunchCapability.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(sha256(token));
    expect(rows[0].scope).toBe(`game:${LUCKY_LADY_GAME_ID}:play`);
    expect(JSON.stringify(rows)).not.toContain(token);

    const session = await game.exchangeLaunch(token);
    expect(session.userId).toBe(userId);
    const stored = await prisma.gameSession.findFirstOrThrow();
    expect(stored.tokenHash).toBe(sha256(session.sessionToken));
    expect(stored.gameId).toBe(LUCKY_LADY_GAME_ID);
    expect(JSON.stringify(stored)).not.toContain(session.sessionToken);
    expect((await game.assertSession(session.sessionToken)).userId).toBe(userId);

    // Exactly once.
    await expect(game.exchangeLaunch(token)).rejects.toMatchObject({ response: { code: 'LAUNCH_TOKEN_USED' } });
  });

  it('rejects expired, unknown and wrong-scope launch capabilities', async () => {
    const expiredToken = 'expired-token-value-expired-token-value';
    await prisma.gameLaunchCapability.create({
      data: {
        userId,
        scope: `game:${LUCKY_LADY_GAME_ID}:play`,
        tokenHash: sha256(expiredToken),
        expiresAt: new Date(Date.now() - 1_000),
      },
    });
    await expect(game.exchangeLaunch(expiredToken)).rejects.toMatchObject({
      response: { code: 'LAUNCH_TOKEN_EXPIRED' },
    });

    const otherToken = 'other-scope-token-other-scope-token';
    await prisma.gameLaunchCapability.create({
      data: {
        userId,
        scope: 'game:other-game:play',
        tokenHash: sha256(otherToken),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await expect(game.exchangeLaunch(otherToken)).rejects.toMatchObject({
      response: { code: 'LAUNCH_TOKEN_INVALID' },
    });

    await expect(game.assertSession('not-a-real-session-token-value')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('starts from a zero wallet and refuses an unaffordable round without drawing', async () => {
    const settings = await game.settings(userId);
    expect((settings.recovery as unknown as Protocol['recovery']).balance).toBe(0);
    expect((settings.recovery as unknown as Protocol['recovery']).roundId).toBe('none');
    expect(settings.responseEvent).toBe('getSettings');
    const native = settings.serverResponse as unknown as {
      Balance: number;
      Line: number[];
      gameLine: number[];
      mathConfig: { profileHash: string; activeMathProfile: string };
    };
    expect(native.Balance).toBe(0);
    expect(native.Line).toEqual([10]);
    expect(native.gameLine).toEqual([10]);
    expect(native.mathConfig.profileHash).toBe(FROZEN_PROFILE_HASH);

    await expect(
      game.handleGameplay(
        { userId, sessionId: await sid() },
        'bet',
        { slotEvent: 'bet', slotBet: 1, slotLines: 10 },
        { 'x-pilot-version': '1', 'x-pilot-round': 'none' },
        nextRequestId(),
      ),
    ).rejects.toMatchObject({ response: { code: 'INSUFFICIENT_VIRTUAL_BALANCE' } });

    expect(draws).toBe(0);
    expect(await prisma.casinoRound.count()).toBe(0);
    expect(await prisma.gamePreparedOutcome.count()).toBe(0);
    expect(await balance()).toBe(0n);
  });

  it('settles one paid debit and a stable 15-symbol board, then credits one collect', async () => {
    await fund();
    seedQueue = [WIN_SEED];

    const bet = await act('bet', { slotBet: 1, slotLines: 10 }, fresh());
    const symbols = bet.response.serverResponse?.reelsSymbols as Record<string, string[]>;
    const visible = [1, 2, 3, 4, 5].flatMap((reel) => symbols[`reel${reel}`].slice(0, 3));
    expect(visible).toHaveLength(15);
    expect(visible.every((symbol) => typeof symbol === 'string' && symbol.length > 0)).toBe(true);

    const round = await prisma.casinoRound.findFirstOrThrow({ where: { userId } });
    const privateState = round.privateState as unknown as { main: { board: Record<string, string[]> } };
    expect([1, 2, 3, 4, 5].map((reel) => privateState.main.board[`reel${reel}`].slice(0, 3))).toEqual(
      [1, 2, 3, 4, 5].map((reel) => symbols[`reel${reel}`].slice(0, 3)),
    );
    expect(round.gameType).toBe('SLOTS');
    expect(round.gameVersion).toBe('lucky-lady.rtp50.v1');
    expect(round.status).toBe('OPEN');
    expect(round.stake).toBe(10n);
    expect(bet.response.recovery.phase).toBe('PENDING_WIN');
    expect(bet.response.recovery.balance).toBe(99_990);
    expect(await balance()).toBe(99_990n);

    const debits = await prisma.ledgerEntry.findMany({ where: { type: 'CASINO_BET' } });
    expect(debits).toHaveLength(1);
    expect(debits[0].amount).toBe(-10n);
    expect(debits[0].relatedCasinoRoundId).toBe(round.id);
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_WIN' } })).toBe(0);

    const pendingWin = bet.response.recovery.pendingWin;
    expect(pendingWin).toBeGreaterThan(0);

    const collect = await act('recoveryCollect', {}, bet.ctx);
    expect(collect.response.responseEvent).toBe('recoveryAck');
    expect(collect.response.recovery.phase).toBe('IDLE');
    expect(collect.response.recovery.pendingWin).toBe(0);
    const credits = await prisma.ledgerEntry.findMany({ where: { type: 'CASINO_WIN' } });
    expect(credits).toHaveLength(1);
    expect(credits[0].amount).toBe(BigInt(pendingWin));
    expect(await balance()).toBe(99_990n + BigInt(pendingWin));

    const settled = await prisma.casinoRound.findUniqueOrThrow({ where: { id: round.id } });
    expect(settled.status).toBe('CASHED_OUT');
    expect(settled.payout).toBe(BigInt(pendingWin));
    expect(settled.settledAt).not.toBeNull();

    // Replaying the collect returns the original response and moves nothing.
    const replay = await act('recoveryCollect', {}, bet.ctx, collect.requestId);
    expect(replay.response).toEqual(collect.response);
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_WIN' } })).toBe(1);
    expect(await balance()).toBe(99_990n + BigInt(pendingWin));

    // A second, distinct collect is refused.
    await expect(act('recoveryCollect', {}, collect.ctx)).rejects.toMatchObject({
      response: { code: 'NOTHING_TO_COLLECT' },
    });
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_WIN' } })).toBe(1);
    expect(await ledgerTotal()).toBe(await balance());
  });

  it('rejects a non-native stake or an unsupported line count before drawing', async () => {
    await fund();
    const sessionId = await sid();
    const attempt = (body: Record<string, unknown>) =>
      game.handleGameplay(
        { userId, sessionId },
        'bet',
        { slotEvent: 'bet', ...body },
        { 'x-pilot-version': '1', 'x-pilot-round': 'none' },
        nextRequestId(),
      );

    // The old pilot denomination (0.01 per line) is not a whole-point stake.
    await expect(attempt({ slotBet: '0.013', slotLines: 10 })).rejects.toMatchObject({
      response: { code: 'UNSUPPORTED_STAKE_PRECISION' },
    });
    await expect(attempt({ slotBet: '0.011', slotLines: 10 })).rejects.toMatchObject({
      response: { code: 'UNSUPPORTED_STAKE_PRECISION' },
    });
    await expect(attempt({ slotBet: 1.5, slotLines: 10 })).rejects.toMatchObject({
      response: { code: 'UNSUPPORTED_STAKE_PRECISION' },
    });
    await expect(attempt({ slotBet: 2, slotLines: 5 })).rejects.toMatchObject({
      response: { code: 'UNSUPPORTED_LINES' },
    });
    await expect(attempt({ slotBet: 3, slotLines: 10 })).rejects.toMatchObject({
      response: { code: 'UNSUPPORTED_STAKE' },
    });
    await expect(attempt({ slotLines: 10 })).rejects.toMatchObject({
      response: { code: 'UNSUPPORTED_STAKE' },
    });

    expect(draws).toBe(0);
    expect(await prisma.gamePreparedOutcome.count()).toBe(0);
    expect(await prisma.casinoRound.count()).toBe(0);
    expect(await balance()).toBe(100_000n);
  });

  it('runs a full 15-spin feature with one wager debit, then one collect credit', async () => {
    await fund();
    seedQueue = [FEATURE_SEED];

    const bet = await act('bet', { slotBet: 1, slotLines: 10 }, fresh());
    expect(bet.response.recovery.phase).toBe('FREE_SPINS');
    expect(bet.response.recovery.free.total).toBe(15);
    expect(bet.response.recovery.free.current).toBe(0);

    let ctx = bet.ctx;
    for (let spin = 0; spin < 15; spin += 1) {
      const played = await act('freespin', { slotBet: 1, slotLines: 10 }, ctx);
      ctx = played.ctx;
      expect(played.response.responseType).toBe('freespin');
      expect(played.response.recovery.free.current).toBe(spin + 1);
      expect(played.response.recovery.free.total).toBe(15);
    }
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_WIN' } })).toBe(0);
    expect(await balance()).toBe(99_990n);

    const before = (await game.settings(userId)).recovery as unknown as Protocol['recovery'];
    expect(before.phase).toBe('PENDING_WIN');
    expect(before.pendingWin).toBeGreaterThan(0);

    const collect = await act('recoveryCollect', {}, ctx);
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_WIN' } })).toBe(1);
    expect(await balance()).toBe(99_990n + BigInt(before.pendingWin));
    expect(collect.response.recovery.phase).toBe('IDLE');
    expect(await ledgerTotal()).toBe(await balance());
  });

  it('retriggers 15 -> 30 through the free-spin path without a second debit', async () => {
    await fund();
    seedQueue = [RETRIGGER_SEED];
    const expected = roundFor(RETRIGGER_SEED);

    const bet = await act('bet', { slotBet: 1, slotLines: 10 }, fresh());
    expect(bet.response.recovery.free.total).toBe(15);

    let ctx = bet.ctx;
    const totals: number[] = [];
    for (let spin = 0; spin < expected.feature.spins; spin += 1) {
      const played = await act('freespin', { slotBet: 1, slotLines: 10 }, ctx);
      ctx = played.ctx;
      totals.push(played.response.recovery.free.total);
    }
    expect(expected.feature.spins).toBe(30);
    const triggerIndex = expected.feature.sequence.findIndex((spin) => spin.retriggered);
    expect(triggerIndex).toBeGreaterThanOrEqual(0);
    expect(totals.filter((total) => total === 30)).toHaveLength(30 - triggerIndex);
    expect(ctx.version).toBe(String(expected.feature.spins + 1));
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(1);

    const round = await prisma.casinoRound.findFirstOrThrow({ where: { userId } });
    const state = round.privateState as unknown as { sequence: { retriggered: boolean }[] };
    expect(state.sequence.filter((spin) => spin.retriggered)).toHaveLength(1);

    await expect(act('freespin', { slotBet: 1, slotLines: 10 }, ctx)).rejects.toMatchObject({
      response: { code: 'NO_ACTIVE_FREE_SPIN' },
    });
  });

  it('gambles a pending win: a loss closes without a credit or a second stake debit', async () => {
    await fund();
    seedQueue = [WIN_SEED, GAMBLE_LOSE_SEED];

    const bet = await act('bet', { slotBet: 1, slotLines: 10 }, fresh());
    const pending = bet.response.recovery.pendingWin;
    expect(pending).toBeGreaterThan(0);
    const enter = await act('recoveryGamble', {}, bet.ctx);
    expect(enter.response.recovery.phase).toBe('GAMBLE');

    const gamble = await act('slotGamble', { gambleChoice: 'red' }, enter.ctx);
    expect((gamble.response.serverResponse as { gambleState: string }).gambleState).toBe('lose');
    expect(gamble.response.recovery.pendingWin).toBe(0);
    expect(gamble.response.recovery.phase).toBe('IDLE');
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_WIN' } })).toBe(0);
    expect(await balance()).toBe(99_990n);
    const round = await prisma.casinoRound.findFirstOrThrow({ where: { userId } });
    expect(round.status).toBe('LOST');
    expect(round.payout).toBe(0n);

    const replay = await act('slotGamble', { gambleChoice: 'red' }, enter.ctx, gamble.requestId);
    expect(replay.response).toEqual(gamble.response);
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(1);

    await expect(act('slotGamble', { gambleChoice: 'black' }, gamble.ctx)).rejects.toMatchObject({
      response: { code: 'NOTHING_TO_GAMBLE' },
    });
  });

  it('gambles a pending win: a win doubles the pending credit and collects it once', async () => {
    await fund();
    seedQueue = [WIN_SEED, GAMBLE_WIN_SEED];

    const bet = await act('bet', { slotBet: 1, slotLines: 10 }, fresh());
    const pending = bet.response.recovery.pendingWin;
    const enter = await act('recoveryGamble', {}, bet.ctx);
    const gamble = await act('slotGamble', { gambleChoice: 'red' }, enter.ctx);
    expect((gamble.response.serverResponse as { gambleState: string }).gambleState).toBe('win');
    expect(gamble.response.recovery.pendingWin).toBe(pending * 2);
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(1);

    const collect = await act('recoveryCollect', {}, gamble.ctx);
    expect(collect.response.recovery.phase).toBe('IDLE');
    const credits = await prisma.ledgerEntry.findMany({ where: { type: 'CASINO_WIN' } });
    expect(credits).toHaveLength(1);
    expect(credits[0].amount).toBe(BigInt(pending * 2));
    expect(await balance()).toBe(99_990n + BigInt(pending * 2));
    expect(await ledgerTotal()).toBe(await balance());
  });

  it('serializes identical concurrent requests to one draw, one debit and one stored response', async () => {
    await fund();
    seedQueue = [WIN_SEED];
    const requestId = nextRequestId();
    const headers = { 'x-pilot-version': '1', 'x-pilot-round': 'none' };
    const sessionId = await sid();
    const call = () =>
      game.handleGameplay(
        { userId, sessionId },
        'bet',
        { slotEvent: 'bet', slotBet: 1, slotLines: 10 },
        headers,
        requestId,
      );

    const [first, second] = await Promise.all([call(), call()]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(draws).toBe(1);
    expect(await prisma.casinoRound.count({ where: { userId } })).toBe(1);
    const debits = await prisma.ledgerEntry.findMany({ where: { type: 'CASINO_BET' } });
    expect(debits).toHaveLength(1);
    expect(debits[0].amount).toBe(-10n);
    expect(await prisma.casinoRoundAction.count({ where: { gameId: LUCKY_LADY_GAME_ID } })).toBe(1);
  });

  it('rejects different semantics under the same request identifier', async () => {
    await fund();
    seedQueue = [ZERO_SEED];
    const requestId = nextRequestId();
    await act('bet', { slotBet: 1, slotLines: 10 }, fresh(), requestId);
    await expect(act('bet', { slotBet: 2, slotLines: 10 }, fresh(), requestId)).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_CONFLICT' },
    });
    expect(draws).toBe(1);
  });

  it('blocks a new action until the previous result is acknowledged', async () => {
    await fund();
    seedQueue = [WIN_SEED];
    const bet = (await game.handleGameplay(
      { userId, sessionId: await sid() },
      'bet',
      { slotEvent: 'bet', slotBet: 1, slotLines: 10 },
      { 'x-pilot-version': '1', 'x-pilot-round': 'none' },
      nextRequestId(),
    )) as unknown as Protocol;
    expect(bet.recovery.receipt.acked).toBe(false);
    expect(bet.recovery.receipt.delivered).toBe(false);

    await expect(
      game.handleGameplay(
        { userId, sessionId: await sid() },
        'recoveryCollect',
        { slotEvent: 'recoveryCollect' },
        { 'x-pilot-version': String(bet.recovery.version), 'x-pilot-round': bet.recovery.roundId },
        nextRequestId(),
      ),
    ).rejects.toMatchObject({ response: { code: 'ACK_REQUIRED' } });

    // A stale receipt is harmless but cannot release the newer pending result.
    const stale = await game.acknowledge(userId, { actionId: 'some-other-action-id' });
    expect(stale.accepted).toBe(false);
    await expect(
      game.handleGameplay(
        { userId, sessionId: await sid() },
        'recoveryCollect',
        { slotEvent: 'recoveryCollect' },
        { 'x-pilot-version': String(bet.recovery.version), 'x-pilot-round': bet.recovery.roundId },
        nextRequestId(),
      ),
    ).rejects.toMatchObject({ response: { code: 'ACK_REQUIRED' } });

    const accepted = await game.acknowledge(userId, { actionId: bet.recovery.actionId as string });
    expect(accepted.accepted).toBe(true);
    const again = await game.acknowledge(userId, { actionId: bet.recovery.actionId as string });
    expect(again.accepted).toBe(true);
  });

  it('restores authoritative state on read without advancing counters', async () => {
    await fund();
    seedQueue = [FEATURE_SEED];
    const bet = await act('bet', { slotBet: 1, slotLines: 10 }, fresh());
    const first = await act('freespin', { slotBet: 1, slotLines: 10 }, bet.ctx);

    const readA = (await game.settings(userId)).recovery as unknown as Protocol['recovery'];
    const readB = (await game.settings(userId)).recovery as unknown as Protocol['recovery'];
    expect(readA.phase).toBe('FREE_SPINS');
    expect(readA.free.current).toBe(1);
    expect(readA.free.total).toBe(15);
    expect(readA.pendingWin).toBe(first.response.recovery.pendingWin);
    expect(JSON.stringify(readA)).toBe(JSON.stringify(readB));

    const stored = await prisma.casinoRound.findFirstOrThrow({ where: { userId } });
    const state = stored.privateState as unknown as { fsIndex: number; sequence: unknown[] };
    expect(state.fsIndex).toBe(1);
    expect(state.sequence).toHaveLength(15);
  });

  it('keeps the wallet, ledger and game-domain transactions reconciled', async () => {
    await fund(1_000n);
    seedQueue = [WIN_SEED];
    const bet = await act('bet', { slotBet: 1, slotLines: 10 }, fresh());
    const collect = await act('recoveryCollect', {}, bet.ctx);
    const sessionId = await sid();

    const entries = await prisma.ledgerEntry.findMany({
      where: { wallet: { userId } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const sum = entries.reduce((total, entry) => total + entry.amount, 0n);
    expect(sum).toBe(await balance());

    // Exact provenance on the one authoritative ledger: the originating session
    // and action plus the true before/after under the wallet row lock.
    const betEntry = entries.find((entry) => entry.type === 'CASINO_BET');
    const winEntry = entries.find((entry) => entry.type === 'CASINO_WIN');
    expect(betEntry?.gameSessionId).toBe(sessionId);
    expect(betEntry?.actionId).toBe(bet.requestId);
    expect(betEntry?.balanceBefore).toBe(1_000n);
    expect(betEntry?.balanceAfter).toBe(990n);
    expect(winEntry?.gameSessionId).toBe(sessionId);
    expect(winEntry?.actionId).toBe(collect.requestId);
    expect(winEntry?.balanceBefore).toBe(990n);
    expect(winEntry?.balanceAfter).toBe(990n + winEntry!.amount);
    expect(winEntry?.balanceAfter).toBe(await balance());

    const transactions = await prisma.casinoTransaction.findMany({ where: { userId } });
    expect(transactions.length).toBe(entries.length - 1); // the admin grant has no game row
    for (const transaction of transactions) {
      const ledger = entries.find((entry) => entry.idempotencyKey === transaction.idempotencyKey);
      expect(ledger?.amount).toBe(transaction.amount);
      expect(ledger?.relatedCasinoRoundId).toBe(transaction.roundId);
    }

    // The append-only guarantee still holds for imported-game rows.
    const first = entries[0];
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "LedgerEntry" SET "amount" = "amount" + 1 WHERE "id" = '${first.id}'`),
    ).rejects.toThrow(/append-only/i);
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "id" = '${first.id}'`),
    ).rejects.toThrow(/append-only/i);
    expect(await prisma.ledgerEntry.count({ where: { wallet: { userId } } })).toBe(entries.length);
  });

  it('rolls back a failed settlement, keeps the prepared outcome and never rerolls', async () => {
    await fund();
    seedQueue = [ZERO_SEED];
    const requestId = nextRequestId();
    const headers = { 'x-pilot-version': '1', 'x-pilot-round': 'none' };
    const sessionId = await sid();
    const body = { slotEvent: 'bet', slotBet: 1, slotLines: 10 };
    injectedFailures = 1;

    await expect(
      game.handleGameplay({ userId, sessionId }, 'bet', body, headers, requestId),
    ).rejects.toThrow('INJECTED_SETTLEMENT_FAILURE');

    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(0);
    expect(await prisma.casinoRound.count()).toBe(0);
    expect(await balance()).toBe(100_000n);
    const prepared = await prisma.gamePreparedOutcome.findFirstOrThrow();
    const stored = prepared.payload as unknown as { roundId: string; main: { board: Record<string, string[]> } };
    expect(draws).toBe(1);

    // The retry settles the SAME stored outcome without drawing again.
    const retried = (await game.handleGameplay(
      { userId, sessionId },
      'bet',
      body,
      headers,
      requestId,
    )) as unknown as Protocol;
    expect(draws).toBe(1);
    expect(await prisma.gamePreparedOutcome.count()).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(1);
    expect(await balance()).toBe(99_990n);
    const round = await prisma.casinoRound.findFirstOrThrow({ where: { userId } });
    expect(round.id).toBe(stored.roundId);
    const symbols = retried.serverResponse?.reelsSymbols as Record<string, string[]>;
    expect(symbols.reel1).toEqual(stored.main.board.reel1);
    expect(symbols.reel5).toEqual(stored.main.board.reel5);
  });

  it('rolls back a failure raised after the wallet write and still settles one outcome', async () => {
    await fund();
    seedQueue = [ZERO_SEED];
    const requestId = nextRequestId();
    const headers = { 'x-pilot-version': '1', 'x-pilot-round': 'none' };
    const sessionId = await sid();
    const body = { slotEvent: 'bet', slotBet: 1, slotLines: 10 };
    // The fault fires after the conditional wallet update and the ledger insert,
    // before the transaction commits.
    injectedCommitFailures = 1;

    await expect(
      game.handleGameplay({ userId, sessionId }, 'bet', body, headers, requestId),
    ).rejects.toThrow('INJECTED_POST_DEBIT_FAILURE');

    expect(await prisma.ledgerEntry.count()).toBe(1); // the admin grant only
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(0);
    expect(await prisma.casinoRound.count()).toBe(0);
    expect(await prisma.casinoRoundAction.count()).toBe(0);
    expect(await prisma.casinoTransaction.count()).toBe(0);
    expect(await balance()).toBe(100_000n);
    expect(draws).toBe(1);
    const prepared = await prisma.gamePreparedOutcome.findFirstOrThrow();
    const stored = prepared.payload as unknown as { roundId: string };

    // Retrying settles exactly the stored outcome: same round, one draw, one debit.
    const retried = (await game.handleGameplay(
      { userId, sessionId },
      'bet',
      body,
      headers,
      requestId,
    )) as unknown as Protocol;
    expect(retried.responseEvent).toBe('spin');
    expect(draws).toBe(1);
    expect(await prisma.gamePreparedOutcome.count()).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(1);
    expect(await prisma.casinoTransaction.count()).toBe(1);
    expect(await balance()).toBe(99_990n);
    const round = await prisma.casinoRound.findFirstOrThrow({ where: { userId } });
    expect(round.id).toBe(stored.roundId);
  });

  it('serializes two distinct concurrent gambles into one accepted action', async () => {
    await fund();
    seedQueue = [
      WIN_SEED,
      GAMBLE_WIN_SEED,
      GAMBLE_LOSE_SEED,
    ];
    const bet = await act('bet', { slotBet: 1, slotLines: 10 }, fresh());
    const enter = await act('recoveryGamble', {}, bet.ctx);
    const sessionId = await sid();
    const drawsBefore = draws;
    const gamble = (requestId: string, choice: 'red' | 'black') =>
      game.handleGameplay(
        { userId, sessionId },
        'slotGamble',
        { slotEvent: 'slotGamble', gambleChoice: choice },
        { 'x-pilot-version': enter.ctx.version, 'x-pilot-round': enter.ctx.round },
        requestId,
      );

    const results = await Promise.allSettled([
      gamble(nextRequestId(), 'red'),
      gamble(nextRequestId(), 'red'),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      response: { code: 'SETTLEMENT_PENDING' },
    });
    // Exactly one draw and exactly one progression for two competing actions.
    expect(draws - drawsBefore).toBe(1);
    const round = await prisma.casinoRound.findFirstOrThrow({ where: { userId } });
    const state = round.privateState as unknown as { gamble: { attempts: number; cards: string[] }; version: number };
    expect(state.gamble.attempts).toBe(1);
    expect(state.gamble.cards).toHaveLength(1);
    expect(state.version).toBe(Number(enter.ctx.version) + 1);
    expect(await prisma.casinoRoundAction.count({ where: { gameId: LUCKY_LADY_GAME_ID, action: 'slotGamble' } })).toBe(1);
  });

  it('refuses a stored gamble whose round state was superseded', async () => {
    await fund();
    seedQueue = [WIN_SEED, GAMBLE_WIN_SEED, GAMBLE_LOSE_SEED];
    const bet = await act('bet', { slotBet: 1, slotLines: 10 }, fresh());
    const enter = await act('recoveryGamble', {}, bet.ctx);
    const sessionId = await sid();
    const requestId = nextRequestId();
    // Prepare the draw durably, then fail before settlement so the row survives.
    injectedFailures = 1;
    await expect(
      game.handleGameplay(
        { userId, sessionId },
        'slotGamble',
        { slotEvent: 'slotGamble', gambleChoice: 'red' },
        { 'x-pilot-version': enter.ctx.version, 'x-pilot-round': enter.ctx.round },
        requestId,
      ),
    ).rejects.toThrow('INJECTED_SETTLEMENT_FAILURE');
    expect(await prisma.gamePreparedOutcome.count()).toBe(1);

    // A newer authoritative state supersedes the stored outcome.
    const round = await prisma.casinoRound.findFirstOrThrow({ where: { userId } });
    const state = round.privateState as unknown as { version: number };
    await prisma.casinoRound.update({
      where: { id: round.id },
      data: {
        privateState: {
          ...(round.privateState as Record<string, unknown>),
          version: state.version + 1,
        } as Prisma.InputJsonValue,
      },
    });

    // Reconciliation drops the stale outcome instead of applying it to a newer
    // state, and the request is answered by a fresh, correctly-gated draw.
    const drawsBefore = draws;
    const settled = (await game.handleGameplay(
      { userId, sessionId },
      'slotGamble',
      { slotEvent: 'slotGamble', gambleChoice: 'red' },
      { 'x-pilot-version': String(state.version + 1), 'x-pilot-round': round.id },
      requestId,
    )) as unknown as Protocol;
    expect(settled.responseEvent).toBe('gambleResult');
    expect(draws - drawsBefore).toBe(1);
    expect(await prisma.gamePreparedOutcome.count()).toBe(0);
    const after = await prisma.casinoRound.findFirstOrThrow({ where: { id: round.id } });
    const afterState = after.privateState as unknown as { gamble: { attempts: number } };
    expect(afterState.gamble.attempts).toBe(1);
  });

  it('scopes every read and action to the authenticated owner', async () => {
    await fund(1_000n);
    await fund(1_000n, rivalId);
    seedQueue = [WIN_SEED, ZERO_SEED, ZERO_SEED];
    const bet = await act('bet', { slotBet: 1, slotLines: 10 }, fresh());
    const round = await prisma.casinoRound.findFirstOrThrow({ where: { userId } });

    const rivalView = (await game.settings(rivalId)).recovery as unknown as Protocol['recovery'];
    expect(rivalView.roundId).toBe('none');
    expect(rivalView.phase).toBe('IDLE');

    // Guessing the owner's round identifier is not enough: the guard and the
    // ownership-qualified reads both refuse it.
    await expect(
      game.handleGameplay(
        { userId: rivalId, sessionId: await sid(rivalId) },
        'bet',
        { slotEvent: 'bet', slotBet: 1, slotLines: 10 },
        { 'x-pilot-version': String(bet.response.recovery.version), 'x-pilot-round': round.id },
        nextRequestId(),
      ),
    ).rejects.toMatchObject({ response: { code: 'STALE_ROUND' } });

    // The rival plays their own round and still cannot touch the owner's action.
    const rivalBet = await act('bet', { slotBet: 1, slotLines: 10 }, fresh(), nextRequestId(), rivalId);
    expect(rivalBet.response.recovery.roundId).not.toBe(round.id);
    expect(await prisma.casinoRound.count({ where: { userId } })).toBe(1);
    expect(await prisma.casinoRound.count({ where: { userId: rivalId } })).toBe(1);
    expect(await prisma.casinoRoundAction.count({ where: { userId } })).toBe(1);
    expect(await prisma.casinoRoundAction.count({ where: { userId: rivalId } })).toBe(1);

    // The owner's action identity is scoped to the owner: the rival's read of
    // that identifier is not the owner's action.
    const foreign = await game.acknowledge(rivalId, { actionId: bet.response.recovery.actionId as string });
    expect(foreign.accepted).toBe(false);
    const ownerAction = await prisma.casinoRoundAction.findFirstOrThrow({ where: { userId } });
    expect(ownerAction.ackedAt).not.toBeNull();

    // Reusing the owner's request identifier creates the rival's own action
    // rather than replaying the owner's stored response.
    const reused = await act('bet', { slotBet: 1, slotLines: 10 }, rivalBet.ctx, bet.requestId, rivalId);
    expect(reused.response.recovery.roundId).not.toBe(round.id);
    expect(await prisma.casinoRound.count({ where: { userId } })).toBe(1);
    const rivalMoves = await prisma.ledgerEntry.findMany({ where: { wallet: { userId: rivalId } } });
    expect(rivalMoves.filter((entry) => entry.type === 'CASINO_BET')).toHaveLength(2);
    expect(rivalMoves.every((entry) => entry.relatedCasinoRoundId !== round.id)).toBe(true);
  });

  it('reports a conflict instead of discarding pending winnings', async () => {
    await fund();
    seedQueue = [WIN_SEED];
    const bet = await act('bet', { slotBet: 1, slotLines: 10 }, fresh());
    const conflict = await act('bet', { slotBet: 1, slotLines: 10 }, bet.ctx);
    expect(conflict.response.responseEvent).toBe('recoveryConflict');
    expect(conflict.response.recovery.phase).toBe('PENDING_WIN');
    expect(conflict.response.recovery.pendingWin).toBe(bet.response.recovery.pendingWin);
    expect(await prisma.casinoRound.count({ where: { userId } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(1);
  });

  it('exposes the platform wallet balance, not a spendable pending win', async () => {
    await fund(500n);
    seedQueue = [WIN_SEED];
    const bet = await act('bet', { slotBet: 10, slotLines: 10 }, fresh());
    expect(bet.response.recovery.pendingWin).toBeGreaterThan(0);
    expect(bet.response.recovery.balance).toBe(400);
    const settings = await game.settings(userId);
    expect((settings.recovery as unknown as Protocol['recovery']).balance).toBe(400);
    expect((settings.serverResponse as unknown as { Balance: number }).Balance).toBe(400);
  });

  it('enforces the configured availability switch on the player path', async () => {
    await fund();
    await prisma.casinoGameConfig.create({ data: { gameId: LUCKY_LADY_GAME_ID, enabled: false } });
    await expect(game.issueLaunch(userId)).rejects.toMatchObject({ response: { code: 'CASINO_GAME_DISABLED' } });
    await prisma.casinoGameConfig.update({
      where: { gameId: LUCKY_LADY_GAME_ID },
      data: { enabled: true, maintenance: true },
    });
    await expect(game.issueLaunch(userId)).rejects.toMatchObject({ response: { code: 'CASINO_GAME_MAINTENANCE' } });
  });

  describe('HTTP surface', () => {
    let app: INestApplication;
    let auth: AuthService;
    let redis: RedisService;
    const password = 'lucky-lady-player-password';
    const httpEmail = uniqueTestEmail('lucky-http-player');
    const httpAdminEmail = uniqueTestEmail('lucky-http-admin');

    beforeAll(async () => {
      await prisma.$connect();
      const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = module.createNestApplication();
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
      app.useGlobalInterceptors(new BigIntInterceptor());
      await app.init();
      auth = app.get(AuthService);
      redis = app.get(RedisService);
      await redis.ensureConnected();
    });

    afterAll(async () => {
      if (app) await app.close();
    });

    const server = () => app.getHttpServer();

    it('runs the launch, exchange and gameplay protocol over HTTP', async () => {
      // Users are created inside the test because the outer beforeEach resets
      // the database between tests.
      const hash = await argon2.hash(password);
      const [player, admin] = await Promise.all([
        prisma.user.create({ data: { email: httpEmail, passwordHash: hash, wallet: { create: {} } } }),
        prisma.user.create({ data: { email: httpAdminEmail, passwordHash: hash, role: 'ADMIN', wallet: { create: {} } } }),
      ]);
      await points.adminGrant(admin.id, player.id, 1_000n, 'HTTP funding', nextRequestId());
      const playerToken = (await auth.login(httpEmail, password)).pair.accessToken;
      const adminToken = (await auth.login(httpAdminEmail, password)).pair.accessToken;

      await request(server())
        .post('/casino/lucky-lady/launch')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);

      const launched = await request(server())
        .post('/casino/lucky-lady/launch')
        .set('Authorization', `Bearer ${playerToken}`)
        .expect(201);
      expect(launched.body.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);

      await request(server()).post('/casino/lucky-lady/launch').expect(401);
      await request(server())
        .post('/casino/lucky-lady/launch/exchange')
        .send({ token: 'not-a-real-launch-token-value-here' })
        .expect(401);

      const exchange = await request(server())
        .post('/casino/lucky-lady/launch/exchange')
        .send({ token: launched.body.token })
        .expect(200);
      expect(typeof exchange.body.sessionToken).toBe('string');

      const sessionToken = exchange.body.sessionToken as string;
      const settings = await request(server())
        .post('/casino/lucky-lady/session/gameplay')
        .set('x-lucky-session', sessionToken)
        .send({ slotEvent: 'getSettings' })
        .expect(200);
      expect(settings.body.responseEvent).toBe('getSettings');
      expect(settings.body.recovery.balance).toBe(1000);

      // Unknown fields and unsupported events are rejected by validation.
      await request(server())
        .post('/casino/lucky-lady/session/gameplay')
        .set('x-lucky-session', sessionToken)
        .send({ slotEvent: 'getSettings', userId: 'forged' })
        .expect(400);
      await request(server())
        .post('/casino/lucky-lady/session/gameplay')
        .set('x-lucky-session', sessionToken)
        .send({ slotEvent: 'adminGrant' })
        .expect(400);
      await request(server())
        .post('/casino/lucky-lady/session/gameplay')
        .send({ slotEvent: 'getSettings' })
        .expect(401);

      // A paid round over the real HTTP surface settles exactly one debit.
      const bet = await request(server())
        .post('/casino/lucky-lady/session/gameplay')
        .set('x-lucky-session', sessionToken)
        .set('x-pilot-request-id', `http-${Date.now().toString(36)}-1`)
        .set('x-pilot-version', '1')
        .set('x-pilot-round', 'none')
        .send({ slotEvent: 'bet', slotBet: 1, slotLines: 10 })
        .expect(200);
      expect(bet.body.responseEvent).toBe('spin');
      const symbols = bet.body.serverResponse.reelsSymbols as Record<string, string[]>;
      expect([1, 2, 3, 4, 5].flatMap((reel) => symbols[`reel${reel}`].slice(0, 3))).toHaveLength(15);
      expect(bet.body.recovery.balance).toBe(990);

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: player.id } });
      expect(wallet.balance).toBe(990n);
      expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(1);
      await redis.client.flushdb();
    });
  });
});
