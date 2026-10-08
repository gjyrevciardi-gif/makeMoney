/*
 * Bounded browser smoke test for the Book of Ra Classic gateway.
 *
 * It drives the recovered client in headless Chrome through the real gateway,
 * with a stub platform standing in for the backend. The stub answers the first
 * `getSettings` with the native `error` envelope on purpose: the client's
 * settings payload is the platform's contract, owned elsewhere, so this run
 * stops exactly at that boundary.
 *
 * What it therefore proves about the gateway itself: the entry page boots the
 * native bundle from the gateway origin, every native asset resolves 200
 * same-origin with no external request, the local font-readiness shim fires
 * `InitializeGame()`, the client's own protocol request reaches the platform
 * route through the gateway carrying the game-session header, and the page
 * raises no errors on the way.
 *
 * Usage:
 *   node games/book-of-ra-classic/gateway/gateway-browser-smoke.cjs
 */
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..', '..', '..');
const SERVER = path.join(HERE, 'server.mjs');
const CLIENT_DIR = process.env.BOOK_CLASSIC_CLIENT_DIR
  ?? path.join(ROOT, 'games', 'book-of-ra-classic', 'client');
const REPORT = path.join(HERE, 'browser-smoke.json');
const SHOT = path.join(HERE, 'browser-smoke.png');
const LAUNCH_ORIGIN = 'http://localhost:3000';
const COOKIE_NAME = 'boc_session';
const PLAYWRIGHT = process.env.BOOK_CLASSIC_PLAYWRIGHT
  ?? 'C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
