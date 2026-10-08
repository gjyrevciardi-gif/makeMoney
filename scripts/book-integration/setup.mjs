/**
 * One-shot local setup for the Book of Ra integration bundle.
 *
 * Creates ignored config, starts isolated PostgreSQL and Redis, installs the
 * repository's locked dependencies into this worktree, applies the Prisma
 * migrations to the dedicated `*_test` database and builds the vendored slot
 * packages plus the accepted player bundle.
 *
 * It never writes to another worktree, never touches a non-test database and
 * never prints a secret.
 */
import { existsSync } from 'node:fs';
import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureDirs,
  envFile,
  exists,
  fail,
  loadIntegrationEnv,
  log,
  npmBin,
  parseEnvFile,
  pidOnPort,
  prismaEntry,
  processCommandLine,
  randomHex,
  randomPassword,
  root,
  run,
  isPortListening,
  stopProcess,
  writeEnvFile,
} from './lib.mjs';
import { databaseUrl, ensurePostgres, ensurePostgresPassword, ensureRedis, redisUrl, testDatabaseUrl } from './services.mjs';

/** Bump when a generated default must replace a value from an older config. */
const CONFIG_VERSION = '2';

export const REQUIRED_TOOLKIT_HINT =
  'Set SLOT_SKILLS_TOOLKIT to the read-only slot-skills checkout (default C:/Users/Admin/Desktop/book-of-ra-poc/slot-skills).';

export function defaultConfig() {
  return {
    INTEGRATION_CONFIG_VERSION: CONFIG_VERSION,
    INTEGRATION_BACKEND_PORT: '4274',
    INTEGRATION_PREVIEW_PORT: '4276',
    INTEGRATION_PG_PORT: '55433',
    INTEGRATION_PG_USER: 'book_admin',
    // The running application and its local test accounts live in their own
    // database so the backend Jest proof runs (which truncate everything) can
    // never touch playtest accounts or the funded wallet.
    INTEGRATION_DB_NAME: 'book_playtest_test',
    INTEGRATION_TEST_DB_NAME: 'book_integration_test',
    INTEGRATION_REDIS_PORT: '56381',
    INTEGRATION_ACTIVE_LINES: '10',
    INTEGRATION_AUTO_LOGIN: '1',
    INTEGRATION_FUND_AMOUNT: '1000000',
    INTEGRATION_FUND_KEY: globalThis.crypto.randomUUID(),
    INTEGRATION_GRANT_REASON: 'book-integration local test funding',
    INTEGRATION_PLAYER_EMAIL: 'book.player@book-integration.test',
    INTEGRATION_ADMIN_EMAIL: 'book.admin@book-integration.test',
    SLOT_SKILLS_TOOLKIT: process.env.SLOT_SKILLS_TOOLKIT ?? 'C:/Users/Admin/Desktop/book-of-ra-poc/slot-skills',
    JWT_ACCESS_SECRET: randomHex(32),
    JWT_REFRESH_SECRET: randomHex(32),
    COOKIE_SECURE: 'false',
    REGISTRATION_ENABLED: 'true',
    TRUST_PROXY: 'false',
    BODY_LIMIT: '1mb',
    CASINO_CRASH_WORKER_ENABLED: 'false',
  };
}

/** Loads `.env.integration`, creating it on first run and keeping known values. */
export async function ensureConfig() {
  const fresh = defaultConfig();
  let existing = (await exists(envFile)) ? parseEnvFile(await readFile(envFile, 'utf8')) : {};
  if (existing.INTEGRATION_CONFIG_VERSION !== CONFIG_VERSION) {
    // Keep credentials and ports, but re-apply generated defaults for the
    // database identity so an older layout cannot reuse the Jest database.
    const { INTEGRATION_DB_NAME: _ignored, ...rest } = existing;
    existing = rest;
  }
  const merged = { ...fresh, ...existing };
  merged.INTEGRATION_PG_PASSWORD = await ensurePostgresPassword(merged);
  merged.INTEGRATION_PLAYER_PASSWORD = existing.INTEGRATION_PLAYER_PASSWORD || randomPassword();
  merged.INTEGRATION_ADMIN_PASSWORD = existing.INTEGRATION_ADMIN_PASSWORD || randomPassword();
  merged.DATABASE_URL = databaseUrl(merged);
  merged.INTEGRATION_TEST_DATABASE_URL = testDatabaseUrl(merged);
  merged.REDIS_URL = redisUrl(merged);
  merged.NODE_ENV = 'development';
  merged.PORT = merged.INTEGRATION_BACKEND_PORT;
  merged.HOST = '127.0.0.1';
  merged.CORS_ORIGINS = `http://127.0.0.1:${merged.INTEGRATION_PREVIEW_PORT}`;
  await writeEnvFile(merged);
  return merged;
}

