/**
 * Starts the integration stack: isolated datastores, the accepted Nest backend
 * on a loopback port, the local test accounts, and the integration preview.
 *
 * Run `node scripts/book-integration/setup.mjs` once first. This script is safe
 * to re-run; every step checks whether it is already satisfied.
 */
import { existsSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  ensureDirs,
  exists,
  fail,
  isPortListening,
  loadIntegrationEnv,
  log,
  logDir,
  npmBin,
  pidOnPort,
  processCommandLine,
  root,
  run,
  spawnHidden,
  stopProcess,
  waitFor,
  writePidFile,
} from './lib.mjs';
import { ensurePostgres, ensureRedis } from './services.mjs';
import { assertLocalTestTarget } from './setup.mjs';
import { provisionLocalTestAccounts } from './provision.mjs';

const env = await loadIntegrationEnv();
assertLocalTestTarget(env);
await ensureDirs();

const backendPort = Number(env.INTEGRATION_BACKEND_PORT);
const previewPort = Number(env.INTEGRATION_PREVIEW_PORT);
const adapterEntry = path.join(root, 'scripts', 'book-integration', 'adapter.mjs');

/**
 * A listener is only reused when it is proven to be this worktree's own
 * process; anything else is refused rather than stopped or trusted.
 */
async function requireOwnedListener(port, needle, label) {
  const pid = await pidOnPort(port);
  if (!pid) return false;
  const commandLine = await processCommandLine(pid);
  if (!commandLine.toLowerCase().includes(root.toLowerCase()) || !commandLine.includes(needle)) {
    fail(`Port ${port} is held by an unrelated process (pid ${pid}, "${label}"); refusing to reuse or stop it.`);
  }
  return true;
}

/** `nest build` places the compiled entry under dist/src when tests are included. */
function resolveBackendEntry() {
  for (const candidate of ['dist/src/main.js', 'dist/main.js']) {
    const target = path.join(root, 'backend', ...candidate.split('/'));
    if (existsSync(target)) return target;
  }
  return undefined;
}

/** True when any backend source file is newer than the compiled entry point. */
function backendNeedsBuild(entry) {
  if (!entry) return true;
  const compiled = statSync(entry).mtimeMs;
  const newest = (dir) => {
    let latest = 0;
    for (const name of readdirSync(dir)) {
      const target = path.join(dir, name);
      const info = statSync(target);
      latest = Math.max(latest, info.isDirectory() ? newest(target) : info.mtimeMs);
    }
    return latest;
  };
  return Math.max(newest(path.join(root, 'backend', 'src')), newest(path.join(root, 'packages', 'slot-skills', 'runtime', 'src')), newest(path.join(root, 'packages', 'slot-skills', 'math', 'src'))) > compiled;
}

log('INTEGRATION_START_BEGIN', { backendPort, previewPort });
await ensurePostgres(env);
await ensureRedis(env);

const rebuilt = backendNeedsBuild(resolveBackendEntry());
if (rebuilt) {
  log('BACKEND_BUILD_START', {});
  const build = await run([npmBin, 'run', 'build', '-w', 'backend'], {
    shell: process.platform === 'win32',
    env,
    timeoutMs: 600_000,
    log: path.join(logDir, 'backend-build.log'),
  });
  if (build.code !== 0) fail('Backend build failed. See tmp/integration/logs/backend-build.log.');
  log('BACKEND_BUILD_DONE', {});
}

const backendEntry = resolveBackendEntry();
if (!backendEntry) fail('The compiled backend entry point was not found after the build.');

// A rebuilt backend must be restarted, otherwise the old code keeps serving.
if (rebuilt && (await isPortListening(backendPort))) {
  const pid = await pidOnPort(backendPort);
  const commandLine = pid ? await processCommandLine(pid) : '';
  if (!pid || !commandLine.toLowerCase().includes(root.toLowerCase()) || !commandLine.includes('main.js')) {
    fail(`Port ${backendPort} is held by an unrelated process; refusing to restart it.`);
  }
  stopProcess(pid);
  await waitFor(async () => !(await isPortListening(backendPort)), { label: 'the old backend to exit', timeoutMs: 30_000 });
  log('BACKEND_RESTARTED_FOR_REBUILD', { pid });
}

if (!(await isPortListening(backendPort))) {
  spawnHidden('node', [backendEntry], { env, log: path.join(logDir, 'backend.log') });
  await waitFor(() => isPortListening(backendPort), { label: `backend on ${backendPort}`, timeoutMs: 120_000 });
  log('BACKEND_STARTED', { port: backendPort });
} else {
  await requireOwnedListener(backendPort, 'main.js', "not this bundle's backend");
  log('BACKEND_ALREADY_RUNNING', { port: backendPort });
}

const provisioned = await provisionLocalTestAccounts(env);

if (!(await isPortListening(previewPort))) {
  spawnHidden('node', [adapterEntry], { env, log: path.join(logDir, 'adapter.log') });
  await waitFor(() => isPortListening(previewPort), { label: `integration preview on ${previewPort}`, timeoutMs: 60_000 });
  log('INTEGRATION_PREVIEW_STARTED', { port: previewPort });
} else {
  await requireOwnedListener(previewPort, 'adapter.mjs', "not this bundle's preview");
  log('INTEGRATION_PREVIEW_ALREADY_RUNNING', { port: previewPort });
}

await writePidFile({
  backend: { port: backendPort, pid: await pidOnPort(backendPort) },
  preview: { port: previewPort, pid: await pidOnPort(previewPort) },
  postgres: { port: Number(env.INTEGRATION_PG_PORT) },
  redis: { port: Number(env.INTEGRATION_REDIS_PORT) },
  updatedAt: new Date().toISOString(),
});

log('INTEGRATION_READY', {
  cabinet: `http://127.0.0.1:${previewPort}/`,
  signIn: `http://127.0.0.1:${previewPort}/integration/login.html`,
  api: `http://127.0.0.1:${backendPort}/casino/book-of-ra/config`,
  playerAccount: env.INTEGRATION_PLAYER_EMAIL,
  playerBalance: provisioned.balance,
  credentialsFile: '.env.integration (ignored; contains INTEGRATION_PLAYER_PASSWORD and INTEGRATION_ADMIN_PASSWORD)',
  stop: 'node scripts/book-integration/stop.mjs',
});
