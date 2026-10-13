/**
 * Bounded real-UI E2E for Book of Ra Classic only.
 *
 * Boots the production backend, the production Next build and the Classic
 * gateway on distinct loopback hostnames, then drives the real launcher page
 * and the recovered native client in headless Chrome. The paid spin is a real
 * pointer click on the client's own spin button; the native protocol request
 * and response are captured from the browser network, then compared with the
 * authoritative round, ledger and wallet rows.
 *
 * Usage (repo root, DATABASE_URL, REDIS_URL and BOOK_E2E_PASSWORD in env):
 *   node scripts/e2e/book-classic-paid-spin-e2e.mjs
 *
 * BOOK_E2E_API_PORT and BOOK_E2E_GATEWAY_PORT default to 3001 and 8791.
 * Point them at a private stack so this run does not share another agent's ports.
 *
 * BOOK_E2E_WIN_CAPTURE=1 waits until each paid round is terminal, screenshots
 * the first counted-up win before any later spin, then replays that spin's own
 * x-pilot-request-id. It does not change the production RNG. A bounded miss is
 * recorded as not observed; it is not a product failure.
 */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mapClientToStage, invertStageToClient, targetContainsPoint } from './lib/classic-hit-guard.mjs';
import { classicReelsMatch, persistedClassicReels } from './classic-persisted-board.mjs';

const require = createRequire(import.meta.url);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const WIN_CAPTURE = process.env.BOOK_E2E_WIN_CAPTURE === '1';
const WIN_CAPTURE_SPINS = Number(process.env.BOOK_E2E_WIN_CAPTURE_SPINS ?? 12);
const EVIDENCE = join(
  ROOT,
  'docs',
  'agent-work',
  'book-completion',
  'evidence',
  `${WIN_CAPTURE ? 'classic-overnight' : 'classic-paid-spin-e2e'}-${RUN_ID}`,
);
const PLAYWRIGHT = process.env.BOOK_E2E_PLAYWRIGHT
  ?? 'C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js';