const CHROME = process.env.BOOK_CLASSIC_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TOKEN = `fixture-${crypto.randomBytes(24).toString('hex')}`; // synthetic, loopback only
const SESSION = `fixture-session-${crypto.randomBytes(12).toString('hex')}`; // synthetic, loopback only

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail: String(detail ?? '') });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` :: ${detail}`}\n`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitFor(url, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.status) return true;
    } catch (error) { /* not up yet */ }
    await sleep(125);
  }
  return false;
}

async function main() {
  if (!fs.existsSync(CHROME) || !fs.existsSync(PLAYWRIGHT)) {
    results.push({ name: 'browser.skipped', ok: true, detail: `chrome=${fs.existsSync(CHROME)} playwright=${fs.existsSync(PLAYWRIGHT)}` });
    process.stdout.write(`SKIP browser.skipped :: chrome=${fs.existsSync(CHROME)} playwright=${fs.existsSync(PLAYWRIGHT)}\n`);
    fs.writeFileSync(REPORT, `${JSON.stringify({ generatedAt: new Date().toISOString(), skipped: true, results }, null, 1)}\n`);
    process.exit(0);
  }
  const { chromium } = require(PLAYWRIGHT);
  const stubPort = await freePort();
  const gatewayPort = await freePort();
  const gatewayBase = `http://127.0.0.1:${gatewayPort}`;
  const stubCalls = [];

  const stub = http.createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      stubCalls.push({ method: request.method, url: request.url, headers: request.headers, body: raw });
      if (request.method === 'POST' && request.url === '/casino/book-of-ra-classic/launch/exchange') {
        const token = (() => { try { return JSON.parse(raw).token; } catch { return null; } })();
        response.writeHead(token === TOKEN ? 201 : 401, { 'Content-Type': 'application/json' });
        response.end(token === TOKEN ? JSON.stringify({ sessionToken: SESSION }) : '{"reason":"launch rejected"}');
        return;
      }
      if (request.method === 'POST' && request.url.startsWith('/casino/book-of-ra-classic/session/gameplay')) {
        // Deliberately the native error envelope: the settings payload is the
        // platform's contract and is not invented here.
        // The delay gives the checks below a deterministic window before the
        // bridge reconciles the rejection by reloading.
        setTimeout(() => {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({
            responseEvent: 'error',
            responseType: 'getSettings',
            serverResponse: 'browser smoke: settings are served by the platform backend',
          }));
        }, 1500);
        return;
      }
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('unexpected upstream route');
    });
  });
  await new Promise((resolve) => stub.listen(stubPort, '127.0.0.1', resolve));

  const gateway = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      BOOK_CLASSIC_GATEWAY_PORT: String(gatewayPort),
      BOOK_CLASSIC_GATEWAY_HOST: '127.0.0.1',
      BOOK_CLASSIC_ORIGIN: gatewayBase,
      BOOK_CLASSIC_CLIENT_DIR: CLIENT_DIR,
      BOOK_CLASSIC_LAUNCH_ORIGINS: LAUNCH_ORIGIN,
      PLATFORM_URL: `http://localhost:${stubPort}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let browser = null;
  const outbound = [];
  const pageErrors = [];
  const assetResponses = [];
  const dialogs = [];
  const navigations = [];
  const requests = [];

  try {
    check('gateway.up', await waitFor(`${gatewayBase}/healthz`), 'healthz reachable');

    browser = await chromium.launch({
      headless: true,
      executablePath: CHROME,
      // Only loopback may resolve; everything else is mapped away so a stray
      // external request cannot silently succeed.
      args: ['--disable-background-networking', '--host-resolver-rules=EXCLUDE localhost, EXCLUDE 127.0.0.1, MAP * ~NOTFOUND'],
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    await context.route('**/*', (route) => {
      const host = new URL(route.request().url()).hostname;
      if (host === '127.0.0.1' || host === 'localhost') return route.continue();
      outbound.push(route.request().url());
      return route.abort();
    });

    // Exchange the one-time capability exactly as the platform launcher does.
    const exchange = await context.request.post(`${gatewayBase}/launch`, {
      headers: { origin: LAUNCH_ORIGIN },
      form: { token: TOKEN },
      maxRedirects: 0,
    });
    check('exchange.redirects-to-play', exchange.status() === 303 && exchange.headers().location === '/play',
      `status=${exchange.status()} location=${exchange.headers().location}`);
    const setCookie = exchange.headers()['set-cookie'] ?? '';
    check('exchange.sets-an-httponly-game-cookie',
      new RegExp(`${COOKIE_NAME}=`).test(setCookie) && /HttpOnly/i.test(setCookie),
      setCookie.replace(new RegExp(`${COOKIE_NAME}=[^;]+`), `${COOKIE_NAME}=<redacted>`));

    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('dialog', async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); });
    page.on('response', (response) => {
      const url = response.url();
      if (url.startsWith(gatewayBase)) assetResponses.push({ url: url.slice(gatewayBase.length), status: response.status(), type: response.headers()['content-type'] ?? '' });
    });
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations.push({ url: frame.url(), at: Date.now() });
    });
    page.on('request', (request) => requests.push({ url: request.url(), method: request.method(), type: request.resourceType() }));

    const document = await page.goto(`${gatewayBase}/play`, { waitUntil: 'load' });
    check('page.serves-the-entry-document',
      document.status() === 200 && page.url().endsWith('/play'),
      `${document.status()} ${page.url()}`);
    const csp = document.headers()['content-security-policy'] ?? '';
    check('page.document-carries-the-restrictive-csp',
      /default-src 'self'/.test(csp) && /connect-src 'self'/.test(csp),
      csp.slice(0, 80));

    // The native client boots through the local font shim, then issues getSettings.
    await page.waitForFunction(() => window.isFontLoaded === true, null, { timeout: 30000 })
      .then(() => check('client.font-shim-ran-the-native-bootstrap', true, 'isFontLoaded=true'))
      .catch(async () => check('client.font-shim-ran-the-native-bootstrap', false,
        await page.evaluate(() => JSON.stringify({ isFontLoaded: window.isFontLoaded, hasShim: typeof window.previewFontReady })).catch(() => 'eval failed')));
    check('client.bridge-installed-its-hooks',
      await page.evaluate(() => typeof window.ServerConnect === 'function' && typeof window.GameReel === 'function' && Array.isArray(window.pilotReceipts)),
      'ServerConnect/GameReel wrapped, receipt list present');
    check('client.gateway-sourced-every-native-script',
      (await page.evaluate(() => Array.from(document.scripts).map((script) => script.src)))
        .filter((src) => src && !src.startsWith(gatewayBase)).length === 0,
      'no script from another origin');
    await page.screenshot({ path: SHOT });

    // Wait for the client's own first protocol call to appear upstream.
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (stubCalls.some((call) => call.url.startsWith('/casino/book-of-ra-classic/session/gameplay'))) break;
      await sleep(250);
    }
    const gameCall = stubCalls.find((call) => call.url.startsWith('/casino/book-of-ra-classic/session/gameplay'));
    check('client.native-getSettings-reaches-the-platform-route',
      Boolean(gameCall) && gameCall.body === JSON.stringify({ slotEvent: 'getSettings' }),
      gameCall ? gameCall.body : 'no upstream gameplay call');
    check('client.carries-the-game-session-header',
      Boolean(gameCall) && gameCall.headers['x-book-classic-session'] === SESSION,
      gameCall ? (gameCall.headers['x-book-classic-session'] === SESSION ? '<present>' : '<mismatch>') : 'no upstream gameplay call');

    // The stub rejects the read on purpose. The bridge is inherited from the
    // accepted Lucky Lady gateway, so a rejected native request is reconciled by
    // reloading the authoritative snapshot rather than by guessing; this run
    // observes exactly that and bounds it to the first reconciliation.
    await page.waitForFunction(
      () => document.readyState !== 'loading',
      null,
      { timeout: 20000 },
    ).catch(() => {});
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (navigations.length >= 2 && stubCalls.filter((call) => call.url.startsWith('/casino/book-of-ra-classic/session/gameplay')).length >= 2) break;
      await sleep(250);
    }
    check('client.rejected-read-is-reconciled-by-reloading-the-authoritative-state',
      navigations.length >= 2 && navigations.every((entry) => entry.url.startsWith(gatewayBase)),
      JSON.stringify(navigations));
    check('client.re-reaches-the-platform-route-after-the-reload',
      stubCalls.filter((call) => call.url.startsWith('/casino/book-of-ra-classic/session/gameplay')).length >= 2,
      `${stubCalls.filter((call) => call.url.startsWith('/casino/book-of-ra-classic/session/gameplay')).length} gameplay calls`);

    const nativeAssets = assetResponses.filter((entry) => entry.url.startsWith('/games/BookOfRaCL/'));
    const failedAssets = nativeAssets.filter((entry) => entry.status >= 400);
    check('assets.every-native-asset-resolved',
      nativeAssets.length >= 12 && failedAssets.length === 0,
      `ok=${nativeAssets.length - failedAssets.length} failed=${failedAssets.length}`
      + (failedAssets.length ? ` first=${failedAssets[0].url}:${failedAssets[0].status}` : ''));
    check('assets.served-the-local-font-stylesheet',
      assetResponses.some((entry) => entry.url === '/games/BookOfRaCL/css/fonts.css' && entry.status === 200),
      `${nativeAssets.length} native responses`);
    check('assets.did-not-request-the-external-webfont-loader',
      !assetResponses.some((entry) => entry.url.includes('webfont.js')),
      'no /games/BookOfRaCL/js/lib/webfont.js request');
    check('network.no-external-request',
      outbound.length === 0,
      outbound.slice(0, 3).join(','));
    check('client.no-page-errors',
      pageErrors.length === 0,
      pageErrors.slice(0, 3).join(' | '));
    // The bridge intercepts the native request, so a `responseEvent: 'error'`
    // envelope is reconciled by reload and never reaches the client's own
    // `alert` handler. A Chrome dialog here would mean the bridge did not run.
    check('client.rejected-envelope-is-handled-by-the-bridge-not-native-alert',
      dialogs.length === 0,
      dialogs.join(' | '));

    const browserState = await page.evaluate(() => ({
      isFontLoaded: window.isFontLoaded === true,
      bridgeInstalled: typeof window.ServerConnect === 'function',
      recoveryReady: window.pilotRecoveryReady === true,
      recovery: window.pilotRecovery ?? null,
      sessionId: sessionStorage.getItem('sessionId'),
    })).catch((error) => ({ evaluateError: String(error.message) }));
    check('client.no-settings-payload-was-invented-anywhere',
      browserState.recovery === null || browserState.recovery === undefined,
      JSON.stringify(browserState));

    const report = {
      generatedAt: new Date().toISOString(),
      mode: 'loopback-stub-platform',
      boundary: 'stub answers getSettings with the native error envelope; the settings payload is the platform contract',
      checks: results.length,
      failures: results.filter((entry) => !entry.ok).length,
      results,
      browserState,
      dialogs,
      outboundRequests: outbound,
      pageErrors,
      navigations,
      requests,
      assetResponses,
      stubPlatformCalls: stubCalls.map((call) => ({
        method: call.method,
        url: call.url,
        sessionHeader: call.headers['x-book-classic-session'] ? '<present>' : null,
        requestId: call.headers['x-pilot-request-id'] ?? null,
        // The only credential in play is this run's synthetic loopback fixture.
        body: call.body.split(TOKEN).join('<fixture-token>'),
      })),
      screenshot: SHOT,
    };
    fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 1)}\n`);
  } catch (error) {
    check('suite.completed-without-exception', false, error && error.stack ? error.stack.split('\n').slice(0, 3).join(' | ') : String(error));
    fs.writeFileSync(REPORT, `${JSON.stringify({ generatedAt: new Date().toISOString(), results, pageErrors, outboundRequests: outbound }, null, 1)}\n`);
  } finally {
    try { if (browser) await browser.close(); } catch (error) { /* ignore */ }
    try { gateway.kill(); } catch (error) { /* ignore */ }
    await new Promise((resolve) => stub.close(resolve));
  }

  const failed = results.filter((entry) => !entry.ok);
  process.stdout.write(`${JSON.stringify({ checks: results.length, failures: failed.length, failed: failed.map((entry) => entry.name) })}\n`);
  process.stdout.write(`report: ${REPORT}\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
