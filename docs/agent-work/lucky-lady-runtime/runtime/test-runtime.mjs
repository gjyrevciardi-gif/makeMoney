// Bounded integration tests: atomic settlement, fault recovery, guards, native money,
// presentation receipts, simultaneous HTTP execution, credit ledgers, HTTP retrigger, gamble loss.
import { spawn } from 'node:child_process';
import { rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime } from './runtime-core.mjs';
import {
  createDeterministicRng, drawGamble,
  PINNED_ENGINE_SHA256, PINNED_RULES_SHA256, SUPPORTED_LINES,
} from './runtime-math.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN = 'C:/Users/Admin/orca/research/game-pack-forensics/runtime/LuckyLadysCharmDX/clean-runtime';
const results = [];
const probes = {};
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const headersFor = (version, round) => ({ 'x-pilot-version': String(version), 'x-pilot-round': String(round) });
const newCounters = () => ({ actionExecutions: 0, outcomeGenerations: 0, engineRngDraws: 0, gambleGenerations: 0, gambleRngDraws: 0 });
const BET_BODY = { slotEvent: 'bet', slotBet: '0.10', slotLines: 10 };
const FS_BODY = { slotEvent: 'freespin', slotBet: '0.10', slotLines: 10 };
const WAGER_CENTS = 100; // 0.10 native stake x 10 supported lines
let seq = 0;
const nextId = (prefix) => `${prefix}-${++seq}`;

/** Pre-draw search for an injected gamble draw with the wanted outcome. No odds are changed. */
function findGambleSeed(choice, wantWin) {
  for (let i = 0; i < 20000; i++) {
    const seed = `gamble-${wantWin ? 'win' : 'lose'}-${i}`;
    if (drawGamble({ rng: createDeterministicRng(seed), choice }).win === wantWin) return seed;
  }
  throw new Error(`no deterministic gamble seed produced ${wantWin ? 'a win' : 'a loss'}`);
}

// ---------- Part 1: in-process atomic settlement + fault injection ----------
function coreSuite() {
  const dbName = `core-${Date.now()}.sqlite`;
  const path = join(RUN, dbName);
  if (existsSync(path)) rmSync(path);
  const hooks = {};
  const runtime = createRuntime({ dir: RUN, dbName, rngFactory: () => createDeterministicRng('core-seed-1'), hooks, counters: newCounters(), config: { startingBalanceCents: 100000 } });
  const body = { slotEvent: 'bet', slotBet: '0.10', slotLines: 10 };
  let failure = null;
  hooks.afterDebitBeforeCredit = () => { throw new Error('injected crash after debit, before credit'); };
  try { runtime.handle('bet', body, headersFor(1, 'none'), 'core-1'); } catch (error) { failure = error; }
  check('core.injected-crash-rolls-back-settlement', !!failure, failure && failure.message);
  const afterCrash = runtime.ledgerRows();
  check('core.no-ledger-rows-after-rollback', afterCrash.length === 0, `rows=${afterCrash.length}`);
  const preparedRow = runtime.db.prepare('SELECT request_id,payload FROM prepared').get();
  check('core.prepared-outcome-durable-after-crash', !!preparedRow && String(preparedRow.request_id).endsWith('core-1'), preparedRow && preparedRow.request_id);
  const preparedPayload = preparedRow ? JSON.parse(preparedRow.payload) : null;

  delete hooks.afterDebitBeforeCredit;
  const retried = runtime.handle('bet', body, headersFor(1, 'none'), 'core-1');
  check('core.retry-settles-cleanly', retried.responseEvent === 'spin', retried.responseEvent);
  check('core.retry-reuses-same-draw', preparedPayload && JSON.stringify(retried.serverResponse.reelsSymbols) === JSON.stringify(preparedPayload.main.board && {
    reel1: preparedPayload.main.board.reel1, reel2: preparedPayload.main.board.reel2, reel3: preparedPayload.main.board.reel3,
    reel4: preparedPayload.main.board.reel4, reel5: preparedPayload.main.board.reel5, rp: preparedPayload.main.board.rp,
  }), 'same board as the prepared draw');
  const ledger = runtime.ledgerRows();
  const net = ledger.reduce((a, r) => a + r.delta, 0);
  const storedBalance = runtime.balanceCents();
  check('core.ledger-deltas-reconcile', net === storedBalance - 100000, `net=${net} balance=${storedBalance}`);
  check('core.exactly-one-bet-debit', ledger.filter((r) => r.kind === 'bet').length === 1, JSON.stringify(ledger.map((r) => r.kind)));
  const roundRow = runtime.db.prepare('SELECT engine_sha256, profile_hash, bet, lines FROM rounds').get();
  check('core.round-locks-engine-hash', roundRow && roundRow.engine_sha256 === PINNED_ENGINE_SHA256, roundRow && roundRow.engine_sha256);

  // A settled action stays pending until its presentation receipt arrives: a different request
  // id cannot start the next action, and an acknowledgement releases exactly that action.
  const hooks2 = { afterOutcomePersisted: () => { delete hooks2.afterOutcomePersisted; throw new Error('halt'); } };
  const runtime2 = createRuntime({ dir: RUN, dbName: `core2-${Date.now()}.sqlite`, rngFactory: () => createDeterministicRng('core-seed-2'), counters: newCounters(), hooks: hooks2, config: { startingBalanceCents: 100000 } });
  try { runtime2.handle('bet', body, headersFor(1, 'none'), 'block-1'); } catch { /* expected */ }
  let bodyMismatch = null;
  try { runtime2.handle('bet', { slotEvent: 'bet', slotBet: '0.20', slotLines: 10 }, headersFor(1, 'none'), 'block-1'); } catch (error) { bodyMismatch = error; }
  check('core.prepared-body-mismatch-409', bodyMismatch && bodyMismatch.status === 409, bodyMismatch && bodyMismatch.message);

  const settledRound2 = runtime2.db.prepare('SELECT round_id, version FROM rounds ORDER BY id DESC LIMIT 1').get();
  let blocked = null;
  try { runtime2.handle('bet', body, headersFor(settledRound2.version, settledRound2.round_id), 'block-2'); } catch (error) { blocked = error; }
  check('core.next-action-blocked-until-ack', blocked && blocked.status === 409 && blocked.code === 'ACK_REQUIRED', blocked && blocked.message);
  const ackResult = runtime2.handle('ack', { slotEvent: 'ack', actionId: 'block-1' }, {}, 'ack-block-1');
  check('core.ack-recorded-for-exact-action', ackResult.accepted === true && ackResult.actionId === 'block-1', JSON.stringify(ackResult));
  const released = runtime2.handle('bet', body, headersFor(settledRound2.version, settledRound2.round_id), 'block-3');
  check('core.next-action-allowed-after-ack', released.responseEvent === 'spin', released && released.responseEvent);

  // stored-round identity must match the loaded evaluator/profile
  const tamperRuntime = createRuntime({ dir: RUN, dbName: 'core4-' + Date.now() + '.sqlite', rngFactory: () => createDeterministicRng('core-seed-4'), config: { startingBalanceCents: 100000 } });
  tamperRuntime.handle('bet', body, headersFor(1, 'none'), 'tamper-1');
  tamperRuntime.db.prepare("UPDATE rounds SET engine_sha256='deadbeef'").run();
  let tampered = null;
  try { tamperRuntime.handle('getSettings', { slotEvent: 'getSettings' }, {}, 'tamper-read'); } catch (error) { tampered = error; }
  check('core.round-identity-verified-on-load', tampered && tampered.status === 409, tampered && tampered.message);

  // native money reconciliation on a real settlement
  const runtime3 = createRuntime({ dir: RUN, dbName: `core3-${Date.now()}.sqlite`, rngFactory: () => createDeterministicRng('core-seed-3'), config: { startingBalanceCents: 100000 } });
  const spin = runtime3.handle('bet', body, headersFor(1, 'none'), 'money-1');
  const sr = spin.serverResponse;
  const expectedBalance = (100000 - 10 * SUPPORTED_LINES) / 100;
  check('money.balance-is-post-debit-pre-win', sr.Balance <= expectedBalance + 0.0001, `Balance=${sr.Balance} expected<=${expectedBalance}`);
  const winSum = sr.winLines.reduce((a, l) => a + l.Win, 0);
  check('money.winLines-in-currency', sr.winLines.every((l) => l.Win < 1000), JSON.stringify(sr.winLines.slice(0, 2)));
  check('money.totalWin-matches-lines', Math.abs(sr.totalWin - winSum) < 0.0001, `totalWin=${sr.totalWin} sum=${winSum}`);
  check('money.afterBalance-reconciles', Math.abs(sr.afterBalance - (sr.Balance + sr.totalWin)) < 0.0001, `${sr.Balance}+${sr.totalWin} vs ${sr.afterBalance}`);
  check('money.scatterWin-currency', sr.bonusInfo.scattersWin < 1000, String(sr.bonusInfo.scattersWin));
  check('money.native-units-are-integer-cents',
    runtime3.ledgerRows().every((l) => Number.isInteger(l.delta) && Number.isInteger(l.before_balance) && Number.isInteger(l.after_balance))
    && runtime3.balanceCents() === Math.round(spin.recovery.balance * 100),
    JSON.stringify(runtime3.ledgerRows().map((l) => [l.kind, l.delta])));
}
coreSuite();

