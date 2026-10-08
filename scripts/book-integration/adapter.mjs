/**
 * Integration preview server for Book of Ra.
 *
 * It does three things and nothing else:
 * 1. serves the accepted static player and its approved references read-only;
 * 2. keeps a server-side session that signs in to the real Nest backend with
 *    `/auth/login` and `/auth/refresh` (no bypass, no injected balance);
 * 3. maps the accepted UI transport contract (`/v1/spins`,
 *    `/v1/rounds/:id/actions`, `/v1/state/:playerId`) onto the accepted
 *    `/casino/book-of-ra/*` routes using only verified token identity.
 *
 * Every money-affecting decision stays in the backend. This process never
 * computes a payout, a board, a gamble colour or a balance of its own.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { loadIntegrationEnv, log, root } from './lib.mjs';
import { NestClient } from './nest.mjs';
import { projectRound, projectRefresh } from './projection.mjs';
import { transformPlayerHtml } from './serve-transform.mjs';

const gameRoot = path.join(root, 'games', 'book-of-ra');
const env = await loadIntegrationEnv();

const backendPort = Number(env.INTEGRATION_BACKEND_PORT ?? 4274);
const previewPort = Number(env.INTEGRATION_PREVIEW_PORT ?? 4276);
const autoLogin = (env.INTEGRATION_AUTO_LOGIN ?? '1') !== '0';
const activeLines = Number(env.INTEGRATION_ACTIVE_LINES ?? 10);
const sessionCookie = 'bi_session';

const nest = new NestClient(`http://127.0.0.1:${backendPort}`);
const sessions = new Map();

const CONTENT_TYPES = {
  '.html': 'text/html',
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.css': 'text/css',
  '.map': 'application/json',
};

const STATIC_PREFIXES = [
  '/player/',
  '/screenshots/',
  '/reference/',
  '/book-of-the-sands/assets/',
  '/book-of-the-sands/build/game.bundle.json',
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_SEED = /^[\w .:-]{1,128}$/;

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(payload ?? {}));
}

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    // Every documented request body is a small JSON document.
    if (size > 8 * 1024) throw httpError(413, 'BODY_TOO_LARGE', 'The request body is too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
    return parsed;
  } catch {
    throw httpError(400, 'INVALID_JSON', 'The request body must be a JSON object.');
  }
}

function cookieValue(request, name) {
  for (const entry of String(request.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = entry.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

function requireSession(request) {
  const id = cookieValue(request, sessionCookie);
  const session = id ? sessions.get(id) : undefined;
  if (!session) throw httpError(401, 'SESSION_REQUIRED', 'Sign in with a local test account first.');
  return session;
}

/**
 * A loopback preview that mutates a local test session must not be reachable
 * through a rebound hostname. Mutating routes are POST only and, when a browser
 * sends an Origin, it has to be this preview's own origin.
 */
function requireSameOrigin(request, previewPort) {
  const host = String(request.headers.host ?? '');
  const hostname = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
    throw httpError(403, 'HOST_NOT_ALLOWED', 'This preview only answers loopback hosts.');
  }
  const origin = request.headers.origin;
  if (origin && origin !== `http://127.0.0.1:${previewPort}` && origin !== `http://localhost:${previewPort}`) {
    throw httpError(403, 'ORIGIN_NOT_ALLOWED', 'Cross-origin session requests are refused.');
  }
}

/**
 * Calls the backend with the session token and rotates the access token once
 * through the real `/auth/refresh` cookie flow when it has expired.
 */
async function callBackend(session, route, { method = 'GET', body, idempotencyKey } = {}) {
  const call = (token) =>
    nest.request(route, {
      method,
      body,
      token,
      headers: idempotencyKey ? { 'idempotency-key': idempotencyKey } : {},
    });
  let response = await call(session.accessToken);
  if (response.status === 401 && session.refreshCookie) {
    // One rotation per session at a time: concurrent requests await the same refresh.
    session.refreshInFlight ??= (async () => {
      try {
        const refreshed = await nest.refresh(session.refreshCookie);
        if (refreshed.ok && typeof refreshed.payload?.accessToken === 'string') {
          session.accessToken = refreshed.payload.accessToken;
          session.refreshCookie = refreshed.refreshCookie;
        }
        return refreshed.ok;
      } finally {
        session.refreshInFlight = undefined;
      }
    })();
    const rotated = await session.refreshInFlight;
    if (rotated) {
      response = await call(session.accessToken);
    }
  }
  return response;
}

