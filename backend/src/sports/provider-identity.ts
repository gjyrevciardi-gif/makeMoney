/**
 * Provider identity mapping (§10).
 *
 * Two providers now supply events, and their id spaces are unrelated: The Odds
 * API issues 32-character hex ids, API-Football issues small integers. Left
 * alone they would collide the moment an integer id happened to match, and a
 * bet leg would settle against the wrong fixture.
 *
 * The scheme deliberately leaves The Odds API ids untouched and prefixes only
 * API-Football ones. That keeps every id already stored on a BetLeg valid and
 * routable with no migration, which matters because those rows settle real
 * balances (§4). An unprefixed id is therefore The Odds API by definition.
 *
 * The separator is `_` rather than `:` because PlaceBetDto validates event ids
 * against /^[A-Za-z0-9_-]{1,150}$/ — a colon would be rejected at the edge.
 */

export const PROVIDER_THE_ODDS_API = 'the-odds-api';
export const PROVIDER_API_FOOTBALL = 'api-football';

const API_FOOTBALL_PREFIX = 'af_';

export type ProviderIdentity = { provider: string; providerEventId: string; internalEventId: string };

/** Build the internal id the browser and BetLeg rows carry. */
export const toInternalEventId = (provider: string, providerEventId: string): string =>
  provider === PROVIDER_API_FOOTBALL ? `${API_FOOTBALL_PREFIX}${providerEventId}` : providerEventId;

/** Resolve an internal id back to the provider that owns it. */
export const fromInternalEventId = (internalEventId: string): ProviderIdentity =>
  internalEventId.startsWith(API_FOOTBALL_PREFIX)
    ? { provider: PROVIDER_API_FOOTBALL, providerEventId: internalEventId.slice(API_FOOTBALL_PREFIX.length), internalEventId }
    : { provider: PROVIDER_THE_ODDS_API, providerEventId: internalEventId, internalEventId };

export const isApiFootballEventId = (internalEventId: string): boolean => internalEventId.startsWith(API_FOOTBALL_PREFIX);

/**
 * Soccer is the only sport API-Football serves, so routing keys on it. The Odds
 * API groups every competition under `soccer_*` keys; API-Football's own keys
 * are minted with the same prefix so one test covers both (§1).
 */
export const isSoccerSportKey = (sportKey: string): boolean => sportKey === 'soccer' || sportKey.startsWith('soccer_');
