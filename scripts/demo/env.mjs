// Environment for the buyer demo stack.
//
// Everything secret lives in .env.demo, which .gitignore already excludes via
// the `.env.*` rule. This file generates that on first run so no password, key
// or JWT secret is ever written into a tracked file, and so the operator never
// has to invent one. Regenerating is safe: `demo.mjs reset` reseeds accounts
// from whatever .env.demo currently holds.

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ENV_FILE = resolve(ROOT, '.env.demo');

/** Loopback by IP, never by name - see the note in docker-compose.demo.yml. */
export const DEMO = Object.freeze({
  host: '127.0.0.1',
  pgPort: 55440,
  redisPort: 6390,
  backendPort: 3021,
  frontendPort: 3020,
  database: 'fools_gold_demo',
  dbUser: 'demo_user',
  composeProject: 'totobuyerdemo',
  adminEmail: 'demo-admin@foolsgold.local',
  playerEmail: 'demo-player@foolsgold.local',
  playerGrantPts: 100000,
  grantReason: 'Buyer demo funding',
});

export const parseEnvFile = (text) => {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
};

const secret = (bytes = 24) => randomBytes(bytes).toString('base64url');
// Readable enough to type at a login form during a live presentation, random
// enough that it is not a shared credential.
const passphrase = () => `demo-${randomBytes(9).toString('base64url')}`;

/**
 * Provider keys are optional. When the operator has already stored them in
 * another local checkout we reuse them rather than asking again, but the value
 * is only ever copied file-to-file: it is never printed, logged or committed.
 */
const inheritProviderKeys = () => {
  const candidates = [
    resolve(ROOT, '..', 'toto-apifootball', '.env'),
    resolve(ROOT, '..', 'toto', '.env'),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const parsed = parseEnvFile(readFileSync(candidate, 'utf8'));
    if (parsed.THE_ODDS_API_KEY || parsed.API_FOOTBALL_KEY) {
      return {
        THE_ODDS_API_KEY: parsed.THE_ODDS_API_KEY ?? '',
        API_FOOTBALL_KEY: parsed.API_FOOTBALL_KEY ?? '',
        source: candidate,
      };
    }
  }
  return { THE_ODDS_API_KEY: '', API_FOOTBALL_KEY: '', source: null };
};

