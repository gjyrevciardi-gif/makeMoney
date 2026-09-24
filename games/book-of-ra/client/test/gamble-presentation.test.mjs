import assert from 'node:assert/strict';
import test from 'node:test';
import { bookGambleView, bookGambleResolution, bookGambleMarkup, bookGambleStatus } from '../vendor/web-client/src/book-gamble-presentation.ts';

// Literal public response fixtures from the 831cbfc presentation contract.
// These tests never resolve choices or calculate payouts.
const pending = () => ({
  complete: false, totalWinUnits: '3000', events: [],
  pendingAction: { type: 'gamble', choices: [{ id: 'red' }, { id: 'black' }, { id: 'collect' }] },
  featureState: { bookOfRa: { pendingWin: '3000', gambleAttempts: 0, gambleMaxAttempts: 5, gambleHistory: [] } },
});
const outcome = (data, complete = false) => {
  const result = pending();
  result.complete = complete;
  result.events = [{ type: 'choice-resolved', data }];
  if (complete) delete result.pendingAction;
  return result;
};
const red = { choiceId: 'red', attempt: 1, winningColour: 'red', won: true, pendingWinUnits: '6000', settlementUnits: '0' };
const black = { choiceId: 'black', attempt: 2, winningColour: 'black', won: true, pendingWinUnits: '12000', settlementUnits: '0' };

test('pending panel exposes exactly the server RED / BLACK / COLLECT choices', () => {
  const view = bookGambleView(pending(), false);
  assert.deepEqual(view.choices, ['red', 'black', 'collect']);
  assert.equal(view.amountUnits, '3000');
  assert.equal(view.colour, undefined);
  assert.equal(bookGambleStatus(view), 'CHOOSE RED OR BLACK');
});
test('RED result displays revealed colour and supplied pending win', () => {
  const view = bookGambleView(outcome(red), false);
  assert.equal(view.status, 'won'); assert.equal(view.colour, 'red');
  assert.equal(view.amountUnits, '6000');
  assert.match(bookGambleMarkup(view, (units) => units), /card-face red/);
});
test('BLACK result uses its explicit outcome, not a local colour draw', () => {
  const view = bookGambleView(outcome(black), false);
  assert.equal(view.status, 'won'); assert.equal(view.colour, 'black');
  assert.equal(view.amountUnits, '12000');
  assert.match(bookGambleMarkup(view, (units) => units), /card-face black/);
});
test('loss presents server zero, revealed card, and terminal state', () => {
  const view = bookGambleView(outcome({ ...red, winningColour: 'black', won: false, pendingWinUnits: '0' }, true), false);
  assert.equal(view.amountUnits, '0'); assert.equal(view.status, 'lost');
  assert.equal(view.colour, 'black'); assert.equal(view.complete, true);
  assert.deepEqual(view.choices, []); assert.equal(bookGambleStatus(view), 'GAMBLE LOST');
});
test('COLLECT shows authoritative settlement without inventing a card or attempt', () => {
  const view = bookGambleView(outcome({ choiceId: 'collect', attempt: 0, winningColour: null, won: null, pendingWinUnits: '3000', settlementUnits: '3000' }, true), false);
  assert.equal(view.status, 'collected'); assert.equal(view.settlementUnits, '3000');
  assert.equal(view.colour, undefined); assert.equal(view.attempt, 0);
  assert.deepEqual(view.choices, []); assert.equal(bookGambleStatus(view), 'COLLECTED');
});
test('attempt counter and configured limit render without client incrementing', () => {
  const view = bookGambleView(outcome(black), false);
  assert.equal(view.attempt, 2); assert.equal(view.maximum, 5);
  assert.match(bookGambleMarkup(view, (units) => units), /2 \/ 5/);
});
test('max-attempt terminal presentation follows complete and settlement fields', () => {
  const view = bookGambleView(outcome({ ...red, attempt: 5, pendingWinUnits: '96000', settlementUnits: '96000' }, true), false);
  assert.equal(view.attempt, 5); assert.equal(view.maximum, 5);
  assert.equal(view.status, 'won'); assert.equal(bookGambleStatus(view), 'GAMBLE COMPLETE');
  assert.deepEqual(view.choices, []); assert.equal(view.settlementUnits, '96000');
});
test('autoplay exposes neither pending controls nor resolved Gamble presentation', () => {
  assert.equal(bookGambleView(pending(), true), undefined);
  assert.equal(bookGambleView(outcome(red), true), undefined);
});
test('stopping autoplay during a request does not expose that wager\'s Gamble response', () => {
  assert.equal(bookGambleView(pending(), false, true), undefined);
  assert.equal(bookGambleView(outcome(red), false, true), undefined);
});
test('cumulative response selects latest choice, not an earlier red result', () => {
  const result = outcome(black);
  result.events.unshift({ type: 'choice-resolved', data: red });
  assert.strictEqual(bookGambleResolution(result).data, black);
  assert.equal(bookGambleView(result, false).colour, 'black');
});
test('refresh reads only public history and never future colours', () => {
  const result = pending();
  result.featureState.bookOfRa = { ...result.featureState.bookOfRa, gambleAttempts: 2,
    gambleHistory: [{ winningColour: 'red' }, { winningColour: 'black' }],
    get gambleColours() { throw new Error('Private future colours must not be read'); } };
  const view = bookGambleView(result, false);
  assert.deepEqual(view.history, ['red', 'black']); assert.equal(view.colour, 'black');
  assert.equal(view.attempt, 2);
});
test('missing essential attempt data reports the field instead of assuming five', () => {
  const result = pending(); delete result.featureState.bookOfRa.gambleMaxAttempts;
  assert.throws(() => bookGambleView(result, false), /maxAttempts/);
});
