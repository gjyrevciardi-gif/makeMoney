'use client';

import Link from 'next/link';
import { memo, useCallback } from 'react';
import { formatDay, formatTime } from '../../lib/format';
import { pickId, useBetSlip, type SlipPick } from '../../lib/bet-slip';
import { h2hCells, isLive, type BoardEvent, type Selection } from '../../lib/sports';
import { OddsButton } from './odds-button';

/** Labels for the three primary cells. Football keeps 1 / X / 2. */
const H2H_LABELS = ['1', 'X', '2'];

type EventRowProps = { row: BoardEvent; stale: boolean };

/**
 * One compact fixture row: time, teams, and the primary market's prices.
 *
 * Only data the backend actually returned is rendered. There is no invented
 * score, clock or market count anywhere in this component.
 */
function EventRowBase({ row, stale }: EventRowProps) {
  const slip = useBetSlip();
  const { event } = row;
  const live = isLive(event);
  const cells = h2hCells(row);
  const marketCount = row.markets.reduce((total, market) => total + market.selections.length, 0);

  const select = useCallback((selection: Selection, marketKey: string, marketName: string) => {
    const pick: SlipPick = {
      eventId: event.providerEventId,
      sportKey: event.sportKey,
      marketKey,
      marketName,
      selectionKey: selection.key,
      selectionName: selection.name,
      ...(selection.point === undefined ? {} : { point: selection.point }),
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
      startTime: event.startTime,
      displayedOdds: selection.price,
    };
    slip.toggle(pick);
  }, [event, slip]);

  const h2h = row.markets.find((market) => market.key === 'h2h');

  return (
    <div className="event-row">
      <div className="event-main">
        <div className="event-time">
          {live ? (
            <span className="pill live"><span className="live-dot" />Live</span>
          ) : (
            <>
              <b>{formatTime(event.startTime)}</b>
              <span>{formatDay(event.startTime)}</span>
            </>
          )}
        </div>

        <div className="event-teams">
          <span className="event-team">
            <span className="event-team-name">{event.homeTeam}</span>
          </span>
          <span className="event-team">
            <span className="event-team-name">{event.awayTeam}</span>
          </span>
          <span className="event-meta-line">
            <Link
              href={`/sports/event/${encodeURIComponent(event.providerEventId)}?sport=${encodeURIComponent(event.sportKey)}`}
            >
              {marketCount > 0 ? `${marketCount} selections` : 'Event details'}
            </Link>
            {live && <span>In-play betting is not offered</span>}
          </span>
        </div>
      </div>

      <div className="event-odds">
        {cells.map((selection, index) => (
          <OddsButton
            key={selection?.key ?? `empty-${index}`}
            label={H2H_LABELS[index]}
            price={selection?.price ?? null}
            selected={selection ? slip.ids.has(pickId({
              eventId: event.providerEventId,
              marketKey: 'h2h',
              selectionKey: selection.key,
            })) : false}
            // A started event is refused by the backend, so its prices are
            // presented as suspended rather than as something a player can take.
            suspended={live}
            stale={stale}
            describe={selection ? `${selection.name}, ${event.homeTeam} v ${event.awayTeam}` : undefined}
            onSelect={() => { if (selection && h2h) select(selection, 'h2h', h2h.name); }}
          />
        ))}
      </div>
    </div>
  );
}

export const EventRow = memo(EventRowBase);
