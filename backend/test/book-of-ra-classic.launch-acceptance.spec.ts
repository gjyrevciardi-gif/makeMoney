import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { BigIntInterceptor } from '../src/common/bigint.interceptor';
import { RedisService } from '../src/common/redis.service';
import { CasinoGameRegistry } from '../src/casino/casino-game.registry';
import { CLASSIC_V1 } from '../src/casino/games/book-of-ra-classic/classic.definition';
import { CLASSIC_CAPABILITY, CLASSIC_OPTIONS } from '../src/casino/games/book-of-ra-classic/classic.adapter';
import type { IntRng } from '../src/casino/games/book-of-ra-classic/classic.engine';
import { defaultClassicProfile } from '../src/casino/games/book-of-ra-classic/classic.math-adapter';
import { createSimulationRng } from '../src/casino/platform/math-control/math-control.random';
import { PrismaService } from '../src/prisma.service';
import { uniqueTestEmail } from './test-identity';

const CLASSIC_ID = 'book-of-ra-classic';
const PASSWORD = 'correct-horse-battery';
/**
 * Fixture seed discovered with `games/book-of-ra-classic/scripts/find-fixture-seeds.cjs`
 * against the accepted evaluator: the paid board starts ten free games with no
 * retrigger. A dedicated test re-derives the property, so a drift in the engine
 * fails loudly instead of silently reselecting a different board.
 */
const FEATURE_SEED = 'classic-312';

/** The adapter consumes `options.rng` as an `IntRng`, not as a factory. */
const intRng = (seed: string) => {
  const rng = createSimulationRng(seed);
  return (upper: number) => rng.int(0, upper - 1);
};

/** A counting wrapper over the fixture stream: the strongest "no draw" proof. */
const countingRng = (seed: string, onDraw: () => void) => {
  const base = intRng(seed);
  return (upper: number) => {
    onDraw();
    return base(upper);
  };
};

/**
 * The production player/casino launch path for Book of Ra Classic.
 *
 * There is no constructed session and no direct adapter call here: every role
 * authenticates over HTTP, mints a real one-time launch capability on the
 * platform route, trades it on the gateway exchange route, and plays through
 * the session-bound gameplay route on the same controller the gateway forwards
 * to. Only the server-side draw is pinned through the adapter's existing
 * `CLASSIC_OPTIONS` test seam; the production module still supplies the OS
 * CSPRNG, and no request can reach the seam.
 */
