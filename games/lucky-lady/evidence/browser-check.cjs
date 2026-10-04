/*
 * Bounded original-client browser evidence for the Fool's Gold Lucky Lady
 * integration.
 *
 * It runs the real compiled platform behind the loopback gateway, drives the
 * recovered 185-file client in Chrome, and checks the platform contract:
 * launch authorization, session exchange, settings, a paid round with an exact
 * 15-symbol board, the presentation receipt, collect, refresh recovery, the
 * free-spin feature with a retrigger, the native gamble, and ledger
 * reconciliation. No outcome is fabricated: seeds only choose one legitimate
 * path through the accepted evaluator.
 *
 * Usage (after `npm run build` in backend/ and with a disposable *_test DB):
 *   DATABASE_URL=... REDIS_URL=... node games/lucky-lady/evidence/browser-check.cjs
 */
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const DIST = path.join(ROOT, 'backend', 'dist', 'src');
const CLIENT_DIR = process.env.LUCKY_LADY_CLIENT_DIR
  ?? 'C:/Users/Admin/orca/research/game-pack-forensics/external/frontend-hunt/files/heidi-luong1109--game/public/games/LuckyLadysCharmDX';
const EVIDENCE_DIR = path.join(ROOT, 'docs', 'agent-work', 'lucky-lady-runtime', 'evidence');
const SHOT_DIR = path.join(EVIDENCE_DIR, 'screenshots');
const HARNESS_PORT = 3101;
const GATEWAY_PORT = 8790;
const FRONTEND_PORT = 3000;
// The platform API and the Next launcher share one hostname on purpose: the
// refresh cookie is SameSite=Strict, so a cross-host launcher could not sign in.
const HARNESS = `http://localhost:${HARNESS_PORT}`;
const GATEWAY = `http://127.0.0.1:${GATEWAY_PORT}`;
const FRONTEND = `http://localhost:${FRONTEND_PORT}`;
const LAUNCH_PAGE = `${FRONTEND}/casino/slots/lucky-lady`;

const WIN_SEED = 'll-0';
const ZERO_SEED = 'll-2';
const FEATURE_SEED = 'll-2391';
const RETRIGGER_SEED = 'll-117402';
const GAMBLE_WIN_SEED = 'g-2';
const GAMBLE_LOSE_SEED = 'g-0';

