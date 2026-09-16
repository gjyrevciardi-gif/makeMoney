#!/usr/bin/env node
// Buyer demo control script.
//
//   node scripts/demo.mjs up        start datastores, migrate, build, serve, seed
//   node scripts/demo.mjs reset     restore the demo to its known presentation state
//   node scripts/demo.mjs status    what is running and what the demo accounts hold
//   node scripts/demo.mjs down      stop the app processes and the demo datastores
//
// The servers run built output rather than dev mode: a buyer demo should not be
// waiting on a route to compile on first click, and the dev overlay has no place
// on screen during a presentation.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { DEMO, ENV_FILE, ROOT, loadDemoEnv, ensureEnvFile } from './demo/env.mjs';
import { seedDemoAccounts, readDemoAccounts } from './demo/seed.mjs';

const STATE_DIR = resolve(ROOT, '.demo');
const STATE_FILE = resolve(STATE_DIR, 'state.json');
const API = `http://${DEMO.host}:${DEMO.backendPort}`;
const WEB = `http://${DEMO.host}:${DEMO.frontendPort}`;
const isWindows = process.platform === 'win32';

// Next refuses to build or serve correctly under a non-standard NODE_ENV - it
// mis-prerenders the error pages. The frontend therefore always gets
// NODE_ENV=production, while the backend deliberately stays on development so
// it does not trip validateProductionEnvironment(), which exists to stop a real
// deployment booting with demo-grade settings.
const frontendEnv = (env) => ({ ...env, NODE_ENV: 'production' });

const log = (msg) => console.log(msg);
const step = (msg) => console.log(`\n▸ ${msg}`);

const readState = () => (existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {});
const writeState = (patch) => {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify({ ...readState(), ...patch }, null, 2));
};