export function assertLocalTestTarget(env) {
  const checked = [];
  for (const key of ['DATABASE_URL', 'INTEGRATION_TEST_DATABASE_URL', 'REDIS_URL']) {
    const raw = env[key];
    if (!raw) fail(`Refusing to run: ${key} is not configured.`);
    const url = new URL(raw);
    const isRedis = url.protocol === 'redis:';
    if (!isRedis && url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
      fail(`Refusing to run: ${key} uses the unsupported protocol ${url.protocol}`);
    }
    if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
      fail(`Refusing to run: ${key} points at ${url.hostname}, which is not loopback.`);
    }
    if (isRedis) {
      if (url.port !== String(env.INTEGRATION_REDIS_PORT)) {
        fail(`Refusing to run: REDIS_URL port ${url.port} does not match INTEGRATION_REDIS_PORT ${env.INTEGRATION_REDIS_PORT}.`);
      }
      continue;
    }
    if (url.port === '5432') fail(`Refusing to run: ${key} uses the default development PostgreSQL port 5432.`);
    if (url.port !== String(env.INTEGRATION_PG_PORT)) {
      fail(`Refusing to run: ${key} port ${url.port} does not match INTEGRATION_PG_PORT ${env.INTEGRATION_PG_PORT}.`);
    }
    const name = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (!name.toLowerCase().endsWith('_test') || ['fools_gold', 'postgres', 'app', 'development', 'dev', 'production', 'public'].includes(name.toLowerCase())) {
      fail(`Refusing to run: "${name}" is not an isolated *_test database.`);
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      fail(`Refusing to run: "${name}" is not a safe SQL identifier.`);
    }
    const expected = key === 'DATABASE_URL' ? env.INTEGRATION_DB_NAME : env.INTEGRATION_TEST_DB_NAME;
    if (name !== expected) {
      fail(`Refusing to run: ${key} names "${name}" but the bundle provisions "${expected}".`);
    }
    checked.push(name);
  }
  if (checked.length === 2 && checked[0] === checked[1]) {
    fail(`Refusing to run: the application and Jest databases must be distinct (both are "${checked[0]}").`);
  }
}

async function installDependencies(env) {
  if (existsSync(path.join(root, 'node_modules', '.package-lock.json'))) return;
  log('NPM_INSTALL_START', {});
  const result = await run([npmBin, 'install', '--no-audit', '--no-fund'], {
    shell: process.platform === 'win32',
    env,
    timeoutMs: 900_000,
    log: path.join(root, 'tmp', 'integration', 'logs', 'npm-install.log'),
  });
  if (result.code !== 0) fail(`npm install failed with exit ${result.code}. See tmp/integration/logs/npm-install.log.`);
  log('NPM_INSTALL_DONE', {});
}

async function prisma(env) {
  const schema = path.join('backend', 'prisma', 'schema.prisma');
  await stopIntegrationBackendIfRunning(env);
  const generate = await run(['node', prismaEntry, 'generate', '--schema', schema], {
    env,
    timeoutMs: 300_000,
    log: path.join(root, 'tmp', 'integration', 'logs', 'prisma-generate.log'),
  });
  if (generate.code !== 0) fail('prisma generate failed. See tmp/integration/logs/prisma-generate.log.');
  for (const url of [env.DATABASE_URL, env.INTEGRATION_TEST_DATABASE_URL]) {
    const database = new URL(url).pathname.replace(/^\/+/, '');
    const migrate = await run(['node', prismaEntry, 'migrate', 'deploy', '--schema', schema], {
      env: { ...env, DATABASE_URL: url },
      timeoutMs: 600_000,
      log: path.join(root, 'tmp', 'integration', 'logs', `prisma-migrate-${database}.log`),
    });
    if (migrate.code !== 0) fail(`prisma migrate deploy failed for ${database}. See tmp/integration/logs/prisma-migrate-${database}.log.`);
    log('PRISMA_READY', { database });
  }
}

