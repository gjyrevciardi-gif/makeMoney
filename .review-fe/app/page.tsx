'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AppShell } from '../components/shell/app-shell';
import { IconPlusCircle, IconSearch } from '../components/shell/icons';
import { SportIcon, sportGroupLabel } from '../components/sports/sport-icon';
import { useSelectPick } from '../components/sports/match-list';
import { pickId, useBetSlip } from '../lib/bet-slip';
import { formatDay, formatOdds, formatTime } from '../lib/format';
import {
  describeSportsError,
  isLive,
  matchesSportsSearch,
  useBoard,
  useSports,
  type BoardEvent,
  type Sport,
} from '../lib/sports';
import { ApiError } from '../lib/api';

/**
 * Promotional tiles are original Fool's Gold copy about the club itself.
 * They state no prizes, prices or money, and link only to real routes.
 */
const PROMOS = [
  { tone: 'green', kicker: 'FREE PLAY', title: 'PLAY FOR PTS.\nNOTHING TO LOSE.', note: 'Virtual PTS only. No deposits, no cash value.', href: '/sports', cta: 'Browse Sports' },
  { tone: 'gold', kicker: 'NEW IN THE CASINO', title: "LUCKY LADY'S\nCHARM DELUXE", note: 'Settled by the server with a verifiable commitment.', href: '/casino', cta: 'Open Casino' },
  { tone: 'slate', kicker: 'BUILD A PARLAY', title: 'TAP ANY PRICE.\nCOMBINE IN YOUR SLIP.', note: 'Prices are confirmed by the server when you place.', href: '/sports', cta: 'Start a Slip' },
  { tone: 'ink', kicker: 'YOUR TICKETS', title: 'EVERY BET,\nSETTLED ON RECORD.', note: 'Results come from the server, never from this page.', href: '/my-bets', cta: 'My Bets' },
] as const;

function FeatureCard({ row }: { row: BoardEvent }) {
  const slip = useBetSlip();
  const select = useSelectPick();
  const { event } = row;
  const h2h = row.markets.find((market) => market.key === 'h2h');
  const live = isLive(event);

  return (
    <article className="ref-feature-card">
      <header>
        <h3>{event.competitionName ?? event.sportName}</h3>
        <SportIcon sport={`${event.sportKey} ${event.sportName}`} className="ref-feature-icon" />
      </header>
      <p className="ref-feature-event">{event.homeTeam} v {event.awayTeam}</p>
      <ul>
        {(h2h?.selections ?? []).slice(0, 3).map((selection) => {
          const picked = slip.ids.has(pickId({ eventId: event.providerEventId, marketKey: 'h2h', selectionKey: selection.key }));
          return (
            <li key={selection.key}>
              <button
                type="button"
                aria-pressed={picked}
                disabled={live}
                onClick={() => h2h && select(row, selection, 'h2h', h2h.name)}
              >
                <IconPlusCircle className="ref-feature-plus" />
                <span>{selection.name}</span>
                <b>{formatOdds(selection.price)}</b>
              </button>
            </li>
          );
        })}
        {!h2h && <li className="ref-feature-none">Prices are not available for this event.</li>}
      </ul>
      <footer>
        <span>{live ? 'Started' : `${formatDay(event.startTime)} · ${formatTime(event.startTime)}`}</span>
        <Link href={`/sports/event/${encodeURIComponent(event.providerEventId)}?sport=${encodeURIComponent(event.sportKey)}`}>
          More markets »
        </Link>
      </footer>
    </article>
  );
}

