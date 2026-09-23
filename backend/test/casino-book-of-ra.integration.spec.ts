import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { BOOK_OF_RA_GAME, BOOK_OF_RA_PROFILE, SeededRngProvider, type RngDraw, type RngProvider } from '@slot-skills/math';
import { evaluateBookOfRa } from '@slot-skills/math';
import type { Grid } from '@slot-skills/math';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { BigIntInterceptor } from '../src/common/bigint.interceptor';
import { RedisService } from '../src/common/redis.service';
import { PrismaService } from '../src/prisma.service';
import { PointsService } from '../src/wallet/points.service';
import { CasinoConfigService } from '../src/casino/casino-config.service';
import { CasinoFairnessService } from '../src/casino/casino-fairness.service';
import { CasinoGameRegistry } from '../src/casino/casino-game.registry';
import { BookOfRaService } from '../src/casino/games/book-of-ra/book-of-ra.service';
import {
  BOOK_ACTIVE_LINES,
  BOOK_GAME_ID,
  BOOK_PROFILE_FINGERPRINT,
  BOOK_PROFILE_ID,
} from '../src/casino/games/book-of-ra/book-of-ra.definition';
import { uniqueTestEmail } from './test-identity';

const SYMBOL_ORDER = BOOK_OF_RA_GAME.symbols.map((symbol) => symbol.id);
const WEIGHTS = BOOK_OF_RA_PROFILE.symbolWeights as Record<string, number>;
const NORMAL_ORDER = BOOK_OF_RA_GAME.symbols.filter((symbol) => symbol.kind === 'normal').map((symbol) => symbol.id);

/** The first weight value that selects the requested symbol. */
function drawFor(symbolId: string): number {
  let cursor = 0;
  for (const id of SYMBOL_ORDER) {
    if (id === symbolId) return cursor;
    cursor += WEIGHTS[id]!;
  }
  throw new Error(`Unknown symbol ${symbolId}`);
}

function gridDraws(grid: Grid): number[] {
  const values: number[] = [];
  for (let reel = 0; reel < grid.length; reel += 1) {
    for (let row = 0; row < grid[reel]!.length; row += 1) values.push(drawFor(grid[reel]![row]!));
  }
  return values;
}

function blankGrid(symbolId = 'low-5'): Grid {
  return Array.from({ length: 5 }, () => [symbolId, symbolId, symbolId]);
}

/**
 * A genuinely losing board: consecutive reels never share a symbol and no Book
 * lands, so no payline can reach two-of-a-kind.
 */
function losingGrid(): Grid {
  return [
    ['low-1', 'low-2', 'low-3'],
    ['low-4', 'low-5', 'high-1'],
    ['high-2', 'high-3', 'high-4'],
    ['low-1', 'low-2', 'low-3'],
    ['low-4', 'low-5', 'high-1'],
  ];
}

/** The losing board with one full premium line: only line 1 can pay. */
function jackpotGrid(): Grid {
  const grid = losingGrid();
  for (let reel = 0; reel < 5; reel += 1) grid[reel]![1] = 'high-1';
  return grid;
}

function triggerGrid(): Grid {
  const grid = losingGrid();
  grid[0]![0] = 'scatter';
  grid[1]![1] = 'scatter';
  grid[2]![2] = 'scatter';
  return grid;
}

function specialDraw(symbolId: string): number {
  const index = NORMAL_ORDER.indexOf(symbolId);
  if (index < 0) throw new Error(`Unknown expandable symbol ${symbolId}`);
  return index;
}

/**
 * Test-only RNG.
 *
 * A production request can never supply randomness; the service owns that
 * choice. This stand-in exists solely so an integration test can dictate the
 * exact board it wants to assert on, and it falls back to a seeded stream once
 * its script runs out.
 */
class ScriptedRng implements RngProvider {
  readonly id = 'scripted-integration-test';
  readonly production = false;
  #values: number[];
  #index = 0;
  #fallback = new SeededRngProvider(99);

  constructor(values: number[]) {
    this.#values = values;
  }

