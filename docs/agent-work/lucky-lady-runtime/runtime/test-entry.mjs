// TEST-ONLY entry. Deterministic draws, pre-generation outcome selection and fault-injection
// hooks live here and are unreachable from the production entry point (server.mjs).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRuntime } from './runtime-core.mjs';
import { createHttpServer } from './http-layer.mjs';
import { createDeterministicRng, generateCompleteRound, SUPPORTED_LINES } from './runtime-math.mjs';
import { RUN, CLIENT, PREVIEW, BRIDGE, SESSION_TOKEN } from './server.mjs';

const hooks = {};
let seedCounter = 0;
let gambleSeed = null;
const counters = { actionExecutions: 0, outcomeGenerations: 0, engineRngDraws: 0, gambleGenerations: 0, gambleRngDraws: 0 };

/**
 * Chooses a seed BEFORE the draw so the produced round is the requested shape. A fixed seed
 * short-circuits the search: the caller already knows which round that seed produces.
 */
export function createOutcomeRngFactory(outcome, fixedSeed) {
  return () => {
    if (fixedSeed) return createDeterministicRng(fixedSeed);
    if (!outcome) return createDeterministicRng(`test-${++seedCounter}`);
    const matches = (round) => (outcome === 'bonus' ? round.feature.spins > 0
      : outcome === 'retrigger' ? round.feature.sequence.some((s) => s.retriggered)
      : outcome === 'win' ? round.mainEval.totalWin > 0 && round.feature.spins === 0
      : round.mainEval.totalWin === 0 && round.feature.spins === 0);
    for (let i = 0; i < 5000; i++) {
      const seed = `sel-${outcome}-${++seedCounter}`;
      const probe = generateCompleteRound({ rng: createDeterministicRng(seed), bet: 1, lines: SUPPORTED_LINES });
      if (matches(probe.round)) return createDeterministicRng(seed);
    }
    throw new Error(`no seed produced outcome ${outcome}`);
  };
}

/** Gamble draws are injected separately so paid-round selection stays outcome-driven. */
export function createGambleRngFactory() {
  return () => createDeterministicRng(gambleSeed || 'gamble-default');
}

export function startTest({ port, dbName, outcome = null, fixedSeed = null, startingBalanceCents = 1000000, initialHooks = {} } = {}) {
  Object.assign(hooks, initialHooks);
  gambleSeed = null;
  for (const key of Object.keys(counters)) counters[key] = 0;
  const runtime = createRuntime({
    dir: RUN, dbName, rngFactory: createOutcomeRngFactory(outcome, fixedSeed),
    gambleRngFactory: createGambleRngFactory(), hooks, counters,
    config: { startingBalanceCents },
  });
  const extraRoutes = (req, res, url) => {
    if (url.pathname === '/__test/rng' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        try { gambleSeed = JSON.parse(raw || '{}').gambleSeed || null; } catch { gambleSeed = null; }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ gambleSeed }));
      });
      return true;
    }
    if (url.pathname === '/__test/hooks' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        for (const key of Object.keys(hooks)) delete hooks[key];
        try { Object.assign(hooks, JSON.parse(raw || '{}').hooks || {}); } catch { /* ignore */ }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ hooks: Object.keys(hooks) }));
      });
      return true;
    }
    if (url.pathname === '/__test/snapshot' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        balanceCents: runtime.balanceCents(), ledger: runtime.ledgerRows(),
        recovery: runtime.snapshotOf(), receipt: runtime.receiptState(), counters,
      }));
      return true;
    }
    return false;
  };
  const server = createHttpServer({ runtime, port, clientDir: CLIENT, previewDir: PREVIEW, bridgePath: BRIDGE, sessionToken: SESSION_TOKEN, extraRoutes });
  return { runtime, server, port, hooks };
}

if (process.argv[1] && process.argv[1].endsWith('test-entry.mjs')) {
  const port = Number(process.env.LUCKY_TEST_PORT || 8769);
  const { server } = startTest({ port, dbName: process.env.LUCKY_TEST_DB || 'test-entry.sqlite', outcome: process.env.LUCKY_TEST_OUTCOME || null, fixedSeed: process.env.LUCKY_TEST_SEED || null });
  server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ testEntry: `http://127.0.0.1:${port}`, rng: 'deterministic' })));
}
