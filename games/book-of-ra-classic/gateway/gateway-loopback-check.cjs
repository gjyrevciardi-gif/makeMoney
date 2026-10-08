/*
 * Bounded loopback evidence for the Book of Ra Classic gateway.
 *
 * It needs no platform backend: a stub platform that answers only the two
 * routes this gateway is allowed to reach stands in for it, so the gateway's
 * own behaviour - static serving, path containment, MIME allowlist, capability
 * exchange, cookie and session-header forwarding, request identity, Host and
 * Origin refusal and the configuration guard - is observed directly.
 *
 * The capability token used here is a synthetic loopback fixture. No real
 * credential, database or production service is touched, and the recovered
 * client directory is only read (its manifest is compared before and after).
 *
 * Usage:
 *   node games/book-of-ra-classic/gateway/gateway-loopback-check.cjs
 */
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..', '..', '..');
const SERVER = path.join(HERE, 'server.mjs');
const CLIENT_DIR = process.env.BOOK_CLASSIC_CLIENT_DIR
  ?? path.join(ROOT, 'games', 'book-of-ra-classic', 'client');
const MANIFEST = path.join(ROOT, 'games', 'book-of-ra-classic', 'reference', 'client-manifest.json');
const REPORT = path.join(HERE, 'loopback-check.json');
const LAUNCH_ORIGIN = 'http://localhost:3000';
const GAME_PREFIX = '/games/BookOfRaCL/';
const GAME_ROUTE = '/game/BookOfRaCL/server';
const COOKIE_NAME = 'boc_session';
const TOKEN = `fixture-${crypto.randomBytes(24).toString('hex')}`; // synthetic, loopback only
const SESSION = `fixture-session-${crypto.randomBytes(12).toString('hex')}`; // synthetic, loopback only