async function startSession(email, password) {
  const login = await nest.login(email, password);
  if (!login.ok) {
    throw httpError(login.status === 401 ? 401 : 502, 'LOGIN_FAILED', 'The local test account could not sign in.');
  }
  const session = {
    id: randomUUID(),
    accessToken: login.payload.accessToken,
    refreshCookie: login.refreshCookie,
    user: login.payload.user,
  };
  sessions.set(session.id, session);
  return session;
}

function sessionPayload(session) {
  return {
    user: { id: session.user.id, email: session.user.email, role: session.user.role },
    balance: String(session.user.balance ?? '0'),
  };
}

/** `/v1/spins` -> `/casino/book-of-ra/spin`. */
async function handleSpin(request, response, session) {
  const body = await readBody(request);
  if (body.purchasedFeatureId !== undefined) {
    throw httpError(400, 'BONUS_BUY_UNSUPPORTED', 'The accepted backend exposes no bonus-buy route.');
  }
  if (body.anteBet !== undefined) {
    throw httpError(400, 'ANTE_UNSUPPORTED', 'The accepted backend exposes no ante-bet route.');
  }

  const betUnits = typeof body.betUnits === 'string' ? body.betUnits : String(body.betUnits ?? '');
  if (!/^\d+$/.test(betUnits) || BigInt(betUnits) < BigInt(activeLines)) {
    throw httpError(400, 'INVALID_STAKE', `betUnits must be a whole number of points covering ${activeLines} lines.`);
  }
  if (BigInt(betUnits) % BigInt(activeLines) !== 0n) {
    throw httpError(400, 'INVALID_STAKE', `betUnits must divide evenly across ${activeLines} lines.`);
  }

  const idempotencyKey = String(request.headers['idempotency-key'] ?? body.idempotencyKey ?? '');
  if (!UUID.test(idempotencyKey)) throw httpError(400, 'INVALID_IDEMPOTENCY_KEY', 'A UUID idempotency key is required.');
  if (body.clientSeed !== undefined && (typeof body.clientSeed !== 'string' || !CLIENT_SEED.test(body.clientSeed))) {
    throw httpError(400, 'INVALID_CLIENT_SEED', 'clientSeed must be 1-128 characters of letters, digits, space or . _ : -');
  }

  const result = await callBackend(session, '/casino/book-of-ra/spin', {
    method: 'POST',
    idempotencyKey,
    body: {
      betPerLine: Number(BigInt(betUnits) / BigInt(activeLines)),
      idempotencyKey,
      ...(body.clientSeed === undefined ? {} : { clientSeed: body.clientSeed }),
      ...(body.autoplay === true ? { autoplay: true } : {}),
    },
  });
  if (!result.ok) return sendJson(response, result.status, result.payload);
  return sendJson(response, 200, projectRound(result.payload, { playerId: session.user.id }));
}

/** `/v1/rounds/:roundId/actions` -> `/casino/book-of-ra/action`. */
async function handleAction(request, response, session, roundId) {
  const body = await readBody(request);
  const actionId = typeof body.actionId === 'string' ? body.actionId : '';
  const choiceId = typeof body.choiceId === 'string' ? body.choiceId : '';
  const idempotencyKey = String(request.headers['idempotency-key'] ?? body.idempotencyKey ?? '');
  if (!UUID.test(roundId)) throw httpError(400, 'INVALID_ROUND_ID', 'roundId must be a UUID.');
  if (!actionId) throw httpError(400, 'INVALID_ACTION_ID', 'actionId is required.');
  if (!['red', 'black', 'collect'].includes(choiceId)) {
    throw httpError(400, 'INVALID_CHOICE', 'choiceId must be red, black or collect.');
  }
  if (!UUID.test(idempotencyKey)) throw httpError(400, 'INVALID_IDEMPOTENCY_KEY', 'A UUID idempotency key is required.');

  const result = await callBackend(session, '/casino/book-of-ra/action', {
    method: 'POST',
    idempotencyKey,
    body: { roundId, actionId, choiceId, idempotencyKey },
  });
  if (!result.ok) return sendJson(response, result.status, result.payload);
  return sendJson(response, 200, projectRound(result.payload, { playerId: session.user.id }));
}

