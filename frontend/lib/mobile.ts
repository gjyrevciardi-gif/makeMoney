'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { getJson } from './api';
import { CADENCE, qk, useSession } from './queries';
import { fetchBoard, isLive, type Sport, type SportsBoard } from './sports';
import type { TicketBet } from '../components/sports/settled-ticket';

/**
 * Data the phone layout needs that no single page owns.
 *
 * Everything here is read from the API or from what other screens already
 * fetched. Nothing is estimated on the client, and a figure that has no source
 * resolves to `null` / an empty list so the screen hides it instead of faking it.
 */

/**
 * Events the cached sports boards report as in play.
 *
 * It reads boards other screens already loaded and issues no request of its
 * own, so it is `null` (and the count is hidden) until some board has arrived.
 */
export function useLiveEventCount() {
  const client = useQueryClient();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const read = () => {
      const boards = client
        .getQueriesData<SportsBoard>({ queryKey: ['sports', 'board'] })
        .filter(([, data]) => Boolean(data));
      setCount(boards.length === 0
        ? null
        : boards.reduce((total, [, data]) => total + (data?.events.filter((row) => isLive(row.event)).length ?? 0), 0));
    };
    read();
    // The cache can notify while another component is rendering, so the update is deferred.
    const unsubscribe = client.getQueryCache().subscribe(() => {
      queueMicrotask(() => { if (active) read(); });
    });
    return () => { active = false; unsubscribe(); };
  }, [client]);

  return count;
}

/**
 * How many bets are open, from the same query (and key) the My Bets page uses,
 * so the badge and the list can never disagree.
 */
export function useOpenBetsCount() {
  const session = useSession();
  const bets = useQuery({
    queryKey: qk.bets('OPEN'),
    enabled: Boolean(session.data),
    queryFn: () => getJson<unknown[]>('/bets/me?limit=50&status=OPEN'),
    staleTime: 15_000,
  });
  return bets.data?.length ?? 0;
}

/** The current time, re-read every `everyMs`. Used for the "Starts in mm:ss" countdowns. */
export function useNow(everyMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

/**
 * Favourites are a per-viewer convenience, kept in this browser only (nothing
 * is sent anywhere), and every storage access is guarded because storage can
 * be unavailable.
 */
export function useFavourites(scope: string) {
  const key = `fg.fav.${scope}`;
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    try {
      setIds(new Set(JSON.parse(window.localStorage.getItem(key) ?? '[]') as string[]));
    } catch { /* storage unavailable or corrupt: start empty */ }
  }, [key]);

  const toggle = (id: string) => {
    setIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { window.localStorage.setItem(key, JSON.stringify([...next])); } catch { /* not persisted */ }
      return next;
    });
  };

  return { has: (id: string) => ids.has(id), toggle };
}

const WIN_KEY = 'fg.win-dismissed';
const WIN_WINDOW_MS = 24 * 60 * 60 * 1000;

export type RecentWin = { id: string; payout: string; selection: string; event: string; betType: string };

/**
 * The player's latest winning bet, settled within the last day and not yet
 * dismissed. It is read from the same query as the My Bets "Won" tab, so it is
 * exactly what the server recorded.
 */
export function useRecentWin() {
  const session = useSession();
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    try { setDismissed(new Set(JSON.parse(window.localStorage.getItem(WIN_KEY) ?? '[]') as string[])); } catch { /* none */ }
  }, []);

  const bets = useQuery({
    queryKey: qk.bets('WON'),
    enabled: Boolean(session.data),
    queryFn: async () => {
      if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEV_FIXTURES === '1') {
        return (await import('./dev-fixtures')).fixtureWonBets();
      }
      return getJson<TicketBet[]>('/bets/me?limit=50&status=WON');
    },
    staleTime: 30_000,
  });

  const bet = (bets.data ?? []).find((entry) => entry.settledAt
    && Date.now() - Date.parse(entry.settledAt) < WIN_WINDOW_MS
    && !dismissed.has(entry.id));
  const leg = bet?.legs[0];
  const win: RecentWin | null = bet && leg ? {
    id: bet.id,
    payout: bet.actualPayout ?? bet.potentialPayout,
    selection: leg.selectionName,
    event: `${leg.homeTeam} v ${leg.awayTeam}`,
    betType: bet.type === 'SINGLE' ? 'Single' : `${bet.legs.length}-fold`,
  } : null;

  const dismiss = (id: string) => {
    setDismissed((current) => {
      const next = new Set(current).add(id);
      try { window.localStorage.setItem(WIN_KEY, JSON.stringify([...next])); } catch { /* not persisted */ }
      return next;
    });
  };

  return { win, dismiss };
}

/**
 * Everything about a live event that the sports feed does not report: clock,
 * score, serving player, goal flash, stream, tracker, possession and stats.
 *
 * The feed only says that a fixture has started, so production never has any of
 * this and each piece of the screen renders only when its field is present.
 * Scores are columns (a football score is one, tennis is sets / games / points).
 */