function recoverySuite() {
  const dbName = 'recover-' + Date.now() + '.sqlite';
  const hooks = {};
  const r1 = createRuntime({ dir: RUN, dbName, rngFactory: () => createDeterministicRng('rec-1'), hooks, counters: newCounters(), config: { startingBalanceCents: 100000 } });
  hooks.afterDebitBeforeCredit = () => { delete hooks.afterDebitBeforeCredit; throw new Error('crash after debit'); };
  let crashed = null;
  try { r1.handle('bet', { slotEvent: 'bet', slotBet: '0.10', slotLines: 10 }, headersFor(1, 'none'), 'rec-1'); } catch (error) { crashed = error; }
  check('recover.crash-left-prepared', !!crashed && r1.db.prepare('SELECT COUNT(*) c FROM prepared').get().c === 1 && r1.ledgerRows().length === 0);
  const preparedPayload = JSON.parse(r1.db.prepare('SELECT payload FROM prepared').get().payload);
  const firstRead = r1.handle('getSettings', { slotEvent: 'getSettings' }, {}, 'first-read-1');
  check('recover.first-read-shows-settled-round', firstRead.recovery.roundId !== 'none', 'roundId=' + firstRead.recovery.roundId);
  const secondRead = r1.handle('getSettings', { slotEvent: 'getSettings' }, {}, 'first-read-2');
  check('recover.second-read-identical', JSON.stringify(firstRead.recovery) === JSON.stringify(secondRead.recovery));
  check('recover.first-read-exposes-stored-board', !!firstRead.recovery.result && !!firstRead.recovery.result.serverResponse.reelsSymbols, 'board=' + !!(firstRead.recovery.result && firstRead.recovery.result.serverResponse.reelsSymbols));
  // A recovered action is still pending a receipt until the restored client presents it.
  check('recover.rebuilt-action-awaits-receipt', firstRead.recovery.actionId === 'rec-1' && firstRead.recovery.receipt.acked === false,
    JSON.stringify({ actionId: firstRead.recovery.actionId, receipt: firstRead.recovery.receipt }));
  let canonicalRetry = null;
  try { canonicalRetry = r1.handle('bet', { slotLines: 10, slotBet: 0.1, slotEvent: 'bet' }, headersFor(1, 'none'), 'rec-1'); } catch (error) { canonicalRetry = error; }
  check('recover.canonical-retry-after-crash-settles', canonicalRetry && canonicalRetry.responseEvent === 'spin', canonicalRetry && canonicalRetry.message ? canonicalRetry.message : 'ok');
  const ledgerAfterRetry = r1.ledgerRows();
  check('recover.canonical-retry-no-second-debit', ledgerAfterRetry.filter((r) => r.kind === 'bet').length === 1, JSON.stringify(ledgerAfterRetry.map((r) => r.kind)));
  const r2 = createRuntime({ dir: RUN, dbName, rngFactory: () => { throw new Error('rng must not be called during recovery'); }, config: { startingBalanceCents: 100000 } });
  const snap = r2.snapshotOf();
  const ledger = r2.ledgerRows();
  check('recover.round-resumed-without-draw', snap.roundId !== 'none', 'roundId=' + snap.roundId);
  check('recover.exactly-one-debit', ledger.filter((r) => r.kind === 'bet').length === 1, JSON.stringify(ledger.map((r) => r.kind)));
  const preparedLeft = r2.db.prepare('SELECT COUNT(*) c FROM prepared').get().c;
  check('recover.prepared-cleared', preparedLeft === 0, 'prepared rows left=' + preparedLeft);
  const roundRow = r2.db.prepare('SELECT payload FROM rounds ORDER BY id DESC LIMIT 1').get();
  const stored = roundRow ? JSON.parse(roundRow.payload) : null;
  check('recover.same-stored-board', !!stored && JSON.stringify(stored.main.board) === JSON.stringify(preparedPayload.main.board));
  check('recover.replay-after-restart', !!r2.replayResponse('rec-1', { slotEvent: 'bet', slotBet: '0.10', slotLines: 10 }));
  check('recover.receipt-survives-restart', r2.receiptState().actionId === 'rec-1' && r2.receiptState().acked === false, JSON.stringify(r2.receiptState()));
  let conflict = null;
  try { r2.replayResponse('rec-1', { slotEvent: 'bet', slotBet: '0.20', slotLines: 10 }); } catch (error) { conflict = error; }
  check('recover.replay-conflict-after-restart', conflict && conflict.status === 409);
  r2.db.close();
}
recoverySuite();

