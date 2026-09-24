import assert from 'node:assert/strict';
import test from 'node:test';
import { bookFreeGamesAward, bookWinForEvent } from '../vendor/web-client/src/book-presentation.ts';

// Presentation payload shapes from backend commit 831cbfc. No engine is executed.
const normal = Object.freeze({ evaluator: 'book-of-ra-deluxe-paylines', symbolId: 'low-4', payoutUnits: '500', cells: [{ reel: 0, row: 1 }] });
const expanding = Object.freeze({ evaluator: 'book-of-ra-expanding', symbolId: 'low-4', payoutUnits: '500', cells: [{ reel: 0, row: 0 }, { reel: 2, row: 2 }] });

test('retrigger uses awarded increment, not missing spins or remaining total', () => {
  assert.equal(bookFreeGamesAward({ featureId: 'retriggering-free-spins', addedSpins: 10, remaining: 17 }), 10);
  assert.equal(bookFreeGamesAward({ featureId: 'retriggering-free-spins', addedSpins: 7, spins: 99, remaining: 24 }), 7);
  assert.equal(bookFreeGamesAward({ featureId: 'free-spins', spins: 10 }), 10);
});

test('missing award data is reported instead of inventing +0 or +10', () => {
  assert.throws(() => bookFreeGamesAward({ featureId: 'retriggering-free-spins', remaining: 17 }), /addedSpins/);
});

test('expanding identity beats identical normal symbol and payout in either order', () => {
  const event = { expanding: true, symbolId: 'low-4', payoutUnits: '500', reels: [0, 2] };
  for (const wins of [Object.freeze([normal, expanding]), Object.freeze([expanding, normal])]) {
    assert.strictEqual(bookWinForEvent(event, wins), expanding);
  }
});

test('regular event retains its own evaluator and cells', () => {
  assert.strictEqual(bookWinForEvent({ ...normal, regular: true }, [expanding, normal]), normal);
});

test('scatter identity is distinct from a same-amount regular Book win', () => {
  const regularBook = { ...normal, symbolId: 'scatter' };
  const scatter = { ...regularBook, evaluator: 'book-of-ra-scatter' };
  assert.strictEqual(bookWinForEvent({ scatterPay: true, symbolId: 'scatter', payoutUnits: '500' }, [regularBook, scatter]), scatter);
});

test('missing or conflicting provenance cannot fall back to a normal win', () => {
  assert.equal(bookWinForEvent({ expanding: true, symbolId: 'low-4', payoutUnits: '500' }, [normal]), undefined);
  assert.equal(bookWinForEvent({ symbolId: 'low-4', payoutUnits: '500' }, [normal, expanding]), undefined);
  assert.equal(bookWinForEvent({ ...normal, expanding: true }, [normal, expanding]), undefined);
});

test('duplicate authoritative identities stay unmatched instead of choosing array order', () => {
  assert.equal(bookWinForEvent({ expanding: true, symbolId: 'low-4', payoutUnits: '500' }, [expanding, { ...expanding, cells: normal.cells }]), undefined);
});
