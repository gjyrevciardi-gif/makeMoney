import { SportsError } from '../src/sports/provider.errors';
import { TheOddsApiProvider } from '../src/sports/the-odds-api.provider';
import type { OperationsHealthService } from '../src/operations/operations-health.service';

/**
 * The provider records every call against operational health so an admin can
 * see why the sportsbook is failing. The recording itself is not under test
 * here, so it is stubbed rather than backed by Redis.
 */
const health = () => ({
  providerSuccess: jest.fn().mockResolvedValue(undefined),
  providerFailure: jest.fn().mockResolvedValue(undefined),
}) as unknown as OperationsHealthService;
const provider = () => new TheOddsApiProvider(health());
const event = { id: 'event-1', sport_key: 'soccer_epl', sport_title: 'Premier League', commence_time: '2099-01-01T12:00:00.000Z', home_team: 'Home', away_team: 'Away', bookmakers: [{ key: 'book-a', title: 'Book A', markets: [{ key: 'h2h', outcomes: [{ name: 'Home', price: 2.1 }, { name: 'Draw', price: 3.4 }, { name: 'Away', price: 3.1 }] }, { key: 'spreads', outcomes: [{ name: 'Home', price: 1.9, point: -1.5 }] }, { key: 'totals', outcomes: [{ name: 'Over', price: 1.8, point: 2.5 }] }] }] };
describe('TheOddsApiProvider', () => {
  beforeEach(() => { process.env.THE_ODDS_API_KEY = 'test-key-never-logged'; global.fetch = jest.fn(); });
  afterEach(() => { delete process.env.THE_ODDS_API_KEY; jest.restoreAllMocks(); });
  it('normalizes valid sports', async () => { (fetch as jest.Mock).mockResolvedValue(new Response(JSON.stringify([{ key: 'soccer_epl', title: 'Football', active: true }]), { status: 200 })); expect(await provider().getSports()).toEqual([{ key: 'soccer_epl', name: 'Football', active: true }]); });
  it('retains draw and normalizes h2h, spreads and totals as decimal strings', async () => { (fetch as jest.Mock).mockResolvedValue(new Response(JSON.stringify(event), { status: 200 })); const odds = await provider().getEventOdds('soccer_epl', 'event-1'); expect(odds.markets.map(x => x.key)).toEqual(['h2h', 'spreads', 'totals']); expect(odds.markets[0].selections.find(x => x.name === 'Draw')?.price).toBe('3.4'); expect(odds.markets[1].selections[0].point).toBe('-1.5'); });
  it('rejects malformed odds', async () => { (fetch as jest.Mock).mockResolvedValue(new Response(JSON.stringify({ ...event, id: '' }), { status: 200 })); await expect(provider().getEventOdds('soccer_epl', 'event-1')).rejects.toMatchObject({ code: 'SPORTS_PROVIDER_INVALID_RESPONSE' }); });
  // The body of an upstream error can echo the request, key included, so only a
  // classified code is ever surfaced.
  it.each([
    [401, 'SPORTS_PROVIDER_UNAUTHORIZED'],
    [403, 'SPORTS_PROVIDER_FORBIDDEN'],
    [422, 'SPORTS_PROVIDER_INVALID_REQUEST'],
    [429, 'SPORTS_PROVIDER_RATE_LIMITED'],
    [500, 'SPORTS_PROVIDER_UNAVAILABLE'],
  ])('maps provider %s safely', async (status, code) => { (fetch as jest.Mock).mockResolvedValue(new Response('secret provider error', { status: status as number })); await expect(provider().getSports()).rejects.toMatchObject({ code }); });
  it('reports an aborted request as a timeout, not a generic outage', async () => { (fetch as jest.Mock).mockRejectedValue(new DOMException('aborted', 'AbortError')); await expect(provider().getSports()).rejects.toMatchObject({ code: 'SPORTS_PROVIDER_TIMEOUT' }); });
  it('maps a network failure that is not an abort', async () => { (fetch as jest.Mock).mockRejectedValue(new TypeError('network down')); await expect(provider().getSports()).rejects.toMatchObject({ code: 'SPORTS_PROVIDER_UNAVAILABLE' }); });
  it('reports an unconfigured provider honestly', async () => { delete process.env.THE_ODDS_API_KEY; await expect(provider().getSports()).rejects.toMatchObject({ code: 'SPORTS_PROVIDER_NOT_CONFIGURED' }); });
});