// ---------- Part 2: HTTP protocol, guards, receipts, duplicates ----------
async function startTestServer({ port, db, outcome = '', seed = '' }) {
  const child = spawn(process.execPath, [join(HERE, 'test-entry.mjs')], {
    env: { ...process.env, LUCKY_TEST_PORT: String(port), LUCKY_TEST_DB: db, LUCKY_TEST_OUTCOME: outcome, LUCKY_TEST_SEED: seed },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errors = '';
  child.stderr.on('data', (d) => { errors += d; });
  const base = `http://127.0.0.1:${port}`;
  let cookie = '';
  let up = false;
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(base + '/');
      if (r.status === 200) {
        const raw = r.headers.getSetCookie ? r.headers.getSetCookie()[0] : r.headers.get('set-cookie');
        cookie = String(raw).split(';')[0];
        up = true;
        break;
      }
    } catch { /* retry */ }
    await sleep(100);
  }
  const post = async (body, id, extra = {}) => {
    const r = await fetch(`${base}/game/LuckyLadysCharmDX/server`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(id ? { 'X-Pilot-Request-ID': id } : {}), ...extra },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, json: text ? JSON.parse(text) : null, text };
  };
  return {
    base, cookie, post, up, errors: () => errors,
    snapshot: async () => (await fetch(base + '/__test/snapshot')).json(),
    read: async () => (await post({ slotEvent: 'getSettings' }, null)).json.recovery,
    setGambleSeed: async (gambleSeed) => (await fetch(base + '/__test/rng', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gambleSeed }),
    })).json(),
    stop: () => { try { child.kill(); } catch { /* already gone */ } },
    restart: async () => {
      try { child.kill(); } catch { /* ignore */ }
      await sleep(500);
      return startTestServer({ port, db, outcome, seed });
    },
  };
}

const ackAction = (S, actionId) => S.post({ slotEvent: 'ack', actionId }, nextId('ack'));
/** Runs one gameplay action and immediately acknowledges the result it produced. */
async function postAndAck(S, body, headers, prefix) {
  const r = await S.post(body, nextId(prefix), headers);
  const recovery = r.json && r.json.recovery;
  if (r.status === 200 && recovery && recovery.actionId && !(recovery.receipt && recovery.receipt.acked)) await ackAction(S, recovery.actionId);
  return r;
}

