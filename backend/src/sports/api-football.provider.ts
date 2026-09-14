import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { RedisService } from '../common/redis.service';
import { ApiFootballClient, ApiFootballQuota } from './api-football.client';
import { apiFootballConfig } from './api-football.config';
import { BoardEvent, EventOdds, LiveState, Market, ProviderStatus, Selection, Sport, SportsBoard, SportsEvent, SportsProvider } from './domain';
import { LIVE_BET_MARKETS, PREMATCH_BET_MARKETS, RawValue, normalizeSelection } from './api-football.markets';
import { isBettableMarket, marketDefinition, marketGroupOf } from './markets';
import { PROVIDER_API_FOOTBALL, toInternalEventId } from './provider-identity';
import { SportsError } from './provider.errors';
import {
  CANCELLED_STATUSES, FINISHED_STATUSES, FixtureEntry, IN_PLAY_STATUSES, LiveOddsEntry, PrematchOddsEntry,
  fixtureEntry, liveOddsEntry, prematchOddsEntry, referenceEntry,
} from './api-football.schemas';

/** API-Football serves soccer only, so one sport key fronts the whole provider. */
export const API_FOOTBALL_SPORT_KEY = 'soccer';

const parseAll = <T>(schema: z.ZodType<T>, rows: unknown[]): T[] => {
  const out: T[] = [];
  // One malformed row must not discard a whole board: parse per row and skip
  // what does not fit, rather than failing the request outright.
  for (const row of rows) { const parsed = schema.safeParse(row); if (parsed.success) out.push(parsed.data); }
  return out;
};

@Injectable()
export class ApiFootballProvider implements SportsProvider {
  private readonly logger = new Logger(ApiFootballProvider.name);
  private readonly config = apiFootballConfig();
  private readonly client = new ApiFootballClient();
  private status: ProviderStatus = { provider: PROVIDER_API_FOOTBALL, configured: this.client.configured };
  private quota: ApiFootballQuota = {};

  constructor(private readonly cache: RedisService) {}

  getStatus(): ProviderStatus {
    return { ...this.status, configured: this.client.configured, remainingQuota: this.quota.remainingDay };
  }

  /** Quota headers, surfaced for the admin panel (§12). Never includes the key. */
  getQuota(): ApiFootballQuota { return { ...this.quota }; }

  private async call(path: string) {
    try {
      const { body, quota } = await this.client.get(path);
      this.quota = quota;
      this.status = { ...this.status, lastSuccessAt: new Date().toISOString(), remainingQuota: quota.remainingDay };
      return body.response ?? [];
    } catch (error) {
      const code = error instanceof SportsError ? error.code : 'SPORTS_PROVIDER_UNAVAILABLE';
      this.status = { ...this.status, lastFailureAt: new Date().toISOString(), lastErrorCode: code };
      throw error;
    }
  }

  // --- Reference data. Changes rarely, so it is cached for a day (§9). ---

  private reference(name: string, path: string) {
    return this.cache.cached(`af:v1:ref:${name}`, this.config.ttl.reference, async () => parseAll(referenceEntry, await this.call(path)));
  }
  getBookmakers() { return this.reference('bookmakers', '/odds/bookmakers'); }
  getBetTypes() { return this.reference('bets', '/odds/bets'); }
  getLiveBetTypes() { return this.reference('live-bets', '/odds/live/bets'); }

  async getSports(): Promise<Sport[]> {
    return [{ key: API_FOOTBALL_SPORT_KEY, name: 'Football', active: true, group: 'Soccer' }];
  }

  // --- Fixtures. The only endpoint carrying team names. ---

  /**
   * Fixtures for a day, keyed by fixture id. Live odds return team *ids* only,
   * so this is the join that gives live events real names rather than numbers.
   */
  private fixturesByDate(date: string) {
    return this.cache.cached(`af:v1:fixtures:${date}`, this.config.ttl.prematch, async () =>
      parseAll(fixtureEntry, await this.call(`/fixtures?date=${encodeURIComponent(date)}`)));
  }

