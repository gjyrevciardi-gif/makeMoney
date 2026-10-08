import assert from 'node:assert/strict';
import test from 'node:test';
import { projectRound, projectRefresh } from '../projection.mjs';
import { transformPlayerHtml } from '../serve-transform.mjs';
import { bookGambleView } from '../../../games/book-of-ra/client/vendor/web-client/src/book-gamble-presentation.ts';
import { bookWinForEvent } from '../../../games/book-of-ra/client/vendor/web-client/src/book-presentation.ts';

/** The raw reveal board: reel 1 has not expanded yet. */
const rawBoard = [
  ['scatter', 'low-2', 'low-3'],
  ['high-1', 'low-2', 'scatter'],
  ['low-3', 'low-4', 'low-5'],
  ['high-2', 'low-1', 'low-2'],
  ['low-4', 'low-5', 'low-1'],
];
/** The resolved board: reel 1 expanded to three Books. */
const finalBoard = [
  ['scatter', 'scatter', 'scatter'],
  ['high-1', 'low-2', 'scatter'],
  ['low-3', 'low-4', 'low-5'],
  ['high-2', 'low-1', 'low-2'],
  ['low-4', 'low-5', 'low-1'],
];

const baseView = (overrides = {}) => ({
  gameId: 'book-of-ra',
  gameType: 'SLOTS',
  profileId: 'book-of-ra.v1.rtp5000',
  profileFingerprint: 'f'.repeat(64),
  roundId: '11111111-1111-4111-8111-111111111111',
  roundState: 'ROUND_COMPLETE',
  board: finalBoard,
  wins: [],
  winTotal: '0',
  expandingReels: [],
  expandingWin: '0',
  specialSymbol: null,
  betPerLine: '10',
  totalBet: '100',
  activeLines: 10,
  stakeLocked: false,
  freeSpinsAwarded: 0,
  freeSpinsRemaining: 0,
  freeSpinsPlayed: 0,
  featureWin: '0',
  pendingWin: '0',
  gambleAttempts: 0,
  gambleMaxAttempts: 5,
  pendingAction: null,
  gamble: { pending: false, attempts: 0, maxAttempts: 5, pendingWin: '0', resolved: null, history: [] },
  spinPresentation: {
    board: rawBoard,
    freeSpin: false,
    freeSpinIndex: null,
    retriggered: 0,
    freeSpinsRemaining: 0,
    specialSymbol: null,
    phase: 'ROUND_COMPLETE',
  },
  settlement: { wager: '100', payout: '0', settled: true },
  balance: null,
  idempotent: false,
  ...overrides,
});

test('the reveal event carries the raw board, never the already expanded grid', () => {
  const round = projectRound(baseView(), { playerId: 'player' });
  const reveal = round.events.find((event) => event.type === 'grid-reveal');
  assert.ok(reveal, 'a live spin must settle the accepted reel animation');
  assert.deepEqual(reveal.data.grid, rawBoard);
  assert.notDeepEqual(reveal.data.grid, finalBoard);
  assert.deepEqual(round.finalGrid, finalBoard);
  assert.equal(reveal.sequence, 1);
  assert.equal(reveal.data.freeSpinIndex, undefined);
});

test('free spins carry the authoritative free-spin index on the reveal', () => {
  const round = projectRound(
    baseView({
      roundState: 'FREE_GAME_ACTIVE',
      freeSpinsAwarded: 10,
      freeSpinsRemaining: 7,
      freeSpinsPlayed: 3,
      specialSymbol: 'high-1',
      spinPresentation: {
        board: rawBoard,
        freeSpin: true,
        freeSpinIndex: 3,
        retriggered: 0,
        freeSpinsRemaining: 7,
        specialSymbol: 'high-1',
        phase: 'FREE_GAME_ACTIVE',
      },
    }),
    { playerId: 'player' },
  );
  assert.deepEqual(round.events.map((event) => event.type), ['grid-reveal']);
  assert.equal(round.events[0].data.freeSpinIndex, 3);
});

test('ordering is reveal, regular wins, scatter, expansion, expanding win, retrigger', () => {
  const round = projectRound(
    baseView({
      expandingReels: [0],
      expandingWin: '500',
      winTotal: '700',
      specialSymbol: 'scatter',
      wins: [
        { evaluator: 'book-of-ra-expanding', symbolId: 'scatter', count: 1, ways: 10, cells: [{ reel: 0, row: 0 }], amount: '500' },
        { evaluator: 'book-of-ra-scatter', symbolId: 'scatter', count: 3, ways: 1, cells: [{ reel: 0, row: 0 }], amount: '200' },
        { evaluator: 'ways', symbolId: 'low-1', count: 3, ways: 2, cells: [{ reel: 0, row: 0 }], amount: '300' },
      ],
      spinPresentation: {
        board: rawBoard,
        freeSpin: true,
        freeSpinIndex: 4,
        retriggered: 10,
        freeSpinsRemaining: 16,
        specialSymbol: 'scatter',
        phase: 'FREE_GAME_ACTIVE',
      },
    }),
    { playerId: 'player' },
  );
  assert.deepEqual(round.events.map((event) => event.type), [
    'grid-reveal',
    'win',
    'win',
    'reel-transform',
    'win',
    'feature-start',
  ]);
  const [reveal, regular, scatter, transform, expanding, retrigger] = round.events;
  assert.deepEqual(reveal.data.grid, rawBoard);
  assert.equal(regular.data.evaluator, 'ways');
  assert.equal(scatter.data.scatterPay, true);
  assert.equal(transform.data.specialSymbol, 'scatter');
  assert.deepEqual(transform.data.expandingReels, [0]);
  assert.equal(expanding.data.expanding, true);
  assert.equal(expanding.data.payoutUnits, '500');
  assert.equal(retrigger.data.featureId, 'retriggering-free-spins');
  assert.equal(retrigger.data.addedSpins, 10);
});

