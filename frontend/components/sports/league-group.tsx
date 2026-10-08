'use client';

import { useState } from 'react';
import { IconChevron } from '../shell/icons';
import type { BoardEvent } from '../../lib/sports';
import { EventRow } from './event-row';

/**
 * A competition and its fixtures as one dense block.
 *
 * Deliberately not one card per match: a header plus separated rows fits far
 * more of a league on screen and is how a sportsbook is actually scanned.
 */
export function LeagueGroup({
  name, region, events, stale, defaultOpen = true,
}: {
  name: string;
  region?: string;
  events: BoardEvent[];
  stale: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const headingId = `league-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  return (
    <section className="league" aria-labelledby={headingId}>
      <button
        type="button"
        className="league-head"
        aria-expanded={open}
        aria-controls={`${headingId}-body`}
        onClick={() => setOpen((value) => !value)}
      >
        <IconChevron className="league-chevron" />
        <span>
          <span className="league-name" id={headingId}>{name}</span>
          {region && <span className="league-region"> · {region}</span>}
        </span>
        <span className="league-count">{events.length}</span>
      </button>

      {open && (
        <div id={`${headingId}-body`}>
          {/*
            The legend mirrors the odds area's own structure so its headings sit
            over the columns they name. Only the match-result group is labelled:
            the secondary groups vary per fixture, and their prices carry their
            own labels ("O 2.5", "Yes"), so a fixed heading would end up over the
            wrong column on any row that lacks them.
          */}
          <div className="market-legend">
            <span className="legend-spacer">Match result</span>
            <span className="legend-odds">
              <span className="legend-cells"><span>1</span><span>X</span><span>2</span></span>
            </span>
          </div>
          {events.map((row) => (
            <EventRow key={row.event.providerEventId} row={row} stale={stale} />
          ))}
        </div>
      )}
    </section>
  );
}
