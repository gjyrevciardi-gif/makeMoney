import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { BookAutoplay, autoplayStatus } from '../vendor/web-client/src/book-autoplay.ts';
import { bookGambleView } from '../vendor/web-client/src/book-gamble-presentation.ts';

const finished = { accepted: true, canContinue: true };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function setup() {
  const timers = new Map(); const requests = [];
  let nextId = 0; let ready = true;
  const run = new BookAutoplay({
    canStart: () => ready,
    spin: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    schedule: callback => { const id = ++nextId; timers.set(id, callback); return id; },
    cancel: id => timers.delete(id),
  });
  return { run, timers, requests, ready: value => { ready = value; },
    start: () => { assert.equal(run.open(), true); assert.equal(run.start(), true); },
    tick: () => { const [id, callback] = timers.entries().next().value; timers.delete(id); callback(); },
    finish: async (index = requests.length - 1, completion = finished) => { requests[index].resolve(completion); await flush(); },
  };
}

test('open, select an available count and close without issuing a wager', () => {
  const h = setup(); assert.equal(h.run.open(), true);
  assert.deepEqual([...h.run.counts], [10, 25, 50, 100]);
  assert.equal(h.run.select(25), true); assert.equal(h.run.state.selected, 25);
  for (const count of [-1, 0, 3, NaN, Infinity]) assert.equal(h.run.select(count), false);
  h.run.close(); assert.equal(h.run.state.panelOpen, false); assert.equal(h.requests.length, 0);
});

test('START closes panel and schedules exactly the selected finite count', async () => {
  const h = setup(); h.run.open(); h.run.select(25); h.run.start();
  assert.equal(h.run.state.panelOpen, false); assert.equal(h.run.state.remaining, 25);
  for (let index = 0; index < 25; index++) {
    assert.equal(h.requests.length, index + 1);
    await h.finish(); assert.equal(h.run.state.remaining, 24 - index);
    if (index < 24) h.tick();
  }
  assert.equal(h.run.state.phase, 'completed'); assert.equal(h.timers.size, 0);
  assert.equal(autoplayStatus(h.run.state), 'Autoplay complete');
});

test('remaining count waits for result presentation, including a Free Games sequence', async () => {
  const h = setup(); h.start();
  // The injected promise covers ALL authoritative feature events and animations.
  await flush(); assert.equal(h.run.state.remaining, 10); assert.equal(h.timers.size, 0);
  await h.finish(); assert.equal(h.run.state.remaining, 9); assert.equal(h.timers.size, 1);
  assert.match(autoplayStatus(h.run.state), /9 remaining/);
});

test('repeated START/open cannot overlap an in-flight request or scheduled request', async () => {
  const h = setup(); h.start();
  assert.equal(h.run.start(), false); assert.equal(h.run.open(), false);
  await h.finish(); assert.equal(h.run.start(), false); assert.equal(h.timers.size, 1);
  h.tick(); assert.equal(h.requests.length, 2); assert.equal(h.run.start(), false);
});

test('STOP cancels the scheduled request; duplicate STOP is idempotent', async () => {
  const h = setup(); h.start(); await h.finish(); h.run.stop();
  const stopped = h.run.state; h.run.stop(); assert.deepEqual(h.run.state, stopped);
  assert.equal(h.timers.size, 0); assert.equal(h.requests.length, 1);
  assert.match(autoplayStatus(h.run.state), /stopped.*9 remaining/);
});

test('in-flight STOP finishes current presentation, decrements once and starts no extra spin', async () => {
  const h = setup(); h.start(); h.run.stop(); h.run.stop();
  assert.equal(h.run.state.phase, 'stopping'); assert.equal(h.run.state.remaining, 10);
  assert.equal(h.run.open(), false); assert.equal(h.run.start(), false);
  assert.match(autoplayStatus(h.run.state), /Stopping after this spin/);
  await h.finish(); assert.equal(h.run.state.remaining, 9); assert.equal(h.run.state.phase, 'stopped');
  assert.equal(h.timers.size, 0); assert.equal(h.requests.length, 1);
});

