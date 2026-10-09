// Game Math Control worker entry.
//
// Loads the *compiled* game mathematics adapter and runs one bounded CPU job.
// It never touches the database, the wallet or request state: the platform
// service persists and audits whatever comes back, so a worker crash can lose
// work but can never corrupt an account.
const { parentPort, workerData } = require('node:worker_threads');

async function run() {
  const module = require(workerData.modulePath);
  const Adapter = module[workerData.exportName];
  if (typeof Adapter !== 'function') {
    throw new Error(`MATH_WORKER_ADAPTER_MISSING: ${workerData.exportName}`);
  }
  const adapter = new Adapter();
  if (workerData.kind === 'GENERATE') {
    return adapter.generateProfile(workerData.policy);
  }
  if (workerData.kind === 'VALIDATE') {
    return adapter.validateProfile(workerData.policy, workerData.artifact, workerData.options);
  }
  throw new Error(`MATH_WORKER_KIND_UNKNOWN: ${workerData.kind}`);
}

run().then(
  (result) => parentPort.postMessage({ ok: true, result }),
  (error) => parentPort.postMessage({ ok: false, error: String((error && error.stack) || error) }),
);
