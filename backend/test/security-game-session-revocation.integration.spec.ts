import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { AuthorizationService } from '../src/auth/authorization.service';
import { UserAccountsService } from '../src/auth/user-accounts.service';
import { BigIntInterceptor } from '../src/common/bigint.interceptor';
import { RedisService } from '../src/common/redis.service';
import { CLASSIC_OPTIONS, ClassicAdapter } from '../src/casino/games/book-of-ra-classic/classic.adapter';
import { CLASSIC_V1 } from '../src/casino/games/book-of-ra-classic/classic.definition';
import type { IntRng } from '../src/casino/games/book-of-ra-classic/classic.engine';
import { GameCapabilityService } from '../src/casino/platform/game-capability.service';
import { GameJournalService } from '../src/casino/platform/game-journal.service';
import { createSimulationRng } from '../src/casino/platform/math-control/math-control.random';
import { PrismaService } from '../src/prisma.service';
import { uniqueTestEmail } from './test-identity';

const CLASSIC_ID = 'book-of-ra-classic';
const PASSWORD = 'correct-horse-battery';
const NEW_PASSWORD = 'a-fresh-horse-battery';
const ADMIN_PASSWORD = 'admin-horse-battery';
const SEED = 'classic-312';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** The adapter consumes `options.rng` as an `IntRng`, not as a factory. */
const intRng = (seed: string): IntRng => {
  const rng = createSimulationRng(seed);
  return (upper: number) => rng.int(0, upper - 1);
};

/**
 * Game session revocation is bound to the account, not to a timer.
 *
 * Every game credential carries the `User.authVersion` it was minted under, and
 * every authoritative decision reads the account row under the same lock the
 * auth flows take for logout, password change and disable. This suite drives the
 * real HTTP surface, the real account-lock ordering and the real settlement
 * transactions, so it proves the linearization rather than a helper in
 * isolation.
 *
 * The races park one request with an explicit latch and order the competing
 * operation with a promise resolved by that operation's own transaction (and,
 * where it matters, by the exact statement that takes the account row lock).
 * The promises wrap the real Prisma calls with Jest and always delegate to the
 * real implementation, so ordering comes from the database lock queue - never
 * from a sleep, a poll or launch timing.
 */
