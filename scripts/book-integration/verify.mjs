/**
 * Real-HTTP verification for the Book of Ra integration bundle.
 *
 * Proves, against the running stack: wallet-backed normal spin with exactly one
 * ledger debit, win credit when the spin wins, duplicate-idempotency replay
 * without a second money movement, autoplay suppression of the gamble, refresh
 * recovery, and whatever gamble ladder the real RNG produced. Nothing is
 * simulated and no outcome is forced.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadIntegrationEnv, log, npmBin, root, run } from './lib.mjs';
import { NestClient } from './nest.mjs';
import { assertLocalTestTarget } from './setup.mjs';

const env = await loadIntegrationEnv();
assertLocalTestTarget(env);

const backend = `http://127.0.0.1:${env.INTEGRATION_BACKEND_PORT}`;
const preview = `http://127.0.0.1:${env.INTEGRATION_PREVIEW_PORT}`;
const nest = new NestClient(backend);
const results = [];

function record(name, pass, detail) {
  results.push({ name, status: pass ? 'PASS' : 'FAIL', detail });
  log(pass ? 'VERIFY_PASS' : 'VERIFY_FAIL', { check: name, detail });
}

async function previewRequest(cookie, route, { method = 'GET', body, idempotencyKey } = {}) {
  const response = await fetch(`${preview}${route}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      cookie,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, ok: response.ok, payload: await response.json().catch(() => null) };
}

const ledgerIds = (entries) => new Set(entries.map((entry) => entry.id));

const login = await nest.login(env.INTEGRATION_PLAYER_EMAIL, env.INTEGRATION_PLAYER_PASSWORD);
if (!login.ok) throw new Error('The local test player could not sign in; run start.mjs first.');
const token = login.payload.accessToken;

const config = await nest.bookConfig(token);
record(
  'published profile is unchanged (book-of-ra.v1.rtp5000, 10 lines, 5 gamble attempts)',
  config.ok && config.payload.rtpBps === 5000 && config.payload.profileId === 'book-of-ra.v1.rtp5000' &&
    config.payload.paylineCount === 10 && config.payload.gamble?.maxAttempts === 5,
  { profileId: config.payload?.profileId, rtpBps: config.payload?.rtpBps, paylineCount: config.payload?.paylineCount },
);

const autoLogin = await fetch(`${preview}/session/auto`, { method: 'POST' });
const sessionCookie = (autoLogin.headers.getSetCookie?.() ?? []).find((value) => value.startsWith('bi_session='))?.split(';')[0];
record('the integration session signs in with the real /auth/login', autoLogin.ok && Boolean(sessionCookie), {
  status: autoLogin.status,
});

const before = await nest.ledger(token, 25);
const walletBefore = await nest.wallet(token);
const beforeIds = ledgerIds(before.payload);
const beforeBalance = BigInt(walletBefore.payload.balance);

const spinKey = randomUUID();
const spin = await previewRequest(sessionCookie, '/v1/spins', {
  method: 'POST',
  idempotencyKey: spinKey,
  body: { gameId: 'book-of-the-sands', playerId: login.payload.user.id, betUnits: '100', idempotencyKey: spinKey },
});
const round = spin.payload;
record('the accepted UI transport reaches the real backend (POST /v1/spins)', spin.ok && Boolean(round?.roundId), {
  status: spin.status,
  roundId: round?.roundId,
  roundState: round?.roundState,
});
record('the transport returns an authoritative board', Array.isArray(round?.finalGrid) &&
  round.finalGrid.length === 5 && round.finalGrid.every((column) => column.length === 3) && Array.isArray(round.events) &&
  round.events.some((event) => event.type === 'grid-reveal'), { events: round?.events?.map((event) => event.type) });
record('the response never carries the pre-drawn gamble ladder', !JSON.stringify(round ?? {}).includes('gambleColours'), {});

const walletAfter = await nest.wallet(token);
const afterBalance = BigInt(walletAfter.payload.balance);
const win = BigInt(round.totalWinUnits ?? '0');
const settle = round.settlement ?? {};
const payout = BigInt(settle.payout ?? '0');
const expected = beforeBalance - 100n + payout;
record('normal spin moves exactly one stake and, when it wins, one credit', afterBalance === expected, {
  before: beforeBalance.toString(),
  after: afterBalance.toString(),
  totalWinUnits: win.toString(),
  settlementPayout: payout.toString(),
});

const afterLedger = await nest.ledger(token, 25);
const fresh = afterLedger.payload.filter((entry) => !beforeIds.has(entry.id));
const bets = fresh.filter((entry) => entry.type === 'CASINO_BET');
const wins = fresh.filter((entry) => entry.type === 'CASINO_WIN');
record('the ledger records exactly one debit for the spin', bets.length === 1 && BigInt(bets[0].amount) === -100n, {
  entries: fresh.map((entry) => ({ type: entry.type, amount: entry.amount })),
});
if (payout > 0n) {
  record('the ledger records the win credit exactly once when the spin paid', wins.length === 1 && BigInt(wins[0].amount) === payout, {
    payout: payout.toString(),
    winEntries: wins.length,
  });
} else {
  record('no leading win this spin, so live win-credit is not proven here', true, {
    payout: '0',
    note: 'win credit is proven by the deterministic backend suites, not by this spin',
  });
}

const replay = await previewRequest(sessionCookie, '/v1/spins', {
  method: 'POST',
  idempotencyKey: spinKey,
  body: { gameId: 'book-of-the-sands', playerId: login.payload.user.id, betUnits: '100', idempotencyKey: spinKey },
});
const replayWallet = await nest.wallet(token);
const replayLedger = await nest.ledger(token, 25);
record(
  'replaying the same idempotency key returns the same round and moves no money',
  replay.ok && replay.payload.roundId === round.roundId && replay.payload.idempotent === true &&
    BigInt(replayWallet.payload.balance) === afterBalance && ledgerIds(replayLedger.payload).size === ledgerIds(afterLedger.payload).size,
  { roundId: replay.payload?.roundId, idempotent: replay.payload?.idempotent },
);

const autoplayKey = randomUUID();
const autoplay = await previewRequest(sessionCookie, '/v1/spins', {
  method: 'POST',
  idempotencyKey: autoplayKey,
  body: { gameId: 'book-of-the-sands', playerId: login.payload.user.id, betUnits: '100', autoplay: true, idempotencyKey: autoplayKey },
});
record(
  'an autoplay-flagged spin never offers the gamble',
  autoplay.ok && !(autoplay.payload.pendingAction?.type === 'gamble'),
  { roundState: autoplay.payload?.roundState, pendingAction: autoplay.payload?.pendingAction?.type ?? null },
);

const state = await previewRequest(sessionCookie, `/v1/state/${login.payload.user.id}`);
const refreshRound = state.payload?.pendingRound;
record(
  'refresh recovery reads the real state route and only claims a round when one is open',
  state.ok && (refreshRound ? typeof refreshRound.roundId === 'string' : true),
  {
    status: state.status,
    hasPendingRound: Boolean(refreshRound),
    roundState: refreshRound?.roundState ?? 'IDLE',
    featureOpen: ['FREE_GAME_INTRO', 'FREE_GAME_ACTIVE'].includes(refreshRound?.roundState ?? ''),
    note: 'Free Games recovery is only proven when an open feature round is actually present',
  },
);

// Gamble ladder: only if the real RNG produced one. No outcome is forced.
let gambleSummary = { observed: false };
let pending = autoplay.payload?.pendingAction ? autoplay.payload : undefined;
if (!pending) {
  for (let index = 0; index < 40 && !pending; index += 1) {
    const key = randomUUID();
    const probe = await previewRequest(sessionCookie, '/v1/spins', {
      method: 'POST',
      idempotencyKey: key,
      body: { gameId: 'book-of-the-sands', playerId: login.payload.user.id, betUnits: '100', idempotencyKey: key },
    });
    if (probe.payload?.pendingAction?.type === 'gamble') pending = probe.payload;
    if (!probe.ok) break;
  }
}
if (pending) {
  const attempts = [];
  let current = pending;
  for (let step = 0; step < 6 && current?.pendingAction?.type === 'gamble'; step += 1) {
    const key = randomUUID();
    const resolved = await previewRequest(sessionCookie, `/v1/rounds/${current.roundId}/actions`, {
      method: 'POST',
      idempotencyKey: key,
      body: {
        roundId: current.roundId,
        actionId: current.pendingAction.id,
        choiceId: 'black',
        idempotencyKey: key,
      },
    });
    if (!resolved.ok) break;
    const event = (resolved.payload.events ?? []).find((entry) => entry.type === 'choice-resolved');
    attempts.push({
      choice: event?.data.choiceId,
      attempt: event?.data.attempt,
      won: event?.data.won ?? null,
      winningColour: event?.data.winningColour ?? null,
      settlementUnits: event?.data.settlementUnits,
      complete: resolved.payload.complete,
    });
    current = resolved.payload;
  }
  gambleSummary = { observed: true, attempts, complete: current?.complete === true, hasLadder: JSON.stringify(current ?? {}).includes('gambleColours') };
}

const report = {
  generatedAt: new Date().toISOString(),
  profile: { profileId: config.payload?.profileId, rtpBps: config.payload?.rtpBps },
  spin: { roundId: round?.roundId, roundState: round?.roundState, winUnits: win.toString(), payout: payout.toString() },
  ledger: { fresh: fresh.map((entry) => ({ type: entry.type, amount: entry.amount })) },
  autoplay: { roundState: autoplay.payload?.roundState, pendingAction: autoplay.payload?.pendingAction?.type ?? null },
  gamble: gambleSummary,
  unverifiedLive: [
    ...(gambleSummary.observed ? [] : ['live gamble ladder (no eligible win occurred during the bounded probe)']),
    'live Free Games trigger and +10 retrigger (needs a real 3+ Book event)',
    'live maximum-length 5-attempt ladder (needs five consecutive correct colours)',
    'live Free Games refresh recovery (needs an open feature round)',
  ],
  checks: results,
};
const reportPath = path.join(root, 'docs', 'agent-work', 'book-integration', 'verification.json');
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const failed = results.filter((entry) => entry.status === 'FAIL');
// Test-only evidence for the scenarios no bounded live run can force: the
// accepted backend suites use the existing deterministic RNG seam, not a
// production route.
const deterministic = await run(
  [npmBin, 'exec', '--', 'jest', '--runInBand', 'test/casino-book-of-ra.integration.spec.ts', 'test/casino-book-of-ra-gamble-projection.spec.ts'],
  {
    cwd: path.join(root, 'backend'),
    shell: process.platform === 'win32',
    env: {
      ...env,
      DATABASE_URL: env.INTEGRATION_TEST_DATABASE_URL,
      NODE_ENV: 'test',
      JWT_ACCESS_SECRET: 'integration-test-access-secret-0123456789abcdef',
    },
    timeoutMs: 600_000,
    log: path.join(root, 'tmp', 'integration', 'logs', 'verify-jest.log'),
  },
);
const jestSummary = deterministic.output.match(/Tests:.*/) ?? [];
log(deterministic.code === 0 ? 'VERIFY_TEST_ONLY_PASS' : 'VERIFY_TEST_ONLY_FAIL', {
  scope: 'deterministic backend suites (test-only seam): positive payout, duplicate gamble idempotency, expander/retrigger/counters',
  summary: jestSummary[0] ?? `exit ${deterministic.code}`,
});
if (deterministic.code !== 0) process.exitCode = 1;

log('VERIFY_SUMMARY', { passed: results.length - failed.length, failed: failed.length, report: path.relative(root, reportPath) });
if (failed.length) process.exitCode = 1;
