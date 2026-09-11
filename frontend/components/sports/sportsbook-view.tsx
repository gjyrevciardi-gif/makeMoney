'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import {
  describeSportsError,
  groupByCompetition,
  isLive,
  isStale,
  matchesSportsSearch,
  useBoard,
  useSports,
} from '../../lib/sports';
import { BetSlipColumn, BetSlipSheet } from './bet-slip';
import { LeagueGroup } from './league-group';
import { SportTabs, SportsSidebar } from './sports-sidebar';

function BoardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading events">
      {Array.from({ length: 3 }, (_, group) => (
        <div className="league" key={group} style={{ marginBottom: 12 }}>
          <div className="league-head"><span className="skeleton" style={{ width: 150, height: 14 }} /></div>
          {Array.from({ length: 4 }, (_, row) => (
            <div className="event-row" key={row}>
              <div className="event-main">
                <span className="skeleton" style={{ width: 46, height: 28 }} />
                <div className="event-teams" style={{ gap: 6, width: '100%' }}>
                  <span className="skeleton" style={{ width: '52%', height: 11 }} />
                  <span className="skeleton" style={{ width: '44%', height: 11 }} />
                </div>
              </div>
              <div className="event-odds">
                {[0, 1, 2].map((cell) => <span className="skeleton" key={cell} style={{ height: 40 }} />)}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The three-column sportsbook.
 *
 * Left: sports navigation. Centre: dense league groups. Right: the persistent
 * bet slip. Below 1280px the slip becomes a bottom sheet, and below 1024px the
 * sidebar collapses into a scrollable strip of sport tabs.
 */
export function SportsbookView({ mode }: { mode: 'PREMATCH' | 'LIVE' }) {
  const router = useRouter();
  const params = useSearchParams();
  const sports = useSports();
  const requested = params.get('sport') ?? undefined;
  const [selected, setSelected] = useState<string | undefined>(requested);
  const [search, setSearch] = useState('');

  // Default to the first sport the provider actually returned.
  useEffect(() => {
    if (selected || !sports.data?.length) return;
    setSelected(requested ?? sports.data[0].key);
  }, [requested, selected, sports.data]);

  const board = useBoard(selected, { live: mode === 'LIVE' });

  const choose = useCallback((sportKey: string) => {
    setSelected(sportKey);
    const next = new URLSearchParams(params.toString());
    next.set('sport', sportKey);
    router.replace(`?${next.toString()}`, { scroll: false });
  }, [params, router]);

  const stale = isStale(board.data?.staleAt);

  const groups = useMemo(() => {
    const events = board.data?.events ?? [];
    const filtered = mode === 'LIVE'
      ? events.filter((row) => isLive(row.event))
      : events.filter((row) => !isLive(row.event));
    const searched = filtered.filter((row) => matchesSportsSearch(row, search));
    return groupByCompetition(searched);
  }, [board.data, mode, search]);

  const sportsError = sports.error instanceof ApiError ? sports.error : undefined;
  const boardError = board.error instanceof ApiError ? board.error : undefined;
  const currentSport = sports.data?.find((sport) => sport.key === selected);

  return (
    <>
      <div className="sb-shell">
        <SportsSidebar
          sports={sports.data ?? []}
          selected={selected}
          onSelect={choose}
          loading={sports.isPending}
        />

        <div className="sb-center">
          <div className="page-head">
            <div>
              <p className="kicker">{mode === 'LIVE' ? 'In play' : 'Sportsbook'}</p>
              <h1>{mode === 'LIVE' ? 'Live now' : currentSport?.name ?? 'Sports'}</h1>
              <p>
                {mode === 'LIVE'
                  ? 'Events that have already started, from the live data feed.'
                  : 'Prices are supplied by the sports feed and confirmed by the server when you place a bet.'}
              </p>
            </div>
          </div>

          <SportTabs sports={sports.data ?? []} selected={selected} onSelect={choose} />

          <div className="sb-search">
            <label className="sr-only" htmlFor="sports-search">Search teams, leagues, or sports</label>
            <input
              id="sports-search"
              type="search"
              value={search}
              placeholder="Search teams, leagues, or sports"
              autoComplete="off"
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear sports search">
                Clear
              </button>
            )}
          </div>

          {board.data && (
            <div className={`sb-freshness${stale ? ' stale' : ''}`}>
              <span>
                {stale
                  ? 'Prices may be out of date — refreshing.'
                  : `Prices updated ${formatDateTime(board.data.fetchedAt)}`}
              </span>
              <span className="sb-freshness-spacer" />
              {board.isFetching && <span>Refreshing…</span>}
              <button type="button" className="btn btn-sm" onClick={() => void board.refetch()}>
                Refresh
              </button>
            </div>
          )}

          {sportsError && (
            <div className="empty-state">
              <strong>{describeSportsError(sportsError.code, 'Sports data temporarily unavailable.')}</strong>
              <span>Nothing was charged and no bet was affected.</span>
              <button type="button" className="btn btn-sm" onClick={() => void sports.refetch()}>Retry</button>
            </div>
          )}

          {!sportsError && boardError && (
            <div className="empty-state">
              <strong>{describeSportsError(boardError.code, 'Sports data temporarily unavailable.')}</strong>
              <span>Try another sport, or retry in a moment.</span>
              <button type="button" className="btn btn-sm" onClick={() => void board.refetch()}>Retry</button>
            </div>
          )}

          {!sportsError && !boardError && (board.isPending || sports.isPending) && <BoardSkeleton />}

          {!sportsError && !boardError && board.data && groups.length === 0 && (
            <div className="empty-state">
              <strong>
                {search.trim()
                  ? 'No events match your search.'
                  : mode === 'LIVE'
                  ? 'No live events right now.'
                  : 'No upcoming events are available for this competition.'}
              </strong>
              <span>
                {search.trim()
                  ? 'Try a team, league, or sport name.'
                  : mode === 'LIVE'
                  ? 'Pick another sport from the list, or check back closer to kick-off.'
                  : 'Choose another sport from the navigation.'}
              </span>
            </div>
          )}

          {groups.map((group) => (
            <LeagueGroup
              key={group.name}
              name={group.name}
              region={currentSport?.group}
              events={group.events}
              stale={stale}
            />
          ))}
        </div>

        <BetSlipColumn />
      </div>

      <BetSlipSheet />
    </>
  );
}
