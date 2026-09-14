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
  // The real number of normalized markets on this event — never a guess, and
  // never a selection count dressed up as a market count (§1).
  const marketCount = row.markets.length;
  const eventId = event.internalEventId ?? event.providerEventId;

  // Secondary primary markets shown inline beside 1/X/2, only where the
  // provider actually priced them.
  const totals = row.markets.find((market) => market.key === 'totals');
  const btts = row.markets.find((market) => market.key === 'btts');
  const over = totals?.selections.find((selection) => selection.key === 'over');
  const under = totals?.selections.find((selection) => selection.key === 'under');
  // Only cells the provider actually priced are rendered; a missing side leaves
  // the group out entirely rather than showing an empty slot.
  const overUnderCells = [
    over ? { selection: over, label: `O ${over.point ?? ''}`.trim() } : null,
    under ? { selection: under, label: `U ${under.point ?? ''}`.trim() } : null,
  ].filter((cell): cell is { selection: Selection; label: string } => cell !== null);

  const bttsCells = [
    btts?.selections.find((selection) => selection.key === 'yes') ? { selection: btts.selections.find((s) => s.key === 'yes')!, label: 'Yes' } : null,
    btts?.selections.find((selection) => selection.key === 'no') ? { selection: btts.selections.find((s) => s.key === 'no')!, label: 'No' } : null,
  ].filter((cell): cell is { selection: Selection; label: string } => cell !== null);

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
            {event.competitionName && <span className="event-competition">{event.competitionName}</span>}
            <Link
              href={`/sports/event/${encodeURIComponent(eventId)}?sport=${encodeURIComponent(event.sportKey)}`}
              className="event-more-markets"
            >
              {marketCount > 0 ? `+${marketCount} Markets` : 'Event details'}
            </Link>
          </span>
        </div>
      </div>

      <div className="event-odds">
        {/*
          A fixture the feed returned with no book at all is real, but three
          phantom "—" cells imply prices that were never offered and stretch the
          board with dead rows. One muted note is honest and far denser.
        */}
        {row.markets.length === 0 && (
          <span className="event-no-prices">No prices yet</span>
        )}

        {row.markets.length > 0 && (
        <div className="odds-group" role="group" aria-label="Match result">
          {cells.map((selection, index) => (
            <OddsButton
              key={selection?.key ?? `empty-${index}`}
              label={H2H_LABELS[index]}
              price={selection?.price ?? null}
              selected={selection ? slip.ids.has(pickId({ eventId, marketKey: 'h2h', selectionKey: selection.key })) : false}
              // A started event is refused by the backend, so its prices show
              // as suspended rather than as something a player can take. The
              // market's own flags are honoured too, so a provider suspension
              // disables the cell without waiting for a rejected placement.
              suspended={live || h2h?.suspended === true || selection?.suspended === true}
              disabled={h2h !== undefined && h2h.bettable === false}
              stale={stale}
              describe={selection ? `${selection.name}, ${event.homeTeam} v ${event.awayTeam}` : undefined}
              onSelect={() => { if (selection && h2h) select(selection, 'h2h', h2h.name); }}
            />
          ))}
        </div>
        )}

        {overUnderCells.length > 0 && (
          <div className="odds-group" role="group" aria-label="Total goals">
            {overUnderCells.map(({ selection, label }) => (
              <OddsButton
                key={`ou-${selection.key}`}
                label={label}
                price={selection.price}
                selected={slip.ids.has(pickId({ eventId, marketKey: 'totals', selectionKey: selection.key }))}
                suspended={live || totals?.suspended === true || selection.suspended === true}
                disabled={totals?.bettable === false}
                stale={stale}
                describe={`${selection.name}, ${event.homeTeam} v ${event.awayTeam}`}
                onSelect={() => { if (totals) select(selection, 'totals', totals.name); }}
              />
            ))}
          </div>
        )}

        {bttsCells.length > 0 && (
          <div className="odds-group" role="group" aria-label="Both teams to score">
            {bttsCells.map(({ selection, label }) => (
              <OddsButton
                key={`btts-${selection.key}`}
                label={label}
                price={selection.price}
                selected={slip.ids.has(pickId({ eventId, marketKey: 'btts', selectionKey: selection.key }))}
                suspended={live || btts?.suspended === true || selection.suspended === true}
                disabled={btts?.bettable === false}
                stale={stale}
                describe={`Both teams to score ${label}, ${event.homeTeam} v ${event.awayTeam}`}
                onSelect={() => { if (btts) select(selection, 'btts', btts.name); }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const EventRow = memo(EventRowBase);
