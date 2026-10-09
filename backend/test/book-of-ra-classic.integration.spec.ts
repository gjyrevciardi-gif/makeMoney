import { createHash } from 'node:crypto';
import { PrismaService } from '../src/prisma.service';
import { CasinoConfigService } from '../src/casino/casino-config.service';
import { CasinoGameRegistry } from '../src/casino/casino-game.registry';
import { GameCapabilityService } from '../src/casino/platform/game-capability.service';
import { GameJournalService } from '../src/casino/platform/game-journal.service';
import { GameRoundService } from '../src/casino/platform/game-round.service';
import { GameWalletService } from '../src/casino/platform/game-wallet.service';
import { GameActionContext, GamePlatform } from '../src/casino/platform/game-adapter.types';
import { createSimulationRng } from '../src/casino/platform/math-control/math-control.random';
import { canonicalProfileHash } from '../src/casino/platform/math-control/math-control.analytics';
import type { MathControlService } from '../src/casino/platform/math-control/math-control.service';
import type { MathPolicy, MathProfileArtifact } from '../src/casino/platform/math-control/math-control.types';
import {
  CLASSIC_ID,
  ClassicProfile,
  IntRng,
  playRound,
} from '../src/casino/games/book-of-ra-classic/classic.engine';
import { CLASSIC_V1 } from '../src/casino/games/book-of-ra-classic/classic.definition';
import {
  CLASSIC_CAPABILITY,
  ClassicAdapter,
  ClassicState,
} from '../src/casino/games/book-of-ra-classic/classic.adapter';
import {
  assertClassicArtifact,
  classicIdentity,
  defaultClassicProfile,
} from '../src/casino/games/book-of-ra-classic/classic.math-adapter';
import { PointsService } from '../src/wallet/points.service';
import { uniqueTestEmail } from './test-identity';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Deterministic fixture seeds, discovered with
 * `games/book-of-ra-classic/scripts/find-fixture-seeds.cjs` by running the same
 * accepted evaluator this suite runs. A dedicated test re-derives every property
 * from the engine, so a drift in the mathematics fails loudly instead of
 * silently reselecting a different board.
 */
const ZERO_SEED = 'classic-0'; // no paid win, no feature
const WIN_SEED = 'classic-2'; // paid win, no feature
const FEATURE_SEED = 'classic-312'; // exactly ten free games, no retrigger
const RETRIGGER_SEED = 'classic-2879'; // twenty free games after one retrigger

/** The frozen Classic artefact's own identity. */
const FROZEN_PROFILE_HASH = 'a2f6fef07d3afa792bafda0af824fecb0042d8295e83dc9672b437cc18480d48';

/** The shared simulator speaks `int(min,max)`; the engine speaks `int(upper)`. */
const intRng = (seed: string): IntRng => {
  const rng = createSimulationRng(seed);
  return (upper) => rng.int(0, upper - 1);
};

type Snapshot = {
  version: number;
  roundId: string;
  phase: string;
  balance: number;
  pendingWin: number;
  bet: { slotBet: number; slotLines: number } | null;
  result: { responseEvent: string; responseType?: string; serverResponse: Record<string, unknown> } | null;
  lastGamble: Record<string, unknown> | null;
  free: { total: number; current: number; remaining: number; multiplier: number };
  gamble: { attempts: number; cards: string[] };
  settlement: { collected: boolean };
  profile: { id: string; hash: string; version: number };
  actionId: string | null;
  receipt: { event: string | null; delivered: boolean; acked: boolean };
};

type Protocol = {
  responseEvent: string;
  responseType?: string;
  serverResponse?: Record<string, unknown>;
  recovery: Snapshot;
};

/**
 * Book of Ra Classic on the real platform: launch authorization, the native
 * protocol, PostgreSQL settlement, the prepared-outcome journal, recovery and
 * ownership.
 *
 * Deterministic draws are injected through the adapter's constructor seam, which
 * the production module never supplies. Every board asserted below is the board
 * the accepted evaluator produces for that seed, so nothing is fabricated.
 */
