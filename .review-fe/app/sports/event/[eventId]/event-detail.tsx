'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { ApiError } from '../../../../lib/api';
import { formatDateTime } from '../../../../lib/format';
import { pickId, useBetSlip, type SlipPick } from '../../../../lib/bet-slip';
import {
  describeSportsError,
  isLive,
  isStale,
  useEventOdds,
  type EventOdds,
  type Market,
  type Selection,
} from '../../../../lib/sports';
import { OddsButton } from '../../../../components/sports/odds-button';

/**
 * Market groups.
 *
 * Only groups that actually contain a market the feed returned are rendered -
 * an empty "Totals" heading is never shown for an event that has no totals.
 */
const GROUPS: { id: string; title: string; keys: Market['key'][] }[] = [
  { id: 'popular', title: 'Popular', keys: ['h2h'] },
  { id: 'totals', title: 'Totals', keys: ['totals'] },
  { id: 'spreads', title: 'Handicaps', keys: ['spreads'] },
];

function MarketBlock({ odds, market, suspended, stale }: {
  odds: EventOdds;
  market: Market;
  suspended: boolean;
  stale: boolean;
}) {
  const slip = useBetSlip();

  const select = (selection: Selection) => {
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

  return (
    <div className="market-grid">
      {market.selections.map((selection) => (
        <OddsButton
          key={selection.key}
          label={selection.point ? `${selection.name} ${selection.point}` : selection.name}
          price={selection.price}
          selected={slip.ids.has(pickId({
            eventId: odds.event.providerEventId,
            marketKey: market.key,
            selectionKey: selection.key,
          }))}
          suspended={suspended}
          stale={stale}
          describe={`${selection.name} in ${market.name}`}
          onSelect={() => select(selection)}
        />
      ))}
    </div>
  );
}

export function EventDetail({ eventId }: { eventId: string }) {
  const params = useSearchParams();
  const sportKey = params.get('sport') ?? undefined;
  const query = useEventOdds(sportKey, eventId);
  const odds = query.data;
  const stale = isStale(odds?.staleAt);
  const live = odds ? isLive(odds.event) : false;

  const groups = useMemo(() => {
    if (!odds) return [];
    return GROUPS
      .map((group) => ({
        ...group,
        markets: group.keys
          .map((key) => odds.markets.find((market) => market.key === key))
          .filter((market): market is Market => market !== undefined),
      }))
      .filter((group) => group.markets.length > 0);
  }, [odds]);

  const error = query.error instanceof ApiError ? query.error : undefined;

  if (!sportKey) {
    return (
      <div className="page">
        <div className="empty-state">
          <strong>This event link is incomplete.</strong>
          <span>Open the event from the sportsbook so its sport is known.</span>
          <Link className="btn btn-sm" href="/sports">Back to sports</Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="sb-shell-detail">
        <div className="sb-center">
          <div className="event-meta-line" style={{ marginBottom: 10 }}>
            <Link href={`/sports?sport=${encodeURIComponent(sportKey)}`}>← Back to {odds?.event.sportName ?? 'sportsbook'}</Link>
          </div>

          {query.isPending && (
            <div aria-busy="true">
              <span className="skeleton" style={{ height: 96, marginBottom: 14 }} />
              <span className="skeleton" style={{ height: 200 }} />
            </div>
          )}

          {error && (
            <div className="empty-state">
              <strong>{describeSportsError(error.code, 'Sports data temporarily unavailable.')}</strong>
              <span>Prices for this event could not be loaded.</span>
              <button type="button" className="btn btn-sm" onClick={() => void query.refetch()}>Retry</button>
            </div>
          )}

          {odds && (
            <>
              <header className="event-hero">
                <div className="event-hero-teams">
                  <span className="event-hero-meta">
                    {live
                      ? <span className="pill live"><span className="live-dot" />Live</span>
                      : <span className="pill">{formatDateTime(odds.event.startTime)}</span>}
                    <span>{odds.event.competitionName ?? odds.event.sportName}</span>
                  </span>
                  <h1>{odds.event.homeTeam} v {odds.event.awayTeam}</h1>
                  <span className="event-hero-meta">
                    <span>Prices from {odds.bookmaker.name}</span>
                    {stale && <span className="pill warn">Prices may be out of date</span>}
                  </span>
                </div>
              </header>

              {live && (
                <p className="alert warn" role="status" style={{ marginBottom: 12 }}>
                  This event has started. In-play betting is not offered, so its prices are shown
                  for reference only and cannot be added to a slip.
                </p>
              )}

              {groups.length === 0 && (
                <div className="empty-state">
                  <strong>No markets are available for this event.</strong>
                  <span>The feed returned no prices from the primary bookmaker.</span>
                </div>
              )}

              {groups.map((group, index) => (
                <details className="market-group" key={group.id} open={index < 2}>
                  <summary>
                    {group.title}
                    <span className="market-count">
                      {group.markets.reduce((total, market) => total + market.selections.length, 0)} selections
                    </span>
                  </summary>
                  <div className="market-body">
                    {group.markets.map((market) => (
                      <div key={market.key} style={{ marginBottom: 8 }}>
                        <p className="section-head" style={{ marginBottom: 6 }}>
                          <span>{market.name}</span>
                        </p>
                        <MarketBlock odds={odds} market={market} suspended={live} stale={stale} />
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </>
          )}
        </div>

      </div>

    </>
  );
}
