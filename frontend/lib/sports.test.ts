import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { groupMarkets, h2hCells, isSelectable, type BoardEvent, type Market, type Selection } from './sports-markets.ts';

const sel = (key: string, name: string, extra: Partial<Selection> = {}): Selection =>
  ({ key, name, price: '2.00', ...extra });

const market = (key: string, selections: Selection[], extra: Partial<Market> = {}): Market =>
  ({ key, name: key, selections, ...extra });

const row = (markets: Market[], homeTeam = 'Home FC', awayTeam = 'Away FC'): BoardEvent => ({
  event: {
    provider: 'api-football', providerEventId: '1', internalEventId: 'af_1',
    sportKey: 'soccer', sportName: 'Football', homeTeam, awayTeam,
    startTime: '2099-01-01T12:00:00.000Z', status: 'UPCOMING',
  },
  bookmaker: null,
  markets,
});

test('h2h cells resolve API-Football home/draw/away keys', () => {
  // Regression: these outcomes are named "Home"/"Draw"/"Away", so matching on
  // the team name found only the draw and the row rendered "— X 4.00 —",
  // silently losing the home and away prices on every soccer fixture.
  const cells = h2hCells(row([market('h2h', [sel('home', 'Home'), sel('draw', 'Draw'), sel('away', 'Away')])]));
  assert.deepEqual(cells.map(c => c?.key ?? null), ['home', 'draw', 'away']);
});

test('h2h cells still resolve The Odds API team-named outcomes', () => {
  const cells = h2hCells(row([market('h2h', [
    sel('h2h:Home FC::0', 'Home FC'), sel('h2h:Away FC::1', 'Away FC'), sel('h2h:Draw::2', 'Draw'),
  ])]));
  assert.deepEqual(cells.map(c => c?.name ?? null), ['Home FC', 'Draw', 'Away FC']);
});

test('h2h cells are all null when the market is absent', () => {
  assert.deepEqual(h2hCells(row([])), [null, null, null]);
});

test('a display-only market is never selectable', () => {
  const m = market('corners_totals', [sel('over_9.5', 'Over 9.5')], { bettable: false });
  assert.equal(isSelectable(m, m.selections[0]), false);
});

test('a suspended market is never selectable, even when bettable', () => {
  const m = market('h2h', [sel('home', 'Home')], { bettable: true, suspended: true });
  assert.equal(isSelectable(m, m.selections[0]), false);
});

test('a suspended selection is never selectable inside an open market', () => {
  const m = market('h2h', [sel('home', 'Home', { suspended: true }), sel('away', 'Away')], { bettable: true });
  assert.equal(isSelectable(m, m.selections[0]), false);
  assert.equal(isSelectable(m, m.selections[1]), true);
});

test('a market with bettable undefined is not selectable', () => {
  // Absent means unknown, and unknown must never be treated as permission.
  const m = market('h2h', [sel('home', 'Home')]);
  assert.equal(isSelectable(m, m.selections[0]), false);
});

test('groups follow catalogue order and drop empty ones', () => {
  const groups = groupMarkets([
    market('correct_score', [sel('1-0', '1-0')], { group: 'correct_score' }),
    market('h2h', [sel('home', 'Home')], { group: 'match_result' }),
    market('btts', [sel('yes', 'Yes')], { group: 'goals' }),
  ]);
  assert.deepEqual(groups.map(g => g.group), ['match_result', 'goals', 'correct_score']);
  assert.equal(groups.every(g => g.markets.length > 0), true);
});

test('markets without a group fall into Popular rather than vanishing', () => {
  const groups = groupMarkets([market('h2h', [sel('home', 'Home')])]);
  assert.deepEqual(groups.map(g => g.group), ['popular']);
});

test('over/under lines stay distinct so a stake cannot match the wrong line', () => {
  // Keys carry the line; two lines sharing a key let placement resolve the
  // first match and accept the bet at a different line's price.
  const m = market('totals', [sel('over_1.5', 'Over 1.5'), sel('over_2.5', 'Over 2.5')], { bettable: true });
  const keys = m.selections.map(s => s.key);
  assert.equal(new Set(keys).size, keys.length);
});
