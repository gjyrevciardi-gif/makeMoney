import { SportsProviderRouter } from '../src/sports/sports-provider.router';
import { ApiFootballProvider, API_FOOTBALL_SPORT_KEY } from '../src/sports/api-football.provider';
import { TheOddsApiProvider } from '../src/sports/the-odds-api.provider';
import { SportsError } from '../src/sports/provider.errors';
import { PROVIDER_API_FOOTBALL, PROVIDER_THE_ODDS_API } from '../src/sports/provider-identity';
import { ProviderStatus, Sport, SportsBoard } from '../src/sports/domain';

/**
 * Routing is exercised against fake providers: no network, no quota, and the
 * failure modes (plan refusal, outage) can be provoked deterministically.
 */
const board = (sportKey: string, provider: string): SportsBoard => ({
  sportKey, sportName: sportKey, fetchedAt: new Date().toISOString(), staleAt: new Date(Date.now() + 60_000).toISOString(),
  events: [{ event: { provider, providerEventId: '1', sportKey, sportName: sportKey, homeTeam: 'H', awayTeam: 'A', startTime: new Date().toISOString(), status: 'UPCOMING' }, bookmaker: null, markets: [] }],
});

type Fakes = { footballBoard?: () => Promise<SportsBoard>; oddsBoard?: (key: string) => Promise<SportsBoard>; oddsSports?: Sport[]; configured?: boolean; footballOdds?: () => Promise<unknown>; oddsOdds?: () => Promise<unknown> };

function makeRouter(fakes: Fakes) {
  const configured = fakes.configured ?? true;
  const football = {
    getSports: async (): Promise<Sport[]> => [{ key: API_FOOTBALL_SPORT_KEY, name: 'Football', active: true, group: 'Soccer' }],
    getBoard: fakes.footballBoard ?? (async () => board(API_FOOTBALL_SPORT_KEY, PROVIDER_API_FOOTBALL)),
    getEventOdds: fakes.footballOdds ?? (async () => ({ from: PROVIDER_API_FOOTBALL })),
    getStatus: (): ProviderStatus => ({ provider: PROVIDER_API_FOOTBALL, configured, remainingQuota: 92 }),
  } as unknown as ApiFootballProvider;
  const odds = {
    getSports: async (): Promise<Sport[]> => fakes.oddsSports ?? [{ key: 'soccer_epl', name: 'EPL', active: true }, { key: 'basketball_nba', name: 'NBA', active: true }],
    getBoard: fakes.oddsBoard ?? (async (key: string) => board(key, PROVIDER_THE_ODDS_API)),
    getEventOdds: fakes.oddsOdds ?? (async () => ({ from: PROVIDER_THE_ODDS_API })),
    getStatus: (): ProviderStatus => ({ provider: PROVIDER_THE_ODDS_API, configured: true, remainingQuota: 400 }),
  } as unknown as TheOddsApiProvider;
  return new SportsProviderRouter(odds, football);
}

describe('provider registration and routing', () => {
  it('lists both providers\' sports without either replacing the other', async () => {
    const keys = (await makeRouter({}).getSports()).map(sport => sport.key);
    expect(keys).toContain(API_FOOTBALL_SPORT_KEY);
    expect(keys).toContain('soccer_epl');
    expect(keys).toContain('basketball_nba');
  });

  it('routes soccer to API-Football', async () => {
    const result = await makeRouter({}).getBoard(API_FOOTBALL_SPORT_KEY);
    expect(result.events[0].event.provider).toBe(PROVIDER_API_FOOTBALL);
  });

  it('leaves non-soccer on The Odds API', async () => {
    const result = await makeRouter({}).getBoard('basketball_nba');
    expect(result.events[0].event.provider).toBe(PROVIDER_THE_ODDS_API);
  });

  it('keeps existing soccer_* keys on The Odds API, unchanged', async () => {
    const result = await makeRouter({}).getBoard('soccer_epl');
    expect(result.events[0].event.provider).toBe(PROVIDER_THE_ODDS_API);
  });

  it('falls back to The Odds API when the free plan refuses a season', async () => {
    // A plan restriction must read as a fallback, not a platform outage (§3).
    const router = makeRouter({ footballBoard: async () => { throw new SportsError('SPORTS_PROVIDER_UNAUTHORIZED', 503); } });
    const result = await router.getBoard(API_FOOTBALL_SPORT_KEY);
    expect(result.events[0].event.provider).toBe(PROVIDER_THE_ODDS_API);
  });

  it('records the access limitation for admin diagnostics', async () => {
    const router = makeRouter({ footballBoard: async () => { throw new SportsError('SPORTS_PROVIDER_UNAUTHORIZED', 503); } });
    await router.getBoard(API_FOOTBALL_SPORT_KEY);
    const football = router.getStatuses().find(status => status.provider === PROVIDER_API_FOOTBALL)!;
    expect(football.lastErrorCode).toBe('SPORTS_PROVIDER_UNAUTHORIZED');
    expect(football.lastFailureAt).toBeTruthy();
  });

  it('reports honestly when neither provider can serve soccer', async () => {
    const router = makeRouter({
      footballBoard: async () => { throw new SportsError('SPORTS_PROVIDER_UNAUTHORIZED', 503); },
      oddsSports: [{ key: 'basketball_nba', name: 'NBA', active: true }],
    });
    await expect(router.getBoard(API_FOOTBALL_SPORT_KEY)).rejects.toBeInstanceOf(SportsError);
  });

  it('keeps soccer on The Odds API when API-Football has no key', async () => {
    const router = makeRouter({ configured: false });
    const keys = (await router.getSports()).map(sport => sport.key);
    expect(keys).not.toContain(API_FOOTBALL_SPORT_KEY);
  });

  it('routes an odds lookup by the id\'s own provenance, not the sport key', async () => {
    const router = makeRouter({});
    await expect(router.getEventOdds('soccer', 'af_1581901')).resolves.toEqual({ from: PROVIDER_API_FOOTBALL });
    // An unprefixed id is The Odds API's by definition, so existing stored bet
    // legs keep resolving to the provider that priced them.
    await expect(router.getEventOdds('soccer_epl', 'e912304de2b2ce4a1e5e5b1a4b0a1f2c')).resolves.toEqual({ from: PROVIDER_THE_ODDS_API });
  });

  it('exposes both provider statuses and no credential material', () => {
    const statuses = makeRouter({}).getStatuses();
    expect(statuses.map(status => status.provider).sort()).toEqual([PROVIDER_API_FOOTBALL, PROVIDER_THE_ODDS_API].sort());
    const serialized = JSON.stringify(statuses);
    expect(serialized).not.toMatch(/apiKey|api_key|x-apisports-key|secret|token/i);
  });
});
