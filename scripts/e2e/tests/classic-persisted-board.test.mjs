import test from 'node:test';
import assert from 'node:assert/strict';
import { classicReelsMatch, persistedClassicReels } from '../classic-persisted-board.mjs';

const board = { reel1: ['A', 'K', 'Q'], reel2: ['SCAT', 'A', 'J'], reel3: ['Q', 'K', 'A'], reel4: ['J', 'Q', 'K'], reel5: ['A', 'A', 'SCAT'], rp: [1, 2, 3, 4, 5] };

function roundWith(privateBoard, decoy) {
  return {
    id: 'round-1',
    stake: 9n,
    payout: 0n,
    state: decoy ?? { reelsSymbols: { reel1: ['FAKE'] } },
    privateState: {
      version: 1,
      phase: 'IDLE',
      plan: { spins: [{ board: [['SECRET']] }] },
      result: { responseEvent: 'spin', serverResponse: { reelsSymbols: privateBoard, Balance: 499991 } },
    },
  };
}

test('the persisted board is privateState.result.serverResponse, not round.state', () => {
  const round = roundWith(board);
  assert.deepEqual(persistedClassicReels(round), board);
  assert.equal(classicReelsMatch({ reelsSymbols: board }, round), true);
  assert.equal(classicReelsMatch({ reelsSymbols: round.state.reelsSymbols }, round), false);
});

test('a missing private presentation fails closed instead of borrowing round.state', () => {
  const round = { state: { reelsSymbols: board }, privateState: { plan: { spins: [] }, result: null } };
  assert.equal(persistedClassicReels(round), null);
  assert.equal(classicReelsMatch({ reelsSymbols: board }, round), false);
});

test('the reader does not expose the pre-drawn plan', () => {
  const round = roundWith(board);
  const persisted = persistedClassicReels(round);
  assert.equal(JSON.stringify(persisted).includes('SECRET'), false);
});