  private toEvent(fixture: FixtureEntry): SportsEvent {
    const short = fixture.fixture.status.short;
    return {
      provider: PROVIDER_API_FOOTBALL,
      providerEventId: String(fixture.fixture.id),
      internalEventId: toInternalEventId(PROVIDER_API_FOOTBALL, String(fixture.fixture.id)),
      sportKey: API_FOOTBALL_SPORT_KEY,
      sportName: 'Football',
      competitionName: fixture.league.name,
      homeTeam: fixture.teams.home.name,
      awayTeam: fixture.teams.away.name,
      startTime: fixture.fixture.date,
      // Anything not clearly pre-kickoff is reported as started, which keeps
      // the placement path's "event already began" guard on the safe side.
      status: IN_PLAY_STATUSES.has(short) || FINISHED_STATUSES.has(short) || CANCELLED_STATUSES.has(short) ? 'STARTED_UNKNOWN' : 'UPCOMING',
    };
  }

  async getEvents(): Promise<SportsEvent[]> {
    const today = new Date().toISOString().slice(0, 10);
    return (await this.fixturesByDate(today)).map(fixture => this.toEvent(fixture));
  }

  // --- Market normalization, shared by pre-match and live. ---

  /**
   * Turn one provider bet into a normalized Market.
   *
   * `bettable` is read from our own catalogue, never from the provider, and a
   * market whose selections all fail normalization is dropped rather than shown
   * empty. A bet id absent from the mapping table is skipped entirely, so a
   * provider adding market types cannot surface unvetted keys.
   */
  private toMarket(marketKey: string, providerName: string, values: RawValue[], fixtureSuspended: boolean): Market | undefined {
    const selections: Selection[] = [];
    for (const value of values) {
      const selection = normalizeSelection(marketKey, value);
      if (selection) selections.push(selection);
    }
    if (!selections.length) return undefined;
    const definition = marketDefinition(marketKey);
    const suspended = fixtureSuspended || selections.every(selection => selection.suspended === true);
    return {
      key: marketKey,
      name: definition?.name ?? providerName,
      group: marketGroupOf(marketKey),
      selections,
      bettable: isBettableMarket(marketKey) && !suspended,
      ...(suspended ? { suspended: true } : {}),
      ...(definition?.settleable === false ? { unavailableReason: definition.unsettleableReason } : {}),
    };
  }

  private prematchMarkets(entry: PrematchOddsEntry) {
    const preferred = this.config.bookmakerIds.length
      ? entry.bookmakers.find(bookmaker => this.config.bookmakerIds.includes(bookmaker.id))
      : undefined;
    // One bookmaker's book is normalized whole. Prices are never mixed across
    // bookmakers, so every market on an event comes from one consistent source.
    const bookmaker = preferred ?? entry.bookmakers[0];
    if (!bookmaker) return { bookmaker: null, markets: [] as Market[] };
    const markets: Market[] = [];
    for (const bet of bookmaker.bets) {
      const marketKey = PREMATCH_BET_MARKETS[bet.id];
      if (!marketKey) continue;
      const market = this.toMarket(marketKey, bet.name, bet.values, false);
      if (market) markets.push(market);
    }
    return { bookmaker: { key: String(bookmaker.id), name: bookmaker.name }, markets };
  }

  private liveMarkets(entry: LiveOddsEntry) {
    // `blocked` or `stopped` suspends the entire fixture's book (§8).
    const fixtureSuspended = entry.status.blocked || entry.status.stopped;
    const markets: Market[] = [];
    for (const odd of entry.odds) {
      const marketKey = LIVE_BET_MARKETS[odd.id];
      if (!marketKey) continue;
      const market = this.toMarket(marketKey, odd.name, odd.values, fixtureSuspended);
      if (market) markets.push(market);
    }
    return markets;
  }

  private liveState(entry: LiveOddsEntry): LiveState {
    return {
      status: entry.fixture.status.long,
      ...(entry.fixture.status.elapsed === null || entry.fixture.status.elapsed === undefined ? {} : { minute: entry.fixture.status.elapsed }),
      ...(entry.teams?.home.goals === null || entry.teams?.home.goals === undefined ? {} : { homeScore: entry.teams.home.goals }),
      ...(entry.teams?.away.goals === null || entry.teams?.away.goals === undefined ? {} : { awayScore: entry.teams.away.goals }),
    };
  }

  // --- Public odds surfaces. ---