test('every win event keeps the engine evaluator/symbol/payout identity', () => {
  const view = baseView({
    wins: [
      { evaluator: 'book-of-ra-scatter', symbolId: 'scatter', count: 3, ways: 1, cells: [], amount: '20' },
      { evaluator: 'ways', symbolId: 'low-1', count: 3, ways: 2, cells: [], amount: '300' },
    ],
  });
  const round = projectRound(view, { playerId: 'player' });
  for (const event of round.events.filter((entry) => entry.type === 'win')) {
    const matched = bookWinForEvent(event.data, round.wins);
    assert.ok(matched, `event ${event.data.evaluator} must match exactly one engine win`);
    assert.equal(matched.payoutUnits, event.data.payoutUnits);
    assert.equal(matched.symbolId, event.data.symbolId);
  }
});

test('a projection without a resolved spin publishes no replay events', () => {
  const round = projectRound(baseView({ spinPresentation: null }), { playerId: 'player' });
  assert.deepEqual(round.events, []);
  assert.ok(!JSON.stringify(round).includes('gambleColours'));
});

test('a refresh is a snapshot: no wins, no intro, no retrigger replay', () => {
  const refresh = projectRefresh(
    baseView({
      roundState: 'FREE_GAME_ACTIVE',
      freeSpinsRemaining: 6,
      wins: [{ evaluator: 'ways', symbolId: 'low-1', count: 3, ways: 1, cells: [], amount: '300' }],
      spinPresentation: { board: rawBoard, freeSpin: true, freeSpinIndex: 3, retriggered: 10, freeSpinsRemaining: 6, specialSymbol: 'high-1', phase: 'FREE_GAME_ACTIVE' },
    }),
    { playerId: 'player' },
  );
  assert.ok(refresh.pendingRound);
  assert.deepEqual(refresh.pendingRound.events, []);
  assert.deepEqual(refresh.pendingRound.finalGrid, finalBoard);
  assert.equal(refresh.pendingRound.featureState.bookOfRa.phase, 'FREE_GAME_ACTIVE');
});

test('a refresh with no board and no pending action presents nothing', () => {
  const refresh = projectRefresh(baseView({ board: null, spinPresentation: null, roundState: 'IDLE' }), { playerId: 'player' });
  assert.equal(refresh.pendingRound, undefined);
});

test('a resolved gamble satisfies the accepted gamble presentation consumer', () => {
  const round = projectRound(
    baseView({
      winTotal: '200',
      gamble: {
        pending: false,
        attempts: 1,
        maxAttempts: 5,
        pendingWin: '0',
        resolved: {
          attempt: 1,
          choice: 'red',
          winningColour: 'red',
          won: false,
          pendingWinBefore: '200',
          pendingWinAfter: '0',
          settlement: '0',
          complete: true,
        },
        history: [{ attempt: 1, choice: 'red', winningColour: 'red', won: false, pendingWinBefore: '200', pendingWinAfter: '0' }],
      },
    }),
    { playerId: 'player' },
  );
  assert.equal(round.gameId, 'book-of-the-sands');
  const presented = bookGambleView(round, false, false);
  assert.equal(presented.status, 'lost');
  assert.equal(presented.colour, 'red');
  assert.deepEqual(presented.history, ['red']);
  assert.equal(presented.complete, true);
});

test('the served page starts inert and never replays the demo fixture', () => {
  const source = `<slot-game chrome="immersive" presentation="classic"></slot-game>
const root=element.shadowRoot;
for(const [selector,text] of Object.entries(fixture.meters)) root.querySelector(selector).textContent=text;
try{const state=await (await fetch(\`/v1/state/demo-player?gameId=\${encodeURIComponent(game.id)}\`)).json();if(state.pendingRound) await element.playResult(state.pendingRound);}catch(_error){/* first load may have no persisted round */}
document.documentElement.dataset.ready='true';`;
  const served = transformPlayerHtml(source);
  assert.ok(served.includes('<slot-game inert chrome="immersive"'));
  assert.ok(!served.includes('fixture.meters'));
  assert.ok(!served.includes('/v1/state/demo-player'));
  assert.ok(served.includes("await (await import('/integration/bootstrap.mjs')).initialize(element);"));
  assert.ok(served.includes("dataset.ready='true'"));
});
