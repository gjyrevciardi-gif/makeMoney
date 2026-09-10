import { z } from 'zod';

/**
 * The only environments this application recognises. An unrecognised NODE_ENV is
 * rejected outright rather than silently treated as development, so a typo such
 * as `NODE_ENV=prod` can never quietly disable the production guards below.
 */
export const APP_ENVIRONMENTS = ['development', 'test', 'production'] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

const productionEnvironment = z.object({
  NODE_ENV: z.literal('production'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  FRONTEND_URL: z.string().url(),
  CORS_ORIGINS: z.string().min(1),
  COOKIE_SECURE: z.literal('true'),
  TRUST_PROXY: z.literal('true'),
  REGISTRATION_ENABLED: z.enum(['true', 'false']),
}).passthrough();

/**
 * Substrings that only ever appear in a placeholder copied out of an example
 * file and never replaced.
 */
const PLACEHOLDER_FRAGMENTS = [
  'changeme',
  'change-me',
  'development',
  'generate-',
  'replace-',
  'url_encoded',
  'your-',
  'placeholder',
  'not-for-production',
  'notforproduction',
  'todo',
  'xxxxxxxx',
];

/** Whole-value secrets that are weak no matter how they are padded. */
const WEAK_SECRET_VALUES = [
  'secret',
  'password',
  'letmein',
  'admin',
  'test',
  'jwt',
  'token',
  'insecure',
  'default',
];

const MINIMUM_SECRET_LENGTH = 32;
const MINIMUM_DISTINCT_CHARACTERS = 12;
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1'];

const fail: (reason: string) => never = reason => {
  throw new Error(`Invalid production environment: ${reason}`);
};

/**
 * Resolves NODE_ENV to a known environment, rejecting anything else.
 *
 * Exported so startup and tooling agree on what "production" means instead of
 * each re-implementing a truthy check against the raw string.
 */
export function resolveEnvironment(value: string | undefined = process.env.NODE_ENV): AppEnvironment {
  const normalized = (value ?? 'development').trim().toLowerCase();
  if (!(APP_ENVIRONMENTS as readonly string[]).includes(normalized)) {
    throw new Error(
      `Invalid NODE_ENV: "${value}". Expected one of ${APP_ENVIRONMENTS.join(', ')}.`,
    );
  }
  return normalized as AppEnvironment;
}

/**
 * Rejects secrets that satisfy the length rule but carry almost no entropy — a
 * repeated character, a repeated short block, or an unreplaced placeholder.
 */
function assertStrongSecret(name: string, raw: string): void {
  if (raw !== raw.trim()) {
    fail(`${name} must not be padded with whitespace`);
  }
  const value = raw.trim();
  if (value.length < MINIMUM_SECRET_LENGTH) {
    fail(`${name} must be at least ${MINIMUM_SECRET_LENGTH} characters`);
  }

  const lower = value.toLowerCase();
  if (WEAK_SECRET_VALUES.includes(lower)) {
    fail(`${name} uses a well-known weak value`);
  }
  if (PLACEHOLDER_FRAGMENTS.some(fragment => lower.includes(fragment))) {
    fail(`${name} uses an unsafe default`);
  }
  if (WEAK_SECRET_VALUES.some(weak => new RegExp(`^(?:${weak})+$`).test(lower))) {
    fail(`${name} repeats a well-known weak value`);
  }

  if (new Set(value).size < MINIMUM_DISTINCT_CHARACTERS) {
    fail(`${name} has too little entropy: use at least ${MINIMUM_DISTINCT_CHARACTERS} distinct characters`);
  }
  // "abcabcabc…" clears the distinct-character bar in aggregate but only ever
  // repeats one short block, so check for that shape explicitly.
  for (let blockLength = 1; blockLength <= value.length / 4; blockLength += 1) {
    if (value.length % blockLength !== 0) continue;
    const block = value.slice(0, blockLength);
    if (block.repeat(value.length / blockLength) === value) {
      fail(`${name} repeats a short block instead of using random characters`);
    }
  }
}

/**
 * Keeps the environments genuinely separate in the one direction that would
 * destroy data: production must never be pointed at the database the test suite
 * truncates between runs.
 */
function assertNotTestResource(name: string, value: string): void {
  if (/(^|[^a-z0-9])test([^a-z0-9]|$)|_test\b/i.test(value)) {
    fail(`${name} points at a test resource; production must not share test infrastructure`);
  }
}

const BODY_LIMIT_PATTERN = /^\d+(?:\.\d+)?(?:b|kb|mb)$/i;

function isBodyLimit(value: string): boolean {
  return BODY_LIMIT_PATTERN.test(value.trim());
}

/**
 * Fails fast when production is misconfigured.
 *
 * Development and test are left alone: test database safety is enforced
 * separately by the jest setup, which refuses anything that is not an isolated
 * `*_test` database.
 */
export function validateProductionEnvironment(): void {
  const environment = resolveEnvironment();
  if (environment !== 'production') return;

  const result = productionEnvironment.safeParse(process.env);
  if (!result.success) {
    const missingOrInvalid = result.error.issues.map(issue => issue.path.join('.')).join(', ');
    fail(missingOrInvalid);
  }

  for (const name of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    assertStrongSecret(name, process.env[name]!);
  }
  if (process.env.JWT_ACCESS_SECRET === process.env.JWT_REFRESH_SECRET) {
    fail('JWT secrets must be unique');
  }

  for (const name of ['DATABASE_URL', 'REDIS_URL'] as const) {
    const value = process.env[name]!.toLowerCase();
    if (PLACEHOLDER_FRAGMENTS.some(fragment => value.includes(fragment))) {
      fail(`${name} uses a placeholder credential`);
    }
  }
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  const redisUrl = new URL(process.env.REDIS_URL!);
  if (databaseUrl.protocol !== 'postgresql:' && databaseUrl.protocol !== 'postgres:') {
    fail('DATABASE_URL must use PostgreSQL');
  }
  if (redisUrl.protocol !== 'redis:' && redisUrl.protocol !== 'rediss:') {
    fail('REDIS_URL must use Redis');
  }
  if (LOOPBACK_HOSTS.includes(databaseUrl.hostname) || LOOPBACK_HOSTS.includes(redisUrl.hostname)) {
    fail('production services must not use loopback hosts');
  }
  assertNotTestResource('DATABASE_URL', databaseUrl.pathname);

  const frontendOrigin = new URL(process.env.FRONTEND_URL!).origin;
  const origins = process.env.CORS_ORIGINS!.split(',').map(value => value.trim()).filter(Boolean);
  if (!origins.length || origins.some(origin => new URL(origin).origin !== origin || !origin.startsWith('https://'))) {
    fail('CORS_ORIGINS must contain only HTTPS origins without paths');
  }
  if (!origins.includes(frontendOrigin) || !frontendOrigin.startsWith('https://')) {
    fail('FRONTEND_URL must be an allowed HTTPS origin');
  }
  if (new URL(frontendOrigin).hostname === 'example.com') {
    fail('FRONTEND_URL uses the documentation domain');
  }

  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    fail('PORT must be an integer between 1 and 65535');
  }
  if (process.env.BODY_LIMIT !== undefined && !isBodyLimit(process.env.BODY_LIMIT)) {
    fail('BODY_LIMIT must be a byte size such as 512kb or 1mb');
  }
}