describe('Book of Ra Classic platform integration (PostgreSQL)', () => {
  const prisma = new PrismaService();
  const registry = new CasinoGameRegistry();
  const configs = new CasinoConfigService(prisma, registry);
  const points = new PointsService(prisma);

  let requestCounter = 0;
  let rngCalls = 0;
  let afterPrepareFailures = 0;
  let afterDebitFailures = 0;
  const sessions = new Map<string, string>();

  const capabilities = new GameCapabilityService(prisma, registry, configs);
  const platform: GamePlatform = {
    capabilities,
    wallet: new GameWalletService(),
    journal: new GameJournalService(prisma),
    rounds: new GameRoundService(prisma),
  };
  const contextFor = (actor: string, sessionId: string): GameActionContext => ({
    gameId: CLASSIC_ID,
    userId: actor,
    sessionId,
  });

  /** Drives the adapter contract exactly as the shared gateway base does. */
  const apiOf = (adapter: ClassicAdapter) => ({
    handleGameplay: (
      context: { userId: string; sessionId: string },
      event: string,
      body: Record<string, unknown>,
      headers: Record<string, string | undefined>,
      requestId: string,
    ) => adapter.execute(contextFor(context.userId, context.sessionId), {
      event, body, headers, requestId,
    }) as Promise<Protocol>,
    settings: async (actor: string) =>
      adapter.read(contextFor(actor, await sid(actor)), 'getSettings', {}) as Promise<Protocol>,
    acknowledge: async (actor: string, body: Record<string, unknown>) =>
      adapter.read(contextFor(actor, await sid(actor)), 'ack', body) as Promise<{
        responseEvent: string; actionId: string | null; accepted: boolean; reason?: string;
      }>,
  });

  /** A counting wrapper over a deterministic stream: the strongest "no draw" proof. */
  const countingRng = (seed: string): IntRng => {
    const base = intRng(seed);
    return (upper) => {
      rngCalls += 1;
      return base(upper);
    };
  };

  const adapterWith = (rngForRound?: () => IntRng, mathControl?: unknown) =>
    apiOf(new ClassicAdapter(
      prisma,
      platform,
      configs,
      mathControl as MathControlService | undefined,
      {
        rng: rngForRound ? rngForRound() : undefined,
        afterPrepare: () => {
          if (afterPrepareFailures > 0) {
            afterPrepareFailures -= 1;
            throw new Error('INJECTED_POST_PREPARE_FAILURE');
          }
        },
        afterDebit: () => {
          if (afterDebitFailures > 0) {
            afterDebitFailures -= 1;
            throw new Error('INJECTED_POST_DEBIT_FAILURE');
          }
        },
      },
    ));

  let game = adapterWith();
  /** The production configuration: the OS CSPRNG and no failure hooks. */
  const productionGame = () => apiOf(new ClassicAdapter(prisma, platform, configs));

  const userEmail = uniqueTestEmail('classic-player');
  const rivalEmail = uniqueTestEmail('classic-rival');
  const adminEmail = uniqueTestEmail('classic-admin');
  const superEmail = uniqueTestEmail('classic-super');
  const disabledEmail = uniqueTestEmail('classic-disabled');
  let userId: string;
  let rivalId: string;
  let adminId: string;
  let superId: string;
  let disabledId: string;

  const nextRequestId = () =>
    `req-${Date.now().toString(36)}-${(requestCounter += 1)}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    requestCounter = 0;
    rngCalls = 0;
    afterPrepareFailures = 0;
    afterDebitFailures = 0;
    sessions.clear();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "GameActiveMathProfile", "GameMathProfileValidation", "GameMathProfile", ' +
      '"GamePreparedOutcome", "GameSession", "GameLaunchCapability", "CasinoGameConfigVersion", "CasinoGameConfig", ' +
      '"PlatformSettings", "CasinoTransaction", "CasinoRoundAction", "CasinoRound", "CasinoGameFavorite", ' +
      '"LedgerEntry", "BetLeg", "Bet", "AuditLog", "RefreshToken", "Wallet", "User" CASCADE',
    );
    const [player, rival, admin, superAdmin, disabled] = await Promise.all([
      prisma.user.create({ data: { email: userEmail, passwordHash: 'x', wallet: { create: {} } } }),
      prisma.user.create({ data: { email: rivalEmail, passwordHash: 'x', wallet: { create: {} } } }),
      prisma.user.create({ data: { email: adminEmail, passwordHash: 'x', role: 'ADMIN', wallet: { create: {} } } }),
      prisma.user.create({ data: { email: superEmail, passwordHash: 'x', role: 'SUPER_ADMIN', wallet: { create: {} } } }),
      prisma.user.create({ data: { email: disabledEmail, passwordHash: 'x', disabled: true, wallet: { create: {} } } }),
    ]);
    userId = player.id;
    rivalId = rival.id;
    adminId = admin.id;
    superId = superAdmin.id;
    disabledId = disabled.id;
    game = adapterWith();
  });

  const fund = (amount = 100_000n, target = userId) =>
    points.adminGrant(adminId, target, amount, 'Classic funding', nextRequestId());

  /** A bound gameplay capability, created directly for service-level tests. */
  const sid = async (actor = userId) => {
    const existing = sessions.get(actor);
    if (existing) return existing;
    const token = `session-${actor.slice(0, 8)}-${Math.random().toString(36).slice(2, 12)}`;
    const row = await prisma.gameSession.create({
      data: {
        userId: actor,
        gameId: CLASSIC_ID,
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

  /** Plays one action exactly as the recovered client would, then acknowledges it. */
  const act = async (
    event: string,
    body: Record<string, unknown>,
    ctx: Ctx,
    requestId = nextRequestId(),
    actor = userId,
  ) => {
    const response = await game.handleGameplay(
      { userId: actor, sessionId: await sid(actor) },
      event,
      { slotEvent: event, ...body },
      { 'x-pilot-version': ctx.version, 'x-pilot-round': ctx.round },
      requestId,
    );
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
  const profileOf = (): ClassicProfile => defaultClassicProfile().payload;
  const stateOfRound = async (): Promise<ClassicState> => {
    const round = await prisma.casinoRound.findFirstOrThrow({ where: { userId, gameVersion: { startsWith: `${CLASSIC_ID}.` } }, orderBy: { createdAt: 'desc' } });
    return round.privateState as unknown as ClassicState;
  };
  const betRounds = async (target = userId) =>
    prisma.ledgerEntry.count({ where: { wallet: { userId: target }, type: 'CASINO_BET' } });

  it('still selects the documented fixture seeds from the accepted evaluator', () => {
    const profile = profileOf();
    expect(defaultClassicProfile().hash).toBe(FROZEN_PROFILE_HASH);
    expect(defaultClassicProfile().rulesHash).toBe(classicIdentity().rulesSha256);
    expect(CLASSIC_V1.lines).toBe(9);

    const zero = playRound(profile, 1, 9, intRng(ZERO_SEED));
    expect(zero.totalWin).toBe(0);
    expect(zero.freeSpins).toBe(0);

    const win = playRound(profile, 1, 9, intRng(WIN_SEED));
    expect(win.totalWin).toBeGreaterThan(0);
    expect(win.freeSpins).toBe(0);

    const feature = playRound(profile, 1, 9, intRng(FEATURE_SEED));
    expect(feature.freeSpins).toBe(10);
    expect(feature.retriggers).toBe(0);
    expect(feature.special).not.toBeNull();

    const retrigger = playRound(profile, 1, 9, intRng(RETRIGGER_SEED));
    expect(retrigger.freeSpins).toBe(20);
    expect(retrigger.retriggers).toBe(1);
  });

  it('cannot reach the injected generator from the production configuration', async () => {
    await fund();
    game = adapterWith(() => countingRng(ZERO_SEED));
    const injected = await act('bet', { slotBet: 1, slotLines: 9 }, fresh());
    expect(injected.response.responseEvent).toBe('spin');
    const drawsAfterInjection = rngCalls;
    expect(drawsAfterInjection).toBeGreaterThan(0);

    const production = productionGame();
    const settled = await production.handleGameplay(
      { userId, sessionId: await sid() },
      'bet',
      { slotEvent: 'bet', slotBet: 1, slotLines: 9 },
      { 'x-pilot-version': injected.ctx.version, 'x-pilot-round': injected.ctx.round },
      nextRequestId(),
    );
    expect(settled.responseEvent).toBe('spin');
    // The production adapter drew from the OS CSPRNG: the injected stream was
    // never touched, so the counter cannot have moved.
    expect(rngCalls).toBe(drawsAfterInjection);
  });

  it('serves the native settings with the whole-point ladder and the frozen profile', async () => {
    await fund();
    const settings = await game.settings(userId);
    const native = settings.serverResponse as unknown as {
      Bet: number[];
      Line: number[];
      gameLine: number[];
      mathConfig: { activeMathProfile: string; profileHash: string; targetRtpPercent: number; validatedLines: number; stakeUnit: string; gameId: string };
    };
    expect(native.Bet).toEqual([1, 2, 5, 10, 20]);
    expect(native.Line).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(native.gameLine).toEqual(native.Line);
    expect(native.mathConfig.gameId).toBe(CLASSIC_ID);
    expect(native.mathConfig.stakeUnit).toBe('WHOLE_POINTS');
    // Nothing has been activated, so the reported mathematics is the frozen
    // artefact a new round will actually pin.
    expect(native.mathConfig.activeMathProfile).toBe('book-of-ra-classic.rtp50.v1');
    expect(native.mathConfig.profileHash).toBe(FROZEN_PROFILE_HASH);
    expect(native.mathConfig.targetRtpPercent).toBe(50);
    expect(native.mathConfig.validatedLines).toBe(9);
    expect(settings.recovery.roundId).toBe('none');
    expect(settings.recovery.phase).toBe('IDLE');
  });

  it('debits exactly the selected native stake and returns the predicted board', async () => {
    await fund();
    game = adapterWith(() => countingRng(WIN_SEED));
    const predicted = playRound(profileOf(), 2, 9, intRng(WIN_SEED));
    const round = await act('bet', { slotBet: 2, slotLines: 9 }, fresh());
    const server = round.response.serverResponse as unknown as {
      reelsSymbols: { reel1: string[]; reel2: string[]; reel3: string[]; reel4: string[]; reel5: string[]; rp: number[] };
      totalWin: number;
      winLines: unknown[];
      bonusInfo: { scattersType: string; scattersWin: number };
      expPay: number;
      expReels: boolean[];
      expLines: unknown[];
      Balance: number;
      afterBalance: number;
      totalFreeGames: number;
      currentFreeGames: number;
    };
    const spin = predicted.spins[0];
    expect(server.reelsSymbols.reel1).toEqual(spin.board[0]);
    expect(server.reelsSymbols.reel5).toEqual(spin.board[4]);
    expect(server.reelsSymbols.rp).toEqual(spin.stops);
    expect(server.totalWin).toBe(spin.evaluation.win);
    expect(server.winLines).toHaveLength(spin.evaluation.lineWins.length);
    expect(server.bonusInfo.scattersWin).toBe(spin.evaluation.scatterWin);
    expect(server.bonusInfo.scattersType).toBe(spin.evaluation.trigger ? 'bonus' : 'none');
    // The paid spin never pays the expansion, and the feature has not started.
    expect(server.expPay).toBe(0);
    expect(server.expLines).toEqual([]);
    expect(server.expReels).toEqual([false, false, false, false, false, false]);
    expect(server.totalFreeGames).toBe(0);
    expect(server.currentFreeGames).toBe(0);
    expect(server.afterBalance).toBe(100_000 - 18);

    const debits = await prisma.ledgerEntry.findMany({ where: { type: 'CASINO_BET' } });
    expect(debits).toHaveLength(1);
    expect(debits[0].amount).toBe(-18n);
    expect(await balance()).toBe(100_000n - 18n);
    expect(round.response.recovery.bet).toEqual({ slotBet: 2, slotLines: 9 });
    expect(round.response.recovery.profile).toEqual({
      id: 'book-of-ra-classic.rtp50.v1',
      hash: FROZEN_PROFILE_HASH,
      version: 1,
    });
    // The ledger stays the authoritative record: its sum is the wallet balance.
    expect(await ledgerTotal()).toBe(await balance());
  });

  it('plays the whole ten-game feature from the stored plan and credits exactly once', async () => {
    await fund();
    game = adapterWith(() => countingRng(FEATURE_SEED));
    const predicted = playRound(profileOf(), 1, 9, intRng(FEATURE_SEED));
    expect(predicted.freeSpins).toBe(10);

    let round = await act('bet', { slotBet: 1, slotLines: 9 }, fresh());
    const trigger = round.response.serverResponse as unknown as {
      bonusInfo: { scattersType: string };
      expSymbol?: string;
      totalFreeGames: number;
      currentFreeGames: number;
    };
    expect(trigger.bonusInfo.scattersType).toBe('bonus');
    // The trigger response already names the persistent expanding symbol.
    expect(trigger.expSymbol).toBe(predicted.special);
    expect(trigger.totalFreeGames).toBe(10);
    expect(trigger.currentFreeGames).toBe(0);
    expect(round.response.recovery.phase).toBe('FREE_SPINS');
    expect(round.response.recovery.free).toEqual({ total: 10, current: 0, remaining: 10, multiplier: 1 });

    for (let index = 1; index <= 10; index += 1) {
      round = await act('freespin', { slotBet: 1, slotLines: 9 }, round.ctx);
      const server = round.response.serverResponse as unknown as {
        reelsSymbols: { reel3: string[] };
        totalWin: number;
        responseType: string;
        currentFreeGames: number;
        totalFreeGames: number;
      };
      const spin = predicted.spins[index];
      expect(round.response.responseEvent).toBe('spin');
      expect(round.response.responseType).toBe('freespin');
      expect(server.reelsSymbols.reel3).toEqual(spin.board[2]);
      expect(server.currentFreeGames).toBe(index);
      expect(server.totalFreeGames).toBe(10);
      expect(round.response.recovery.free.current).toBe(index);
      expect(round.response.recovery.pendingWin).toBe(
        predicted.spins.slice(0, index + 1).reduce((sum, entry) => sum + entry.evaluation.win, 0),
      );
    }
    expect(round.response.recovery.phase).toBe('PENDING_WIN');
    expect(round.response.recovery.free).toEqual({ total: 10, current: 10, remaining: 0, multiplier: 1 });
    expect(round.response.recovery.pendingWin).toBe(predicted.totalWin);
    // Ten free games, one debit for the paid round.
    expect(await betRounds()).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_WIN' } })).toBe(0);
    expect(await balance()).toBe(100_000n - 9n);

    const collected = await act('recoveryCollect', {}, round.ctx);
    expect(collected.response.responseEvent).toBe('recoveryAck');
    expect(collected.response.recovery.phase).toBe('IDLE');
    expect(collected.response.recovery.settlement.collected).toBe(true);
    const wins = await prisma.ledgerEntry.findMany({ where: { type: 'CASINO_WIN' } });
    expect(wins).toHaveLength(1);
    expect(wins[0].amount).toBe(BigInt(predicted.totalWin));
    expect(await balance()).toBe(100_000n - 9n + BigInt(predicted.totalWin));
    expect(await ledgerTotal()).toBe(await balance());
  });

  it('extends a live feature on a retrigger without a second debit', async () => {
    await fund();
    game = adapterWith(() => countingRng(RETRIGGER_SEED));
    const predicted = playRound(profileOf(), 1, 9, intRng(RETRIGGER_SEED));
    expect(predicted.retriggers).toBe(1);
    expect(predicted.freeSpins).toBe(20);

    let round = await act('bet', { slotBet: 1, slotLines: 9 }, fresh());
    let sawExtension = false;
    for (let index = 1; index <= predicted.freeSpins; index += 1) {
      round = await act('freespin', { slotBet: 1, slotLines: 9 }, round.ctx);
      const total = round.response.recovery.free.total;
      if (total === 10 + 10) {
        sawExtension = true;
        // The retrigger adds exactly one more run of ten games.
        expect(round.response.recovery.free.remaining).toBe(total - index);
      }
    }
    expect(sawExtension).toBe(true);
    expect(round.response.recovery.phase).toBe('PENDING_WIN');
    expect(round.response.recovery.pendingWin).toBe(predicted.totalWin);
    expect(await betRounds()).toBe(1);

    const collected = await act('recoveryCollect', {}, round.ctx);
    const wins = await prisma.ledgerEntry.findMany({ where: { type: 'CASINO_WIN' } });
    expect(collected.response.recovery.phase).toBe('IDLE');
    expect(wins).toHaveLength(1);
    expect(wins[0].amount).toBe(BigInt(predicted.totalWin));
    expect(await betRounds()).toBe(1);
  });

  it('resolves the fair red/black gamble, caps it at five attempts and moves no money', async () => {
    await fund();
    const seed = WIN_SEED;
    // Replay the exact draw stream the adapter will consume: the round, then one
    // colour and one dealer-card face per gamble.
    const predict = intRng(seed);
    const paid = playRound(profileOf(), 1, 9, predict);
    expect(paid.freeSpins).toBe(0);
    const drawnColours: string[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      drawnColours.push(predict(2) === 0 ? 'red' : 'black');
      predict(2); // the dealer card face
    }

    game = adapterWith(() => countingRng(seed));
    let round = await act('bet', { slotBet: 1, slotLines: 9 }, fresh());
    expect(round.response.recovery.phase).toBe('PENDING_WIN');
    const startingPending = round.response.recovery.pendingWin;
    expect(startingPending).toBe(paid.spins[0].evaluation.win);

    round = await act('recoveryGamble', {}, round.ctx);
    expect(round.response.recovery.phase).toBe('GAMBLE');
    expect(round.response.recovery.gamble.attempts).toBe(0);

    let pending = startingPending;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      pending *= 2;
      const gamble = await act('slotGamble', { gambleChoice: drawnColours[attempt] }, round.ctx);
      const server = gamble.response.serverResponse as unknown as {
        gambleState: string;
        totalWin: number;
        dealerCard: string;
      };
      expect(gamble.response.responseEvent).toBe('gambleResult');
      expect(server.gambleState).toBe('win');
      // The native dealer card always shows the dealer's own colour.
      expect(drawnColours[attempt] === 'red' ? ['H', 'D'] : ['S', 'C']).toContain(server.dealerCard);
      expect(server.totalWin).toBe(pending);
      expect(gamble.response.recovery.pendingWin).toBe(pending);
      expect(gamble.response.recovery.gamble.attempts).toBe(attempt + 1);
      expect(gamble.response.recovery.gamble.cards).toHaveLength(attempt + 1);
      round = gamble;
    }
    expect(pending).toBe(startingPending * 32);
    // The gamble never touches the wallet: one debit, no credit yet.
    expect(await betRounds()).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_WIN' } })).toBe(0);

    await expect(act('slotGamble', { gambleChoice: 'red' }, round.ctx)).rejects.toMatchObject({
      response: { code: 'COLLECT_REQUIRED' },
    });

    const collected = await act('recoveryCollect', {}, round.ctx);
    expect(collected.response.recovery.phase).toBe('IDLE');
    const wins = await prisma.ledgerEntry.findMany({ where: { type: 'CASINO_WIN' } });
    expect(wins).toHaveLength(1);
    expect(wins[0].amount).toBe(BigInt(pending));
    expect(await ledgerTotal()).toBe(await balance());
  });

  it('closes a losing gamble with a zero pending win and no ledger movement', async () => {
    await fund();
    const predict = intRng(WIN_SEED);
    const paid = playRound(profileOf(), 1, 9, predict);
    const drawn = predict(2) === 0 ? 'red' : 'black';
    const losing = drawn === 'red' ? 'black' : 'red';

    game = adapterWith(() => countingRng(WIN_SEED));
    let round = await act('bet', { slotBet: 1, slotLines: 9 }, fresh());
    expect(round.response.recovery.pendingWin).toBe(paid.spins[0].evaluation.win);
    round = await act('recoveryGamble', {}, round.ctx);
    const gamble = await act('slotGamble', { gambleChoice: losing }, round.ctx);
    const server = gamble.response.serverResponse as unknown as { gambleState: string; totalWin: number };
    expect(server.gambleState).toBe('lose');
    expect(server.totalWin).toBe(0);
    expect(gamble.response.recovery.phase).toBe('IDLE');
    expect(gamble.response.recovery.pendingWin).toBe(0);
    // A loss cannot debit the original stake a second time.
    expect(await betRounds()).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_WIN' } })).toBe(0);
    expect(await balance()).toBe(100_000n - 9n);
  });

  it('restores the same resolved state on a mid-feature refresh without advancing it', async () => {
    await fund();
    game = adapterWith(() => countingRng(FEATURE_SEED));
    const predicted = playRound(profileOf(), 1, 9, intRng(FEATURE_SEED));
    let round = await act('bet', { slotBet: 1, slotLines: 9 }, fresh());
    for (let index = 1; index <= 3; index += 1) {
      round = await act('freespin', { slotBet: 1, slotLines: 9 }, round.ctx);
    }
    const before = round.response.recovery;
    const drawsBefore = rngCalls;

    const refreshed = await game.settings(userId);
    expect(refreshed.recovery.free).toEqual(before.free);
    expect(refreshed.recovery.pendingWin).toBe(before.pendingWin);
    expect(refreshed.recovery.phase).toBe('FREE_SPINS');
    expect(refreshed.recovery.roundId).toBe(before.roundId);
    expect(refreshed.recovery.result?.serverResponse.reelsSymbols).toEqual(
      before.result?.serverResponse.reelsSymbols,
    );
    // A read never draws and never consumes a free game.
    expect(rngCalls).toBe(drawsBefore);
    expect(refreshed.recovery.free.current).toBe(3);

    const next = await act('freespin', { slotBet: 1, slotLines: 9 }, round.ctx);
    expect(next.response.recovery.free.current).toBe(4);
    expect((next.response.serverResponse as unknown as { reelsSymbols: { reel1: string[] } }).reelsSymbols.reel1)
      .toEqual(predicted.spins[4].board[0]);
  });

  it('replays an identical request exactly once and refuses different semantics under one identity', async () => {
    await fund();
    expect(await balance()).toBe(100_000n);
    game = adapterWith(() => countingRng(ZERO_SEED));
    const requestId = nextRequestId();
    const first = await act('bet', { slotBet: 1, slotLines: 9 }, fresh(), requestId);
    const drawsAfterFirst = rngCalls;
    const replay = await act('bet', { slotBet: 1, slotLines: 9 }, fresh(), requestId);
    expect(replay.response).toEqual(first.response);
    // A replay neither draws nor debits again.
    expect(rngCalls).toBe(drawsAfterFirst);
    expect(await betRounds()).toBe(1);
    expect(await prisma.casinoRoundAction.count({ where: { idempotencyKey: `${userId}:${requestId}` } })).toBe(1);

    await expect(act('bet', { slotBet: 2, slotLines: 9 }, fresh(), requestId)).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_CONFLICT' },
    });
    expect(await betRounds()).toBe(1);
  });

  it('refuses a stale round guard and keeps two players apart', async () => {
    await fund();
    game = adapterWith(() => countingRng(ZERO_SEED));
    const round = await act('bet', { slotBet: 1, slotLines: 9 }, fresh());

    await expect(
      act('freespin', { slotBet: 1, slotLines: 9 }, { version: '9', round: round.ctx.round }),
    ).rejects.toMatchObject({ response: { code: 'STALE_ROUND' } });
    await expect(
      act('bet', { slotBet: 1, slotLines: 9 }, fresh()),
    ).rejects.toMatchObject({ response: { code: 'STALE_ROUND' } });

    // The rival's session sees only the rival's own, empty state.
    await fund(1_000n, rivalId);
    const rivalView = await game.settings(rivalId);
    expect(rivalView.recovery.roundId).toBe('none');
    expect(rivalView.recovery.phase).toBe('IDLE');
    expect(rivalView.recovery.balance).toBe(1000);
    expect(JSON.stringify(rivalView)).not.toContain(round.ctx.round);
    expect(JSON.stringify(rivalView)).not.toContain('reelsSymbols');
  });

  it('settles a prepared round after a post-prepare failure without drawing again', async () => {
    await fund();
    game = adapterWith(() => countingRng(WIN_SEED));
    afterPrepareFailures = 1;
    await expect(act('bet', { slotBet: 1, slotLines: 9 }, fresh(), 'prepared-failure-0001'))
      .rejects.toThrow('INJECTED_POST_PREPARE_FAILURE');
    const drawsAfterFailure = rngCalls;
    // Nothing settled yet: no debit and no round.
    expect(await betRounds()).toBe(0);
    expect(await prisma.casinoRound.count()).toBe(0);
    expect(await prisma.gamePreparedOutcome.count()).toBe(1);

    // The next authoritative read reconciles the stored outcome exactly once,
    // and never re-draws it.
    const reconciled = await game.settings(userId);
    expect(rngCalls).toBe(drawsAfterFailure);
    expect(reconciled.recovery.phase).toBe('PENDING_WIN');
    expect(reconciled.recovery.pendingWin).toBeGreaterThan(0);
    expect(await betRounds()).toBe(1);
    expect(await prisma.gamePreparedOutcome.count()).toBe(0);
    expect(await prisma.casinoRound.count()).toBe(1);
  });

  it('rolls a debited-but-uncommitted round back and settles it once on recovery', async () => {
    await fund();
    game = adapterWith(() => countingRng(WIN_SEED));
    afterDebitFailures = 1;
    await expect(act('bet', { slotBet: 1, slotLines: 9 }, fresh(), 'debit-failure-0001'))
      .rejects.toThrow('INJECTED_POST_DEBIT_FAILURE');
    const drawsAfterFailure = rngCalls;
    expect(await balance()).toBe(100_000n);
    expect(await betRounds()).toBe(0);
    expect(await prisma.casinoRound.count()).toBe(0);
    expect(await prisma.casinoRoundAction.count()).toBe(0);

    const reconciled = await game.settings(userId);
    expect(rngCalls).toBe(drawsAfterFailure);
    expect(reconciled.recovery.phase).toBe('PENDING_WIN');
    expect(await betRounds()).toBe(1);
    expect(await balance()).toBe(100_000n - 9n);
    expect(await prisma.casinoRound.count()).toBe(1);
  });

  it('pins the activated profile on the round and reports it truthfully', async () => {
    await fund();
    const artifact = publishedArtifact(50, 50);
    const mathControl = {
      activeProfile: async (gameId: string) =>
        gameId === CLASSIC_ID ? { artifact, validationId: 'validation-1', version: 3 } : null,
    };
    game = adapterWith(() => countingRng(ZERO_SEED), mathControl);

    const settings = await game.settings(userId);
    const native = settings.serverResponse as unknown as {
      mathConfig: { activeMathProfile: string; profileHash: string };
    };
    expect(native.mathConfig.activeMathProfile).toBe(artifact.profileId);
    expect(native.mathConfig.profileHash).toBe(artifact.canonicalHash);

    const round = await act('bet', { slotBet: 1, slotLines: 9 }, fresh());
    expect(round.response.recovery.profile).toEqual({
      id: artifact.profileId,
      hash: artifact.canonicalHash,
      version: 3,
    });
    expect((await stateOfRound()).profileHash).toBe(artifact.canonicalHash);

    // A profile generated against different mathematics can never be executed.
    const tampered = { ...artifact, engineSha256: 'f'.repeat(64) };
    const unsafe = adapterWith(() => countingRng(ZERO_SEED), {
      activeProfile: async () => ({ artifact: tampered, validationId: null, version: 1 }),
    });
    await expect(unsafe.handleGameplay(
      { userId, sessionId: await sid() },
      'bet',
      { slotEvent: 'bet', slotBet: 1, slotLines: 9 },
      { 'x-pilot-version': '1', 'x-pilot-round': 'none' },
      nextRequestId(),
    )).rejects.toThrow('CLASSIC_PROFILE_IDENTITY_MISMATCH');
  });

  it('issues a launch capability to every GAME_PLAY role, binds it to one game and consumes it once', async () => {
    const issue = async (actor: string) => capabilities.issueLaunch(actor, {
      gameId: CLASSIC_ID,
      scope: CLASSIC_CAPABILITY.scope,
      ttlMs: CLASSIC_CAPABILITY.launchTtlMs,
      gamePath: CLASSIC_CAPABILITY.gamePath,
    });
    for (const actor of [userId, adminId, superId]) {
      const grant = await issue(actor);
      expect(grant.gamePath).toBe('/games/BookOfRaCL/');
      const row = await prisma.gameLaunchCapability.findFirstOrThrow({ where: { userId: actor } });
      // Only the hash is stored, never the capability itself.
      expect(row.tokenHash).toBe(sha256(grant.token));
      const session = await capabilities.exchangeLaunch(grant.token, {
        gameId: CLASSIC_ID,
        scope: CLASSIC_CAPABILITY.scope,
        sessionTtlMs: CLASSIC_CAPABILITY.sessionTtlMs,
      });
      expect(session.userId).toBe(actor);
      const identity = await capabilities.assertSession(session.sessionToken, CLASSIC_ID);
      expect(identity.userId).toBe(actor);
      // A consumed capability can never be replayed.
      await expect(capabilities.exchangeLaunch(grant.token, {
        gameId: CLASSIC_ID,
        scope: CLASSIC_CAPABILITY.scope,
        sessionTtlMs: CLASSIC_CAPABILITY.sessionTtlMs,
      })).rejects.toBeDefined();
    }
    // A disabled account holds no GAME_PLAY capability at all.
    await expect(issue(disabledId)).rejects.toBeDefined();
    // A capability minted for another game's scope is not accepted here.
    const foreign = await capabilities.issueLaunch(userId, {
      gameId: CLASSIC_ID,
      scope: 'game:book-of-ra:play',
      ttlMs: CLASSIC_CAPABILITY.launchTtlMs,
    });
    await expect(capabilities.exchangeLaunch(foreign.token, {
      gameId: CLASSIC_ID,
      scope: CLASSIC_CAPABILITY.scope,
      sessionTtlMs: CLASSIC_CAPABILITY.sessionTtlMs,
    })).rejects.toBeDefined();
  });

  /** A valid artifact for the frozen payload, as the generator would publish it. */
  function publishedArtifact(targetRtpPercent: number, maxWinMultiplier: number): MathProfileArtifact {
    const payload = profileOf();
    const policy: MathPolicy = {
      gameId: CLASSIC_ID,
      targetRtpPercent,
      maxWinMultiplier,
      pacing: 'BALANCED',
      customPacing: null,
      hitRate: { mode: 'AUTO' },
      partialReturn: 'MED',
      volatility: 'MED',
      bigWinMinMultiplier: 10,
      bigWinMaxMultiplier: 50,
      featureContribution: { minPercent: 0, maxPercent: 60 },
      presets: [],
      maxWinScope: 'RESOLVED_SPIN',
      maxWinEnabled: true,
    };
    const artifact: MathProfileArtifact = {
      schemaVersion: 1,
      profileId: `${CLASSIC_ID}.g${hashOf({ payload, policy }).slice(0, 20)}`,
      gameId: CLASSIC_ID,
      ...classicIdentity(),
      policy,
      payload,
      canonicalHash: '',
      createdAt: new Date().toISOString(),
    };
    artifact.canonicalHash = canonicalProfileHash(artifact);
    assertClassicArtifact(artifact);
    return artifact;
  }

  function hashOf(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
});
