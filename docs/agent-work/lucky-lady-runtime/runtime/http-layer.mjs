// Loopback HTTP layer shared by the production and test entries.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';

const MIME = {
  '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.map': 'application/json',
};
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'";
const MAX_BODY = 8192;
const READ_ONLY = new Set(['getSettings', 'update']);

const exactCookie = (header, name) => {
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
};

export function createHttpServer({ runtime, port, clientDir, previewDir, bridgePath, sessionToken, extraRoutes }) {
  const clientRoot = normalize(clientDir);
  const entryHtml = () => readFileSync(join(previewDir, 'entry.preview.html'), 'utf8')
    .replace('    <script>', '    <script src="/recovery-client.js"></script>\n    <script>');

  return http.createServer((req, res) => {
    try {
      const host = req.headers.host || '';
      const origin = req.headers.origin;
      if (host !== `127.0.0.1:${port}` || (origin && origin !== `http://127.0.0.1:${port}`)) {
        res.writeHead(403); res.end(); return;
      }
      res.setHeader('Content-Security-Policy', CSP);
      res.setHeader('Cache-Control', 'no-store');
      const url = new URL(req.url, `http://127.0.0.1:${port}`);

      if (extraRoutes && extraRoutes(req, res, url)) return;

      if (req.method === 'GET') {
        if (url.pathname === '/') {
          res.setHeader('Set-Cookie', `pilot_session=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`);
          res.setHeader('Content-Type', 'text/html');
          res.end(entryHtml()); return;
        }
        if (url.pathname === '/recovery-client.js') {
          res.setHeader('Content-Type', 'application/javascript');
          res.end(readFileSync(bridgePath)); return;
        }
        if (url.pathname === '/preview-font-ready.js') {
          res.setHeader('Content-Type', 'application/javascript');
          res.end(readFileSync(join(previewDir, 'preview-font-ready.js'))); return;
        }
        const prefix = '/games/LuckyLadysCharmDX/';
        if (url.pathname.startsWith(prefix)) {
          let rel;
          try { rel = decodeURIComponent(url.pathname.slice(prefix.length)); }
          catch { res.writeHead(400); res.end(); return; }
          const full = normalize(join(clientRoot, rel));
          if (!full.startsWith(clientRoot + sep) || !existsSync(full)) { res.writeHead(404); res.end(); return; }
          const type = MIME[extname(full).toLowerCase()];
          if (!type) { res.writeHead(403); res.end(); return; }
          res.setHeader('Content-Type', type);
          res.end(readFileSync(full)); return;
        }
        res.writeHead(404); res.end(); return;
      }

      if (req.method !== 'POST' || url.pathname !== '/game/LuckyLadysCharmDX/server') {
        res.writeHead(404); res.end(); return;
      }
      if (exactCookie(req.headers.cookie, 'pilot_session') !== sessionToken) { res.writeHead(401); res.end(); return; }

      let raw = '';
      let aborted = false;
      req.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > MAX_BODY) { aborted = true; req.destroy(); }
      });
      req.on('end', () => {
        if (aborted) { res.writeHead(413); res.end(); return; }
        let body;
        try { body = JSON.parse(raw); } catch { res.setHeader('Content-Type', 'application/json'); res.writeHead(400); res.end('{"responseEvent":"error","reason":"malformed json"}'); return; }
        const readOnly = READ_ONLY.has(body && body.slotEvent);
        const headerId = req.headers['x-pilot-request-id'];
        if (!readOnly && (typeof headerId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(headerId))) {
          res.setHeader('Content-Type', 'application/json'); res.writeHead(400); res.end('{"responseEvent":"error","reason":"request id required"}'); return;
        }
        const requestId = readOnly ? (headerId || randomBytes(12).toString('hex')) : headerId;
        try {
          if (!readOnly) {
            let replayed = null;
            try {
              replayed = runtime.replayResponse(requestId, body);
            } catch (error) {
              res.setHeader('Content-Type', 'application/json');
              res.writeHead(error && error.status ? error.status : 409);
              res.end(JSON.stringify({ responseEvent: 'error', reason: String(error && error.message) }));
              return;
            }
            if (replayed) {
              res.setHeader('Content-Type', 'application/json');
              res.end(replayed);
              runtime.markDelivered(requestId);
              return;
            }
          }
          const response = runtime.handle(body.slotEvent, body, req.headers, requestId, raw);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(response));
          if (!readOnly) runtime.markDelivered(requestId);
        } catch (error) {
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(error && error.status ? error.status : 500);
          res.end(JSON.stringify({ responseEvent: 'error', reason: String(error && error.message) }));
        }
      });
      req.on('error', () => { try { res.writeHead(400); res.end(); } catch { /* socket already gone */ } });
    } catch (error) {
      try { if (!res.headersSent) { res.writeHead(500); } res.end(); } catch { /* socket already gone */ }
    }
  });
}