/**
 * `prisma generate` rewrites the query engine that a running backend has
 * loaded, which Windows refuses. Only a process proven to be this worktree's
 * own compiled backend is stopped.
 */
async function stopIntegrationBackendIfRunning(env) {
  const port = Number(env.INTEGRATION_BACKEND_PORT);
  if (!(await isPortListening(port))) return;
  const pid = await pidOnPort(port);
  if (!pid) return;
  const commandLine = await processCommandLine(pid);
  const mine = commandLine.includes(path.join(root, 'backend', 'dist')) && commandLine.includes('main.js');
  if (!mine) fail(`Port ${port} is held by another process (pid ${pid}); refusing to stop it.`);
  if (stopProcess(pid)) log('BACKEND_STOPPED_FOR_SETUP', { pid });
}

async function buildPackages(env) {
  const packages = await run([npmBin, 'run', 'build:slot-skills'], {
    shell: process.platform === 'win32',
    env,
    timeoutMs: 600_000,
    log: path.join(root, 'tmp', 'integration', 'logs', 'build-slot-skills.log'),
  });
  if (packages.code !== 0) fail('npm run build:slot-skills failed. See tmp/integration/logs/build-slot-skills.log.');
  log('SLOT_SKILLS_BUILT', {});
  // The corrected service must actually run: compile the backend during setup.
  const backend = await run([npmBin, 'run', 'build', '-w', 'backend'], {
    shell: process.platform === 'win32',
    env,
    timeoutMs: 600_000,
    log: path.join(root, 'tmp', 'integration', 'logs', 'backend-build.log'),
  });
  if (backend.code !== 0) fail('npm run build -w backend failed. See tmp/integration/logs/backend-build.log.');
  log('BACKEND_BUILT', {});
}

async function buildPlayer(env) {
  const bundle = path.join(root, 'games', 'book-of-ra', 'player', 'build', 'slot-client.js');
  const toolkit = env.SLOT_SKILLS_TOOLKIT;
  if (!toolkit || !existsSync(path.join(toolkit, 'node_modules', 'vite', 'dist', 'node', 'index.js'))) {
    fail(`The accepted player bundle needs a read-only Vite install to build. ${REQUIRED_TOOLKIT_HINT}`);
  }
  if (!existsSync(path.join(toolkit, 'node_modules', 'intl-messageformat'))) {
    fail(`The read-only toolkit at ${toolkit} has no intl-messageformat dependency. ${REQUIRED_TOOLKIT_HINT}`);
  }
  const result = await run(['node', path.join('games', 'book-of-ra', 'client', 'build-client.mjs')], {
    env,
    timeoutMs: 600_000,
    log: path.join(root, 'tmp', 'integration', 'logs', 'build-client.log'),
  });
  if (result.code !== 0) {
    fail(`Building the accepted player bundle failed (${REQUIRED_TOOLKIT_HINT}). See tmp/integration/logs/build-client.log.`);
  }
  log('PLAYER_BUNDLE_READY', { bytes: existsSync(bundle) ? statSync(bundle).size : 0 });
}

async function main() {
  await ensureDirs();
  const env = await ensureConfig();
  assertLocalTestTarget(env);
  await ensurePostgres(env);
  await ensureRedis(env);
  await installDependencies(env);
  await prisma(env);
  await buildPackages(env);
  await buildPlayer({ ...process.env, ...env });
  log('SETUP_COMPLETE', {
    config: path.relative(root, envFile),
    database: new URL(env.DATABASE_URL).pathname.replace(/^\/+/, ''),
    postgres: `${env.INTEGRATION_PG_PORT} (loopback, isolated cluster)`,
    redis: `${env.INTEGRATION_REDIS_PORT} (loopback, dedicated instance)`,
    next: 'node scripts/book-integration/start.mjs',
  });
}

const invokedDirectly = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  await main();
}
