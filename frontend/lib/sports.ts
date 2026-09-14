'use client';

import { useQuery } from '@tanstack/react-query';
import { getJson } from './api';
import { CADENCE, qk } from './queries';

/* Mirrors of the backend's `src/sports/domain.ts` projections. */

export type Sport = { key: string; name: string; active: boolean; group?: string };

export type SportsEvent = {
  provider: string;
  /** The provider's own id, as stored on a bet leg. */
  providerEventId: string;
  /**
   * The namespaced id used for links and odds lookups. It encodes which
   * provider owns the event, so routing cannot send an API-Football fixture
   * into The Odds API's id space. Optional so older payloads still parse.
   */
  internalEventId?: string;
  sportKey: string;
  sportName: string;
  competitionName?: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  status: 'UPCOMING' | 'STARTED_UNKNOWN';
};

export type Selection = { key: string; name: string; price: string; point?: string; suspended?: boolean };

/**
 * `key` mirrors the backend catalogue and is no longer a closed union: soccer
 * carries real provider markets alongside the original three.
 *
 * `bettable` is the display/stake split. It is advisory on the client — the
 * server re-derives it on placement — but the UI must honour it so a
 * display-only or suspended market never reaches the bet slip.
 */
export type MarketKey = string;
export type MarketGroup =
  | 'popular' | 'match_result' | 'goals' | 'handicaps'
  | 'halves' | 'team' | 'corners' | 'cards' | 'correct_score';

export type Market = {
  key: MarketKey;
  name: string;
  group?: MarketGroup;
  selections: Selection[];
  bettable?: boolean;
  suspended?: boolean;
  unavailableReason?: string;
};

/** Live state for an in-play fixture. Absent for pre-match events. */
export type LiveState = { status: string; minute?: number; homeScore?: number; awayScore?: number };

export type BoardEvent = {
  event: SportsEvent;
  bookmaker: { key: string; name: string } | null;
  markets: Market[];
};

export const MARKET_GROUP_ORDER: MarketGroup[] = ['popular', 'match_result', 'goals', 'handicaps', 'halves', 'team', 'corners', 'cards', 'correct_score'];
export const MARKET_GROUP_NAMES: Record<MarketGroup, string> = {
  popular: 'Popular', match_result: 'Match Result', goals: 'Goals', handicaps: 'Handicaps',
  halves: 'Halves', team: 'Team', corners: 'Corners', cards: 'Cards', correct_score: 'Correct Score',
};

/** A selection may enter the slip only if its market AND itself both allow it. */
export const isSelectable = (market: Market, selection: Selection) =>
  market.bettable === true && market.suspended !== true && selection.suspended !== true;

/** Group markets for the event page, preserving catalogue order, dropping empties. */
export function groupMarkets(markets: Market[]): { group: MarketGroup; name: string; markets: Market[] }[] {
  const byGroup = new Map<MarketGroup, Market[]>();
  for (const market of markets) {
    const group = (market.group ?? 'popular') as MarketGroup;
    byGroup.set(group, [...(byGroup.get(group) ?? []), market]);
  }
  return MARKET_GROUP_ORDER
    .filter(group => (byGroup.get(group)?.length ?? 0) > 0)
    .map(group => ({ group, name: MARKET_GROUP_NAMES[group], markets: byGroup.get(group)! }));
}

export type SportsBoard = {
  sportKey: string;
  sportName: string;
  fetchedAt: string;
  staleAt: string;
  events: BoardEvent[];
};

export type EventOdds = {
  event: SportsEvent;
  bookmaker: { key: string; name: string };
  markets: Market[];
  fetchedAt: string;
  staleAt: string;
  /** Present only while the fixture is in play. */
  live?: LiveState;
  /** Markets the provider offered, before our mapping narrowed them. */
  marketCount?: number;
};

/**
 * Sport groups.
 *
 * The provider supplies a `group` for each sport ("Soccer", "Basketball", ...).
 * When it does not, the key prefix is used, which is still provider data. No
 * sport, league or fixture is ever invented on the client.
 */
