/**
 * Real Chrome acceptance for the Classic settled-credit display, one scripted
 * retrigger feature, a mid-feature refresh, and the short error checks.
 *
 * The API process is backend/test/classic-browser-fixture/server.cjs. It is
 * not production main.js, it is not in the runtime image, and it exposes no
 * route a player can use to choose an outcome. This script refuses
 * NODE_ENV=production.
 *
 * Evidence stays under docs/agent-work and must not be committed. Cabinet
 * screenshots are local only.
 */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { invertStageToClient, mapClientToStage } from './lib/classic-hit-guard.mjs';
import { classicReelsMatch } from './classic-persisted-board.mjs';

const require = createRequire(import.meta.url);
if (process.env.NODE_ENV === 'production') {
  process.stderr.write('feature browser e2e refuses NODE_ENV=production\n');
  process.exit(1);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE = join(ROOT, 'docs', 'agent-work', 'book-completion', 'evidence', `classic-feature-browser-${RUN_ID}`);
const PLAYWRIGHT = process.env.BOOK_E2E_PLAYWRIGHT
  ?? 'C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js';
const CHROME = process.env.BOOK_E2E_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const API_PORT = Number(process.env.BOOK_E2E_API_PORT ?? 3001);
const API = `http://localhost:${API_PORT}`;
const GATEWAY_PORT = Number(process.env.BOOK_E2E_GATEWAY_PORT ?? 8791);
const CLASSIC = `http://127.0.0.1:${GATEWAY_PORT}`;
const FE_PORT = Number(process.env.BOOK_E2E_FRONTEND_PORT ?? 3017);
const FRONTEND = `http://localhost:${FE_PORT}`;
const PASSWORD = process.env.BOOK_E2E_PASSWORD ?? '';
const PHASE = process.env.BOOK_E2E_PHASE ?? 'full';
const VIEWPORT_SPEC = process.env.BOOK_E2E_VIEWPORT ?? '1440x900';
const [viewportWidth, viewportHeight] = VIEWPORT_SPEC.split('x').map((part) => Number(part));
const MOBILE_VIEWPORT = viewportWidth <= 500;
const FROZEN_PROFILE_HASH = 'a2f6fef07d3afa792bafda0af824fecb0042d8295e83dc9672b437cc18480d48';
const FIXTURE_EMAIL = process.env.BOOK_E2E_FIXTURE_EMAIL ?? 'classic-e2e-fixture@example.test';
const BROKE_EMAIL = 'classic-e2e-broke@example.test';
const RNG_FILE = join(EVIDENCE, 'rng-calls.json');
const FAULT_FILE = join(EVIDENCE, 'fault.txt');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 500) });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` :: ${String(detail).slice(0, 300)}`}\n`);
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
  if (!record || record.exited !== null) return;
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
const portBusy = async (port) => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
    return response.status > 0;
  } catch {
    return false;
  }
};
const readCalls = () => {
  try { return JSON.parse(readFileSync(RNG_FILE, 'utf8')).calls; } catch { return null; }
};
const readBudget = () => {
  try { return JSON.parse(readFileSync(RNG_FILE, 'utf8')).budgetTotal; } catch { return null; }
};

async function main() {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(FAULT_FILE, '');
  const { PrismaClient } = await import('@prisma/client');
  const argon2 = require('argon2');
  const { chromium } = require(PLAYWRIGHT);
  const prisma = new PrismaClient();
  const report = {
    mode: 'book-of-ra-classic-feature-browser',
    startedAt: new Date().toISOString(),
    api: API,
    frontend: FRONTEND,
    classic: CLASSIC,
    licensing: 'CLASSIC_PUBLIC_DEPLOYMENT_BLOCKED_PENDING_ASSET_RIGHTS',
    physicalMobile: { tested: false, reason: 'no handset attached to this run' },
    results,
    rounds: {},
    ui: {},
  };
  let browser = null;
  let gateway = null;

  try {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    if (!process.env.REDIS_URL) throw new Error('REDIS_URL is required');
    if (!PASSWORD) throw new Error('BOOK_E2E_PASSWORD is required');
    for (const port of [API_PORT, FE_PORT, GATEWAY_PORT]) {
      if (await portBusy(port)) throw new Error(`port ${port} is already in use`);
    }

    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const brokeExisting = await prisma.user.findUnique({ where: { email: BROKE_EMAIL } });
    if (!brokeExisting) {
      await prisma.user.create({
        data: {
          email: BROKE_EMAIL,
          username: 'classic-e2e-broke',
          passwordHash,
          role: 'USER',
          wallet: { create: { balance: 0n } },
        },
      });
    } else {
      await prisma.user.update({ where: { id: brokeExisting.id }, data: { passwordHash, disabled: false } });
      await prisma.wallet.update({ where: { userId: brokeExisting.id }, data: { balance: 0n } });
    }

    const backend = start('scripted-backend', process.execPath, ['test/classic-browser-fixture/server.cjs'], join(ROOT, 'backend'), {
      NODE_ENV: 'development',
      BOOK_CLASSIC_E2E_SCRIPTED_RNG: '1',
      BOOK_CLASSIC_E2E_RNG_FILE: RNG_FILE,
      BOOK_CLASSIC_E2E_FAULT_FILE: FAULT_FILE,
      PORT: String(API_PORT),
      HOST: '127.0.0.1',
      FRONTEND_URL: FRONTEND,
      CORS_ORIGINS: FRONTEND,
      COOKIE_SECURE: 'false',
      TRUST_PROXY: 'false',
      CASINO_CRASH_WORKER_ENABLED: 'false',
      REGISTRATION_ENABLED: 'false',
      JWT_ACCESS_SECRET: sha256(`${RUN_ID}:access`),
      JWT_REFRESH_SECRET: sha256(`${RUN_ID}:refresh`),
      PASSWORD_VAULT_KEY: Buffer.alloc(32, 7).toString('base64'),
    });
    check('scripted-backend-health', await waitForHttp(`${API}/health/live`, backend), `exited=${backend.exited}`);
    const backendLog = backend.log.join('');
    check('scripted-backend-marker', backendLog.includes('SCRIPTED_CLASSIC_BACKEND'), backendLog.slice(-400));
    if (!results.at(-1).ok || !results.at(-2).ok) return;

    const frontend = start('frontend', process.execPath, [join(ROOT, 'node_modules/next/dist/bin/next'), 'start', '-p', String(FE_PORT), '-H', '127.0.0.1'], join(ROOT, 'frontend'), {
      NODE_ENV: 'production',
    });
    check('frontend-ready', await waitForHttp(`${FRONTEND}/login`, frontend), `exited=${frontend.exited}`);
    if (frontend.exited !== null) return;

    const gatewayEnv = {
      BOOK_CLASSIC_GATEWAY_PORT: String(GATEWAY_PORT),
      BOOK_CLASSIC_GATEWAY_HOST: '127.0.0.1',
      BOOK_CLASSIC_ORIGIN: CLASSIC,
      PLATFORM_URL: API,
      BOOK_CLASSIC_CLIENT_DIR: join(ROOT, 'games', 'book-of-ra-classic', 'client'),
      BOOK_CLASSIC_LAUNCH_ORIGINS: FRONTEND,
    };
    gateway = start('classic-gateway', process.execPath, ['games/book-of-ra-classic/gateway/server.mjs'], ROOT, gatewayEnv);
    check('classic-gateway-health', await waitForHttp(`${CLASSIC}/healthz`, gateway), `exited=${gateway.exited}`);
    if (gateway.exited !== null) return;

    const user = await prisma.user.findUnique({ where: { email: FIXTURE_EMAIL } });
    check('fixture-identity', Boolean(user), maskEmail(FIXTURE_EMAIL));
    if (!user) return;
    const open = await prisma.casinoRound.findFirst({
      where: { userId: user.id, status: 'OPEN', gameVersion: { startsWith: 'book-of-ra-classic' } },
      orderBy: { createdAt: 'desc' },
    });
    if (open && !['PENDING_WIN', 'GAMBLE', 'FREE_SPINS'].includes(open.privateState?.phase)) {
      check('fixture-round-idle', false, open.privateState?.phase ?? open.status);
      return;
    }

    if (!Number.isInteger(viewportWidth) || !Number.isInteger(viewportHeight)) {
      check('viewport', false, VIEWPORT_SPEC);
      return;
    }
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    report.browser = await browser.version();
    report.viewport = { width: viewportWidth, height: viewportHeight, mobile: MOBILE_VIEWPORT };
    const context = await browser.newContext({
      viewport: { width: viewportWidth, height: viewportHeight },
      hasTouch: MOBILE_VIEWPORT,
      isMobile: MOBILE_VIEWPORT,
    });
    const page = await context.newPage();
    page.on('dialog', (dialog) => { dialog.dismiss().catch(() => undefined); });
    await page.goto(`${FRONTEND}/login`, { waitUntil: 'domcontentloaded' });
    const badLogin = await page.evaluate(async (api) => {
      const response = await fetch(`${api}/auth/login`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'classic-e2e-fixture@example.test', password: 'wrong-password-not-the-fixture' }),
      });
      return response.status;
    }, API);
    check('invalid-credentials-rejected', badLogin === 401 || badLogin === 403, String(badLogin));
    const loginStatus = await page.evaluate(async ({ api, address, password }) => {
      const response = await fetch(`${api}/auth/login`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: address, password }),
      });
      return response.status;
    }, { api: API, address: FIXTURE_EMAIL, password: PASSWORD });
    check('login', loginStatus === 200 || loginStatus === 201, String(loginStatus));
    if (loginStatus !== 200 && loginStatus !== 201) return;

    await page.goto(`${FRONTEND}/casino/slots/book-of-ra-classic`, { waitUntil: 'networkidle' });
    await page.locator('button.casino-play').waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForFunction(() => {
      const button = document.querySelector('button.casino-play');
      return button instanceof HTMLButtonElement && !button.disabled && button.textContent.includes('Launch game');
    }, null, { timeout: 30_000 });
    const launchToken = await page.locator('input[name="token"]').inputValue();
    check('launch-ticket-present', launchToken.length >= 16, `len=${launchToken.length}`);
    const launchStatuses = [];
    const assetFailures = [];
    context.on('response', (response) => {
      let parsed;
      try { parsed = new URL(response.url()); } catch { return; }
      if (parsed.origin !== CLASSIC) return;
      if (parsed.pathname === '/launch') launchStatuses.push(response.status());
      else if (response.status() >= 400) assetFailures.push(`${response.status()} ${parsed.pathname}`);
    });
    const launchAt = Date.now();
    const [game] = await Promise.all([
      context.waitForEvent('page'),
      page.locator('button.casino-play').click(),
    ]);
    await game.waitForLoadState('domcontentloaded');
    game.on('dialog', (dialog) => { dialog.dismiss().catch(() => undefined); });
    const consoleNotes = [];
    game.on('console', (message) => {
      const text = message.text();
      if (/500|rejected|Recovery request/i.test(text)) consoleNotes.push(text.slice(0, 240));
    });
    check('launcher-opens-game', game.url().startsWith(`${CLASSIC}/play`), game.url());

    const traffic = [];
    const betReplays = [];
    const collectReplays = [];
    const remember = (bucket, request) => {
      const headers = request.headers();
      bucket.push({
        url: request.url(),
        postData: request.postData(),
        requestId: headers['x-pilot-request-id'] ?? '',
        version: headers['x-pilot-version'] ?? '',
        round: headers['x-pilot-round'] ?? '',
      });
    };
    game.on('request', (request) => {
      if (!request.url().includes('/game/BookOfRaCL/server')) return;
      let body = null;
      try { body = JSON.parse(request.postData() ?? 'null'); } catch { body = null; }
      traffic.push({ phase: 'request', at: Date.now(), slotEvent: body?.slotEvent ?? null, status: null, body });
      if (body?.slotEvent === 'bet') remember(betReplays, request);
      if (body?.slotEvent === 'recoveryCollect') remember(collectReplays, request);
    });
    game.on('response', (response) => {
      const status = response.status();
      const url = response.url();
      if (!url.includes('/game/BookOfRaCL/server') && status < 500) return;
      // Status has to be recorded before the body is read. A 500 reload can
      // dispose the response while json() is still pending, and the status
      // would otherwise never reach the assertion.
      const entry = { phase: 'response', at: Date.now(), slotEvent: null, status, body: null };
      traffic.push(entry);
      response.json().then((body) => { entry.body = body; }).catch(() => undefined);
    });

    const readCabinet = () => game.evaluate(() => {
      const texts = [];
      const walk = (node) => {
        if (!node) return;
        if (typeof node.text === 'string' && node.text.includes('Free Game')) texts.push(node.text);
        const children = node.children;
        if (children && typeof children.length === 'number') {
          for (let index = 0; index < children.length; index += 1) walk(children[index]);
        }
      };
      try { walk(window.app?.stage); } catch { /* stage not ready */ }
      const ids = ['10', 'J', 'Q', 'K', 'A', 'P_4', 'P_3', 'P_2', 'P_1'];
      let book = null;
      try {
        const objects = window.gameBonus?.dbg?.() ?? null;
        const frame = objects?.bonusBookSym?.newSprite?.currentFrame;
        book = {
          pay3: objects?.bonusBookPay3?.text ?? '',
          frame: Number.isInteger(frame) ? frame : null,
          frameSymbol: Number.isInteger(frame) ? (ids[frame] ?? null) : null,
        };
      } catch { book = null; }
      const creditText = [];
      const walkCredit = (node) => {
        if (!node) return;
        if (typeof node.text === 'string' && /PTS/.test(node.text)) creditText.push(node.text);
        const children = node.children;
        if (children && typeof children.length === 'number') {
          for (let index = 0; index < children.length; index += 1) walkCredit(children[index]);
        }
      };
      try { walkCredit(window.app?.stage); } catch { /* ignore */ }
      return {
        slotState: typeof slotState === 'string' ? slotState : null,
        totalWin: window.slotStateData?.totalWin ?? null,
        oldWin: window.slotStateData?.oldWin ?? null,
        credit: window.slotStateData?.credit ?? null,
        creditNew: window.slotStateData?.credit_new ?? null,
        bet: window.slotStateData?.bet ?? null,
        lines: window.slotStateData?.lines ?? null,
        currentFreeGames: window.slotSpinResult?.currentFreeGames ?? null,
        totalFreeGames: window.slotSpinResult?.totalFreeGames ?? null,
        expSymbol: window.slotSpinResult?.expSymbol ?? null,
        recoveryPhase: window.pilotRecovery?.phase ?? null,
        recoveryFree: window.pilotRecovery?.free ?? null,
        recoveryBalance: window.pilotRecovery?.balance ?? null,
        reelsSymbols: window.slotSpinResult?.reelsSymbols ?? null,
        freeGameTexts: texts,
        creditTexts: creditText.slice(0, 8),
        book,
      };
    }).catch(() => ({ slotState: null }));

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
      }, name).catch(() => null);
      if (!located) return false;
      const point = invertStageToClient(located.stage.x, located.stage.y, located.mapOpts);
      const probe = mapClientToStage(point.x, point.y, located.mapOpts);
      if (Math.abs(probe.x - located.stage.x) > 1.5 || Math.abs(probe.y - located.stage.y) > 1.5) return false;
      await game.mouse.move(point.x, point.y, { steps: 3 });
      await game.mouse.down();
      await game.waitForTimeout(40);
      await game.mouse.up();
      return true;
    };

    const waitForCabinet = async () => {
      await game.waitForFunction(() => window.isFontLoaded === true && typeof window.gameUI?.GetObject === 'function', null, { timeout: 45_000 });
      const deadline = Date.now() + 20_000;
      let cabinet = null;
      while (Date.now() < deadline) {
        cabinet = await readCabinet();
        if (cabinet.slotState) return cabinet;
        await sleep(200);
      }
      return cabinet;
    };

    const walletOf = async (id) => (await prisma.wallet.findUnique({ where: { userId: id } })).balance;
    const ledgerOf = async (roundId) => (await prisma.ledgerEntry.findMany({
      where: { relatedCasinoRoundId: roundId },
      orderBy: { createdAt: 'asc' },
    })).map((entry) => ({ type: entry.type, amount: String(entry.amount) }));
    const publicState = (round) => ({
      id: round?.id ?? null,
      status: round?.status ?? null,
      stake: round ? String(round.stake) : null,
      payout: round ? String(round.payout) : null,
      phase: round?.privateState?.phase ?? null,
      index: round?.privateState?.index ?? null,
      freeTotal: round?.privateState?.freeTotal ?? null,
      pendingWin: round?.privateState?.pendingWin ?? null,
      expSymbol: round?.privateState?.result?.serverResponse?.expSymbol ?? null,
      profileId: round?.privateState?.profileId ?? null,
      profileHash: round?.privateState?.profileHash ?? null,
    });

    const newestRound = async (previousId) => {
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        const round = await prisma.casinoRound.findFirst({
          where: { userId: user.id, gameVersion: { startsWith: 'book-of-ra-classic' } },
          orderBy: { createdAt: 'desc' },
        });
        if (round && round.id !== previousId) return round;
        await sleep(250);
      }
      return null;
    };

    const replayStored = async (stored) => game.evaluate(async ({ url, postData, requestId, version, roundHeader }) => {
      const headers = { 'content-type': 'application/json', 'x-pilot-request-id': requestId };
      if (version) headers['x-pilot-version'] = version;
      if (roundHeader) headers['x-pilot-round'] = roundHeader;
      const response = await fetch(url, { method: 'POST', credentials: 'include', headers, body: postData });
      return response.status;
    }, { ...stored, roundHeader: stored.round });

    const presentAndCollect = async (roundId) => {
      const deadline = Date.now() + 45_000;
      let skipped = false;
      let collected = false;
      while (Date.now() < deadline) {
        const current = await prisma.casinoRound.findUnique({ where: { id: roundId } });
        if (current && (current.status === 'CASHED_OUT' || current.status === 'LOST')) return current;
        const cabinet = await readCabinet();
        if (!skipped && cabinet.slotState === 'WINNING') {
          skipped = await clickNamed('uiButtonSkip');
          await sleep(250);
          continue;
        }
        if (!collected && (cabinet.slotState === 'AFTERWIN' || cabinet.slotState === 'GAMBLE')) {
          collected = await clickNamed('uiButtonSpin');
          await sleep(300);
          continue;
        }
        await sleep(200);
      }
      return prisma.casinoRound.findUnique({ where: { id: roundId } });
    };

    const waitIdleAndRead = async () => {
      const deadline = Date.now() + 40_000;
      let cabinet = await readCabinet();
      while (Date.now() < deadline && cabinet.slotState !== 'IDLE') {
        if (cabinet.slotState === 'WINNING' || cabinet.slotState === 'AFTERWIN') await clickNamed('uiButtonSkip');
        await sleep(200);
        cabinet = await readCabinet();
      }
      return cabinet;
    };

    // The scripted feature is about twenty animated free spins, including the
    // expanding-symbol line walk the skip control does not cancel. Fourteen
    // minutes covers that walk plus one book open after refresh.
    const playFeature = async (round, { refresh, expectedSymbol, screenshotBook }) => {
      const seenTotals = new Set();
      const paintedCounters = new Set();
      let bookMatched = false;
      let refreshed = false;
      let refreshProof = null;
      let callsAtTrigger = null;
      let waitClickAt = 0;
      let spinClickAt = 0;
      const featureDeadline = Date.now() + 14 * 60 * 1000;
      let lastIndex = -1;
      let lastProgress = Date.now();
      while (Date.now() < featureDeadline) {
        const current = await prisma.casinoRound.findUnique({ where: { id: round.id } });
        const phase = current?.privateState?.phase ?? null;
        const index = current?.privateState?.index ?? 0;
        const total = current?.privateState?.freeTotal ?? 0;
        if (total) seenTotals.add(total);
        if (callsAtTrigger === null && phase === 'FREE_SPINS') callsAtTrigger = readCalls();
        const cabinet = await readCabinet();
        for (const text of cabinet.freeGameTexts ?? []) paintedCounters.add(text);
        if (!bookMatched && expectedSymbol && cabinet.book?.frameSymbol === expectedSymbol && cabinet.book?.pay3) {
          bookMatched = true;
          if (screenshotBook) await game.screenshot({ path: join(EVIDENCE, 'classic-expanding-symbol.png') });
        }
        if (phase === 'PENDING_WIN' || current?.status === 'CASHED_OUT' || current?.status === 'LOST') break;
        if (refresh && !refreshed && phase === 'FREE_SPINS' && index >= 4 && index < total) {
          const before = { index, total, calls: readCalls(), pendingWin: current.privateState?.pendingWin ?? null };
          await game.reload({ waitUntil: 'domcontentloaded' });
          await waitForCabinet();
          const restored = await prisma.casinoRound.findUnique({ where: { id: round.id } });
          const afterCalls = readCalls();
          refreshProof = {
            before,
            after: {
              index: restored?.privateState?.index ?? null,
              total: restored?.privateState?.freeTotal ?? null,
              phase: restored?.privateState?.phase ?? null,
              pendingWin: restored?.privateState?.pendingWin ?? null,
              calls: afterCalls,
            },
          };
          await game.screenshot({ path: join(EVIDENCE, 'classic-feature-restored.png') });
          refreshed = true;
          waitClickAt = 0;
          lastProgress = Date.now();
          continue;
        }
        if (cabinet.slotState === 'WAITBONUS' && Date.now() - waitClickAt > 8_000) {
          await clickNamed('uiButtonSpin');
          waitClickAt = Date.now();
          await sleep(400);
        } else if (cabinet.slotState === 'WINNING') {
          await clickNamed('uiButtonSkip');
        } else if (cabinet.slotState === 'SPIN' && Date.now() - spinClickAt > 400) {
          await clickNamed('uiButtonSpin');
          spinClickAt = Date.now();
        }
        if (index !== lastIndex) {
          lastIndex = index;
          lastProgress = Date.now();
        } else if (Date.now() - lastProgress > 20_000 && (cabinet.slotState === 'IDLE' || cabinet.slotState === 'WAITBONUS')) {
          await clickNamed('uiButtonSpin');
          lastProgress = Date.now();
        }
        await sleep(300);
      }
      return { seenTotals, paintedCounters, bookMatched, refreshProof, callsAtTrigger };
    };

    const assertCredits = async (label, payout) => {
      const immediate = await waitIdleAndRead();
      const walletNow = await walletOf(user.id);
      const immediateMatch = Number(immediate.credit) === Number(walletNow);
      await sleep(4000);
      const later = await readCabinet();
      const walletLater = await walletOf(user.id);
      const laterMatch = Number(later.credit) === Number(walletLater);
      const painted = (later.creditTexts ?? []).some((text) => text.replace(/[^\d]/g, '') === String(walletLater));
      check(`${label}-credits-idle`, immediate.slotState === 'IDLE' && immediateMatch,
        `state=${immediate.slotState} credit=${immediate.credit} wallet=${walletNow}`);
      check(`${label}-credits-after-update`, later.slotState === 'IDLE' && laterMatch && walletLater === walletNow,
        `credit=${later.credit} wallet=${walletLater} painted=${painted}`);
      check(`${label}-last-win`, Number(later.oldWin) === Number(payout), `oldWin=${later.oldWin} payout=${payout}`);
      report.ui[label] = {
        immediateCredit: immediate.credit,
        laterCredit: later.credit,
        wallet: String(walletLater),
        oldWin: later.oldWin,
        painted,
        creditTexts: later.creditTexts ?? [],
      };
    };

    await waitForCabinet();
    check('entry-assets', assetFailures.length === 0, assetFailures.slice(0, 5).join(' | ') || 'ok');
    check('launch-ticket-accepted', launchStatuses.includes(303), launchStatuses.join(',') || 'none');
    await page.evaluate(({ origin, token }) => {
      const frame = document.createElement('iframe');
      frame.name = 'classic-ticket-replay';
      frame.hidden = true;
      document.body.appendChild(frame);
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = `${origin}/launch`;
      form.target = 'classic-ticket-replay';
      const input = document.createElement('input');
      input.name = 'token';
      input.value = token;
      form.appendChild(input);
      document.body.appendChild(form);
      form.submit();
    }, { origin: CLASSIC, token: launchToken });
    const replayDeadline = Date.now() + 10_000;
    while (Date.now() < replayDeadline && launchStatuses.length < 2) await sleep(200);
    check('launch-ticket-replay-rejected', launchStatuses[0] === 303 && launchStatuses.slice(1).includes(401)
      && !launchStatuses.slice(1).includes(303), launchStatuses.join(',') || 'none');
    const stranger = await browser.newContext();
    const strangerResponse = await stranger.request.fetch(`${CLASSIC}/game/BookOfRaCL/server?sessionId=none`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: CLASSIC },
      data: JSON.stringify({ slotEvent: 'getSettings' }),
      failOnStatusCode: false,
    });
    check('anonymous-gameplay-rejected', strangerResponse.status() === 401, String(strangerResponse.status()));
    await stranger.close();
    if (open?.privateState?.phase === 'FREE_SPINS') {
      const callsBeforeResume = readCalls();
      const resumeSymbol = open.privateState?.result?.serverResponse?.expSymbol ?? null;
      await playFeature(open, { refresh: false, expectedSymbol: resumeSymbol, screenshotBook: false });
      const resumed = await presentAndCollect(open.id);
      const resumeLedger = resumed ? await ledgerOf(resumed.id) : [];
      const resumeWins = resumeLedger.filter((entry) => entry.type === 'CASINO_WIN');
      check('resume-interrupted-feature', resumed?.status === 'CASHED_OUT' && resumeWins.length === 1
        && resumed.payout > 0n && readCalls() === callsBeforeResume,
        `status=${resumed?.status} payout=${resumed?.payout} wins=${resumeWins.length} calls=${callsBeforeResume}->${readCalls()}`);
      if (!results.at(-1).ok) return;
      await assertCredits('resume', resumed.payout);
      await waitIdleAndRead();
    } else if (open) {
      const recovered = await presentAndCollect(open.id);
      check('recovered-open-round', recovered?.status === 'CASHED_OUT' || recovered?.status === 'LOST', recovered?.status ?? 'missing');
      await waitIdleAndRead();
    }
    const idleDeadline = Date.now() + 15_000;
    let armed = await readCabinet();
    while (Date.now() < idleDeadline && armed.slotState !== 'IDLE') {
      armed = await readCabinet();
      await sleep(200);
    }
    check('default-stake-nine', Number(armed.bet) === 9 && Number(armed.lines) === 9 && armed.slotState === 'IDLE',
      `bet=${armed.bet} lines=${armed.lines} state=${armed.slotState}`);
    const fit = await game.evaluate(() => {
      const view = window.app?.view ?? document.querySelector('canvas');
      const rect = view.getBoundingClientRect();
      const target = window.gameUI?.GetObject?.()?.uiButtonSpin?._view;
      const bounds = target?.getLocalBounds?.() ?? { x: 0, y: 0, width: target?.width ?? 0, height: target?.height ?? 0 };
      const centre = new window.PIXI.Point(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      const global = target?.toGlobal ? target.toGlobal(centre) : null;
      return {
        canvas: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        inner: { width: window.innerWidth, height: window.innerHeight },
        stage: global ? { x: global.x, y: global.y } : null,
        mapOpts: {
          canvasWidth: view.width,
          canvasHeight: view.height,
          rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
          resolution: window.app?.renderer?.resolution ?? 1,
        },
        credit: window.slotStateData?.credit ?? null,
        bet: window.slotStateData?.bet ?? null,
      };
    });
    const spinPoint = fit.stage ? invertStageToClient(fit.stage.x, fit.stage.y, fit.mapOpts) : null;
    const canvasInside = fit.canvas.left >= -1 && fit.canvas.top >= -1
      && fit.canvas.left + fit.canvas.width <= fit.inner.width + 1
      && fit.canvas.top + fit.canvas.height <= fit.inner.height + 1;
    const spinInside = Boolean(spinPoint) && spinPoint.x >= 0 && spinPoint.y >= 0
      && spinPoint.x <= fit.inner.width && spinPoint.y <= fit.inner.height;
    check('cabinet-fits-viewport', canvasInside && spinInside && Number.isFinite(Number(fit.credit)) && Number(fit.bet) === 9,
      `canvas=${JSON.stringify(fit.canvas)} inner=${JSON.stringify(fit.inner)} spin=${JSON.stringify(spinPoint)} credit=${fit.credit} bet=${fit.bet}`);
    if (Number(armed.bet) !== 9 || armed.slotState !== 'IDLE') return;

    if (PHASE !== 'errors') {
    // --- settled line win: the credit regression ---------------------------------
    const winWalletBefore = await walletOf(user.id);
    const winPrevious = (await prisma.casinoRound.findFirst({
      where: { userId: user.id, gameVersion: { startsWith: 'book-of-ra-classic' } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    }))?.id ?? null;
    const winReplayIndex = betReplays.length;
    const callsBeforeWin = readCalls();
    check('win-click', await clickNamed('uiButtonSpin'), 'spin');
    const winRound = await newestRound(winPrevious);
    const winCollected = winRound ? await presentAndCollect(winRound.id) : null;
    const winLedger = winCollected ? await ledgerOf(winCollected.id) : [];
    const winWalletAfter = await walletOf(user.id);
    report.rounds.lineWin = {
      ...publicState(winCollected),
      walletBefore: String(winWalletBefore),
      walletAfter: String(winWalletAfter),
      ledger: winLedger,
      rngCallsBefore: callsBeforeWin,
      rngCallsAfter: readCalls(),
    };
    const winDebits = winLedger.filter((entry) => entry.type === 'CASINO_BET');
    const winCredits = winLedger.filter((entry) => entry.type === 'CASINO_WIN');
    check('line-win-one-debit', winDebits.length === 1 && winDebits[0].amount === '-9', JSON.stringify(winLedger));
    check('line-win-one-credit', winCollected?.status === 'CASHED_OUT' && winCredits.length === 1
      && winCredits[0].amount === String(winCollected.payout) && winCollected.payout > 0n, JSON.stringify(winLedger));
    check('line-win-wallet', winWalletAfter === winWalletBefore - 9n + winCollected.payout,
      `${winWalletBefore}->${winWalletAfter} payout=${winCollected?.payout}`);
    await assertCredits('line-win', winCollected?.payout ?? -1);
    const winStored = betReplays[winReplayIndex];
    const winReplayStatus = winStored ? await replayStored(winStored) : 0;
    const winWalletReplay = await walletOf(user.id);
    const winLedgerReplay = winCollected ? await ledgerOf(winCollected.id) : [];
    check('line-win-replay-no-second-credit', winReplayStatus === 200 && winWalletReplay === winWalletAfter
      && winLedgerReplay.length === winLedger.length && readCalls() === report.rounds.lineWin.rngCallsAfter,
      `status=${winReplayStatus} wallet=${winWalletReplay} ledger=${winLedgerReplay.length}`);
    const winShown = await readCabinet();
    check('line-win-board-matches-persisted', classicReelsMatch({ reelsSymbols: winShown.reelsSymbols }, winCollected),
      winShown.reelsSymbols ? 'shown' : 'missing');
    check('profile-hash-persisted', winCollected?.privateState?.profileId === 'book-of-ra-classic.rtp50.v1'
      && winCollected?.privateState?.profileHash === FROZEN_PROFILE_HASH,
      `${winCollected?.privateState?.profileId ?? 'none'} ${winCollected?.privateState?.profileHash ?? 'none'}`);
    await game.screenshot({ path: join(EVIDENCE, 'classic-line-win-credits.png') });

    // --- deliberate double-click on the next paid spin ---------------------------
    const lossWalletBefore = await walletOf(user.id);
    const lossPrevious = winCollected?.id ?? winPrevious;
    const lossBetsBefore = traffic.filter((entry) => entry.phase === 'request' && entry.slotEvent === 'bet').length;
    const callsBeforeLoss = readCalls();
    await clickNamed('uiButtonSpin');
    await sleep(60);
    await clickNamed('uiButtonSpin');
    const lossRound = await newestRound(lossPrevious);
    const lossDeadline = Date.now() + 25_000;
    let lossSettled = lossRound;
    while (lossSettled && lossSettled.status === 'OPEN' && Date.now() < lossDeadline) {
      await sleep(300);
      lossSettled = await prisma.casinoRound.findUnique({ where: { id: lossRound.id } });
    }
    await waitIdleAndRead();
    const lossBets = traffic.filter((entry) => entry.phase === 'request' && entry.slotEvent === 'bet').length - lossBetsBefore;
    const lossLedger = lossSettled ? await ledgerOf(lossSettled.id) : [];
    const lossWalletAfter = await walletOf(user.id);
    report.rounds.doubleClick = {
      ...publicState(lossSettled),
      betRequests: lossBets,
      walletBefore: String(lossWalletBefore),
      walletAfter: String(lossWalletAfter),
      ledger: lossLedger,
    };
    check('double-click-one-bet', lossBets === 1 && lossSettled?.status === 'LOST' && lossSettled.payout === 0n
      && lossLedger.length === 1 && lossLedger[0].amount === '-9',
      `bets=${lossBets} status=${lossSettled?.status} ledger=${JSON.stringify(lossLedger)}`);
    check('double-click-wallet', lossWalletAfter === lossWalletBefore - 9n && readCalls() > callsBeforeLoss,
      `${lossWalletBefore}->${lossWalletAfter} calls=${callsBeforeLoss}->${readCalls()}`);
    const lossShown = await readCabinet();
    check('loss-board-matches-persisted', classicReelsMatch({ reelsSymbols: lossShown.reelsSymbols }, lossSettled),
      lossShown.reelsSymbols ? 'shown' : 'missing');

    if (PHASE !== 'mobile') {
    // --- scripted retrigger feature, refresh, one collect ------------------------
    const featureWalletBefore = await walletOf(user.id);
    const featurePrevious = lossSettled?.id ?? lossPrevious;
    const featureReplayIndex = betReplays.length;
    const collectReplayIndex = collectReplays.length;
    const callsBeforeFeature = readCalls();
    check('feature-click', await clickNamed('uiButtonSpin'), 'spin');
    const featureRound = await newestRound(featurePrevious);
    check('feature-round-opened', featureRound?.privateState?.phase === 'FREE_SPINS', featureRound?.privateState?.phase ?? 'none');
    if (!featureRound) return;
    const triggerResponse = traffic.filter((entry) => entry.phase === 'response' && entry.body?.serverResponse?.expSymbol).at(-1);
    const expectedSymbol = triggerResponse?.body?.serverResponse?.expSymbol ?? featureRound.privateState?.result?.serverResponse?.expSymbol ?? null;
    report.rounds.feature = {
      id: featureRound.id,
      stake: String(featureRound.stake),
      expSymbol: expectedSymbol,
      walletBefore: String(featureWalletBefore),
    };

    const played = await playFeature(featureRound, { refresh: true, expectedSymbol, screenshotBook: true });
    const seenTotals = played.seenTotals;
    const paintedCounters = played.paintedCounters;
    const bookMatched = played.bookMatched;
    const refreshProof = played.refreshProof;
    const callsAtTrigger = played.callsAtTrigger;

    const featureBeforeCollect = await prisma.casinoRound.findUnique({ where: { id: featureRound.id } });
    check('feature-reached-collect', featureBeforeCollect?.privateState?.phase === 'PENDING_WIN'
      || featureBeforeCollect?.status === 'CASHED_OUT', featureBeforeCollect?.privateState?.phase ?? 'none');
    check('feature-expanding-symbol', bookMatched && expectedSymbol !== null, `symbol=${expectedSymbol} matched=${bookMatched}`);
    check('feature-retrigger-counter', seenTotals.has(10) && seenTotals.has(20), `totals=${[...seenTotals].join(',')}`);
    const paintedRetrigger = [...paintedCounters].some((text) => text.includes('Free Game') && text.includes('of 20'));
    const paintedStart = [...paintedCounters].some((text) => text.includes('Free Game') && text.includes('of 10'));
    check('feature-painted-counter', paintedStart && paintedRetrigger, [...paintedCounters].slice(0, 6).join(' | '));
    check('feature-refresh-restored', Boolean(refreshProof)
      && refreshProof.after.phase === 'FREE_SPINS'
      && refreshProof.after.index === refreshProof.before.index
      && refreshProof.after.total === refreshProof.before.total
      && refreshProof.after.pendingWin === refreshProof.before.pendingWin
      && refreshProof.after.calls === refreshProof.before.calls,
      JSON.stringify(refreshProof));
    const callsAfterFeatureSpins = readCalls();
    check('feature-no-extra-rng', callsAtTrigger !== null && callsAfterFeatureSpins === callsAtTrigger
      && callsAtTrigger === readBudget(),
      `trigger=${callsAtTrigger} after=${callsAfterFeatureSpins} budget=${readBudget()} beforeBet=${callsBeforeFeature}`);

    const featureCollected = await presentAndCollect(featureRound.id);
    const featureLedger = featureCollected ? await ledgerOf(featureCollected.id) : [];
    const featureWalletAfter = await walletOf(user.id);
    const featureDebits = featureLedger.filter((entry) => entry.type === 'CASINO_BET');
    const featureCredits = featureLedger.filter((entry) => entry.type === 'CASINO_WIN');
    report.rounds.feature = {
      ...report.rounds.feature,
      ...publicState(featureCollected),
      walletAfter: String(featureWalletAfter),
      ledger: featureLedger,
      seenTotals: [...seenTotals],
      paintedCounters: [...paintedCounters].slice(0, 12),
      refresh: refreshProof,
      rngCallsBefore: callsBeforeFeature,
      rngCallsAfter: readCalls(),
    };
    check('feature-one-debit', featureDebits.length === 1 && featureDebits[0].amount === '-9', JSON.stringify(featureLedger));
    check('feature-one-credit', featureCollected?.status === 'CASHED_OUT' && featureCredits.length === 1
      && featureCredits[0].amount === String(featureCollected.payout) && featureCollected.payout > 0n,
      JSON.stringify(featureLedger));
    check('feature-wallet', featureCollected?.payout > 0n
      && featureWalletAfter === featureWalletBefore - 9n + featureCollected.payout,
      `${featureWalletBefore}->${featureWalletAfter} payout=${featureCollected?.payout}`);
    await assertCredits('feature', featureCollected?.payout ?? -1);
    const featureBet = betReplays[featureReplayIndex];
    const featureCollect = collectReplays[collectReplayIndex] ?? collectReplays.at(-1);
    const callsBeforeReplay = readCalls();
    const featureBetReplay = featureBet ? await replayStored(featureBet) : 0;
    const featureCollectReplay = featureCollect ? await replayStored(featureCollect) : 0;
    const featureLedgerReplay = await ledgerOf(featureRound.id);
    const featureWalletReplay = await walletOf(user.id);
    check('feature-replay-no-second-credit', featureBetReplay === 200 && featureCollectReplay === 200
      && featureWalletReplay === featureWalletAfter
      && featureLedgerReplay.filter((entry) => entry.type === 'CASINO_WIN').length === 1
      && readCalls() === callsBeforeReplay,
      `bet=${featureBetReplay} collect=${featureCollectReplay} wallet=${featureWalletReplay}`);
    await game.screenshot({ path: join(EVIDENCE, 'classic-feature-credits.png') });
    }
    }

    if (PHASE !== 'mobile') {
    // --- HTTP 500 presentation: versioned gameplay only, then a clean reload ----
    const faultWallet = await walletOf(user.id);
    const faultRounds = await prisma.casinoRound.count({ where: { userId: user.id } });
    const faultCalls = readCalls();
    writeFileSync(FAULT_FILE, 'gameplay-500\n');
    const faultTraffic = traffic.length;
    const notesBeforeFault = consoleNotes.length;
    const idleBeforeFault = await readCabinet();
    check('http-500-armed', idleBeforeFault.slotState === 'IDLE', `state=${idleBeforeFault.slotState}`);
    await clickNamed('uiButtonSpin');
    const faultDeadline = Date.now() + 20_000;
    let faultStatuses = [];
    let faultReasons = 0;
    while (Date.now() < faultDeadline) {
      const slice = traffic.slice(faultTraffic).filter((entry) => entry.phase === 'response');
      faultStatuses = slice.map((entry) => entry.status);
      faultReasons = slice.filter((entry) => entry.status === 500 && entry.body?.reason === 'test fault').length;
      const rejected = consoleNotes.slice(notesBeforeFault).some((text) => text.includes('Recovery request rejected: 500'));
      const faultStatusesSeen = faultStatuses.filter((status) => status === 500).length;
      // The client retries a 500 once with the same identity. Clear the fault
      // only after that retry has also failed, otherwise the retry is a real bet.
      if (faultReasons >= 2 || faultStatusesSeen >= 2 || (rejected && faultStatusesSeen >= 1)) break;
      await sleep(200);
    }
    const sawFault = faultStatuses.filter((status) => status === 500).length >= 1
      && consoleNotes.slice(notesBeforeFault).some((text) => text.includes('Recovery request rejected: 500'));
    check('http-500-presented', sawFault, `statuses=${faultStatuses.join(',')} reasons=${faultReasons} notes=${consoleNotes.slice(notesBeforeFault).slice(-3).join(' | ')}`);
    writeFileSync(FAULT_FILE, '');
    await game.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
    const restoredCabinet = await waitForCabinet();
    const faultWalletAfter = await walletOf(user.id);
    const faultRoundsAfter = await prisma.casinoRound.count({ where: { userId: user.id } });
    check('http-500-no-mutation', faultWalletAfter === faultWallet && faultRoundsAfter === faultRounds && readCalls() === faultCalls
      && Number(restoredCabinet.credit) === Number(faultWalletAfter),
      `wallet=${faultWalletAfter} rounds=${faultRoundsAfter} credit=${restoredCabinet.credit} calls=${readCalls()}`);

    // --- gateway outage, then the same session loads again ----------------------
    const outageWallet = await walletOf(user.id);
    const outageRounds = await prisma.casinoRound.count({ where: { userId: user.id } });
    const outageCalls = readCalls();
    await stopChild(gateway);
    await sleep(500);
    await clickNamed('uiButtonSpin').catch(() => false);
    await sleep(1500);
    const outageWalletMid = await walletOf(user.id);
    const outageRoundsMid = await prisma.casinoRound.count({ where: { userId: user.id } });
    gateway = start('classic-gateway-restored', process.execPath, ['games/book-of-ra-classic/gateway/server.mjs'], ROOT, gatewayEnv);
    const gatewayBack = await waitForHttp(`${CLASSIC}/healthz`, gateway);
    await game.goto(`${CLASSIC}/play`, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    const outageCabinet = await waitForCabinet().catch(() => ({ slotState: null, credit: null }));
    check('gateway-outage-recovers', gatewayBack && outageWalletMid === outageWallet && outageRoundsMid === outageRounds
      && readCalls() === outageCalls && Number(outageCabinet.credit) === Number(outageWallet),
      `up=${gatewayBack} credit=${outageCabinet.credit} wallet=${outageWallet} state=${outageCabinet.slotState}`);

    // --- expired launch control on the launcher page -----------------------------
    await page.bringToFront();
    const expiryDeadline = Math.max(launchAt + 75_000, Date.now() + 8_000);
    let launchLabel = '';
    while (Date.now() < expiryDeadline) {
      launchLabel = await page.locator('button.casino-play').innerText().catch(() => '');
      if (launchLabel.includes('Launch expired')) break;
      await sleep(500);
    }
    launchLabel = await page.locator('button.casino-play').innerText().catch(() => launchLabel);
    const expiryCopy = await page.locator('.casino-inline-error').innerText().catch(() => '');
    const disabled = await page.locator('button.casino-play').isDisabled().catch(() => false);
    check('launch-expired-ui', launchLabel.includes('Launch expired') && disabled && /expired/i.test(expiryCopy),
      `label=${launchLabel} disabled=${disabled} copy=${expiryCopy}`);
    const expiryWallet = await walletOf(user.id);
    check('launch-expired-no-mutation', expiryWallet === outageWallet, `${outageWallet}->${expiryWallet}`);
    }

    // --- return to the lobby ------------------------------------------------------
    const lobbyBefore = await walletOf(user.id);
    await page.bringToFront();
    const lobbyLink = page.locator('a[href="/casino"]').filter({ visible: true }).first();
    await lobbyLink.click();
    await page.waitForURL((url) => url.pathname === '/casino', { timeout: 20_000 });
    const lobbyWallet = await walletOf(user.id);
    check('return-to-lobby', page.url().includes('/casino') && !page.url().includes('book-of-ra-classic')
      && lobbyWallet === lobbyBefore, page.url());

    // --- insufficient PTS on a zero-balance fixture ------------------------------
    const broke = await prisma.user.findUnique({ where: { email: BROKE_EMAIL } });
    const brokeWalletBefore = await walletOf(broke.id);
    const brokeRoundsBefore = await prisma.casinoRound.count({ where: { userId: broke.id } });
    const brokeContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const brokePage = await brokeContext.newPage();
    brokePage.on('dialog', (dialog) => { dialog.dismiss().catch(() => undefined); });
    await brokePage.goto(`${FRONTEND}/login`, { waitUntil: 'domcontentloaded' });
    const brokeLogin = await brokePage.evaluate(async ({ api, address, password }) => {
      const response = await fetch(`${api}/auth/login`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: address, password }),
      });
      return response.status;
    }, { api: API, address: BROKE_EMAIL, password: PASSWORD });
    check('broke-login', brokeLogin === 200 || brokeLogin === 201, String(brokeLogin));
    await brokePage.goto(`${FRONTEND}/casino/slots/book-of-ra-classic`, { waitUntil: 'networkidle' });
    await brokePage.locator('button.casino-play').waitFor({ state: 'visible', timeout: 30_000 });
    await brokePage.waitForFunction(() => {
      const button = document.querySelector('button.casino-play');
      return button instanceof HTMLButtonElement && !button.disabled;
    }, null, { timeout: 30_000 });
    const [brokeGame] = await Promise.all([
      brokeContext.waitForEvent('page'),
      brokePage.locator('button.casino-play').click(),
    ]);
    await brokeGame.waitForLoadState('domcontentloaded');
    let brokeBets = 0;
    brokeGame.on('request', (request) => {
      if (!request.url().includes('/game/BookOfRaCL/server')) return;
      try {
        const body = JSON.parse(request.postData() ?? 'null');
        if (body?.slotEvent === 'bet') brokeBets += 1;
      } catch { /* ignore */ }
    });
    await brokeGame.waitForFunction(() => window.isFontLoaded === true && typeof window.gameUI?.GetObject === 'function', null, { timeout: 45_000 });
    const brokeCredit = await brokeGame.evaluate(() => window.slotStateData?.credit ?? null);
    const brokeClick = await brokeGame.evaluate(() => {
      const target = window.gameUI?.GetObject?.()?.uiButtonSpin?._view;
      if (!target) return null;
      const bounds = target.getLocalBounds();
      const centre = new window.PIXI.Point(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      const global = target.toGlobal(centre);
      const view = window.app.view;
      const rect = view.getBoundingClientRect();
      return {
        stage: { x: global.x, y: global.y },
        mapOpts: {
          canvasWidth: view.width, canvasHeight: view.height,
          rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
          resolution: window.app.renderer.resolution ?? 1,
        },
      };
    });
    if (brokeClick) {
      const point = invertStageToClient(brokeClick.stage.x, brokeClick.stage.y, brokeClick.mapOpts);
      await brokeGame.mouse.move(point.x, point.y, { steps: 3 });
      await brokeGame.mouse.down();
      await brokeGame.waitForTimeout(40);
      await brokeGame.mouse.up();
    }
    await sleep(1500);
    const brokeAfterClick = await brokeGame.evaluate(() => ({
      slotState: typeof slotState === 'string' ? slotState : null,
      credit: window.slotStateData?.credit ?? null,
      bet: window.slotStateData?.bet ?? null,
    }));
    const brokeWalletAfter = await walletOf(broke.id);
    const brokeRoundsAfter = await prisma.casinoRound.count({ where: { userId: broke.id } });
    report.rounds.insufficient = {
      walletBefore: String(brokeWalletBefore),
      walletAfter: String(brokeWalletAfter),
      creditBefore: brokeCredit,
      cabinet: brokeAfterClick,
      betRequests: brokeBets,
      roundsBefore: brokeRoundsBefore,
      roundsAfter: brokeRoundsAfter,
    };
    check('insufficient-pts-no-mutation', brokeWalletBefore === 0n && brokeWalletAfter === 0n && brokeBets === 0
      && brokeRoundsAfter === brokeRoundsBefore && Number(brokeCredit) === 0,
      JSON.stringify(report.rounds.insufficient));
    await brokeContext.close();
  } catch (error) {
    check('run-aborted', false, error?.stack ?? String(error));
  } finally {
    try { if (browser) await browser.close(); } catch { /* ignore */ }
    for (const record of children) await stopChild(record);
    report.finishedAt = new Date().toISOString();
    report.passed = results.filter((entry) => entry.ok).length;
    report.failed = results.filter((entry) => !entry.ok).length;
    report.traffic = [];
    writeFileSync(join(EVIDENCE, 'classic-feature-browser-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    for (const record of children) writeFileSync(join(EVIDENCE, `child-${record.label}.log`), record.log.join(''));
    writeFileSync(join(EVIDENCE, 'SUMMARY.md'), [
      '# Classic feature browser',
      '',
      `- ${report.startedAt} -> ${report.finishedAt}`,
      `- checks: ${report.passed} passed / ${report.failed} failed`,
      `- physical mobile: not tested`,
      `- licensing: CLASSIC_PUBLIC_DEPLOYMENT_BLOCKED_PENDING_ASSET_RIGHTS`,
      '',
      ...results.map((entry) => `- ${entry.ok ? 'PASS' : 'FAIL'} ${entry.name}${entry.ok ? '' : `: ${entry.detail}`}`),
      '',
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