// Windows needs shell:true so .cmd shims such as npx resolve, but a shell
// re-parses the concatenated argv: an argument containing a semicolon (the SQL
// in wipeDatabase) or a space is torn apart. Quote those back together.
const shellQuote = (arg) =>
  (/[\s;&|<>^"]/.test(String(arg)) ? '"' + String(arg).replace(/"/g, '""') + '"' : String(arg));

function run(cmd, args, { cwd = ROOT, env = process.env, capture = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const argv = isWindows ? args.map(shellQuote) : args;
    const child = spawn(cmd, argv, { cwd, env, shell: isWindows, stdio: capture ? 'pipe' : 'inherit' });
    let out = '';
    if (capture) {
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { out += d; });
    }
    child.on('error', reject);
    child.on('close', (code) => (code === 0
      ? resolvePromise(out)
      : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}${capture ? `\n${out}` : ''}`))));
  });
}

function spawnServer(name, cmd, args, cwd, env) {
  mkdirSync(STATE_DIR, { recursive: true });
  const logPath = resolve(STATE_DIR, `${name}.log`);
  const fd = openSync(logPath, 'a');
  const child = spawn(cmd, args, { cwd, env, shell: isWindows, detached: !isWindows, stdio: ['ignore', fd, fd] });
  child.unref();
  return { pid: child.pid, logPath };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHttp(url, { timeoutMs = 180_000, label = url } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no attempt yet';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.status < 500) return true;
      lastError = `HTTP ${res.status}`;
    } catch (error) {
      lastError = error?.message ?? String(error);
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${label}: ${lastError}`);
}

const compose = (env, args) =>
  run('docker', ['compose', '--env-file', ENV_FILE, '-f', 'docker-compose.demo.yml', ...args], { env });

/** Kill a detached server and the tree it spawned (npm -> next/node). */
async function stopPid(pid, name) {
  if (!pid) return false;
  try {
    if (isWindows) await run('taskkill', ['/PID', String(pid), '/T', '/F'], { capture: true });
    else process.kill(-pid, 'SIGTERM');
    log(`  stopped ${name} (pid ${pid})`);
    return true;
  } catch {
    log(`  ${name} (pid ${pid}) was not running`);
    return false;
  }
}

// ---------------------------------------------------------------------------

async function startDatastores(env) {
  step('Starting isolated demo datastores');
  await compose(env, ['up', '-d', '--wait']);
  log(`  postgres 127.0.0.1:${DEMO.pgPort}   redis 127.0.0.1:${DEMO.redisPort}`);
}

async function migrate(env) {
  step('Applying database migrations');
  // Only generate when the client is genuinely missing: regenerating while any
  // server still holds query_engine-windows.dll.node fails with EPERM, and the
  // schema has not changed between demo runs anyway.
  if (!existsSync(resolve(ROOT, 'node_modules', '.prisma', 'client', 'index.js'))) {
    await run('npx', ['prisma', 'generate'], { cwd: resolve(ROOT, 'backend'), env });
  }
  await run('npx', ['prisma', 'migrate', 'deploy'], { cwd: resolve(ROOT, 'backend'), env });
}

// tsconfig compiles test/ alongside src/, which pushes the emitted entrypoint
// down to dist/src/main.js. Resolve it rather than assuming either layout.
function backendEntry() {
  for (const candidate of ['dist/main.js', 'dist/src/main.js']) {
    if (existsSync(resolve(ROOT, 'backend', candidate))) return candidate;
  }
  return null;
}

async function buildIfNeeded(env, { force = false } = {}) {
  const backendBuilt = backendEntry() !== null;
  const frontendBuilt = existsSync(resolve(ROOT, 'frontend', '.next', 'BUILD_ID'));
  if (force || !backendBuilt) {
    step('Building backend');
    await run('npx', ['nest', 'build'], { cwd: resolve(ROOT, 'backend'), env });
  }
  if (force || !frontendBuilt) {
    step('Building frontend (NEXT_PUBLIC_API_URL is baked in at build time)');
    await run('npx', ['next', 'build'], { cwd: resolve(ROOT, 'frontend'), env: frontendEnv(env) });
  }
}

async function startServers(env) {
  step('Starting application servers');
  const entry = backendEntry();
  if (!entry) throw new Error('Backend is not built: no dist/main.js or dist/src/main.js.');
  const backend = spawnServer('backend', 'node', [entry], resolve(ROOT, 'backend'), env);
  writeState({ backendPid: backend.pid });
  await waitForHttp(`${API}/health/ready`, { label: 'backend /health/ready' });
  log(`  backend  ${API}  (pid ${backend.pid}, log .demo/backend.log)`);

  const frontend = spawnServer('frontend', 'npx',
    ['next', 'start', '-p', String(DEMO.frontendPort), '-H', DEMO.host], resolve(ROOT, 'frontend'), frontendEnv(env));
  writeState({ frontendPid: frontend.pid });
  await waitForHttp(WEB, { label: 'frontend' });
  log(`  frontend ${WEB}  (pid ${frontend.pid}, log .demo/frontend.log)`);
}

async function sweepWorktreeServers() {
  if (!isWindows) return;
  // The pid we recorded is the npx shim; the real server is a grandchild that
  // survives it. Anything still running out of this worktree is ours to stop -
  // except this script itself.
  const dirName = basename(ROOT);
  const ps = [
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\"",
    `| Where-Object { $_.CommandLine -like '*${dirName}*'`,
    `  -and $_.ProcessId -ne ${process.pid}`,
    "  -and $_.CommandLine -notlike '*demo.mjs*'",
    "  -and $_.CommandLine -notlike '*demo-preflight*' }",
    '| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
  ].join(' ');
  try { await run('powershell', ['-NoProfile', '-Command', ps], { capture: true }); } catch { /* nothing to stop */ }
}

async function stopServers() {
  const state = readState();
  await stopPid(state.backendPid, 'backend');
  await stopPid(state.frontendPid, 'frontend');
  await sweepWorktreeServers();
  writeState({ backendPid: null, frontendPid: null });
}

/**
 * Wipe the demo schema. This is the only destructive operation in the tooling,
 * so it re-checks its target immediately before acting rather than trusting the
 * guard that ran at load time.
 */
async function wipeDatabase(env) {
  step('Recreating the demo schema');
  const { assertDemoTarget } = await import('./demo/env.mjs');
  assertDemoTarget(env);
  await compose(env, ['exec', '-T', 'postgres', 'psql', '-U', DEMO.dbUser, '-d', DEMO.database,
    '-v', 'ON_ERROR_STOP=1', '-c', 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;']);
  await compose(env, ['exec', '-T', 'redis', 'redis-cli', 'FLUSHALL']);
  log('  schema recreated and demo Redis flushed');
}

// ---------------------------------------------------------------------------

async function commandUp({ force = false } = {}) {
  const created = ensureEnvFile();
  if (created.created) {
    log(`Generated ${ENV_FILE} (gitignored).`);
    log(created.inheritedFrom ? '  Provider keys were inherited from an existing local checkout.' : '  No provider keys found - the sportsbook will run without a provider.');
  }
  const env = loadDemoEnv();
  await startDatastores(env);
  await migrate(env);
  await buildIfNeeded(env, { force });
  await stopServers();
  await startServers(env);
  const accounts = await seedDemoAccounts(env, { api: API });
  printSummary(accounts);
}

async function commandReset() {
  const env = loadDemoEnv();
  await startDatastores(env);
  await stopServers();
  await wipeDatabase(env);
  await migrate(env);
  await startServers(env);
  const accounts = await seedDemoAccounts(env, { api: API });
  printSummary(accounts);
}

async function commandDown() {
  const env = loadDemoEnv();
  step('Stopping application servers');
  await stopServers();
  step('Stopping demo datastores');
  await compose(env, ['down']);
  log('\nDemo stack stopped. Data volume kept - `up` restores it, `reset` reseeds it.');
}

async function commandStatus() {
  const env = loadDemoEnv();
  step('Datastores');
  try { log(await compose(env, ['ps', '--format', 'table {{.Service}}\t{{.Status}}'], { capture: true })); }
  catch { log('  not running'); }

  step('Servers');
  for (const [label, url] of [['backend ', `${API}/health/ready`], ['frontend', WEB]]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      log(`  ${label} ${url} -> HTTP ${res.status}`);
    } catch (error) {
      log(`  ${label} ${url} -> down (${error?.message ?? error})`);
    }
  }

  step('Demo accounts');
  try {
    const accounts = await readDemoAccounts(env, { api: API });
    for (const a of accounts) log(`  ${a.role.padEnd(6)} ${a.email.padEnd(32)} ${a.balance} PTS`);
  } catch (error) {
    log(`  unavailable (${error?.message ?? error})`);
  }
}

function printSummary(accounts) {
  log('\n' + '='.repeat(64));
  log('  BUYER DEMO STACK IS UP');
  log('='.repeat(64));
  log(`  Open:      ${WEB}`);
  log(`  API:       ${API}`);
  for (const a of accounts ?? []) log(`  ${a.role.padEnd(6)}     ${a.email.padEnd(32)} ${a.balance} PTS`);
  log(`  Passwords: see DEMO_ADMIN_PASSWORD / DEMO_PLAYER_PASSWORD in .env.demo`);
  log(`  Stop:      npm run demo:down`);
  log('='.repeat(64));
}

const commands = {
  up: () => commandUp({ force: process.argv.includes('--rebuild') }),
  reset: commandReset,
  down: commandDown,
  status: commandStatus,
  seed: async () => printSummary(await seedDemoAccounts(loadDemoEnv(), { api: API })),
};

const name = process.argv[2] ?? 'up';
const command = commands[name];
if (!command) {
  console.error(`Unknown command "${name}". Use: ${Object.keys(commands).join(', ')}`);
  process.exit(1);
}
command().catch((error) => {
  console.error(`\n✗ demo ${name} failed: ${error?.message ?? error}`);
  process.exit(1);
});