const template = () => {
  const keys = inheritProviderKeys();
  const pgPassword = secret(18);
  const text = [
    '# Buyer demo stack - LOCAL ONLY. Generated, gitignored, never committed.',
    '# Regenerate by deleting this file and running: npm run demo:up',
    'NODE_ENV=development',
    'APP_VERSION=buyer-demo',
    'BUILD_COMMIT=local',
    `PORT=${DEMO.backendPort}`,
    'HOST=127.0.0.1',
    '',
    `# --- Demo datastores (isolated compose project ${DEMO.composeProject}) ---`,
    `DEMO_POSTGRES_PASSWORD=${pgPassword}`,
    `DATABASE_URL=postgresql://${DEMO.dbUser}:${pgPassword}@${DEMO.host}:${DEMO.pgPort}/${DEMO.database}?schema=public`,
    `REDIS_URL=redis://${DEMO.host}:${DEMO.redisPort}`,
    '',
    '# --- Auth -----------------------------------------------------------------',
    `JWT_ACCESS_SECRET=${secret(32)}`,
    `JWT_REFRESH_SECRET=${secret(32)}`,
    'REGISTRATION_ENABLED=true',
    '',
    '# --- Demo accounts --------------------------------------------------------',
    '# Created through the normal registration + admin-grant flows by demo:reset.',
    `DEMO_ADMIN_EMAIL=${DEMO.adminEmail}`,
    `DEMO_ADMIN_PASSWORD=${passphrase()}`,
    `DEMO_PLAYER_EMAIL=${DEMO.playerEmail}`,
    `DEMO_PLAYER_PASSWORD=${passphrase()}`,
    '',
    '# --- HTTP -----------------------------------------------------------------',
    `FRONTEND_URL=http://${DEMO.host}:${DEMO.frontendPort}`,
    `BACKEND_URL=http://${DEMO.host}:${DEMO.backendPort}`,
    `NEXT_PUBLIC_API_URL=http://${DEMO.host}:${DEMO.backendPort}`,
    `CORS_ORIGINS=http://${DEMO.host}:${DEMO.frontendPort},http://localhost:${DEMO.frontendPort}`,
    'TRUST_PROXY=false',
    'COOKIE_SECURE=false',
    'BODY_LIMIT=1mb',
    `DOMAIN=${DEMO.host}`,
    'LOG_LEVEL=info',
    '',
    '# --- Sports providers -----------------------------------------------------',
    `THE_ODDS_API_KEY=${keys.THE_ODDS_API_KEY}`,
    'THE_ODDS_API_BASE_URL=https://api.the-odds-api.com/v4',
    'SPORTS_PROVIDER=the-odds-api',
    `API_FOOTBALL_KEY=${keys.API_FOOTBALL_KEY}`,
    'API_FOOTBALL_BASE_URL=https://v3.football.api-sports.io',
    'API_FOOTBALL_ENABLED=true',
    'API_FOOTBALL_REFERENCE_CACHE_TTL_SECONDS=86400',
    '# Longer than the defaults on purpose: a demo should serve warmed cache rather',
    '# than spend provider quota while the buyer is clicking around.',
    'API_FOOTBALL_PREMATCH_CACHE_TTL_SECONDS=1800',
    'API_FOOTBALL_LIVE_CACHE_TTL_SECONDS=15',
    'API_FOOTBALL_TIMEOUT_MS=8000',
    'SPORTS_CACHE_TTL_SECONDS=86400',
    'EVENTS_CACHE_TTL_SECONDS=1800',
    'ODDS_CACHE_TTL_SECONDS=300',
    'SPORTS_PROVIDER_TIMEOUT_MS=8000',
    'MAX_VIRTUAL_BET_STAKE=1000000',
    'MAX_ACCUMULATOR_LEGS=10',
    'MAX_ODDS_STALENESS_SECONDS=3600',
    'SPORTS_SETTLEMENT_ENABLED=false',
    'SPORTS_LOW_QUOTA_THRESHOLD=100',
    '',
    '# --- Casino ---------------------------------------------------------------',
    'CASINO_MIN_STAKE=1',
    'CASINO_MAX_STAKE=1000000',
    'CASINO_DICE_RTP_BPS=9700',
    'CASINO_MINES_RTP_BPS=9700',
    'CASINO_CRASH_RTP_BPS=9700',
    'CASINO_CRASH_WORKER_ENABLED=true',
    'CASINO_CRASH_SWEEP_MS=2000',
    'CASINO_CRASH_LOCK_TTL_MS=10000',
    '',
  ].join('\n');
  return { text, inheritedFrom: keys.source };
};

export const ensureEnvFile = () => {
  if (existsSync(ENV_FILE)) return { created: false, inheritedFrom: null };
  const { text, inheritedFrom } = template();
  writeFileSync(ENV_FILE, text, { encoding: 'utf8', mode: 0o600 });
  return { created: true, inheritedFrom };
};

/**
 * A demo reset drops and recreates a database. Every entry point calls this
 * first so that can only ever happen to the demo database on loopback.
 */
export const assertDemoTarget = (env) => {
  if ((env.NODE_ENV ?? '').toLowerCase() === 'production') {
    throw new Error('Refusing to run the demo tooling with NODE_ENV=production.');
  }
  const url = env.DATABASE_URL ?? '';
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('DATABASE_URL in .env.demo is missing or unparseable.');
  }
  const name = parsed.pathname.replace(/^\/+/, '').split('/')[0] ?? '';
  if (name !== DEMO.database) {
    throw new Error(`Refusing to operate on database "${name}": the demo tooling only ever targets "${DEMO.database}".`);
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
    throw new Error(`Refusing to operate on a non-loopback host "${parsed.hostname}".`);
  }
  if (String(parsed.port) !== String(DEMO.pgPort)) {
    throw new Error(`Refusing to operate on port ${parsed.port}: the demo database is published on ${DEMO.pgPort} only.`);
  }
  return { database: name, host: parsed.hostname, port: parsed.port };
};

export const loadDemoEnv = () => {
  ensureEnvFile();
  const env = { ...process.env, ...parseEnvFile(readFileSync(ENV_FILE, 'utf8')) };
  assertDemoTarget(env);
  return env;
};