  private prematchOddsByDate(date: string) {
    return this.cache.cached(`af:v1:odds:${date}`, this.config.ttl.prematch, async () =>
      parseAll(prematchOddsEntry, await this.call(`/odds?date=${encodeURIComponent(date)}`)));
  }

  /** Live odds for everything in play. Short TTL, and only while games run (§9). */
  private liveOdds() {
    return this.cache.cached('af:v1:odds:live', this.config.ttl.live, async () =>
      parseAll(liveOddsEntry, await this.call('/odds/live')));
  }

  async getBoard(): Promise<SportsBoard> {
    const today = new Date().toISOString().slice(0, 10);
    const [fixtures, odds] = await Promise.all([this.fixturesByDate(today), this.prematchOddsByDate(today)]);
    const oddsByFixture = new Map(odds.map(entry => [entry.fixture.id, entry]));
    const fetchedAt = new Date();
    const events: BoardEvent[] = fixtures.map(fixture => {
      const entry = oddsByFixture.get(fixture.fixture.id);
      const normalized = entry ? this.prematchMarkets(entry) : { bookmaker: null, markets: [] as Market[] };
      return { event: this.toEvent(fixture), bookmaker: normalized.bookmaker, markets: normalized.markets };
    });
    return {
      sportKey: API_FOOTBALL_SPORT_KEY,
      sportName: 'Football',
      fetchedAt: fetchedAt.toISOString(),
      staleAt: new Date(fetchedAt.getTime() + this.config.ttl.prematch * 1000).toISOString(),
      events,
    };
  }

  async getEventOdds(_sportKey: string, providerEventId: string): Promise<EventOdds> {
    const fixtureId = Number(providerEventId);
    if (!Number.isInteger(fixtureId)) throw new SportsError('SPORTS_EVENT_NOT_FOUND', 404, 'Sports event not found.');
    const today = new Date().toISOString().slice(0, 10);
    const [fixtures, live] = await Promise.all([this.fixturesByDate(today), this.liveOdds().catch(() => [] as LiveOddsEntry[])]);
    const fixture = fixtures.find(row => row.fixture.id === fixtureId);
    if (!fixture) throw new SportsError('SPORTS_EVENT_NOT_FOUND', 404, 'Sports event not found.');

    const liveEntry = live.find(row => row.fixture.id === fixtureId);
    const fetchedAt = new Date();
    // A fixture that is in play is priced from the live book; the pre-match book
    // for a running game is stale by definition and must not be staked against.
    if (liveEntry) {
      const markets = this.liveMarkets(liveEntry);
      return {
        event: this.toEvent(fixture),
        bookmaker: { key: PROVIDER_API_FOOTBALL, name: 'API-Football' },
        markets,
        marketCount: liveEntry.odds.length,
        live: this.liveState(liveEntry),
        fetchedAt: fetchedAt.toISOString(),
        staleAt: new Date(fetchedAt.getTime() + this.config.ttl.live * 1000).toISOString(),
      };
    }

    const odds = await this.cache.cached(`af:v1:odds:fixture:${fixtureId}`, this.config.ttl.prematch, async () =>
      parseAll(prematchOddsEntry, await this.call(`/odds?fixture=${fixtureId}`)));
    const entry = odds[0];
    const normalized = entry ? this.prematchMarkets(entry) : { bookmaker: null, markets: [] as Market[] };
    // The real count of markets the provider offered, before our mapping
    // narrowed it — the board's "+N Markets" must never be invented (§7).
    const providerMarketCount = entry ? entry.bookmakers.reduce((max, book) => Math.max(max, book.bets.length), 0) : 0;
    return {
      event: this.toEvent(fixture),
      bookmaker: normalized.bookmaker ?? { key: PROVIDER_API_FOOTBALL, name: 'API-Football' },
      markets: normalized.markets,
      marketCount: providerMarketCount,
      fetchedAt: fetchedAt.toISOString(),
      staleAt: new Date(fetchedAt.getTime() + this.config.ttl.prematch * 1000).toISOString(),
    };
  }

  /** Internal ids for this provider's events, namespaced to avoid collisions (§10). */
  internalEventId(providerEventId: string) { return toInternalEventId(PROVIDER_API_FOOTBALL, providerEventId); }
}
