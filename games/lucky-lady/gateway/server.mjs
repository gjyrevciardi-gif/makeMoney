// Loopback game gateway for the imported Lucky Lady client.
//
// Its whole job is to keep the recovered third-party client on its own origin:
//
//   * it serves the client's static files from a directory declared by
//     configuration, with path containment and a MIME allowlist;
//   * it exchanges a one-time platform launch capability for an HttpOnly,
//     game-only cookie and redirects to a token-free URL;
//   * it forwards exactly one game protocol route to the platform, attaching
//     that cookie as a header. No platform JWT, refresh cookie or generic API
//     route is reachable from here.
//
// It holds no privileged platform credential: the opaque game capability it
// forwards is what the platform validates.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.LUCKY_LADY_GATEWAY_PORT ?? 8790);
const HOST = process.env.LUCKY_LADY_GATEWAY_HOST ?? '127.0.0.1';
const ORIGIN = process.env.LUCKY_LADY_ORIGIN ?? `http://${HOST}:${PORT}`;
const PLATFORM = (process.env.PLATFORM_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
const CLIENT_DIR = process.env.LUCKY_LADY_CLIENT_DIR ?? '';
const SECURE_COOKIE = process.env.LUCKY_LADY_COOKIE_SECURE === 'true';
const COOKIE_NAME = 'll_session';
const ALLOW_REMOTE = process.env.LUCKY_LADY_ALLOW_REMOTE === 'true';
/**
 * The platform launch page is the only cross-origin caller this gateway
 * accepts, and only on the one-time capability exchange.
 */
const LAUNCH_ORIGINS = (process.env.LUCKY_LADY_LAUNCH_ORIGINS ?? 'http://localhost:3000')
  .split(',').map((value) => value.trim()).filter(Boolean);

const CLIENT_PREFIX = '/games/LuckyLadysCharmDX/';
const GAME_ROUTE = '/game/LuckyLadysCharmDX/server';
const MAX_BODY = 8192;
const BLOCKED_EXTERNAL = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'";
const MIME = {
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.css': 'text/css',
  '.html': 'text/html',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.map': 'application/json',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
};

const cookieValue = (header, name) => {
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
};

const hostAllowed = (value) => {
  if (typeof value !== 'string') return false;
  const expected = new URL(ORIGIN).host;
  return value === expected || value === HOST;
};

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * Refuses to start in a configuration that would share credentials with the
 * platform or expose the recovered client beyond loopback by accident.
 */
export function assertSafeConfiguration() {
  const game = new URL(ORIGIN);
  const platform = new URL(PLATFORM);
  if (game.hostname === platform.hostname) {
    throw new Error('LUCKY_LADY_ORIGIN and PLATFORM_URL must use different hostnames');
  }
  for (const origin of LAUNCH_ORIGINS) {
    const parsed = new URL(origin);
    if (parsed.hostname === game.hostname) {
      throw new Error('game and platform launch origins must use different hostnames');
    }
    if (parsed.origin !== origin) {
      throw new Error(`LUCKY_LADY_LAUNCH_ORIGINS must contain bare origins: ${origin}`);
    }
  }
  if (!ALLOW_REMOTE) {
    if (!LOOPBACK_HOSTS.has(game.hostname)) {
      throw new Error('the game origin must be loopback unless LUCKY_LADY_ALLOW_REMOTE=true');
    }
    if (!LOOPBACK_HOSTS.has(platform.hostname)) {
      throw new Error('PLATFORM_URL must be loopback unless LUCKY_LADY_ALLOW_REMOTE=true');
    }
    for (const origin of LAUNCH_ORIGINS) {
      if (!LOOPBACK_HOSTS.has(new URL(origin).hostname)) {
        throw new Error('launch origins must be loopback unless LUCKY_LADY_ALLOW_REMOTE=true');
      }
    }
  }
}

assertSafeConfiguration();

const readBody = (request) => new Promise((resolve, reject) => {
  let raw = '';
  let tooLarge = false;
  request.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > MAX_BODY) {
      tooLarge = true;
      request.destroy();
    }
  });
  request.on('end', () => resolve(tooLarge ? null : raw));
  request.on('error', reject);
});

const clientRoot = CLIENT_DIR ? normalize(CLIENT_DIR) : '';

function serveClientFile(response, pathname) {
  if (!clientRoot) {
    response.writeHead(503, { 'Content-Type': 'text/plain' });
    response.end('client directory not configured');
    return true;
  }
  let relative;
  try {
    relative = decodeURIComponent(pathname.slice(CLIENT_PREFIX.length));
  } catch {
    response.writeHead(400);
    response.end();
    return true;
  }
  const full = normalize(join(clientRoot, relative));
  if (!full.startsWith(clientRoot + sep) || !existsSync(full)) {
    response.writeHead(404);
    response.end();
    return true;
  }
  const type = MIME[extname(full).toLowerCase()];
  if (!type) {
    response.writeHead(403);
    response.end();
    return true;
  }
  response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  response.end(readFileSync(full));
  return true;
}

