// Payout-policy worker entry.
//
// Runs one bounded generator + evidence job off the HTTP event loop. It never
// touches the database, the wallet or request state: the service persists and
// audits whatever comes back, so a worker crash can lose work but can never
// corrupt a candidate or a pointer.
const { parentPort, workerData } = require('node:worker_threads');

async function run() {
  const module = require(workerData.modulePath);
  const work = module[workerData.exportName];
  if (typeof work !== 'function') {
    throw new Error(`PAYOUT_WORKER_ENTRY_MISSING: ${workerData.exportName}`);
  }
  return work(workerData.request);
}

run().then(
  (result) => parentPort.postMessage({ ok: true, result }),
  (error) => parentPort.postMessage({ ok: false, error: String((error && error.stack) || error) }),
);