export type LiveInfo = {
  /** "67'", "Set 2", "Q4 06:12". */
  clock?: string;
  home?: (number | string)[];
  away?: (number | string)[];
  serve?: 'home' | 'away';
  /** "Goal · PSV", while a goal has just been reported. */
  goal?: string;
  /** A stream exists for this event. */
  stream?: boolean;
  /** "12' 38'" / "54'" under the score. */
  scorers?: { home: string; away: string };
  tracker?: {
    /** "Dangerous attack · Liverpool". */
    status: string;
    attacking: 'home' | 'away';
    /** Ball path as percentages of the pitch, looped by the animation. */
    ball: [number, number][];
  };
  possession?: { home: number; away: number };
  stats?: { name: string; home: number; away: number; suffix?: string }[];
};

/** Live details by provider event id. Empty in production: nothing supplies them. */
export function useLiveInfoMap() {
  const query = useQuery({
    queryKey: ['sports', 'live-info'],
    queryFn: async (): Promise<Record<string, LiveInfo>> => {
      if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEV_FIXTURES === '1') {
        return (await import('./dev-fixtures')).fixtureLiveInfo();
      }
      return {};
    },
    staleTime: Infinity,
  });
  return query.data ?? {};
}

/** A match-page market the platform cannot place today (corners, builder legs). Preview-only. */
export type ExtraMarket = {
  id: string;
  name: string;
  note?: string;
  cols: number;
  cells: { label: string; price: string }[];
};

export type MatchExtras = {
  /** Same-match legs for Bet Builder. */
  builder?: { id: string; name: string; note: string; price: string }[];
  corners?: ExtraMarket[];
};

/** Same-match builder legs and corner markets. No source exists, so production is empty. */
export function useMatchExtras() {
  const query = useQuery({
    queryKey: ['sports', 'match-extras'],
    queryFn: async (): Promise<MatchExtras> => {
      if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEV_FIXTURES === '1') {
        return (await import('./dev-fixtures')).fixtureMatchExtras();
      }
      return {};
    },
    staleTime: Infinity,
  });
  return query.data ?? {};
}

/**
 * The first boards of the provider's sport list, loaded into the same query
 * cache the rest of the app uses, so the Live filters can show real counts.
 * It is bounded so a long sports list never fans out into dozens of requests.
 */
export function useLiveBoards(sports: Sport[], limit = 12) {
  const keys = useMemo(() => sports.slice(0, limit).map((sport) => sport.key), [sports, limit]);
  const results = useQueries({
    queries: keys.map((key) => ({
      queryKey: qk.board(key),
      queryFn: () => fetchBoard(key),
      refetchInterval: CADENCE.liveOddsMs,
      staleTime: 10_000,
      retry: 1,
    })),
  });
  return {
    boards: results.map((result) => result.data).filter((board): board is SportsBoard => Boolean(board)),
    pending: results.some((result) => result.isPending),
    allFailed: results.length > 0 && results.every((result) => result.isError),
  };
}

/** A boosted price. The platform has no offers yet, so none exist in production. */
export type BoostedOffer = {
  id: string;
  /** The event the offer is on, when it has one; the match page shows only its own. */
  eventId?: string;
  headline: string;
  /** What the offer is made of, one line per leg. */
  legs: string[];
  /** Context line above the headline, e.g. a live score. */
  context?: string;
  /** e.g. "Live 67'" - shown only when the data says the match is live. */
  liveLabel?: string;
  was: string;
  now: string;
  href: string;
};

export function useBoostedOffers() {
  const query = useQuery({
    queryKey: ['sports', 'boosted'],
    queryFn: async (): Promise<BoostedOffer[]> => {
      if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEV_FIXTURES === '1') {
        return (await import('./dev-fixtures')).fixtureBoosted();
      }
      return [];
    },
    staleTime: Infinity,
  });
  return query.data ?? [];
}

/* ---- data the platform does not provide yet -------------------------------- */

/** A live-dealer table. No endpoint lists these yet, so the list is empty in production. */
export type LiveTable = {
  id: string;
  name: string;
  /** Short line under the name, e.g. "5 – 2,500 PTS". */
  stakes: string;
  players: number;
  /** Optional corner note, e.g. "2 of 7 seats free". */
  note?: string;
  kind: 'roulette' | 'blackjack' | 'other';
  route: string;
};

/** The progressive jackpot. No endpoint provides it yet, so it is `null` in production. */
export type Jackpot = {
  /** Whole points, as the server would report them. */
  amount: number;
  /** The figure it must drop by, in whole points. */
  mustDropBy: number;
  playersOnline?: number;
  /** "Last won 3 days ago". */
  lastWon?: string;
};

/**
 * Live-dealer tables, or an empty list. The query never touches the network:
 * production has no source, and the dev fixtures are loaded only behind the
 * inline guard below.
 */
export function useLiveCasinoTables() {
  const query = useQuery({
    queryKey: ['casino', 'live-tables'],
    queryFn: async (): Promise<LiveTable[]> => {
      if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEV_FIXTURES === '1') {
        return (await import('./dev-fixtures')).fixtureLiveTables();
      }
      return [];
    },
    staleTime: Infinity,
  });
  return query.data ?? [];
}

/** The jackpot, or `null` while there is nothing real to show. */
export function useJackpot() {
  const query = useQuery({
    queryKey: ['casino', 'jackpot'],
    queryFn: async (): Promise<Jackpot | null> => {
      if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEV_FIXTURES === '1') {
        return (await import('./dev-fixtures')).fixtureJackpot();
      }
      return null;
    },
    staleTime: Infinity,
  });
  return query.data ?? null;
}
