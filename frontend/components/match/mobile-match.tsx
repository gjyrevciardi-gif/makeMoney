'use client';

import Link from 'next/link';
import { useMemo, useState, type CSSProperties } from 'react';
import { pickId, useBetSlip, type SlipPick } from '../../lib/bet-slip';
import { ApiError } from '../../lib/api';
import { formatOdds, formatRelativeDay, formatTime } from '../../lib/format';
import { useHydrated } from '../../lib/hydrated';
import {
  useBoostedOffers, useFavourites, useLiveInfoMap, useMatchExtras, type LiveInfo,
} from '../../lib/mobile';
import {
  describeSportsError, isLive, isStale, useEventOdds, type EventOdds, type Market, type Selection,
} from '../../lib/sports';
import { IconBack, IconBolt, IconChevron, IconStar } from '../shell/icons';
import { OddsButton } from '../sports/odds-button';
import { crestInitials, TeamCrest } from '../sports/team-crest';

type TabId = 'popular' | 'builder' | 'goals' | 'corners' | 'stats';

/** Football and hockey count goals; everything else counts points or games. */
const countsGoals = (sportKey: string) => /^(soccer|icehockey)/.test(sportKey);

/* ----------------------------------------------------------------- hero */

function Hero({ odds, info, live }: { odds: EventOdds; info: LiveInfo | undefined; live: boolean }) {
  const { event } = odds;
  const hasScore = Boolean(info?.home && info.away);
  const score = (columns: (number | string)[] | undefined) => columns?.[columns.length - 1] ?? '';

  return (
    <section className="m-hero" aria-label="Match summary">
      <div className="m-hero-teams">
        <div className="m-hero-team"><TeamCrest name={event.homeTeam} /><span>{event.homeTeam}</span></div>
        <div className="m-hero-mid">
          {hasScore
            ? <span className="m-hero-score">{score(info?.home)} – {score(info?.away)}</span>
            : <span className="m-hero-vs">v</span>}
          {live
            ? (
              <span className="m-pill live">
                <span className="m-dot" aria-hidden="true" />LIVE{info?.clock ? ` ${info.clock}` : ''}
              </span>
            )
            : <span className="m-pill soon">{formatRelativeDay(event.startTime)} {formatTime(event.startTime)}</span>}
        </div>
        <div className="m-hero-team"><TeamCrest name={event.awayTeam} /><span>{event.awayTeam}</span></div>
      </div>

      {info?.scorers && (
        <div className="m-scorers">
          <span>{info.scorers.home} {event.homeTeam}</span>
          <i aria-hidden="true">|</i>
          <span>{info.scorers.away} {event.awayTeam}</span>
        </div>
      )}

      {info?.tracker && <Tracker odds={odds} tracker={info.tracker} />}

      {info?.possession && (
        <div className="m-possession">
          <div><b>{info.possession.home}%</b><span>Possession</span><b className="away">{info.possession.away}%</b></div>
          <div className="m-bar">
            <i style={{ flex: info.possession.home }} />
            <i className="away" style={{ flex: info.possession.away }} />
          </div>
        </div>
      )}
    </section>
  );
}

/** The pitch drawn in lines, a ball moving through attacking positions, and the attack status. */
function Tracker({ odds, tracker }: { odds: EventOdds; tracker: NonNullable<LiveInfo['tracker']> }) {
  const points = tracker.ball.length > 0 ? tracker.ball : [[50, 50] as [number, number]];
  const at = (index: number) => points[Math.min(index, points.length - 1)];
  const ball = Object.fromEntries(
    Array.from({ length: 6 }, (_, index) => [[`--x${index}`, `${at(index)[0]}%`], [`--y${index}`, `${at(index)[1]}%`]]).flat(),
  ) as CSSProperties;

  return (
    <div className="m-pitch" role="img" aria-label={tracker.status}>
      <svg viewBox="0 0 368 136" preserveAspectRatio="none" aria-hidden="true">
        <rect x="8" y="8" width="352" height="120" />
        <path d="M184 8v120" />
        <circle cx="184" cy="68" r="20" />
        <circle cx="184" cy="68" r="2" className="dot" />
        <rect x="8" y="34" width="44" height="68" />
        <rect x="8" y="52" width="16" height="32" />
        <rect x="316" y="34" width="44" height="68" />
        <rect x="344" y="52" width="16" height="32" />
      </svg>
      <span className={`m-zone ${tracker.attacking === 'home' ? 'right' : 'left'}`} aria-hidden="true" />
      <span className="m-ball halo" style={ball} aria-hidden="true" />
      <span className="m-ball" style={ball} aria-hidden="true" />
      <span className="m-pitch-chip"><i aria-hidden="true" />{tracker.status}</span>
      <span className="m-pitch-end left">{crestInitials(odds.event.homeTeam)} →</span>
      <span className="m-pitch-end right">← {crestInitials(odds.event.awayTeam)}</span>
    </div>
  );
}

