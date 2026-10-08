/**
 * Isolated local datastores for the integration bundle.
 *
 * PostgreSQL runs from its own cluster directory under `tmp/integration`, on a
 * loopback port that is not the development port, and owns a `*_test` database.
 * Redis runs as a second, dedicated instance on its own loopback port so no
 * key is shared with any other local process.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  LOOPBACK,
  exists,
  fail,
  isPortListening,
  log,
  logDir,
  pgDataDir,
  pgTool,
  randomPassword,
  redisCliBin,
  redisDataDir,
  redisServerBin,
  run,
  runDir,
  spawnHidden,
  waitFor,
} from './lib.mjs';

const pgPassFile = path.join(runDir, 'pgpass.txt');
const postgresLog = path.join(logDir, 'postgres.log');
const redisLog = path.join(logDir, 'redis.log');
const REDIS_OWNER_KEY = 'bookintegration:owner';

export function databaseUrl(env) {
  return `postgresql://${env.INTEGRATION_PG_USER}:${env.INTEGRATION_PG_PASSWORD}@${LOOPBACK}:${env.INTEGRATION_PG_PORT}/${env.INTEGRATION_DB_NAME}?schema=public`;
}

export function testDatabaseUrl(env) {
  return `postgresql://${env.INTEGRATION_PG_USER}:${env.INTEGRATION_PG_PASSWORD}@${LOOPBACK}:${env.INTEGRATION_PG_PORT}/${env.INTEGRATION_TEST_DB_NAME}?schema=public`;
}

export function redisUrl(env) {
  return `redis://${LOOPBACK}:${env.INTEGRATION_REDIS_PORT}`;
}

function requirePostgresBinaries() {
  for (const tool of ['initdb', 'pg_ctl', 'createdb', 'psql']) {
    if (!existsSync(pgTool(tool))) {
      fail(`PostgreSQL ${tool}.exe not found at ${pgTool(tool)}. Set INTEGRATION_PG_BIN to its bin directory.`);
    }
  }
}

export async function ensurePostgresPassword(env) {
  if (env.INTEGRATION_PG_PASSWORD) return env.INTEGRATION_PG_PASSWORD;
  const password = (await exists(pgPassFile)) ? (await readFile(pgPassFile, 'utf8')).trim() : randomPassword();
  await mkdir(runDir, { recursive: true });
  await writeFile(pgPassFile, password, 'utf8');
  return password;
}

async function startPostgres(env) {
  const result = await run(
    [pgTool('pg_ctl'), '-D', pgDataDir, '-l', postgresLog, '-o', `-p ${env.INTEGRATION_PG_PORT} -c listen_addresses=${LOOPBACK}`, '-w', 'start'],
    { timeoutMs: 60_000, log: path.join(logDir, 'pg_ctl-start.log') },
  );
  if (result.code !== 0 && !(await isPortListening(Number(env.INTEGRATION_PG_PORT)))) {
    fail(`pg_ctl start failed with exit ${result.code}. See ${path.relative(process.cwd(), postgresLog)}.`);
  }
}

export async function ensurePostgres(env) {
  requirePostgresBinaries();
  const port = Number(env.INTEGRATION_PG_PORT);
  if (!(await exists(pgDataDir))) {
    await mkdir(pgDataDir, { recursive: true });
  }
  if (!(await exists(path.join(pgDataDir, 'PG_VERSION')))) {
    const passwordFile = path.join(runDir, 'pgpass-init.txt');
    await mkdir(runDir, { recursive: true });
    await writeFile(passwordFile, env.INTEGRATION_PG_PASSWORD, 'utf8');
    const init = await run(
      [
        pgTool('initdb'),
        '-D',
        pgDataDir,
        '-U',
        env.INTEGRATION_PG_USER,
        `--pwfile=${passwordFile}`,
        '--auth-local=trust',
        '--auth-host=scram-sha-256',
        '--encoding=UTF8',
      ],
      { timeoutMs: 120_000, log: path.join(logDir, 'initdb.log') },
    );
    if (init.code !== 0) fail(`initdb failed with exit ${init.code}. See ${path.relative(process.cwd(), path.join(logDir, 'initdb.log'))}.`);
    log('POSTGRES_CLUSTER_INITIALISED', { dataDir: path.relative(process.cwd(), pgDataDir), port });
  }
  if (!(await isPortListening(port))) {
    await startPostgres(env);
    await waitFor(() => isPortListening(port), { label: `postgres on ${port}`, timeoutMs: 60_000 });
    log('POSTGRES_STARTED', { port });
  }
  const psqlEnv = { PGPASSWORD: env.INTEGRATION_PG_PASSWORD };
  // A listener on our port must be our own cluster, not somebody else's server.
  const reported = await run(
    [pgTool('psql'), '-h', LOOPBACK, '-p', String(port), '-U', env.INTEGRATION_PG_USER, '-d', 'postgres', '-tAc', 'show data_directory'],
    { env: psqlEnv, timeoutMs: 30_000, log: path.join(logDir, 'psql-datadir.log') },
  );
  const normalize = (value) => value.trim().replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
  if (normalize(reported.output) !== normalize(pgDataDir)) {
    fail(`Port ${port} is served by a PostgreSQL cluster at ${reported.output.trim()}, not this bundle's cluster. Refusing to use it.`);
  }
  for (const database of [env.INTEGRATION_DB_NAME, env.INTEGRATION_TEST_DB_NAME]) {
    await ensureDatabase(env, port, psqlEnv, database);
  }
}

async function ensureDatabase(env, port, psqlEnv, database) {
  const exists_ = await run(
    [
      pgTool('psql'),
      '-h',
      LOOPBACK,
      '-p',
      String(port),
      '-U',
      env.INTEGRATION_PG_USER,
      '-d',
      'postgres',
      '-tAc',
      `select 1 from pg_database where datname = '${database}'`,
    ],
    { env: psqlEnv, timeoutMs: 30_000, log: path.join(logDir, 'psql-probe.log') },
  );
  if (!exists_.output.includes('1')) {
    const name = database.toLowerCase();
    if (!name.includes('_test') || ['fools_gold', 'postgres', 'app', 'development', 'dev', 'production', 'public'].includes(name)) {
      fail(`Refusing to create "${database}": the integration database must end in _test.`);
    }
    const created = await run(
      [pgTool('createdb'), '-h', LOOPBACK, '-p', String(port), '-U', env.INTEGRATION_PG_USER, '-O', env.INTEGRATION_PG_USER, database],
      { env: psqlEnv, timeoutMs: 30_000, log: path.join(logDir, 'createdb.log') },
    );
    if (created.code !== 0) fail(`createdb failed with exit ${created.code}. See ${path.relative(process.cwd(), path.join(logDir, 'createdb.log'))}.`);
    log('POSTGRES_DATABASE_CREATED', { database });
  }
}

export async function ensureRedis(env) {
  const port = Number(env.INTEGRATION_REDIS_PORT);
  const base = [redisCliBin, '-h', LOOPBACK, '-p', String(port)];
  if (await isPortListening(port)) {
    await assertRedisOwned(port);
    await run([...base, 'set', REDIS_OWNER_KEY, redisDataDir], { timeoutMs: 15_000 });
    return;
  }
  if (!existsSync(redisServerBin)) {
    fail(`redis-server.exe not found at ${redisServerBin}. Set INTEGRATION_REDIS_SERVER to its path.`);
  }
  spawnHidden(
    redisServerBin,
    ['--port', String(port), '--bind', LOOPBACK, '--dir', redisDataDir, '--save', '""', '--appendonly', 'no', '--logfile', redisLog],
    { log: path.join(logDir, 'redis-spawn.log') },
  );
  await waitFor(() => isPortListening(port), { label: `redis on ${port}`, timeoutMs: 30_000 });
  const ping = await run([redisCliBin, '-h', LOOPBACK, '-p', String(port), 'ping'], { timeoutMs: 15_000 });
  if (!ping.output.includes('PONG')) fail(`Redis on ${port} did not answer PING.`);
  await run([...base, 'set', REDIS_OWNER_KEY, redisDataDir], { timeoutMs: 15_000 });
  log('REDIS_STARTED', { port });
}

const normalizePath = (value) => String(value).trim().replace(/^"|"$/g, '').replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();

/**
 * A Redis instance is only touched when it is demonstrably ours: it answers
 * PING, its configured directory is this bundle's own data directory, any
 * existing ownership marker names that same directory, and it holds no key
 * outside this stack's `rate:*` namespace.
 */