describe('game session revocation (PostgreSQL + Redis)', () => {
  jest.setTimeout(120_000);

  const prisma = new PrismaService();
  let app: INestApplication;
  let capabilities: GameCapabilityService;
  let redis: RedisService;

  /** Gates and observers registered by a test; released and restored in afterEach. */
  const openGates = new Set<() => void>();
  const openObservers = new Set<() => void>();

  /**
   * Every draw the Classic adapter takes is counted. A refused key must add no
   * draw at all - the strongest available statement that a cancelled round is
   * never redrawn. The stream is re-seeded for every test, so a paid round
   * always starts from the accepted feature fixture (`classic-312` awards the
   * ten free games) instead of depending on draws other tests consumed.
   */
  let rngDraws = 0;
  let rngStream = intRng(SEED);
  const countingRng = (upper: number) => {
    rngDraws += 1;
    return rngStream(upper);
  };

  /** Per-test fault-injection seams on the Classic adapter (test-only). */
  const hooks: {
    afterPrepare?: () => Promise<void>;
    afterDebit?: () => Promise<void>;
  } = {};

  const mail = {
    user: uniqueTestEmail('game-revocation-user'),
    rival: uniqueTestEmail('game-revocation-rival'),
    admin: uniqueTestEmail('game-revocation-admin'),
  };
  let userId = '';
  let rivalId = '';
  let adminId = '';

  const server = () => request(app.getHttpServer());
  const reqId = () => `revocation-${randomUUID()}`;
  /** A request already in flight; used to order the deterministic races. */
  type Pending = Promise<request.Response>;

  const createApp = async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLASSIC_OPTIONS)
      .useValue({
        rng: countingRng,
        afterPrepare: () => hooks.afterPrepare?.(),
        afterDebit: () => hooks.afterDebit?.(),
      })
      .compile();
    const instance = module.createNestApplication();
    instance.use(cookieParser());
    instance.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    instance.useGlobalInterceptors(new BigIntInterceptor());
    await instance.init();
    return instance;
  };

  const rawCookie = (response: request.Response) =>
    (response.headers['set-cookie'] as unknown as string[])[0].split(';')[0];

  const login = async (email: string, password = PASSWORD) => {
    const response = await server().post('/auth/login').send({ email, password });
    expect(response.status).toBe(201);
    return { token: response.body.accessToken as string, cookie: rawCookie(response) };
  };

  /** Every helper is `async` so a request starts when it is created, not when awaited. */
  const launch = async (accessToken: string) =>
    server().post(`/casino/${CLASSIC_ID}/launch`).set('Authorization', `Bearer ${accessToken}`).send({});

  const exchange = async (token: string) =>
    server().post(`/casino/${CLASSIC_ID}/launch/exchange`).send({ token });

  const play = async (
    sessionToken: string,
    body: Record<string, unknown>,
    requestId: string,
    version = '1',
    round = 'none',
  ) =>
    server()
      .post(`/casino/${CLASSIC_ID}/session/gameplay`)
      .set('x-book-classic-session', sessionToken)
      .set('x-pilot-request-id', requestId)
      .set('x-pilot-version', version)
      .set('x-pilot-round', round)
      .send(body);

  const logout = async (cookie: string) =>
    server().post('/auth/logout').set('Cookie', cookie).send({});

  const setDisabled = async (adminToken: string, targetId: string, disabled: boolean) =>
    server().post(`/admin/users/${targetId}/status`).set('Authorization', `Bearer ${adminToken}`).send({ disabled });

  /** An administrator password reset. `async`, so the request is dispatched when created. */
  const resetPassword = async (adminToken: string, targetId: string, password: string) =>
    server().post(`/admin/users/${targetId}/password`).set('Authorization', `Bearer ${adminToken}`).send({ password });

  const fund = async (adminToken: string, targetId: string, amount: number) =>
    server()
      .post(`/admin/users/${targetId}/coins`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount, reason: 'game session revocation funding', idempotencyKey: randomUUID() });

  /** The production path: authenticated launch, one-time exchange, bound session. */
  const openSession = async (accessToken: string) => {
    const minted = await launch(accessToken);
    expect(minted.status).toBe(201);
    const bound = await exchange(minted.body.token as string);
    expect(bound.status).toBe(200);
    return {
      launchToken: minted.body.token as string,
      sessionToken: bound.body.sessionToken as string,
      sessionId: bound.body.sessionId as string,
    };
  };

  const balanceOf = async (id: string) =>
    (await prisma.wallet.findUniqueOrThrow({ where: { userId: id } })).balance;

  const ledgerOf = async (id: string) =>
    prisma.ledgerEntry.findMany({
      where: { wallet: { userId: id } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

  const authVersionOf = async (id: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { id }, select: { authVersion: true } })).authVersion;

  /**
   * Ordering and observation over the *real* Prisma clients the game and auth
   * services are actually injected with (read test-only from the services, so
   * both the CasinoModule and the AppModule instance are covered).
   *
   * Every wrapper calls the real implementation, so every statement still runs
   * against PostgreSQL; nothing is faked and no authorization is bypassed. The
   * only event is one precise statement: taking the account row lock, either as
   * the raw `SELECT "id" FROM "User" ... FOR UPDATE` used by the auth and
   * capability locks, or as a `user.update*` write, which is how the logout,
   * password and disable flows take that same row lock.
   *
   * `attempted` resolves at the call (the operation has reached its lock
   * statement); `acquired` resolves only after the real statement resolved, and
   * `holdNextAcquisition` parks that operation *after* it holds the lock. No
   * sleeps, no polls and no inference from dispatch order.
   */
  type LockPhase = 'attempted' | 'acquired';
  type LockEvent = { kind: 'userLock'; target: string };

  const UUID_VALUE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const rawSqlOf = (arg: unknown) => (Array.isArray(arg) ? (arg as string[]).join('?') : '');
  const uuidIn = (values: unknown[]) =>
    values.find((value): value is string => typeof value === 'string' && UUID_VALUE.test(value));
  const classifyRaw = (args: unknown[]): LockEvent | null => {
    // The account-row lock is always a tagged-template raw query, so its target
    // is the first bound value; anything else (advisory locks, config locks) is
    // deliberately not an event.
    const sql = rawSqlOf(args[0]);
    if (!/FROM "User"/.test(sql) || !/FOR UPDATE/.test(sql)) return null;
    const target = uuidIn(args.slice(1));
    return target ? { kind: 'userLock', target } : null;
  };
  const classifyUserWrite = (args: unknown[]): LockEvent | null => {
    const where = (args[0] as { where?: { id?: unknown } } | undefined)?.where?.id;
    return typeof where === 'string' ? { kind: 'userLock', target: where } : null;
  };

  const observeUserLocks = () => {
    const waiters: Array<LockEvent & { phase: LockPhase; resolve: () => void }> = [];
    const holds: Array<{ event: LockEvent; phase: LockPhase; gate: ReturnType<typeof latch> }> = [];
    const emit = (event: LockEvent, phase: LockPhase) => {
      const index = waiters.findIndex(
        (waiter) => waiter.kind === event.kind && waiter.target === event.target && waiter.phase === phase,
      );
      if (index >= 0) waiters.splice(index, 1)[0].resolve();
    };
    const parkIfHeld = async (event: LockEvent, phase: LockPhase) => {
      const index = holds.findIndex(
        (entry) => entry.phase === phase && entry.event.kind === event.kind && entry.event.target === event.target,
      );
      if (index < 0) return;
      const [{ gate }] = holds.splice(index, 1);
      gate.parked();
      await gate.open;
    };
    const run = async (event: LockEvent | null, statement: () => unknown) => {
      if (!event) return statement();
      emit(event, 'attempted');
      // An 'attempt' hold parks the call *before* the real statement executes, so a
      // competing operation can be ordered ahead of it; an 'acquired' hold parks
      // after the real statement resolved, i.e. while the row lock is held. Both
      // wrap real calls and real SQL, never a production bypass.
      await parkIfHeld(event, 'attempted');
      const resolved = await statement();
      emit(event, 'acquired');
      await parkIfHeld(event, 'acquired');
      return resolved;
    };
    const wrapTx = (tx: Record<string | symbol, unknown>) => new Proxy(tx, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if ((prop === '$queryRaw' || prop === '$executeRaw') && typeof value === 'function') {
          return (...args: unknown[]) => run(
            classifyRaw(args),
            () => (value as (...inner: unknown[]) => unknown).apply(target, args),
          );
        }
        if (prop === 'user' && typeof value === 'object' && value !== null) {
          return new Proxy(value as Record<string | symbol, unknown>, {
            get(model, method, modelReceiver) {
              const fn = Reflect.get(model, method, modelReceiver);
              if (typeof fn !== 'function') return fn;
              const bound = (fn as (...inner: unknown[]) => unknown).bind(model);
              if (method !== 'update' && method !== 'updateMany') return bound;
              return (...args: unknown[]) => run(classifyUserWrite(args), () => bound(...args));
            },
          });
        }
        return value;
      },
    });
    // Services share clients (the AppModule providers share one, the CasinoModule
    // providers another), so spy each distinct client exactly once.
    const clients = new Set<PrismaService>();
    for (const service of [GameCapabilityService, AuthService, UserAccountsService, AuthorizationService]) {
      const instance = app.get(service) as unknown as { prisma?: PrismaService };
      if (instance.prisma) clients.add(instance.prisma);
    }
    const spies: Array<{ mockRestore: () => void }> = [];
    for (const client of clients) {
      const original = client.$transaction.bind(client) as (...args: unknown[]) => unknown;
      spies.push(jest.spyOn(client, '$transaction').mockImplementation(((...args: unknown[]) => {
        const [work, ...rest] = args;
        if (typeof work !== 'function') return original(...args);
        const wrapped = (tx: unknown) =>
          (work as (client: unknown) => unknown)(wrapTx(tx as Record<string | symbol, unknown>));
        return (original as (w: unknown, ...r: unknown[]) => unknown)(wrapped, ...rest);
      }) as never));
    }
    const waitFor = (phase: LockPhase, target: string) =>
      new Promise<void>((resolve) => waiters.push({ kind: 'userLock', target, phase, resolve }));
    const restore = () => {
      openObservers.delete(restore);
      spies.forEach((spy) => spy.mockRestore());
    };
    openObservers.add(restore);
    return {
      attempted: (target: string) => waitFor('attempted', target),
      acquired: (target: string) => waitFor('acquired', target),
      holdNextAcquisition: (target: string) => {
        const gate = latch();
        holds.push({ event: { kind: 'userLock', target }, phase: 'acquired', gate });
        return gate;
      },
      holdNextAttempt: (target: string) => {
        const gate = latch();
        holds.push({ event: { kind: 'userLock', target }, phase: 'attempted', gate });
        return gate;
      },
      restore,
    };
  };

  /** A single-use gate the test opens explicitly, with a signal that it parked. */
  const latch = () => {
    let resolveOpen!: () => void;
    let parked!: () => void;
    const open = new Promise<void>((resolve) => { resolveOpen = resolve; });
    const reached = new Promise<void>((resolve) => { parked = resolve; });
    const release = () => {
      openGates.delete(release);
      resolveOpen();
    };
    openGates.add(release);
    return { release, parked, open, reached };
  };

  beforeAll(async () => {
    await prisma.$connect();
    app = await createApp();
    capabilities = app.get(GameCapabilityService);
    redis = app.get(RedisService);
    await redis.ensureConnected();
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
  });

  /**
   * Safety net: whatever a test left parked or wrapped is released and restored
   * even when an assertion fails or Jest times the test out, so one broken
   * ordering cannot wedge the rest of the suite.
   */
  afterEach(() => {
    openGates.forEach((release) => release());
    openGates.clear();
    openObservers.forEach((restore) => restore());
    openObservers.clear();
    hooks.afterPrepare = undefined;
    hooks.afterDebit = undefined;
  });

  beforeEach(async () => {
    hooks.afterPrepare = undefined;
    hooks.afterDebit = undefined;
    rngDraws = 0;
    rngStream = intRng(SEED);
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "GameActiveMathProfile", "GameMathProfileValidation", "GameMathProfile", ' +
      '"GamePreparedOutcome", "GameSession", "GameLaunchCapability", "CasinoGameConfigVersion", "CasinoGameConfig", ' +
      '"PlatformSettings", "CasinoTransaction", "CasinoRoundAction", "CasinoRound", "CasinoGameFavorite", ' +
      '"LedgerEntry", "BetLeg", "Bet", "AuditLog", "RefreshToken", "Wallet", "User" CASCADE',
    );
    await redis.client.flushdb();
    const [user, rival, admin] = await Promise.all([
      prisma.user.create({ data: { email: mail.user, passwordHash: await argon2.hash(PASSWORD), wallet: { create: {} } } }),
      prisma.user.create({ data: { email: mail.rival, passwordHash: await argon2.hash(PASSWORD), wallet: { create: {} } } }),
      prisma.user.create({
        data: { email: mail.admin, passwordHash: await argon2.hash(ADMIN_PASSWORD), role: 'ADMIN', wallet: { create: {} } },
      }),
    ]);
    userId = user.id;
    rivalId = rival.id;
    adminId = admin.id;
    // Both players must be inside the administrator's reach to be funded.
    await prisma.user.updateMany({ where: { id: { in: [userId, rivalId] } }, data: { createdById: adminId } });
  });

  it('revokes a live game session and a pending launch at logout, and a new login can launch again', async () => {
    const admin = await login(mail.admin, ADMIN_PASSWORD);
    expect((await fund(admin.token, userId, 100_000)).status).toBe(201);
    const session = await login(mail.user);
    const opened = await openSession(session.token);
    const pending = await launch(session.token);
    expect(pending.status).toBe(201);
    expect((await play(opened.sessionToken, { slotEvent: 'getSettings' }, reqId())).status).toBe(200);

    await logout(session.cookie).then((response) => expect(response.status).toBe(201));

    // HTTP error bodies are normalised by the platform's safe filter (`code`
    // becomes the status word), so the precise reason is asserted at the service
    // boundary and the HTTP layer is asserted on its status.
    const stale = await play(opened.sessionToken, { slotEvent: 'getSettings' }, reqId());
    expect(stale.status).toBe(401);
    await expect(capabilities.assertSession(opened.sessionToken, CLASSIC_ID))
      .rejects.toMatchObject({ response: { code: 'GAME_SESSION_INVALID' } });
    const row = await prisma.gameSession.findUniqueOrThrow({ where: { id: opened.sessionId } });
    expect(row.revokedAt).not.toBeNull();

    // A launch capability minted before the logout can never be exchanged.
    const staleExchange = await exchange(pending.body.token as string);
    expect(staleExchange.status).toBe(401);

    // Nor can the refresh token the logout revoked revive anything.
    await server().post('/auth/refresh').set('Cookie', session.cookie).expect(403);
    expect(await authVersionOf(userId)).toBe(1);

    // A fresh sign-in mints a session at the new version and plays.
    const again = await login(mail.user);
    const reopened = await openSession(again.token);
    expect((await play(reopened.sessionToken, { slotEvent: 'getSettings' }, reqId())).status).toBe(200);
  });

  it('revokes every game session when the user changes their own password', async () => {
    const session = await login(mail.user);
    const opened = await openSession(session.token);
    expect((await play(opened.sessionToken, { slotEvent: 'getSettings' }, reqId())).status).toBe(200);

    await server()
      .post('/users/me/password')
      .set('Authorization', `Bearer ${session.token}`)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(201);

    const stale = await play(opened.sessionToken, { slotEvent: 'getSettings' }, reqId());
    expect(stale.status).toBe(401);
    const again = await login(mail.user, NEW_PASSWORD);
    const reopened = await openSession(again.token);
    expect((await play(reopened.sessionToken, { slotEvent: 'getSettings' }, reqId())).status).toBe(200);
  });

  it('revokes the target game session on an administrator password reset and leaves the administrator alone', async () => {
    const admin = await login(mail.admin, ADMIN_PASSWORD);
    const session = await login(mail.user);
    const opened = await openSession(session.token);
    const adminSession = await openSession(admin.token);

    await server()
      .post(`/admin/users/${userId}/password`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ password: NEW_PASSWORD })
      .expect(201);

    expect((await play(opened.sessionToken, { slotEvent: 'getSettings' }, reqId())).status).toBe(401);
    // The administrator's own game session is untouched by the target's revocation.
    expect((await play(adminSession.sessionToken, { slotEvent: 'getSettings' }, reqId())).status).toBe(200);
    expect(await authVersionOf(adminId)).toBe(0);

    const again = await login(mail.user, NEW_PASSWORD);
    const reopened = await openSession(again.token);
    expect((await play(reopened.sessionToken, { slotEvent: 'getSettings' }, reqId())).status).toBe(200);
  });

  it('revokes game sessions when an account is disabled and never resurrects them on re-enable', async () => {
    const admin = await login(mail.admin, ADMIN_PASSWORD);
    const session = await login(mail.user);
    const opened = await openSession(session.token);
    expect((await play(opened.sessionToken, { slotEvent: 'getSettings' }, reqId())).status).toBe(200);
    const before = await authVersionOf(userId);

    expect((await setDisabled(admin.token, userId, true)).status).toBe(201);
    expect(await authVersionOf(userId)).toBe(before + 1);
    const disabled = await play(opened.sessionToken, { slotEvent: 'getSettings' }, reqId());
    // The disable revoked the session as well as bumping the version, so the
    // session itself is refused with a 401; the disabled rule behind it is
    // asserted directly, where the precise code is observable.
    expect(disabled.status).toBe(401);
    await expect(capabilities.requirePlayer(userId, CLASSIC_ID))
      .rejects.toMatchObject({ response: { code: 'GAME_PLAY_REQUIRED' } });

    // Re-enabling restores sign-in, never the credentials minted before the disable.
    expect((await setDisabled(admin.token, userId, false)).status).toBe(201);
    const revived = await play(opened.sessionToken, { slotEvent: 'getSettings' }, reqId());
    expect(revived.status).toBe(401);
    await expect(capabilities.assertSession(opened.sessionToken, CLASSIC_ID))
      .rejects.toMatchObject({ response: { code: 'GAME_SESSION_INVALID' } });

    const again = await login(mail.user);
    const reopened = await openSession(again.token);
    expect((await play(reopened.sessionToken, { slotEvent: 'getSettings' }, reqId())).status).toBe(200);
  });

  it('refuses expired sessions, sessions of another game and sessions that belong to another player', async () => {
    const admin = await login(mail.admin, ADMIN_PASSWORD);
    expect((await fund(admin.token, userId, 100_000)).status).toBe(201);
    const session = await login(mail.user);
    const opened = await openSession(session.token);

    await prisma.gameSession.update({
      where: { id: opened.sessionId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const expired = await play(opened.sessionToken, { slotEvent: 'getSettings' }, reqId());
    expect(expired.status).toBe(401);
    await expect(capabilities.assertSession(opened.sessionToken, CLASSIC_ID))
      .rejects.toMatchObject({ response: { code: 'GAME_SESSION_EXPIRED' } });

    // A live session bound to a different game is worthless here.
    const foreignRaw = `foreign-game-${randomUUID()}`;
    await prisma.gameSession.create({
      data: {
        userId,
        gameId: 'another-game',
        tokenHash: sha256(foreignRaw),
        expiresAt: new Date(Date.now() + 3_600_000),
        authVersion: await authVersionOf(userId),
      },
    });
    const wrongGame = await play(foreignRaw, { slotEvent: 'getSettings' }, reqId());
    expect(wrongGame.status).toBe(401);
    await expect(capabilities.assertSession(foreignRaw, CLASSIC_ID))
      .rejects.toMatchObject({ response: { code: 'GAME_SESSION_INVALID' } });

    // Another player's session acts as that player and never returns this one's state.
    const rivalRef = await login(mail.rival);
    const rival = await openSession(rivalRef.token);
    const rivalView = await play(rival.sessionToken, { slotEvent: 'getSettings' }, reqId());
    expect(rivalView.status).toBe(200);
    expect((rivalView.body.serverResponse as Record<string, unknown>).Balance).toBe(0);
    const mine = await play(
      (await openSession((await login(mail.user)).token)).sessionToken,
      { slotEvent: 'getSettings' },
      reqId(),
    );
    expect(mine.status).toBe(200);
    expect((mine.body.serverResponse as Record<string, unknown>).Balance).toBe(100_000);
  });

  it('refuses a consumed launch capability on a second exchange', async () => {
    const session = await login(mail.user);
    const minted = await launch(session.token);
    expect(minted.status).toBe(201);
    expect((await exchange(minted.body.token as string)).status).toBe(200);
    const second = await exchange(minted.body.token as string);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('LAUNCH_TOKEN_USED');
    expect(await prisma.gameSession.count({ where: { userId } })).toBe(1);
  });

  it('commits a paid action that beats a queued logout, and keeps the committed round durable', async () => {
    const admin = await login(mail.admin, ADMIN_PASSWORD);
    expect((await fund(admin.token, userId, 100_000)).status).toBe(201);
    const session = await login(mail.user);
    const opened = await openSession(session.token);
    const betBody = { slotEvent: 'bet', slotBet: CLASSIC_V1.lineStakes[0], slotLines: CLASSIC_V1.lines };
    const requestId = reqId();

    // Park the settlement inside its transaction, after the wallet write: it now
    // holds the account row lock, so the logout must queue behind it.
    const parked = latch();
    hooks.afterDebit = async () => {
      parked.parked();
      await parked.open;
    };
    const settlement = play(opened.sessionToken, betBody, requestId);
    await parked.reached;
    // The parked settlement already holds the account row lock (the guard took
    // it before any wallet work); the logout's attempt at that same statement is
    // the ordering signal, and it can only complete after the action commits.
    const observer = observeUserLocks();
    let revoke: Pending | undefined;
    try {
      const attempted = observer.attempted(userId);
      revoke = logout(session.cookie);
      await attempted;
    } finally {
      parked.release();
      observer.restore();
    }

    const settled = await settlement;
    expect(settled.status).toBe(200);
    expect((await revoke).status).toBe(201);

    // Exactly one debit, and the wallet is exactly explained by the ledger.
    const ledger = await ledgerOf(userId);
    const debit = ledger.filter((entry) => entry.type === 'CASINO_BET');
    expect(debit).toHaveLength(1);
    expect(ledger.reduce((sum, entry) => sum + entry.amount, 0n)).toBe(await balanceOf(userId));
    expect(await prisma.casinoRound.count({ where: { userId } })).toBe(1);

    // The logout committed after the action, so the session is now dead - and
    // the committed round and ledger rows are untouched by the stale replay.
    const revoked = await prisma.gameSession.findUniqueOrThrow({ where: { id: opened.sessionId } });
    expect(revoked.revokedAt).not.toBeNull();
    const replay = await play(opened.sessionToken, betBody, requestId);
    expect(replay.status).toBe(401);
    const afterReplay = await ledgerOf(userId);
    expect(afterReplay.map((entry) => entry.id)).toEqual(ledger.map((entry) => entry.id));
    expect(await balanceOf(userId)).toBe(ledger.reduce((sum, entry) => sum + entry.amount, 0n));
  });

  it('cancels a paid action whose settlement loses the account lock to a logout, without debiting or ever redrawing its key', async () => {
    const admin = await login(mail.admin, ADMIN_PASSWORD);
    expect((await fund(admin.token, userId, 100_000)).status).toBe(201);
    const session = await login(mail.user);
    const opened = await openSession(session.token);
    const before = await balanceOf(userId);
    const betBody = { slotEvent: 'bet', slotBet: CLASSIC_V1.lineStakes[0], slotLines: CLASSIC_V1.lines };
    const betRequestId = reqId();

    // Park the request after its prepared outcome commits and before settlement:
    // its HTTP session check has already passed, so only the in-transaction guard
    // can refuse the debit.
    const parked = latch();
    hooks.afterPrepare = async () => {
      parked.parked();
      await parked.open;
    };
    const settlement = play(opened.sessionToken, betBody, betRequestId);
    await parked.reached;
    // Snapshot the exact drawn outcome while it is still pending.
    const pending = await prisma.gamePreparedOutcome.findFirstOrThrow({
      where: { userId, gameId: CLASSIC_ID },
    });
    const drawnBytes = JSON.stringify(pending.payload);
    const drawsAfterPrepare = rngDraws;
    expect((await logout(session.cookie)).status).toBe(201);
    parked.release();

    const rejected = await settlement;
    expect(rejected.status).toBe(401);
    // The HTTP body is the safe filter's normalised form. That this refusal came
    // from the in-transaction guard (and not from the earlier HTTP session check)
    // is shown below: the request reached `afterPrepare`, so its session was live
    // when the settlement began, and the prepared outcome was cancelled there.
    expect(rejected.body.code).toBe('UNAUTHORIZED');

    // No debit and no round.
    const ledger = await ledgerOf(userId);
    expect(ledger.filter((entry) => entry.type === 'CASINO_BET')).toHaveLength(0);
    expect(await balanceOf(userId)).toBe(before);
    expect(await prisma.casinoRound.count({ where: { userId } })).toBe(0);

    // The identity is retained as a terminal cancellation, with the bytes that
    // were actually drawn - not deleted and not rewritten.
    const cancelled = await prisma.gamePreparedOutcome.findFirstOrThrow({
      where: { userId, gameId: CLASSIC_ID },
    });
    expect(cancelled.id).toBe(pending.id);
    expect(cancelled.requestKey).toBe(pending.requestKey);
    expect(cancelled.canonical).toBe(pending.canonical);
    expect(JSON.stringify(cancelled.payload)).toBe(drawnBytes);
    expect(cancelled.cancelledAt).not.toBeNull();
    expect(cancelled.cancelledReason).toBe('SESSION_REVOKED');

    // A later, fully authorized same-key request is refused *before* any draw:
    // the cancelled key keeps the only outcome it will ever have.
    const again = await login(mail.user);
    const reopened = await openSession(again.token);
    hooks.afterPrepare = undefined;
    const replayOfCancelled = await play(reopened.sessionToken, betBody, betRequestId);
    expect(replayOfCancelled.status).toBe(409);
    expect(rngDraws).toBe(drawsAfterPrepare);
    expect((await ledgerOf(userId)).filter((entry) => entry.type === 'CASINO_BET')).toHaveLength(0);
    expect(await prisma.casinoRound.count({ where: { userId } })).toBe(0);
    const stillOneRow = await prisma.gamePreparedOutcome.findMany({ where: { userId, gameId: CLASSIC_ID } });
    expect(stillOneRow).toHaveLength(1);
    expect(stillOneRow[0].cancelledAt).not.toBeNull();

    // The terminal row does not block a new, independent action.
    const played = await play(reopened.sessionToken, betBody, reqId());
    expect(played.status).toBe(200);
    expect(await prisma.casinoRound.count({ where: { userId } })).toBe(1);
    expect((await ledgerOf(userId)).filter((entry) => entry.type === 'CASINO_BET')).toHaveLength(1);
  });

  it('serializes launch exchange against logout on the account row in both orders', async () => {
    // Order A: the exchange takes the account row first. It mints a session at
    // the current version, and the logout queued behind it retires that session
    // immediately. No money is involved either way.
    const first = await login(mail.user);
    const minted = await launch(first.token);
    expect(minted.status).toBe(201);
    const observerA = observeUserLocks();
    // The exchange parks *after* it has taken the account row lock, so the
    // logout started below can only queue on the real database lock.
    const exchangeGate = observerA.holdNextAcquisition(userId);
    let exchanging: Pending | undefined;
    let loggingOut: Pending | undefined;
    try {
      exchanging = exchange(minted.body.token as string);
      await exchangeGate.reached;
      const attemptedA = observerA.attempted(userId);
      loggingOut = logout(first.cookie);
      await attemptedA;
    } finally {
      exchangeGate.release();
      observerA.restore();
    }
    const bound = await exchanging;
    expect(bound.status).toBe(200);
    expect((await loggingOut).status).toBe(201);
    // The minted session is dead the moment the queued logout commits.
    await expect(capabilities.assertSession(bound.body.sessionToken as string, CLASSIC_ID))
      .rejects.toMatchObject({ response: { code: 'GAME_SESSION_INVALID' } });

    // Order B: the logout takes the account row first, so the ticket's bound
    // version no longer matches and the exchange mints nothing.
    const second = await login(mail.rival);
    const pending = await launch(second.token);
    expect(pending.status).toBe(201);
    const observerB = observeUserLocks();
    // Mirror image: the logout parks after it holds the account row lock, so the
    // exchange started below can only queue behind it.
    const logoutGate = observerB.holdNextAcquisition(rivalId);
    let loggingOutB: Pending | undefined;
    let refusedExchange: Pending | undefined;
    try {
      loggingOutB = logout(second.cookie);
      await logoutGate.reached;
      const attemptedB = observerB.attempted(rivalId);
      refusedExchange = exchange(pending.body.token as string);
      await attemptedB;
    } finally {
      logoutGate.release();
      observerB.restore();
    }
    expect((await loggingOutB).status).toBe(201);
    const refused = await refusedExchange;
    expect(refused.status).toBe(401);
    expect(await prisma.gameSession.count({ where: { userId: rivalId } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { wallet: { userId: rivalId } } })).toBe(0);
  });

  it('rejects a paid action whose settlement loses the account lock to an administrator disable', async () => {
    const admin = await login(mail.admin, ADMIN_PASSWORD);
    expect((await fund(admin.token, userId, 100_000)).status).toBe(201);
    const session = await login(mail.user);
    const opened = await openSession(session.token);
    const before = await balanceOf(userId);

    const parked = latch();
    hooks.afterPrepare = async () => {
      parked.parked();
      await parked.open;
    };
    const settlement = play(
      opened.sessionToken,
      { slotEvent: 'bet', slotBet: CLASSIC_V1.lineStakes[0], slotLines: CLASSIC_V1.lines },
      reqId(),
    );
    await parked.reached;
    expect((await setDisabled(admin.token, userId, true)).status).toBe(201);
    parked.release();

    const rejected = await settlement;
    expect(rejected.status).toBe(403);
    // Cancelled with the disable as its cause, zero money moved.
    const cancelled = await prisma.gamePreparedOutcome.findFirstOrThrow({
      where: { userId, gameId: CLASSIC_ID },
    });
    expect(cancelled.cancelledAt).not.toBeNull();
    expect(cancelled.cancelledReason).toBe('ACCOUNT_DISABLED');
    expect(await balanceOf(userId)).toBe(before);
    expect((await ledgerOf(userId)).filter((entry) => entry.type === 'CASINO_BET')).toHaveLength(0);
    expect(await prisma.casinoRound.count({ where: { userId } })).toBe(0);

    // Re-enabling the account restores sign-in; the cancelled key stays refused.
    expect((await setDisabled(admin.token, userId, false)).status).toBe(201);
    const again = await login(mail.user);
    const reopened = await openSession(again.token);
    hooks.afterPrepare = undefined;
    const afterReenable = await play(
      reopened.sessionToken,
      { slotEvent: 'bet', slotBet: CLASSIC_V1.lineStakes[0], slotLines: CLASSIC_V1.lines },
      reqId(),
    );
    expect(afterReenable.status).toBe(200);
    expect((await ledgerOf(userId)).filter((entry) => entry.type === 'CASINO_BET')).toHaveLength(1);
  });

  it('linearizes an administrator password reset with a paid action in both orders', async () => {
    const admin = await login(mail.admin, ADMIN_PASSWORD);
    expect((await fund(admin.token, userId, 100_000)).status).toBe(201);
    expect((await fund(admin.token, rivalId, 100_000)).status).toBe(201);
    const betBody = { slotEvent: 'bet', slotBet: CLASSIC_V1.lineStakes[0], slotLines: CLASSIC_V1.lines };

    // Order A (action first): the settlement holds the account row lock, so the
    // reset's transaction can only bump the version and revoke afterwards. The
    // debit stands and the committed round stays durable.
    const first = await login(mail.user);
    const openedA = await openSession(first.token);
    const parkedA = latch();
    hooks.afterDebit = async () => {
      parkedA.parked();
      await parkedA.open;
    };
    const settlementA = play(openedA.sessionToken, betBody, reqId());
    await parkedA.reached;
    const observerA = observeUserLocks();
    let resetA: Pending | undefined;
    try {
      const attempted = observerA.attempted(userId);
      resetA = resetPassword(admin.token, userId, NEW_PASSWORD);
      await attempted;
    } finally {
      parkedA.release();
      observerA.restore();
    }
    expect((await settlementA).status).toBe(200);
    expect((await resetA).status).toBe(201);
    expect((await ledgerOf(userId)).filter((entry) => entry.type === 'CASINO_BET')).toHaveLength(1);
    expect(await prisma.casinoRound.count({ where: { userId } })).toBe(1);
    const revokedByReset = await prisma.gameSession.findUniqueOrThrow({ where: { id: openedA.sessionId } });
    expect(revokedByReset.revokedAt).not.toBeNull();

    // Order B (reset first, on the rival): the reset commits while the paid
    // action sits between its prepared outcome and its settlement, so the
    // action is cancelled with zero money and the target signs in with the new
    // password.
    hooks.afterDebit = undefined;
    const second = await login(mail.rival);
    const openedB = await openSession(second.token);
    const parkedB = latch();
    hooks.afterPrepare = async () => {
      parkedB.parked();
      await parkedB.open;
    };
    const settlementB = play(openedB.sessionToken, betBody, reqId());
    await parkedB.reached;
    expect((await resetPassword(admin.token, rivalId, NEW_PASSWORD)).status).toBe(201);
    parkedB.release();
    const refused = await settlementB;
    expect(refused.status).toBe(401);
    const cancelled = await prisma.gamePreparedOutcome.findFirstOrThrow({
      where: { userId: rivalId, gameId: CLASSIC_ID },
    });
    expect(cancelled.cancelledAt).not.toBeNull();
    expect(cancelled.cancelledReason).toBe('SESSION_REVOKED');
    expect((await ledgerOf(rivalId)).filter((entry) => entry.type === 'CASINO_BET')).toHaveLength(0);
    expect(await prisma.casinoRound.count({ where: { userId: rivalId } })).toBe(0);

    hooks.afterPrepare = undefined;
    const relogin = await login(mail.rival, NEW_PASSWORD);
    const reopened = await openSession(relogin.token);
    expect((await play(reopened.sessionToken, betBody, reqId())).status).toBe(200);
    expect(await prisma.casinoRound.count({ where: { userId: rivalId } })).toBe(1);
    expect((await ledgerOf(rivalId)).filter((entry) => entry.type === 'CASINO_BET')).toHaveLength(1);
  });

  it('commits a paid action that beats a queued disable, and the disable still retires the session', async () => {
    const admin = await login(mail.admin, ADMIN_PASSWORD);
    expect((await fund(admin.token, userId, 100_000)).status).toBe(201);
    const session = await login(mail.user);
    const opened = await openSession(session.token);
    const parked = latch();
    hooks.afterDebit = async () => {
      parked.parked();
      await parked.open;
    };
    const settlement = play(
      opened.sessionToken,
      { slotEvent: 'bet', slotBet: CLASSIC_V1.lineStakes[0], slotLines: CLASSIC_V1.lines },
      reqId(),
    );
    await parked.reached;
    const observer = observeUserLocks();
    let disabling: Pending | undefined;
    try {
      const attempted = observer.attempted(userId);
      disabling = setDisabled(admin.token, userId, true);
      await attempted;
    } finally {
      parked.release();
      observer.restore();
    }

    expect((await settlement).status).toBe(200);
    expect((await disabling).status).toBe(201);
    const ledger = await ledgerOf(userId);
    expect(ledger.filter((entry) => entry.type === 'CASINO_BET')).toHaveLength(1);
    expect(ledger.filter((entry) => entry.type === 'CASINO_WIN')).toHaveLength(0);
    expect(ledger.reduce((sum, entry) => sum + entry.amount, 0n)).toBe(await balanceOf(userId));
    expect(await prisma.casinoRound.count({ where: { userId } })).toBe(1);

    // The disable committed after the action, so the session is dead - and
    // re-enabling the account cannot revive it.
    expect((await setDisabled(admin.token, userId, false)).status).toBe(201);
    const revived = await play(opened.sessionToken, { slotEvent: 'getSettings' }, reqId());
    expect(revived.status).toBe(401);
    const fresh = await login(mail.user);
    const reopened = await openSession(fresh.token);
    expect((await play(reopened.sessionToken, { slotEvent: 'getSettings' }, reqId())).status).toBe(200);
  });

  it('keeps exactly one debit when two duplicate bets overlap a logout in both orders', async () => {
    const admin = await login(mail.admin, ADMIN_PASSWORD);
    expect((await fund(admin.token, userId, 100_000)).status).toBe(201);
    expect((await fund(admin.token, rivalId, 100_000)).status).toBe(201);
    const betBody = { slotEvent: 'bet', slotBet: CLASSIC_V1.lineStakes[0], slotLines: CLASSIC_V1.lines };

    // ---- Order 1: the replay is answered while the session is authorized -----
    // The logout is parked *before* its real account-row lock statement, so it
    // cannot retire the credential while the duplicate is being replayed.
    const session = await login(mail.user);
    const opened = await openSession(session.token);
    const requestId = reqId();
    const settled = await play(opened.sessionToken, betBody, requestId);
    expect(settled.status).toBe(200);

    const observer = observeUserLocks();
    const logoutHold = observer.holdNextAttempt(userId);
    let loggingOut: Pending | undefined;
    let replayed: request.Response | undefined;
    try {
      loggingOut = logout(session.cookie);
      await logoutHold.reached;
      replayed = await play(opened.sessionToken, betBody, requestId);
    } finally {
      logoutHold.release();
      observer.restore();
    }
    // While authorized, the duplicate is the identical stored response...
    expect(replayed.status).toBe(200);
    expect(JSON.stringify(replayed.body)).toBe(JSON.stringify(settled.body));
    expect((await loggingOut).status).toBe(201);
    // ...and only after the logout commits is the same credential refused.
    expect((await play(opened.sessionToken, { slotEvent: 'getSettings' }, reqId())).status).toBe(401);

    // ---- Order 2: the revocation lands before the duplicate is validated -----
    // The duplicate is parked inside the real `assertSession` call, before it
    // reads anything, so the logout commits first and the identical request must
    // be refused instead of replayed.
    const second = await login(mail.rival);
    const openedRival = await openSession(second.token);
    const rivalRequestId = reqId();
    expect((await play(openedRival.sessionToken, betBody, rivalRequestId)).status).toBe(200);

    const realAssertSession = capabilities.assertSession.bind(capabilities);
    const assertGate = latch();
    const assertSpy = jest
      .spyOn(capabilities, 'assertSession')
      .mockImplementation(async (token: string, gameId: string) => {
        assertGate.parked();
        await assertGate.open;
        return realAssertSession(token, gameId);
      });
    let refused: request.Response | undefined;
    try {
      const duplicate = play(openedRival.sessionToken, betBody, rivalRequestId);
      await assertGate.reached;
      expect((await logout(second.cookie)).status).toBe(201);
      assertGate.release();
      refused = await duplicate;
    } finally {
      assertGate.release();
      assertSpy.mockRestore();
    }
    expect(refused.status).toBe(401);

    // ---- One financial footprint per player, no duplicate credit -------------
    for (const [id, key] of [[userId, requestId], [rivalId, rivalRequestId]] as const) {
      const ledger = await ledgerOf(id);
      expect(ledger.filter((entry) => entry.type === 'CASINO_BET')).toHaveLength(1);
      expect(ledger.filter((entry) => entry.type === 'CASINO_WIN')).toHaveLength(0);
      expect(ledger.reduce((sum, entry) => sum + entry.amount, 0n)).toBe(await balanceOf(id));
      expect(await prisma.casinoRound.count({ where: { userId: id } })).toBe(1);
      expect(await prisma.casinoRoundAction.count({ where: { idempotencyKey: `${id}:${key}` } })).toBe(1);
    }
  });

  it('refuses a cancelled key reused on any action path, without new draws, actions or money', async () => {
    const admin = await login(mail.admin, ADMIN_PASSWORD);
    expect((await fund(admin.token, userId, 100_000)).status).toBe(201);
    const session = await login(mail.user);
    const opened = await openSession(session.token);
    const betBody = { slotEvent: 'bet', slotBet: CLASSIC_V1.lineStakes[0], slotLines: CLASSIC_V1.lines };
    const cancelledKey = reqId();

    // Cancel a paid-round identity: park it, sign out, let the settlement lose.
    const parked = latch();
    hooks.afterPrepare = async () => {
      parked.parked();
      await parked.open;
    };
    const settlement = play(opened.sessionToken, betBody, cancelledKey);
    await parked.reached;
    expect((await logout(session.cookie)).status).toBe(201);
    parked.release();
    expect((await settlement).status).toBe(401);
    const cancelled = await prisma.gamePreparedOutcome.findFirstOrThrow({
      where: { userId, gameId: CLASSIC_ID },
    });
    expect(cancelled.cancelledAt).not.toBeNull();
    hooks.afterPrepare = undefined;

    const drawsAfterCancel = rngDraws;
    const ledgerBefore = await ledgerOf(userId);
    const actionsBefore = await prisma.casinoRoundAction.count({ where: { userId } });

    const again = await login(mail.user);
    const reopened = await openSession(again.token);

    // Same key, same semantics: refused as the terminal cancellation it is.
    const sameSemantics = await play(reopened.sessionToken, betBody, cancelledKey);
    expect(sameSemantics.status).toBe(409);
    // Same key, different semantics on another action path (the free-spin
    // request): refused as a conflict rather than executed as a new action.
    const otherPath = await play(
      reopened.sessionToken,
      { slotEvent: 'freespin', slotBet: CLASSIC_V1.lineStakes[0], slotLines: CLASSIC_V1.lines },
      cancelledKey,
    );
    expect(otherPath.status).toBe(409);

    // The shared idempotency read is what refuses both, with the exact codes.
    const journal = app.get(GameJournalService);
    const adapter = app.get(ClassicAdapter);
    const context = { gameId: CLASSIC_ID, userId, sessionId: opened.sessionId };
    await expect(journal.findReplay(CLASSIC_ID, userId, cancelledKey, cancelled.canonical))
      .rejects.toMatchObject({ response: { code: 'OUTCOME_CANCELLED' } });
    await expect(journal.findReplay(
      CLASSIC_ID,
      userId,
      cancelledKey,
      adapter.canonicalizeAction(context, 'freespin', {
        slotEvent: 'freespin',
        slotBet: CLASSIC_V1.lineStakes[0],
        slotLines: CLASSIC_V1.lines,
      }),
    )).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });

    // Nothing moved, nothing was drawn, and the tombstone is still there.
    expect(rngDraws).toBe(drawsAfterCancel);
    expect(await prisma.casinoRoundAction.count({ where: { userId } })).toBe(actionsBefore);
    expect((await ledgerOf(userId)).map((entry) => entry.id)).toEqual(ledgerBefore.map((entry) => entry.id));
    expect(await prisma.casinoRound.count({ where: { userId } })).toBe(0);
    expect(await prisma.gamePreparedOutcome.count({ where: { userId, gameId: CLASSIC_ID } })).toBe(1);
    expect(await balanceOf(userId)).toBe(ledgerBefore.reduce((sum, entry) => sum + entry.amount, 0n));
  });

  it('keeps a revoked free-spin continuation from changing rounds, actions or draws', async () => {
    const admin = await login(mail.admin, ADMIN_PASSWORD);
    expect((await fund(admin.token, userId, 100_000)).status).toBe(201);
    const session = await login(mail.user);
    const opened = await openSession(session.token);

    // The accepted feature fixture (seed `classic-312`, re-seeded per test)
    // awards ten free games to this paid round, so the continuation is real.
    const bet = await play(
      opened.sessionToken,
      { slotEvent: 'bet', slotBet: CLASSIC_V1.lineStakes[0], slotLines: CLASSIC_V1.lines },
      reqId(),
    );
    expect(bet.status).toBe(200);
    expect((bet.body.serverResponse as Record<string, unknown>).totalFreeGames).toBe(10);
    const round = await prisma.casinoRound.findFirstOrThrow({ where: { userId } });
    const version = (round.privateState as unknown as { version: number }).version;
    const drawsAfterBet = rngDraws;
    const actionsAfterBet = await prisma.casinoRoundAction.count({ where: { userId } });
    const ledgerAfterBet = await ledgerOf(userId);
    const stateAfterBet = JSON.stringify(round.privateState);
    expect(actionsAfterBet).toBe(1);
    expect(ledgerAfterBet.filter((entry) => entry.type === 'CASINO_BET')).toHaveLength(1);
    expect(ledgerAfterBet.filter((entry) => entry.type === 'CASINO_WIN')).toHaveLength(0);

    expect((await logout(session.cookie)).status).toBe(201);
    const continued = await play(
      opened.sessionToken,
      { slotEvent: 'freespin', slotBet: CLASSIC_V1.lineStakes[0], slotLines: CLASSIC_V1.lines },
      reqId(),
      String(version),
      round.id,
    );
    expect(continued.status).toBe(401);

    expect(rngDraws).toBe(drawsAfterBet);
    expect(await prisma.casinoRoundAction.count({ where: { userId } })).toBe(actionsAfterBet);
    expect((await ledgerOf(userId)).map((entry) => entry.id)).toEqual(ledgerAfterBet.map((entry) => entry.id));
    expect(await prisma.casinoRound.count({ where: { userId } })).toBe(1);
    const after = await prisma.casinoRound.findUniqueOrThrow({ where: { id: round.id } });
    expect(JSON.stringify(after.privateState)).toBe(stateAfterBet);
    expect(await balanceOf(userId)).toBe(ledgerAfterBet.reduce((sum, entry) => sum + entry.amount, 0n));
  });
});
