/**
 * Stops the integration stack.
 *
 * Default: the backend and the integration preview only. With `--all` it also
 * stops the isolated PostgreSQL cluster and the dedicated Redis instance.
 *
 * A listener is stopped only when its command line proves it belongs to this
 * worktree. There is deliberately no pid-file fallback: a recorded pid may have
 * been reused by an unrelated process, so a port with a foreign owner is
 * reported and left alone.
 */
import {
  fail,
  isPortListening,
  loadIntegrationEnv,
  log,
  pidOnPort,
  processCommandLine,
  root,
  stopProcess,
} from './lib.mjs';
import { stopDatastores } from './services.mjs';

const env = await loadIntegrationEnv();
const withDatastores = process.argv.includes('--all');
const targets = [
  { name: 'backend', port: Number(env.INTEGRATION_BACKEND_PORT), needle: 'main.js' },
  { name: 'preview', port: Number(env.INTEGRATION_PREVIEW_PORT), needle: 'adapter.mjs' },
];

for (const target of targets) {
  if (!(await isPortListening(target.port))) {
    log('PROCESS_NOT_RUNNING', { name: target.name, port: target.port });
    continue;
  }
  const pid = await pidOnPort(target.port);
  const commandLine = pid ? await processCommandLine(pid) : '';
  const owned = pid && commandLine.toLowerCase().includes(root.toLowerCase()) && commandLine.includes(target.needle);
  if (!owned) {
    fail(`Port ${target.port} is not this bundle's ${target.name}; refusing to stop pid ${pid ?? 'unknown'}.`);
  }
  if (stopProcess(pid)) log('PROCESS_STOPPED', { name: target.name, port: target.port, pid });
}

if (withDatastores) {
  await stopDatastores(env);
}
