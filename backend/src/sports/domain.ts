export type Sport = { key: string; name: string; active: boolean; group?: string };
export type SportsEvent = { provider: string; providerEventId: string; sportKey: string; sportName: string; competitionName?: string; homeTeam: string; awayTeam: string; startTime: string; status: 'UPCOMING' | 'STARTED_UNKNOWN'; };
export type Selection = { key: string; name: string; price: string; point?: string };
export type Market = { key: 'h2h' | 'spreads' | 'totals'; name: string; selections: Selection[] };
export type EventOdds = { event: SportsEvent; bookmaker: { key: string; name: string }; markets: Market[]; fetchedAt: string; staleAt: string };
/** One event as it appears on a listing board: the event plus its primary markets. */
export type BoardEvent = { event: SportsEvent; bookmaker: { key: string; name: string } | null; markets: Market[] };
/**
 * A whole sport's listing in one payload.
 *
 * The upstream events call already returns each event's markets, so a board is
 * built from exactly the same single request the event list uses. Listing a
 * sport therefore costs no more provider quota than it did before, and the
 * browser no longer needs one request per event to render prices.
 */
export type SportsBoard = { sportKey: string; sportName: string; fetchedAt: string; staleAt: string; events: BoardEvent[] };
export interface SportsProvider {
  getSports(): Promise<Sport[]>;
  getEvents(sportKey: string): Promise<SportsEvent[]>;
  getEventOdds(sportKey: string, eventId: string): Promise<EventOdds>;
  getStatus(): ProviderStatus;
  /** Optional. Providers that cannot batch markets fall back to bare events. */
  getBoard?(sportKey: string): Promise<SportsBoard>;
}
export type ProviderStatus = { provider: string; configured: boolean; lastSuccessAt?: string; lastFailureAt?: string; remainingQuota?: number; cacheHealthy?: boolean };
export const SPORTS_PROVIDER = Symbol('SPORTS_PROVIDER');
