'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { formatOdds } from '../../lib/format';

export type OddsButtonState = 'DEFAULT' | 'SELECTED' | 'SUSPENDED' | 'STALE' | 'DISABLED';

type OddsButtonProps = {
  label: string;
  price: string | null | undefined;
  selected: boolean;
  /** The market or event is not bettable right now. */
  suspended?: boolean;
  /** The backend's freshness window for this price has passed. */
  stale?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  /** Screen-reader description, e.g. "Arsenal to win Arsenal v Chelsea". */
  describe?: string;
};

/**
 * The one odds control in the product.
 *
 * States are DEFAULT, HOVER, SELECTED, ODDS_UP, ODDS_DOWN, SUSPENDED, STALE and
 * DISABLED. It is a real `<button>` with `aria-pressed`, so it is reachable and
 * operable from the keyboard, and selection is signalled by a tick and the
 * pressed state as well as by colour.
 *
 * Price movement is derived by comparing the incoming price with the previous
 * render's - it is a transient flash, never stored.
 */
function OddsButtonBase({
  label, price, selected, suspended = false, stale = false, disabled = false, onSelect, describe,
}: OddsButtonProps) {
  const [move, setMove] = useState<'up' | 'down' | null>(null);
  const previous = useRef<string | null | undefined>(price);

  useEffect(() => {
    const before = previous.current;
    previous.current = price;
    if (before === undefined || before === null || price === undefined || price === null) return;
    if (before === price) return;

    const direction = Number(price) > Number(before) ? 'up' : 'down';
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    setMove(direction);
    // The indication is deliberately short-lived; movement is not remembered.
    const timer = setTimeout(() => setMove(null), 1600);
    return () => clearTimeout(timer);
  }, [price]);

  if (price === null || price === undefined) {
    return <span className="odds-empty" aria-hidden="true">—</span>;
  }

  const unavailable = suspended || disabled;
  const classes = ['odds-button'];
  if (move) classes.push(move);
  if (stale && !unavailable) classes.push('stale');
  if (suspended) classes.push('suspended');

  return (
    <button
      type="button"
      className={classes.join(' ')}
      aria-pressed={selected}
      disabled={unavailable}
      onClick={onSelect}
      title={suspended ? 'Suspended' : stale ? 'Price may be out of date' : undefined}
    >
      {move && (
        <span className="odds-move" aria-hidden="true">{move === 'up' ? '▲' : '▼'}</span>
      )}
      <span className="odds-label">{label}</span>
      <span className="odds-price">{formatOdds(price)}</span>
      <span className="sr-only">
        {describe ? `${describe}. ` : ''}
        {suspended ? 'Suspended. ' : ''}
        {stale && !suspended ? 'Price may be out of date. ' : ''}
        {selected ? 'Selected.' : ''}
      </span>
    </button>
  );
}

/**
 * Memoised on its own props, so one price ticking re-renders one cell rather
 * than the whole board.
 */
export const OddsButton = memo(OddsButtonBase);