const { chromium } = require('C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { PrismaClient } = require(path.join(ROOT, 'node_modules', '@prisma', 'client'));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const outbound = [];
const pageErrors = [];
const receipts = [];
const shots = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail: String(detail ?? '') });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` :: ${detail}`}\n`);
};

const clientManifest = () => {
  const entries = [];
  const walk = (dir, base) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else entries.push([rel, crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')]);
    }
  };
  walk(CLIENT_DIR, '');
  return entries.sort((left, right) => (left[0] < right[0] ? -1 : 1));
};

const boardOf = (page) => page.evaluate(() => {
  const ids = {};
  gameReels._view.children.forEach((reel, index) => {
    const height = (typeof symHeight === 'number' && symHeight > 0) ? symHeight : 88;
    ids[`reel${index + 1}`] = reel.children
      .filter((symbol) => symbol.texture && symbol.texture.textureCacheIds
        && symbol.texture.textureCacheIds[0] && symbol.y >= 0 && symbol.y < height * 3 - 1)
      .sort((left, right) => left.y - right.y)
      .slice(0, 3)
      .map((symbol) => symbol.texture.textureCacheIds[0]);
  });
  return ids;
});

const expectedBoard = (symbols) => {
  const expected = {};
  for (let reel = 1; reel <= 5; reel += 1) expected[`reel${reel}`] = symbols[`reel${reel}`].slice(0, 3);
  return expected;
};
const boardMatches = (rendered, expected) => Object.keys(expected)
  .every((key) => JSON.stringify((rendered[key] ?? []).slice(0, 3)) === JSON.stringify(expected[key]));

async function waitForReady(page) {
  await page.waitForFunction(() => window.pilotRecoveryReady === true, null, { timeout: 40000 });
}

async function waitForPhase(page, phases, timeout = 30000) {
  await page.waitForFunction(
    (wanted) => window.pilotRecovery && wanted.includes(window.pilotRecovery.phase),
    phases,
    { timeout },
  );
}

/**
 * Settles any pending win through the native collect control and waits for the
 * client to return to IDLE. Bounded, never asserted as a pass on its own.
 */
async function collectToIdle(page, attempts = 3) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const phase = await page.evaluate(() => window.pilotRecovery && window.pilotRecovery.phase);
    if (phase === 'IDLE') return true;
    await page
      .waitForFunction(
        () => slotState === 'AFTERWIN' || slotState === 'GAMBLE'
          || (window.pilotRecovery && window.pilotRecovery.phase === 'IDLE'),
        null,
        { timeout: 20000 },
      )
      .catch(() => {});
    await page.keyboard.press('Enter');
    const settled = await page
      .waitForFunction(() => window.pilotRecovery && window.pilotRecovery.phase === 'IDLE', null, { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    if (settled) return true;
    await sleep(400);
  }
  return false;
}

/**
 * Starts one paid round through the original client and waits for the expected
 * phase. The native Enter/Start control occasionally needs a second press right
 * after a feature outro, so a still-idle client is retried a bounded number of
 * times instead of being reported as a pass.
 */
async function startRound(page, expectedPhases, attempts = 3) {
  let phase = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await page.keyboard.press('Enter');
    const reached = await page
      .waitForFunction(
        (wanted) => window.pilotRecovery && wanted.includes(window.pilotRecovery.phase),
        expectedPhases,
        { timeout: 25000 },
      )
      .then(() => true)
      .catch(() => false);
    if (reached) return true;
    phase = await page.evaluate(() => window.pilotRecovery && window.pilotRecovery.phase);
    if (phase !== 'IDLE') return false;
    await sleep(900);
  }
  return false;
}

/** Opens the native red/black gamble screen from a pending win. */
async function enterGamble(page, attempts = 4) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await page
      .waitForFunction(
        () => slotState === 'AFTERWIN' || slotState === 'GAMBLE'
          || (window.pilotRecovery && window.pilotRecovery.phase === 'GAMBLE'),
        null,
        { timeout: 20000 },
      )
      .catch(() => {});
    await page.keyboard.press('8');
    const entered = await page
      .waitForFunction(() => window.pilotRecovery && window.pilotRecovery.phase === 'GAMBLE', null, { timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    if (entered) return true;
    await sleep(800);
  }
  return false;
}

/** Plays one native red/black guess and waits for the recorded attempt. */
async function playGamble(page, key = '9', attempts = 3) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await page.keyboard.press(key);
    const played = await page
      .waitForFunction(() => window.pilotRecovery && window.pilotRecovery.gamble.attempts >= 1, null, { timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    if (played) return true;
    const phase = await page.evaluate(() => window.pilotRecovery && window.pilotRecovery.phase);
    if (phase === 'IDLE') return false;
    await sleep(800);
  }
  return false;
}

/** Reloads the client and returns the restored authoritative state and board. */
async function refreshAndRead(page) {
  await page.reload();
  await waitForReady(page);
  await sleep(1000);
  const state = await page.evaluate(() => window.pilotRecovery);
  let board = null;
  for (let attempt = 0; attempt < 6 && !board; attempt += 1) {
    try { board = await boardOf(page); } catch (error) { await sleep(300); }
  }
  return { state, board };
}

async function urlReady(url, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      // Any HTTP answer means the listener is up; the status itself is asserted
      // by the checks that follow.
      if (response.status) return true;
    } catch (error) { /* not up yet */ }
    await sleep(250);
  }
  return false;
}

(async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !/_test/.test(databaseUrl)) {
    throw new Error('DATABASE_URL must point at an isolated *_test database');
  }
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const { PointsService } = require(path.join(DIST, 'wallet', 'points.service.js'));
  const points = new PointsService(prisma);
  const argon2Module = require(path.join(ROOT, 'node_modules', 'argon2'));
  const argon2Hash = argon2Module.hash ?? argon2Module.default?.hash;

  let harness = null;
  let gateway = null;
  let frontend = null;
  let browser = null;
  const errors = [];
  const manifestBefore = clientManifest();
  check('client.file-count-185', manifestBefore.length === 185, `files=${manifestBefore.length}`);

  try {
    harness = spawn(process.execPath, [path.join(__dirname, 'backend-harness.cjs')], {
      env: { ...process.env, LUCKY_LADY_HARNESS_PORT: String(HARNESS_PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    harness.stderr.on('data', (chunk) => errors.push(`harness: ${chunk}`));
    gateway = spawn(process.execPath, [path.join(ROOT, 'games', 'lucky-lady', 'gateway', 'server.mjs')], {
      env: {
        ...process.env,
        LUCKY_LADY_GATEWAY_PORT: String(GATEWAY_PORT),
        LUCKY_LADY_CLIENT_DIR: CLIENT_DIR,
        PLATFORM_URL: HARNESS,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    gateway.stderr.on('data', (chunk) => errors.push(`gateway: ${chunk}`));
    frontend = spawn(
      process.execPath,
      [path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev'],
      {
        cwd: path.join(ROOT, 'frontend'),
        env: {
          ...process.env,
          PORT: String(FRONTEND_PORT),
          NEXT_PUBLIC_API_URL: HARNESS,
          NEXT_PUBLIC_LUCKY_LADY_URL: GATEWAY,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    frontend.stderr.on('data', (chunk) => errors.push(`frontend: ${chunk}`));

    check('harness.up', await urlReady(`${HARNESS}/users/me`), 'harness reachable');
    check('gateway.up', await urlReady(`${GATEWAY}/healthz`), 'gateway reachable');
    check('frontend.up', await urlReady(LAUNCH_PAGE, 480), 'Next launcher reachable');

    // --- platform users and the audited grant path -------------------------
    const password = 'lucky-lady-evidence-password';
    const passwordHash = await argon2Hash(password);
    const stamp = Date.now();
    const player = await prisma.user.create({
      data: { email: `evidence-player-${stamp}@example.test`, passwordHash, wallet: { create: {} } },
    });
    const rival = await prisma.user.create({
      data: { email: `evidence-rival-${stamp}@example.test`, passwordHash, wallet: { create: {} } },
    });
    const admin = await prisma.user.create({
      data: { email: `evidence-admin-${stamp}@example.test`, passwordHash, role: 'ADMIN', wallet: { create: {} } },
    });
    await points.adminGrant(admin.id, player.id, 100_000n, 'Lucky Lady evidence funding', crypto.randomUUID());
    await points.adminGrant(admin.id, rival.id, 1_000n, 'Lucky Lady rival funding', crypto.randomUUID());
    const walletBalance = async (userId) => (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance;
    check('platform.grant-via-audited-admin-path', (await walletBalance(player.id)) === 100_000n, String(await walletBalance(player.id)));

    const login = async (email) => {
      const response = await fetch(`${HARNESS}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await response.json();
      return body.accessToken;
    };
    const playerToken = await login(player.email);
    const adminToken = await login(admin.email);
    const rivalToken = await login(rival.email);
    check('platform.login-issues-access-token', typeof playerToken === 'string' && playerToken.length > 20, 'token issued');

    // --- launch authorization ---------------------------------------------
    const adminLaunch = await fetch(`${HARNESS}/casino/lucky-lady/launch`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: '{}',
    });
    check('launch.admin-denied', adminLaunch.status === 403, `status=${adminLaunch.status}`);
    const anonymousLaunch = await fetch(`${HARNESS}/casino/lucky-lady/launch`, { method: 'POST' });
    check('launch.anonymous-denied', anonymousLaunch.status === 401, `status=${anonymousLaunch.status}`);
    const launchResponse = await fetch(`${HARNESS}/casino/lucky-lady/launch`, {
      method: 'POST',
      headers: { authorization: `Bearer ${playerToken}`, 'content-type': 'application/json' },
      body: '{}',
    });
    const launch = await launchResponse.json();
    check('launch.player-token-issued', launchResponse.status === 201 && typeof launch.token === 'string', `status=${launchResponse.status}`);

    const launchRow = await prisma.gameLaunchCapability.findFirstOrThrow({ where: { userId: player.id } });
    check('launch.stores-only-the-hash',
      launchRow.tokenHash === crypto.createHash('sha256').update(launch.token).digest('hex')
      && !JSON.stringify(launchRow).includes(launch.token),
      'hash stored');

    // Gameplay is refused without a game capability, and for a forged one.
    const noCookie = await fetch(`${GATEWAY}/game/LuckyLadysCharmDX/server`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slotEvent: 'getSettings' }),
    });
    check('gateway.requires-game-capability', noCookie.status === 401, `status=${noCookie.status}`);
    const forged = await fetch(`${GATEWAY}/game/LuckyLadysCharmDX/server`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'll_session=forged-session-token-value-1234' },
      body: JSON.stringify({ slotEvent: 'getSettings' }),
    });
    check('gateway.rejects-forged-capability', forged.status === 401, `status=${forged.status}`);
    const crossUser = await fetch(`${HARNESS}/casino/lucky-lady/session/gameplay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lucky-session': 'forged-session-token-value-1234' },
      body: JSON.stringify({ slotEvent: 'getSettings' }),
    });
    check('platform.rejects-forged-capability', crossUser.status === 401, `status=${crossUser.status}`);

    browser = await chromium.launch({
      headless: true,
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      // Loopback names must still resolve - the platform launcher runs on
      // localhost while the game client runs on 127.0.0.1 - and everything else
      // is mapped away so no real network request can escape.
      args: [
        '--disable-background-networking',
        '--host-resolver-rules=EXCLUDE localhost, EXCLUDE 127.0.0.1, MAP * ~NOTFOUND',
      ],
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    await context.route('**/*', (route) => {
      const host = new URL(route.request().url()).hostname;
      if (host === '127.0.0.1' || host === 'localhost') return route.continue();
      outbound.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.route('**/game/LuckyLadysCharmDX/server*', async (route) => {
      let body = null;
      try { body = route.request().postDataJSON(); } catch (error) { body = null; }
      if (body && body.slotEvent === 'ack') {
        let rendered = null;
        try { rendered = await boardOf(page); } catch (error) { rendered = null; }
        receipts.push({ actionId: body.actionId, rendered });
      }
      return route.continue();
    });

    // --- exchange the capability for a game-only cookie --------------------
    const exchange = await context.request.post(`${GATEWAY}/launch`, { headers: { origin: FRONTEND }, form: { token: launch.token }, maxRedirects: 0 });
    const setCookie = exchange.headers()['set-cookie'] ?? '';
    check('exchange.redirects-to-clean-url', exchange.status() === 303 && (exchange.headers().location ?? '') === '/play',
      `status=${exchange.status()} location=${exchange.headers().location}`);
    check('exchange.sets-httponly-game-cookie', /ll_session=/.test(setCookie) && /HttpOnly/i.test(setCookie),
      setCookie.replace(/ll_session=[^;]+/, 'll_session=<redacted>'));
    check('exchange.never-puts-token-in-url', !String(exchange.headers().location ?? '').includes(launch.token), 'token absent from location');
    const replayExchange = await context.request.post(`${GATEWAY}/launch`, { headers: { origin: FRONTEND }, form: { token: launch.token }, maxRedirects: 0 });
    check('exchange.single-use', replayExchange.status() === 401, `status=${replayExchange.status()}`);

    const seeds = async (values) => {
      const response = await fetch(`${HARNESS}/__test/seeds`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seeds: values }),
      });
      return response.json();
    };
    const stats = async () => (await (await fetch(`${HARNESS}/__test/stats`)).json());

    // --- boot the recovered client ----------------------------------------
    await page.goto(`${GATEWAY}/play`);
    await waitForReady(page);
    await sleep(800);
    const settings = await page.evaluate(() => ({
      lines: slotSettings.gameLine,
      betLadder: slotSettings.Bet,
      symbols: slotSettings.SymbolGame ? slotSettings.SymbolGame.length : 0,
      config: slotSettings.mathConfig,
    }));
    check('client.settings-lock-10-lines', JSON.stringify(settings.lines) === '[10]', JSON.stringify(settings.lines));
    check('client.stake-ladder-is-whole-points',
      JSON.stringify(settings.betLadder.map(Number)) === JSON.stringify([1, 2, 5, 10, 20]),
      JSON.stringify(settings.betLadder));
    check('client.settings-frozen-profile',
      settings.config && settings.config.targetRtpPercent === 50
      && settings.config.profileHash === 'eb0a22171a3479cea3b0238269edd4b0dc5d9486c57e4b057fa6ee0f1a70be5f',
      JSON.stringify(settings.config));
    check('client.renders-15-symbols', settings.symbols === 15, String(settings.symbols));
    const bootState = await page.evaluate(() => window.pilotRecovery);
    check('client.zero-welcome-credits-and-wallet-balance',
      bootState.balance === 100_000 && bootState.phase === 'IDLE' && bootState.roundId === 'none',
      JSON.stringify({ balance: bootState.balance, phase: bootState.phase }));
    await page.screenshot({ path: path.join(SHOT_DIR, '01-idle.png') });

    // --- paid round: exact board, one debit -------------------------------
    await seeds([WIN_SEED]);
    const seeded = await stats();
    check('harness.seed-queue-applied', seeded.queued === 1, JSON.stringify(seeded));
    const paidStarted = await startRound(page, ['PENDING_WIN']);
    await page.waitForFunction(() => window.pilotRecovery && window.pilotRecovery.result, null, { timeout: 40000 });
    check('paid.round-started', paidStarted, 'phase reached PENDING_WIN');
    await page.waitForFunction(() => slotState === 'IDLE' || slotState === 'AFTERWIN', null, { timeout: 20000 }).catch(() => {});
    await sleep(1200);
    const paid = await page.evaluate(() => ({
      recovery: window.pilotRecovery,
      credit: Number(slotStateData.credit),
      state: slotState,
    }));
    const paidSymbols = paid.recovery.result.serverResponse.reelsSymbols;
    const paidExpected = expectedBoard(paidSymbols);
    const paidRendered = await boardOf(page);
    check('paid.visible-15-symbols-match-server', boardMatches(paidRendered, paidExpected),
      `${JSON.stringify(paidRendered).slice(0, 90)} vs ${JSON.stringify(paidExpected).slice(0, 90)}`);
    const paidMoves = await prisma.ledgerEntry.findMany({ where: { wallet: { userId: player.id }, type: 'CASINO_BET' } });
    const paidDraws = await stats();
    check('harness.deterministic-seed-used', paidDraws.draws === 1 && paidDraws.lastSeed === WIN_SEED, JSON.stringify(paidDraws));
    // Denomination: what the client shows is what the ledger debited.
    const displayed = await page.evaluate(() => ({
      perLine: Number(slotStateData.betline),
      total: Number(slotStateData.bet),
      lines: Number(slotStateData.lines),
    }));
    check('paid.displayed-stake-is-whole-points',
      displayed.perLine === 1 && displayed.total === 10 && displayed.lines === 10,
      JSON.stringify(displayed));
    check('paid.displayed-total-stake-equals-ledger-debit',
      paidMoves.length === 1 && paidMoves[0].amount === BigInt(-displayed.total),
      `displayed=${displayed.total} ledger=${paidMoves[0] && paidMoves[0].amount}`);
    check('paid.exactly-one-debit', paidMoves.length === 1 && paidMoves[0].amount === -10n, `moves=${paidMoves.length} amount=${paidMoves[0] && paidMoves[0].amount}`);
    check('paid.pending-win-not-yet-credited',
      (await prisma.ledgerEntry.count({ where: { wallet: { userId: player.id }, type: 'CASINO_WIN' } })) === 0
      && paid.recovery.pendingWin > 0,
      `pending=${paid.recovery.pendingWin}`);
    check('paid.platform-balance-is-debited-only', paid.recovery.balance === 99_990 && paid.credit === paid.recovery.balance,
      `balance=${paid.recovery.balance} credit=${paid.credit}`);
    await page.screenshot({ path: path.join(SHOT_DIR, '02-paid-round.png') });

    // --- presentation receipt --------------------------------------------
    for (let wait = 0; wait < 60 && receipts.length === 0; wait += 1) await sleep(250);
    const paidReceipt = receipts.find((entry) => entry.actionId === paid.recovery.actionId);
    check('receipt.posted-for-authoritative-action', Boolean(paidReceipt), `actionId=${paid.recovery.actionId}`);
    check('receipt.posted-after-board-rendered',
      Boolean(paidReceipt) && boardMatches(paidReceipt.rendered, paidExpected),
      JSON.stringify(paidReceipt && paidReceipt.rendered).slice(0, 120));

    // --- collect: exactly one credit -------------------------------------
    const pendingBeforeCollect = paid.recovery.pendingWin;
    await page.keyboard.press('Enter');
    await waitForPhase(page, ['IDLE'], 30000);
    await sleep(600);
    const collected = await prisma.ledgerEntry.findMany({ where: { wallet: { userId: player.id }, type: 'CASINO_WIN' } });
    const afterCollect = await page.evaluate(() => window.pilotRecovery);
    check('collect.one-exact-credit',
      collected.length === 1 && collected[0].amount === BigInt(pendingBeforeCollect)
      && afterCollect.pendingWin === 0 && afterCollect.phase === 'IDLE',
      `credits=${collected.length} amount=${collected[0] && collected[0].amount} pending=${pendingBeforeCollect}`);
    check('collect.wallet-reconciles', Number(afterCollect.balance) === 99_990 + pendingBeforeCollect,
      `balance=${afterCollect.balance}`);

    // --- refresh recovery -------------------------------------------------
    const beforeReload = JSON.stringify({ round: afterCollect.roundId, phase: afterCollect.phase, balance: afterCollect.balance });
    await page.reload();
    await waitForReady(page);
    await sleep(900);
    const restored = await page.evaluate(() => window.pilotRecovery);
    const restoredBoard = await boardOf(page).catch(() => null);
    check('recovery.refresh-preserves-state',
      JSON.stringify({ round: restored.roundId, phase: restored.phase, balance: restored.balance }) === beforeReload,
      JSON.stringify({ round: restored.roundId, phase: restored.phase }));
    check('recovery.refresh-restores-same-board',
      Boolean(restoredBoard) && boardMatches(restoredBoard, paidExpected),
      JSON.stringify(restoredBoard).slice(0, 120));
    check('recovery.refresh-adds-no-ledger-row',
      (await prisma.ledgerEntry.count({ where: { wallet: { userId: player.id } } })) === 3,
      'grant + bet + collect');

    // --- free spins with a retrigger -------------------------------------
    await seeds([FEATURE_SEED]);
    check('feature.round-started', await startRound(page, ['FREE_SPINS']), 'phase reached FREE_SPINS');
    await sleep(600);
    let featureState = await page.evaluate(() => window.pilotRecovery);
    check('feature.awards-15-not-future-total',
      featureState.free.total === 15 && featureState.free.current === 0,
      JSON.stringify(featureState.free));
    check('feature.no-future-sequence-exposed',
      !('sequence' in featureState) && !('plannedFeatureSpins' in featureState),
      'server-private future feature stays server-side');
    await page.screenshot({ path: path.join(SHOT_DIR, '03-free-spins.png') });
    let refreshedMidFeature = false;
    for (let spin = 0; spin < 20 && featureState.phase === 'FREE_SPINS'; spin += 1) {
      const before = featureState.free.current;
      await page.waitForFunction(() => slotState === 'WAITBONUS' || (window.pilotRecovery && window.pilotRecovery.phase !== 'FREE_SPINS'),
        null, { timeout: 30000 }).catch(() => {});
      await page.keyboard.press('Enter');
      let advanced = false;
      for (let wait = 0; wait < 40; wait += 1) {
        await sleep(300);
        featureState = await page.evaluate(() => window.pilotRecovery);
        if (featureState.phase !== 'FREE_SPINS' || featureState.free.current > before) { advanced = true; break; }
      }
      if (!advanced) break;
      if (!refreshedMidFeature && featureState.phase === 'FREE_SPINS' && featureState.free.current >= 2) {
        const snapshot = JSON.stringify(featureState.free);
        await page.reload();
        await waitForReady(page);
        await sleep(900);
        featureState = await page.evaluate(() => window.pilotRecovery);
        check('feature.refresh-mid-feature-preserved',
          JSON.stringify(featureState.free) === snapshot && featureState.phase === 'FREE_SPINS',
          JSON.stringify(featureState.free));
        refreshedMidFeature = true;
      }
    }
    check('feature.completes-15-spins', featureState.phase !== 'FREE_SPINS' && featureState.free.current === 15,
      `phase=${featureState.phase} current=${featureState.free.current}`);
    check('feature.no-extra-wager-debit',
      (await prisma.ledgerEntry.count({ where: { wallet: { userId: player.id }, type: 'CASINO_BET' } })) === 2,
      'one debit per paid round');
    check('feature.collect-reaches-idle', await collectToIdle(page), 'collects the pending feature win');
    check('feature.settled-before-next-round', (await page.evaluate(() => window.pilotRecovery.phase)) === 'IDLE',
      'client returned to idle');

    await seeds([RETRIGGER_SEED]);
    check('retrigger.seed-queued', (await stats()).queued === 1, JSON.stringify(await stats()));
    const retriggerStarted = await startRound(page, ['FREE_SPINS']);
    if (!retriggerStarted) {
      const diagnosis = await page.evaluate(() => ({
        phase: window.pilotRecovery && window.pilotRecovery.phase,
        round: window.pilotRecovery && window.pilotRecovery.roundId,
        slotState: typeof slotState === 'string' ? slotState : null,
        balance: window.pilotRecovery && window.pilotRecovery.balance,
        receipts: (window.pilotReceipts || []).length,
      }));
      check('retrigger.round-started', false, JSON.stringify(diagnosis));
      throw new Error(`retrigger round did not start: ${JSON.stringify(diagnosis)}`);
    }
    check('retrigger.round-started', true, 'phase reached FREE_SPINS');
    await sleep(500);
    featureState = await page.evaluate(() => window.pilotRecovery);
    let retriggerObservations = 0;
    let retriggerSeen = false;
    for (let spin = 0; spin < 34 && featureState.phase === 'FREE_SPINS'; spin += 1) {
      const before = featureState.free.total;
      await page.waitForFunction(() => slotState === 'WAITBONUS' || (window.pilotRecovery && window.pilotRecovery.phase !== 'FREE_SPINS'),
        null, { timeout: 30000 }).catch(() => {});
      await page.keyboard.press('Enter');
      let advanced = false;
      for (let wait = 0; wait < 40; wait += 1) {
        await sleep(250);
        featureState = await page.evaluate(() => window.pilotRecovery);
        if (featureState.phase !== 'FREE_SPINS' || featureState.free.current > spin) { advanced = true; break; }
      }
      if (!advanced) break;
      if (featureState.free.total > before) {
        retriggerSeen = true;
        retriggerObservations += 1;
        check('retrigger.adds-15-at-the-live-event', featureState.free.total === before + 15, `${before} -> ${featureState.free.total}`);
      }
    }
    check('retrigger.15-to-30-observed', retriggerSeen && retriggerObservations === 1,
      `observations=${retriggerObservations} total=${featureState.free.total}`);
    check('retrigger.feature-completes-30-spins',
      featureState.phase !== 'FREE_SPINS' && featureState.free.current === 30,
      `phase=${featureState.phase} current=${featureState.free.current}`);
    check('retrigger.collect-reaches-idle', await collectToIdle(page), 'collects the retriggered feature win');

    // --- native red/black gamble -----------------------------------------
    await seeds([WIN_SEED, GAMBLE_WIN_SEED]);
    check('gamble.round-started', await startRound(page, ['PENDING_WIN']), 'phase reached PENDING_WIN');
    await sleep(800);
    const beforeGamble = await page.evaluate(() => window.pilotRecovery);
    check('gamble.entry-reaches-gamble-screen', await enterGamble(page), 'phase reached GAMBLE');
    await page.screenshot({ path: path.join(SHOT_DIR, '04-gamble.png') });
    check('gamble.red-guess-recorded', await playGamble(page, '9'), 'one native red/black attempt');
    const afterGamble = await page.evaluate(() => window.pilotRecovery);
    check('gamble.native-attempt-recorded',
      afterGamble.gamble.attempts >= 1 && afterGamble.gamble.cards.length >= 1,
      JSON.stringify(afterGamble.gamble));
    check('gamble.pending-win-doubles-on-win',
      afterGamble.pendingWin === beforeGamble.pendingWin * 2,
      `${beforeGamble.pendingWin} -> ${afterGamble.pendingWin}`);
    // Refresh in the middle of the gamble: the reels must still be the last
    // spin's board, because the gamble response carries no board of its own.
    const gambleBoard = expectedBoard(beforeGamble.result.serverResponse.reelsSymbols);
    const afterGambleRefresh = await refreshAndRead(page);
    check('gamble.refresh-keeps-the-rounded-state-without-errors',
      afterGambleRefresh.state.phase === 'GAMBLE'
      && afterGambleRefresh.state.pendingWin === afterGamble.pendingWin
      && afterGambleRefresh.state.balance === afterGamble.balance,
      JSON.stringify({
        phase: afterGambleRefresh.state.phase,
        pending: afterGambleRefresh.state.pendingWin,
        balance: afterGambleRefresh.state.balance,
      }));
    check('gamble.refresh-restores-the-last-spin-board',
      Boolean(afterGambleRefresh.board) && boardMatches(afterGambleRefresh.board, gambleBoard),
      JSON.stringify(afterGambleRefresh.board).slice(0, 120));
    check('gamble.refresh-keeps-the-native-gamble-presentation',
      Array.isArray(afterGambleRefresh.state.gamble.cards)
      && afterGambleRefresh.state.gamble.attempts >= 1
      && afterGambleRefresh.state.gamble.cards.length >= 1,
      JSON.stringify(afterGambleRefresh.state.gamble));
    check('gamble.moves-no-ledger-entries',
      (await prisma.ledgerEntry.count({ where: { wallet: { userId: player.id }, type: 'CASINO_WIN' } })) === 3,
      'credits only at collect');
    check('gamble.collect-reaches-idle', await collectToIdle(page), 'collects the gambled win');
    await sleep(600);
    const gambleCredits = await prisma.ledgerEntry.findMany({
      where: { wallet: { userId: player.id }, type: 'CASINO_WIN' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    check('gamble.collect-credits-the-doubled-pending',
      gambleCredits.length === 4 && gambleCredits[3].amount === BigInt(afterGamble.pendingWin),
      `credits=${gambleCredits.length} last=${gambleCredits[3] && gambleCredits[3].amount}`);

    // Refresh right after collecting a gambled win.
    const afterGambleCollectRefresh = await refreshAndRead(page);
    const walletAfterCollect = await walletBalance(player.id);
    check('gamble.refresh-after-collect-is-stable',
      afterGambleCollectRefresh.state.phase === 'IDLE'
      && afterGambleCollectRefresh.state.pendingWin === 0
      && afterGambleCollectRefresh.state.balance === Number(walletAfterCollect),
      JSON.stringify({
        phase: afterGambleCollectRefresh.state.phase,
        balance: afterGambleCollectRefresh.state.balance,
        wallet: walletAfterCollect.toString(),
      }));
    check('gamble.refresh-after-collect-keeps-the-board',
      Boolean(afterGambleCollectRefresh.board) && boardMatches(afterGambleCollectRefresh.board, gambleBoard),
      JSON.stringify(afterGambleCollectRefresh.board).slice(0, 120));

    // A losing gamble closes the round with no ledger movement at all.
    await seeds([WIN_SEED, GAMBLE_LOSE_SEED]);
    check('gamble-loss.round-started', await startRound(page, ['PENDING_WIN']), 'phase reached PENDING_WIN');
    await sleep(800);
    const beforeLoss = await page.evaluate(() => window.pilotRecovery);
    const lossBoard = expectedBoard(beforeLoss.result.serverResponse.reelsSymbols);
    const walletBeforeLoss = await walletBalance(player.id);
    const ledgerRowsBeforeLoss = await prisma.ledgerEntry.count({ where: { wallet: { userId: player.id } } });
    check('gamble-loss.entry-reaches-gamble-screen', await enterGamble(page), 'phase reached GAMBLE');
    check('gamble-loss.red-guess-recorded', await playGamble(page, '9'), 'one native red/black attempt');
    const afterLoss = await page.evaluate(() => window.pilotRecovery);
    check('gamble-loss.closes-with-zero-pending',
      afterLoss.phase === 'IDLE' && afterLoss.pendingWin === 0,
      JSON.stringify({ phase: afterLoss.phase, pending: afterLoss.pendingWin }));
    check('gamble-loss-debits-no-stake-and-credits-nothing',
      (await walletBalance(player.id)) === walletBeforeLoss
      && (await prisma.ledgerEntry.count({ where: { wallet: { userId: player.id } } })) === ledgerRowsBeforeLoss,
      `wallet ${walletBeforeLoss.toString()}`);
    const afterLossRefresh = await refreshAndRead(page);
    check('gamble-loss.refresh-keeps-idle-state-without-errors',
      afterLossRefresh.state.phase === 'IDLE'
      && afterLossRefresh.state.pendingWin === 0
      && afterLossRefresh.state.balance === afterLoss.balance,
      JSON.stringify({ phase: afterLossRefresh.state.phase, pending: afterLossRefresh.state.pendingWin }));
    check('gamble-loss.refresh-restores-the-last-spin-board',
      Boolean(afterLossRefresh.board) && boardMatches(afterLossRefresh.board, lossBoard),
      JSON.stringify(afterLossRefresh.board).slice(0, 120));

    // --- IDOR: the rival's session cannot see the player's round ----------
    const rivalLaunch = await fetch(`${HARNESS}/casino/lucky-lady/launch`, {
      method: 'POST',
      headers: { authorization: `Bearer ${rivalToken}`, 'content-type': 'application/json' },
      body: '{}',
    });
    const rivalTokenBody = await rivalLaunch.json();
    const rivalExchange = await fetch(`${HARNESS}/casino/lucky-lady/launch/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: rivalTokenBody.token }),
    });
    const rivalSession = await rivalExchange.json();
    const rivalSettings = await fetch(`${HARNESS}/casino/lucky-lady/session/gameplay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lucky-session': rivalSession.sessionToken },
      body: JSON.stringify({ slotEvent: 'getSettings' }),
    });
    const rivalView = await rivalSettings.json();
    check('idor.rival-sees-own-empty-state',
      rivalView.recovery.roundId === 'none' && rivalView.recovery.balance === 1000,
      JSON.stringify({ round: rivalView.recovery.roundId, balance: rivalView.recovery.balance }));
    const rivalSteal = await fetch(`${HARNESS}/casino/lucky-lady/session/gameplay`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-lucky-session': rivalSession.sessionToken,
        'x-pilot-request-id': `ido-${Date.now().toString(36)}`,
        'x-pilot-version': String(afterGamble.version),
        'x-pilot-round': afterGamble.roundId,
      },
      body: JSON.stringify({ slotEvent: 'bet', slotBet: 1, slotLines: 10 }),
    });
    check('idor.cross-user-round-header-refused', rivalSteal.status === 409, `status=${rivalSteal.status}`);

    // --- reconciliation ---------------------------------------------------
    const entries = await prisma.ledgerEntry.findMany({ where: { wallet: { userId: player.id } } });
    const sum = entries.reduce((total, entry) => total + entry.amount, 0n);
    check('ledger.sum-equals-wallet-delta', sum === await walletBalance(player.id), `${sum} vs ${await walletBalance(player.id)}`);
    check('ledger.rows-carry-reason-and-key',
      entries.every((entry) => entry.reason.length > 0 && entry.idempotencyKey.length > 0),
      `${entries.length} entries`);

    // --- the REAL Next launcher page -------------------------------------
    // Everything above drove the platform API directly. This stage drives the
    // authenticated Next page a player actually uses: sign in, click Launch
    // game, and let the form POST open the game in a new tab.
    const untrustedOrigin = await context.request.post(`${GATEWAY}/launch`, {
      headers: { origin: 'http://attacker.example' },
      form: { token: 'x'.repeat(43) },
      maxRedirects: 0,
    });
    check('launcher.untrusted-launch-origin-blocked', untrustedOrigin.status() === 403,
      `status=${untrustedOrigin.status()}`);
    const missingOrigin = await context.request.post(`${GATEWAY}/launch`, {
      form: { token: 'x'.repeat(43) }, maxRedirects: 0,
    });
    check('launcher.missing-launch-origin-blocked', missingOrigin.status() === 403,
      `status=${missingOrigin.status()}`);
    const foreignGameplay = await context.request.post(`${GATEWAY}/game/LuckyLadysCharmDX/server`, {
      headers: { origin: 'http://attacker.example' },
      data: { slotEvent: 'getSettings' },
    });
    check('launcher.foreign-origin-gameplay-blocked', foreignGameplay.status() === 403,
      `status=${foreignGameplay.status()}`);
    for (const [label, origin] of [['configured', FRONTEND], ['noreferrer-null', 'null']]) {
      const probe = await context.request.post(`${GATEWAY}/launch`, {
        headers: { origin },
        form: { token: 'not-a-real-launch-token-value-here-at-all' },
        maxRedirects: 0,
      });
      check(`launcher.${label}-origin-authorization`, probe.status() === (origin === 'null' ? 403 : 401),
        `status=${probe.status()}`);
    }

    const launcher = await context.newPage();
    launcher.on('pageerror', (error) => pageErrors.push(`launcher: ${error.message}`));
    const launcherLogin = await context.request.post(`${HARNESS}/auth/login`, {
      data: { email: player.email, password },
    });
    check('launcher.sign-in-succeeds', launcherLogin.ok(), `status=${launcherLogin.status()}`);
    await launcher.goto(LAUNCH_PAGE);
    const launchButton = launcher.getByRole('button', { name: 'Launch game' });
    await launchButton.waitFor({ state: 'visible', timeout: 90000 });
    check('launcher.page-offers-the-play-action', await launchButton.isEnabled(), 'button enabled');
    await launcher.screenshot({ path: path.join(SHOT_DIR, '06-launcher.png') });

    const [gameTab] = await Promise.all([
      context.waitForEvent('page'),
      launchButton.click(),
    ]);
    gameTab.on('pageerror', (error) => pageErrors.push(`launcher-game: ${error.message}`));
    await gameTab.waitForLoadState('domcontentloaded');
    await gameTab.waitForFunction(() => window.pilotRecoveryReady === true, null, { timeout: 90000 });
    await sleep(1200);
    const gameUrl = gameTab.url();
    check('launcher.new-tab-lands-on-the-clean-game-url',
      gameUrl.startsWith(`${GATEWAY}/play`) && !gameUrl.includes('token'),
      gameUrl);
    const ledgerBalance = await walletBalance(player.id);
    const gameTabState = await gameTab.evaluate(() => window.pilotRecovery);
    check('launcher.game-tab-sees-the-platform-wallet',
      gameTabState.balance === Number(ledgerBalance),
      `${gameTabState.balance} vs ${ledgerBalance.toString()}`);
    check('launcher.game-tab-loads-the-native-symbol-set',
      (await gameTab.evaluate(() => slotSettings.SymbolGame.length)) === 15,
      'fifteen native symbols');

    // One real paid round from the launcher tab.
    const debitsBeforeLauncherSpin = await prisma.ledgerEntry.count({
      where: { wallet: { userId: player.id }, type: 'CASINO_BET' },
    });
    const actionBeforeLauncherSpin = gameTabState.actionId;
    await gameTab.keyboard.press('Enter');
    // The tab restores the previous round, so wait for a genuinely NEW
    // authoritative action rather than for "a result exists".
    await gameTab.waitForFunction(
      (previous) => window.pilotRecovery && window.pilotRecovery.actionId
        && window.pilotRecovery.actionId !== previous,
      actionBeforeLauncherSpin,
      { timeout: 60000 },
    );
    await gameTab
      .waitForFunction(() => slotState === 'IDLE' || slotState === 'AFTERWIN', null, { timeout: 30000 })
      .catch(() => {});
    await sleep(1200);
    const launcherSpin = await gameTab.evaluate(() => {
      const ids = {};
      gameReels._view.children.forEach((reel, index) => {
        const height = (typeof symHeight === 'number' && symHeight > 0) ? symHeight : 88;
        ids[`reel${index + 1}`] = reel.children
          .filter((symbol) => symbol.texture && symbol.texture.textureCacheIds
            && symbol.texture.textureCacheIds[0] && symbol.y >= 0 && symbol.y < height * 3 - 1)
          .sort((left, right) => left.y - right.y)
          .slice(0, 3)
          .map((symbol) => symbol.texture.textureCacheIds[0]);
      });
      return { state: window.pilotRecovery, board: ids };
    });
    const launcherExpected = expectedBoard(launcherSpin.state.result.serverResponse.reelsSymbols);
    check('launcher.paid-round-board-matches-the-server',
      boardMatches(launcherSpin.board, launcherExpected),
      JSON.stringify(launcherSpin.board).slice(0, 120));
    const debitsAfterLauncherSpin = await prisma.ledgerEntry.count({
      where: { wallet: { userId: player.id }, type: 'CASINO_BET' },
    });
    check('launcher.paid-round-debits-exactly-once',
      debitsAfterLauncherSpin === debitsBeforeLauncherSpin + 1,
      `${debitsBeforeLauncherSpin} -> ${debitsAfterLauncherSpin}`);
    await gameTab.screenshot({ path: path.join(SHOT_DIR, '07-launcher-game.png') });

    const draws = await stats();
    // Five paid rounds plus two gamble draws from the scripted stages, plus the
    // launcher tab's own paid round.
    check('rng.production-path-draws-one-per-paid-round-and-gamble', draws.draws === 8, JSON.stringify(draws));
    check('network.no-external-requests', outbound.length === 0, outbound.slice(0, 3).join(','));
    check('client.no-page-errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

    const manifestAfter = clientManifest();
    check('client.185-files-unchanged',
      JSON.stringify(manifestAfter) === JSON.stringify(manifestBefore),
      'manifest identical');
    await page.screenshot({ path: path.join(SHOT_DIR, '05-final.png') });
    shots.push(
      '01-idle.png', '02-paid-round.png', '03-free-spins.png', '04-gamble.png',
      '05-final.png', '06-launcher.png', '07-launcher-game.png',
    );
  } catch (error) {
    check('suite.completed-without-exception', false, error && error.stack ? error.stack.split('\n').slice(0, 3).join(' | ') : String(error));
  } finally {
    try { if (browser) await browser.close(); } catch (error) { /* ignore */ }
    for (const child of [harness, gateway, frontend]) {
      try { if (child) child.kill(); } catch (error) { /* ignore */ }
    }
    try { await prisma.$disconnect(); } catch (error) { /* ignore */ }
  }

  const failed = results.filter((entry) => !entry.ok);
  const report = {
    generatedAt: new Date().toISOString(),
    checks: results.length,
    failures: failed.length,
    results,
    outboundRequests: outbound,
    pageErrors,
    childErrors: errors,
    screenshots: shots,
  };
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'browser-check.json'), `${JSON.stringify(report, null, 1)}\n`);
  process.stdout.write(`${JSON.stringify({ checks: results.length, failures: failed.length, failed: failed.map((entry) => entry.name) })}\n`);
  process.exit(failed.length === 0 ? 0 : 1);
})();