/* ----------------------------------------------------------------- markets */

function useSelectFromMarket(odds: EventOdds) {
  const slip = useBetSlip();
  return (market: Market, selection: Selection) => {
    const pick: SlipPick = {
      eventId: odds.event.providerEventId,
      sportKey: odds.event.sportKey,
      marketKey: market.key,
      marketName: market.name,
      selectionKey: selection.key,
      selectionName: selection.name,
      ...(selection.point === undefined ? {} : { point: selection.point }),
      homeTeam: odds.event.homeTeam,
      awayTeam: odds.event.awayTeam,
      startTime: odds.event.startTime,
      displayedOdds: selection.price,
    };
    slip.toggle(pick);
  };
}

function MarketCard({ odds, market, suspended, stale, open, onToggle }: {
  odds: EventOdds; market: Market; suspended: boolean; stale: boolean; open: boolean; onToggle: () => void;
}) {
  const slip = useBetSlip();
  const select = useSelectFromMarket(odds);
  // Three-way markets get three columns; everything else is a two-column grid.
  const cols = market.key === 'h2h' && market.selections.length === 3 ? 3 : 2;

  return (
    <section className="m-market" aria-label={market.name}>
      <button type="button" className="m-market-head" aria-expanded={open} onClick={onToggle}>
        <span>{market.name}</span>
        <IconChevron className={`m-chevron${open ? '' : ' shut'}`} />
      </button>
      {open && (
        <div className={`m-odds card m-market-grid cols-${cols}`}>
          {market.selections.map((selection) => (
            <OddsButton
              key={selection.key}
              label={selection.point ? `${selection.name} ${selection.point}` : selection.name}
              price={selection.price}
              selected={slip.ids.has(pickId({
                eventId: odds.event.providerEventId, marketKey: market.key, selectionKey: selection.key,
              }))}
              suspended={suspended}
              stale={stale}
              describe={`${selection.name} in ${market.name}`}
              onSelect={() => select(market, selection)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** Shown only for markets the platform lists but cannot place (corners); preview data only. */
function ExtraMarketCard({ market, open, onToggle }: {
  market: NonNullable<ReturnType<typeof useMatchExtras>['corners']>[number]; open: boolean; onToggle: () => void;
}) {
  return (
    <section className="m-market" aria-label={market.name}>
      <button type="button" className="m-market-head" aria-expanded={open} onClick={onToggle}>
        <span>{market.name}</span>
        {market.note && <small>{market.note}</small>}
        <IconChevron className={`m-chevron${open ? '' : ' shut'}`} />
      </button>
      {open && (
        <div className={`m-odds card m-market-grid cols-${market.cols}`}>
          {market.cells.map((cell) => (
            <OddsButton key={cell.label} label={cell.label} price={cell.price} selected={false} onSelect={() => undefined} />
          ))}
        </div>
      )}
    </section>
  );
}

/* ----------------------------------------------------------------- bet builder */

function BuilderPanel({ odds, legs }: { odds: EventOdds; legs: NonNullable<ReturnType<typeof useMatchExtras>['builder']> }) {
  const slip = useBetSlip();
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(legs.slice(0, 2).map((leg) => leg.id)));
  const chosen = legs.filter((leg) => ticked.has(leg.id));
  // The combined price is the slip's own multiplication, shown as an estimate.
  const combined = chosen.reduce((total, leg) => total * Number(leg.price), 1);

  const toggle = (id: string) => setTicked((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const add = () => {
    for (const leg of chosen) {
      const pick: SlipPick = {
        eventId: odds.event.providerEventId, sportKey: odds.event.sportKey, marketKey: 'builder', marketName: leg.note,
        selectionKey: leg.id, selectionName: leg.name, homeTeam: odds.event.homeTeam, awayTeam: odds.event.awayTeam,
        startTime: odds.event.startTime, displayedOdds: leg.price,
      };
      if (!slip.ids.has(pickId(pick))) slip.toggle(pick);
    }
  };

  return (
    <section className="m-market builder" aria-label="Bet Builder">
      <div className="m-builder-intro">
        <strong>Build your own bet</strong>
        <span>Combine picks from this match into one price.</span>
      </div>
      {legs.map((leg) => {
        const on = ticked.has(leg.id);
        return (
          <button key={leg.id} type="button" role="checkbox" aria-checked={on} className="m-leg" onClick={() => toggle(leg.id)}>
            <span className={`m-box${on ? ' on' : ''}`} aria-hidden="true">{on ? '✓' : ''}</span>
            <span className="m-leg-text"><b>{leg.name}</b><small>{leg.note}</small></span>
            <span className="m-leg-price">{formatOdds(leg.price)}</span>
          </button>
        );
      })}
      <div className="m-builder-foot">
        <div><small>{chosen.length} {chosen.length === 1 ? 'pick' : 'picks'}</small><b>{chosen.length > 0 ? formatOdds(combined) : '—'}</b></div>
        <button type="button" className="m-add" disabled={chosen.length === 0} onClick={add}>
          {chosen.length === 0 ? 'Select picks' : 'Add to slip'}
        </button>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- stats */

function StatsPanel({ odds, stats }: { odds: EventOdds; stats: NonNullable<LiveInfo['stats']> }) {
  return (
    <section className="m-stats" aria-label="Match stats">
      <div className="m-stats-head"><span>{odds.event.homeTeam}</span><span>{odds.event.awayTeam}</span></div>
      {stats.map((stat) => (
        <div key={stat.name} className="m-stat">
          <div><b>{stat.home}{stat.suffix ?? ''}</b><span>{stat.name}</span><b className="away">{stat.away}{stat.suffix ?? ''}</b></div>
          <div className="m-bar"><i style={{ flex: stat.home }} /><i className="away" style={{ flex: stat.away }} /></div>
        </div>
      ))}
    </section>
  );
}

/* ----------------------------------------------------------------- screen */

export function MobileMatchSkeleton() {
  return (
    <div className="m-match" aria-busy="true" aria-label="Loading match">
      <span className="skeleton m-skel-hero" />
      <span className="skeleton m-skel-tabs" />
      {[0, 1, 2].map((index) => <span key={index} className="skeleton m-skel-market" />)}
    </div>
  );
}

/**
 * The phone match page.
 *
 * Markets are exactly the ones the feed returned for this event. The score,
 * clock, tracker, possession, stats, corners, builder legs and boosted price
 * each appear only when their data is supplied - today the platform supplies
 * none of them, so a started event shows its prices suspended and nothing else.
 */
export function MobileMatch({ eventId, sportKey }: { eventId: string; sportKey: string | undefined }) {
  const hydrated = useHydrated();
  if (!hydrated) return <MobileMatchSkeleton />;
  if (!sportKey) {
    return (
      <div className="empty-state">
        <strong>This event link is incomplete.</strong>
        <span>Open the event from the sportsbook so its sport is known.</span>
        <Link className="btn btn-sm" href="/sports">Back to sports</Link>
      </div>
    );
  }
  return <MatchScreen eventId={eventId} sportKey={sportKey} />;
}

function MatchScreen({ eventId, sportKey }: { eventId: string; sportKey: string }) {
  const query = useEventOdds(sportKey, eventId);
  const odds = query.data;
  const infoMap = useLiveInfoMap();
  const extras = useMatchExtras();
  const offers = useBoostedOffers();
  const favourite = useFavourites('event');
  const [tab, setTab] = useState<TabId>('popular');
  const [shut, setShut] = useState<ReadonlySet<string>>(new Set());

  const live = odds ? isLive(odds.event) : false;
  const stale = isStale(odds?.staleAt);
  const info = infoMap[eventId];
  const error = query.error instanceof ApiError ? query.error : undefined;
  const fav = favourite.has(eventId);

  const toggleMarket = (id: string) => setShut((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const markets = odds?.markets ?? [];
  const popular = markets.filter((market) => market.key !== 'totals');
  const totals = markets.filter((market) => market.key === 'totals');
  const offer = offers.find((entry) => entry.eventId === eventId);

  // A tab exists only if there is something real to put in it.
  const tabs = useMemo(() => {
    const list: { id: TabId; label: string; isNew?: boolean }[] = [{ id: 'popular', label: 'Popular' }];
    if (extras.builder?.length) list.push({ id: 'builder', label: 'Bet Builder', isNew: true });
    if (totals.length) list.push({ id: 'goals', label: countsGoals(sportKey) ? 'Goals' : 'Totals' });
    if (extras.corners?.length) list.push({ id: 'corners', label: 'Corners' });
    if (info?.stats?.length) list.push({ id: 'stats', label: 'Stats' });
    return list;
  }, [extras.builder, extras.corners, info?.stats, totals.length, sportKey]);
  const current = tabs.some((entry) => entry.id === tab) ? tab : 'popular';

  const backHref = live ? '/live' : `/sports?sport=${encodeURIComponent(sportKey)}`;

  return (
    <div className="m-match">
      <header className="m-match-bar">
        <Link className="m-bar-btn" href={backHref} aria-label={live ? 'Back to live' : 'Back to sports'}><IconBack /></Link>
        <div className="m-match-title">
          <strong>{odds ? `${odds.event.homeTeam} v ${odds.event.awayTeam}` : 'Match'}</strong>
          {odds && <span>{odds.event.competitionName ?? odds.event.sportName}</span>}
        </div>
        <button
          type="button"
          className={`m-bar-btn m-star${fav ? ' on' : ''}`}
          aria-pressed={fav}
          aria-label={fav ? 'Remove from favourites' : 'Add to favourites'}
          onClick={() => favourite.toggle(eventId)}
        >
          <IconStar filled={fav} />
        </button>
      </header>

      {query.isPending && <MobileMatchSkeleton />}

      {error && (
        <div className="empty-state">
          <strong>{describeSportsError(error.code, 'Sports data temporarily unavailable.')}</strong>
          <span>Prices for this event could not be loaded.</span>
          <button type="button" className="btn btn-sm" onClick={() => void query.refetch()}>Retry</button>
        </div>
      )}

      {odds && (
        <>
          <Hero odds={odds} info={info} live={live} />

          {tabs.length > 1 && (
            <nav role="tablist" aria-label="Markets" className="m-market-tabs m-scroll">
              {tabs.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={current === entry.id}
                  onClick={() => setTab(entry.id)}
                >
                  {entry.label}
                  {entry.isNew && <em>NEW</em>}
                </button>
              ))}
            </nav>
          )}

          <div className="m-market-list">
            {live && (
              <p className="m-note" role="status">
                This event has started. In-play betting is not offered, so its prices are shown for reference only and cannot be added to a slip.
              </p>
            )}
            {stale && <p className="m-note warn" role="status">Prices may be out of date — refreshing.</p>}

            {offer && current === 'popular' && (
              <section className="m-boost-strip" aria-label="Boosted price">
                <div>
                  <span className="m-pill boost"><IconBolt />Boosted</span>
                  <strong>{offer.headline}</strong>
                  <small>Was <s>{formatOdds(offer.was)}</s></small>
                </div>
                <div className="m-odds card"><button type="button" className="odds-button" aria-label={`Boosted price ${formatOdds(offer.now)}`}>
                  <span className="odds-price"><IconBolt />{formatOdds(offer.now)}</span>
                </button></div>
              </section>
            )}

            {current === 'popular' && popular.map((market) => (
              <MarketCard
                key={market.key} odds={odds} market={market} suspended={live} stale={stale}
                open={!shut.has(`p.${market.key}`)} onToggle={() => toggleMarket(`p.${market.key}`)}
              />
            ))}
            {current === 'goals' && totals.map((market) => (
              <MarketCard
                key={market.key} odds={odds} market={market} suspended={live} stale={stale}
                open={!shut.has(`g.${market.key}`)} onToggle={() => toggleMarket(`g.${market.key}`)}
              />
            ))}
            {current === 'corners' && extras.corners?.map((market) => (
              <ExtraMarketCard key={market.id} market={market} open={!shut.has(`c.${market.id}`)} onToggle={() => toggleMarket(`c.${market.id}`)} />
            ))}
            {current === 'builder' && extras.builder && <BuilderPanel odds={odds} legs={extras.builder} />}
            {current === 'stats' && info?.stats && <StatsPanel odds={odds} stats={info.stats} />}

            {markets.length === 0 && (
              <div className="empty-state">
                <strong>No markets are available for this event.</strong>
                <span>The feed returned no prices from the primary bookmaker.</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
