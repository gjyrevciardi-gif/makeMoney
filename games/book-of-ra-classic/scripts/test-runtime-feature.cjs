// Focused feature acceptance: real source engine/adapter, in-memory storage only.
// No database, server, generator, bankroll, or Math Control operations are run.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
require.extensions['.ts'] = (module, filename) => {
  assert.ok(filename.startsWith(root + path.sep), 'load only this worktree source');
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename);
};
require('reflect-metadata');
const gameDir = path.join(root, 'backend/src/casino/games/book-of-ra-classic');
const { ClassicAdapter } = require(path.join(gameDir, 'classic.adapter.ts'));
const { playRound, evaluate, boardAt, RULES } = require(path.join(gameDir, 'classic.engine.ts'));
const { createSimulationRng } = require(path.join(root, 'backend/src/casino/platform/math-control/math-control.random.ts'));
const profile = JSON.parse(fs.readFileSync(path.join(gameDir, 'math/rtp50-maxwin50.json'))).payload;
const seeded = seed => { const r = createSimulationRng(seed); return n => r.int(0, n - 1); };
const clone = structuredClone;

function harness(seed) {
  let round = null, balance = 100000n, draws = 0, debits = 0, request = 0;
  const prepared = new Map();
  const rng = seeded(seed);
  const tx = { wallet: { findUnique: async () => ({ id: 'fixture-wallet', balance }) },
    auditLog: { create: async () => ({}) } };
  // Persistence is a test double; feature transitions and protocol use production code.
  const platform = {
    capabilities: {},
    wallet: { balance: async () => balance, balancePoints: async () => Number(balance),
      debit: async (_, p) => { balance -= p.amount; debits++; },
      credit: async () => { throw Error('feature must not collect implicitly'); } },
    rounds: {
      currentRoundIn: async () => clone(round),
      createRound: async (_, p) => { round = { id: p.id, settledAt: null, privateState: clone(p.privateState) }; return clone(round); },
      persistRound: async (_, row, p) => { assert.equal(row.id, round.id); round = { ...round, ...clone(p) }; },
    },
    journal: {
      serialized: async (_, user, fn) => fn(tx),
      requestKey: (user, id) => `${user}:${id}`,
      findReplay: async () => null, findReplayIn: async () => null,
      assertReceiptIn: async () => {}, assertNoForeignPrepared: async () => {},
      listPrepared: async () => { assert.equal(prepared.size, 0); return []; },
      prepareOutcome: async (_, p) => prepared.set(p.requestKey, clone(p)),
      findPreparedIn: async (_, key) => clone(prepared.get(key)),
      deletePrepared: async (_, key) => prepared.delete(key),
      deliveringView: (id, event) => ({ actionId: id, event, delivered: true, acked: false }),
      bookAction: async (_, p) => clone(p.response),
      conflict: (code, message) => Object.assign(new Error(message), { code }),
      conflictSemantics: () => { throw Error('unexpected semantic conflict'); },
    },
  };
  const adapter = new ClassicAdapter({}, platform,
    { assertPlayable: async () => ({ minStake: 1n, maxStake: 180n }) }, undefined,
    { rng: n => { draws++; return rng(n); } });
  return {
    state: () => clone(round?.privateState), draws: () => draws, debits: () => debits,
    act: event => adapter.execute({ gameId: 'book-of-ra-classic', userId: 'fixture-player', sessionId: 'fixture-session' }, {
      event, body: { slotEvent: event, slotBet: 1, slotLines: 9 }, requestId: `feature-fixture-${++request}`,
      headers: { 'x-pilot-round': round?.id ?? 'none', 'x-pilot-version': String(round?.privateState.version ?? 1) },
    }),
  };
}