async function protocolSuite() {
  const port = 8767;
  const S = await startTestServer({ port, db: `http-test-${Date.now()}.sqlite`, outcome: 'bonus' });
  try {
    check('http.server-up', S.up, S.errors().slice(-300));
    const settings = await S.post({ slotEvent: 'getSettings' }, null);
    check('http.settings-config-present', settings.json.serverResponse.mathConfig && settings.json.serverResponse.mathConfig.rtpControlEnabled === true, JSON.stringify(settings.json.serverResponse.mathConfig));
    check('http.settings-lines-10', JSON.stringify(settings.json.serverResponse.gameLine) === '[10]');
    check('http.settings-no-future-leak', !('sequence' in (settings.json.recovery || {})));
    check('http.idle-has-no-pending-action', settings.json.recovery.actionId === null && settings.json.recovery.receipt.acked === true, JSON.stringify(settings.json.recovery.receipt));

    check('guard.missing-request-id-rejected', (await S.post(BET_BODY, null, headersFor(1, 'none'))).status === 400);
    check('guard.missing-version-rejected-on-initial-bet', (await S.post(BET_BODY, 'g-1')).status === 409);
    check('guard.wrong-version-rejected-on-initial-bet', (await S.post(BET_BODY, 'g-2', headersFor(9, 'none'))).status === 409);
    check('stake.ladder-enforced', (await S.post({ slotEvent: 'bet', slotBet: '0.03', slotLines: 10 }, 'g-3', headersFor(1, 'none'))).status === 409);
    check('stake.unsupported-lines-rejected', (await S.post({ slotEvent: 'bet', slotBet: '0.10', slotLines: 5 }, 'g-4', headersFor(1, 'none'))).status === 409);

    const before = await S.snapshot();
    const betId = nextId('http-bet');
    const bet = await S.post(BET_BODY, betId, headersFor(1, 'none'));
    check('http.bet-settled', bet.status === 200 && bet.json.responseEvent === 'spin', bet.json.responseEvent);
    check('http.bet-exposes-action-identity', bet.json.recovery.actionId === betId && bet.json.recovery.receipt.acked === false, JSON.stringify({ actionId: bet.json.recovery.actionId, receipt: bet.json.recovery.receipt }));
    const afterBet = await S.snapshot();
    check('http.bet-ledger-exact', afterBet.ledger.length - before.ledger.length === (bet.json.serverResponse.totalWin > 0 ? 2 : 1), JSON.stringify(afterBet.ledger.slice(-2).map((l) => l.kind)));

    // --- reads and exact replays remain safe while the receipt is outstanding ---
    const readWhilePending = await S.read();
    check('receipt.read-allowed-while-pending', readWhilePending.actionId === betId && readWhilePending.receipt.acked === false && readWhilePending.receipt.delivered === true,
      JSON.stringify(readWhilePending.receipt));
    const betReplay = await S.post(BET_BODY, betId, headersFor(1, 'none'));
    check('http.bet-duplicate-same-id-cached', betReplay.status === 200 && JSON.stringify(betReplay.json) === JSON.stringify(bet.json));
    const ledgerAfterReplay = await S.snapshot();
    check('http.bet-duplicate-no-new-ledger', ledgerAfterReplay.ledger.length === afterBet.ledger.length && ledgerAfterReplay.counters.outcomeGenerations === afterBet.counters.outcomeGenerations);
    const changedBody = await S.post({ slotEvent: 'bet', slotBet: '0.20', slotLines: 10 }, betId, headersFor(1, 'none'));
    check('http.same-id-changed-body-409', changedBody.status === 409, String(changedBody.status));
    const whitespace = await fetch(S.base + '/game/LuckyLadysCharmDX/server', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: S.cookie, 'X-Pilot-Request-ID': betId, 'X-Pilot-Version': '1', 'X-Pilot-Round': 'none' },
      body: '{ "slotEvent" : "bet", "slotBet" : "0.10", "slotLines" : 10 }',
    });
    const wsJson = whitespace.status === 200 ? await whitespace.json() : null;
    check('http.replay-canonical-whitespace-200', whitespace.status === 200 && JSON.stringify(wsJson) === JSON.stringify(bet.json), 'status=' + whitespace.status);
    const keyOrder = await fetch(S.base + '/game/LuckyLadysCharmDX/server', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: S.cookie, 'X-Pilot-Request-ID': betId, 'X-Pilot-Version': '1', 'X-Pilot-Round': 'none' },
      body: JSON.stringify({ slotLines: 10, slotBet: 0.1, slotEvent: 'bet' }),
    });
    check('http.replay-canonical-keyorder-numeric-200', keyOrder.status === 200, 'status=' + keyOrder.status);
    const semanticConflict = await fetch(S.base + '/game/LuckyLadysCharmDX/server', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: S.cookie, 'X-Pilot-Request-ID': betId, 'X-Pilot-Version': '1', 'X-Pilot-Round': 'none' },
      body: JSON.stringify({ slotEvent: 'bet', slotBet: '0.20', slotLines: 10 }),
    });
    check('http.replay-semantic-conflict-409', semanticConflict.status === 409, 'status=' + semanticConflict.status);

    // --- the next gameplay mutation is refused until this exact result is acknowledged ---
    const gateAttempt = await S.post(FS_BODY, nextId('gate'), headersFor(readWhilePending.version, readWhilePending.roundId));
    check('receipt.next-mutation-rejected-before-ack', gateAttempt.status === 409 && /acknowledged/i.test(String(gateAttempt.json.reason)),
      `${gateAttempt.status} ${JSON.stringify(gateAttempt.json)}`);
    const unknownAck = await ackAction(S, 'no-such-action');
    check('ack.unknown-id-is-harmless', unknownAck.status === 200 && unknownAck.json.accepted === false, JSON.stringify(unknownAck.json));
    const stateStillPending = await S.read();
    check('ack.unknown-id-does-not-release', stateStillPending.receipt.acked === false && (await S.post(FS_BODY, nextId('gate'), headersFor(stateStillPending.version, stateStillPending.roundId))).status === 409);
    const ack1 = await ackAction(S, betId);
    check('ack.exact-action-accepted', ack1.status === 200 && ack1.json.accepted === true, JSON.stringify(ack1.json));
    const ack2 = await ackAction(S, betId);
    check('ack.duplicate-is-idempotent', ack2.status === 200 && ack2.json.accepted === true, JSON.stringify(ack2.json));
    const ackedState = await S.read();
    check('ack.releases-exact-action', ackedState.actionId === betId && ackedState.receipt.acked === true, JSON.stringify(ackedState.receipt));

    // --- feature flow through the real HTTP route, one receipt per action ---
    let state = ackedState;
    check('http.feature-phase-active', state.phase === 'FREE_SPINS' && state.free.total === 15, `${state.phase} total=${state.free.total}`);
    const fsId = nextId('http-fs');
    const first = await S.post(FS_BODY, fsId, headersFor(state.version, state.roundId));
    check('http.freespin-progresses', first.json.recovery.free.current === 1, JSON.stringify(first.json.recovery.free));
    const fsLines = first.json.serverResponse.winLines;
    check('money.stepWin-includes-prior-bonus', fsLines.length === 0 || Math.abs(fsLines[fsLines.length - 1].stepWin - first.json.serverResponse.totalWin) < 0.001,
      'last stepWin=' + (fsLines.length ? fsLines[fsLines.length - 1].stepWin : 'n/a') + ' totalWin=' + first.json.serverResponse.totalWin);
    const staleFree = await S.post(FS_BODY, nextId('http-fs-stale'), headersFor(1, 'none'));
    check('http.freespin-stale-version-409', staleFree.status === 409, String(staleFree.status));
    const lockedBet = await S.post({ slotEvent: 'freespin', slotBet: '0.20', slotLines: 10 }, nextId('http-fs-locked'), headersFor(first.json.recovery.version, first.json.recovery.roundId));
    check('http.freespin-locked-stake-enforced', lockedBet.status === 409, String(lockedBet.status));
    const fsReplay = await S.post(FS_BODY, fsId, headersFor(state.version, state.roundId));
    check('http.freespin-duplicate-cached', JSON.stringify(fsReplay.json) === JSON.stringify(first.json));
    // stale receipt: an older action must not release the newer pending free spin
    const staleAck = await ackAction(S, betId);
    check('ack.stale-id-does-not-release-newer-action', staleAck.json.accepted === false, JSON.stringify(staleAck.json));
    const blockedByNewer = await S.post(FS_BODY, nextId('http-fs-blocked'), headersFor(first.json.recovery.version, first.json.recovery.roundId));
    check('ack.stale-does-not-open-next-action', blockedByNewer.status === 409, `${blockedByNewer.status} ${JSON.stringify(blockedByNewer.json)}`);
    await ackAction(S, fsId);

    // --- drive the feature to a settled phase ---
    for (let i = 0; i < 60; i++) {
      state = await S.read();
      if (state.phase !== 'FREE_SPINS') break;
      const r = await postAndAck(S, FS_BODY, headersFor(state.version, state.roundId), 'http-drive');
      if (r.status !== 200) { check('http.feature-drive-ok', false, `${r.status} ${JSON.stringify(r.json)}`); break; }
      state = r.json.recovery;
    }
    check('http.feature-completed', state.phase !== 'FREE_SPINS', state.phase);
    if (state.phase === 'PENDING_WIN' || state.phase === 'GAMBLE') {
      const entering = await postAndAck(S, { slotEvent: 'recoveryGamble' }, headersFor(state.version, state.roundId), 'gamble-enter');
      state = entering.json.recovery;
      check('http.gamble-entry', state.phase === 'GAMBLE', state.phase);
      const g1Body = { slotEvent: 'slotGamble', gambleChoice: 'red' };
      const g1Id = nextId('gamble-red');
      const g1 = await S.post(g1Body, g1Id, headersFor(state.version, state.roundId));
      check('http.gamble-red-settled', g1.json.responseEvent === 'gambleResult' && ['win', 'lose'].includes(g1.json.serverResponse.gambleState), JSON.stringify(g1.json.serverResponse));
      const dup = await S.post(g1Body, g1Id, headersFor(state.version, state.roundId));
      check('http.gamble-duplicate-cached', JSON.stringify(dup.json) === JSON.stringify(g1.json));
      await ackAction(S, g1Id);
      state = g1.json.recovery;
      if (state.phase === 'GAMBLE') {
        const g2 = await postAndAck(S, { slotEvent: 'slotGamble', gambleChoice: 'black' }, headersFor(state.version, state.roundId), 'gamble-black');
        check('http.gamble-black-settled', g2.json.responseEvent === 'gambleResult', g2.json.responseEvent);
        state = g2.json.recovery;
      }
      if (state.phase !== 'IDLE') {
        const collectId = nextId('collect');
        const collectBefore = await S.snapshot();
        const collect = await S.post({ slotEvent: 'recoveryCollect' }, collectId, headersFor(state.version, state.roundId));
        check('http.collect-settles-to-idle', collect.json.recovery.phase === 'IDLE', collect.json.recovery.phase);
        const collectAfter = await S.snapshot();
        check('http.collect-moves-no-money', JSON.stringify(collectBefore.ledger) === JSON.stringify(collectAfter.ledger) && collectBefore.balanceCents === collectAfter.balanceCents,
          `rows=${collectBefore.ledger.length}->${collectAfter.ledger.length} balance=${collectBefore.balanceCents}->${collectAfter.balanceCents}`);
        const collectDup = await S.post({ slotEvent: 'recoveryCollect' }, collectId, headersFor(state.version, state.roundId));
        check('http.collect-duplicate-cached', JSON.stringify(collectDup.json) === JSON.stringify(collect.json));
        await ackAction(S, collectId);
      } else {
        check('http.collect-not-required-after-loss', true, 'gamble loss settled to IDLE');
      }
    } else {
      check('http.gamble-path-not-reached', false, `phase=${state.phase}`);
    }

    // --- exact two simultaneous identical requests ---
    const idle = await S.read();
    check('concurrent.idle-round-ready', idle.phase === 'IDLE' && idle.receipt.acked === true, `${idle.phase} acked=${idle.receipt.acked}`);
    const beforeConcurrent = await S.snapshot();
    const ccId = nextId('concurrent');
    const ccHeaders = {
      'Content-Type': 'application/json', Cookie: S.cookie, 'X-Pilot-Request-ID': ccId,
      'X-Pilot-Version': String(idle.version), 'X-Pilot-Round': String(idle.roundId),
    };
    const ccBody = JSON.stringify(BET_BODY);
    const fire = () => fetch(S.base + '/game/LuckyLadysCharmDX/server', { method: 'POST', headers: ccHeaders, body: ccBody });
    const [r1, r2] = await Promise.all([fire(), fire()]);
    const [t1, t2] = await Promise.all([r1.text(), r2.text()]);
    const afterConcurrent = await S.snapshot();
    const betDelta = afterConcurrent.ledger.filter((l) => l.kind === 'bet').length - beforeConcurrent.ledger.filter((l) => l.kind === 'bet').length;
    probes.concurrent = {
      requestId: ccId, statuses: [r1.status, r2.status], identicalBytes: t1 === t2,
      betDebits: betDelta,
      acceptedActionExecutions: afterConcurrent.counters.actionExecutions - beforeConcurrent.counters.actionExecutions,
      completeOutcomeRngInvocations: afterConcurrent.counters.outcomeGenerations - beforeConcurrent.counters.outcomeGenerations,
      engineRngDraws: afterConcurrent.counters.engineRngDraws - beforeConcurrent.counters.engineRngDraws,
    };
    check('concurrent.exactly-two-requests-both-200', r1.status === 200 && r2.status === 200, JSON.stringify(probes.concurrent.statuses));
    check('concurrent.identical-original-json', t1 === t2 && JSON.parse(t1).responseEvent === 'spin', `identical=${t1 === t2}`);
    check('concurrent.one-bet-debit', betDelta === 1, `betDebits=${betDelta}`);
    check('concurrent.one-accepted-action-execution', probes.concurrent.acceptedActionExecutions === 1, JSON.stringify(probes.concurrent));
    check('concurrent.one-complete-outcome-generation', probes.concurrent.completeOutcomeRngInvocations === 1, JSON.stringify(probes.concurrent));
    // one complete outcome generation still samples the engine internally: 5 reels + any feature
    check('concurrent.engine-samples-not-a-single-int', probes.concurrent.engineRngDraws >= 5,
      `engineRngDraws=+${probes.concurrent.engineRngDraws} (one complete-outcome generation, not one integer)`);
    await ackAction(S, ccId);

    const readA = await S.post({ slotEvent: 'getSettings' }, 'same-read-id');
    const readB = await S.post({ slotEvent: 'getSettings' }, 'same-read-id');
    check('http.reads-not-cached-but-non-consuming', readA.status === 200 && readB.status === 200 && JSON.stringify(readA.json.recovery) === JSON.stringify(readB.json.recovery));

    const ledgerFinal = (await S.snapshot()).ledger;
    check('http.ledger-balance-reconciles', ledgerFinal.length > 0 && ledgerFinal[ledgerFinal.length - 1].after_balance === (await S.snapshot()).balanceCents,
      JSON.stringify({ last: ledgerFinal[ledgerFinal.length - 1], balance: (await S.snapshot()).balanceCents }));

    // restart persistence
    const beforeRestart = await S.snapshot();
    const S2 = await S.restart();
    const afterRestart = await S2.snapshot();
    check('http.restart-preserves-ledger-and-state', JSON.stringify(beforeRestart.ledger) === JSON.stringify(afterRestart.ledger) && JSON.stringify(beforeRestart.recovery) === JSON.stringify(afterRestart.recovery),
      `ledger=${beforeRestart.ledger.length}->${afterRestart.ledger.length}`);
    S2.stop();
  } finally {
    S.stop();
  }
}