export default function Home() {
  const sports = useSports();
  const [selected, setSelected] = useState<string | undefined>();
  const [search, setSearch] = useState('');

  const list = useMemo(() => sports.data ?? [], [sports.data]);
  const active = selected ?? list[0]?.key;
  const board = useBoard(active);
  const activeSport = list.find((sport) => sport.key === active);

  // One tile per sport group, pointing at that group's first listed competition.
  const tiles = useMemo(() => {
    // Provider order, so the first sport the feed lists leads the rail.
    const seen = new Map<string, Sport>();
    for (const sport of list) {
      const group = sport.group ?? sport.key.split('_')[0] ?? sport.key;
      if (!seen.has(group)) seen.set(group, sport);
    }
    return [...seen.entries()].map(([group, sport]) => ({ label: sportGroupLabel(group.charAt(0).toUpperCase() + group.slice(1)), sport }));
  }, [list]);

  const events = useMemo(
    () => (board.data?.events ?? [])
      .filter((row) => !isLive(row.event) && matchesSportsSearch(row, search))
      .slice(0, 12),
    [board.data, search],
  );
  const boardError = board.error instanceof ApiError ? board.error : undefined;

  return (
    <AppShell sidebar>
      <div className="ref-page">
        <label className="ref-search">
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

        <nav className="ref-sport-rail" aria-label="Sports">
          {sports.isPending && Array.from({ length: 8 }, (_, index) => <span key={index} className="skeleton ref-sport-tile" />)}
          {tiles.map(({ label, sport }) => (
            <Link key={sport.key} className="ref-sport-tile" href={`/sports?sport=${encodeURIComponent(sport.key)}`}>
              <SportIcon sport={`${sport.key} ${sport.group ?? ''}`} />
              <span>{label}</span>
            </Link>
          ))}
          <Link className="ref-sport-tile" href="/casino">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" fill="#1fd6a0" /><path d="M8 9v6M12 9v6M16 9v6" stroke="#04281e" strokeWidth="1.6" /></svg>
            <span>Casino</span>
          </Link>
        </nav>

        <div className="ref-promo-rail">
          {PROMOS.map((promo) => (
            <Link key={promo.kicker} href={promo.href} className={`ref-promo tone-${promo.tone}`}>
              <small>{promo.kicker}</small>
              <strong>{promo.title}</strong>
              <span className="ref-promo-cta">{promo.cta}</span>
              <em>{promo.note}</em>
            </Link>
          ))}
        </div>

        {list.length > 0 && (
          <div className="ref-pill-tabs" role="tablist" aria-label="Competitions">
            {list.slice(0, 10).map((sport) => (
              <button
                key={sport.key}
                type="button"
                role="tab"
                aria-selected={active === sport.key}
                className={active === sport.key ? 'active' : ''}
                onClick={() => setSelected(sport.key)}
              >
                {sport.name}
              </button>
            ))}
          </div>
        )}

        {activeSport && (
          <div className="ref-section-head compact">
            <h2><SportIcon sport={`${activeSport.key} ${activeSport.group ?? ''}`} className="ref-head-icon" />{activeSport.name}</h2>
            <Link className="ref-outline-pill" href={`/sports?sport=${encodeURIComponent(activeSport.key)}`}>View All</Link>
          </div>
        )}

        {sports.isError && (
          <div className="empty-state">
            <strong>Sports data temporarily unavailable.</strong>
            <span>Nothing was charged and no bet was affected.</span>
            <button type="button" className="btn btn-sm" onClick={() => void sports.refetch()}>Retry</button>
          </div>
        )}

        {boardError && (
          <div className="empty-state">
            <strong>{describeSportsError(boardError.code, 'Sports data temporarily unavailable.')}</strong>
            <button type="button" className="btn btn-sm" onClick={() => void board.refetch()}>Retry</button>
          </div>
        )}

        {board.isPending && active && (
          <div className="ref-feature-rail" aria-busy="true">
            {[0, 1, 2, 3].map((index) => <span key={index} className="skeleton ref-feature-card" />)}
          </div>
        )}

        {board.data && events.length === 0 && (
          <div className="empty-state">
            <strong>{search.trim() ? 'No events match your search.' : 'No upcoming events for this sport.'}</strong>
            <span>Choose another competition above.</span>
          </div>
        )}

        {events.length > 0 && (
          <div className="ref-feature-rail">
            {events.map((row) => <FeatureCard key={row.event.providerEventId} row={row} />)}
          </div>
        )}

        <p className="casino-disclaimer ref-disclaimer">
          PTS are virtual, non-redeemable and have no cash value. This club offers no real-money
          wagering, deposits, withdrawals or prizes.
        </p>
      </div>
    </AppShell>
  );
}
