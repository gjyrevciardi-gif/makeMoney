'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getJson } from './api';
import { CADENCE, qk } from './queries';

/* Mirrors of the backend's `src/sports/domain.ts` projections. */

export type Sport = { key: string; name: string; active: boolean; group?: string };

export type SportsEvent = {
  provider: string;
  providerEventId: string;
  sportKey: string;
  sportName: string;
  competitionName?: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  status: 'UPCOMING' | 'STARTED_UNKNOWN';
};

export type Selection = { key: string; name: string; price: string; point?: string };
export type MarketKey = 'h2h' | 'spreads' | 'totals';
export type Market = { key: MarketKey; name: string; selections: Selection[] };

export type BoardEvent = {
  event: SportsEvent;
  bookmaker: { key: string; name: string } | null;
  markets: Market[];
};

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
    // Switching sport keeps the last listing visible (dimmed) instead of flashing blank.
    placeholderData: keepPreviousData,
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