/**
 * Body size ceiling for JSON and urlencoded payloads.
 *
 * Every endpoint in this API takes a small JSON document, so the default is
 * deliberately tight: an unbounded body is a cheap way to exhaust memory.
 */
export function resolveBodyLimit(value: string | undefined = process.env.BODY_LIMIT): string {
  const candidate = value?.trim();
  return candidate && isBodyLimit(candidate) ? candidate.toLowerCase() : '1mb';
}

/**
 * Express `trust proxy` setting.
 *
 * Behind the reverse proxy the client IP arrives in `X-Forwarded-For`, and rate
 * limiting keys off it — so this has to be right in both directions. Trusting
 * too little rate-limits every user as if they were the proxy; trusting too much
 * lets a client forge its own address and escape the limit entirely. A hop count
 * is therefore preferred over a blanket `true`.
 */
export function resolveTrustProxy(value: string | undefined = process.env.TRUST_PROXY): number | false {
  const candidate = value?.trim().toLowerCase();
  if (!candidate || candidate === 'false' || candidate === '0') return false;
  if (candidate === 'true') return 1;
  const hops = Number(candidate);
  return Number.isInteger(hops) && hops > 0 && hops <= 10 ? hops : 1;
}

/**
 * Allowed browser origins. Production is validated above to hold only HTTPS
 * origins, so the localhost fallback can never be reached there.
 */
export function resolveCorsOrigins(): string[] {
  const configured = process.env.CORS_ORIGINS ?? process.env.FRONTEND_URL ?? 'http://localhost:3000';
  return configured.split(',').map(origin => origin.trim()).filter(Boolean);
}
