export type Sport = { key: string; name: string; active: boolean; group?: string };
/**
 * `providerEventId` stays the provider's own id and is what a BetLeg stores, so
 * provenance is never lost. `internalEventId` is the namespaced id the browser
 * and the placement DTO use, because it alone says which provider owns the
 * event — routing on the bare provider id would look an API-Football fixture up
 * in The Odds API's id space (§10).
 */
export type SportsEvent = { provider: string; providerEventId: string; internalEventId: string; sportKey: string; sportName: string; competitionName?: string; homeTeam: string; awayTeam: string; startTime: string; status: 'UPCOMING' | 'STARTED_UNKNOWN'; };
export type Selection = { key: string; name: string; price: string; point?: string; /** Provider reports this individual price as not currently takeable (§8). */ suspended?: boolean };
/**
 * `key` is a normalized catalogue key (see `markets.ts`), never a provider's own
 * bet id. It widened from a three-value union to `string` so soccer can carry
 * real provider markets; `h2h`, `spreads` and `totals` keep their exact former
 * meaning, so stored bets and settlement are unaffected (§4).
 *
 * `bettable` makes the §5 separation explicit on the wire: a market may be
 * displayable and still refuse stakes. It is derived from settlement support,
 * never from the provider — and the placement path re-derives it server-side
 * rather than trusting anything a browser sends back (§11).
 */
export type Market = { key: string; name: string; group?: string; selections: Selection[]; bettable?: boolean; suspended?: boolean; unavailableReason?: string };
/** Live state for an in-play fixture (§8). Absent for pre-match events. */
export type LiveState = { status: string; minute?: number; homeScore?: number; awayScore?: number };
export type EventOdds = { event: SportsEvent; bookmaker: { key: string; name: string }; markets: Market[]; fetchedAt: string; staleAt: string; live?: LiveState; /** Total markets the provider returned, including display-only ones (§7). */ marketCount?: number };
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
export type ProviderStatus = { provider: string; configured: boolean; lastSuccessAt?: string; lastFailureAt?: string; lastErrorCode?: string; lastErrorStatus?: number; remainingQuota?: number; cacheHealthy?: boolean };
export const SPORTS_PROVIDER = Symbol('SPORTS_PROVIDER');