const CHROME = process.env.BOOK_E2E_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const API_PORT = Number(process.env.BOOK_E2E_API_PORT ?? 3001);
const API = `http://localhost:${API_PORT}`;       // platform hostname
const GATEWAY_PORT = Number(process.env.BOOK_E2E_GATEWAY_PORT ?? 8791);
const CLASSIC = `http://127.0.0.1:${GATEWAY_PORT}`; // game hostname (distinct from the platform)
const FE_PORT = Number(process.env.BOOK_E2E_FRONTEND_PORT ?? 3017);
const FRONTEND = `http://localhost:${FE_PORT}`;
const PASSWORD = process.env.BOOK_E2E_PASSWORD ?? '';
const VIEWPORT_SPEC = process.env.BOOK_E2E_VIEWPORT ?? '1440x900';
const [VIEWPORT_WIDTH, VIEWPORT_HEIGHT] = VIEWPORT_SPEC.split('x').map((value) => Number(value));
const PREFIX = `bcp${Date.now().toString(36)}`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` :: ${detail}`}\n`);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const maskEmail = (value) => String(value).replace(/^(.{1,3}).*(@.*)$/, '$1***$2');

const children = [];
function start(label, command, args, cwd, env) {
  const child = spawn(command, args, {
    cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const record = { label, child, log: [], exited: null };
  child.stdout.on('data', (chunk) => record.log.push(String(chunk)));
  child.stderr.on('data', (chunk) => record.log.push(String(chunk)));
  child.on('exit', (code) => { record.exited = code; record.log.push(`\n[${label}] exited ${code}\n`); });
  children.push(record);
  return record;
}

async function stopChild(record) {
  if (record.exited !== null) return;
  await new Promise((resolve) => {
    const killer = spawn('taskkill', ['/PID', String(record.child.pid), '/T', '/F'], { windowsHide: true });
    killer.on('exit', resolve);
    killer.on('error', resolve);
  });
}

async function waitForHttp(url, record) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (record?.exited !== null) return false;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return true;
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  return false;
}

const portListeners = async (port) => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
    return response.status > 0;
  } catch { return false; }
};

async function main() {
  mkdirSync(EVIDENCE, { recursive: true });
  const { PrismaClient } = await import('@prisma/client');
  const { chromium } = require(PLAYWRIGHT);
  const prisma = new PrismaClient();
  const report = {
    mode: 'book-of-ra-classic-paid-spin',
    namespace: PREFIX,
    startedAt: new Date().toISOString(),
    api: API, frontend: FRONTEND, classic: CLASSIC,
    results, ui: {}, persisted: {}, pages: [],
  };
  let browser = null;

  try {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    if (!process.env.REDIS_URL) throw new Error('REDIS_URL is required');
    if (!PASSWORD) throw new Error('BOOK_E2E_PASSWORD is required');

    const backend = start('backend', 'node', ['dist/src/main.js'], join(ROOT, 'backend'), {
      NODE_ENV: 'development',
      PORT: String(API_PORT),
      HOST: '127.0.0.1',
      FRONTEND_URL: FRONTEND,
      CORS_ORIGINS: FRONTEND,
      COOKIE_SECURE: 'false',
      TRUST_PROXY: 'false',
      CASINO_CRASH_WORKER_ENABLED: 'false',
      // The fixture identity is reused from the isolated test database; the
      // registration route is not called and stays disabled for this run.
      REGISTRATION_ENABLED: 'false',
      JWT_ACCESS_SECRET: sha256(`${PREFIX}:access`),
      JWT_REFRESH_SECRET: sha256(`${PREFIX}:refresh`),
      PASSWORD_VAULT_KEY: Buffer.alloc(32, 7).toString('base64'),
    });
    check('backend-health', await waitForHttp(`${API}/health/live`, backend), `${API}/health/live exited=${backend.exited}`);
    if (backend.exited !== null) return;

    const frontend = start('frontend', 'node', [join(ROOT, 'node_modules/next/dist/bin/next'), 'start', '-p', String(FE_PORT), '-H', '127.0.0.1'], join(ROOT, 'frontend'), { NODE_ENV: 'production' });
    check('frontend-ready', await waitForHttp(`${FRONTEND}/login`, frontend), `${FRONTEND}/login exited=${frontend.exited}`);
    if (frontend.exited !== null) return;

    const gateway = start('classic-gateway', 'node', ['games/book-of-ra-classic/gateway/server.mjs'], ROOT, {
      BOOK_CLASSIC_GATEWAY_PORT: String(GATEWAY_PORT),
      BOOK_CLASSIC_GATEWAY_HOST: '127.0.0.1',
      BOOK_CLASSIC_ORIGIN: CLASSIC,
      PLATFORM_URL: API,
      BOOK_CLASSIC_CLIENT_DIR: join(ROOT, 'games', 'book-of-ra-classic', 'client'),
      BOOK_CLASSIC_LAUNCH_ORIGINS: FRONTEND,
    });
    check('classic-gateway-health', await waitForHttp(`${CLASSIC}/healthz`, gateway), `${CLASSIC}/healthz exited=${gateway.exited}`);
    if (gateway.exited !== null) return;

    // --- existing isolated fixture identity (no registration this task) ---
    const existing = await prisma.user.findFirst({
      where: {
        email: { endsWith: '@example.test' }, disabled: false, totp: null,
        wallet: { is: { balance: { gte: 100_000n } } },
      },
      orderBy: { createdAt: 'desc' },
      select: { email: true },
    });
    const email = process.env.BOOK_E2E_FIXTURE_EMAIL ?? existing?.email ?? null;
    check('fixture-identity-reused', Boolean(email),
      email ? `existing fixture ${maskEmail(email)}; 0 registration calls` : 'no eligible existing fixture with a funded wallet');
    if (!email) { report.abort = 'no reusable fixture identity'; return; }
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    report.registration = { calls: 0, note: 'registration disabled; existing fixture identity reused' };
    report.fixture = {
      email: maskEmail(email), createdAt: user.createdAt.toISOString(), balance: String(wallet.balance),
      funded: wallet.balance >= 100_000n, roundsBeforeRun: await prisma.casinoRound.count({ where: { userId: user.id } }),
    };

    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    report.browser = await browser.version();
    report.viewport = { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT };
    const context = await browser.newContext({ viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT } });
    const pageErrors = [];
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(`launcher:${error.message}`));

    // Auth is established through the platform's own API from the platform
    // origin; everything after this point is driven through real UI.
    await page.goto(`${FRONTEND}/login`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async ({ api, address, password }) => {
      const response = await fetch(`${api}/auth/login`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: address, password }),
      });
      if (!response.ok) throw new Error(`login ${response.status}`);
    }, { api: API, address: email, password: PASSWORD });

    // --- real launcher page ----------------------------------------------
    await page.goto(`${FRONTEND}/casino/slots/book-of-ra-classic`, { waitUntil: 'networkidle' });
    await page.locator('button.casino-play').waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForFunction(() => {
      const button = document.querySelector('button.casino-play');
      return button instanceof HTMLButtonElement && !button.disabled;
    }, null, { timeout: 30_000 });
    const launcherBalance = await page.locator('.casino-stats').innerText().catch(() => '');
    await page.screenshot({ path: join(EVIDENCE, 'launcher-page.png') });
    report.ui.launcherLayout = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      playVisible: (() => {
        const button = document.querySelector('button.casino-play');
        if (!(button instanceof HTMLButtonElement)) return false;
        const rect = button.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight;
      })(),
    })).catch((error) => ({ error: String(error) }));
    check('launcher-capability-issued', /balance/i.test(launcherBalance), launcherBalance.replace(/\s+/g, ' ').slice(0, 120));

    const [game] = await Promise.all([
      context.waitForEvent('page'),
      page.locator('button.casino-play').click(),
    ]);
    await game.waitForLoadState('load');
    game.on('pageerror', (error) => pageErrors.push(`classic-game:${error.message}`));
    check('launcher-opens-game', game.url().startsWith(`${CLASSIC}/play`), game.url());

    // --- native protocol traffic from the client's own UI ----------------
    const traffic = [];
    const betReplays = [];
    game.on('request', (request) => {
      if (!request.url().includes('/game/BookOfRaCL/server')) return;
      let body = null;
      try { body = JSON.parse(request.postData() ?? 'null'); } catch { body = request.postData(); }
      traffic.push({ phase: 'request', at: Date.now(), slotEvent: body?.slotEvent, body });
      if (body?.slotEvent === 'bet') {
        const headers = request.headers();
        betReplays.push({
          url: request.url(),
          postData: request.postData(),
          requestId: headers['x-pilot-request-id'] ?? '',
          version: headers['x-pilot-version'] ?? '',
          round: headers['x-pilot-round'] ?? '',
        });
      }
    });
    game.on('response', async (response) => {
      if (!response.url().includes('/game/BookOfRaCL/server')) return;
      let body = null;
      try { body = await response.json(); } catch { body = null; }
      traffic.push({ phase: 'response', at: Date.now(), status: response.status(), body });
    });

    await game.waitForFunction(() => window.isFontLoaded === true && typeof window.gameUI?.GetObject === 'function', null, { timeout: 45_000 });
    // Locate the client's own spin control through the client's own
    // screen->stage mapping (interaction.mapPositionToPoint), inverted
    // deterministically per axis by bisection, then confirmed with the same
    // plugin's hit test before any pointer event is sent.
    const geometry = await game.evaluate(() => {
      const button = window.gameUI?.GetObject?.()?.['uiButtonSpin'];
      const target = button?._view;
      if (!target) return { error: 'uiButtonSpin missing' };
      const view = window.app?.view ?? document.querySelector('canvas');
      if (!view) return { error: 'no canvas' };
      const rect = view.getBoundingClientRect();
      // Live stage-space point: centre of the sprite's own content through the
      // display tree's current transform (never cached/stale bounds).
      const origin = target.getGlobalPosition ? target.getGlobalPosition() : { x: target.position.x, y: target.position.y };
      const lb = typeof target.getLocalBounds === 'function' ? target.getLocalBounds() : { x: 0, y: 0, width: target.width, height: target.height };
      const localCentre = new window.PIXI.Point(lb.x + lb.width / 2, lb.y + lb.height / 2);
      const gp = typeof target.toGlobal === 'function' ? target.toGlobal(localCentre) : origin;
      // Serializable live geometry only; all Node math runs in the harness.
      return {
        localCentre: { x: localCentre.x, y: localCentre.y },
        stageOrigin: { x: origin.x, y: origin.y },
        stage: { x: gp.x, y: gp.y },
        mapOpts: {
          canvasWidth: view.width, canvasHeight: view.height,
          rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
          resolution: window.app?.renderer?.resolution ?? 1,
        },
        bounds: { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
        canvas: { width: view.width, height: view.height, cssWidth: view.style.width, cssHeight: view.style.height, cssLeft: view.style.left, cssTop: view.style.top },
        resolution: window.app?.renderer?.resolution,
        visible: target.visible === true, worldVisible: target.worldVisible !== false,
        interactive: target.interactive !== false,
        hasHitArea: Boolean(target.hitArea && typeof target.hitArea.contains === 'function'),
      };
    });
    if (geometry.error !== undefined) {
      check('classic-client-boots', false, JSON.stringify(geometry));
      report.ui.spinButton = geometry;
      return;
    }
    // Node-side shared math path (classic-hit-guard): exact analytic inverse of
    // the plugin's own mapPositionToPoint (affine) plus round-trip probe.
    const mapOpts = {
      canvasWidth: geometry.mapOpts.canvasWidth, canvasHeight: geometry.mapOpts.canvasHeight,
      rect: geometry.mapOpts.rect, resolution: geometry.mapOpts.resolution,
    };
    const point = invertStageToClient(geometry.stage.x, geometry.stage.y, mapOpts);
    const probe = mapClientToStage(point.x, point.y, mapOpts);
    const roundTripDelta = { x: probe.x - geometry.stage.x, y: probe.y - geometry.stage.y };
    // Browser hit validation with plain numbers only: PIXI 4.5.1 processInteractive
    // hit rule. A Sprite's containsPoint() takes the GLOBAL point and applies
    // worldTransform.applyInverse internally, so it is called with the global
    // point untouched (never pre-inverted => no double transform). Explicit
    // hitArea uses the local inverse, which is correct.
    const hitData = await game.evaluate(({ gpX, gpY, clientX, clientY }) => {
      const target = window.gameUI?.GetObject?.()?.['uiButtonSpin']?._view;
      const interaction = window.app?.renderer?.plugins?.interaction;
      const view = window.app?.view ?? document.querySelector('canvas');
      if (!target) return { error: 'target missing' };
      const global = new window.PIXI.Point(gpX, gpY);
      const local = target.worldTransform.applyInverse(global, new window.PIXI.Point());
      let containsPoint = null;
      let guardMethod = null;
      if (target.hitArea && typeof target.hitArea.contains === 'function') {
        containsPoint = target.hitArea.contains(local.x, local.y) === true;
        guardMethod = 'hitArea';
      } else if (typeof target.containsPoint === 'function') {
        containsPoint = target.containsPoint(global) === true;
        guardMethod = 'pixi.containsPoint(global)';
      } else {
        containsPoint = local.x >= 0 && local.y >= 0 && local.x <= target.width && local.y <= target.height;
        guardMethod = 'localBounds';
      }
      let hitTestCount = null;
      try {
        const hitResult = interaction.hitTest(global);
        hitTestCount = hitResult ? 1 : 0;
      } catch { hitTestCount = 'error'; }
      const top = document.elementFromPoint(clientX, clientY);
      return {
        local: { x: Math.round(local.x * 100) / 100, y: Math.round(local.y * 100) / 100 },
        rawContainsPointGlobal: typeof target.containsPoint === 'function' ? target.containsPoint(global) === true : null,
        containsPoint, guardMethod, hitTestCount,
        elementAtPoint: top === view ? 'canvas' : String(top?.tagName ?? 'none'),
      };
    }, { gpX: geometry.stage.x, gpY: geometry.stage.y, clientX: point.x, clientY: point.y });
    const spinButton = {
      ...geometry,
      ...hitData,
      x: Math.round(point.x * 1000) / 1000, y: Math.round(point.y * 1000) / 1000,
      strategy: 'exact-mapPositionToPoint-inverse',
      stageOrigin: { x: Math.round(geometry.stageOrigin.x * 100) / 100, y: Math.round(geometry.stageOrigin.y * 100) / 100 },
      stage: { x: Math.round(geometry.stage.x * 100) / 100, y: Math.round(geometry.stage.y * 100) / 100 },
      stageProbe: { x: Math.round(probe.x * 100) / 100, y: Math.round(probe.y * 100) / 100 },
      roundTripDelta: { x: Math.round(roundTripDelta.x * 1e6) / 1e6, y: Math.round(roundTripDelta.y * 1e6) / 1e6 },
    };
    delete spinButton.mapOpts;
    check('classic-client-boots', Boolean(spinButton) && spinButton.error === undefined && spinButton.visible === true, JSON.stringify(spinButton));
    report.ui.spinButton = spinButton;
    await game.screenshot({ path: join(EVIDENCE, 'classic-client-ready.png') });
    const targetable = spinButton.error === undefined && spinButton.visible === true && spinButton.worldVisible === true
      && spinButton.interactive === true && spinButton.containsPoint === true && spinButton.elementAtPoint === 'canvas';
    check('spin-control-targetable', targetable, JSON.stringify(spinButton));
    report.ui.gameLayout = await game.evaluate(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    })).catch((error) => ({ error: String(error) }));
    if (!targetable) { report.abort = 'spin control not targetable with a native pointer'; return; }

    const settingsDeadline = Date.now() + 30_000;
    while (Date.now() < settingsDeadline && !traffic.some((entry) => entry.phase === 'response')) await sleep(250);
    const settings = traffic.find((entry) => entry.phase === 'response');
    check('client-bootstrap-settings-resolved', settings?.status === 200, JSON.stringify(settings?.body)?.slice(0, 200) ?? 'no response');

    // Single real pointer interaction with the client's own spin control:
    // move, press and release are native browser input events at the derived
    // viewport point. No game function is called and no request is fabricated.
    const readCabinet = () => game.evaluate(() => ({
      slotState: typeof slotState === 'string' ? slotState : null,
      totalWin: window.slotStateData?.totalWin ?? null,
      oldWin: window.slotStateData?.oldWin ?? null,
      credit: window.slotStateData?.credit ?? null,
    })).catch(() => ({ slotState: null, totalWin: null }));

    const clickNamed = async (name) => {
      const located = await game.evaluate((buttonName) => {
        const target = window.gameUI?.GetObject?.()?.[buttonName]?._view;
        if (!target || target.visible === false || target.worldVisible === false) return null;
        const bounds = typeof target.getLocalBounds === 'function'
          ? target.getLocalBounds()
          : { x: 0, y: 0, width: target.width, height: target.height };
        const centre = new window.PIXI.Point(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        const global = typeof target.toGlobal === 'function' ? target.toGlobal(centre) : { x: target.position.x, y: target.position.y };
        const view = window.app?.view ?? document.querySelector('canvas');
        const rect = view.getBoundingClientRect();
        return {
          stage: { x: global.x, y: global.y },
          mapOpts: {
            canvasWidth: view.width,
            canvasHeight: view.height,
            rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
            resolution: window.app?.renderer?.resolution ?? 1,
          },
        };
      }, name);
      if (!located) return false;
      const point = invertStageToClient(located.stage.x, located.stage.y, located.mapOpts);
      await game.mouse.move(point.x, point.y, { steps: 4 });
      await game.mouse.down();
      await game.waitForTimeout(80);
      await game.mouse.up();
      return true;
    };

    // A line win stays PENDING_WIN until the player clicks the spin control,
    // which the recovery client turns into recoveryCollect. Waiting alone never
    // credits it. Skip ends the count-up; the following spin click collects.
    const presentAndCollect = async (roundId, shotName) => {
      const deadline = Date.now() + 20_000;
      let shot = false;
      let skipped = false;
      let collected = false;
      while (Date.now() < deadline) {
        const current = await prisma.casinoRound.findUnique({ where: { id: roundId } });
        if (current && (current.status === 'CASHED_OUT' || current.status === 'LOST')) return current;
        const cabinet = await readCabinet();
        const reelsSettled = ['WINNING', 'AFTERWIN', 'GAMBLE'].includes(cabinet.slotState);
        if (reelsSettled && shotName && !shot) {
          await game.screenshot({ path: join(EVIDENCE, shotName) });
          shot = true;
        }
        if (!skipped && cabinet.slotState === 'WINNING') {
          skipped = await clickNamed('uiButtonSkip');
          await sleep(500);
          continue;
        }
        if (!collected && (cabinet.slotState === 'AFTERWIN' || cabinet.slotState === 'GAMBLE')) {
          collected = await clickNamed('uiButtonSpin');
          await sleep(400);
          continue;
        }
        await sleep(300);
      }
      return prisma.casinoRound.findUnique({ where: { id: roundId } });
    };

    if (WIN_CAPTURE) {
      const open = await prisma.casinoRound.findFirst({
        where: { userId: user.id, status: 'OPEN', gameVersion: { startsWith: 'book-of-ra-classic' } },
        orderBy: { createdAt: 'desc' },
      });
      const openPhase = open?.privateState?.phase ?? null;
      if (open && (openPhase === 'PENDING_WIN' || openPhase === 'GAMBLE')) {
        const recovered = await presentAndCollect(open.id, 'classic-recovered-pending.png');
        const recoveredLedger = await prisma.ledgerEntry.findMany({
          where: { relatedCasinoRoundId: open.id }, orderBy: { createdAt: 'asc' },
        });
        report.persisted.recoveredPending = {
          id: open.id,
          phase: openPhase,
          status: recovered?.status ?? null,
          payout: recovered ? String(recovered.payout) : null,
          ledger: recoveredLedger.map((entry) => ({ type: entry.type, amount: String(entry.amount) })),
          requestIdAvailable: false,
        };
        check('recovered-pending-collected',
          recovered?.status === 'CASHED_OUT' && recovered.payout > 0n
            && recoveredLedger.filter((entry) => entry.type === 'CASINO_WIN').length === 1,
          JSON.stringify(report.persisted.recoveredPending));
      }
    }

    const before = await prisma.wallet.findUnique({ where: { userId: user.id } });
    const roundsBefore = await prisma.casinoRound.count({ where: { userId: user.id } });
    const previousRoundId = (await prisma.casinoRound.findFirst({
      where: { userId: user.id, gameVersion: { startsWith: 'book-of-ra-classic' } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    }))?.id ?? null;
    if (WIN_CAPTURE) {
      const idleDeadline = Date.now() + 15_000;
      let idleState = null;
      while (Date.now() < idleDeadline) {
        idleState = await readCabinet();
        if (idleState.slotState === 'IDLE') break;
        await sleep(200);
      }
      report.ui.idleBeforeSpin = idleState?.slotState ?? null;
    }
    await game.bringToFront();
    await game.mouse.move(spinButton.x, spinButton.y, { steps: 8 });
    await game.waitForTimeout(150);
    // Corroboration only (no click): with a real pointer event now registered,
    // the plugin's own hit test can confirm the sprite under the pointer.
    report.ui.hoverHitTest = await game.evaluate(({ x, y }) => {
      const interaction = window.app?.renderer?.plugins?.interaction;
      const target = window.gameUI?.GetObject?.()?.['uiButtonSpin']?._view;
      if (!interaction || !target) return { error: 'unavailable' };
      const point = new window.PIXI.Point();
      interaction.mapPositionToPoint(point, x, y);
      const result = interaction.hitTest(point);
      const list = Array.isArray(result)
        ? result
        : (result && typeof result.values === 'function' ? Array.from(result.values()) : Object.values(result ?? {}));
      return { count: list.length, hitsTarget: list.some((node) => node === target || node?.parent === target) };
    }, { x: spinButton.x, y: spinButton.y }).catch((error) => ({ error: String(error?.message ?? error) }));
    await game.mouse.down();
    await game.waitForTimeout(80);
    await game.mouse.up();
    report.ui.click = {
      at: new Date().toISOString(), x: spinButton.x, y: spinButton.y,
      strategy: spinButton.strategy, containsPoint: spinButton.containsPoint,
      interactive: spinButton.interactive, topmostIsButton: spinButton.topmostIsButton,
      elementAtPoint: spinButton.elementAtPoint, stage: spinButton.stage, canvasBounds: spinButton.bounds,
    };

    const betRequestedAt = () => traffic.find((entry) => entry.phase === 'request' && entry.slotEvent === 'bet')?.at ?? Infinity;
    const spinDeadline = Date.now() + 45_000;
    while (Date.now() < spinDeadline) {
      const request = traffic.find((entry) => entry.phase === 'request' && entry.slotEvent === 'bet');
      if (request && traffic.some((entry) => entry.phase === 'response' && entry.at >= request.at)) break;
      await sleep(250);
    }
    const bets = traffic.filter((entry) => entry.phase === 'request' && entry.slotEvent === 'bet');
    const spinResponse = traffic.find((entry) => entry.phase === 'response' && entry.at >= betRequestedAt());
    report.ui.traffic = traffic;
    check('ui-click-issued-native-bet', bets.length === 1, `${bets.length} bet request(s): ${JSON.stringify(bets[0]?.body)}`);
    check('ui-spin-response-received', Boolean(spinResponse) && spinResponse.status === 200, JSON.stringify(spinResponse?.body)?.slice(0, 200) ?? 'no spin response');

    const settledDeadline = Date.now() + 20_000;
    let round = null;
    while (Date.now() < settledDeadline) {
      round = await prisma.casinoRound.findFirst({
        where: { userId: user.id, gameVersion: { startsWith: 'book-of-ra-classic' } },
        orderBy: { createdAt: 'desc' },
      });
      if (round && (!WIN_CAPTURE || round.id !== previousRoundId)) break;
      round = null;
      await sleep(500);
    }
    const betline = Number(bets[0]?.body?.slotBet ?? 0);
    const lines = Number(bets[0]?.body?.slotLines ?? 0);
    report.persisted.round = round && {
      id: round.id, gameVersion: round.gameVersion, status: round.status,
      stake: String(round.stake), payout: String(round.payout),
    };
    check('round-persisted', Boolean(round) && round.stake === BigInt(betline * lines), `stake=${round?.stake} expected=${betline * lines}`);
    if (!round) return;
    const roundsAfter = await prisma.casinoRound.count({ where: { userId: user.id } });
    check('exactly-one-new-round', roundsAfter - roundsBefore === 1, `${roundsBefore} -> ${roundsAfter}`);

    const ledger = await prisma.ledgerEntry.findMany({ where: { relatedCasinoRoundId: round.id }, orderBy: { createdAt: 'asc' } });
    const debit = ledger.filter((entry) => entry.amount < 0n);
    const credit = ledger.filter((entry) => entry.amount > 0n);
    report.persisted.ledger = ledger.map((entry) => ({ type: entry.type, amount: String(entry.amount) }));
    report.persisted.ledgerSum = String(ledger.reduce((sum, entry) => sum + entry.amount, 0n));
    check('exactly-one-stake-debit', debit.length === 1 && debit[0].amount === -round.stake, JSON.stringify(report.persisted.ledger));
    check('payout-credited-at-most-once', credit.length <= 1 && (credit[0]?.amount ?? 0n) === round.payout, `payout=${round.payout} credits=${credit.length}`);

    const after = await prisma.wallet.findUnique({ where: { userId: user.id } });
    const expected = before.balance - round.stake + round.payout;
    report.persisted.wallet = { before: String(before.balance), after: String(after.balance), expected: String(expected) };
    check('wallet-settled-exactly-once', after.balance === expected, JSON.stringify(report.persisted.wallet));

    const replayStoredBet = async (bet) => game.evaluate(async ({ url, postData, requestId, version, roundHeader }) => {
      const headers = { 'content-type': 'application/json', 'x-pilot-request-id': requestId };
      if (version) headers['x-pilot-version'] = version;
      if (roundHeader) headers['x-pilot-round'] = roundHeader;
      const response = await fetch(url, { method: 'POST', credentials: 'include', headers, body: postData });
      let body = null;
      try { body = await response.json(); } catch { body = null; }
      const server = body?.serverResponse ?? null;
      return {
        status: response.status,
        totalWin: server?.totalWin ?? null,
        balance: server?.Balance ?? server?.balance ?? null,
        reels: server?.reelsSymbols ?? server?.reels ?? null,
      };
    }, { ...bet, roundHeader: bet.round });

    let winRound = null;
    const missedClicks = [];
    if (!WIN_CAPTURE) {
      const originalBet = betReplays[0];
      if (!originalBet?.requestId) {
        check('bet-replay-idempotent', false, 'captured bet had no x-pilot-request-id');
      } else {
        const replay = await replayStoredBet(originalBet);
        const ledgerAfterReplay = await prisma.ledgerEntry.count({ where: { relatedCasinoRoundId: round.id } });
        const walletAfterReplay = await prisma.wallet.findUnique({ where: { userId: user.id } });
        report.persisted.replay = {
          status: replay.status,
          ledgerEntries: ledgerAfterReplay,
          wallet: String(walletAfterReplay.balance),
        };
        check('bet-replay-idempotent',
          replay.status === 200 && ledgerAfterReplay === ledger.length && walletAfterReplay.balance === after.balance,
          JSON.stringify(report.persisted.replay));
      }

      // A line win is common enough to look for in a short bound. Free-spin
      // triggers are not: this loop stops at 8 extra paid clicks and never
      // changes the production RNG.
      winRound = round.payout > 0n ? round : null;
      const extraSpins = Number(process.env.BOOK_E2E_EXTRA_SPINS ?? 8);
      for (let extra = 0; extra < extraSpins && !winRound; extra += 1) {
        // The cabinet ignores a spin click while the reels are still moving.
        // Wait for that presentation before the next real pointer click.
        await sleep(8000);
        const betsBefore = traffic.filter((entry) => entry.phase === 'request' && entry.slotEvent === 'bet').length;
        await game.mouse.move(spinButton.x, spinButton.y, { steps: 4 });
        await game.mouse.down();
        await game.waitForTimeout(80);
        await game.mouse.up();
        const extraDeadline = Date.now() + 12_000;
        while (Date.now() < extraDeadline) {
          const betCount = traffic.filter((entry) => entry.phase === 'request' && entry.slotEvent === 'bet').length;
          if (betCount > betsBefore) break;
          await sleep(250);
        }
        const betCount = traffic.filter((entry) => entry.phase === 'request' && entry.slotEvent === 'bet').length;
        if (betCount === betsBefore) {
          missedClicks.push(extra);
          continue;
        }
        await sleep(1500);
        const latest = await prisma.casinoRound.findFirst({
          where: { userId: user.id, gameVersion: { startsWith: 'book-of-ra-classic' } },
          orderBy: { createdAt: 'desc' },
        });
        if (latest && latest.id !== round.id && latest.payout > 0n) winRound = latest;
      }
      if (!winRound) {
        // A line win can stay OPEN with payout 0 until the cabinet finishes the
        // count-up. Re-read the click's own round after that presentation.
        const refreshed = await prisma.casinoRound.findUnique({ where: { id: round.id } });
        if (refreshed && refreshed.payout > 0n) winRound = refreshed;
      }
    } else {
      report.mode = 'book-of-ra-classic-win-capture';
      const maxSpins = Number.isFinite(WIN_CAPTURE_SPINS) && WIN_CAPTURE_SPINS > 0 ? Math.floor(WIN_CAPTURE_SPINS) : 12;
      const attempts = [];
      let lastRoundId = round.id;
      const clickSpin = async () => {
        const betsBefore = traffic.filter((entry) => entry.phase === 'request' && entry.slotEvent === 'bet').length;
        await game.mouse.move(spinButton.x, spinButton.y, { steps: 4 });
        await game.mouse.down();
        await game.waitForTimeout(80);
        await game.mouse.up();
        const extraDeadline = Date.now() + 12_000;
        while (Date.now() < extraDeadline) {
          const betCount = traffic.filter((entry) => entry.phase === 'request' && entry.slotEvent === 'bet').length;
          if (betCount > betsBefore) return true;
          await sleep(250);
        }
        return false;
      };
      for (let attempt = 0; attempt < maxSpins && !winRound; attempt += 1) {
        let targetId = lastRoundId;
        let storedBet = betReplays[0];
        if (attempt > 0) {
          const idleDeadline = Date.now() + 8_000;
          while (Date.now() < idleDeadline) {
            const cabinet = await readCabinet();
            if (cabinet.slotState === 'IDLE') break;
            await sleep(200);
          }
          const replayIndex = betReplays.length;
          const sent = await clickSpin();
          if (!sent) {
            missedClicks.push(attempt);
            attempts.push({ attempt, missed: true });
            continue;
          }
          const appeared = Date.now() + 12_000;
          let latest = null;
          while (Date.now() < appeared) {
            latest = await prisma.casinoRound.findFirst({
              where: { userId: user.id, gameVersion: { startsWith: 'book-of-ra-classic' } },
              orderBy: { createdAt: 'desc' },
            });
            if (latest && latest.id !== lastRoundId) break;
            await sleep(300);
          }
          if (!latest || latest.id === lastRoundId) {
            attempts.push({ attempt, missedRound: true });
            continue;
          }
          targetId = latest.id;
          lastRoundId = targetId;
          storedBet = betReplays[replayIndex] ?? betReplays[betReplays.length - 1];
        }
        const presented = await presentAndCollect(targetId, 'classic-winning-board.png');
        const settled = {
          round: presented,
          firstStatus: presented?.status ?? null,
          polls: 1,
        };
        const terminal = settled.round;
        attempts.push({
          attempt,
          id: terminal?.id ?? targetId,
          firstStatus: settled.firstStatus,
          status: terminal?.status ?? null,
          payout: terminal ? String(terminal.payout) : null,
          polls: settled.polls,
          phase: terminal?.privateState?.phase ?? null,
          authoritativeReread: true,
        });
        if (!terminal || (terminal.status !== 'CASHED_OUT' && terminal.status !== 'LOST')) break;
        if (terminal.payout <= 0n) continue;
        const spinResponses = traffic.filter((entry) => entry.phase === 'response' && entry.body?.serverResponse?.reelsSymbols);
        const spinBody = spinResponses[spinResponses.length - 1];
        const shown = spinBody?.body?.serverResponse ?? null;
        const countUpDeadline = Date.now() + 12_000;
        let cabinetAfter = await readCabinet();
        while (Date.now() < countUpDeadline && cabinetAfter.slotState !== 'IDLE') {
          cabinetAfter = await readCabinet();
          await sleep(200);
        }
        await game.screenshot({ path: join(EVIDENCE, 'classic-after-collect.png') });
        const renderedNow = [{
          key: 'slotStateData',
          text: `state=${cabinetAfter.slotState} totalWin=${cabinetAfter.totalWin} oldWin=${cabinetAfter.oldWin} credit=${cabinetAfter.credit}`,
        }];
        const ledgerBeforeReplay = await prisma.ledgerEntry.findMany({
          where: { relatedCasinoRoundId: terminal.id }, orderBy: { createdAt: 'asc' },
        });
        const walletBeforeReplay = await prisma.wallet.findUnique({ where: { userId: user.id } });
        const roundsBeforeReplay = await prisma.casinoRound.count({ where: { userId: user.id } });
        const replay = storedBet?.requestId ? await replayStoredBet(storedBet) : { status: 0, totalWin: null, reels: null };
        const ledgerAfterReplay = await prisma.ledgerEntry.findMany({
          where: { relatedCasinoRoundId: terminal.id }, orderBy: { createdAt: 'asc' },
        });
        const walletAfterReplay = await prisma.wallet.findUnique({ where: { userId: user.id } });
        const roundsAfterReplay = await prisma.casinoRound.count({ where: { userId: user.id } });
        const reread = await prisma.casinoRound.findUnique({ where: { id: terminal.id } });
        const sameLedger = JSON.stringify(ledgerBeforeReplay.map((entry) => [entry.id, entry.type, String(entry.amount)]))
          === JSON.stringify(ledgerAfterReplay.map((entry) => [entry.id, entry.type, String(entry.amount)]));
        report.persisted.winReplay = {
          id: terminal.id,
          requestId: storedBet?.requestId ?? null,
          stake: String(terminal.stake),
          payout: String(terminal.payout),
          browserTotalWin: shown?.totalWin ?? null,
          replayStatus: replay.status,
          replayTotalWin: replay.totalWin,
          firstStatus: settled.firstStatus,
          polls: settled.polls,
          authoritativeReread: true,
          rereadStatus: reread?.status ?? null,
          rereadPayout: reread ? String(reread.payout) : null,
          walletBeforeReplay: String(walletBeforeReplay.balance),
          walletAfterReplay: String(walletAfterReplay.balance),
          roundsBeforeReplay,
          roundsAfterReplay,
          ledger: ledgerAfterReplay.map((entry) => ({ type: entry.type, amount: String(entry.amount) })),
          displayedTexts: renderedNow,
        };
        const payoutText = String(terminal.payout);
        check('winning-board-matches-persisted', classicReelsMatch(shown, terminal), `ui=${JSON.stringify(shown?.reelsSymbols ?? null)}`);
        check('browser-total-win-matches-payout', Number(shown?.totalWin) === Number(terminal.payout), `totalWin=${shown?.totalWin} payout=${terminal.payout}`);
        check('last-win-visible', Number(cabinetAfter.oldWin) === Number(terminal.payout) && cabinetAfter.slotState === 'IDLE', JSON.stringify(renderedNow));
        check('win-replay-http-200', replay.status === 200, `status=${replay.status}`);
        check('win-replay-same-outcome', replay.status === 200 && classicReelsMatch({ reelsSymbols: replay.reels }, reread) && Number(replay.totalWin) === Number(terminal.payout), `replayTotalWin=${replay.totalWin}`);
        check('win-replay-no-new-round', roundsAfterReplay === roundsBeforeReplay, `${roundsBeforeReplay} -> ${roundsAfterReplay}`);
        check('win-replay-no-second-debit', sameLedger && ledgerAfterReplay.filter((entry) => entry.type === 'CASINO_BET').length === 1, JSON.stringify(report.persisted.winReplay.ledger));
        check('win-replay-no-second-credit', sameLedger && ledgerAfterReplay.filter((entry) => entry.type === 'CASINO_WIN').length === 1 && ledgerAfterReplay.filter((entry) => entry.type === 'CASINO_WIN')[0].amount === terminal.payout, `payout=${terminal.payout}`);
        check('win-replay-wallet-unchanged', walletAfterReplay.balance === walletBeforeReplay.balance, `${walletBeforeReplay.balance} -> ${walletAfterReplay.balance}`);
        check('post-animation-reread', reread?.status === 'CASHED_OUT' && reread.payout === terminal.payout, `first=${settled.firstStatus} reread=${reread?.status}`);
        winRound = reread;
      }
      report.ui.winCapture = { observed: Boolean(winRound), attempts, missedClicks, bound: maxSpins };
      if (!winRound) report.ui.winSearch = { found: false, betsSent: betReplays.length, missedClicks, notObserved: true };
    }
    if (winRound) {
      const winLedger = await prisma.ledgerEntry.findMany({ where: { relatedCasinoRoundId: winRound.id }, orderBy: { createdAt: 'asc' } });
      const winWallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
      report.persisted.win = {
        id: winRound.id,
        stake: String(winRound.stake),
        payout: String(winRound.payout),
        ledger: winLedger.map((entry) => ({ type: entry.type, amount: String(entry.amount) })),
        wallet: String(winWallet.balance),
      };
      const winDebit = winLedger.filter((entry) => entry.amount < 0n);
      const winCredit = winLedger.filter((entry) => entry.amount > 0n);
      check('paid-win-one-debit', winDebit.length === 1 && winDebit[0].amount === -winRound.stake, JSON.stringify(report.persisted.win.ledger));
      check('paid-win-one-credit', winCredit.length === 1 && winCredit[0].amount === winRound.payout, `payout=${winRound.payout}`);
      await game.screenshot({ path: join(EVIDENCE, 'classic-after-paid-win.png') });
    } else {
      report.ui.winSearch = { ...(report.ui.winSearch ?? {}), found: false, betsSent: betReplays.length, missedClicks };
    }
    report.ui.freeSpinsObserved = traffic.some((entry) => entry.phase === 'response' && Number(entry.body?.serverResponse?.totalFreeGames) > 0);

    // Cross-check the persisted outcome against what the client rendered.
    const serverResponse = spinResponse?.body?.serverResponse ?? null;
    const persistedReels = persistedClassicReels(round);
    report.ui.serverResponse = serverResponse;
    // Presentation only. privateState.plan is the pre-drawn round and stays out of the report.
    report.ui.persistedReels = persistedReels;
    check('persisted-outcome-matches-ui', classicReelsMatch(serverResponse, round),
      `ui=${JSON.stringify(serverResponse?.reelsSymbols ?? serverResponse?.reels ?? null)} persisted=${JSON.stringify(persistedReels)}`);

    // Rendered client state: the recovered cabinet paints its counters on the
    // canvas, so the evidence is the live PIXI text objects it is showing.
    const rendered = await game.evaluate(() => {
      const texts = [];
      const walk = (node, key, depth) => {
        if (!node || depth > 3) return;
        if (typeof node.text === 'string' && node.text) texts.push({ key, text: node.text });
        if (Array.isArray(node.children)) node.children.forEach((child) => walk(child, key, depth + 1));
      };
      const counters = window.gameCounters?.GetObject?.();
      if (counters) Object.keys(counters).forEach((key) => walk(counters[key], key, 0));
      const state = window.slotStateData ?? null;
      const ui = window.gameUI?.GetObject?.();
      return {
        texts: texts.slice(0, 40),
        state: state ? { betline: state.betline, lines: state.lines, balance: state.balance } : null,
        spinVisible: Boolean(ui?.['uiButtonSpin']?._view?.visible),
      };
    }).catch((error) => ({ error: String(error) }));
    report.ui.rendered = rendered;
    check('ui-stake-matches-client-state',
      !rendered.state || (rendered.state.betline === betline && rendered.state.lines === lines),
      JSON.stringify(rendered.state));

    await game.waitForTimeout(3000);
    await game.screenshot({ path: join(EVIDENCE, 'classic-after-paid-spin.png') });
    await page.screenshot({ path: join(EVIDENCE, 'launcher-after-spin.png') });
    const audioErrors = pageErrors.filter((entry) => entry.includes('Unable to decode audio data'));
    const blockingErrors = pageErrors.filter((entry) => !entry.includes('Unable to decode audio data'));
    report.ui.audioDecodePageErrors = audioErrors.length;
    check('no-page-errors', blockingErrors.length === 0, blockingErrors.join(' | ') || (audioErrors.length ? `headless audio decode only (${audioErrors.length})` : ''));
    await context.close();
  } catch (error) {
    report.abort = {
      message: String(error?.message ?? error),
      stack: String(error?.stack ?? '').split('\n').slice(0, 3),
    };
    check('run-aborted', false, report.abort.message);
  } finally {
    try { if (browser) await browser.close(); } catch { /* ignore */ }
    for (const record of children) await stopChild(record);
    await sleep(1500);
    report.processes = children.map((record) => ({ label: record.label, exitCode: record.exited }));
    report.portsAfterStop = {
      [String(API_PORT)]: await portListeners(API_PORT),
      [String(GATEWAY_PORT)]: await portListeners(GATEWAY_PORT),
      [String(FE_PORT)]: await portListeners(FE_PORT),
      '3000_existing': await portListeners(3000),
    };
    report.finishedAt = new Date().toISOString();
    report.passed = results.filter((entry) => entry.ok).length;
    report.failed = results.filter((entry) => !entry.ok).length;
    writeFileSync(join(EVIDENCE, 'classic-paid-spin-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    for (const record of children) writeFileSync(join(EVIDENCE, `child-${record.label}.log`), record.log.join(''));
    const betRequests = (report.ui.traffic ?? [])
      .filter((entry) => entry.phase === 'request' && entry.slotEvent === 'bet')
      .map((entry) => ({ slotBet: entry.body?.slotBet, slotLines: entry.body?.slotLines, at: entry.at }));
    const clickAt = report.ui.click ? Date.parse(report.ui.click.at) : 0;
    const spinResponse = (report.ui.traffic ?? []).find((entry) => entry.phase === 'response' && entry.at >= clickAt);
    writeFileSync(join(EVIDENCE, 'SUMMARY.md'), [
      '# Book of Ra Classic paid spin - single bounded E2E run', '',
      `- run: ${report.startedAt} -> ${report.finishedAt} (evidence directory ${RUN_ID})`,
      `- fixture identity (reused, no registration): ${JSON.stringify(report.fixture ?? null)}`,
      `- registration calls this run: ${report.registration?.calls ?? 'n/a'}`,
      `- click root cause fixed: the previous run derived the viewport point from stale
  sprite bounds instead of the client's live screen->stage mapping (see README note in
  this file's directory); targeting now inverts interaction.mapPositionToPoint by
  bisection and confirms it with interaction.hitTest before clicking.`,
      `- deterministic targeting: ${JSON.stringify(report.ui.spinButton ?? null)}`,
      `- attempted native pointer (move/down/up): ${JSON.stringify(report.ui.click ?? null)}`,
      `- native bet request(s): ${JSON.stringify(betRequests)}`,
      `- native bet response status: ${spinResponse?.status ?? 'none'}`,
      `- persisted: ${JSON.stringify(report.persisted ?? {})}`,
      `- win capture: ${JSON.stringify(report.ui.winCapture ?? null)}`,
      `- browser: ${report.browser ?? 'n/a'}`,
      `- checks: ${report.passed} passed / ${report.failed} failed`,
      `- abort: ${JSON.stringify(report.abort ?? null)}`, '',
    ].join('\n'));
    await prisma.$disconnect().catch(() => undefined);
  }

  process.stdout.write(`${JSON.stringify({ evidence: EVIDENCE, passed: report.passed, failed: report.failed })}\n`);
  if (report.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
