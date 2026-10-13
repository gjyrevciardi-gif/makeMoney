import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const { createCallBudgetRng } = require(join(ROOT, 'backend', 'test', 'classic-browser-fixture', 'classic-scripted-rng.cjs'));

test('a call budget switches streams and then refuses another draw', () => {
  const seen = [];
  const rng = createCallBudgetRng([2, 1], (span, upper) => {
    seen.push([span, upper]);
    return span * 10 + upper;
  });
  assert.equal(rng(5), 5);
  assert.equal(rng(6), 6);
  assert.equal(rng(7), 17);
  assert.equal(rng.calls(), 3);
  assert.throws(() => rng(1), (error) => error.code === 'SCRIPTED_RNG_EXHAUSTED');
  assert.deepEqual(seen, [[0, 5], [0, 6], [1, 7]]);
  assert.equal(rng.calls(), 3);
});

test('the scripted backend is absent from the runtime image copy list', () => {
  const docker = readFileSync(join(ROOT, 'backend', 'Dockerfile'), 'utf8');
  const runtime = docker.split('AS runtime')[1] ?? '';
  assert.ok(runtime.length > 0);
  assert.equal(runtime.includes('backend/test'), false);
  assert.equal(runtime.includes('classic-browser-fixture'), false);
  const gateway = readFileSync(join(ROOT, 'games', 'book-of-ra-classic', 'gateway', 'Dockerfile'), 'utf8');
  assert.equal(gateway.includes('classic-browser-fixture'), false);
  assert.equal(gateway.includes('SCRIPTED'), false);
});

test('the scripted backend refuses production and an unmarked start', () => {
  const server = join(ROOT, 'backend', 'test', 'classic-browser-fixture', 'server.cjs');
  const production = spawnSync(process.execPath, [server], {
    env: { ...process.env, NODE_ENV: 'production', BOOK_CLASSIC_E2E_SCRIPTED_RNG: '1' },
    encoding: 'utf8',
  });
  assert.notEqual(production.status, 0);
  assert.match(production.stderr, /refuses NODE_ENV=production/);

  const unmarked = spawnSync(process.execPath, [server], {
    env: { ...process.env, NODE_ENV: 'development', BOOK_CLASSIC_E2E_SCRIPTED_RNG: '' },
    encoding: 'utf8',
  });
  assert.notEqual(unmarked.status, 0);
  assert.match(unmarked.stderr, /BOOK_CLASSIC_E2E_SCRIPTED_RNG/);
});
