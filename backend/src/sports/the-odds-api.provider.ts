import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { BoardEvent, EventOdds, Market, ProviderStatus, Sport, SportsBoard, SportsEvent, SportsProvider } from './domain';
import { sportsConfig } from './sports.config';
import { SportsError } from './provider.errors';
import { eventSchema, isSupportedMarketKey, ProviderEvent, sportSchema, SupportedMarketKey } from './the-odds-api.schemas';
import { OperationsHealthService } from '../operations/operations-health.service';

/**
 * Maps an upstream HTTP status onto a distinct error code.
 *
 * The distinction is for operators, not players: every one of these still
 * reaches the browser as the same neutral "temporarily unavailable" copy, but
 * an admin can tell a dead key from a spent quota from a malformed request
 * without reading container logs.
 */
function classifyHttpStatus(status: number): string {
  if (status === 401) return 'SPORTS_PROVIDER_UNAUTHORIZED';
  if (status === 403) return 'SPORTS_PROVIDER_FORBIDDEN';
  if (status === 422) return 'SPORTS_PROVIDER_INVALID_REQUEST';
  if (status === 429) return 'SPORTS_PROVIDER_RATE_LIMITED';
  return 'SPORTS_PROVIDER_UNAVAILABLE';
}

@Injectable()
export class TheOddsApiProvider implements SportsProvider {
  private readonly logger = new Logger(TheOddsApiProvider.name);
  private readonly config = sportsConfig();
  private status: ProviderStatus = { provider: 'the-odds-api', configured: Boolean(this.config.apiKey) };
  constructor(private readonly health: OperationsHealthService) {}
  getStatus() { return { ...this.status }; }
  private url(path: string, params: Record<string, string> = {}) { const url = new URL(`${this.config.baseUrl}${path}`); for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value); url.searchParams.set('apiKey', this.config.apiKey!); return url; }
  private async request<T>(path: string, schema: z.ZodType<T>, params: Record<string, string> = {}): Promise<T> {
    if (!this.config.apiKey) throw new SportsError('SPORTS_PROVIDER_NOT_CONFIGURED', 503, 'Sports provider is not configured.');
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(this.url(path, params), { signal: controller.signal, headers: { accept: 'application/json' } });
      const remaining = response.headers.get('x-requests-remaining');
      const used = response.headers.get('x-requests-used');
      if (!response.ok) {
        if (response.status === 404) throw new SportsError('SPORTS_EVENT_NOT_FOUND', 404, 'Sports event not found.', response.status);
        throw new SportsError(classifyHttpStatus(response.status), 503, undefined, response.status);
      }
      const parsed = schema.safeParse(await response.json());
      if (!parsed.success) throw new SportsError('SPORTS_PROVIDER_INVALID_RESPONSE', 503, undefined, response.status);
      this.status = {
        ...this.status,
        lastSuccessAt: new Date().toISOString(),
        remainingQuota: remaining === null ? undefined : Number(remaining),
      };
      await this.health.providerSuccess({
        remaining: remaining === null ? undefined : Number(remaining),
        used: used === null ? undefined : Number(used),
      });
      this.logger.log({ event: 'SPORTS_PROVIDER_REQUEST_SUCCESS', path });
      return parsed.data;
    } catch (error) {
      // An aborted fetch is a timeout on our side, not an upstream rejection;
      // reporting it as a generic outage hid a too-short SPORTS_PROVIDER_TIMEOUT_MS.
      // DOMException does not always satisfy `instanceof Error` across runtimes,
      // so the abort is identified by name rather than by prototype.
      const aborted = typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
      const code = error instanceof SportsError
        ? error.code
        : aborted ? 'SPORTS_PROVIDER_TIMEOUT' : 'SPORTS_PROVIDER_UNAVAILABLE';
      const upstreamStatus = error instanceof SportsError ? error.upstreamStatus : undefined;
      this.status = { ...this.status, lastFailureAt: new Date().toISOString(), lastErrorCode: code, lastErrorStatus: upstreamStatus };
      await this.health.providerFailure(code);
      this.logger.warn({ event: 'SPORTS_PROVIDER_REQUEST_FAILED', path, code, upstreamStatus: upstreamStatus ?? null });
      if (error instanceof SportsError) throw error;
      throw new SportsError(code, 503);
    } finally { clearTimeout(timer); }
  }
  async getSports(): Promise<Sport[]> { const rows = await this.request('/sports', z.array(sportSchema)); return rows.filter(x => x.active).map(x => ({ key: x.key, name: x.title, active: x.active, ...(x.group === undefined ? {} : { group: x.group }) })); }
  // `sport_title` is the provider's own name for the competition ("EPL"). It is
  // carried through rather than invented so the UI can group by real leagues.
  private event(row: ProviderEvent): SportsEvent { return { provider: 'the-odds-api', providerEventId: row.id, sportKey: row.sport_key, sportName: row.sport_title, competitionName: row.sport_title, homeTeam: row.home_team, awayTeam: row.away_team, startTime: row.commence_time, status: new Date(row.commence_time) > new Date() ? 'UPCOMING' : 'STARTED_UNKNOWN' }; }
  private board(sportKey: string) { return this.request(`/sports/${encodeURIComponent(sportKey)}/odds`, z.array(eventSchema), { regions: 'eu', markets: 'h2h,spreads,totals', oddsFormat: 'decimal' }); }
  async getEvents(sportKey: string) { return (await this.board(sportKey)).map(x => this.event(x)); }
  /** Chooses the configured primary bookmaker, else the lowest key, deterministically. */
  private pick(row: ProviderEvent) {
    // A bookmaker quoting only unsupported markets would otherwise be chosen and
    // then render as an event with no prices at all.
    const available = (row.bookmakers ?? []).filter(b => b.markets.some(m => isSupportedMarketKey(m.key) && m.outcomes.length > 0));
    return this.config.bookmakers.map(key => available.find(x => x.key === key)).find(Boolean) ?? [...available].sort((a, b) => a.key.localeCompare(b.key))[0];
  }
  /**
   * Only the markets this product prices. An exchange's `h2h_lay` quote, or any
   * future market the provider adds, is dropped here rather than surfaced with
   * an invented name.
   */
  private markets(bookmaker: NonNullable<ProviderEvent['bookmakers']>[number]): Market[] {
    const names: Record<SupportedMarketKey, string> = { h2h: 'Match Winner', spreads: 'Handicap', totals: 'Total' };
    return bookmaker.markets.flatMap<Market>(m => {
      const key = m.key;
      if (!isSupportedMarketKey(key) || m.outcomes.length === 0) return [];
      return [{
        key,
        name: names[key],
        selections: m.outcomes.map((o, index) => ({ key: `${key}:${o.name}:${o.point ?? ''}:${index}`, name: o.name, price: o.price.toString(), ...(o.point === undefined ? {} : { point: o.point.toString() }) })),
      }];
    });
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
