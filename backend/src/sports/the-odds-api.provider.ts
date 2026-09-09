import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { BoardEvent, EventOdds, Market, ProviderStatus, Sport, SportsBoard, SportsEvent, SportsProvider } from './domain';
import { sportsConfig } from './sports.config';
import { SportsError } from './provider.errors';
import { eventSchema, ProviderEvent, sportSchema } from './the-odds-api.schemas';

@Injectable()
export class TheOddsApiProvider implements SportsProvider {
  private readonly logger = new Logger(TheOddsApiProvider.name);
  private readonly config = sportsConfig();
  private status: ProviderStatus = { provider: 'the-odds-api', configured: Boolean(this.config.apiKey) };
  getStatus() { return { ...this.status }; }
  private url(path: string, params: Record<string, string> = {}) { const url = new URL(`${this.config.baseUrl}${path}`); for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value); url.searchParams.set('apiKey', this.config.apiKey!); return url; }
  private async request<T>(path: string, schema: z.ZodType<T>, params: Record<string, string> = {}): Promise<T> {
    if (!this.config.apiKey) throw new SportsError('SPORTS_PROVIDER_NOT_CONFIGURED', 503, 'Sports provider is not configured.');
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(this.url(path, params), { signal: controller.signal, headers: { accept: 'application/json' } });
      const remaining = response.headers.get('x-requests-remaining');
      if (!response.ok) {
        if (response.status === 429) throw new SportsError('SPORTS_PROVIDER_RATE_LIMITED', 503);
        if (response.status === 404) throw new SportsError('SPORTS_EVENT_NOT_FOUND', 404, 'Sports event not found.');
        throw new SportsError('SPORTS_PROVIDER_UNAVAILABLE', 503);
      }
      const parsed = schema.safeParse(await response.json());
      if (!parsed.success) throw new SportsError('SPORTS_PROVIDER_INVALID_RESPONSE', 503);
      this.status = { ...this.status, lastSuccessAt: new Date().toISOString(), remainingQuota: remaining === null ? undefined : Number(remaining) };
      this.logger.log({ event: 'SPORTS_PROVIDER_REQUEST_SUCCESS', path });
      return parsed.data;
    } catch (error) {
      this.status = { ...this.status, lastFailureAt: new Date().toISOString() };
      this.logger.warn({ event: 'SPORTS_PROVIDER_REQUEST_FAILED', path, code: error instanceof SportsError ? error.code : 'SPORTS_PROVIDER_UNAVAILABLE' });
      if (error instanceof SportsError) throw error;
      throw new SportsError('SPORTS_PROVIDER_UNAVAILABLE', 503);
    } finally { clearTimeout(timer); }
  }
  async getSports(): Promise<Sport[]> { const rows = await this.request('/sports', z.array(sportSchema)); return rows.filter(x => x.active).map(x => ({ key: x.key, name: x.title, active: x.active, ...(x.group === undefined ? {} : { group: x.group }) })); }
  // `sport_title` is the provider's own name for the competition ("EPL"). It is
  // carried through rather than invented so the UI can group by real leagues.
  private event(row: ProviderEvent): SportsEvent { return { provider: 'the-odds-api', providerEventId: row.id, sportKey: row.sport_key, sportName: row.sport_title, competitionName: row.sport_title, homeTeam: row.home_team, awayTeam: row.away_team, startTime: row.commence_time, status: new Date(row.commence_time) > new Date() ? 'UPCOMING' : 'STARTED_UNKNOWN' }; }
  private board(sportKey: string) { return this.request(`/sports/${encodeURIComponent(sportKey)}/odds`, z.array(eventSchema), { regions: 'eu', markets: 'h2h,spreads,totals', oddsFormat: 'decimal' }); }
  async getEvents(sportKey: string) { return (await this.board(sportKey)).map(x => this.event(x)); }
  /** Chooses the configured primary bookmaker, else the lowest key, deterministically. */
  private pick(row: ProviderEvent) { const available = row.bookmakers ?? []; return this.config.bookmakers.map(key => available.find(x => x.key === key)).find(Boolean) ?? [...available].sort((a, b) => a.key.localeCompare(b.key))[0]; }
  private markets(bookmaker: NonNullable<ProviderEvent['bookmakers']>[number]): Market[] {
    const names = { h2h: 'Match Winner', spreads: 'Handicap', totals: 'Total' } as const;
    return bookmaker.markets.map(m => ({ key: m.key, name: names[m.key], selections: m.outcomes.map((o, index) => ({ key: `${m.key}:${o.name}:${o.point ?? ''}:${index}`, name: o.name, price: o.price.toString(), ...(o.point === undefined ? {} : { point: o.point.toString() }) })) }));
  }
  /**
   * Events *and* their primary markets from the one upstream call the event
   * list already makes. An event whose bookmakers are missing is still listed,
   * with no markets, so the board never silently drops a fixture.
   */
  async getBoard(sportKey: string): Promise<SportsBoard> {
    const rows = await this.board(sportKey);
    const fetchedAt = new Date();
    const events: BoardEvent[] = rows.map(row => { const bookmaker = this.pick(row); return { event: this.event(row), bookmaker: bookmaker ? { key: bookmaker.key, name: bookmaker.title } : null, markets: bookmaker ? this.markets(bookmaker) : [] }; });
    return { sportKey, sportName: rows[0]?.sport_title ?? sportKey, fetchedAt: fetchedAt.toISOString(), staleAt: new Date(fetchedAt.getTime() + this.config.ttl.odds * 1000).toISOString(), events };
  }
  async getEventOdds(sportKey: string, eventId: string): Promise<EventOdds> {
    const row = await this.request(`/sports/${encodeURIComponent(sportKey)}/events/${encodeURIComponent(eventId)}/odds`, eventSchema, { regions: 'eu', markets: 'h2h,spreads,totals', oddsFormat: 'decimal' });
    const bookmaker = this.pick(row);
    if (!bookmaker) throw new SportsError('SPORTS_ODDS_UNAVAILABLE', 404, 'Odds are not available for this event.');
    const markets: Market[] = this.markets(bookmaker);
    const fetchedAt = new Date(); return { event: this.event(row), bookmaker: { key: bookmaker.key, name: bookmaker.title }, markets, fetchedAt: fetchedAt.toISOString(), staleAt: new Date(fetchedAt.getTime() + this.config.ttl.odds * 1000).toISOString() };
  }
}
