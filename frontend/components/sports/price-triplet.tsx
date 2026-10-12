'use client';

import { pickId, useBetSlip } from '../../lib/bet-slip';
import { findMarket, h2hCells, isLive, type BoardEvent } from '../../lib/sports';
import { useSelectPick } from './match-list';
import { OddsButton } from './odds-button';

const LABELS = ['1', 'X', '2'];

/**
 * The 1 / X / 2 prices for one event, as phone-sized odds buttons.
 *
 * Football keeps the draw; sports without one leave the middle cell empty
 * rather than padding it with an invented price (or, in `compact` live rows,
 * drop it). A started event is shown as suspended, because the backend refuses it.
 */
export function PriceTriplet({ row, card = false, stale = false, compact = false }: {
  row: BoardEvent;
  card?: boolean;
  stale?: boolean;
  /** Live rows: drop an empty draw cell so a two-way sport shows two prices. */
  compact?: boolean;
}) {
  const slip = useBetSlip();
  const select = useSelectPick();
  const { event } = row;
  const live = isLive(event);
  const all = h2hCells(row);
  const h2h = findMarket(row.markets, 'h2h');
  const shown = compact && all[1] === null ? [0, 2] : [0, 1, 2];

  return (
    <div
      role="group"
      aria-label={`${event.homeTeam} v ${event.awayTeam}, match result`}
      className={`m-odds m-triplet${card ? ' card' : ''}${compact ? ' compact' : ''}`}
    >
      {shown.map((index) => {
        const selection = all[index];
        return (
          <OddsButton
            key={selection?.key ?? `empty-${index}`}
            label={LABELS[index]}
            price={selection?.price ?? null}
            selected={selection ? slip.ids.has(pickId({
              eventId: event.providerEventId,
              marketKey: 'h2h',
              selectionKey: selection.key,
            })) : false}
            suspended={live}
            stale={stale}
            describe={selection ? `${selection.name}, ${event.homeTeam} v ${event.awayTeam}` : undefined}
            onSelect={() => { if (selection && h2h) select(row, selection, 'h2h', h2h.name); }}
          />
        );
      })}
    </div>
  );
}