test('expanding symbol selection covers all nine native symbols and stays fixed for the feature', () => {
  const t = profile.tables[9];
  const trigger = t.paidPositive.findIndex(stops => evaluate(boardAt(stops)).trigger);
  assert.ok(trigger >= 0);
  for (let symbolIndex = 0; symbolIndex < 9; symbolIndex++) {
    const symbol = RULES.expandingSymbols[symbolIndex];
    const noTrigger = t.free[symbol].findIndex(stops => !evaluate(boardAt(stops), 1, 9, symbol).trigger);
    let call = 0;
    const plan = playRound(profile, 1, 9, upper => {
      const value = [0, trigger, symbolIndex][call++] ?? noTrigger;
      assert.ok(value >= 0 && value < upper); return value;
    });
    assert.equal(plan.special, symbol);
    assert.equal(plan.freeSpins, 10);
    assert.ok(plan.spins.every(spin => spin.special === symbol));
  }
});

for (const [seed, expectedFree, expectedRetriggers] of [['classic-312', 10, 0], ['classic-2879', 20, 1]]) {
  test(`${seed}: trigger, expansion payout, decrement, retrigger and final feature state`, async () => {
    const h = harness(seed);
    let response = await h.act('bet');
    assert.equal(response.serverResponse.bonusInfo.scattersType, 'bonus');
    assert.equal(response.serverResponse.totalFreeGames, 10);
    assert.deepEqual(response.recovery.free, { total: 10, current: 0, remaining: 10, multiplier: 1 });
    assert.equal(response.recovery.phase, 'FREE_SPINS');
    const plan = h.state().plan, symbol = response.serverResponse.expSymbol;
    assert.ok(RULES.expandingSymbols.includes(symbol));
    assert.equal(plan.special, symbol);
    assert.equal(plan.freeSpins, expectedFree);
    const initialDraws = h.draws();
    let previousRemaining = 10, total = 10, accumulated = response.serverResponse.totalWin, retriggers = 0, expansionSpins = 0;
    for (let index = 1; index <= expectedFree; index++) {
      response = await h.act('freespin');
      const spin = plan.spins[index], server = response.serverResponse;
      assert.equal(server.expSymbol, symbol);
      assert.equal(h.state().plan.special, symbol);
      // Independent reference payout formula, not the evaluator's cached total.
      const reels = spin.board.flatMap((column, reel) => column.includes(symbol) ? [reel] : []);
      const expansion = RULES.paytable[symbol][reels.length] * 9;
      assert.equal(server.expPay, expansion);
      if (expansion > 0) {
        expansionSpins++;
        assert.equal(server.expLines.length, 9);
        assert.deepEqual(server.expReels, [false, ...spin.board.map((_, reel) => reels.includes(reel))]);
        assert.equal(server.expLines.reduce((sum, line) => sum + line.Win, 0), expansion);
      }
      const regular = server.winLines.reduce((sum, line) => sum + line.Win, 0);
      accumulated += regular + server.bonusInfo.scattersWin + expansion;
      assert.equal(server.totalWin, accumulated);
      assert.equal(response.recovery.pendingWin, accumulated);
      const books = spin.board.flat().filter(s => s === 'SCAT').length;
      const awarded = books >= 3 ? 10 : 0;
      retriggers += Number(awarded > 0); total += awarded;
      assert.equal(response.recovery.free.remaining, previousRemaining - 1 + awarded);
      assert.equal(response.recovery.free.current, index);
      assert.equal(response.recovery.free.total, total);
      assert.equal(server.currentFreeGames, index);
      assert.equal(server.totalFreeGames, total);
      previousRemaining = response.recovery.free.remaining;
      assert.equal(response.recovery.phase, index < expectedFree ? 'FREE_SPINS' : 'PENDING_WIN');
    }
    assert.ok(expansionSpins > 0, 'fixture must exercise an expanding payout');
    assert.equal(retriggers, expectedRetriggers);
    assert.equal(previousRemaining, 0);
    assert.equal(accumulated, plan.totalWin);
    assert.equal(h.state().pendingWin, accumulated);
    assert.equal(h.state().index, expectedFree);
    assert.equal(h.draws(), initialDraws, 'free spins consume the prepared plan');
    assert.equal(h.debits(), 1);
    const finalState = h.state();
    await assert.rejects(h.act('freespin'), error => error.code === 'NO_FREE_SPINS');
    assert.deepEqual(h.state(), finalState);
    console.log(JSON.stringify({ seed, symbol, freeSpins: expectedFree, retriggers, expansionSpins, totalWin: accumulated, finalPhase: response.recovery.phase }));
  });
}
