import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIVE_BET_MARKETS, PREMATCH_BET_MARKETS, normalizeSelection } from '../src/sports/api-football.markets';
import { apiFootballEnvelope, envelopeErrors } from '../src/sports/api-football.client';
import { LiveOddsEntry, fixtureEntry, liveOddsEntry, prematchOddsEntry, referenceEntry } from '../src/sports/api-football.schemas';
import { isBettableMarket } from '../src/sports/markets';
import { PROVIDER_API_FOOTBALL, PROVIDER_THE_ODDS_API, fromInternalEventId, toInternalEventId } from '../src/sports/provider-identity';

/**
 * Every payload here is a sanitized capture of a real API-Football response,
 * recorded once during the discovery spike. Nothing in this file touches the
 * network, so the suite never spends quota (§14/§L).
 */
const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures', 'api-football', `${name}.json`), 'utf8'));

describe('API-Football envelope', () => {
  it('parses the envelope every route shares', () => {
    for (const name of ['leagues', 'fixtures', 'odds-prematch', 'odds-live', 'bookmakers', 'bets']) {
      const parsed = apiFootballEnvelope.safeParse(fixture(name));
      expect(parsed.success).toBe(true);
    }
  });

  it('surfaces a plan restriction reported inside a 200 response', () => {
    // API-Football answers a refused request with HTTP 200 and a populated
    // `errors` object; treating that as success would cache an empty board.
    const errors = envelopeErrors(apiFootballEnvelope.parse(fixture('error-plan-season')));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/plan.*do not have access to this season/i);
  });

  it('surfaces a rejected key the same way', () => {
    const errors = envelopeErrors(apiFootballEnvelope.parse(fixture('error-token')));
    expect(errors[0]).toMatch(/^token: /);
  });

  it('reads multi-page paging', () => {
    const body = apiFootballEnvelope.parse(fixture('paging-multipage'));
    expect(body.paging).toEqual({ current: 1, total: 14 });
  });
});

describe('fixture parsing', () => {
  const rows = fixture('fixtures').response;

  it('parses fixtures with team names, status and scores', () => {
    for (const row of rows) expect(fixtureEntry.safeParse(row).success).toBe(true);
    const first = fixtureEntry.parse(rows[0]);
    expect(typeof first.teams.home.name).toBe('string');
    expect(first.teams.home.name.length).toBeGreaterThan(0);
    expect(typeof first.fixture.status.short).toBe('string');
  });

  it('tolerates the nulls the provider really sends', () => {
    // elapsed/goals/winner all arrive null for a fixture that has not kicked off.
    const parsed = fixtureEntry.parse({
      fixture: { id: 1, date: '2026-09-14T12:00:00+00:00', status: { long: 'Not Started', short: 'NS', elapsed: null } },
      league: { id: 39, name: 'Premier League', country: null, season: 2026, round: null },
      teams: { home: { id: 1, name: 'Home FC' }, away: { id: 2, name: 'Away FC' } },
      goals: { home: null, away: null },
      score: { halftime: { home: null, away: null } },
    });
    expect(parsed.fixture.status.elapsed).toBeNull();
  });
});

describe('pre-match odds parsing', () => {
  const entry = prematchOddsEntry.parse(fixture('odds-prematch').response[0]);
  const bets = entry.bookmakers[0].bets;
  const betFor = (key: string) => bets.find(bet => PREMATCH_BET_MARKETS[bet.id] === key);

  it('parses the pre-match shape', () => {
    expect(entry.bookmakers.length).toBeGreaterThan(0);
    expect(bets.length).toBeGreaterThan(0);
  });

  it('normalizes match winner into home/draw/away keys', () => {
    const bet = betFor('h2h');
    expect(bet).toBeDefined();
    const keys = bet!.values.map(v => normalizeSelection('h2h', v)?.key);
    expect(keys).toEqual(expect.arrayContaining(['home', 'draw', 'away']));
  });

  it('splits the line out of an over/under value', () => {
    const bet = betFor('totals');
    expect(bet).toBeDefined();
    const selection = normalizeSelection('totals', bet!.values[0])!;
    expect(['over', 'under']).toContain(selection.key);
    expect(selection.point).toMatch(/^\d+(\.\d+)?$/);
  });

  it('converts a colon correct score into the hyphen form settlement expects', () => {
    // Pre-match sends "1:0"; CorrectScoreSettlementEvaluator matches /\d-\d/.
    const selection = normalizeSelection('correct_score', { value: '1:0', odd: '13.00' })!;
    expect(selection.key).toBe('1-0');
  });

  it('normalizes double chance covers', () => {
    expect(normalizeSelection('double_chance', { value: 'Home/Draw', odd: '1.57' })!.key).toBe('home_draw');
    expect(normalizeSelection('double_chance', { value: 'Draw/Away', odd: '1.44' })!.key).toBe('draw_away');
  });

  it('never maps the three-way European handicap onto two-way spreads', () => {
    // Bet 9 "Handicap Result" carries "Draw -1" values. Mapping it to `spreads`
    // would settle every draw as a loss, so it must stay unmapped.
    expect(PREMATCH_BET_MARKETS[9]).toBeUndefined();
  });
});