// ---------- Part 3: actual HTTP retrigger replay (fixed test RNG seed) ----------
async function retriggerHttpSuite() {
  const port = 8770;
  const S = await startTestServer({ port, db: `rt-http-${Date.now()}.sqlite`, seed: 'rt-search-138824' });
  try {
    check('retrigger.server-up', S.up, S.errors().slice(-300));
    const idle = await S.read();
    const bet = await postAndAck(S, BET_BODY, headersFor(idle.version, idle.roundId), 'rt-bet');
    check('retrigger.http-trigger-awards-15', bet.json.recovery.phase === 'FREE_SPINS' && bet.json.recovery.free.total === 15, JSON.stringify(bet.json.recovery.free));
    let state = bet.json.recovery;
    let consumed = 0;
    let awards = 0;
    const capture = { beforeTotal: 15, afterTotal: null, requestId: null, headers: null, response: null };
    while (state.phase === 'FREE_SPINS' && consumed < 60) {
      const reqId = nextId('rt-fs');
      const hdrs = headersFor(state.version, state.roundId);
      const previousTotal = state.free.total;
      const r = await S.post(FS_BODY, reqId, hdrs);
      if (r.status !== 200) { check('retrigger.http-freespin-ok', false, `${r.status} ${JSON.stringify(r.json)}`); break; }
      state = r.json.recovery;
      consumed += 1;
      if (state.free.total !== previousTotal) {
        awards += 1;
        capture.beforeTotal = previousTotal;
        capture.afterTotal = state.free.total;
        capture.requestId = reqId;
        capture.headers = hdrs;
        capture.response = r.json;
      }
      await ackAction(S, state.actionId);
    }
    check('retrigger.http-adds-15-exactly-once', awards === 1 && capture.beforeTotal === 15 && capture.afterTotal === 30, `awards=${awards} ${capture.beforeTotal}->${capture.afterTotal}`);
    check('retrigger.http-consumes-exactly-30-spins', consumed === 30, 'consumed=' + consumed);
    check('retrigger.http-feature-settles', state.phase !== 'FREE_SPINS', state.phase);
    const liveBefore = await S.read();
    const beforeReplay = await S.snapshot();
    const replay = await S.post(FS_BODY, capture.requestId, capture.headers);
    const afterReplay = await S.snapshot();
    const liveAfter = await S.read();
    probes.retrigger = {
      requestId: capture.requestId, headers: capture.headers, beforeTotal: capture.beforeTotal, afterTotal: capture.afterTotal,
      consumed, finalTotal: liveAfter.free.total,
      replayStatus: replay.status, replayIdentical: replay.status === 200 && JSON.stringify(replay.json) === JSON.stringify(capture.response),
      ledgerUnchanged: JSON.stringify(beforeReplay.ledger) === JSON.stringify(afterReplay.ledger),
      countersUnchanged: beforeReplay.counters.actionExecutions === afterReplay.counters.actionExecutions
        && beforeReplay.counters.outcomeGenerations === afterReplay.counters.outcomeGenerations
        && beforeReplay.counters.engineRngDraws === afterReplay.counters.engineRngDraws,
      executionCounters: afterReplay.counters,
    };
    check('retrigger.replay-200-identical-json', replay.status === 200 && JSON.stringify(replay.json) === JSON.stringify(capture.response), `status=${replay.status}`);
    check('retrigger.replay-same-profile-and-round',
      replay.json.recovery.roundId === capture.response.recovery.roundId
      && JSON.stringify(replay.json.recovery.profile) === JSON.stringify(capture.response.recovery.profile),
      JSON.stringify(replay.json.recovery.profile));
    check('retrigger.replay-no-ledger-movement', JSON.stringify(beforeReplay.ledger) === JSON.stringify(afterReplay.ledger));
    check('retrigger.replay-no-extra-rng-or-execution', probes.retrigger.countersUnchanged, JSON.stringify(afterReplay.counters));
    check('retrigger.replay-advances-no-free-counter', JSON.stringify(liveBefore.free) === JSON.stringify(liveAfter.free), `${JSON.stringify(liveBefore.free)} vs ${JSON.stringify(liveAfter.free)}`);
    check('retrigger.live-state-kept-30', liveAfter.free.total === 30, JSON.stringify(liveAfter.free));
  } finally {
    S.stop();
  }
}