const results = [];
const children = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail: String(detail ?? '') });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` :: ${detail}`}\n`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function manifestOf(dir) {
  const entries = [];
  const walk = (current, base) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else entries.push([rel, crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')]);
    }
  };
  walk(dir, '');
  return entries.sort((left, right) => (left[0] < right[0] ? -1 : 1));
}

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

/** Sends a raw request so a forbidden/foreign Host header can be set. */
function rawRequest(port, options, body) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, ...options }, (response) => {
      let text = '';
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: text }));
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

async function main() {
  const stubPort = await freePort();
  const gatewayPort = await freePort();
  const stubBase = `http://127.0.0.1:${stubPort}`;
  const gatewayBase = `http://127.0.0.1:${gatewayPort}`;
  const stubCalls = [];

  // --- stub platform: only the two routes this gateway may reach -----------
  const stub = http.createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      stubCalls.push({ method: request.method, url: request.url, headers: request.headers, body: raw });
      if (request.method === 'POST' && request.url === '/casino/book-of-ra-classic/launch/exchange') {
        const token = (() => { try { return JSON.parse(raw).token; } catch { return null; } })();
        if (token !== TOKEN) {
          response.writeHead(401, { 'Content-Type': 'application/json' });
          response.end('{"reason":"launch rejected"}');
          return;
        }
        response.writeHead(201, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ sessionToken: SESSION }));
        return;
      }
      if (request.method === 'POST' && request.url.startsWith('/casino/book-of-ra-classic/session/gameplay')) {
        if (request.headers['x-book-classic-session'] !== SESSION) {
          response.writeHead(401, { 'Content-Type': 'application/json' });
          response.end('{"reason":"game session required"}');
          return;
        }
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({
          responseEvent: 'getSettings',
          serverResponse: { echo: raw },
          recovery: {
            roundId: 'none',
            actionId: 'STUBACTION0001',
            version: 0,
            phase: 'IDLE',
            balance: 1000,
            pendingWin: 0,
            settlement: { collected: false },
            receipt: { acked: false },
            result: null,
            lastGamble: null,
            free: { total: 0, current: 0 },
            gamble: { attempts: 0, cards: [] },
            profile: { profileHash: 'stub' },
          },
        }));
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
  children.push(gateway);
  let gatewayStdout = '';
  let gatewayStderr = '';
  gateway.stdout.on('data', (chunk) => { gatewayStdout += chunk; });
  gateway.stderr.on('data', (chunk) => { gatewayStderr += chunk; });

  try {
    const manifestBefore = manifestOf(CLIENT_DIR);
    const expected = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).files
      .map((entry) => [entry.path, entry.sha256])
      .sort((left, right) => (left[0] < right[0] ? -1 : 1));
    check('client.directory-matches-reference-manifest',
      JSON.stringify(manifestBefore) === JSON.stringify(expected),
      `files=${manifestBefore.length} expected=${expected.length}`);

    check('gateway.up', await waitFor(`${gatewayBase}/healthz`), 'healthz reachable');
    check('gateway.startup-log-names-the-game',
      gatewayStdout.includes('"game":"book-of-ra-classic"') && gatewayStdout.includes('"gameRoute":"/game/BookOfRaCL/server"'),
      gatewayStdout.trim().slice(0, 200));

    // --- health and header hardening ---------------------------------------
    const health = await fetch(`${gatewayBase}/healthz`);
    const healthBody = await health.json();
    check('health.reports-game-and-client',
      health.status === 200 && healthBody.game === 'book-of-ra-classic' && healthBody.client === true,
      JSON.stringify(healthBody));
    const csp = health.headers.get('content-security-policy') ?? '';
    check('headers.restrictive-csp',
      /default-src 'self'/.test(csp) && /connect-src 'self'/.test(csp) && /object-src 'none'/.test(csp)
      && /frame-src 'none'/.test(csp),
      csp);
    check('headers.nosniff-and-no-store',
      health.headers.get('x-content-type-options') === 'nosniff'
      && health.headers.get('cache-control') === 'no-store',
      `${health.headers.get('x-content-type-options')} / ${health.headers.get('cache-control')}`);

    // --- native entry page -------------------------------------------------
    const play = await fetch(`${gatewayBase}/play`);
    const entryHtml = await play.text();
    check('entry.serves-the-native-bundle-in-blade-order',
      play.headers.get('content-type') === 'text/html'
      && entryHtml.indexOf('/games/BookOfRaCL/js/core.js') > 0
      && entryHtml.indexOf('/games/BookOfRaCL/js/classes/GameBonus.js') < entryHtml.indexOf('/games/BookOfRaCL/js/core.js')
      && entryHtml.indexOf('/games/BookOfRaCL/js/classes/GameGamble.js') < entryHtml.indexOf('/games/BookOfRaCL/js/core.js'),
      'script order matches resources/views/.../BookOfRaCL.blade.php');
    check('entry.references-local-fonts-not-webfont-js',
      entryHtml.includes('/games/BookOfRaCL/css/fonts.css') && !entryHtml.includes('js/lib/webfont.js'),
      'local fonts.css + first-party readiness shim');
    check('entry.loads-the-first-party-bridge',
      entryHtml.includes('/recovery-client.js') && entryHtml.includes('/preview-font-ready.js'),
      'bridge and shim present');
    check('entry.has-no-absolute-external-reference',
      !/(?:src|href)\s*=\s*["'](?:https?:)?\/\//i.test(entryHtml),
      'no cross-origin asset references');

    const shim = await fetch(`${gatewayBase}/preview-font-ready.js`);
    check('shim.served-as-javascript',
      shim.status === 200 && shim.headers.get('content-type') === 'application/javascript'
      && (await shim.text()).includes('WebFontConfig.active()'),
      shim.status);
    const bridge = await fetch(`${gatewayBase}/recovery-client.js`);
    const bridgeText = await bridge.text();
    check('bridge.served-and-targets-the-classic-route',
      bridge.status === 200 && bridgeText.includes('/game/BookOfRaCL/server'),
      bridge.status);
    check('bridge.keeps-the-ll-recovery-events-and-fields',
      ['recoveryCollect', 'recoveryGamble', 'slotEvent: \'ack\'', 'slotFreeMpl', 'reelsSymbols'].every((needle) => bridgeText.includes(needle)),
      'collect/gamble/ack + classic guard');

    // --- static client files ----------------------------------------------
    const coreFile = path.join(CLIENT_DIR, 'js', 'core.js');
    const coreResponse = await fetch(`${gatewayBase}${GAME_PREFIX}js/core.js`);
    const coreBytes = Buffer.from(await coreResponse.arrayBuffer());
    check('static.serves-exact-bytes-from-the-client-dir',
      coreResponse.status === 200
      && coreResponse.headers.get('content-type') === 'application/javascript'
      && Buffer.compare(coreBytes, fs.readFileSync(coreFile)) === 0,
      `status=${coreResponse.status} bytes=${coreBytes.length}`);
    const configResponse = await fetch(`${gatewayBase}${GAME_PREFIX}config/desktop_view.json`);
    check('static.serves-the-native-view-config',
      configResponse.status === 200 && configResponse.headers.get('content-type') === 'application/json',
      configResponse.status);
    const soundResponse = await fetch(`${gatewayBase}${GAME_PREFIX}source/SOUND/DING.mp3`);
    check('static.serves-audio-with-a-media-type',
      soundResponse.status === 200 && soundResponse.headers.get('content-type') === 'audio/mpeg',
      soundResponse.headers.get('content-type'));
    const missing = await fetch(`${gatewayBase}${GAME_PREFIX}js/nope.js`);
    check('static.missing-file-is-404', missing.status === 404, missing.status);
    const traversal = await fetch(`${gatewayBase}${GAME_PREFIX}%2e%2e/%2e%2e/package.json`);
    check('static.path-traversal-refused', traversal.status === 404, traversal.status);
    const outsidePrefix = await fetch(`${gatewayBase}/package.json`);
    check('static.outside-the-client-prefix-refused', outsidePrefix.status === 404, outsidePrefix.status);

    // --- Host / Origin enforcement -----------------------------------------
    const foreignHost = await rawRequest(gatewayPort, { method: 'GET', path: '/healthz', headers: { Host: 'attacker.example' } });
    check('host.foreign-host-refused', foreignHost.status === 403, foreignHost.status);
    const foreignOriginGameplay = await fetch(`${gatewayBase}${GAME_ROUTE}`, {
      method: 'POST',
      headers: { origin: 'http://attacker.example', 'content-type': 'application/json', cookie: `${COOKIE_NAME}=${SESSION}` },
      body: JSON.stringify({ slotEvent: 'getSettings' }),
    });
    check('origin.foreign-gameplay-origin-refused',
      foreignOriginGameplay.status === 403 && stubCalls.length === 0,
      `status=${foreignOriginGameplay.status} upstream=${stubCalls.length}`);

    // --- gameplay without a capability -------------------------------------
    const noCookie = await fetch(`${gatewayBase}${GAME_ROUTE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slotEvent: 'getSettings' }),
    });
    const noCookieBody = await noCookie.json();
    check('gameplay.requires-the-game-cookie',
      noCookie.status === 401 && noCookieBody.responseEvent === 'error' && stubCalls.length === 0,
      `status=${noCookie.status}`);

    // --- capability exchange -----------------------------------------------
    const untrusted = await fetch(`${gatewayBase}/launch`, {
      method: 'POST',
      headers: { origin: 'http://attacker.example', 'content-type': 'application/x-www-form-urlencoded' },
      body: `token=${TOKEN}`,
      redirect: 'manual',
    });
    check('launch.untrusted-origin-refused', untrusted.status === 403, untrusted.status);
    const noOrigin = await fetch(`${gatewayBase}/launch`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `token=${TOKEN}`,
      redirect: 'manual',
    });
    check('launch.missing-origin-refused', noOrigin.status === 403, noOrigin.status);
    const shortToken = await fetch(`${gatewayBase}/launch`, {
      method: 'POST',
      headers: { origin: LAUNCH_ORIGIN, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'token=tooshort',
      redirect: 'manual',
    });
    check('launch.undersized-token-refused', shortToken.status === 400, shortToken.status);
    const badToken = await fetch(`${gatewayBase}/launch`, {
      method: 'POST',
      headers: { origin: LAUNCH_ORIGIN, 'content-type': 'application/x-www-form-urlencoded' },
      body: `token=${'z'.repeat(43)}`,
      redirect: 'manual',
    });
    check('launch.upstream-rejection-is-not-a-redirect', badToken.status === 401, badToken.status);

    const exchange = await fetch(`${gatewayBase}/launch`, {
      method: 'POST',
      headers: { origin: LAUNCH_ORIGIN, 'content-type': 'application/x-www-form-urlencoded' },
      body: `token=${TOKEN}`,
      redirect: 'manual',
    });
    const setCookie = exchange.headers.get('set-cookie') ?? '';
    check('launch.exchange-redirects-to-a-clean-url',
      exchange.status === 303 && exchange.headers.get('location') === '/play',
      `status=${exchange.status} location=${exchange.headers.get('location')}`);
    check('launch.sets-an-httponly-same-site-game-cookie',
      new RegExp(`${COOKIE_NAME}=`).test(setCookie) && /HttpOnly/i.test(setCookie) && /SameSite=Strict/i.test(setCookie),
      setCookie.replace(new RegExp(`${COOKIE_NAME}=[^;]+`), `${COOKIE_NAME}=<redacted>`));
    check('launch.never-puts-the-token-in-the-url',
      !String(exchange.headers.get('location') ?? '').includes(TOKEN),
      'token absent from Location');
    check('launch.forwards-the-token-to-the-platform-route',
      stubCalls.some((call) => call.url === '/casino/book-of-ra-classic/launch/exchange'
        && JSON.parse(call.body).token === TOKEN),
      'stub saw the exchange');

    // --- gameplay forwarding ----------------------------------------------
    const requestId = 'check-request-0001';
    const betBody = JSON.stringify({ slotEvent: 'bet', slotBet: 1, slotLines: 9 });
    const bet = await fetch(`${gatewayBase}${GAME_ROUTE}?sessionId=42`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `${COOKIE_NAME}=${SESSION}`,
        'x-pilot-request-id': requestId,
        'x-pilot-version': '7',
        'x-pilot-round': 'round-abc',
      },
      body: betBody,
    });
    const betJson = await bet.json();
    const forwarded = stubCalls.find((call) => call.url.startsWith('/casino/book-of-ra-classic/session/gameplay'));
    check('gameplay.forwards-the-session-header',
      bet.status === 200 && forwarded && forwarded.headers['x-book-classic-session'] === SESSION,
      `status=${bet.status} header=${forwarded && forwarded.headers['x-book-classic-session'] === SESSION ? '<present>' : '<mismatch>'}`);
    check('gameplay.preserves-the-query-string',
      forwarded && forwarded.url === '/casino/book-of-ra-classic/session/gameplay?sessionId=42',
      forwarded && forwarded.url);
    check('gameplay.forwards-request-identity-and-round-guards',
      forwarded && forwarded.headers['x-pilot-request-id'] === requestId
      && forwarded.headers['x-pilot-version'] === '7' && forwarded.headers['x-pilot-round'] === 'round-abc',
      JSON.stringify({
        requestId: forwarded && forwarded.headers['x-pilot-request-id'],
        version: forwarded && forwarded.headers['x-pilot-version'],
        round: forwarded && forwarded.headers['x-pilot-round'],
      }));
    check('gameplay.forwards-the-body-verbatim',
      forwarded && forwarded.body === betBody,
      forwarded && forwarded.body);
    check('gameplay.returns-the-platform-envelope-and-recovery-snapshot',
      betJson.responseEvent === 'getSettings' && betJson.recovery && betJson.recovery.roundId === 'none'
      && betJson.serverResponse.echo === betBody,
      JSON.stringify(Object.keys(betJson)));
    check('gameplay.does-not-forward-the-platform-cookie-name',
      forwarded && forwarded.headers.cookie === undefined,
      forwarded && String(forwarded.headers.cookie));

    const beforeSanitize = stubCalls.length;
    const weakId = await fetch(`${gatewayBase}${GAME_ROUTE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `${COOKIE_NAME}=${SESSION}`, 'x-pilot-request-id': 'short' },
      body: JSON.stringify({ slotEvent: 'update' }),
    });
    const sanitized = stubCalls.slice(beforeSanitize)
      .find((call) => call.url.startsWith('/casino/book-of-ra-classic/session/gameplay'));
    check('gameplay.replaces-a-malformed-request-id-with-fresh-entropy',
      weakId.status === 200 && sanitized && /^[a-f0-9]{24}$/.test(sanitized.headers['x-pilot-request-id']),
      `${weakId.status} / ${sanitized && sanitized.headers['x-pilot-request-id']}`,
    );

    const forged = await fetch(`${gatewayBase}${GAME_ROUTE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `${COOKIE_NAME}=forged-session-token-value` },
      body: JSON.stringify({ slotEvent: 'getSettings' }),
    });
    check('gameplay.lets-the-platform-judge-the-capability',
      forged.status === 401,
      `status=${forged.status}`);

    const oversize = await fetch(`${gatewayBase}${GAME_ROUTE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `${COOKIE_NAME}=${SESSION}` },
      body: JSON.stringify({ slotEvent: 'bet', filler: 'x'.repeat(9000) }),
    }).catch(() => ({ status: 'socket-error' }));
    check('gameplay.rejects-an-oversized-body',
      oversize.status === 413 || oversize.status === 'socket-error',
      oversize.status);

    const unknownPost = await fetch(`${gatewayBase}/nope`, { method: 'POST', body: '{}' });
    check('routes.unknown-post-is-404', unknownPost.status === 404, unknownPost.status);

    // --- the configuration guard -------------------------------------------
    const guard = spawnSync(process.execPath, [SERVER], {
      env: {
        ...process.env,
        BOOK_CLASSIC_GATEWAY_PORT: String(gatewayPort + 1),
        BOOK_CLASSIC_ORIGIN: 'http://127.0.0.1:9999',
        PLATFORM_URL: `http://127.0.0.1:${stubPort}`,
        BOOK_CLASSIC_CLIENT_DIR: CLIENT_DIR,
      },
      encoding: 'utf8',
      timeout: 20000,
    });
    check('config.same-hostname-game-and-platform-refused',
      guard.status !== 0 && /different hostnames/.test(`${guard.stderr}${guard.stdout}`),
      `exit=${guard.status} ${String(guard.stderr).trim().split('\n')[0]}`);
    const remoteGuard = spawnSync(process.execPath, [SERVER], {
      env: {
        ...process.env,
        BOOK_CLASSIC_GATEWAY_PORT: String(gatewayPort + 2),
        BOOK_CLASSIC_ORIGIN: 'http://game.example.com:8791',
        PLATFORM_URL: `http://localhost:${stubPort}`,
        BOOK_CLASSIC_CLIENT_DIR: CLIENT_DIR,
      },
      encoding: 'utf8',
      timeout: 20000,
    });
    check('config.non-loopback-game-origin-refused',
      remoteGuard.status !== 0 && /loopback/.test(`${remoteGuard.stderr}${remoteGuard.stdout}`),
      `exit=${remoteGuard.status} ${String(remoteGuard.stderr).trim().split('\n')[0]}`);

    // --- the client directory is never written ------------------------------
    const manifestAfter = manifestOf(CLIENT_DIR);
    check('client.bytes-unchanged-after-serving',
      JSON.stringify(manifestAfter) === JSON.stringify(manifestBefore),
      `files=${manifestAfter.length}`);
    check('network.no-unexpected-upstream-calls',
      stubCalls.every((call) => call.url.startsWith('/casino/book-of-ra-classic/')),
      stubCalls.map((call) => call.url).join(','));
  } catch (error) {
    check('suite.completed-without-exception', false, error && error.stack ? error.stack.split('\n').slice(0, 3).join(' | ') : String(error));
  } finally {
    for (const child of children) {
      try { child.kill(); } catch (error) { /* ignore */ }
    }
    await new Promise((resolve) => stub.close(resolve));
  }

  const failed = results.filter((entry) => !entry.ok);
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'loopback-stub-platform',
    checks: results.length,
    failures: failed.length,
    results,
    stubPlatformCalls: stubCalls.map((call) => ({
      method: call.method,
      url: call.url,
      sessionHeader: call.headers['x-book-classic-session'] ? '<present>' : null,
      requestId: call.headers['x-pilot-request-id'] ?? null,
      version: call.headers['x-pilot-version'] ?? null,
      round: call.headers['x-pilot-round'] ?? null,
    })),
  };
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 1)}\n`);
  process.stdout.write(`${JSON.stringify({ checks: results.length, failures: failed.length, failed: failed.map((entry) => entry.name) })}\n`);
  process.stdout.write(`report: ${REPORT}\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