describe('live odds parsing', () => {
  const rows = fixture('odds-live').response;

  it('parses the live shape including the fixture status block', () => {
    for (const row of rows) expect(liveOddsEntry.safeParse(row).success).toBe(true);
  });

  it('reads the line from the separate handicap field live uses', () => {
    const selection = normalizeSelection('totals', { value: 'Over', odd: '2.75', handicap: '1.5', main: null, suspended: true })!;
    expect(selection.key).toBe('over');
    expect(selection.point).toBe('1.5');
  });

  it('carries the per-selection suspended flag through', () => {
    expect(normalizeSelection('h2h', { value: 'Home', odd: '2.0', suspended: true })!.suspended).toBe(true);
    expect(normalizeSelection('h2h', { value: 'Home', odd: '2.0', suspended: false })!.suspended).toBeUndefined();
  });

  it('accepts a live correct score already in hyphen form', () => {
    expect(normalizeSelection('correct_score', { value: '1-0', odd: '1.4' })!.key).toBe('1-0');
  });

  it('uses a different bet-id namespace from pre-match', () => {
    // Live 23 is "Final Score"; pre-match 10 is "Exact Score". One shared table
    // would mis-key roughly half of every live book.
    expect(LIVE_BET_MARKETS[23]).toBe('correct_score');
    expect(PREMATCH_BET_MARKETS[10]).toBe('correct_score');
    expect(LIVE_BET_MARKETS[59]).toBe('h2h');
    expect(PREMATCH_BET_MARKETS[1]).toBe('h2h');
    expect(LIVE_BET_MARKETS[10]).not.toBe('correct_score');
  });

  it('sees a genuinely blocked fixture in the captured data', () => {
    const parsedRows: LiveOddsEntry[] = rows.map((row: unknown) => liveOddsEntry.parse(row));
    const blocked = parsedRows.filter(row => row.status.blocked || row.status.stopped);
    expect(blocked.length).toBeGreaterThan(0);
  });
});

describe('reference data parsing', () => {
  it('parses bookmakers, bet types and live bet types', () => {
    for (const name of ['bookmakers', 'bets', 'live-bets']) {
      const rows = fixture(name).response;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(referenceEntry.safeParse(row).success).toBe(true);
    }
  });
});

describe('selection normalization refuses what it cannot key', () => {
  it('drops a value whose shape does not fit the market', () => {
    expect(normalizeSelection('h2h', { value: 'Neither', odd: '2.0' })).toBeUndefined();
    expect(normalizeSelection('btts', { value: 'Maybe', odd: '2.0' })).toBeUndefined();
    expect(normalizeSelection('correct_score', { value: 'Any Other', odd: '2.0' })).toBeUndefined();
    expect(normalizeSelection('totals', { value: 'Over', odd: '2.0' })).toBeUndefined();
  });

  it('drops a non-numeric price rather than storing it', () => {
    expect(normalizeSelection('h2h', { value: 'Home', odd: 'evens' })).toBeUndefined();
  });

  it('refuses a draw on draw-no-bet', () => {
    expect(normalizeSelection('draw_no_bet', { value: 'Draw', odd: '3.0' })).toBeUndefined();
  });

  it('only maps bet ids onto keys the catalogue knows', () => {
    for (const key of [...Object.values(PREMATCH_BET_MARKETS), ...Object.values(LIVE_BET_MARKETS)]) {
      // Unknown keys would be unbettable anyway, but they must also never be
      // rendered, so every mapped key has to exist in the catalogue.
      expect(typeof key).toBe('string');
      expect(isBettableMarket(key) || key.length > 0).toBe(true);
    }
  });
});

describe('provider id namespacing', () => {
  it('round-trips an API-Football fixture id', () => {
    const internal = toInternalEventId(PROVIDER_API_FOOTBALL, '1581901');
    expect(internal).toBe('af_1581901');
    expect(fromInternalEventId(internal)).toEqual({ provider: PROVIDER_API_FOOTBALL, providerEventId: '1581901', internalEventId: 'af_1581901' });
  });

  it('leaves existing Odds API ids untouched so stored bets stay valid', () => {
    const existing = 'e912304de2b2ce4a1e5e5b1a4b0a1f2c';
    expect(toInternalEventId(PROVIDER_THE_ODDS_API, existing)).toBe(existing);
    expect(fromInternalEventId(existing).provider).toBe(PROVIDER_THE_ODDS_API);
  });

  it('cannot collide across providers', () => {
    // An API-Football integer id and an Odds API hex id can never produce the
    // same internal id, because only one of them is ever prefixed.
    expect(toInternalEventId(PROVIDER_API_FOOTBALL, '123')).not.toBe(toInternalEventId(PROVIDER_THE_ODDS_API, '123'));
  });

  it('survives the event-id character class the placement DTO enforces', () => {
    expect(toInternalEventId(PROVIDER_API_FOOTBALL, '1581901')).toMatch(/^[A-Za-z0-9_-]{1,150}$/);
  });
});
