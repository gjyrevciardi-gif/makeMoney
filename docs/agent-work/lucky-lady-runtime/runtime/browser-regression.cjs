// Bounded original-client regression: exact board/stop evidence, native money reconciliation,
// presentation receipts (acknowledge only after the board is rendered), feature/retrigger/refresh
// phases and native red/black gamble. No skip-as-pass.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const HERE = __dirname;
const RUN = 'C:/Users/Admin/orca/research/game-pack-forensics/runtime/LuckyLadysCharmDX/clean-runtime';
const CLIENT = 'C:/Users/Admin/orca/research/game-pack-forensics/external/frontend-hunt/files/heidi-luong1109--game/public/games/LuckyLadysCharmDX';
const PROD_PORT = 8768;
const TEST_PORT = 8769;
const PROD = 'http://127.0.0.1:' + PROD_PORT;
const TEST = 'http://127.0.0.1:' + TEST_PORT;
const results = [];
const outbound = [];
const pageErrors = [];
const screenshots = [];
const ackPosts = [];
const check = (n, ok, d) => results.push({ name: n, ok: !!ok, detail: String(d) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every original third-party file, hashed. The suite must leave all 185 byte-identical. */
function clientManifest(root) {
  const out = [];
  const walk = (dir, base) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = base ? base + '/' + entry.name : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else out.push([rel, crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')]);
    }
  };
  walk(root, '');
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}
/** Authoritative state view without delivery/receipt bookkeeping. */
const stableView = (s) => s && JSON.stringify({
  roundId: s.roundId, phase: s.phase, balance: s.balance, bet: s.bet, pendingWin: s.pendingWin,
  free: s.free, gamble: s.gamble, settlement: s.settlement, profile: s.profile, result: s.result,
});
const manifestDigest = (entries) => crypto.createHash('sha256')
  .update(entries.map((e) => e[0] + ':' + e[1]).join('\n')).digest('hex');

/** Captures the rendered board and the authoritative board at the moment a receipt is posted. */
async function captureAck(page, route, tag) {
  const request = route.request();
  let body = null;
  try { body = request.postDataJSON(); } catch (e) { /* not json */ }
  if (!body || body.slotEvent !== 'ack') return route.continue();
  let captured = null;
  try {
    captured = await Promise.race([page.evaluate(() => {
      const ids = {};
      gameReels._view.children.forEach((reel, i) => {
        const slotHeight = (typeof symHeight === 'number' && symHeight > 0) ? symHeight : 88;
        ids['reel' + (i + 1)] = reel.children
          .filter((s) => s.texture && s.texture.textureCacheIds && s.texture.textureCacheIds[0] && s.y >= 0 && s.y < slotHeight * 3 - 1)
          .sort((a, b) => a.y - b.y).slice(0, 3).map((s) => s.texture.textureCacheIds[0]);
      });
      return {
        board: ids,
        symbols: (slotSpinResult && slotSpinResult.reelsSymbols) ? slotSpinResult.reelsSymbols : null,
        phase: window.pilotRecovery && window.pilotRecovery.phase,
        currentActionId: window.pilotRecovery && window.pilotRecovery.actionId,
        clientState: typeof slotState === 'string' ? slotState : null,
      };
    }), sleep(3000).then(() => null)]);
  } catch (e) { /* page busy or reels absent */ }
  const board = captured && captured.board;
  const symbols = captured && captured.symbols;
  const matches = !symbols ? null
    : [1, 2, 3, 4, 5].every((i) => JSON.stringify((board['reel' + i] || []).slice(0, 3)) === JSON.stringify(symbols['reel' + i].slice(0, 3)));
  const record = { tag, actionId: body.actionId, board, hasBoard: !!symbols, matchesAuthoritative: matches, at: Date.now() };
  if (captured) { record.phase = captured.phase; record.currentActionId = captured.currentActionId; record.clientState = captured.clientState; }
  if (matches === false) record.expected = symbols;
  ackPosts.push(record);
  return route.continue();
}

function start(entry, env) {
  const child = spawn(process.execPath, [path.join(HERE, entry)], { env: Object.assign({}, process.env, env), stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  return { child, err: () => err };
}
async function ready(url) {
  for (let i = 0; i < 100; i++) { try { const r = await fetch(url + '/'); if (r.status === 200) return true; } catch (e) { /* retry */ } await sleep(100); }
  return false;
}
const boardOf = (page) => page.evaluate(() => {
  const ids = {};
  gameReels._view.children.forEach((reel, i) => {
    const slotHeight = (typeof symHeight === 'number' && symHeight > 0) ? symHeight : 88;
    ids['reel' + (i + 1)] = reel.children
      .filter((s) => s.texture && s.texture.textureCacheIds && s.texture.textureCacheIds[0] && s.y >= 0 && s.y < slotHeight * 3 - 1)
      .sort((a, b) => a.y - b.y)
      .slice(0, 3)
      .map((s) => s.texture.textureCacheIds[0]);
  });
  return ids;
});

(async () => {
  let prod = null;
  let test = null;
  let browser = null;
  let manifestBefore = null;
  try {
    manifestBefore = clientManifest(CLIENT);
    check('assets.original-client-file-count', manifestBefore.length === 185, 'files=' + manifestBefore.length);
    prod = start('server.mjs', { LUCKY_RUNTIME_PORT: String(PROD_PORT), LUCKY_RUNTIME_DB: 'browser-prod-' + Date.now() + '.sqlite', LUCKY_RUNTIME_START_CENTS: '100000' });
    check('prod.up', await ready(PROD), prod.err().slice(-200));
    browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    await ctx.route('**/*', (route) => {
      if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue();
      outbound.push(route.request().url());
      return route.abort();
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => pageErrors.push('prod: ' + e.message));
    await page.route('**/game/LuckyLadysCharmDX/server*', (route) => captureAck(page, route, 'prod'));
    await page.goto(PROD + '/');
    await page.waitForFunction(() => window.pilotRecoveryReady === true, null, { timeout: 25000 });
    const settings = await page.evaluate(() => ({ lines: slotSettings.gameLine, symbols: slotSettings.SymbolGame.length, cfg: slotSettings.mathConfig }));
    check('prod.settings-lines-10', JSON.stringify(settings.lines) === '[10]', JSON.stringify(settings.lines));
    check('prod.settings-math-config', settings.cfg && settings.cfg.rtpControlEnabled === true && settings.cfg.targetRtpPercent === 50, JSON.stringify(settings.cfg));
    check('prod.symbol-set-15', settings.symbols === 15, String(settings.symbols));
    // A snapshot with no authoritative action identity (fresh round, or the older PHP protocol)
    // must leave the receipt hook inert instead of guessing an action to acknowledge.
    const freshState = await page.evaluate(() => ({
      actionId: window.pilotRecovery && window.pilotRecovery.actionId,
      receipts: (window.pilotReceipts || []).length,
    }));
    check('prod.bridge-inert-without-action-identity',
      freshState.actionId === null && freshState.receipts === 0 && ackPosts.filter((a) => a.tag === 'prod').length === 0,
      JSON.stringify(freshState));

    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.pilotRecovery && window.pilotRecovery.result, null, { timeout: 25000 });
    await sleep(1200);
    const spin = await page.evaluate(() => ({
      recovery: window.pilotRecovery,
      credit: Number(slotStateData.credit),
      stops: window.slotSpinResult && window.slotSpinResult.reelsSymbols ? window.slotSpinResult.reelsSymbols.rp : null,
    }));
    const authoritative = spin.recovery.result.serverResponse;
    check('prod.stop-order-1-to-5', Array.isArray(authoritative.reelsSymbols.rp) && authoritative.reelsSymbols.rp.length === 5, JSON.stringify(authoritative.reelsSymbols.rp));
    check('prod.client-stops-match-server', JSON.stringify(spin.stops) === JSON.stringify(authoritative.reelsSymbols.rp), JSON.stringify(spin.stops) + ' vs ' + JSON.stringify(authoritative.reelsSymbols.rp));
    // Read the board only after the client reports the reels fully settled.
    await page.waitForFunction(() => slotState === 'IDLE' || slotState === 'AFTERWIN', null, { timeout: 15000 }).catch(() => {});
    await sleep(900);
    const rendered = await boardOf(page);
    const expected = {};
    for (let i = 1; i <= 5; i++) expected['reel' + i] = authoritative.reelsSymbols['reel' + i].slice(0, 3);
    const exactOk = Object.keys(expected).every((key) => JSON.stringify((rendered[key] || []).slice(0, 3)) === JSON.stringify(expected[key]));
    check('prod.exact-15-symbol-ids-match-server', exactOk, JSON.stringify(rendered).slice(0, 160) + ' vs ' + JSON.stringify(expected).slice(0, 160));
    await sleep(1500);
    let later = null;
    for (let w = 0; w < 5 && !later; w++) { try { later = await boardOf(page); } catch (e) { await sleep(400); } }
    const laterExactOk = !!later && Object.keys(expected).every((key) => JSON.stringify((later[key] || []).slice(0, 3)) === JSON.stringify(expected[key]));
    check('prod.board-not-replaced-later', laterExactOk, JSON.stringify(later).slice(0, 120));
    const winSum = authoritative.winLines.reduce((a, l) => a + l.Win, 0);
    check('prod.totalWin-currency-matches-lines', Math.abs(authoritative.totalWin - winSum) < 0.001, authoritative.totalWin + ' vs ' + winSum);
    check('prod.afterBalance-reconciles', Math.abs(authoritative.afterBalance - (authoritative.Balance + authoritative.totalWin)) < 0.001,
      authoritative.Balance + '+' + authoritative.totalWin + ' vs ' + authoritative.afterBalance);
    let creditNow = spin.credit;
    for (let w = 0; w < 40 && Math.abs(creditNow - authoritative.afterBalance) > 0.001; w++) { await sleep(300); creditNow = await page.evaluate(() => Number(slotStateData.credit)); }
    const clientState = await page.evaluate(() => slotState);
    const creditOk = Math.abs(creditNow - authoritative.afterBalance) < 0.001
      || (clientState !== 'IDLE' && Math.abs(creditNow - authoritative.Balance) < 0.001);
    check('prod.client-credit-reconciles', creditOk, 'credit=' + creditNow + ' afterBalance=' + authoritative.afterBalance + ' Balance=' + authoritative.Balance + ' slotState=' + clientState);
    const acceptedWager = spin.recovery.bet.slotBet * spin.recovery.bet.slotLines;
    check('prod.balance-is-post-debit-pre-win', Math.abs(authoritative.Balance - (1000 - acceptedWager)) < 0.001, 'Balance=' + authoritative.Balance + ' expected=' + (1000 - acceptedWager));

    // --- presentation receipt: the bridge acknowledges only after the board is on screen ---
    for (let w = 0; w < 60 && !ackPosts.some((a) => a.tag === 'prod'); w++) await sleep(250);
    const prodAck = ackPosts.find((a) => a.tag === 'prod');
    check('prod.receipt-posted-for-authoritative-action', !!prodAck && prodAck.actionId === spin.recovery.actionId,
      JSON.stringify({ ack: prodAck && prodAck.actionId, actionId: spin.recovery.actionId }));
    const ackBoardExact = !!prodAck && !!prodAck.board
      && Object.keys(expected).every((key) => JSON.stringify((prodAck.board[key] || []).slice(0, 3)) === JSON.stringify(expected[key]));
    check('prod.receipt-posted-after-board-rendered', ackBoardExact, JSON.stringify(prodAck && prodAck.board).slice(0, 180));

    await page.screenshot({ path: path.join(RUN, 'screenshots-prod-spin.png') });
    screenshots.push('screenshots-prod-spin.png');
    const beforeReload = stableView(spin.recovery);
    const acksBeforeReload = ackPosts.length;
    await page.reload();
    await page.waitForFunction(() => window.pilotRecoveryReady === true, null, { timeout: 25000 });
    await sleep(1500);
    const afterReload = await page.evaluate(() => window.pilotRecovery);
    check('prod.refresh-preserves-round', stableView(afterReload) === beforeReload,
      String(stableView(afterReload)).slice(0, 160));
    check('prod.refresh-shows-recorded-receipt',
      !!afterReload && afterReload.actionId === spin.recovery.actionId && afterReload.receipt && afterReload.receipt.acked === true,
      JSON.stringify(afterReload && { actionId: afterReload.actionId, receipt: afterReload.receipt }));
    let boardAfterReload = null;
    for (let w = 0; w < 6 && !boardAfterReload; w++) { try { boardAfterReload = await boardOf(page); } catch (e) { await sleep(400); } }
    check('prod.refresh-restores-same-board',
      !!boardAfterReload && Object.keys(expected).every((key) => JSON.stringify((boardAfterReload[key] || []).slice(0, 3)) === JSON.stringify(expected[key])),
      JSON.stringify(boardAfterReload).slice(0, 180));
    await sleep(700);
    check('prod.refresh-posts-no-duplicate-receipt', ackPosts.length === acksBeforeReload, `acks=${acksBeforeReload}->${ackPosts.length}`);
    await browser.close();
    browser = null;
    prod.child.kill();
    await sleep(400);

    test = start('test-entry.mjs', { LUCKY_TEST_PORT: String(TEST_PORT), LUCKY_TEST_DB: 'browser-test-' + Date.now() + '.sqlite', LUCKY_TEST_OUTCOME: 'bonus' });
    check('test.up', await ready(TEST), test.err().slice(-200));
    browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    await ctx2.route('**/*', (route) => {
      if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue();
      outbound.push(route.request().url());
      return route.abort();
    });
    const page2 = await ctx2.newPage();
    page2.on('pageerror', (e) => pageErrors.push('test: ' + e.message));
    await page2.route('**/game/LuckyLadysCharmDX/server*', (route) => captureAck(page2, route, 'test'));
    await page2.goto(TEST + '/');
    await page2.waitForFunction(() => window.pilotRecoveryReady === true, null, { timeout: 25000 });
    await page2.waitForFunction(() => slotState === 'IDLE', null, { timeout: 15000 }).catch(() => {});
    await sleep(500);
    await page2.keyboard.press('Enter');
    await page2.waitForFunction(() => window.pilotRecovery && window.pilotRecovery.phase === 'FREE_SPINS', null, { timeout: 25000 });
    let state = await page2.evaluate(() => window.pilotRecovery);
    check('test.feature-awards-15-not-future-total', state.free.total === 15 && state.free.remaining === 15, JSON.stringify(state.free));
    check('test.no-future-sequence-in-client', !('sequence' in state) && !('plannedFeatureSpins' in state));
    await page2.screenshot({ path: path.join(RUN, 'screenshots-test-feature.png') });
    screenshots.push('screenshots-test-feature.png');

    let refreshed = false;
    let retriggerSeen = false;
    let retriggerEvents = 0;
    for (let i = 0; i < 40 && state.phase === 'FREE_SPINS'; i++) {
      const before = state.free;
      await page2.waitForFunction(() => slotState === 'WAITBONUS' || window.pilotRecovery.phase !== 'FREE_SPINS', null, { timeout: 25000 }).catch(() => {});
      await page2.keyboard.press('Enter');
      let advanced = false;
      for (let w = 0; w < 30; w++) {
        await sleep(300);
        state = await page2.evaluate(() => window.pilotRecovery);
        if (state.phase !== 'FREE_SPINS' || state.free.current > before.current) { advanced = true; break; }
      }
      if (!advanced) { check('test.feature-progressed', false, 'stalled at spin ' + (before.current + 1)); break; }
      if (state.free.total > before.total) {
        retriggerSeen = true;
        retriggerEvents += 1;
        check('test.retrigger-adds-15-at-event', state.free.total === before.total + 15, before.total + ' -> ' + state.free.total);
      }
      if (!refreshed && state.phase === 'FREE_SPINS' && state.free.current >= 3) {
        const snapshotBefore = JSON.stringify(state.free);
        await page2.reload();
        await page2.waitForFunction(() => window.pilotRecoveryReady === true, null, { timeout: 25000 });
        await sleep(800);
        const restored = await page2.evaluate(() => window.pilotRecovery);
        check('test.refresh-mid-feature-preserved', JSON.stringify(restored.free) === snapshotBefore && restored.phase === 'FREE_SPINS', JSON.stringify(restored.free) + ' vs ' + snapshotBefore);
        refreshed = true;
        state = restored;
      }
    }
    check('test.feature-completed', state.phase !== 'FREE_SPINS', state.phase);
    check('test.feature-progressed', state.free.current >= 15 || state.phase !== 'FREE_SPINS', 'current=' + state.free.current);
    check('test.free-total-matches-revealed-retrigger-rule', state.free.total === 15 + 15 * retriggerEvents,
      'retriggerEvents=' + retriggerEvents + ' finalTotal=' + state.free.total + ' (exact 15->30 proof lives in the scripted API test)');

    if (state.phase === 'PENDING_WIN' || state.phase === 'GAMBLE') {
      await page2.reload();
      await page2.waitForFunction(() => window.pilotRecoveryReady === true, null, { timeout: 25000 });
      await sleep(1000);
      state = await page2.evaluate(() => window.pilotRecovery);
      check('test.pending-win-restored', state.phase === 'PENDING_WIN' && state.pendingWin > 0, state.phase + ' ' + state.pendingWin);
      await page2.waitForFunction(() => slotState === 'AFTERWIN' || slotState === 'GAMBLE', null, { timeout: 12000 }).catch(() => {});
      await page2.keyboard.press('8');
      for (let w = 0; w < 20; w++) { await sleep(300); state = await page2.evaluate(() => window.pilotRecovery); if (state.phase === 'GAMBLE') break; }
      check('test.gamble-entry', state.phase === 'GAMBLE', state.phase);
      await page2.screenshot({ path: path.join(RUN, 'screenshots-test-gamble.png') });
      screenshots.push('screenshots-test-gamble.png');
      if (state.phase === 'GAMBLE') {
        await page2.keyboard.press('9');
        for (let w = 0; w < 25; w++) { await sleep(300); state = await page2.evaluate(() => window.pilotRecovery); if (state.gamble.attempts >= 1) break; }
        check('test.gamble-red-result', state.gamble.attempts >= 1 && state.gamble.cards.length >= 1, JSON.stringify(state.gamble));
        for (let attempt = 0; attempt < 3 && state.gamble.attempts < 2 && state.phase === 'GAMBLE'; attempt++) {
          await page2.waitForFunction(() => slotState === 'GAMBLE' || window.pilotRecovery.phase === 'IDLE', null, { timeout: 12000 }).catch(() => {});
          await page2.keyboard.press('0');
          for (let w = 0; w < 25; w++) { await sleep(300); state = await page2.evaluate(() => window.pilotRecovery); if (state.gamble.attempts >= 2 || state.phase === 'IDLE') break; }
        }
        check('test.gamble-black-result', state.gamble.attempts >= 2 || state.phase === 'IDLE', JSON.stringify(state.gamble));
        for (let attempt = 0; attempt < 4 && state.phase !== 'IDLE'; attempt++) {
          await page2.waitForFunction(() => slotState === 'GAMBLE' || slotState === 'AFTERWIN' || window.pilotRecovery.phase === 'IDLE', null, { timeout: 12000 }).catch(() => {});
          await page2.keyboard.press('Enter');
          for (let w = 0; w < 25; w++) { await sleep(300); state = await page2.evaluate(() => window.pilotRecovery); if (state.phase === 'IDLE') break; }
        }
        check('test.collect-reaches-idle', state.phase === 'IDLE', state.phase);
      }
    } else {
      check('test.gamble-entry', false, 'phase=' + state.phase);
    }
    const testAcks = ackPosts.filter((a) => a.tag === 'test');
    const uniqueTestAcks = new Set(testAcks.map((a) => a.actionId));
    const boardAcks = testAcks.filter((a) => a.hasBoard);
    check('test.receipts-cover-every-presented-action', uniqueTestAcks.size >= 1 + state.free.current,
      `uniqueReceipts=${uniqueTestAcks.size} freeSpins=${state.free.current} phase=${state.phase}`);
    // Every receipt whose presented result contains a board was posted with that exact board on screen.
    check('test.receipts-follow-rendered-board', boardAcks.length >= 1 + state.free.current && boardAcks.every((a) => a.matchesAuthoritative === true),
      `boardReceipts=${boardAcks.length} mismatched=${boardAcks.filter((a) => a.matchesAuthoritative !== true).length}`);
    check('test.receipts-target-distinct-actions', uniqueTestAcks.size === testAcks.length,
      `unique=${uniqueTestAcks.size} posts=${testAcks.length}`);

    // --- browser-level receipt gate, disconnect before receipt, receipt after restore ---
    const snapshotBeforeProbe = await (await fetch(TEST + '/__test/snapshot')).json();
    const gateProbe = await page2.evaluate(async () => {
      const url = '/game/LuckyLadysCharmDX/server?sessionId=' + sessionStorage.getItem('sessionId');
      const state = window.pilotRecovery;
      const call = (id, body, guard) => fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', 'X-Pilot-Request-ID': id,
          'X-Pilot-Version': String(guard.version), 'X-Pilot-Round': String(guard.roundId),
        },
        body: JSON.stringify(body),
      }).then(async (r) => ({ status: r.status, json: JSON.parse(await r.text()) }));
      const first = await call('raw-gate-1', { slotEvent: 'bet', slotBet: '0.10', slotLines: 10 }, state);
      // The client reads the new round identity, then still cannot start the next action.
      const current = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotEvent: 'getSettings' }),
      }).then((r) => r.json()).then((d) => d.recovery);
      const second = await call('raw-gate-2', { slotEvent: 'bet', slotBet: '0.10', slotLines: 10 }, current);
      return { phase: state.phase, first, second, currentActionId: current.actionId, currentReceipt: current.receipt };
    });
    check('browser.gate-probe-starts-from-idle', gateProbe.phase === 'IDLE' && gateProbe.first.status === 200 && gateProbe.first.json.responseEvent === 'spin',
      JSON.stringify({ phase: gateProbe.phase, status: gateProbe.first.status, event: gateProbe.first.json.responseEvent }));
    check('browser.server-refuses-next-mutation-before-receipt',
      gateProbe.second.status === 409 && /acknowledged/i.test(String(gateProbe.second.json.reason))
      && gateProbe.currentReceipt.acked === false && gateProbe.currentActionId === 'raw-gate-1',
      JSON.stringify({ first: gateProbe.first.status, second: gateProbe.second.status, reason: gateProbe.second.json.reason, pending: gateProbe.currentActionId, receipt: gateProbe.currentReceipt }));
    const probeBoard = gateProbe.first.json.recovery.result.serverResponse.reelsSymbols;
    const probeRound = gateProbe.first.json.recovery.roundId;
    const receiptsBeforeReload = ackPosts.length;
    await page2.reload();
    await page2.waitForFunction(() => window.pilotRecoveryReady === true, null, { timeout: 25000 });
    await sleep(1500);
    const restoredProbe = await page2.evaluate(() => window.pilotRecovery);
    check('browser.reload-before-receipt-keeps-same-round',
      restoredProbe.roundId === probeRound && restoredProbe.actionId === 'raw-gate-1',
      JSON.stringify({ roundId: restoredProbe.roundId, actionId: restoredProbe.actionId }));
    let probeRendered = null;
    for (let w = 0; w < 6 && !probeRendered; w++) { try { probeRendered = await boardOf(page2); } catch (e) { await sleep(400); } }
    check('browser.reload-before-receipt-restores-same-board',
      !!probeRendered && [1, 2, 3, 4, 5].every((i) => JSON.stringify((probeRendered['reel' + i] || []).slice(0, 3)) === JSON.stringify(probeBoard['reel' + i].slice(0, 3))),
      JSON.stringify(probeRendered).slice(0, 180));
    for (let w = 0; w < 60 && ackPosts.length === receiptsBeforeReload; w++) await sleep(250);
    const restoredReceipt = await page2.evaluate((id) => (window.pilotReceipts || []).find((r) => r.actionId === id) || null, 'raw-gate-1');
    check('browser.restored-client-acks-after-render',
      !!restoredReceipt && restoredReceipt.accepted === true && restoredReceipt.boardRendered === true,
      JSON.stringify(restoredReceipt));
    const snapshotAfterProbe = await (await fetch(TEST + '/__test/snapshot')).json();
    check('browser.reload-before-receipt-stays-draw-and-debit-free',
      snapshotAfterProbe.counters.outcomeGenerations - snapshotBeforeProbe.counters.outcomeGenerations === 1
      && snapshotAfterProbe.counters.actionExecutions - snapshotBeforeProbe.counters.actionExecutions === 1
      && snapshotAfterProbe.ledger.filter((l) => l.kind === 'bet').length - snapshotBeforeProbe.ledger.filter((l) => l.kind === 'bet').length === 1,
      JSON.stringify({ before: snapshotBeforeProbe.counters, after: snapshotAfterProbe.counters }));

    // --- stalled/failed rendering: no receipt, server stays pending, refresh then renders + acks ---
    const probePage = await ctx2.newPage();
    probePage.on('pageerror', (e) => pageErrors.push('stall: ' + e.message));
    await probePage.addInitScript(() => {
      window.__pilotTimeScale = 1;
      const realNow = Date.now.bind(Date);
      const base = realNow();
      Date.now = () => base + (realNow() - base) * (window.__pilotTimeScale || 1);
      const realSetTimeout = window.setTimeout.bind(window);
      window.setTimeout = function (fn, ms, ...rest) {
        const scale = window.__pilotTimeScale || 1;
        const delay = scale > 1 ? Math.max(1, Math.min(Number(ms) || 0, 5)) : ms;
        return realSetTimeout(fn, delay, ...rest);
      };
    });
    await probePage.route('**/game/LuckyLadysCharmDX/server*', (route) => captureAck(probePage, route, 'stall'));
    await probePage.goto(TEST + '/');
    await probePage.waitForFunction(() => window.pilotRecoveryReady === true, null, { timeout: 25000 });
    await probePage.waitForFunction(() => slotState === 'IDLE', null, { timeout: 15000 }).catch(() => {});
    await sleep(400);
    // Reset the shared round to IDLE so the stalled action is a real paid bet, not a free spin.
    const drivePhase = await probePage.evaluate(async () => {
      const url = '/game/LuckyLadysCharmDX/server?sessionId=' + sessionStorage.getItem('sessionId');
      const post = (id, body, st) => fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', 'X-Pilot-Request-ID': id,
          'X-Pilot-Version': String(st.version), 'X-Pilot-Round': String(st.roundId),
        },
        body: JSON.stringify(body),
      }).then(async (r) => JSON.parse(await r.text()));
      const read = () => fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotEvent: 'getSettings' }),
      }).then((r) => r.json()).then((d) => d.recovery);
      let st = await read();
      for (let n = 0; st.phase !== 'IDLE' && n < 80; n++) {
        const result = st.phase === 'FREE_SPINS'
          ? await post('probe-drive-' + n, { slotEvent: 'freespin', slotBet: st.bet.slotBet, slotLines: st.bet.slotLines }, st)
          : await post('probe-drive-' + n, { slotEvent: 'recoveryCollect' }, st);
        if (result.recovery && result.recovery.actionId) {
          await fetch(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pilot-Request-ID': 'probe-drive-ack-' + n },
            body: JSON.stringify({ slotEvent: 'ack', actionId: result.recovery.actionId }),
          });
        }
        st = await read();
      }
      return st.phase;
    });
    check('stall.probe-round-reset-to-idle', drivePhase === 'IDLE', String(drivePhase));
    await probePage.reload();
    await probePage.waitForFunction(() => window.pilotRecoveryReady === true, null, { timeout: 25000 });
    await probePage.waitForFunction(() => slotState === 'IDLE', null, { timeout: 15000 }).catch(() => {});
    await sleep(500);
    const beforeStall = await (await fetch(TEST + '/__test/snapshot')).json();
    // Stub the presentation only: the authoritative result is untouched, the reels simply can
    // never show it, so the receipt hook must time out instead of acknowledging.
    await probePage.evaluate(() => { window.symHeight = 1; });
    await probePage.keyboard.press('Enter');
    await probePage.waitForFunction(() => window.pilotRecovery && window.pilotRecovery.actionId
      && window.pilotRecovery.receipt && window.pilotRecovery.receipt.acked === false, null, { timeout: 20000 });
    const stalledActionId = await probePage.evaluate(() => window.pilotRecovery.actionId);
    // This action has used its one reconciliation reload, so the withheld receipt stays stuck.
    await probePage.evaluate((id) => { sessionStorage.setItem('pilotReceiptReconcile', JSON.stringify([id])); }, stalledActionId);
    const stallAcksBefore = ackPosts.filter((a) => a.tag === 'stall').length;
    await probePage.evaluate(() => { window.__pilotTimeScale = 400; });
    await probePage.waitForFunction(() => window.pilotReceiptWithheld === window.pilotRecovery.actionId, null, { timeout: 25000 });
    const stallAcks = ackPosts.filter((a) => a.tag === 'stall');
    const stalledReceipts = await probePage.evaluate(() => (window.pilotReceipts || []).slice());
    const duringStall = await (await fetch(TEST + '/__test/snapshot')).json();
    check('stall.render-timeout-sends-no-receipt',
      stallAcks.length === stallAcksBefore && !stallAcks.some((a) => a.actionId === stalledActionId),
      `acks=${stallAcks.length} action=${stalledActionId}`);
    check('stall.receipt-withheld-is-reported-not-unhandled',
      stalledReceipts.some((r) => r.actionId === stalledActionId && r.accepted === false && r.reason === 'RENDER_TIMEOUT'),
      JSON.stringify(stalledReceipts.slice(-2)));
    check('stall.server-keeps-action-pending',
      duringStall.receipt.actionId === stalledActionId && duringStall.receipt.acked === false,
      JSON.stringify(duringStall.receipt));
    // The rejected/stalled presentation changes nothing: the one accepted action moves money only
    // through its own ledger rows and never draws more RNG than that single action requires.
    const stallEvent = duringStall.receipt.event;
    const stallRows = duringStall.ledger.slice(beforeStall.ledger.length);
    const generationDelta = duringStall.counters.outcomeGenerations - beforeStall.counters.outcomeGenerations;
    const drawDelta = duringStall.counters.engineRngDraws - beforeStall.counters.engineRngDraws;
    const stallDrawOk = stallEvent === 'bet' ? drawDelta >= 5 : drawDelta === 0;
    const stallBetRows = stallRows.filter((l) => l.kind === 'bet');
    const stallCreditRows = stallRows.filter((l) => l.kind === 'paid-win');
    check('stall.paid-bet-settled-exactly-once',
      stallEvent === 'bet' && stallBetRows.length === 1 && stallBetRows[0].delta < 0 && stallCreditRows.length <= 1,
      JSON.stringify({ event: stallEvent, rows: stallRows.map((l) => [l.kind, l.delta]) }));
    check('stall.no-extra-draw-or-debit',
      duringStall.counters.actionExecutions - beforeStall.counters.actionExecutions === 1
      && generationDelta === (stallEvent === 'bet' ? 1 : 0)
      && stallDrawOk
      && stallRows.length <= 2
      && duringStall.balanceCents - beforeStall.balanceCents === stallRows.reduce((a, l) => a + l.delta, 0),
      JSON.stringify({ event: stallEvent, before: beforeStall.counters, after: duringStall.counters, rows: stallRows.map((l) => [l.kind, l.delta]) }));
    const stillGated = await probePage.evaluate(async () => {
      const st = window.pilotRecovery;
      const r = await fetch('/game/LuckyLadysCharmDX/server?sessionId=' + sessionStorage.getItem('sessionId'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Pilot-Request-ID': 'stall-gate-1', 'X-Pilot-Version': String(st.version), 'X-Pilot-Round': String(st.roundId) },
        body: JSON.stringify({ slotEvent: 'bet', slotBet: '0.10', slotLines: 10 }),
      });
      return { status: r.status, body: await r.text() };
    });
    check('stall.server-gate-still-blocks-next-action',
      stillGated.status === 409 && /acknowledged/i.test(String(JSON.parse(stillGated.body).reason)),
      JSON.stringify(stillGated));
    // A successful refresh renders the authoritative board and acknowledges the SAME outcome.
    await probePage.reload();
    await probePage.waitForFunction(() => window.pilotRecoveryReady === true, null, { timeout: 25000 });
    await probePage.waitForFunction((id) => (window.pilotReceipts || []).some((r) => r.actionId === id && r.accepted === true), stalledActionId, { timeout: 30000 });
    const afterRecovery = await (await fetch(TEST + '/__test/snapshot')).json();
    check('stall.refresh-renders-and-acks-same-outcome',
      afterRecovery.receipt.actionId === stalledActionId && afterRecovery.receipt.acked === true,
      JSON.stringify(afterRecovery.receipt));
    check('stall.recovery-adds-no-draw-or-debit',
      afterRecovery.counters.outcomeGenerations === duringStall.counters.outcomeGenerations
      && afterRecovery.counters.actionExecutions === duringStall.counters.actionExecutions
      && JSON.stringify(afterRecovery.ledger) === JSON.stringify(duringStall.ledger),
      JSON.stringify({ during: duringStall.counters, after: afterRecovery.counters }));
    const stalledBoard = duringStall.recovery.result.serverResponse.reelsSymbols;
    let recoveryRendered = null;
    for (let w = 0; w < 6 && !recoveryRendered; w++) { try { recoveryRendered = await boardOf(probePage); } catch (e) { await sleep(400); } }
    check('stall.refresh-renders-authoritative-board',
      !!recoveryRendered && [1, 2, 3, 4, 5].every((i) => JSON.stringify((recoveryRendered['reel' + i] || []).slice(0, 3)) === JSON.stringify(stalledBoard['reel' + i].slice(0, 3))),
      JSON.stringify(recoveryRendered).slice(0, 180));

    check('browser.no-page-errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
    check('browser.no-outbound', outbound.length === 0, outbound.slice(0, 3).join(' | '));
  } catch (error) {
    check('browser.suite-completed', false, String(error && error.stack).slice(0, 300));
  } finally {
    try { if (browser) await browser.close(); } catch (e) { /* ignore */ }
    try { if (prod) prod.child.kill(); } catch (e) { /* ignore */ }
    try { if (test) test.child.kill(); } catch (e) { /* ignore */ }
    if (manifestBefore) {
      const untouched = clientManifest(CLIENT);
      check('assets.original-client-untouched',
        untouched.length === manifestBefore.length && untouched.every((e, i) => e[0] === manifestBefore[i][0] && e[1] === manifestBefore[i][1]),
        `${manifestBefore.length} -> ${untouched.length} files`);
    }
  }
  const failures = results.filter((r) => !r.ok);
  fs.mkdirSync(path.join(HERE, 'runs'), { recursive: true });
  fs.writeFileSync(path.join(HERE, 'runs', 'browser-regression.json'), JSON.stringify({
    results, failures: failures.map((f) => f.name + ': ' + f.detail), outbound, pageErrors, screenshots,
    receipts: ackPosts.map((a) => ({ tag: a.tag, actionId: a.actionId, matchesAuthoritative: a.matchesAuthoritative, at: a.at })),
    clientAssets: manifestBefore ? { files: manifestBefore.length, manifestSha256: manifestDigest(manifestBefore) } : null,
  }, null, 1));
  console.log(JSON.stringify({ checks: results.length, passed: results.length - failures.length, failures: failures.map((f) => f.name + ': ' + f.detail) }, null, 1));
  process.exitCode = failures.length ? 1 : 0;
})();
