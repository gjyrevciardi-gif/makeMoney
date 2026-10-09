// Runtime state machine: durable prepared outcomes, atomic settlement, native protocol money.
// Shared by the production entry (CSPRNG) and the test entry (injected RNG/hooks).
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadVerifiedMath, SUPPORTED_LINES, PROFILE_VERSION, NATIVE_STAKE_CENTS, FROZEN_PROFILE_HASH,
  generateCompleteRound, drawGamble, assertNativeStake, assertSupportedLines, freeSpinCount, freeSpinMultiplier,
} from './runtime-math.mjs';

const currency = (cents) => Math.round(cents) / 100;
const now = () => new Date().toISOString();

export function createRuntime({ dir, dbName, rngFactory, gambleRngFactory, hooks = {}, config = {}, counters = null }) {
  mkdirSync(dir, { recursive: true });
  // Test-only instrumentation object. The production entry never passes one, so counters stay
  // null there and no counting code runs.
  const meter = counters || null;
  const count = (key) => { if (meter) meter[key] = (meter[key] || 0) + 1; };
  /** Counts engine-level RNG samples; the evaluator draws 5 reels plus one per feature spin. */
  const meteredRng = (rng, bucket) => {
    if (!meter || !rng) return rng;
    return { int: (min, max) => { count(bucket); return rng.int(min, max); } };
  };
  const { rules, profile, hashes } = loadVerifiedMath();
  const db = new DatabaseSync(join(dir, dbName));
  db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS account(id INTEGER PRIMARY KEY, balance_cents INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rounds(id INTEGER PRIMARY KEY AUTOINCREMENT, round_id TEXT UNIQUE, profile_id TEXT,
  profile_hash TEXT, profile_version INTEGER, engine_sha256 TEXT, bet INTEGER, lines INTEGER, phase TEXT,
  version INTEGER, payload TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS ledger(id INTEGER PRIMARY KEY AUTOINCREMENT, round_id TEXT, request_id TEXT, kind TEXT,
  delta INTEGER, before_balance INTEGER, after_balance INTEGER, created_at TEXT);
CREATE TABLE IF NOT EXISTS responses(id TEXT PRIMARY KEY, body TEXT, response TEXT);
CREATE TABLE IF NOT EXISTS prepared(request_id TEXT PRIMARY KEY, kind TEXT, body TEXT, payload TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS acks(action_id TEXT PRIMARY KEY, round_id TEXT, received_at TEXT);`);
  const addColumn = (table, column, type) => {
    const cols = db.prepare('PRAGMA table_info(' + table + ')').all().map((c) => c.name);
    if (!cols.includes(column)) db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + type);
  };
  addColumn('account', 'player_id', 'TEXT');
  addColumn('responses', 'canonical', 'TEXT');
  addColumn('prepared', 'canonical', 'TEXT');
  addColumn('responses', 'delivered_at', 'TEXT');
  addColumn('responses', 'event', 'TEXT');
  addColumn('responses', 'acked_at', 'TEXT');
  if (!db.prepare('SELECT 1 FROM account WHERE id=1').get()) {
    db.prepare('INSERT INTO account(id,balance_cents,player_id) VALUES(1,?,?)').run(Number(config.startingBalanceCents || 100000), 'player-1');
  }

  const playerId = () => db.prepare('SELECT player_id FROM account WHERE id=1').get().player_id;
  const scope = () => playerId();
  /** Prepared rows may arrive already scoped (reconciliation) or unscoped (fresh request). */
  const scopedKey = (id) => (String(id).startsWith(scope() + ':') ? String(id) : scope() + ':' + id);
  const unscopedKey = (id) => (String(id).startsWith(scope() + ':') ? String(id).slice(scope().length + 1) : String(id));

  /** Canonical semantics of a validated action; every replay decision uses it. */
  function canonicalAction(body) {
    const event = body && body.slotEvent;
    const action = { event: event, player: scope() };
    if (event === 'bet' || event === 'freespin') {
      action.stakeCents = Math.round(Number(body.slotBet) * 100);
      action.lines = Number(body.slotLines);
    }
    if (event === 'slotGamble') action.choice = String(body.gambleChoice || '').toLowerCase();
    return JSON.stringify(action, Object.keys(action).sort());
  }

  /** Durable replay: scoped to the authenticated player and request id, compared semantically. */
  function replayResponse(requestId, body) {
    const key = scopedKey(requestId);
    const row = db.prepare('SELECT canonical,response FROM responses WHERE id=?').get(key);
    if (!row) return null;
    if (row.canonical !== canonicalAction(body)) {
      throw Object.assign(new Error('request id reused with different action semantics'), { status: 409 });
    }
    return row.response;
  }

  function bookResponse(requestId, body, response) {
    const key = scopedKey(requestId);
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
    db.prepare('INSERT OR REPLACE INTO responses(id,body,response,canonical,delivered_at,event,acked_at) VALUES(?,?,?,?,NULL,?,NULL)')
      .run(key, typeof body === 'string' ? body : JSON.stringify(body), JSON.stringify(response),
        canonicalAction(parsed), parsed && parsed.slotEvent ? String(parsed.slotEvent) : null);
  }

  const markDelivered = (requestId) => db.prepare('UPDATE responses SET delivered_at=? WHERE id=?').run(now(), scopedKey(requestId));

  /**
   * Latest authoritative action. Its presentation receipt gates the NEXT gameplay mutation:
   * financial settlement may already be durable, but a new action may not execute until the
   * client acknowledges that it presented this exact result.
   */
  const latestAction = () => db.prepare(
    'SELECT id,event,delivered_at,acked_at FROM responses WHERE event IS NOT NULL ORDER BY rowid DESC LIMIT 1').get() || null;

  /** Receipt state of the latest authoritative action, as exposed to a recovering client. */
  function receiptState() {
    const row = latestAction();
    if (!row) return { actionId: null, event: null, delivered: false, acked: true };
    return { actionId: unscopedKey(row.id), event: row.event, delivered: !!row.delivered_at, acked: !!row.acked_at };
  }

  /** Receipt view for the action currently being delivered in this very response. */
  const deliveringView = (requestId, event) => ({ actionId: unscopedKey(requestId), event, delivered: false, acked: false });

  const balanceCents = () => db.prepare('SELECT balance_cents FROM account WHERE id=1').get().balance_cents;
  const ledgerRows = () => db.prepare('SELECT * FROM ledger ORDER BY id').all();
  /** A restored round must belong to the maths currently loaded. */
  function verifyRound(row) {
    if (!row) return row;
    if (row.profile_id !== profile.id || row.profile_hash !== profile.canonicalHash
      || row.profile_version !== PROFILE_VERSION || row.engine_sha256 !== hashes.engineSha256) {
      throw Object.assign(new Error('saved round maths identity does not match the loaded evaluator/profile'), { status: 409 });
    }
    return row;
  }

  const currentRound = () => db.prepare("SELECT * FROM rounds WHERE phase!='IDLE' ORDER BY id DESC LIMIT 1").get()
    || db.prepare('SELECT * FROM rounds ORDER BY id DESC LIMIT 1').get();

  function ledgerMove(roundId, requestId, kind, delta) {
    const before = balanceCents();
    const after = before + delta;
    if (after < 0) throw Object.assign(new Error('accounting refused a negative balance'), { status: 409 });
    db.prepare('UPDATE account SET balance_cents=? WHERE id=1').run(after);
    db.prepare('INSERT INTO ledger(round_id,request_id,kind,delta,before_balance,after_balance,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(roundId, requestId, kind, delta, before, after, now());
    return { before, after };
  }

  function nativeWinLines(board, lineWins, priorBonusCents = 0) {
    let running = priorBonusCents;
    return lineWins.map((l) => {
      const rows = rules.lines[l.line];
      running += l.win;
      const entry = { Count: l.count, Line: l.line, Win: currency(l.win), stepWin: currency(running) };
      for (let r = 0; r < 5; r++) {
        if (r < l.count) {
          const symbol = board[`reel${r + 1}`][rows[r] - 1];
          entry[`winReel${r + 1}`] = [rows[r] - 1, rules.wild.includes(symbol) && symbol !== l.symbol ? 'P_1_WILD' : symbol];
        } else {
          entry[`winReel${r + 1}`] = ['none', 'none'];
        }
      }
      return entry;
    });
  }

  function nativeSpin(board, spin, { isFree, bet, lines, priorBonusCents = 0 }) {
    const bonusInfo = {
      scattersType: spin.scatterCount >= 3 ? 'bonus' : (spin.scatterWin > 0 ? 'win' : 'none'),
      scattersWin: currency(spin.scatterWin),
    };
    for (let r = 1; r <= 5; r++) {
      for (let p = 0; p <= 2; p++) {
        if (board[`reel${r}`][p] === rules.scatter) bonusInfo[`winReel${r}`] = [p, 'SCAT'];
      }
    }
    return {
      reelsSymbols: { reel1: board.reel1, reel2: board.reel2, reel3: board.reel3, reel4: board.reel4, reel5: board.reel5, rp: board.rp },
      winLines: nativeWinLines(board, spin.lineWins, priorBonusCents),
      bonusInfo,
      winCents: spin.totalWin,
      multiplier: isFree ? freeSpinMultiplier() : 1,
    };
  }

  function snapshot(row, payload, delivery = null) {
    const receipt = delivery || receiptState();
    const receiptView = { event: receipt.actionId ? receipt.event : null, delivered: !!receipt.delivered, acked: !!receipt.acked };
    if (!row) {
      return {
        version: 1, roundId: 'none', phase: 'IDLE', balance: currency(balanceCents()), bet: null, result: null,
        pendingWin: 0, free: { total: 0, current: 0, remaining: 0, multiplier: 1 },
        gamble: { attempts: 0, cards: [] }, settlement: { collected: true },
        profile: { id: profile.id, hash: profile.canonicalHash, version: PROFILE_VERSION },
        actionId: receipt.actionId, receipt: receiptView,
      };
    }
    return {
      version: row.version, roundId: row.round_id, phase: row.phase, balance: currency(balanceCents()),
      bet: { slotBet: currency(row.bet), slotLines: row.lines },
      result: payload.result || null,
      pendingWin: currency(payload.pendingWin || 0),
      free: {
        total: payload.freeTotal || 0, current: payload.fsIndex || 0,
        remaining: Math.max(0, (payload.freeTotal || 0) - (payload.fsIndex || 0)),
        multiplier: payload.freeMultiplier || 1,
      },
      gamble: payload.gamble || { attempts: 0, cards: [] },
      settlement: payload.settlement || { collected: true },
      profile: { id: row.profile_id, hash: row.profile_hash, version: row.profile_version },
      actionId: receipt.actionId, receipt: receiptView,
    };
  }

  function expectedGuard(row) {
    return row ? { version: String(row.version), round: row.round_id } : { version: '1', round: 'none' };
  }

  function guard(event, headers, row) {
    // Reads and presentation receipts never advance state and stay harmless when stale.
    if (event === 'getSettings' || event === 'update' || event === 'ack') return;
    const expected = expectedGuard(row);
    const version = headers['x-pilot-version'];
    const round = headers['x-pilot-round'];
    if (version === undefined || round === undefined) {
      throw Object.assign(new Error('round guard headers required'), { status: 409 });
    }
    if (String(version) !== expected.version || String(round) !== expected.round) {
      throw Object.assign(new Error('stale round or version'), { status: 409 });
    }
  }

  /** A prepared outcome blocks other mutations until its own request settles it. */
  function pendingPrepared(requestId) {
    const row = db.prepare('SELECT request_id FROM prepared LIMIT 1').get();
    if (row && row.request_id !== requestId) {
      throw Object.assign(new Error('a prepared settlement is pending for another request'), { status: 409 });
    }
    return row || null;
  }

  /**
   * Presentation gate. A new gameplay mutation is refused until the previous authoritative
   * result has been acknowledged by the client that rendered it. Replays and reads bypass it.
   */
  function requireReceipt() {
    const row = latestAction();
    if (row && !row.acked_at) {
      throw Object.assign(new Error('previous action not acknowledged'), { status: 409, code: 'ACK_REQUIRED' });
    }
  }

  function begin() { db.exec('BEGIN IMMEDIATE'); }
  function commit() { db.exec('COMMIT'); }
  function rollback() { try { db.exec('ROLLBACK'); } catch { /* already rolled back */ } }

  function handle(event, body, headers, requestId, rawBody) {
    // 1) durable replay first: an identical action returns its stored response and never
    //    reaches the round guards; different semantics under the same key is a 409.
    if (event !== 'getSettings' && event !== 'update') {
      const replayed = replayResponse(requestId, body);
      if (replayed) return JSON.parse(replayed);
    }
    // 2) reconcile durable prepared actions before any authoritative state is read,
    //    so the very first refresh already reports the settled round.
    reconcilePrepared();
    // 3) the reconciliation above may just have settled THIS action; if so, its response is
    //    now durable and the caller is served the original result instead of a guard conflict.
    if (event !== 'getSettings' && event !== 'update') {
      const settledNow = replayResponse(requestId, body);
      if (settledNow) return JSON.parse(settledNow);
    }
    const row = verifyRound(currentRound());
    if (event === 'getSettings') {
      return { responseEvent: 'getSettings', slotLanguage: readLanguage(), serverResponse: nativeSettings(), recovery: snapshot(row, row ? JSON.parse(row.payload) : null) };
    }
    if (event === 'update') {
      return { responseEvent: 'error', responseType: 'update', serverResponse: String(currency(balanceCents())), recovery: snapshot(row, row ? JSON.parse(row.payload) : null) };
    }
    guard(event, headers, row);
    // Presentation receipts are recorded, never executed; every other gameplay event has to
    // wait for the previous result to be acknowledged before it may advance state.
    if (event === 'ack') return settleAck(body, requestId);
    requireReceipt();
    pendingPrepared(requestId);

    if (event === 'bet') return settledBet(body, requestId, row, rawBody);
    if (event === 'freespin') return settledFreeSpin(body, requestId);
    if (event === 'slotGamble') return settledGamble(body, requestId, rawBody);
    if (event === 'recoveryGamble' || event === 'recoveryCollect') return settledRecovery(event, requestId);
    throw Object.assign(new Error('unsupported event'), { status: 400 });
  }

  function settledBet(body, requestId, row, rawBody) {
    const identity = typeof rawBody === 'string' ? rawBody : JSON.stringify(body);
    if (row && row.phase !== 'IDLE') {
      return { responseEvent: 'recoveryConflict', reason: 'complete the current feature first', recovery: snapshot(row, JSON.parse(row.payload)) };
    }
    const rawStake = Number(body.slotBet) * 100;
    if (!Number.isFinite(rawStake) || !Number.isInteger(rawStake)) {
      throw Object.assign(new Error('unsupported stake precision; use native cent values'), { status: 409 });
    }
    const bet = rawStake;
    const lines = Number(body.slotLines);
    assertNativeStake(bet);
    assertSupportedLines(lines);
    const wager = bet * lines;
    if (balanceCents() < wager) throw Object.assign(new Error('insufficient balance'), { status: 409 });

    let prepared = db.prepare('SELECT body,payload,canonical FROM prepared WHERE request_id=?').get(scopedKey(requestId));
    if (prepared && prepared.canonical !== canonicalAction(body)) {
      throw Object.assign(new Error('request id reused with different action semantics'), { status: 409 });
    }
    if (!prepared) {
      count('outcomeGenerations');
      const { round } = generateCompleteRound({ rng: meteredRng(rngFactory(), 'engineRngDraws'), bet, lines });
      const roundId = randomBytes(16).toString('hex');
      const payload = {
        bet, lines, roundId,
        main: { board: round.board, lineWins: round.mainEval.lineWins, scatterCount: round.mainEval.scatterCount, scatterWin: round.mainEval.scatterWin, win: round.mainEval.totalWin },
        sequence: round.feature.sequence.map((s) => ({ board: s.board, lineWins: s.lineWins, scatterCount: s.scatterCount, scatterWin: s.scatterWin, spinWin: s.spinWin, retriggered: s.retriggered })),
        fsIndex: 0,
        freeTotal: round.feature.spins > 0 ? freeSpinCount() : 0,
        freeMultiplier: freeSpinMultiplier(),
        bonusWin: round.mainEval.totalWin,
        pendingWin: round.mainEval.totalWin,
        freeBalance: 0,
        gamble: { attempts: 0, cards: [] },
        settlement: { collected: round.mainEval.totalWin === 0 && round.feature.spins === 0 },
        result: null,
        engineSha256: hashes.engineSha256,
        profileHash: profile.canonicalHash,
        plannedFeatureSpins: round.feature.spins,
      };
      begin();
      try {
        db.prepare('INSERT INTO prepared(request_id,kind,body,payload,canonical,created_at) VALUES(?,?,?,?,?,?)')
          .run(scope() + ':' + requestId, 'bet', identity, JSON.stringify(payload), canonicalAction(body), now());
        commit();
      } catch (error) { rollback(); throw error; }
      if (hooks.afterOutcomePersisted) hooks.afterOutcomePersisted({ requestId, payload });
      prepared = { body: identity, payload: JSON.stringify(payload), canonical: canonicalAction(body) };
    }
    const payload = JSON.parse(prepared.payload);

    count('actionExecutions');
    begin();
    try {
      const debit = ledgerMove(payload.roundId, requestId, 'bet', -wager);
      if (hooks.afterDebitBeforeCredit) hooks.afterDebitBeforeCredit({ requestId, payload });
      if (payload.main.win > 0) ledgerMove(payload.roundId, requestId, 'paid-win', payload.main.win);
      payload.freeBalance = debit.after;
      const phase = payload.freeTotal > 0 ? 'FREE_SPINS' : (payload.pendingWin > 0 ? 'PENDING_WIN' : 'IDLE');
      const spin = nativeSpin(payload.main.board, payload.main, { isFree: false, bet, lines, priorBonusCents: 0 });
      const response = {
        responseEvent: 'spin', responseType: 'bet',
        serverResponse: {
          totalFreeGames: payload.freeTotal, currentFreeGames: 0, Balance: currency(debit.after),
          afterBalance: currency(balanceCents()), totalWin: currency(payload.main.win),
          winLines: spin.winLines, bonusInfo: spin.bonusInfo, Jackpots: {}, reelsSymbols: spin.reelsSymbols,
        },
      };
      payload.result = { responseEvent: 'spin', responseType: 'bet', serverResponse: response.serverResponse };
      db.prepare('INSERT INTO rounds(round_id,profile_id,profile_hash,profile_version,engine_sha256,bet,lines,phase,version,payload,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(payload.roundId, profile.id, profile.canonicalHash, PROFILE_VERSION, hashes.engineSha256, bet, lines, phase, 1, JSON.stringify(payload), now());
      const full = {
        ...response,
        recovery: snapshot(
          { round_id: payload.roundId, version: 1, phase, profile_id: profile.id, profile_hash: profile.canonicalHash, profile_version: PROFILE_VERSION, bet, lines },
          payload, deliveringView(requestId, 'bet')),
      };
      bookResponse(requestId, identity, full);
      const savedResponse = replayResponse(requestId, body);
      db.prepare('DELETE FROM prepared WHERE request_id=?').run(requestId);
      if (hooks.afterSettlement) hooks.afterSettlement({ requestId, payload });
      commit();
      return JSON.parse(savedResponse);
    } catch (error) { rollback(); throw error; }
  }

  function settledFreeSpin(body, requestId) {
    const row = db.prepare("SELECT * FROM rounds WHERE phase='FREE_SPINS' ORDER BY id DESC LIMIT 1").get();
    if (!row) throw Object.assign(new Error('no active free spin'), { status: 409 });
    verifyRound(row);
    const payload = JSON.parse(row.payload);
    if (Number(body.slotLines) !== row.lines || Math.round(Number(body.slotBet) * 100) !== row.bet) {
      throw Object.assign(new Error('free-spin bet is locked'), { status: 409 });
    }
    const next = payload.sequence[payload.fsIndex];
    if (!next) throw Object.assign(new Error('free-spin sequence exhausted'), { status: 409 });
    count('actionExecutions');
    begin();
    try {
      const spin = nativeSpin(next.board, next, { isFree: true, bet: row.bet, lines: row.lines, priorBonusCents: payload.bonusWin });
      if (next.spinWin > 0) ledgerMove(row.round_id, requestId, 'feature-win', next.spinWin);
      payload.fsIndex += 1;
      if (next.retriggered) payload.freeTotal += freeSpinCount();
      payload.bonusWin += next.spinWin;
      payload.pendingWin = payload.bonusWin;
      const finished = payload.fsIndex >= payload.freeTotal;
      const phase = finished ? (payload.pendingWin > 0 ? 'PENDING_WIN' : 'IDLE') : 'FREE_SPINS';
      if (phase === 'IDLE') payload.settlement = { collected: true };
      const response = {
        responseEvent: 'spin', responseType: 'freespin',
        serverResponse: {
          totalFreeGames: payload.freeTotal, currentFreeGames: payload.fsIndex,
          Balance: currency(payload.freeBalance), afterBalance: currency(balanceCents()),
          totalWin: currency(payload.bonusWin), winLines: spin.winLines, bonusInfo: spin.bonusInfo,
          Jackpots: {}, reelsSymbols: spin.reelsSymbols,
        },
      };
      payload.result = { responseEvent: 'spin', responseType: 'freespin', serverResponse: response.serverResponse };
      db.prepare('UPDATE rounds SET phase=?, version=?, payload=? WHERE round_id=?')
        .run(phase, row.version + 1, JSON.stringify(payload), row.round_id);
      const full = { ...response, recovery: snapshot({ ...row, version: row.version + 1, phase }, payload, deliveringView(requestId, 'freespin')) };
      bookResponse(requestId, body, full);
      const saved = replayResponse(requestId, body);
      commit();
      return JSON.parse(saved);
    } catch (error) { rollback(); throw error; }
  }

  function settledGamble(body, requestId, rawBody) {
    const identity = typeof rawBody === 'string' ? rawBody : JSON.stringify(body);
    const row = db.prepare("SELECT * FROM rounds WHERE phase IN ('PENDING_WIN','GAMBLE') ORDER BY id DESC LIMIT 1").get();
    if (!row) throw Object.assign(new Error('nothing to gamble'), { status: 409 });
    verifyRound(row);
    const payload = JSON.parse(row.payload);
    if (!['red', 'black'].includes(body.gambleChoice)) throw Object.assign(new Error('invalid gamble choice'), { status: 409 });

    let prepared = db.prepare('SELECT body,payload,canonical FROM prepared WHERE request_id=?').get(scopedKey(requestId));
    if (prepared && prepared.canonical !== canonicalAction(body)) {
      throw Object.assign(new Error('request id reused with different action semantics'), { status: 409 });
    }
    if (!prepared) {
      count('gambleGenerations');
      const draw = drawGamble({ rng: meteredRng((gambleRngFactory || rngFactory)(), 'gambleRngDraws'), choice: body.gambleChoice });
      begin();
      try {
        db.prepare('INSERT INTO prepared(request_id,kind,body,payload,canonical,created_at) VALUES(?,?,?,?,?,?)')
          .run(scope() + ':' + requestId, 'gamble', identity, JSON.stringify(draw), canonicalAction(body), now());
        commit();
      } catch (error) { rollback(); throw error; }
      if (hooks.afterOutcomePersisted) hooks.afterOutcomePersisted({ requestId, payload: draw });
      prepared = { body: identity, payload: JSON.stringify(draw), canonical: canonicalAction(body) };
    }
    const draw = JSON.parse(prepared.payload);
    const stake = payload.pendingWin;
    count('actionExecutions');
    begin();
    try {
      const preGamble = balanceCents();
      if (draw.win) { ledgerMove(row.round_id, requestId, 'gamble-win', stake); payload.pendingWin = stake * 2; }
      else { ledgerMove(row.round_id, requestId, 'gamble-loss', -stake); payload.pendingWin = 0; }
      payload.gamble.attempts += 1;
      payload.gamble.cards.push(draw.dealerCard);
      const phase = payload.pendingWin > 0 ? 'GAMBLE' : 'IDLE';
      if (phase === 'IDLE') payload.settlement = { collected: true };
      const response = {
        responseEvent: 'gambleResult',
        serverResponse: {
          dealerCard: draw.dealerCard, gambleState: draw.win ? 'win' : 'lose',
          totalWin: currency(payload.pendingWin), afterBalance: currency(balanceCents()), Balance: currency(preGamble),
        },
      };
      db.prepare('UPDATE rounds SET phase=?, version=?, payload=? WHERE round_id=?')
        .run(phase, row.version + 1, JSON.stringify(payload), row.round_id);
      const full = { ...response, recovery: snapshot({ ...row, version: row.version + 1, phase }, payload, deliveringView(requestId, 'slotGamble')) };
      bookResponse(requestId, body, full);
      const saved = replayResponse(requestId, body);
      db.prepare('DELETE FROM prepared WHERE request_id=?').run(requestId);
      commit();
      return JSON.parse(saved);
    } catch (error) { rollback(); throw error; }
  }

  function settledRecovery(event, requestId) {
    const row = db.prepare("SELECT * FROM rounds WHERE phase!='IDLE' ORDER BY id DESC LIMIT 1").get()
      || db.prepare('SELECT * FROM rounds ORDER BY id DESC LIMIT 1').get();
    if (!row) throw Object.assign(new Error('no round'), { status: 409 });
    verifyRound(row);
    const payload = JSON.parse(row.payload);
    count('actionExecutions');
    begin();
    try {
      let phase = row.phase;
      if (event === 'recoveryGamble') {
        if (phase !== 'PENDING_WIN' || !payload.pendingWin) throw Object.assign(new Error('no pending gamble stake'), { status: 409 });
        phase = 'GAMBLE';
      } else {
        if (!['PENDING_WIN', 'GAMBLE'].includes(phase)) throw Object.assign(new Error('nothing to collect'), { status: 409 });
        phase = 'IDLE'; payload.pendingWin = 0; payload.settlement = { collected: true };
      }
      db.prepare('UPDATE rounds SET phase=?, version=?, payload=? WHERE round_id=?')
        .run(phase, row.version + 1, JSON.stringify(payload), row.round_id);
      const full = { responseEvent: 'recoveryAck', recovery: snapshot({ ...row, version: row.version + 1, phase }, payload, deliveringView(requestId, event)) };
      bookResponse(requestId, { slotEvent: event }, full);
      const saved = replayResponse(requestId, { slotEvent: event });
      commit();
      return JSON.parse(saved);
    } catch (error) { rollback(); throw error; }
  }

  /**
   * Client receipt acknowledgement. Presentation evidence only: it settles nothing, moves no
   * money and never advances a feature. An acknowledgement must name the exact authoritative
   * action; a stale id cannot release a newer pending result. Duplicates are idempotent.
   */
  function settleAck(body, requestId) {
    const actionId = String(body.actionId || '');
    if (!actionId) return { responseEvent: 'ack', actionId: null, accepted: false, reason: 'missing action id' };
    const key = scopedKey(actionId);
    const row = db.prepare('SELECT id FROM responses WHERE id=?').get(key);
    if (!row) return { responseEvent: 'ack', actionId: actionId, accepted: false, reason: 'unknown action' };
    const latest = latestAction();
    if (!latest || latest.id !== key) {
      // A stale receipt is harmless, but it must never release the newer pending action.
      return { responseEvent: 'ack', actionId: actionId, accepted: false, reason: 'stale action; a newer result is pending' };
    }
    begin();
    try {
      db.prepare('INSERT OR IGNORE INTO acks(action_id,round_id,received_at) VALUES(?,?,?)').run(key, null, now());
      db.prepare('UPDATE responses SET acked_at=? WHERE id=? AND acked_at IS NULL').run(now(), key);
      commit();
    } catch (error) { rollback(); throw error; }
    return { responseEvent: 'ack', actionId: actionId, accepted: true };
  }

  /**
   * Reconciles durable prepared actions without drawing: the stored outcome is settled exactly
   * once (journal + ledger + response cache) before any authoritative state is served.
   */
  function reconcilePrepared() {
    const rows = db.prepare('SELECT request_id,kind,body FROM prepared ORDER BY request_id').all();
    for (const row of rows) {
      const body = JSON.parse(row.body);
      const preparedId = row.request_id;
      if (replayResponse(preparedId, body)) {
        begin();
        try { db.prepare('DELETE FROM prepared WHERE request_id=?').run(preparedId); commit(); } catch (e) { rollback(); }
        continue;
      }
      // Settle the STORED outcome: settledBet/settledGamble find the prepared row and never draw.
      if (row.kind === 'bet') settledBet(body, preparedId, null, row.body);
      else settledGamble(body, preparedId, row.body);
    }
  }

  // Reconcile durable prepared actions before serving any authoritative state.
  reconcilePrepared();
  function readLanguage() {
    const path = join(dir, 'language.json');
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  }
  function nativeSettings() {
    const settings = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
    settings.Line = [SUPPORTED_LINES];
    settings.gameLine = [SUPPORTED_LINES];
    settings.mathConfig = {
      gameId: profile.game, rtpControlEnabled: true, targetRtpPercent: profile.targetRtpPercent,
      activeMathProfile: profile.id, profileHash: profile.canonicalHash,
    };
    return settings;
  }

  return {
    handle, db, balanceCents, ledgerRows, replayResponse, markDelivered, reconcilePrepared,
    snapshotOf: () => snapshot(currentRound(), currentRound() ? JSON.parse(currentRound().payload) : null),
    receiptState, latestAction, nativeSettings, counters: meter,
    config: { ...config, hashes },
  };
}