async function exchangeLaunch(request, response) {
  const raw = await readBody(request);
  if (raw === null) {
    response.writeHead(413);
    response.end();
    return true;
  }
  let token;
  const contentType = String(request.headers['content-type'] ?? '');
  try {
    if (contentType.includes('application/json')) {
      token = JSON.parse(raw || '{}').token;
    } else {
      token = new URLSearchParams(raw).get('token');
    }
  } catch {
    token = undefined;
  }
  if (typeof token !== 'string' || token.length < 16 || token.length > 200) {
    response.writeHead(400, { 'Content-Type': 'text/plain' });
    response.end('invalid launch request');
    return true;
  }
  const upstream = await fetch(`${PLATFORM}/casino/lucky-lady/launch/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!upstream.ok) {
    response.writeHead(upstream.status === 429 ? 429 : 401, { 'Content-Type': 'text/plain' });
    response.end('launch rejected');
    return true;
  }
  const body = await upstream.json();
  if (typeof body.sessionToken !== 'string') {
    response.writeHead(502, { 'Content-Type': 'text/plain' });
    response.end('launch rejected');
    return true;
  }
  const attributes = [
    `${COOKIE_NAME}=${body.sessionToken}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    SECURE_COOKIE ? 'Secure' : '',
  ].filter(Boolean).join('; ');
  response.writeHead(303, {
    'Set-Cookie': attributes,
    Location: '/play',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  });
  response.end();
  return true;
}

async function forwardGameplay(request, response, url) {
  const session = cookieValue(request.headers.cookie, COOKIE_NAME);
  if (!session) {
    response.writeHead(401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ responseEvent: 'error', reason: 'game session required' }));
    return true;
  }
  const raw = await readBody(request);
  if (raw === null) {
    response.writeHead(413);
    response.end();
    return true;
  }
  const headers = {
    'content-type': 'application/json',
    'x-lucky-session': session,
  };
  const requestId = request.headers['x-pilot-request-id'];
  headers['x-pilot-request-id'] = typeof requestId === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(requestId)
    ? requestId
    : randomBytes(12).toString('hex');
  for (const name of ['x-pilot-version', 'x-pilot-round']) {
    const value = request.headers[name];
    if (typeof value === 'string') headers[name] = value;
  }
  const upstream = await fetch(`${PLATFORM}/casino/lucky-lady/session/gameplay${url.search}`, {
    method: 'POST',
    headers,
    body: raw,
  });
  const text = await upstream.text();
  response.writeHead(upstream.status, {
    'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
    'Cache-Control': 'no-store',
  });
  response.end(text);
  return true;
}

export function createGateway() {
  return http.createServer((request, response) => {
    void (async () => {
      try {
        if (!hostAllowed(request.headers.host)) {
          response.writeHead(403);
          response.end();
          return;
        }
        const url = new URL(request.url ?? '/', ORIGIN);
        const origin = request.headers.origin;
        // The capability exchange is the only cross-origin entry point. The
        // platform launcher posts the one-time token as a top-level form to a
        // new tab while preserving its configured platform Origin. Opaque/null
        // origins are not trusted launchers. Everything else - in
        // particular the whole native game protocol - stays same-origin.
        const isLaunch = request.method === 'POST' && url.pathname === '/launch';
        const originAllowed = isLaunch
          ? (typeof origin === 'string' && LAUNCH_ORIGINS.includes(origin))
          : (origin === undefined || origin === ORIGIN);
        if (!originAllowed) {
          response.writeHead(403);
          response.end();
          return;
        }
        response.setHeader('Content-Security-Policy', BLOCKED_EXTERNAL);
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Referrer-Policy', 'no-referrer');
        response.setHeader('Cache-Control', 'no-store');

        if (request.method === 'GET') {
          if (url.pathname === '/healthz') {
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ ok: true, client: Boolean(clientRoot) }));
            return;
          }
          if (url.pathname === '/' || url.pathname === '/play') {
            response.writeHead(200, { 'Content-Type': 'text/html' });
            response.end(readFileSync(join(HERE, 'entry.html')));
            return;
          }
          if (url.pathname === '/recovery-client.js') {
            response.writeHead(200, { 'Content-Type': 'application/javascript' });
            response.end(readFileSync(join(HERE, 'recovery-client.js')));
            return;
          }
          if (url.pathname === '/preview-font-ready.js') {
            response.writeHead(200, { 'Content-Type': 'application/javascript' });
            response.end(readFileSync(join(HERE, 'preview-font-ready.js')));
            return;
          }
          if (url.pathname.startsWith(CLIENT_PREFIX)) {
            serveClientFile(response, url.pathname);
            return;
          }
          response.writeHead(404);
          response.end();
          return;
        }

        if (request.method === 'POST' && url.pathname === '/launch') {
          await exchangeLaunch(request, response);
          return;
        }
        if (request.method === 'POST' && url.pathname === GAME_ROUTE) {
          await forwardGameplay(request, response, url);
          return;
        }
        response.writeHead(404);
        response.end();
      } catch {
        try {
          if (!response.headersSent) response.writeHead(502);
          response.end();
        } catch {
          // The socket is already gone.
        }
      }
    })();
  });
}

if (process.argv[1] && process.argv[1].endsWith('server.mjs')) {
  const server = createGateway();
  server.listen(PORT, HOST, () => {
    process.stdout.write(`${JSON.stringify({
      listening: ORIGIN,
      platform: PLATFORM,
      clientDir: clientRoot || null,
      secureCookie: SECURE_COOKIE,
      launchOrigins: LAUNCH_ORIGINS,
      allowRemote: ALLOW_REMOTE,
    })}\n`);
  });
}
