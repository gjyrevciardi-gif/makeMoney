import { z } from 'zod';
import { eventSchema, isSupportedMarketKey, SUPPORTED_MARKET_KEYS } from '../src/sports/the-odds-api.schemas';

/**
 * A real board payload, trimmed to the shape that used to break it.
 *
 * The exchange bookmaker quotes `h2h_lay` alongside `h2h`. Requesting only
 * h2h/spreads/totals does not stop the provider returning it, and an enum on
 * the market key rejected the entire array — taking a whole competition offline
 * because one listing had a lay price.
 */
const boardWithExchangeLay = [
  {
    id: 'evt-1',
    sport_key: 'soccer_austria_bundesliga',
    sport_title: 'Austrian Football Bundesliga',
    commence_time: '2026-09-12T16:30:00Z',
    home_team: 'SK Rapid Wien',
    away_team: 'SK Sturm Graz',
    bookmakers: [
      {
        key: 'betfair_ex_eu',
        title: 'Betfair',
        markets: [
          { key: 'h2h', outcomes: [{ name: 'SK Rapid Wien', price: 2.4 }, { name: 'SK Sturm Graz', price: 3.1 }] },
          { key: 'h2h_lay', outcomes: [{ name: 'SK Rapid Wien', price: 2.46 }, { name: 'SK Sturm Graz', price: 3.2 }] },
        ],
      },
    ],
  },
];

describe('The Odds API board parsing', () => {
  it('accepts a payload containing an unrequested exchange market', () => {
    const parsed = z.array(eventSchema).safeParse(boardWithExchangeLay);
    expect(parsed.success).toBe(true);
  });

  it('still exposes the supported market from that payload', () => {
    const parsed = z.array(eventSchema).parse(boardWithExchangeLay);
    const keys = parsed[0].bookmakers![0].markets.map((market) => market.key);
    expect(keys).toContain('h2h');
    expect(keys).toContain('h2h_lay');
    expect(keys.filter(isSupportedMarketKey)).toEqual(['h2h']);
  });

  it('recognises exactly the three markets this product prices', () => {
    expect([...SUPPORTED_MARKET_KEYS]).toEqual(['h2h', 'spreads', 'totals']);
    for (const key of ['h2h_lay', 'outrights', 'btts', 'draw_no_bet']) {
      expect(isSupportedMarketKey(key)).toBe(false);
    }
  });

  it('accepts a market that arrives with no outcomes rather than failing the board', () => {
    // A suspended market can come back empty. Dropping it is correct; rejecting
    // the whole competition is not.
    const payload = [{
      ...boardWithExchangeLay[0],
      bookmakers: [{ key: 'x', title: 'X', markets: [{ key: 'totals', outcomes: [] }] }],
    }];
    expect(z.array(eventSchema).safeParse(payload).success).toBe(true);
  });

  it('still rejects a genuinely malformed event', () => {
    const missingTeams = [{ ...boardWithExchangeLay[0], home_team: '' }];
    expect(z.array(eventSchema).safeParse(missingTeams).success).toBe(false);

    const badPrice = [{
      ...boardWithExchangeLay[0],
      bookmakers: [{ key: 'x', title: 'X', markets: [{ key: 'h2h', outcomes: [{ name: 'A', price: -1 }] }] }],
    }];
    expect(z.array(eventSchema).safeParse(badPrice).success).toBe(false);
  });

  it('accepts an empty board, which is a competition with no fixtures rather than a failure', () => {
    const parsed = z.array(eventSchema).safeParse([]);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual([]);
  });
});
