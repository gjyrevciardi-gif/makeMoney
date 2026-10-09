'use client';

import Link from 'next/link';
import { memo, useCallback, useMemo } from 'react';
import { formatTime } from '../../lib/format';
import { pickId, useBetSlip, type SlipPick } from '../../lib/bet-slip';
import { h2hCells, isLive, type BoardEvent, type Selection } from '../../lib/sports';
import { OddsButton } from './odds-button';

const LABELS = ['1', 'X', '2'];

const dayHeading = (iso: string) => {
  const date = new Date(iso);
  const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', options).format(date);
  return `${part({ weekday: 'short' })} ${part({ day: '2-digit' })} ${part({ month: 'short' })}`;
};

const Dot = ({ name }: { name: string }) => (
  <span className="ref-team-dot" aria-hidden="true">{name.charAt(0).toUpperCase()}</span>
);

/** Builds the slip pick for one price. The displayed price is only a hint: the server re-prices on placement. */
export function useSelectPick() {
  const slip = useBetSlip();
  return useCallback((row: BoardEvent, selection: Selection, marketKey: string, marketName: string) => {
    const { event } = row;
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
  }, [slip]);
}

const MatchRow = memo(function MatchRow({ row, stale }: { row: BoardEvent; stale: boolean }) {
  const slip = useBetSlip();
  const select = useSelectPick();
  const { event } = row;
  const live = isLive(event);
  const cells = h2hCells(row);
  const h2h = row.markets.find((market) => market.key === 'h2h');
  const selections = row.markets.reduce((total, market) => total + market.selections.length, 0);

  return (
    <article className="ref-match">
      <div className="ref-match-info">
        <span className="ref-team"><Dot name={event.homeTeam} />{event.homeTeam}</span>
        <span className="ref-team"><Dot name={event.awayTeam} />{event.awayTeam}</span>
        <span className="ref-match-league">{event.competitionName ?? event.sportName}</span>
        <span className="ref-match-chips">
          {live
            ? <span className="ref-chip live">Live</span>
            : <span className="ref-chip">{formatTime(event.startTime)}</span>}
          {selections > 0 && (
            <Link
              className="ref-chip green"
              aria-label={`${selections} selections for ${event.homeTeam} v ${event.awayTeam}`}
              href={`/sports/event/${encodeURIComponent(event.providerEventId)}?sport=${encodeURIComponent(event.sportKey)}`}
            >
              {selections}»
            </Link>
          )}
        </span>
      </div>

      <div className="ref-match-odds">
        {cells.map((selection, index) => (
          <OddsButton
            key={selection?.key ?? `empty-${index}`}
            label={LABELS[index]}
            price={selection?.price ?? null}
            selected={selection ? slip.ids.has(pickId({
              eventId: event.providerEventId,
              marketKey: 'h2h',
              selectionKey: selection.key,
            })) : false}
            // A started event is refused by the backend, so its prices are shown as suspended.
            suspended={live}
            stale={stale}
            describe={selection ? `${selection.name}, ${event.homeTeam} v ${event.awayTeam}` : undefined}
            onSelect={() => { if (selection && h2h) select(row, selection, 'h2h', h2h.name); }}
          />
        ))}
      </div>
    </article>
  );
});

/** One competition: heading, then a date header row (1 / X / 2) before each day's fixtures. */
export function CompetitionBlock({ name, events, stale }: { name: string; events: BoardEvent[]; stale: boolean }) {
  const days = useMemo(() => {
    const map = new Map<string, BoardEvent[]>();
    for (const row of events) {
      const key = dayHeading(row.event.startTime);
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return [...map.entries()];
  }, [events]);
  const hasDraw = events.some((row) => h2hCells(row)[1] !== null);

  return (
    <section className="ref-competition" aria-label={name}>
      <h3 className="ref-competition-title">{name}<span aria-hidden="true"> ›</span></h3>
      {days.map(([day, rows]) => (
        <div key={day} className="ref-day">
          <div className="ref-day-head">
            <span>{day}</span>
            <span className="ref-day-cols"><span>1</span><span>{hasDraw ? 'X' : ''}</span><span>2</span></span>
          </div>
          {rows.map((row) => <MatchRow key={row.event.providerEventId} row={row} stale={stale} />)}
        </div>
      ))}
    </section>
  );
}