// ---------- Part 4: persisted credit proof (paid win, gamble win, collect) ----------
async function creditSuite() {
  const port = 8771;
  const winSeed = findGambleSeed('red', true);
  const S = await startTestServer({ port, db: `credit-${Date.now()}.sqlite`, outcome: 'win' });
  try {
    check('credit.server-up', S.up, S.errors().slice(-300));
    await S.setGambleSeed(winSeed);
    const idle = await S.read();
    const startBalance = (await S.snapshot()).balanceCents;
    const betId = nextId('credit-bet');
    const bet = await S.post(BET_BODY, betId, headersFor(idle.version, idle.roundId));
    const afterBet = await S.snapshot();
    const betRows = afterBet.ledger.filter((l) => l.kind === 'bet');
    const winRows = afterBet.ledger.filter((l) => l.kind === 'paid-win');
    const winCents = winRows.reduce((a, l) => a + l.delta, 0);
    check('credit.paid-win-settled', bet.json.responseEvent === 'spin' && bet.json.serverResponse.totalWin > 0 && bet.json.recovery.phase === 'PENDING_WIN',
      `${bet.json.responseEvent} totalWin=${bet.json.serverResponse.totalWin} phase=${bet.json.recovery.phase}`);
    check('credit.exactly-one-bet-debit', betRows.length === 1 && betRows[0].delta === -WAGER_CENTS, JSON.stringify(betRows));
    check('credit.exactly-one-paid-win-credit', winRows.length === 1 && winRows[0].delta === Math.round(bet.json.serverResponse.totalWin * 100),
      `rows=${winRows.length} delta=${winRows[0] && winRows[0].delta} expected=${Math.round(bet.json.serverResponse.totalWin * 100)}`);
    check('credit.balance-increased-once', afterBet.balanceCents === startBalance - WAGER_CENTS + winCents,
      `${startBalance} - ${WAGER_CENTS} + ${winCents} vs ${afterBet.balanceCents}`);
    check('credit.balance-is-post-debit-pre-win', Math.round(bet.json.serverResponse.Balance * 100) === startBalance - WAGER_CENTS,
      `Balance=${bet.json.serverResponse.Balance} expected=${(startBalance - WAGER_CENTS) / 100}`);
    check('credit.native-units-integer-cents', afterBet.ledger.every((l) => Number.isInteger(l.delta)) && afterBet.balanceCents === Math.round(bet.json.recovery.balance * 100),
      JSON.stringify(afterBet.ledger.map((l) => [l.kind, l.delta])));
    await ackAction(S, betId);

    const entering = await postAndAck(S, { slotEvent: 'recoveryGamble' }, headersFor(bet.json.recovery.version, bet.json.recovery.roundId), 'credit-enter');
    check('credit.gamble-entry', entering.json.recovery.phase === 'GAMBLE', entering.json.recovery.phase);
    const stakeCents = Math.round(entering.json.recovery.pendingWin * 100);
    const beforeGamble = await S.snapshot();
    const gambleId = nextId('credit-gamble');
    const gambleBody = { slotEvent: 'slotGamble', gambleChoice: 'red' };
    const gamble = await S.post(gambleBody, gambleId, headersFor(entering.json.recovery.version, entering.json.recovery.roundId));
    const afterGamble = await S.snapshot();
    const gambleWins = afterGamble.ledger.filter((l) => l.kind === 'gamble-win');
    check('credit.gamble-win-asserted', gamble.json.serverResponse.gambleState === 'win', `seed=${winSeed} state=${gamble.json.serverResponse.gambleState}`);
    check('credit.gamble-win-credits-once', gambleWins.length === 1 && gambleWins[0].delta === stakeCents, `rows=${gambleWins.length} delta=${gambleWins[0] && gambleWins[0].delta} stake=${stakeCents}`);
    check('credit.gamble-win-balance-delta', afterGamble.balanceCents - beforeGamble.balanceCents === stakeCents,
      `${beforeGamble.balanceCents} -> ${afterGamble.balanceCents} stake=${stakeCents}`);
    const gambleReplay = await S.post(gambleBody, gambleId, headersFor(entering.json.recovery.version, entering.json.recovery.roundId));
    const afterGambleReplay = await S.snapshot();
    check('credit.gamble-replay-identical', gambleReplay.status === 200 && JSON.stringify(gambleReplay.json) === JSON.stringify(gamble.json));
    check('credit.gamble-replay-adds-zero-credits', JSON.stringify(afterGamble.ledger) === JSON.stringify(afterGambleReplay.ledger) && afterGamble.balanceCents === afterGambleReplay.balanceCents);
    await ackAction(S, gambleId);

    const state = gamble.json.recovery;
    const collectId = nextId('credit-collect');
    const beforeCollect = await S.snapshot();
    const collect = await S.post({ slotEvent: 'recoveryCollect' }, collectId, headersFor(state.version, state.roundId));
    const afterCollect = await S.snapshot();
    check('credit.collect-settles-to-idle', collect.json.recovery.phase === 'IDLE' && collect.json.recovery.pendingWin === 0, JSON.stringify({ phase: collect.json.recovery.phase, pendingWin: collect.json.recovery.pendingWin }));
    check('credit.collect-adds-zero-credits', JSON.stringify(beforeCollect.ledger) === JSON.stringify(afterCollect.ledger) && beforeCollect.balanceCents === afterCollect.balanceCents,
      `rows=${beforeCollect.ledger.length}->${afterCollect.ledger.length}`);
    const collectReplay = await S.post({ slotEvent: 'recoveryCollect' }, collectId, headersFor(state.version, state.roundId));
    const afterCollectReplay = await S.snapshot();
    check('credit.collect-replay-returns-original-settlement', collectReplay.status === 200 && JSON.stringify(collectReplay.json) === JSON.stringify(collect.json));
    check('credit.collect-replay-adds-zero-credits', JSON.stringify(afterCollect.ledger) === JSON.stringify(afterCollectReplay.ledger) && afterCollect.balanceCents === afterCollectReplay.balanceCents);
    probes.credit = {
      gambleSeed: winSeed, wagerCents: WAGER_CENTS, paidWinCents: winCents, gambleStakeCents: stakeCents,
      paidWinRows: winRows.length, gambleWinRows: gambleWins.length,
      collectLedgerRows: [beforeCollect.ledger.length, afterCollect.ledger.length],
      finalBalanceCents: afterCollectReplay.balanceCents,
    };
  } finally {
    S.stop();
  }
}

