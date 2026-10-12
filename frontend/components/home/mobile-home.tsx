'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../lib/api';
import { formatDay, formatOdds, formatPoints, formatRelativeDay, formatTime } from '../../lib/format';
import { useHydrated } from '../../lib/hydrated';
import {
  useBoostedOffers, useFavourites, useNow, useRecentWin, type BoostedOffer,
} from '../../lib/mobile';
import {
  describeSportsError, isLive, matchesSportsSearch, sportGroup, useBoard, useSports,
  type BoardEvent, type Sport,
} from '../../lib/sports';
import {
  IconBolt, IconChevron, IconClock, IconClose, IconSearch, IconStar, IconTrophy,
} from '../shell/icons';
import { PriceTriplet } from '../sports/price-triplet';
import { SportIcon, sportGroupLabel } from '../sports/sport-icon';
import { TeamCrest } from '../sports/team-crest';

/** The order the design lists sports in; anything else the provider has follows alphabetically. */
const PREFERRED = ['Soccer', 'Basketball', 'Tennis', 'Horse Racing', 'Esports', 'Ice Hockey', 'American Football', 'Golf', 'MMA'];
/** A tile is 68px wide, so the longest names are shortened exactly as the design does. */
const SHORT_LABEL: Record<string, string> = { 'American Football': 'Am. Football' };
const FEATURED_LIMIT = 6;
const LEAGUE_LIMIT = 5;

type SportGroup = { name: string; label: string; sports: Sport[] };

/** Only sports the provider actually lists become tiles; none are invented. */
function orderedGroups(list: Sport[]): SportGroup[] {
  const map = new Map<string, Sport[]>();
  for (const sport of list) {
    const name = sportGroup(sport);
    map.set(name, [...(map.get(name) ?? []), sport]);
  }
  const rank = (name: string) => {
    const index = PREFERRED.indexOf(name);
    return index === -1 ? PREFERRED.length : index;
  };
  return [...map.entries()]
    .map(([name, sports]) => ({ name, label: SHORT_LABEL[name] ?? sportGroupLabel(name), sports }))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}

const mmss = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

function StarButton({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" className={`m-star${on ? ' on' : ''}`} aria-pressed={on} aria-label={label} onClick={onToggle}>
      <IconStar filled={on} />
    </button>
  );
}

/* ----------------------------------------------------------------- win banner */

function WinBanner() {
  const { win, dismiss } = useRecentWin();
  if (!win) return null;
  return (
    <div className="m-win" role="status">
      <span className="m-win-badge" aria-hidden="true"><IconTrophy /></span>
      <div className="m-win-text">
        <strong>Bet won · <b>{formatPoints(win.payout)} PTS</b></strong>
        <span>{win.selection} · {win.event} · {win.betType}</span>
      </div>
      <button type="button" className="m-win-close" aria-label="Dismiss" onClick={() => dismiss(win.id)}>
        <IconClose />
      </button>
    </div>
  );
}

/* ----------------------------------------------------------------- sport row */