export async function assertRedisOwned(port) {
  const base = [redisCliBin, '-h', LOOPBACK, '-p', String(port)];
  const ping = await run([...base, 'ping'], { timeoutMs: 15_000 });
  if (!ping.output.includes('PONG')) fail(`Port ${port} is listening but does not answer Redis PING; refusing to use it.`);
  const dir = await run([...base, 'config', 'get', 'dir'], { timeoutMs: 15_000 });
  const reported = dir.output.split(/\r?\n/)[1] ?? '';
  if (normalizePath(reported) !== normalizePath(redisDataDir)) {
    fail(`Redis on ${port} uses ${reported.trim()}, not this bundle's directory. Refusing to use it.`);
  }
  const marker = await run([...base, 'get', REDIS_OWNER_KEY], { timeoutMs: 15_000 });
  const owner = marker.output.trim();
  if (owner && normalizePath(owner) !== normalizePath(redisDataDir)) {
    fail(`Redis on ${port} is owned by ${owner}. Refusing to use it.`);
  }
  const keys = await run([...base, 'keys', '*'], { timeoutMs: 15_000 });
  const foreign = keys.output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((key) => !key.startsWith('rate:') && key !== REDIS_OWNER_KEY);
  if (foreign.length) {
    fail(`Redis on ${port} holds keys this stack does not own; point INTEGRATION_REDIS_PORT at a dedicated instance.`);
  }
  return true;
}

export async function stopDatastores(env) {
  const port = Number(env.INTEGRATION_PG_PORT);
  if (await exists(path.join(pgDataDir, 'PG_VERSION')) && (await isPortListening(port))) {
    const result = await run([pgTool('pg_ctl'), '-D', pgDataDir, '-m', 'fast', '-w', 'stop'], {
      timeoutMs: 60_000,
      log: path.join(logDir, 'pg_ctl-stop.log'),
    });
    log('POSTGRES_STOPPED', { code: result.code });
  }
  if (await isPortListening(Number(env.INTEGRATION_REDIS_PORT))) {
    await assertRedisOwned(Number(env.INTEGRATION_REDIS_PORT));
    await run([redisCliBin, '-h', LOOPBACK, '-p', String(env.INTEGRATION_REDIS_PORT), 'shutdown', 'nosave'], { timeoutMs: 15_000 });
    log('REDIS_STOPPED', {});
  }
}

export async function postgresIsUp(env) {
  return isPortListening(Number(env.INTEGRATION_PG_PORT));
}

export async function redisIsUp(env) {
  return isPortListening(Number(env.INTEGRATION_REDIS_PORT));
}
