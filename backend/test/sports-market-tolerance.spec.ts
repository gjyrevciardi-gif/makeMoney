import { z } from 'zod';
import { eventSchema, isSupportedMarketKey, SUPPORTED_MARKET_KEYS } from '../src/sports/the-odds-api.schemas';
import { TheOddsApiProvider } from '../src/sports/the-odds-api.provider';
import type { OperationsHealthService } from '../src/operations/operations-health.service';

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

/**
 * Accepting `h2h_lay` in the schema is only half the fix. The other half is the
 * provider dropping it again before it reaches the board — the point at which an
 * unsupported market would otherwise leak into the betting UI under a name this
 * product does not price. These exercise that normalization directly.
 */
describe('The Odds API board normalization', () => {
  const health = () => ({
    providerSuccess: jest.fn().mockResolvedValue(undefined),
    providerFailure: jest.fn().mockResolvedValue(undefined),
  }) as unknown as OperationsHealthService;
  const provider = () => new TheOddsApiProvider(health());
  const respond = (body: unknown) =>
    (fetch as jest.Mock).mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

  beforeEach(() => { process.env.THE_ODDS_API_KEY = 'test-key-never-logged'; global.fetch = jest.fn(); });
  afterEach(() => { delete process.env.THE_ODDS_API_KEY; jest.restoreAllMocks(); });

  it('drops the exchange lay market from the board it builds', async () => {
    respond(boardWithExchangeLay);
    const board = await provider().getBoard('soccer_austria_bundesliga');
    expect(board.events).toHaveLength(1);
    expect(board.events[0].markets.map((market) => market.key)).toEqual(['h2h']);
    expect(board.events[0].markets[0].name).toBe('Match Winner');
  });

  it('never lets an unsupported market reach a selection key', async () => {
    respond(boardWithExchangeLay);
    const board = await provider().getBoard('soccer_austria_bundesliga');
    const keys = board.events.flatMap((row) => row.markets.flatMap((m) => m.selections.map((s) => s.key)));
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.some((key) => key.startsWith('h2h_lay'))).toBe(false);
  });

  it('skips a bookmaker quoting only unsupported markets', async () => {
    // Bookmaker choice falls back to the lowest key, so this exchange would have
    // won the pick and rendered a fixture with no prices at all.
    respond([{
      ...boardWithExchangeLay[0],
      bookmakers: [
        { key: 'aaa_exchange', title: 'AAA', markets: [{ key: 'h2h_lay', outcomes: [{ name: 'SK Rapid Wien', price: 2.46 }] }] },
        { key: 'zzz_book', title: 'ZZZ', markets: [{ key: 'h2h', outcomes: [{ name: 'SK Rapid Wien', price: 2.4 }] }] },
      ],
    }]);
    const board = await provider().getBoard('soccer_austria_bundesliga');
    expect(board.events[0].bookmaker?.key).toBe('zzz_book');
    expect(board.events[0].markets.map((market) => market.key)).toEqual(['h2h']);
  });

  it('still lists a fixture whose only bookmaker is unusable, with no prices', async () => {
    respond([{
      ...boardWithExchangeLay[0],
      bookmakers: [{ key: 'only_lay', title: 'Only Lay', markets: [{ key: 'h2h_lay', outcomes: [{ name: 'SK Rapid Wien', price: 2.46 }] }] }],
    }]);
    const board = await provider().getBoard('soccer_austria_bundesliga');
    expect(board.events).toHaveLength(1);
    expect(board.events[0].bookmaker).toBeNull();
    expect(board.events[0].markets).toEqual([]);
  });

  it('returns an empty board for a competition with no fixtures instead of failing', async () => {
    respond([]);
    const board = await provider().getBoard('soccer_austria_bundesliga');
    expect(board.events).toEqual([]);
    expect(board.sportKey).toBe('soccer_austria_bundesliga');
  });
});