  async uniformInt(maxExclusive: number, context: string): Promise<RngDraw> {
    if (this.#index >= this.#values.length) return this.#fallback.uniformInt(maxExclusive, context);
    const value = this.#values[this.#index]!;
    if (value < 0 || value >= maxExclusive) throw new Error(`scripted draw ${value} is outside ${maxExclusive} for ${context}`);
    const index = this.#index++;
    return { value, maxExclusive, index, source: this.id, reference: `${context}:${index}` };
  }
}

describe('book of the sands: authoritative backend (PostgreSQL)', () => {
  const prisma = new PrismaService();
  let app: INestApplication;
  let book: BookOfRaService;
  let auth: AuthService;
  let points: PointsService;
  let redis: RedisService;
  let userId: string;
  let otherId: string;
  let adminId: string;
  /** One entry per engine RNG the service creates: the draws for that spin. */
  let scripted: number[][] = [];
  let scriptedUsed = 0;

  const password = 'correct-horse-battery';
  const userEmail = uniqueTestEmail('book-user');
  const otherEmail = uniqueTestEmail('book-other');
  const adminEmail = uniqueTestEmail('book-admin');

  beforeAll(async () => {
    process.env.SPORTS_SETTLEMENT_ENABLED = 'false';
    await prisma.$connect();
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalInterceptors(new BigIntInterceptor());
    await app.init();
    book = app.get(BookOfRaService);
    auth = app.get(AuthService);
    points = app.get(PointsService);
    redis = app.get(RedisService);
    await redis.ensureConnected();
    // Every service instance draws from the scripted stream, which lets a test
    // dictate the board while leaving the production path untouched.
    book.useTestRngFactory(() => {
      const values = scripted[scriptedUsed] ?? [];
      scriptedUsed += 1;
      return new ScriptedRng(values);
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
    delete process.env.SPORTS_SETTLEMENT_ENABLED;
  });

  beforeEach(async () => {
    scripted = [];
    scriptedUsed = 0;
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "CasinoRequestKey", "BookOfRaSession", "CasinoGameConfigVersion", "CasinoGameConfig", "PlatformSettings", "CasinoTransaction", "CasinoRoundAction", "CasinoRound", "CasinoGameFavorite", "LedgerEntry", "BetLeg", "Bet", "AuditLog", "RefreshToken", "Wallet", "User" CASCADE',
    );
    await redis.client.flushdb();
    const hash = await argon2.hash(password);
    const [user, other, admin] = await Promise.all([
      prisma.user.create({ data: { email: userEmail, passwordHash: hash, wallet: { create: {} } } }),
      prisma.user.create({ data: { email: otherEmail, passwordHash: hash, wallet: { create: {} } } }),
      prisma.user.create({ data: { email: adminEmail, passwordHash: hash, role: 'ADMIN', wallet: { create: {} } } }),
    ]);
    userId = user.id;
    otherId = other.id;
    adminId = admin.id;
    await points.adminGrant(adminId, userId, 1_000_000n, 'Book of the Sands funding', randomUUID());
    await points.adminGrant(adminId, otherId, 1_000_000n, 'Book of the Sands funding', randomUUID());
    await prisma.casinoGameConfig.create({ data: { gameId: BOOK_GAME_ID, enabled: true, maintenance: false } });
  });

  const token = async (email: string) => (await auth.login(email, password)).pair.accessToken;
  const balance = async (id: string) => (await prisma.wallet.findUniqueOrThrow({ where: { userId: id } })).balance;
  const ledgerTotal = async (id: string) => {
    const entries = await prisma.ledgerEntry.findMany({ where: { wallet: { userId: id } } });
    return entries.reduce((sum, entry) => sum + entry.amount, 0n);
  };
  const spin = (accessToken: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/casino/book-of-ra/spin')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body);
  const action = (accessToken: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/casino/book-of-ra/action')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body);

  describe('published rules and boundaries', () => {
    it('requires authentication on every route', async () => {
      await request(app.getHttpServer()).get('/casino/book-of-ra/config').expect(401);
      await request(app.getHttpServer()).post('/casino/book-of-ra/spin').send({ betPerLine: 10, idempotencyKey: randomUUID() }).expect(401);
      await request(app.getHttpServer()).get('/casino/book-of-ra/state').expect(401);
    });

    it('publishes the paytable, the locked lines and the profile fingerprint without seed material', async () => {
      const accessToken = await token(userEmail);
      const response = await request(app.getHttpServer())
        .get('/casino/book-of-ra/config')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(response.body.profileId).toBe(BOOK_PROFILE_ID);
      expect(response.body.profileFingerprint).toBe(BOOK_PROFILE_FINGERPRINT);
      expect(response.body.paylineCount).toBe(BOOK_ACTIVE_LINES);
      expect(response.body.paytable['high-1']['5']).toBe(5000);
      expect(response.body.scatter['5']).toBe(200);
      expect(response.body.freeSpins.award).toBe(10);
      expect(response.body.gamble.maxAttempts).toBe(5);
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain('serverSeed');
      expect(serialized).not.toContain('gambleColours');
    });

    it('refuses a request that tries to supply its own outcome', async () => {
      const accessToken = await token(userEmail);
      await spin(accessToken, { betPerLine: 10, idempotencyKey: randomUUID(), board: [['high-1']] }).expect(400);
      await spin(accessToken, { betPerLine: 10, idempotencyKey: randomUUID(), payout: 1_000_000 }).expect(400);
      await spin(accessToken, { betPerLine: 10, idempotencyKey: randomUUID(), playerId: otherId }).expect(400);
      await spin(accessToken, { betPerLine: 10, idempotencyKey: randomUUID(), activeLines: 1 }).expect(400);
      expect(await prisma.casinoRound.count()).toBe(0);
    });

    it('rejects a stake above the configured maximum before touching the wallet', async () => {
      const accessToken = await token(userEmail);
      await spin(accessToken, { betPerLine: 100_000_000, idempotencyKey: randomUUID() }).expect(400);
      expect(await prisma.casinoRound.count()).toBe(0);
    });

    it('rejects a paid stake below the configured minimum before debit or RNG', async () => {
      const configs = app.get(CasinoConfigService);
      const effective = await configs.effective(BOOK_GAME_ID);
      const override = jest.spyOn(configs, 'effective').mockResolvedValue({ ...effective, minStake: 101n });
      try {
        const accessToken = await token(userEmail);
        const before = await balance(userId);
        const response = await spin(accessToken, { betPerLine: 10, idempotencyKey: randomUUID() }).expect(400);
        expect(response.body.code).toBe('STAKE_BELOW_MINIMUM');
        expect(await balance(userId)).toBe(before);
        expect(await prisma.casinoRound.count()).toBe(0);
        expect(scriptedUsed).toBe(0);
      } finally {
        override.mockRestore();
      }
    });

    it('refuses a spin the wallet cannot cover', async () => {
      const accessToken = await token(otherEmail);
      await prisma.wallet.update({ where: { userId: otherId }, data: { balance: 5n } });
      scripted = [gridDraws(blankGrid())];
      const response = await spin(accessToken, { betPerLine: 10, idempotencyKey: randomUUID() }).expect(409);
      expect(response.body.code).toBe('INSUFFICIENT_VIRTUAL_BALANCE');
      expect(await prisma.casinoRound.count()).toBe(0);
      expect(await balance(otherId)).toBe(5n);
    });
  });

  describe('one paid spin', () => {
    it('debits atomically, writes the ledger, records the profile and returns presentation only', async () => {
      const accessToken = await token(userEmail);
      scripted = [gridDraws(losingGrid())];
      const response = await spin(accessToken, { betPerLine: 10, idempotencyKey: randomUUID() }).expect(201);

      const view = response.body;
      expect(view.gameId).toBe(BOOK_GAME_ID);
      expect(view.profileId).toBe(BOOK_PROFILE_ID);
      expect(view.profileFingerprint).toBe(BOOK_PROFILE_FINGERPRINT);
      expect(view.betPerLine).toBe('10');
      expect(view.totalBet).toBe('100');
      expect(view.activeLines).toBe(10);
      expect(view.board).toHaveLength(5);
      expect(view.board[0]).toHaveLength(3);
      expect(view.settlement.wager).toBe('100');
      expect(view.roundState).toBe('ROUND_COMPLETE');
      expect(view.pendingAction).toBeNull();
      expect(JSON.stringify(view)).not.toContain('serverSeed');
      expect(JSON.stringify(view)).not.toContain('gambleColours');

      expect(await balance(userId)).toBe(1_000_000n - 100n + BigInt(view.settlement.payout));
      expect(await ledgerTotal(userId)).toBe(await balance(userId));
      expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(1);
      expect(await prisma.casinoRequestKey.count()).toBe(1);

      const round = await prisma.casinoRound.findFirstOrThrow({ where: { userId } });
      expect(round.gameVersion).toBe(BOOK_PROFILE_ID);
      expect(round.status).toBe('LOST');
      expect(round.settledAt).not.toBeNull();
      const publicState = round.publicState as Record<string, unknown>;
      expect(publicState.profileFingerprint).toBe(BOOK_PROFILE_FINGERPRINT);
      expect(publicState.outcomeSource).toBe('node:crypto-csprng');

      const session = await prisma.bookOfRaSession.findUniqueOrThrow({ where: { userId } });
      expect(session.phase).toBe('ROUND_COMPLETE');
      expect(session.betPerLine).toBe(10n);
      expect(session.totalBet).toBe(100n);
    });

    it('pays a five-of-a-kind line exactly as the published paytable says', async () => {
      const accessToken = await token(userEmail);
      const before = await balance(userId);
      const board = jackpotGrid();
      // The expectation comes from the production evaluator, so the assertion
      // checks the platform against the published mathematics, not a number
      // this test invented.
      const expected = evaluateBookOfRa(BOOK_OF_RA_GAME, board, 10n, BOOK_ACTIVE_LINES).total;
      expect(expected).toBe(51_000n);
      scripted = [gridDraws(board)];
      // Autoplay so the win settles on the spin instead of entering the gamble.
      const response = await spin(accessToken, { betPerLine: 10, idempotencyKey: randomUUID(), autoplay: true }).expect(201);
      expect(response.body.settlement.payout).toBe(expected.toString());
      expect(await balance(userId)).toBe(before - 100n + expected);
      expect(await ledgerTotal(userId)).toBe(await balance(userId));
    });

    it('replays an identical request instead of charging twice', async () => {
      const accessToken = await token(userEmail);
      const idempotencyKey = randomUUID();
      scripted = [gridDraws(losingGrid())];
      const first = await spin(accessToken, { betPerLine: 10, idempotencyKey }).expect(201);
      const afterFirst = await balance(userId);
      const second = await spin(accessToken, { betPerLine: 10, idempotencyKey }).expect(201);
      expect(second.body.roundId).toBe(first.body.roundId);
      expect(second.body.idempotent).toBe(true);
      expect(await balance(userId)).toBe(afterFirst);
      expect(await prisma.casinoRound.count()).toBe(1);
      expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(1);
    });

    it('refuses a reused key whose payload changed', async () => {
      const accessToken = await token(userEmail);
      const idempotencyKey = randomUUID();
      scripted = [gridDraws(losingGrid()), gridDraws(losingGrid())];
      await spin(accessToken, { betPerLine: 10, idempotencyKey }).expect(201);
      const conflict = await spin(accessToken, { betPerLine: 20, idempotencyKey }).expect(409);
      expect(conflict.body.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
      expect(await prisma.casinoRound.count()).toBe(1);
    });

    it('scopes an idempotency key to its own player', async () => {
      const ownerToken = await token(userEmail);
      const otherToken = await token(otherEmail);
      const idempotencyKey = randomUUID();
      scripted = [gridDraws(losingGrid()), gridDraws(losingGrid())];
      const first = await spin(ownerToken, { betPerLine: 10, idempotencyKey }).expect(201);
      const second = await spin(otherToken, { betPerLine: 10, idempotencyKey }).expect(201);
      expect(second.body.roundId).not.toBe(first.body.roundId);
      expect(second.body.idempotent).toBe(false);
      const rounds = await prisma.casinoRound.findMany({ where: { gameVersion: BOOK_PROFILE_ID } });
      expect(rounds).toHaveLength(2);
      expect(new Set(rounds.map((round) => round.userId))).toEqual(new Set([userId, otherId]));
    });
  });

  describe('free games', () => {
    async function spinIntoFeature(accessToken: string, betPerLine = 10) {
      scripted = [[...gridDraws(triggerGrid()), specialDraw('high-2')]];
      scriptedUsed = 0;
      const trigger = await spin(accessToken, { betPerLine, idempotencyKey: randomUUID() }).expect(201);
      return trigger;
    }

    it('locks the stake and lines for the whole feature', async () => {
      const accessToken = await token(userEmail);
      const trigger = await spinIntoFeature(accessToken, 10);
      expect(trigger.body.roundState).toBe('FREE_GAME_INTRO');
      expect(trigger.body.specialSymbol).toBe('high-2');
      expect(trigger.body.freeSpinsRemaining).toBe(10);
      expect(trigger.body.activeLines).toBe(10);
      expect(trigger.body.stakeLocked).toBe(true);

      const before = await balance(userId);
      scripted = [gridDraws(blankGrid())];
      scriptedUsed = 0;
      const free = await spin(accessToken, { betPerLine: 999, idempotencyKey: randomUUID() }).expect(201);
      expect(free.body.settlement.wager).toBe('0');
      expect(free.body.betPerLine).toBe('10');
      expect(free.body.totalBet).toBe('100');
      expect(free.body.freeSpinsRemaining).toBe(9);
      expect(free.body.freeSpinsPlayed).toBe(1);
      expect(await balance(userId)).toBe(before + BigInt(free.body.settlement.payout));
      expect(await ledgerTotal(userId)).toBe(await balance(userId));
      const session = await prisma.bookOfRaSession.findUniqueOrThrow({ where: { userId } });
      expect(session.specialSymbol).toBe('high-2');
      expect(session.freeSpinsRemaining).toBe(9);
    });

    it('expands a non-adjacent symbol once per spin and pays across all lines', async () => {
      const accessToken = await token(userEmail);
      await spinIntoFeature(accessToken, 10);
      const grid = blankGrid();
      grid[0]![0] = 'high-2';
      grid[3]![2] = 'high-2';
      scripted = [gridDraws(grid)];
      scriptedUsed = 0;
      const free = await spin(accessToken, { betPerLine: 10, idempotencyKey: randomUUID() }).expect(201);
      expect(free.body.expandingReels).toEqual([0, 3]);
      // high-2 at two reels is 5x the line bet across ten lines: 5 x 10 x 10.
      expect(free.body.expandingWin).toBe('500');
      const expanding = free.body.wins.filter((win: { evaluator: string }) => win.evaluator === 'book-of-ra-expanding');
      expect(expanding).toHaveLength(1);
      expect(expanding[0].amount).toBe('500');
    });

    it('runs the feature to completion and pays every free spin', async () => {
      const accessToken = await token(userEmail);
      await spinIntoFeature(accessToken, 10);
      let spins = 0;
      let state = 'FREE_GAME_ACTIVE';
      while (state !== 'FREE_GAME_COMPLETE' && spins < 30) {
        scripted = [gridDraws(blankGrid())];
        scriptedUsed = 0;
        const free = await spin(accessToken, { betPerLine: 10, idempotencyKey: randomUUID() }).expect(201);
        state = free.body.roundState;
        spins += 1;
      }
      expect(spins).toBe(10);
      expect(state).toBe('FREE_GAME_COMPLETE');
      const session = await prisma.bookOfRaSession.findUniqueOrThrow({ where: { userId } });
      expect(session.freeSpinsRemaining).toBe(0);
      expect(session.freeSpinsPlayed).toBe(10);
      expect(await ledgerTotal(userId)).toBe(await balance(userId));
    });

    it('adds ten more games when three Books land during the feature', async () => {
      const accessToken = await token(userEmail);
      await spinIntoFeature(accessToken, 10);
      scripted = [gridDraws(triggerGrid())];
      scriptedUsed = 0;
      const free = await spin(accessToken, { betPerLine: 10, idempotencyKey: randomUUID() }).expect(201);
      expect(free.body.roundState).toBe('FREE_GAME_ACTIVE');
      expect(free.body.freeSpinsRemaining).toBe(19);
      expect(free.body.freeSpinsPlayed).toBe(1);
      expect(free.body.specialSymbol).toBe('high-2');
      const session = await prisma.bookOfRaSession.findUniqueOrThrow({ where: { userId } });
      expect(session.retriggerCount).toBe(1);
    });
  });

  describe('gamble', () => {
    async function spinToPendingGamble(accessToken: string, colours = [0, 1, 0, 1, 0]) {
      scripted = [[...gridDraws(jackpotGrid()), ...colours]];
      scriptedUsed = 0;
      return spin(accessToken, { betPerLine: 10, idempotencyKey: randomUUID() }).expect(201);
    }

    it('withholds the win while a gamble is pending and blocks a new paid spin', async () => {
      const accessToken = await token(userEmail);
      const pending = await spinToPendingGamble(accessToken);
      expect(pending.body.roundState).toBe('GAMBLE_PENDING');
      expect(pending.body.pendingAction.type).toBe('gamble');
      expect(pending.body.pendingWin).toBe('51000');
      // The win is not credited yet: only the stake has moved.
      expect(await balance(userId)).toBe(1_000_000n - 100n);
      expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_WIN' } })).toBe(0);
      expect(pending.body.balance).toBe((1_000_000n - 100n).toString());

      scripted = [gridDraws(blankGrid())];
      scriptedUsed = 0;
      const blocked = await spin(accessToken, { betPerLine: 10, idempotencyKey: randomUUID() }).expect(409);
      expect(blocked.body.code).toBe('ACTION_PENDING');
    });

    it('collects the pending win exactly once', async () => {
      const accessToken = await token(userEmail);
      const pending = await spinToPendingGamble(accessToken);
      const before = await balance(userId);
      const pendingWin = BigInt(pending.body.pendingWin);
      const key = randomUUID();
      const collected = await action(accessToken, {
        roundId: pending.body.roundId,
        actionId: pending.body.pendingAction.id,
        choiceId: 'collect',
        idempotencyKey: key,
      }).expect(201);
      expect(collected.body.settlement.payout).toBe(pendingWin.toString());
      expect(collected.body.roundState).toBe('ROUND_COMPLETE');
      expect(collected.body.pendingAction).toBeNull();
      expect(await balance(userId)).toBe(before + pendingWin);
      expect(await ledgerTotal(userId)).toBe(await balance(userId));

      const replay = await action(accessToken, {
        roundId: pending.body.roundId,
        actionId: pending.body.pendingAction.id,
        choiceId: 'collect',
        idempotencyKey: key,
      }).expect(201);
      expect(replay.body.idempotent).toBe(true);
      expect(await balance(userId)).toBe(before + pendingWin);
      expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_WIN' } })).toBe(1);
    });

    it('doubles a correct guess, keeps the ladder open and settles at the five-attempt cap', async () => {
      const accessToken = await token(userEmail);
      const pending = await spinToPendingGamble(accessToken, [0, 0, 0, 0, 0]);
      const start = BigInt(pending.body.pendingWin);
      let roundId = pending.body.roundId as string;
      let actionId = pending.body.pendingAction.id as string;
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const resolved = await action(accessToken, { roundId, actionId, choiceId: 'red', idempotencyKey: randomUUID() }).expect(201);
        expect(resolved.body.roundState).toBe('GAMBLE_PENDING');
        expect(resolved.body.pendingWin).toBe((start * 2n ** BigInt(attempt)).toString());
        expect(resolved.body.gambleAttempts).toBe(attempt);
        actionId = resolved.body.pendingAction.id;
      }
      const final = await action(accessToken, { roundId, actionId, choiceId: 'red', idempotencyKey: randomUUID() }).expect(201);
      expect(final.body.roundState).toBe('ROUND_COMPLETE');
      expect(final.body.settlement.payout).toBe((start * 32n).toString());
      expect(await balance(userId)).toBe(1_000_000n - 100n + start * 32n);
      expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_WIN' } })).toBe(1);
    });

    it('zeroes the pending win on a wrong guess and credits nothing', async () => {
      const accessToken = await token(userEmail);
      const pending = await spinToPendingGamble(accessToken, [1, 1, 1, 1, 1]);
      const before = await balance(userId);
      const lost = await action(accessToken, {
        roundId: pending.body.roundId,
        actionId: pending.body.pendingAction.id,
        choiceId: 'red',
        idempotencyKey: randomUUID(),
      }).expect(201);
      expect(lost.body.settlement.payout).toBe('0');
      expect(lost.body.pendingWin).toBe('0');
      expect(lost.body.roundState).toBe('ROUND_COMPLETE');
      expect(await balance(userId)).toBe(before);
      expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_WIN' } })).toBe(0);
      const round = await prisma.casinoRound.findFirstOrThrow({ where: { id: pending.body.roundId } });
      expect(round.status).toBe('LOST');
      expect(round.payout).toBe(0n);
    });

    it('never offers the gamble during autoplay', async () => {
      const accessToken = await token(userEmail);
      scripted = [gridDraws(jackpotGrid())];
      scriptedUsed = 0;
      const response = await spin(accessToken, { betPerLine: 10, idempotencyKey: randomUUID(), autoplay: true }).expect(201);
      expect(response.body.roundState).toBe('ROUND_COMPLETE');
      expect(response.body.pendingAction).toBeNull();
      expect(response.body.settlement.payout).toBe('51000');
    });

    it('refuses a stale action id and a second resolution of the same round', async () => {
      const accessToken = await token(userEmail);
      const pending = await spinToPendingGamble(accessToken);
      await action(accessToken, {
        roundId: pending.body.roundId,
        actionId: 'not-the-pending-action',
        choiceId: 'collect',
        idempotencyKey: randomUUID(),
      }).expect(409);
      await action(accessToken, {
        roundId: pending.body.roundId,
        actionId: pending.body.pendingAction.id,
        choiceId: 'collect',
        idempotencyKey: randomUUID(),
      }).expect(201);
      const again = await action(accessToken, {
        roundId: pending.body.roundId,
        actionId: pending.body.pendingAction.id,
        choiceId: 'collect',
        idempotencyKey: randomUUID(),
      }).expect(409);
      expect(again.body.code).toBe('ROUND_ALREADY_SETTLED');
    });
  });

  describe('recovery and concurrency', () => {
    it('recovers free games with locked bets through game and platform maintenance after restart', async () => {
      const accessToken = await token(userEmail);
      scripted = [[...gridDraws(triggerGrid()), specialDraw('high-2')]];
      const trigger = await spin(accessToken, { betPerLine: 10, idempotencyKey: randomUUID() }).expect(201);
      await prisma.casinoGameConfig.update({ where: { gameId: BOOK_GAME_ID }, data: { enabled: false, maintenance: true } });
      await prisma.platformSettings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', casinoMaintenance: true }, update: { casinoMaintenance: true } });
      const recovered = new BookOfRaService(prisma, app.get(CasinoGameRegistry), app.get(CasinoConfigService), app.get(CasinoFairnessService));
      recovered.useTestRngFactory(() => new ScriptedRng(gridDraws(losingGrid())));
      const disabled = jest.spyOn(app.get(CasinoGameRegistry), 'assertEnabled').mockImplementation(() => { throw new Error('registry disabled'); });
      try {
        expect((await recovered.state(userId)).specialSymbol).toBe(trigger.body.specialSymbol);
        for (let index = 0; index < 10; index += 1) {
          const free = await recovered.spin(userId, { betPerLine: 999999, idempotencyKey: randomUUID() });
          expect(free.betPerLine).toBe('10');
          expect(free.totalBet).toBe('100');
          expect(free.settlement.wager).toBe('0');
          expect(free.freeSpinsRemaining).toBe(9 - index);
        }
        await expect(recovered.spin(userId, { betPerLine: 10, idempotencyKey: randomUUID() })).rejects.toThrow();
        expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(1);
        expect(await ledgerTotal(userId)).toBe(await balance(userId));
      } finally { disabled.mockRestore(); }
    });

    it('recovers and collects a pending wager exactly once during maintenance', async () => {
      const accessToken = await token(userEmail);
      scripted = [[...gridDraws(jackpotGrid()), 0, 1, 0, 1, 0]];
      const pending = await spin(accessToken, { betPerLine: 10, idempotencyKey: randomUUID() }).expect(201);
      await prisma.casinoGameConfig.update({ where: { gameId: BOOK_GAME_ID }, data: { enabled: false, maintenance: true } });
      await prisma.platformSettings.update({ where: { id: 'singleton' }, data: { casinoMaintenance: true } });
      const recovered = new BookOfRaService(prisma, app.get(CasinoGameRegistry), app.get(CasinoConfigService), app.get(CasinoFairnessService));
      expect((await recovered.state(userId)).pendingAction!.id).toBe(pending.body.pendingAction.id);
      const dto = { roundId: pending.body.roundId, actionId: pending.body.pendingAction.id, choiceId: 'collect' as const, idempotencyKey: randomUUID() };
      const [a, b] = await Promise.all([recovered.act(userId, dto), recovered.act(userId, dto)]);
      expect(a.settlement.payout).toBe(b.settlement.payout);
      expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_WIN' } })).toBe(1);
      expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(1);
      expect(await balance(userId)).toBe(999900n + BigInt(pending.body.pendingWin));
      expect(await ledgerTotal(userId)).toBe(await balance(userId));
    });

    it('enforces the global SQL stake guard and permits only valid locked Book free rounds', async () => {
      const accessToken = await token(userEmail);
      scripted = [[...gridDraws(triggerGrid()), specialDraw('high-2')], gridDraws(losingGrid())];
      const paid = await spin(accessToken, { betPerLine: 10, idempotencyKey: randomUUID() }).expect(201);
      await expect(prisma.$executeRaw`UPDATE "CasinoRound" SET "stake" = 0 WHERE "id" = ${paid.body.roundId}::uuid`).rejects.toThrow(/CasinoRound_stake_positive_or_book_free_check/);
      await expect(prisma.$executeRaw`UPDATE "CasinoRound" SET "stake" = 1 WHERE "id" = ${paid.body.roundId}::uuid`).rejects.toThrow(/CasinoRound_book_bet_check/);
      const free = await spin(accessToken, { betPerLine: 999, idempotencyKey: randomUUID() }).expect(201);
      expect(free.body.settlement.wager).toBe('0');
      expect(free.body.totalBet).toBe('100');
      await expect(prisma.$executeRaw`UPDATE "CasinoRound" SET "gameVersion" = 'dice.v1.rtp9700', "gameType" = 'DICE' WHERE "id" = ${free.body.roundId}::uuid`).rejects.toThrow(/CasinoRound_stake_positive_or_book_free_check/);
      await expect(prisma.$executeRaw`UPDATE "CasinoRound" SET "publicState" = '{}'::jsonb WHERE "id" = ${free.body.roundId}::uuid`).rejects.toThrow();
      await expect(prisma.$executeRaw`UPDATE "CasinoRound" SET "publicState" = jsonb_set("publicState", '{activeLines}', '9') WHERE "id" = ${paid.body.roundId}::uuid`).rejects.toThrow(/CasinoRound_book_bet_check/);
    });

    it('reconstructs an active feature and a pending gamble from stored state', async () => {
      const accessToken = await token(userEmail);
      scripted = [[...gridDraws(triggerGrid()), specialDraw('low-1')]];
      scriptedUsed = 0;
      await spin(accessToken, { betPerLine: 25, idempotencyKey: randomUUID() }).expect(201);
      // A brand new service instance shares nothing but the database.
      const restarted = new BookOfRaService(
        prisma,
        app.get(CasinoGameRegistry),
        app.get(CasinoConfigService),
        app.get(CasinoFairnessService),
      );
      const state = await restarted.state(userId);
      expect(state.roundState).toBe('FREE_GAME_INTRO');
      expect(state.specialSymbol).toBe('low-1');
      expect(state.freeSpinsRemaining).toBe(10);
      expect(state.betPerLine).toBe('25');
      expect(state.totalBet).toBe('250');
      expect(state.activeLines).toBe(10);

      scripted = [gridDraws(blankGrid())];
      scriptedUsed = 0;
      const free = await spin(accessToken, { betPerLine: 25, idempotencyKey: randomUUID() }).expect(201);
      expect(free.body.roundState).toBe('FREE_GAME_ACTIVE');
      expect(free.body.freeSpinsRemaining).toBe(9);
    });

    it('reports the same pending action after a restart and settles it once', async () => {
      const accessToken = await token(userEmail);
      scripted = [[...gridDraws(jackpotGrid()), 0, 1, 0, 1, 0]];
      scriptedUsed = 0;
      const pending = await spin(accessToken, { betPerLine: 10, idempotencyKey: randomUUID() }).expect(201);
      const state = await book.state(userId);
      expect(state.roundState).toBe('GAMBLE_PENDING');
      expect(state.pendingAction?.id).toBe(pending.body.pendingAction.id);
      expect(state.pendingWin).toBe(pending.body.pendingWin);

      // Collecting settles exactly the pending win, once.
      const resolved = await action(accessToken, {
        roundId: pending.body.roundId,
        actionId: state.pendingAction!.id,
        choiceId: 'collect',
        idempotencyKey: randomUUID(),
      }).expect(201);
      expect(resolved.body.settlement.payout).toBe(pending.body.pendingWin);
      expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_WIN' } })).toBe(1);
    });

    it('serialises concurrent spins from one player', async () => {
      const accessToken = await token(userEmail);
      scripted = Array.from({ length: 6 }, () => gridDraws(losingGrid()));
      scriptedUsed = 0;
      const responses = await Promise.all([
        spin(accessToken, { betPerLine: 10, idempotencyKey: randomUUID() }),
        spin(accessToken, { betPerLine: 10, idempotencyKey: randomUUID() }),
        spin(accessToken, { betPerLine: 10, idempotencyKey: randomUUID() }),
      ]);
      expect(responses.every((response) => response.status === 201)).toBe(true);
      const rounds = await prisma.casinoRound.findMany({ where: { userId } });
      expect(rounds).toHaveLength(3);
      expect(await ledgerTotal(userId)).toBe(await balance(userId));
      expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(3);
    });

    it('settles only one round when the same request races itself', async () => {
      const accessToken = await token(userEmail);
      scripted = [gridDraws(losingGrid()), gridDraws(losingGrid())];
      scriptedUsed = 0;
      const idempotencyKey = randomUUID();
      const [first, second] = await Promise.all([
        spin(accessToken, { betPerLine: 10, idempotencyKey }),
        spin(accessToken, { betPerLine: 10, idempotencyKey }),
      ]);
      // Neither request may fail: the loser of the race must be answered with
      // the winner's stored round rather than an internal error.
      expect([first.status, second.status]).toEqual([201, 201]);
      expect(first.body.roundId).toBe(second.body.roundId);
      expect(await prisma.casinoRound.count()).toBe(1);
      expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(1);
      expect(await ledgerTotal(userId)).toBe(await balance(userId));
    });
  });
});
