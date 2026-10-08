'use client';

import Link from 'next/link';
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
import { IconBack, IconSearch } from '../shell/icons';
import { CompetitionBlock } from './match-list';
import { SportIcon, sportGroupLabel } from './sport-icon';
import { SportTabs } from './sports-sidebar';

/** Only what the backend can serve is clickable; the rest of the reference tab row is shown as unavailable. */
const TABS = ['Featured', 'Competitions', 'Outrights', 'Offers', 'Free Games', 'Markets'] as const;
type Tab = (typeof TABS)[number];
const AVAILABLE: readonly Tab[] = ['Featured', 'Competitions'];

/** Same shape and size as a real match row, so nothing jumps when data arrives. */
function BoardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading events">
      <span className="skeleton ref-skel-title" />
      <span className="skeleton ref-skel-day" />
      {Array.from({ length: 3 }, (_, row) => (
        <div className="ref-match" key={row}>
          <div className="ref-match-info">
            <span className="skeleton ref-skel-line" style={{ width: 150 }} />
            <span className="skeleton ref-skel-line" style={{ width: 120 }} />
            <span className="skeleton ref-skel-line" style={{ width: 180, height: 14 }} />
          </div>
          <div className="ref-match-odds">
            {[0, 1, 2].map((cell) => <span key={cell} className="skeleton ref-skel-odds" />)}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The match listing (football screen).
 *
 * Prices come from the existing sports board query and are confirmed by the
 * server when a bet is placed; nothing here settles or re-prices anything.
 */
export function SportsbookView({ mode }: { mode: 'PREMATCH' | 'LIVE' }) {
  const router = useRouter();
  const params = useSearchParams();
  const sports = useSports();
  const requested = params.get('sport') ?? undefined;
  const [selected, setSelected] = useState<string | undefined>(requested);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<Tab>('Featured');
  const [competition, setCompetition] = useState<string | null>(null);

  useEffect(() => { if (requested) setSelected(requested); }, [requested]);

  // Default to the first sport the provider actually returned.
  useEffect(() => {
    if (selected || !sports.data?.length) return;
    setSelected(sports.data[0].key);
  }, [selected, sports.data]);

  const board = useBoard(selected, { live: mode === 'LIVE' });

  const choose = useCallback((sportKey: string) => {
    setSelected(sportKey);
    setCompetition(null);
    const next = new URLSearchParams(params.toString());
    next.set('sport', sportKey);
    router.replace(`?${next.toString()}`, { scroll: false });
  }, [params, router]);

  const stale = isStale(board.data?.staleAt);

  const modeEvents = useMemo(() => {
    const events = board.data?.events ?? [];
    return events.filter((row) => (mode === 'LIVE' ? isLive(row.event) : !isLive(row.event)));
  }, [board.data, mode]);

  const allGroups = useMemo(() => groupByCompetition(modeEvents), [modeEvents]);
  const groups = useMemo(
    () => groupByCompetition(modeEvents.filter((row) => matchesSportsSearch(row, search)))
      .filter((group) => competition === null || group.name === competition),
    [modeEvents, search, competition],
  );

  const sportsError = sports.error instanceof ApiError ? sports.error : undefined;
  const boardError = board.error instanceof ApiError ? board.error : undefined;
  const currentSport = sports.data?.find((sport) => sport.key === selected);
  const title = mode === 'LIVE'
    ? 'In-Play'
    : sportGroupLabel(currentSport?.group ?? currentSport?.name ?? 'Sports');

  return (
    <div className={`ref-page${board.isPlaceholderData ? ' ref-stale' : ''}`} aria-busy={board.isPlaceholderData}>
      <div className="ref-title-row">
        <Link className="ref-round-button" href="/" aria-label="Back to all sports"><IconBack /></Link>
        <h1>{title}</h1>
        <button
          type="button"
          className="ref-round-button filled"
          aria-label="Refresh prices"
          disabled={board.isFetching}
          onClick={() => void board.refetch()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.5-5.8M20 4v5h-5" /></svg>
        </button>
      </div>

      <div className="ref-tabs" role="tablist" aria-label="Listing views">
        {TABS.map((name) => {
          const available = AVAILABLE.includes(name);
          return (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              aria-disabled={!available}
              disabled={!available}
              title={available ? undefined : 'Not available yet'}
              className={tab === name ? 'active' : ''}
              onClick={() => setTab(name)}
            >
              {name}
            </button>
          );
        })}
      </div>
      <div className="ref-rule" />

      <SportTabs sports={sports.data ?? []} selected={selected} onSelect={choose} />

      <div className="ref-section-head">
        <h2>{mode === 'LIVE' ? 'IN-PLAY' : tab === 'Competitions' ? 'COMPETITIONS' : 'UPCOMING MATCHES'}</h2>
        <div className="ref-head-actions">
          <label className="ref-mini-search">
            <IconSearch />
            <span className="sr-only">Search teams, leagues, or sports</span>
            <input
              id="ref-search"
              type="search"
              value={search}
              placeholder="Search"
              autoComplete="off"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <button type="button" className="ref-outline-pill" onClick={() => { setCompetition(null); setSearch(''); }}>
            View All
          </button>
        </div>
      </div>

      {allGroups.length > 0 && (
        <div className={`ref-filter-cards${tab === 'Competitions' ? ' wrap' : ''}`} role="group" aria-label="Competitions">
          <button
            type="button"
            className={`ref-filter-card${competition === null ? ' active' : ''}`}
            aria-pressed={competition === null}
            onClick={() => setCompetition(null)}
          >
            <SportIcon sport={`${selected ?? ''} ${currentSport?.group ?? ''}`} className="ref-filter-icon" />
            <span>
              <b>All Matches</b>
              <small>{modeEvents.length} {modeEvents.length === 1 ? 'Match' : 'Matches'}</small>
            </span>
          </button>
          {allGroups.map((group) => (
            <button
              key={group.name}
              type="button"
              className={`ref-filter-card${competition === group.name ? ' active' : ''}`}
              aria-pressed={competition === group.name}
              onClick={() => setCompetition(competition === group.name ? null : group.name)}
            >
              <SportIcon sport={`${selected ?? ''} ${currentSport?.group ?? ''}`} className="ref-filter-icon" />
              <span>
                <b>{group.name}</b>
                <small>{group.events.length} {group.events.length === 1 ? 'Match' : 'Matches'}</small>
              </span>
            </button>
          ))}
        </div>
      )}

      {board.data && (
        // Freshness is only visually prominent when it matters; otherwise it is announced, not shown.
        <p className={stale ? 'ref-fresh' : 'sr-only'} role="status">
          {stale ? 'Prices may be out of date — refreshing.' : `Prices updated ${formatDateTime(board.data.fetchedAt)}`}
        </p>
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
            {search.trim() ? 'No events match your search.' : mode === 'LIVE' ? 'No live events right now.' : 'No upcoming events for this sport.'}
          </strong>
          <span>{search.trim() ? 'Try a team, league, or sport name.' : 'Choose another sport from the navigation.'}</span>
        </div>
      )}

      {tab === 'Featured' && groups.map((group) => (
        <CompetitionBlock key={group.name} name={group.name} events={group.events} stale={stale} />
      ))}

      {tab === 'Competitions' && competition !== null && groups.map((group) => (
        <CompetitionBlock key={group.name} name={group.name} events={group.events} stale={stale} />
      ))}
    </div>
  );
}
