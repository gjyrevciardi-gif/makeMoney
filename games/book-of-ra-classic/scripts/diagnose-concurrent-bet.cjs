/*
 * Diagnose-only harness for the concurrent identical bet race.
 *
 * Runs the REAL ClassicAdapter against the REAL shared PostgreSQL path, fires
 * two identical state-changing requests, and captures the ORIGINAL exception
 * (class, message, stack, Prisma code/meta) plus the resulting wallet, ledger,
 * round, action and prepared rows for the fixture user and request key.
 *
 * It never truncates, resets or drops anything and never prints credentials.
 *
 * Usage (isolated local test DB only):
 *   DATABASE_URL=... node games/book-of-ra-classic/scripts/diagnose-concurrent-bet.cjs
 */
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const DIST = path.join(ROOT, 'backend', 'dist', 'src');
const load = (...parts) => require(path.join(DIST, ...parts));

const { PrismaService } = load('prisma.service.js');
const { CasinoGameRegistry } = load('casino', 'casino-game.registry.js');
const { CasinoConfigService } = load('casino', 'casino-config.service.js');
const { GameCapabilityService } = load('casino', 'platform', 'game-capability.service.js');
const { GameJournalService } = load('casino', 'platform', 'game-journal.service.js');
const { GameRoundService } = load('casino', 'platform', 'game-round.service.js');
const { GameWalletService } = load('casino', 'platform', 'game-wallet.service.js');
const { ClassicAdapter } = load('casino', 'games', 'book-of-ra-classic', 'classic.adapter.js');
const { createSimulationRng } = load('casino', 'platform', 'math-control', 'math-control.random.js');
const { PointsService } = load('wallet', 'points.service.js');

const WIN_SEED = 'classic-2';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const intRng = (seed) => {
  const rng = createSimulationRng(seed);
  return (upper) => rng.int(0, upper - 1);
};

const describeError = (error) => ({
  className: error && error.constructor && error.constructor.name,
  code: error && error.code,
  message: String((error && error.message) || ''),
  meta: error && error.meta,
  clientVersion: error && error.clientVersion,
  httpStatus: error && typeof error.getStatus === 'function' ? error.getStatus() : undefined,
  httpBody: error && typeof error.getResponse === 'function' ? error.getResponse() : undefined,
  // Full sanitized stack (no credentials are present in a Prisma stack).
  stack: String((error && error.stack) || '').split('\n'),
});

const redact = (value) => JSON.parse(JSON.stringify(value ?? null, (key, entry) => (
  /token|secret|password|authorization/i.test(key) ? '<redacted>' : entry
)));

async function main() {
  const prisma = new PrismaService();
  const registry = new CasinoGameRegistry();
  const configs = new CasinoConfigService(prisma, registry);
  const points = new PointsService(prisma);
  const capabilities = new GameCapabilityService(prisma, registry, configs);
  const platform = {
    capabilities,
    wallet: new GameWalletService(),
    journal: new GameJournalService(prisma),
    rounds: new GameRoundService(prisma),
  };
  const evidence = { ranAt: new Date().toISOString() };
  try {
    await prisma.$connect();
    // Identity of the isolated database this run used (host/port/name only).
    const identity = await prisma.$queryRawUnsafe(
      'select current_database() as db, inet_server_addr()::text as host, inet_server_port() as port',
    );
    evidence.database = identity;
    // Hard guard BEFORE any write: loopback connection target and the isolated
    // test database, by name. The harness refuses anything else.
    const target = new URL(process.env.DATABASE_URL || 'invalid:');
    if (
      !['127.0.0.1', 'localhost', '::1'].includes(target.hostname)
      || identity[0].db !== 'boc_classic_test'
    ) {
      throw new Error(`REFUSED_UNSAFE_DATABASE: host=${target.hostname} db=${identity[0].db}`);
    }

    const stamp = randomUUID().slice(0, 8);
    const admin = await prisma.user.create({
      data: { email: `diag-admin-${stamp}@example.test`, passwordHash: 'x', role: 'ADMIN', wallet: { create: {} } },
    });
    const player = await prisma.user.create({
      data: { email: `diag-player-${stamp}@example.test`, passwordHash: 'x', wallet: { create: {} } },
    });
    const userId = player.id;
    const funded = 1_000n;
    await points.adminGrant(admin.id, userId, funded, `diag fixture ${stamp}`, `diag-grant-${stamp}`);
    const session = await prisma.gameSession.create({
      data: {
        userId,
        gameId: 'book-of-ra-classic',
        tokenHash: sha256(`diag-${randomUUID()}`),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    evidence.fixture = { userId, sessionId: session.id, funded: funded.toString() };
    evidence.walletBefore = (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance.toString();

    const adapter = new ClassicAdapter(prisma, platform, configs, undefined, { rng: intRng(WIN_SEED) });
    const context = { gameId: 'book-of-ra-classic', userId, sessionId: session.id };
    const requestId = `diag-${stamp}-${randomUUID().slice(0, 10)}`;
    const request = {
      event: 'bet',
      body: { slotEvent: 'bet', slotBet: 1, slotLines: 9 },
      headers: { 'x-pilot-version': '1', 'x-pilot-round': 'none' },
      requestId,
    };
    evidence.requestId = requestId;
    evidence.requestKey = `${userId}:${requestId}`;

    const settled = await Promise.allSettled([
      adapter.execute(context, request),
      adapter.execute(context, request),
    ]);
    evidence.outcomes = settled.map((entry, index) => ({
      index,
      status: entry.status,
      ...(entry.status === 'fulfilled'
        ? { response: redact(entry.value) }
        : { error: describeError(entry.reason) }),
    }));

    evidence.afterFailure = {
      wallet: (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance.toString(),
      ledger: await prisma.ledgerEntry.findMany({
        where: { wallet: { userId } },
        select: { type: true, amount: true, idempotencyKey: true, actionId: true, gameSessionId: true },
      }),
      rounds: await prisma.casinoRound.findMany({
        where: { userId },
        select: { id: true, status: true, stake: true, payout: true, createdAt: true },
      }),
      actions: await prisma.casinoRoundAction.findMany({
        where: { idempotencyKey: `${userId}:${requestId}` },
        select: { id: true, action: true, seq: true, deliveredAt: true, ackedAt: true, canonical: true },
      }),
      actionsTotal: await prisma.casinoRoundAction.count({ where: { userId } }),
      prepared: await prisma.gamePreparedOutcome.findMany({
        where: { requestKey: `${userId}:${requestId}` },
        select: { kind: true, originRoundId: true, originVersion: true, originPhase: true, createdAt: true },
      }),
      preparedTotal: await prisma.gamePreparedOutcome.count({ where: { userId } }),
    };
  } catch (error) {
    evidence.harnessError = describeError(error);
  } finally {
    const out = `${JSON.stringify(evidence, (key, value) => (typeof value === 'bigint' ? value.toString() : value), 1)}\n`;
    const target = path.join(ROOT, 'docs', 'agent-work', 'book-of-ra-current', 'CONCURRENT-BET-DIAGNOSIS.json');
    try { fs.writeFileSync(target, out); } catch { /* evidence dir may not exist */ }
    process.stdout.write(out);
    await prisma.$disconnect().catch(() => {});
  }
}

main();