function SportRow({ groups, active, onPick, loading }: {
  groups: SportGroup[]; active?: string; onPick: (name: string) => void; loading: boolean;
}) {
  return (
    <div role="tablist" aria-label="Sport" className="m-sportrow m-scroll">
      {loading && Array.from({ length: 6 }, (_, index) => (
        <span key={index} className="m-sport"><span className="skeleton m-sport-skel" /><span className="skeleton m-sport-skel-label" /></span>
      ))}
      {groups.map((group) => {
        const on = group.name === active;
        return (
          <button
            key={group.name}
            type="button"
            role="tab"
            aria-selected={on}
            className={`m-sport${on ? ' on' : ''}`}
            onClick={() => onPick(group.name)}
          >
            <span className="m-sport-disc"><SportIcon sport={`${group.sports[0].key} ${group.name}`} /></span>
            <span className="m-sport-label">{group.label}</span>
          </button>
        );
      })}
      {!loading && (
        <Link className="m-sport" href="/sports">
          <span className="m-sport-disc az"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h4v4H5zM15 5h4v4h-4zM5 15h4v4H5zM15 15h4v4h-4z" /></svg></span>
          <span className="m-sport-label">All A–Z</span>
        </Link>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- featured */

function EventCard({ row, now, stale, favourite }: {
  row: BoardEvent; now: number; stale: boolean; favourite: ReturnType<typeof useFavourites>;
}) {
  const { event } = row;
  const id = event.providerEventId;
  const until = Date.parse(event.startTime) - now;
  const soon = until > 0 && until <= 3_600_000;
  const fav = favourite.has(id);

  return (
    <article className="m-card">
      <div className="m-card-top">
        <span className="m-card-league">{event.competitionName ?? event.sportName}</span>
        {soon
          ? <span className="m-pill soon"><IconClock />Starts in {mmss(until)}</span>
          : <span className="m-card-when">{formatRelativeDay(event.startTime)} {formatTime(event.startTime)}</span>}
        <StarButton
          on={fav}
          label={`${fav ? 'Remove' : 'Add'} ${event.homeTeam} v ${event.awayTeam} ${fav ? 'from' : 'to'} favourites`}
          onToggle={() => favourite.toggle(id)}
        />
      </div>
      <Link
        className="m-card-teams"
        href={`/sports/event/${encodeURIComponent(id)}?sport=${encodeURIComponent(event.sportKey)}`}
      >
        <span className="m-team"><TeamCrest name={event.homeTeam} /><span>{event.homeTeam}</span></span>
        <span className="m-v">v</span>
        <span className="m-team"><TeamCrest name={event.awayTeam} /><span>{event.awayTeam}</span></span>
      </Link>
      <PriceTriplet row={row} card stale={stale} />
    </article>
  );
}

/** Rendered only when the platform supplies a boosted price (it supplies none yet). */
function BoostedCard({ offer }: { offer: BoostedOffer }) {
  const [pressed, setPressed] = useState(false);
  return (
    <article className="m-card boosted">
      <div className="m-card-top">
        <span className="m-pill boost"><IconBolt />Boosted</span>
        {offer.liveLabel && <span className="m-pill live"><span className="m-dot" aria-hidden="true" />{offer.liveLabel}</span>}
      </div>
      <Link className="m-boost-body" href={offer.href}>
        {offer.context && <span className="m-boost-context">{offer.context}</span>}
        <strong>{offer.headline}</strong>
        <span className="m-boost-legs">
          {offer.legs.map((leg) => <span key={leg}><i aria-hidden="true" />{leg}</span>)}
        </span>
      </Link>
      <div className="m-boost-prices">
        <div><small>Was</small><s>{formatOdds(offer.was)}</s></div>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        <div className="m-odds card m-boost-button">
          <button
            type="button"
            className="odds-button"
            aria-pressed={pressed}
            aria-label={`Add boosted price ${formatOdds(offer.now)}`}
            onClick={() => setPressed((value) => !value)}
          >
            <span className="odds-price"><IconBolt />{formatOdds(offer.now)}</span>
          </button>
        </div>
      </div>
    </article>
  );
}

function Featured({ sportKey, search, favourite, now }: {
  sportKey: string | undefined; search: string; favourite: ReturnType<typeof useFavourites>; now: number;
}) {
  const board = useBoard(sportKey);
  const offers = useBoostedOffers();
  const stale = board.data ? Date.parse(board.data.staleAt) < now : false;
  const events = useMemo(
    () => (board.data?.events ?? [])
      .filter((row) => !isLive(row.event) && matchesSportsSearch(row, search))
      .slice(0, FEATURED_LIMIT),
    [board.data, search],
  );
  const error = board.error instanceof ApiError ? board.error : undefined;

  if (board.isPending && sportKey) {
    return (
      <div className="m-rail m-scroll" aria-busy="true">
        {[0, 1].map((index) => <span key={index} className="skeleton m-card-skel" />)}
      </div>
    );
  }
  if (error) {
    return (
      <div className="empty-state">
        <strong>{describeSportsError(error.code, 'Sports data temporarily unavailable.')}</strong>
        <button type="button" className="btn btn-sm" onClick={() => void board.refetch()}>Retry</button>
      </div>
    );
  }
  if (events.length === 0 && offers.length === 0) {
    return (
      <p className="m-empty">{search.trim() ? 'No events match your search.' : 'No upcoming events for this sport.'}</p>
    );
  }
  return (
    <div className="m-rail m-scroll">
      {events.map((row) => (
        <EventCard key={row.event.providerEventId} row={row} now={now} stale={stale} favourite={favourite} />
      ))}
      {offers.map((offer) => <BoostedCard key={offer.id} offer={offer} />)}
    </div>
  );
}

/* ----------------------------------------------------------------- top leagues */

function LeagueSection({ sport, defaultOpen, search, favourite }: {
  sport: Sport; defaultOpen: boolean; search: string; favourite: ReturnType<typeof useFavourites>;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const board = useBoard(open ? sport.key : undefined);
  const stale = board.data ? Date.parse(board.data.staleAt) < Date.now() : false;
  const rows = useMemo(
    () => (board.data?.events ?? []).filter((row) => !isLive(row.event) && matchesSportsSearch(row, search)),
    [board.data, search],
  );
  const fav = favourite.has(sport.key);

  return (
    <section className="m-league" aria-label={sport.name}>
      <div className="m-league-head">
        <button type="button" className="m-league-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          <IconChevron className={`m-chevron${open ? '' : ' shut'}`} />
          <span className="m-league-name">{sport.name}</span>
          {board.data && <span className="m-league-count">{rows.length}</span>}
        </button>
        <StarButton
          on={fav}
          label={`${fav ? 'Remove' : 'Add'} ${sport.name} ${fav ? 'from' : 'to'} favourites`}
          onToggle={() => favourite.toggle(sport.key)}
        />
      </div>
      {open && (
        <div className="m-league-body">
          {board.isPending && [0, 1].map((index) => <span key={index} className="skeleton m-row-skel" />)}
          {board.isError && <p className="m-empty">Prices are unavailable right now.</p>}
          {board.data && rows.length === 0 && <p className="m-empty">No upcoming events.</p>}
          {rows.map((row) => {
            const { event } = row;
            return (
              <div className="m-row" key={event.providerEventId}>
                <Link
                  className="m-row-info"
                  href={`/sports/event/${encodeURIComponent(event.providerEventId)}?sport=${encodeURIComponent(event.sportKey)}`}
                >
                  <span className="m-row-meta">
                    <b>{formatTime(event.startTime)}</b> {formatDay(event.startTime)}
                    {row.markets.length > 0 && <> · +{row.markets.length}</>}
                  </span>
                  <span className="m-row-team">{event.homeTeam}</span>
                  <span className="m-row-team">{event.awayTeam}</span>
                </Link>
                <PriceTriplet row={row} stale={stale} />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ----------------------------------------------------------------- loading */

/** Same shapes as the real screen, so nothing jumps when data arrives. */
export function MobileHomeSkeleton() {
  return (
    <div className="m-home" aria-busy="true" aria-label="Loading">
      <SportRow groups={[]} onPick={() => undefined} loading />
      <section className="m-section">
        <div className="m-section-head"><span className="skeleton m-skel-title" /></div>
        <div className="m-rail m-scroll">{[0, 1].map((index) => <span key={index} className="skeleton m-card-skel" />)}</div>
      </section>
      <section className="m-section pad">
        <div className="m-section-head"><span className="skeleton m-skel-title" /></div>
        {[0, 1, 2].map((index) => <span key={index} className="skeleton m-league-skel" />)}
      </section>
    </div>
  );
}

/* ----------------------------------------------------------------- the screen */

/**
 * The phone Home. Every price, event and competition comes from the existing
 * sports queries; the win banner reads the player's own settled bets; and the
 * boosted card appears only if the platform ever supplies an offer.
 */
export function MobileHome() {
  // Fetching starts after mount, so the first client render matches the server's skeleton.
  const hydrated = useHydrated();
  return hydrated ? <HomeScreen /> : <MobileHomeSkeleton />;
}

function HomeScreen() {
  const sports = useSports();
  const favourite = useFavourites('home');
  const now = useNow(1000);
  const list = useMemo(() => sports.data ?? [], [sports.data]);
  const groups = useMemo(() => orderedGroups(list), [list]);
  const [picked, setPicked] = useState<string | undefined>();
  const active = groups.find((group) => group.name === picked) ?? groups[0];
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // The header's search button asks Home to open its field (phone widths only).
  useEffect(() => {
    const open = (event: Event) => {
      if (!window.matchMedia('(max-width: 899px)').matches) return;
      event.preventDefault();
      setSearchOpen(true);
      setTimeout(() => input.current?.focus(), 0);
    };
    window.addEventListener('fg:search', open);
    return () => window.removeEventListener('fg:search', open);
  }, []);

  if (sports.isPending) return <MobileHomeSkeleton />;

  return (
    <div className="m-home">
      {searchOpen && (
        <label className="m-search">
          <IconSearch />
          <span className="sr-only">Search teams, leagues, or sports</span>
          <input
            ref={input}
            type="search"
            value={search}
            placeholder="Search teams or leagues"
            autoComplete="off"
            onChange={(event) => setSearch(event.target.value)}
          />
          <button type="button" aria-label="Close search" onClick={() => { setSearch(''); setSearchOpen(false); }}>
            <IconClose />
          </button>
        </label>
      )}

      <WinBanner />
      <SportRow groups={groups} active={active?.name} onPick={setPicked} loading={false} />

      {sports.isError && (
        <div className="empty-state">
          <strong>Sports data temporarily unavailable.</strong>
          <span>Nothing was charged and no bet was affected.</span>
          <button type="button" className="btn btn-sm" onClick={() => void sports.refetch()}>Retry</button>
        </div>
      )}

      {active && (
        <>
          <section className="m-section" aria-labelledby="m-featured">
            <div className="m-section-head">
              <h2 id="m-featured">Featured</h2>
              <Link href={`/sports?sport=${encodeURIComponent(active.sports[0].key)}`}>See all</Link>
            </div>
            <Featured sportKey={active.sports[0]?.key} search={search} favourite={favourite} now={now} />
          </section>

          <section className="m-section pad" aria-labelledby="m-leagues">
            <div className="m-section-head">
              <h2 id="m-leagues">Top leagues</h2>
              <span>Match result</span>
            </div>
            {active.sports.slice(0, LEAGUE_LIMIT).map((sport, index) => (
              <LeagueSection
                key={sport.key}
                sport={sport}
                defaultOpen={index === 0}
                search={search}
                favourite={favourite}
              />
            ))}
          </section>
        </>
      )}

      {sports.data && list.length === 0 && (
        <div className="empty-state"><strong>No sports are available right now.</strong></div>
      )}

      <p className="m-footnote">
        <span className="m-age">18+</span>
        Prices refresh automatically · <Link href="/account#limits">Play responsibly</Link>
      </p>
    </div>
  );
}