test('already dequeued timer cannot start an extra request after STOP or a new sequence', async () => {
  const h = setup(); h.start(); await h.finish();
  const stale = [...h.timers.values()][0]; h.run.stop(); stale();
  assert.equal(h.requests.length, 1); h.start(); stale();
  assert.equal(h.requests.length, 2); assert.equal(h.run.state.remaining, 10);
});

test('remaining never becomes negative, even when a stale completion callback fires again', async () => {
  const h = setup(); h.start();
  for (let index = 0; index < 10; index++) { await h.finish(); if (index < 9) h.tick(); }
  await h.finish(); h.run.stop(); h.run.stop();
  assert.equal(h.run.state.remaining, 0); assert.equal(h.requests.length, 10);
});

test('cleanup cancels timers, and remount/re-render cannot revive old callbacks', async () => {
  const h = setup(); h.start(); await h.finish();
  const stale = [...h.timers.values()][0]; h.run.dispose();
  assert.equal(h.timers.size, 0); h.start(); stale();
  assert.equal(h.requests.length, 2); h.run.dispose(); await h.finish();
  assert.equal(h.timers.size, 0); assert.equal(h.run.state.inFlight, false);
});

test('busy, pending action or disconnected state prevents opening/starting/next request', async () => {
  const h = setup(); h.ready(false); assert.equal(h.run.open(), false);
  h.ready(true); h.run.open(); h.ready(false); assert.equal(h.run.start(), false);
  h.ready(true); h.run.start(); await h.finish(); h.ready(false); h.tick();
  assert.equal(h.requests.length, 1); assert.equal(h.run.state.phase, 'stopped');
});

test('pending authoritative action stops scheduling without local settlement', async () => {
  const h = setup(); h.start(); await h.finish(0, { accepted: true, canContinue: false });
  assert.equal(h.run.state.phase, 'stopped'); assert.equal(h.run.state.remaining, 9);
  assert.equal(h.timers.size, 0);
});

test('unaccepted requests do not consume count and are never retried automatically', async () => {
  const h = setup(); h.start(); await h.finish(0, { accepted: false, canContinue: false });
  assert.equal(h.run.state.remaining, 10); assert.equal(h.run.state.active, false);
  assert.equal(h.timers.size, 0);
});

test('transport rejection ends sequence without retry or fabricated result', async () => {
  const h = setup(); h.start(); h.requests[0].reject(new Error('offline')); await flush();
  assert.equal(h.run.state.phase, 'error'); assert.equal(h.run.state.remaining, 10);
  assert.equal(h.timers.size, 0);
});

test('Gamble remains hidden while active AND while a stopped autoplay wager finishes', async () => {
  const h = setup(); h.start();
  const result = { complete: false, pendingAction: { type: 'gamble' }, events: [] };
  const requestOrigin = h.run.state.active;
  assert.equal(bookGambleView(result, h.run.state.active, requestOrigin), undefined);
  h.run.stop();
  assert.equal(bookGambleView(result, h.run.state.active, requestOrigin), undefined);
  await h.finish(0, { accepted: true, canContinue: false });
  assert.equal(h.timers.size, 0);
});

test('component wires controller lifecycle, count controls and authoritative playback without a second scheduler', () => {
  const source = readFileSync(new URL('../vendor/web-client/src/slot-game.ts', import.meta.url), 'utf8');
  const spin = source.slice(source.indexOf('  async #spin('), source.indexOf('  async playResult('));
  assert.match(source, /disconnectedCallback\(\).*#autoplayRun\.dispose\(\)/);
  assert.match(source, /render\(\): void \{\s*\+\+this\.#renderGeneration; this\.#autoplayRun\.stop\(\)/);
  assert.match(source, /data-auto-count/); assert.match(source, /data-auto-start/);
  assert.match(spin, /this\.#gambleRequestAutoplay = autoplayRequest/);
  assert.match(spin, /await this\.#transport\.spin/); assert.match(spin, /await this\.playResult\(result\)/);
  assert.doesNotMatch(spin, /setTimeout/);
});