// ---------- Part 5: deterministic gamble loss through the same paths ----------
async function gambleLossSuite() {
  const port = 8772;
  const loseSeed = findGambleSeed('red', false);
  const S = await startTestServer({ port, db: `loss-${Date.now()}.sqlite`, outcome: 'win' });
  try {
    check('loss.server-up', S.up, S.errors().slice(-300));
    await S.setGambleSeed(loseSeed);
    const idle = await S.read();
    const startBalance = (await S.snapshot()).balanceCents;
    const bet = await postAndAck(S, BET_BODY, headersFor(idle.version, idle.roundId), 'loss-bet');
    check('loss.pending-win-exists-before-gamble', bet.json.recovery.phase === 'PENDING_WIN' && bet.json.recovery.pendingWin > 0, JSON.stringify({ phase: bet.json.recovery.phase, pendingWin: bet.json.recovery.pendingWin }));
    const entering = await postAndAck(S, { slotEvent: 'recoveryGamble' }, headersFor(bet.json.recovery.version, bet.json.recovery.roundId), 'loss-enter');
    check('loss.gamble-entry', entering.json.recovery.phase === 'GAMBLE', entering.json.recovery.phase);
    const stakeCents = Math.round(entering.json.recovery.pendingWin * 100);
    const beforeLoss = await S.snapshot();
    const lossId = nextId('loss-gamble');
    const lossBody = { slotEvent: 'slotGamble', gambleChoice: 'red' };
    const lossHeaders = headersFor(entering.json.recovery.version, entering.json.recovery.roundId);
    const loss = await S.post(lossBody, lossId, lossHeaders);
    const afterLoss = await S.snapshot();
    const lossRows = afterLoss.ledger.filter((l) => l.kind === 'gamble-loss');
    const winRows = afterLoss.ledger.filter((l) => l.kind === 'gamble-win');
    check('loss.dealer-card-opposes-chosen-color', loss.json.serverResponse.gambleState === 'lose' && !['D', 'H'].includes(loss.json.serverResponse.dealerCard),
      `seed=${loseSeed} state=${loss.json.serverResponse.gambleState} card=${loss.json.serverResponse.dealerCard}`);
    check('loss.pending-win-zeroed', loss.json.recovery.pendingWin === 0, String(loss.json.recovery.pendingWin));
    check('loss.phase-returns-to-idle', loss.json.recovery.phase === 'IDLE', loss.json.recovery.phase);
    check('loss.exactly-one-loss-debit', lossRows.length === 1 && lossRows[0].delta === -stakeCents && winRows.length === 0,
      `loss=${lossRows.length} delta=${lossRows[0] && lossRows[0].delta} win=${winRows.length} stake=${stakeCents}`);
    check('loss.balance-settles-back-to-stake', afterLoss.balanceCents === startBalance - WAGER_CENTS,
      `${startBalance} - ${WAGER_CENTS} vs ${afterLoss.balanceCents}`);
    const replay = await S.post(lossBody, lossId, lossHeaders);
    const afterReplay = await S.snapshot();
    check('loss.replay-identical-and-inert', replay.status === 200 && JSON.stringify(replay.json) === JSON.stringify(loss.json)
      && JSON.stringify(afterLoss.ledger) === JSON.stringify(afterReplay.ledger)
      && afterReplay.counters.actionExecutions === afterLoss.counters.actionExecutions
      && afterReplay.counters.gambleRngDraws === afterLoss.counters.gambleRngDraws,
      `status=${replay.status} ledger=${afterLoss.ledger.length}->${afterReplay.ledger.length}`);
    await ackAction(S, lossId);
    const refreshed = await S.read();
    check('loss.refresh-state-correct', refreshed.phase === 'IDLE' && refreshed.pendingWin === 0 && refreshed.roundId === loss.json.recovery.roundId && refreshed.balance === loss.json.recovery.balance,
      JSON.stringify({ phase: refreshed.phase, pendingWin: refreshed.pendingWin, balance: refreshed.balance }));
    probes.gambleLoss = {
      gambleSeed: loseSeed, dealerCard: loss.json.serverResponse.dealerCard, gambleState: loss.json.serverResponse.gambleState,
      stakeCents, lossRows: lossRows.length, winRows: winRows.length,
      balanceBefore: beforeLoss.balanceCents, balanceAfter: afterLoss.balanceCents, balanceAfterRefresh: Math.round(refreshed.balance * 100),
    };
  } finally {
    S.stop();
  }
}

try {
  await protocolSuite();
  await retriggerHttpSuite();
  await creditSuite();
  await gambleLossSuite();
} catch (error) {
  check('http.suites-completed', false, String(error && error.stack).slice(0, 400));
}

mkdirSync(join(HERE, 'runs'), { recursive: true });
const failures = results.filter((r) => !r.ok);
writeFileSync(join(HERE, 'runs', 'runtime-tests.json'), JSON.stringify({
  phase: 'isolated runtime integration tests (receipts, concurrency, credit ledgers, HTTP retrigger, gamble loss)',
  pinned: { engineSha256: PINNED_ENGINE_SHA256, rulesSha256: PINNED_RULES_SHA256 },
  probes, results, failures: failures.map((f) => f.name),
}, null, 1) + '\n');
console.log(JSON.stringify({ checks: results.length, passed: results.length - failures.length, failures: failures.map((f) => `${f.name}: ${f.detail}`) }, null, 1));
process.exitCode = failures.length ? 1 : 0;