export function sportGroup(sport: Sport) {
  if (sport.group) return sport.group;
  const prefix = sport.key.split('_')[0] ?? '';
  if (!prefix) return 'Other';
  return prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

export function groupSports(sports: Sport[]) {
  const groups = new Map<string, Sport[]>();
  for (const sport of sports) {
    const name = sportGroup(sport);
    const bucket = groups.get(name);
    if (bucket) bucket.push(sport);
    else groups.set(name, [sport]);
  }
  return [...groups.entries()]
    .map(([name, entries]) => ({ name, sports: entries }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * An event counts as in-play when the backend says so.
 *
 * `STARTED_UNKNOWN` is the provider's own status for a fixture whose start time
 * has passed and whose result is not yet known. No clock or score is derived
 * from it, because the provider supplies neither.
 */
export const isLive = (event: SportsEvent) => event.status === 'STARTED_UNKNOWN';

/** Groups a board's events by their real competition name. */
export function groupByCompetition(events: BoardEvent[]) {
  const groups = new Map<string, BoardEvent[]>();
  for (const row of events) {
    const name = row.event.competitionName ?? row.event.sportName;
    const bucket = groups.get(name);
    if (bucket) bucket.push(row);
    else groups.set(name, [row]);
  }

  return [...groups.entries()].map(([name, rows]) => ({
    name,
    events: [...rows].sort((a, b) => Date.parse(a.event.startTime) - Date.parse(b.event.startTime)),
  }));
}

export function matchesSportsSearch(row: BoardEvent, value: string) {
  const query = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!query) return true;
  const haystack = [
    row.event.homeTeam,
    row.event.awayTeam,
    row.event.competitionName,
    row.event.sportName,
  ].filter(Boolean).join(' ').toLowerCase();
  return query.split(' ').every((token) => haystack.includes(token));
}

export const findMarket = (markets: Market[], key: MarketKey) =>
  markets.find((market) => market.key === key);

/**
 * Football keeps 1 / X / 2. Other sports have no draw, so the home and away
 * prices are shown in the two outer cells and the middle is left empty rather
 * than padded with an invented price.
 */
export function h2hCells(row: BoardEvent): (Selection | null)[] {
  const market = findMarket(row.markets, 'h2h');
  if (!market) return [null, null, null];
  const home = market.selections.find((s) => s.name === row.event.homeTeam) ?? null;
  const away = market.selections.find((s) => s.name === row.event.awayTeam) ?? null;
  const draw = market.selections.find((s) => s.name.toLowerCase() === 'draw') ?? null;
  if (home || away || draw) return [home, draw, away];
  // Fall back to positional order for a provider naming outcomes differently.
  return [market.selections[0] ?? null, market.selections[2] ?? null, market.selections[1] ?? null];
}

export const isStale = (staleAt: string | undefined) =>
  staleAt !== undefined && Date.parse(staleAt) < Date.now();

/* ----------------------------------------------------------------- queries */

export function useSports() {
  return useQuery({
    queryKey: qk.sports,
    queryFn: () => getJson<Sport[]>('/sports', { public: true }),
    staleTime: CADENCE.catalogueMs,
    retry: 1,
  });
}

/**
 * One sport's whole listing.
 *
 * The board endpoint returns events *and* their primary markets from a single
 * upstream call, so rendering a full page of prices costs one request rather
 * than one per fixture.
 */
export function useBoard(sportKey: string | undefined, options: { live?: boolean } = {}) {
  return useQuery({
    queryKey: qk.board(sportKey ?? ''),
    enabled: Boolean(sportKey),
    queryFn: () => getJson<SportsBoard>(`/sports/${encodeURIComponent(sportKey!)}/board`, { public: true }),
    refetchInterval: options.live ? CADENCE.liveOddsMs : CADENCE.prematchOddsMs,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
    retry: 1,
  });
}

export function useEventOdds(sportKey: string | undefined, eventId: string | undefined) {
  return useQuery({
    queryKey: qk.eventOdds(sportKey ?? '', eventId ?? ''),
    enabled: Boolean(sportKey && eventId),
    queryFn: () => getJson<EventOdds>(
      `/sports/events/${encodeURIComponent(eventId!)}/odds?sportKey=${encodeURIComponent(sportKey!)}`,
      { public: true },
    ),
    refetchInterval: CADENCE.eventOddsMs,
    staleTime: 10_000,
    retry: 1,
  });
}

/** Safe, code-driven copy. A provider exception never reaches the page. */
export const SPORTS_MESSAGES: Record<string, string> = {
  SPORTS_PROVIDER_NOT_CONFIGURED: 'Sports data is not configured on this deployment.',
  SPORTS_PROVIDER_UNAVAILABLE: 'Sports data is temporarily unavailable.',
  SPORTS_PROVIDER_RATE_LIMITED: 'Sports data is temporarily unavailable.',
  SPORTS_PROVIDER_INVALID_RESPONSE: 'Sports data is temporarily unavailable.',
  // Operators see the precise cause on /admin/sports; a player is told the same
  // neutral thing either way, so a bad key or a spent quota leaks nothing.
  SPORTS_PROVIDER_UNAUTHORIZED: 'Sports data is temporarily unavailable.',
  SPORTS_PROVIDER_FORBIDDEN: 'Sports data is temporarily unavailable.',
  // A 422 on a board means our markets (h2h/spreads/totals) do not apply to
  // that competition - an outright/futures market, typically. That is not an
  // outage, so it does not get outage copy.
  SPORTS_PROVIDER_INVALID_REQUEST: 'This competition is not offered here.',
  SPORTS_PROVIDER_TIMEOUT: 'Sports data is temporarily unavailable.',
  SPORTS_ODDS_UNAVAILABLE: 'Prices are not available for this event right now.',
  SPORTS_EVENT_NOT_FOUND: 'That event is no longer listed.',
  SPORTS_UNSUPPORTED: 'That sport is not offered.',
  SPORTSBOOK_MAINTENANCE: 'The sportsbook is temporarily unavailable.',
  INSUFFICIENT_VIRTUAL_BALANCE: 'Not enough virtual points for that stake.',
  SELECTION_UNAVAILABLE: 'One or more selections are no longer available.',
  ODDS_CHANGED: 'Prices moved before your bet was accepted.',
  INVALID_STAKE: 'Enter a whole number of points.',
  STAKE_ABOVE_MAXIMUM: 'That stake is above the maximum.',
  SINGLE_REQUIRES_ONE_SELECTION: 'A single takes exactly one selection.',
  INVALID_ACCUMULATOR_SIZE: 'An accumulator needs between two and ten selections.',
  DUPLICATE_SELECTION: 'That selection is already in your slip.',
  ONE_SELECTION_PER_EVENT: 'An accumulator can only take one selection per event.',
  IDEMPOTENCY_KEY_CONFLICT: 'That bet was already submitted.',
  WALLET_NOT_FOUND: 'Your wallet is not available. Please sign in again.',
};

export const describeSportsError = (code: string | undefined, fallback = 'Something went wrong.') =>
  (code ? SPORTS_MESSAGES[code] : undefined) ?? fallback;