describe('Book of Ra Classic launch acceptance (PostgreSQL + Redis)', () => {
  jest.setTimeout(120_000);

  const prisma = new PrismaService();
  let app: INestApplication;
  let auth: AuthService;
  let redis: RedisService;
  let rngCalls = 0;

  const server = () => request(app.getHttpServer());
  const mail = {
    user: uniqueTestEmail('classic-launch-user'),
    admin: uniqueTestEmail('classic-launch-admin'),
    super: uniqueTestEmail('classic-launch-super'),
  };
  let userId = '';
  const tokenOf: Record<'user' | 'admin' | 'super', string> = { user: '', admin: '', super: '' };

  /**
   * One complete application runtime with the Classic draw seam pinned.
   *
   * The recovery proof rebuilds this from scratch, so the round can only come
   * back from durable state - never from a live object.
   */
  const createApp = async (rng: IntRng) => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLASSIC_OPTIONS)
      .useValue({ rng })
      .compile();
    const instance = module.createNestApplication();
    instance.use(cookieParser());
    instance.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    instance.useGlobalInterceptors(new BigIntInterceptor());
    await instance.init();
    return instance;
  };

  const login = async (email: string) =>
    (await auth.login(email, PASSWORD)).pair.accessToken;

  /**
   * Lossless projection of persisted rows for whole-row deep equality.
   *
   * BigInt becomes its exact decimal string, Date its ISO instant and Decimal
   * its exact decimal string. Every column keeps its own name and value, so
   * nothing is dropped, renamed or rounded to force a comparison to pass:
   * equality of these projections is equality of the complete stored rows.
   */
  const persisted = (value: unknown): unknown =>
    JSON.parse(JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item)));

  const sumAmounts = (rows: ReadonlyArray<{ amount: bigint }>) =>
    rows.reduce((total, row) => total + row.amount, 0n);

  const countType = (rows: ReadonlyArray<{ type: string }>, type: string) =>
    rows.filter((row) => row.type === type).length;

  /**
   * The complete persisted footprint of the one paid round: the wallet row,
   * every ledger row, every authoritative action row and every Classic round
   * row, each whole and in a stable database order.
   *
   * `rows` keeps Prisma's own column types for arithmetic; `stored` is the same
   * data losslessly encoded so two reads can be deep-compared field for field -
   * ids, amounts, references, correlation keys, timestamps, state and the
   * stored authoritative payload included.
   *
   * Game-session rows are deliberately out of scope: the recovery launch must
   * mint a fresh session, while the round itself must not change.
   */
  const footprint = async (id: string) => {
    const [walletRow, ledger, actions, rounds] = await Promise.all([
      prisma.wallet.findUniqueOrThrow({ where: { userId: id } }),
      prisma.ledgerEntry.findMany({
        where: { wallet: { userId: id } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      prisma.casinoRoundAction.findMany({
        where: { userId: id, gameId: CLASSIC_ID },
        orderBy: [{ seq: 'asc' }, { id: 'asc' }],
      }),
      prisma.casinoRound.findMany({
        where: { userId: id, gameVersion: { startsWith: `${CLASSIC_ID}.` } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const rows = { wallet: walletRow, ledger, actions, rounds };
    return { rows, stored: persisted(rows) };
  };

  type Footprint = Awaited<ReturnType<typeof footprint>>;

  /**
   * Proves a rebuilt runtime or a replay changed nothing durable: the whole
   * stored footprint is deeply equal, and the money, debit/credit rows, action
   * sequence/ids and round ids are explicitly unchanged - no new debit, no new
   * credit, no new action, no new round. Session rows stay out of scope.
   */
  const expectNoDurableChange = (baseline: Footprint, candidate: Footprint) => {
    // Whole-row equality first: every ledger/action/round/wallet column, ids,
    // timestamps and stored payload included.
    expect(candidate.stored).toEqual(baseline.stored);
    expect(candidate.rows.wallet).toEqual(baseline.rows.wallet);
    // No new debit or credit: same row ids, same types/amounts, same ledger sum.
    expect(candidate.rows.ledger.map((row) => row.id)).toEqual(baseline.rows.ledger.map((row) => row.id));
    expect(candidate.rows.ledger.map((row) => [row.type, row.amount.toString()]))
      .toEqual(baseline.rows.ledger.map((row) => [row.type, row.amount.toString()]));
    expect(sumAmounts(candidate.rows.ledger)).toBe(sumAmounts(baseline.rows.ledger));
    expect(countType(candidate.rows.ledger, 'CASINO_BET')).toBe(countType(baseline.rows.ledger, 'CASINO_BET'));
    expect(countType(candidate.rows.ledger, 'CASINO_WIN')).toBe(countType(baseline.rows.ledger, 'CASINO_WIN'));
    // No new action (same database sequence and ids) and no new round.
    expect(candidate.rows.actions.map((row) => [row.seq, row.id]))
      .toEqual(baseline.rows.actions.map((row) => [row.seq, row.id]));
    expect(candidate.rows.rounds.map((row) => row.id)).toEqual(baseline.rows.rounds.map((row) => row.id));
  };

  /** The real authenticated launch route, used by USER, ADMIN and SUPER_ADMIN. */
  const launch = async (token: string) => {
    const response = await server()
      .post(`/casino/${CLASSIC_ID}/launch`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    return response;
  };
  const exchange = async (token: string) =>
    server()
      .post(`/casino/${CLASSIC_ID}/launch/exchange`)
      .send({ token });
  const hPlay = (sessionToken: string, requestId: string, version = '1', round = 'none') => ({
    'x-book-classic-session': sessionToken,
    'x-pilot-request-id': requestId,
    'x-pilot-version': version,
    'x-pilot-round': round,
  });
  const play = (
    sessionToken: string,
    body: Record<string, unknown>,
    requestId: string,
    version = '1',
    round = 'none',
  ) =>
    server()
      .post(`/casino/${CLASSIC_ID}/session/gameplay`)
      .set(hPlay(sessionToken, requestId, version, round))
      .send(body);

  const issueAndExchange = async (
    role: 'user' | 'admin' | 'super',
  ): Promise<{ launchBody: Record<string, unknown>; sessionToken: string; sessionId: string }> => {
    const launched = await launch(tokenOf[role]);
    expect(launched.status).toBe(201);
    expect(typeof launched.body.token).toBe('string');
    expect(launched.body.gamePath).toBe(CLASSIC_CAPABILITY.gamePath);
    const bound = await exchange(launched.body.token);
    expect(bound.status).toBe(200);
    expect(typeof bound.body.sessionToken).toBe('string');
    return { launchBody: launched.body, sessionToken: bound.body.sessionToken, sessionId: bound.body.sessionId };
  };

  beforeAll(async () => {
    await prisma.$connect();
    app = await createApp(countingRng(FEATURE_SEED, () => { rngCalls += 1; }));
    auth = app.get(AuthService);
    redis = app.get(RedisService);
    await redis.ensureConnected();
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    jest.setTimeout(120_000);
    rngCalls = 0;
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "GameActiveMathProfile", "GameMathProfileValidation", "GameMathProfile", ' +
      '"GamePreparedOutcome", "GameSession", "GameLaunchCapability", "CasinoGameConfigVersion", "CasinoGameConfig", ' +
      '"PlatformSettings", "CasinoTransaction", "CasinoRoundAction", "CasinoRound", "CasinoGameFavorite", ' +
      '"LedgerEntry", "BetLeg", "Bet", "AuditLog", "RefreshToken", "Wallet", "User" CASCADE',
    );
    await redis.client.flushdb();
    const passwordHash = await argon2.hash(PASSWORD);
    const [user, admin, superAdmin] = await Promise.all([
      prisma.user.create({ data: { email: mail.user, passwordHash, wallet: { create: {} } } }),
      prisma.user.create({ data: { email: mail.admin, passwordHash, role: 'ADMIN', wallet: { create: {} } } }),
      prisma.user.create({ data: { email: mail.super, passwordHash, role: 'SUPER_ADMIN', wallet: { create: {} } } }),
    ]);
    userId = user.id;
    tokenOf.user = await login(mail.user);
    tokenOf.admin = await login(mail.admin);
    tokenOf.super = await login(mail.super);
  });

  it('launches, plays exactly one paid action and recovers the same round without a redraw', async () => {
    // Fund through the audited admin-grant path so the wallet is ledger-explained.
    const granted = await server()
      .post(`/admin/users/${userId}/coins`)
      .set('Authorization', `Bearer ${tokenOf.admin}`)
      .send({ amount: 100_000, reason: 'classic launch acceptance', idempotencyKey: randomUUID() });
    expect(granted.status).toBe(201);

    // ---- Registry identity and gateway route ---------------------------------
    const registry = new CasinoGameRegistry();
    const definition = registry.findById(CLASSIC_ID);
    expect(definition?.id).toBe(CLASSIC_ID);
    expect(definition?.route).toBe('/casino/slots/book-of-ra-classic');
    expect(JSON.stringify(definition)).not.toMatch(/deluxe|lucky-lady|ll-|fools-gold/i);

    // ---- USER launch -> exchange -> init settings ---------------------------
    const user = await issueAndExchange('user');
    const settings = await play(user.sessionToken, { slotEvent: 'getSettings' }, `getset-${randomUUID()}`);
    expect(settings.status).toBe(200);
    const serverResponse = settings.body.serverResponse as Record<string, unknown>;
    const mathConfig = serverResponse.mathConfig as Record<string, unknown>;
    expect(mathConfig.gameId).toBe(CLASSIC_ID);
    expect(mathConfig.validatedLines).toBe(CLASSIC_V1.lines);
    expect(mathConfig.targetRtpPercent).toBe(defaultClassicProfile().payload.targetRtpPercent);
    expect(String(mathConfig.activeMathProfile)).toMatch(/^book-of-ra-classic\.rtp50\.v/);
    expect(serverResponse.Balance).toBe(100_000);
    expect(serverResponse.Bet).toEqual([...CLASSIC_V1.lineStakes]);
    expect(serverResponse.Line).toEqual([...CLASSIC_V1.lineCounts]);
    expect(settings.body.recovery.roundId).toBe('none');

    // ---- Exactly one paid Book Classic action -------------------------------
    // PRE-BET baseline: the whole persisted footprint before any paid action.
    const before = await footprint(userId);
    expect(before.rows.actions).toHaveLength(0);
    expect(before.rows.rounds).toHaveLength(0);

    const stake = CLASSIC_V1.lineStakes[0] * CLASSIC_V1.lines; // 1 x 9 lines
    const requestId = `bet-${randomUUID()}`;
    const paid = await play(
      user.sessionToken,
      { slotEvent: 'bet', slotBet: CLASSIC_V1.lineStakes[0], slotLines: CLASSIC_V1.lines },
      requestId,
    );
    // The gameplay route is `@HttpCode(HttpStatus.OK)` for every native event,
    // paid actions included; only the platform launch mint is a 201.
    expect(paid.status).toBe(200);
    expect(paid.body.responseEvent).toBe('spin');
    expect(paid.body.responseType).toBe('bet');
    // The accepted fixture seed starts the ten free games; the paid spin only
    // wagers, so the balance moves by exactly the stake and nothing else.
    expect(paid.body.serverResponse.totalFreeGames).toBe(10);
    expect(paid.body.serverResponse.totalWin).toBeGreaterThan(0);
    expect(paid.body.recovery.phase).toBe('FREE_SPINS');
    expect(paid.body.recovery.bet).toEqual({ slotBet: CLASSIC_V1.lineStakes[0], slotLines: CLASSIC_V1.lines });
    expect(paid.body.recovery.profile.id).toMatch(/^book-of-ra-classic\.rtp50\.v/);

    // POST-BET baseline: the whole persisted footprint after exactly one paid
    // action. The recovery and replay proofs compare this baseline, never the
    // pre-bet state.
    const afterPaid = await footprint(userId);

    // One debit of exactly the stake, one new ledger row, no credit yet.
    expect(afterPaid.rows.wallet.balance).toBe(before.rows.wallet.balance - BigInt(stake));
    expect(afterPaid.rows.ledger).toHaveLength(before.rows.ledger.length + 1);
    expect(sumAmounts(afterPaid.rows.ledger)).toBe(sumAmounts(before.rows.ledger) - BigInt(stake));
    expect(countType(afterPaid.rows.ledger, 'CASINO_BET')).toBe(countType(before.rows.ledger, 'CASINO_BET') + 1);
    expect(countType(afterPaid.rows.ledger, 'CASINO_WIN')).toBe(countType(before.rows.ledger, 'CASINO_WIN'));

    // Exactly one round row, one authoritative action row, owned by the
    // authenticated player, bound to that round, and its stored payload is the
    // served result.
    expect(afterPaid.rows.rounds).toHaveLength(1);
    expect(afterPaid.rows.actions).toHaveLength(1);
    const paidRound = afterPaid.rows.rounds[0];
    const paidAction = afterPaid.rows.actions[0];
    expect(paidRound.gameVersion).toBe(CLASSIC_V1.version);
    expect(paidRound.stake).toBe(BigInt(stake));
    expect(paidRound.status).toBe('OPEN');
    expect(paidAction.userId).toBe(userId);
    expect(paidAction.roundId).toBe(paidRound.id);
    expect(paidAction.action).toBe('bet');
    expect(paidAction.payload).toEqual(paid.body);

    // The one new ledger row is this paid action and nothing else: full
    // business columns, not just the aggregates.
    const newLedger = afterPaid.rows.ledger.filter(
      (row) => !before.rows.ledger.some((prior) => prior.id === row.id),
    );
    expect(newLedger).toHaveLength(1);
    expect(newLedger[0]).toMatchObject({
      walletId: afterPaid.rows.wallet.id,
      type: 'CASINO_BET',
      amount: -BigInt(stake),
      reason: 'Book of Ra Classic wager',
      actorId: userId,
      relatedBetId: null,
      relatedCasinoRoundId: paidRound.id,
      idempotencyKey: `casino:${CLASSIC_ID}:bet:${paidRound.id}`,
      actionId: requestId,
      gameSessionId: user.sessionId,
      balanceBefore: BigInt(100_000),
      balanceAfter: afterPaid.rows.wallet.balance,
    });

    // ---- ADMIN and SUPER_ADMIN may launch, and move no money ----------------
    const adminId = (await prisma.user.findUniqueOrThrow({ where: { email: mail.admin } })).id;
    const adminBefore = await footprint(adminId);
    await issueAndExchange('admin');
    const adminAfter = await footprint(adminId);
    expectNoDurableChange(adminBefore, adminAfter);

    const superId = (await prisma.user.findUniqueOrThrow({ where: { email: mail.super } })).id;
    const superBefore = await footprint(superId);
    await issueAndExchange('super');
    const superAfter = await footprint(superId);
    expectNoDurableChange(superBefore, superAfter);

    // ---- Recovery after a full runtime reconstruction ------------------------
    // Destroy the running context: revoke the bound game session, then rebuild
    // the whole application from scratch. The rebuilt runtime carries a draw
    // seam that counts and throws, so any redraw of the stored round fails
    // loudly instead of silently re-rolling a new board.
    await prisma.gameSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const doomed = app;
    app = await createApp(countingRng(FEATURE_SEED, () => {
      rngCalls += 1;
      throw new Error('UNEXPECTED_RNG_DRAW_AFTER_RECONSTRUCTION');
    }));
    auth = app.get(AuthService);
    redis = app.get(RedisService);
    await redis.ensureConnected();
    await doomed.close();
    tokenOf.user = await login(mail.user);

    const drawsBeforeRecovery = rngCalls;
    const recoveredLaunch = await issueAndExchange('user');
    const recovered = await play(
      recoveredLaunch.sessionToken,
      { slotEvent: 'getSettings' },
      `recovery-${randomUUID()}`,
    );
    expect(recovered.status).toBe(200);
    const recovery = recovered.body.recovery as Record<string, unknown>;
    expect(recovery.roundId).toBe(paid.body.recovery.roundId);
    expect(recovery.phase).toBe('FREE_SPINS');
    expect(recovery.version).toBe(paid.body.recovery.version);
    expect(recovery.result).toEqual(paid.body.recovery.result);
    expect(recovery.profile).toEqual(paid.body.recovery.profile);
    // The reconstructed runtime served the stored board from durable state: no
    // draw, no new action row, no new round.
    expect(rngCalls).toBe(drawsBeforeRecovery);

    // ---- AFTER RECOVERY: the rebuilt runtime changed nothing durable --------
    // Deep-equal the whole footprint against the POST-BET baseline (never the
    // pre-bet state): same wallet/balance, same ledger rows and ids, same
    // action rows (`seq`, ids and stored payload) and the same round row - and
    // explicitly no new debit, credit, action or round.
    const afterRecovery = await footprint(userId);
    expectNoDurableChange(afterPaid, afterRecovery);
    expect(rngCalls).toBe(drawsBeforeRecovery);

    // ---- AFTER the exact replay: still nothing durable changed --------------
    // A replay of the one paid request returns the stored document, not a new
    // round: still one debit, one round, one action row, no extra draw.
    const replay = await play(
      recoveredLaunch.sessionToken,
      { slotEvent: 'bet', slotBet: CLASSIC_V1.lineStakes[0], slotLines: CLASSIC_V1.lines },
      requestId,
    );
    expect(replay.status).toBe(200);
    // The replayed body is the database's own stored authoritative payload.
    expect(JSON.stringify(replay.body)).toBe(JSON.stringify(paid.body));
    expect(JSON.stringify(replay.body)).toBe(JSON.stringify(paidAction.payload));
    expect(rngCalls).toBe(drawsBeforeRecovery);

    const afterReplay = await footprint(userId);
    expectNoDurableChange(afterPaid, afterReplay);
  });
});