/** `/v1/state/:playerId` -> `/casino/book-of-ra/state`; identity comes from the token. */
async function handleState(response, session) {
  const result = await callBackend(session, '/casino/book-of-ra/state');
  if (!result.ok) return sendJson(response, result.status, result.payload);
  return sendJson(response, 200, projectRefresh(result.payload, { playerId: session.user.id }));
}

async function handleSession(request, response, pathname) {
  if (pathname === '/session/login' || pathname === '/session/auto') {
    let email;
    let password;
    if (pathname === '/session/login') {
      const body = await readBody(request);
      email = String(body.email ?? '').trim().toLowerCase();
      password = String(body.password ?? '');
      if (!email || !password) throw httpError(400, 'CREDENTIALS_REQUIRED', 'email and password are required.');
    } else {
      if (!autoLogin) throw httpError(403, 'AUTO_LOGIN_DISABLED', 'Auto login is disabled; use /integration/login.html.');
      email = env.INTEGRATION_PLAYER_EMAIL;
      password = env.INTEGRATION_PLAYER_PASSWORD;
    }
    const session = await startSession(email, password);
    if (session.user.role !== 'USER' && session.user.role !== 'ADMIN') {
      sessions.delete(session.id);
      throw httpError(403, 'ACCOUNT_NOT_A_PLAYER', 'Only player accounts may drive the cabinet session.');
    }
    session.config = await acceptedConfig(session);
    response.setHeader('set-cookie', `${sessionCookie}=${session.id}; HttpOnly; SameSite=Strict; Path=/`);
    return sendJson(response, 200, { ...sessionPayload(session), config: session.config });
  }
  if (pathname === '/session/config') {
    const session = requireSession(request);
    if (request.method !== 'GET') throw httpError(405, 'METHOD_NOT_ALLOWED', 'Use GET.');
    return sendJson(response, 200, session.config ?? (session.config = await acceptedConfig(session)));
  }
  if (pathname === '/session/logout') {
    const id = cookieValue(request, sessionCookie);
    if (id) sessions.delete(id);
    response.setHeader('set-cookie', `${sessionCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    return sendJson(response, 200, { signedOut: true });
  }
  if (pathname === '/session/me') {
    const session = requireSession(request);
    const wallet = await callBackend(session, '/wallet/me');
    if (!wallet.ok) return sendJson(response, wallet.status, wallet.payload);
    session.user = { ...session.user, balance: wallet.payload.balance };
    return sendJson(response, 200, { ...sessionPayload(session), config: session.config ?? (session.config = await acceptedConfig(session)) });
  }
  throw httpError(404, 'NOT_FOUND', 'Unknown session route.');
}

/** The accepted public profile, cached per session for the host page. */
async function acceptedConfig(session) {
  const response = await callBackend(session, '/casino/book-of-ra/config');
  if (!response.ok) throw httpError(502, 'CONFIG_UNAVAILABLE', 'The Book of the Sands profile is unavailable.');
  return {
    minTotalBet: response.payload.minTotalBet,
    maxTotalBet: response.payload.maxTotalBet,
    activeLines: response.payload.paylineCount,
    profileId: response.payload.profileId,
    rtpBps: response.payload.rtpBps,
  };
}

async function serveStatic(response, pathname) {
  let target = pathname;
  if (target === '/') target = '/player/index.html';
  else if (target === '/game.json') target = '/book-of-the-sands/build/game.bundle.json';
  else if (target.startsWith('/assets/')) target = `/book-of-the-sands${target}`;
  else if (target === '/symbols.mjs' || target.startsWith('/build/')) target = `/player${target}`;

  if (target === '/integration/login.html') {
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    return response.end(LOGIN_PAGE);
  }
  if (target === '/integration/bootstrap.mjs') {
    response.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
    return response.end(BOOTSTRAP);
  }

  const file = path.resolve(gameRoot, `.${target}`);
  const allowed =
    (target === '/player/index.html' || STATIC_PREFIXES.some((prefix) => target.startsWith(prefix))) &&
    file.startsWith(`${gameRoot}${path.sep}`) &&
    Boolean(CONTENT_TYPES[path.extname(file)]);
  if (!allowed) {
    response.writeHead(404);
    return response.end();
  }
  const info = await stat(file);
  if (!info.isFile()) {
    response.writeHead(404);
    return response.end();
  }
  const bytes = await readFile(file);
  if (target === '/player/index.html') {
    const html = transformPlayerHtml(bytes.toString('utf8'));
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    return response.end(html);
  }
  response.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(file)], 'cache-control': 'no-store' });
  return response.end(bytes);
}

const LOGIN_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Book integration sign in</title>
<style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#120d06;color:#ffd76a;font:16px/1.5 ui-monospace,monospace}
form{display:grid;gap:10px;padding:24px;border:2px solid #7a4a16;background:#1b1208;min-width:320px}
input,button{font:inherit;padding:8px;border:1px solid #7a4a16;background:#0b0703;color:#ffd76a}
button{cursor:pointer;background:#3a2409}</style></head>
<body><form id="signin"><h1 style="font-size:16px;margin:0">Book integration sign in</h1>
<label>Email<input name="email" type="email" autocomplete="username" required></label>
<label>Password<input name="password" type="password" autocomplete="current-password" required></label>
<button type="submit">Sign in</button>
<p id="status" role="status" style="margin:0;color:#e0b877"></p></form>
<script type="module">
const form = document.getElementById('signin');
const status = document.getElementById('status');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  status.textContent = 'Signing in';
  const data = Object.fromEntries(new FormData(form));
  const response = await fetch('/session/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  if (response.ok) { location.assign('/'); return; }
  const payload = await response.json().catch(() => ({}));
  status.textContent = payload.message ?? 'Sign in failed';
});
</script></body></html>
`;

/**
 * Host-page bootstrap. It runs outside the cabinet element and only uses the
 * documented session tooling plus the wallet endpoint.
 */
const BOOTSTRAP = `export async function initialize(element) {
const bar = document.createElement('div');
bar.id = 'book-integration-session';
bar.style.cssText = 'position:fixed;left:0;bottom:0;z-index:2147483647;font:12px/1.6 ui-monospace,monospace;color:#e0b877;background:#000000cc;padding:2px 8px';
bar.textContent = 'book-integration preview: checking session';
document.body.append(bar);
// The accepted cabinet renders money as minor units everywhere else, so the
// host meter uses the same convention for the authoritative wallet balance.
const minor = (value) => { const units = BigInt(value); return units / 100n + '.' + (units % 100n).toString().padStart(2, '0'); };
const showSession = (session) => {
  bar.replaceChildren();
  bar.append('book-integration preview | ' + session.user.email + ' | credit ' + minor(session.balance) + ' | ');
  const link = document.createElement('a');
  link.href = '/integration/login.html';
  link.textContent = 'switch account';
  link.style.color = '#ffd76a';
  bar.append(link);
};
const meter = (selector) => element.shadowRoot && element.shadowRoot.querySelector(selector);
const showMeters = (config, betUnits, balance) => {
  const lines = Number(config && config.activeLines) || null;
  const credit = meter('[data-credit]');
  if (credit && balance !== undefined) credit.textContent = minor(balance);
  const linesMeter = meter('[data-lines]');
  if (linesMeter && lines) linesMeter.textContent = String(lines);
  const betLine = meter('[data-betline]');
  if (betLine && lines) betLine.textContent = minor(BigInt(betUnits) / BigInt(lines));
  const bet = meter('[data-bet]');
  if (bet) bet.textContent = minor(betUnits);
};
// Reuse an existing session first; only sign in when there is none.
let session = null;
const existing = await fetch('/session/me');
if (existing.ok) session = await existing.json();
else {
  const auto = await fetch('/session/auto', { method: 'POST' });
  if (auto.ok) session = await auto.json();
}
if (!session) {
  // No session: the cabinet stays inert and no meter is ever fabricated.
  bar.textContent = 'book-integration preview: not signed in - open /integration/login.html';
  return;
}
showSession(session);
element.playerId = session.user.id;
if (!session.config || !session.config.minTotalBet) {
  bar.textContent = 'book-integration preview: the accepted wager contract is unavailable';
  return;
}
// Recover once, before unlocking: the snapshot decides whether the feature
// stake is locked, and only real config/state values reach the meters.
let pendingRound = null;
try {
  const recovered = await (await fetch('/v1/state/' + encodeURIComponent(session.user.id))).json();
  pendingRound = recovered.pendingRound ?? null;
} catch (error) {
  bar.textContent = 'book-integration preview: recovery unavailable - ' + error.message;
}
const locked = pendingRound && pendingRound.featureState && pendingRound.featureState.bookOfRa &&
  pendingRound.featureState.bookOfRa.stakeLocked === true;
const betUnits = locked && pendingRound.betUnits ? String(pendingRound.betUnits) : String(session.config.minTotalBet);
element.betUnits = betUnits;
element.setAttribute('wager-contract', 'activeLines=' + session.config.activeLines + ';betUnits=' + betUnits + ';locked=' + locked);
showMeters(session.config, betUnits, session.balance);
element.addEventListener('slot-round-result', async () => {
  const refreshed = await fetch('/session/me');
  if (!refreshed.ok) return;
  const next = await refreshed.json();
  showSession(next);
  showMeters(next.config ?? session.config, element.betUnits, next.balance);
});
element.inert = false;
if (pendingRound) await element.playResult(pendingRound);
}
`;

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    // Every route, including the game transport, answers loopback hosts only
    // and refuses a cross-site Origin.
    requireSameOrigin(request, previewPort);
    if (pathname.startsWith('/session/')) {
      const readOnly = pathname === '/session/me' || pathname === '/session/config';
      const expected = readOnly ? 'GET' : 'POST';
      if (request.method !== expected) {
        return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED', message: `Use ${expected} for ${pathname}.` });
      }
      return await handleSession(request, response, pathname);
    }
    if (pathname === '/v1/spins' && request.method === 'POST') {
      return await handleSpin(request, response, requireSession(request));
    }
    if (pathname === '/v1/spins') {
      return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for /v1/spins.' });
    }
    const action = pathname.match(/^\/v1\/rounds\/([^/]+)\/actions$/);
    if (action && request.method === 'POST') {
      return await handleAction(request, response, requireSession(request), action[1]);
    }
    if (/^\/v1\/state\/[^/]+$/.test(pathname) && request.method === 'GET') {
      return await handleState(response, requireSession(request));
    }
    if (/^\/v1\/rounds\/[^/]+$/.test(pathname)) {
      return sendJson(response, 501, {
        code: 'ROUND_LOOKUP_UNAVAILABLE',
        message: 'The accepted backend exposes recovery through GET /casino/book-of-ra/state, not a per-round read.',
      });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405);
      return response.end('Method not allowed');
    }
    return await serveStatic(response, pathname);
  } catch (error) {
    if (!response.headersSent) {
      sendJson(response, error.status ?? 500, { code: error.code ?? 'INTERNAL_ERROR', message: error.message });
    } else {
      response.end();
    }
  }
}).listen(previewPort, '127.0.0.1', () => {
  log('INTEGRATION_PREVIEW_LISTENING', {
    url: `http://127.0.0.1:${previewPort}/`,
    loginUrl: `http://127.0.0.1:${previewPort}/integration/login.html`,
    backend: `http://127.0.0.1:${backendPort}`,
  });
});
