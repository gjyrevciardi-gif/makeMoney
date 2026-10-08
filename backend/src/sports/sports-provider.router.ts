import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventOdds, ProviderStatus, Sport, SportsBoard, SportsEvent, SportsProvider } from './domain';
import { API_FOOTBALL_SPORT_KEY, ApiFootballProvider } from './api-football.provider';
import { TheOddsApiProvider } from './the-odds-api.provider';
import { PROVIDER_API_FOOTBALL, PROVIDER_THE_ODDS_API, isApiFootballEventId, fromInternalEventId } from './provider-identity';
import { SportsError } from './provider.errors';

/**
 * Routes each request to the provider that owns it (§1, §2).
 *
 * The two providers keep separate sport keys rather than being merged:
 * API-Football owns the single `soccer` key (its whole daily card), while The
 * Odds API keeps every `soccer_*` key it already served. That is deliberate —
 * merging them would mean two books' prices landing in one market, which is
 * exactly what §2 forbids, and it means no existing Odds API behaviour changes.
 *
 * Event ids carry their own provenance (`af_` prefix), so odds lookups route on
 * the id itself and a stored bet leg can always be traced back to the provider
 * that priced it.
 */
@Injectable()
export class SportsProviderRouter implements SportsProvider {
  private readonly logger = new Logger(SportsProviderRouter.name);
  /** Set when API-Football refuses a request for plan reasons, for admin (§3). */
  private accessLimitedAt?: string;
  private accessLimitedReason?: string;

  constructor(
    @Inject(TheOddsApiProvider) private readonly theOddsApi: TheOddsApiProvider,
    @Inject(ApiFootballProvider) private readonly apiFootball: ApiFootballProvider,
  ) {}

  private get soccerEnabled() { return this.apiFootball.getStatus().configured; }

  /** True when an error is API-Football refusing data its plan excludes. */
  private isAccessLimited(error: unknown) {
    return error instanceof SportsError && (error.code === 'SPORTS_PROVIDER_UNAUTHORIZED' || error.code === 'SPORTS_PROVIDER_RATE_LIMITED');
  }

  private noteAccessLimit(error: unknown) {
    if (!this.isAccessLimited(error)) return;
    this.accessLimitedAt = new Date().toISOString();
    this.accessLimitedReason = error instanceof SportsError ? error.code : 'SPORTS_PROVIDER_UNAVAILABLE';
  }

  async getSports(): Promise<Sport[]> {
    // The Odds API list is authoritative for everything it covers; soccer from
    // API-Football is added alongside, never in place of it, so a failure in
    // one provider cannot empty the other's catalogue.
    const [odds, soccer] = await Promise.all([
      this.theOddsApi.getSports().catch(error => { this.logger.warn({ event: 'SPORTS_ROUTER_ODDS_LIST_FAILED' }); if (!this.soccerEnabled) throw error; return [] as Sport[]; }),
      this.soccerEnabled ? this.apiFootball.getSports().catch(() => [] as Sport[]) : Promise.resolve([] as Sport[]),
    ]);
    return [...soccer, ...odds];
  }

  private routesToApiFootball(sportKey: string) { return this.soccerEnabled && sportKey === API_FOOTBALL_SPORT_KEY; }

  async getBoard(sportKey: string): Promise<SportsBoard> {
    if (!this.routesToApiFootball(sportKey)) return this.theOddsApi.getBoard!(sportKey);
    try {
      return await this.apiFootball.getBoard();
    } catch (error) {
      this.noteAccessLimit(error);
      // A plan restriction must not read as a platform outage when The Odds API
      // still covers soccer (§3). Provenance is preserved because the fallback
      // board's events carry their own provider field.
      const fallback = await this.soccerFallbackKey();
      if (!fallback) throw error;
      this.logger.warn({ event: 'SPORTS_ROUTER_SOCCER_FALLBACK', to: PROVIDER_THE_ODDS_API });
      return this.theOddsApi.getBoard!(fallback);
    }
  }

  /** The Odds API soccer competition used when API-Football cannot serve. */
  private async soccerFallbackKey(): Promise<string | undefined> {
    try {
      const sports = await this.theOddsApi.getSports();
      return sports.find(sport => sport.active && sport.key.startsWith('soccer_'))?.key;
    } catch { return undefined; }
  }

  async getEvents(sportKey: string): Promise<SportsEvent[]> {
    return (await this.getBoard(sportKey)).events.map(row => row.event);
  }

  async getEventOdds(sportKey: string, eventId: string): Promise<EventOdds> {
    // Route on the id, not the sport key: an id tells us unambiguously which
    // provider minted it, so a soccer event can never be looked up in the wrong
    // provider's id space (§10).
    if (isApiFootballEventId(eventId)) {
      if (!this.soccerEnabled) throw new SportsError('SPORTS_PROVIDER_NOT_CONFIGURED', 503, 'Soccer provider is not configured.');
      const { providerEventId } = fromInternalEventId(eventId);
      try {
        return await this.apiFootball.getEventOdds(sportKey, providerEventId);
      } catch (error) { this.noteAccessLimit(error); throw error; }
    }
    return this.theOddsApi.getEventOdds(sportKey, eventId);
  }

  /** Back-compat: the single status the existing admin endpoint reads. */
  getStatus(): ProviderStatus {
    return this.theOddsApi.getStatus();
  }

  /** Both providers, for the two-provider admin panel (§8). Never includes keys. */
  getStatuses(): ProviderStatus[] {
    const football: ProviderStatus = { ...this.apiFootball.getStatus() };
    return [
      { ...this.theOddsApi.getStatus(), provider: PROVIDER_THE_ODDS_API },
      {
        ...football,
        provider: PROVIDER_API_FOOTBALL,
        ...(this.accessLimitedAt ? { lastErrorCode: this.accessLimitedReason, lastFailureAt: this.accessLimitedAt } : {}),
      },
    ];
  }
}
