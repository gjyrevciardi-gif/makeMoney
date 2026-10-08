'use client';

import { useState } from 'react';
import { formatOdds } from '../../lib/format';

export type TicketLeg = {
  id: string;
  sportKey: string;
  homeTeam: string;
  awayTeam: string;
  marketName: string;
  selectionName: string;
  marketPoint?: string | null;
  acceptedOdds: string;
  status: string;
  eventStartTime: string;
  finalHomeScore?: number | null;
  finalAwayScore?: number | null;
};

export type TicketBet = {
  id: string;
  type: 'SINGLE' | 'ACCUMULATOR';
  status: 'OPEN' | 'WON' | 'LOST' | 'VOID' | 'CANCELLED';
  stake: string;
  totalOdds: string;
  finalOdds?: string | null;
  potentialPayout: string;
  actualPayout?: string | null;
  createdAt: string;
  settledAt?: string | null;
  legs: TicketLeg[];
};

const PTS = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pts = (value: string | number | null | undefined) => `${PTS.format(Number(value ?? 0))} PTS`;

const part = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', options).format(new Date(iso));

const stamp = (iso: string) =>
  `${part(iso, { weekday: 'short' })} ${part(iso, { day: '2-digit' })} ${part(iso, { month: 'short' })} ${part(iso, { hour: '2-digit', minute: '2-digit', hour12: false })}`;
const legDay = (iso: string) => `${part(iso, { weekday: 'short' })} ${part(iso, { month: 'short' })} ${part(iso, { day: 'numeric' })}`;
const legTime = (iso: string) => part(iso, { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();

type Mark = 'won' | 'lost' | 'void' | 'pending';
const markOf = (status: string): Mark =>
  status === 'WON' ? 'won' : status === 'LOST' ? 'lost' : status === 'VOID' || status === 'CANCELLED' ? 'void' : 'pending';
const MARK_LABEL: Record<Mark, string> = { won: 'Won', lost: 'Lost', void: 'Void', pending: 'Pending' };

function StatusMark({ mark }: { mark: Mark }) {
  return (
    <span className={`ticket-mark ${mark}`} role="img" aria-label={MARK_LABEL[mark]}>
      {mark === 'won' && <svg viewBox="0 0 24 24"><path d="m6.5 12.5 3.8 3.8 7.2-8" /></svg>}
      {mark === 'lost' && <svg viewBox="0 0 24 24"><path d="m8 8 8 8M16 8l-8 8" /></svg>}
      {mark === 'void' && <svg viewBox="0 0 24 24"><path d="M7.5 12h9" /></svg>}
    </span>
  );
}

/**
 * A ticket as the server recorded it.
 *
 * Every figure and every leg status is read from the bet payload. The client
 * never settles, re-prices or derives a result: a status it does not recognise
 * is shown as pending.
 */
export function SettledTicket({ bet }: { bet: TicketBet }) {
  const [note, setNote] = useState('');
  const settled = bet.status !== 'OPEN';
  const title = bet.type === 'SINGLE' ? 'Single' : `${bet.legs.length} Leg Parlay`;
  const returnLabel = !settled ? 'To Return' : 'Returned';
  const returnValue = !settled ? bet.potentialPayout : bet.actualPayout ?? 0;

  async function share() {
    const text = `${title} · ${pts(bet.stake)} · Fool's Gold`;
    try {
      if (navigator.share) await navigator.share({ title: "Fool's Gold ticket", text });
      else { await navigator.clipboard.writeText(text); setNote('Copied'); setTimeout(() => setNote(''), 1800); }
    } catch { /* the viewer dismissed the share sheet */ }
  }

  return (
    <section className="ticket-frame" aria-label={`${title}, ${bet.status.toLowerCase()}`}>
      <div className="ticket-top">
        <time dateTime={bet.createdAt}>{stamp(bet.createdAt)}</time>
        <span className="ref-brand">Fool&apos;s<b>Gold</b></span>
      </div>

      <article className="ticket">
        <header className="ticket-head">
          <h3><span>{pts(bet.stake)}</span> {title}</h3>
          <button type="button" onClick={() => void share()}>{note || 'Share'}</button>
        </header>

        {bet.legs.map((leg) => {
          const mark = markOf(leg.status);
          return (
            <div className="ticket-leg" key={leg.id}>
              <div className="ticket-leg-title">
                <StatusMark mark={mark} />
                <strong>{leg.selectionName}{leg.marketPoint ? ` ${leg.marketPoint}` : ''}</strong>
                <span>{formatOdds(leg.acceptedOdds)}</span>
                {mark === 'void' && <em>VOID</em>}
              </div>
              <p className="ticket-leg-market">{leg.marketName}</p>
              <div className="ticket-leg-event">
                <div>
                  <span>{leg.homeTeam}</span>
                  <span>{leg.awayTeam}</span>
                </div>
                <div className="when">
                  <span>{legDay(leg.eventStartTime)}</span>
                  <span>{legTime(leg.eventStartTime)}</span>
                </div>
              </div>
            </div>
          );
        })}

        <footer className="ticket-foot">
          <div><span>Wager</span><strong>{pts(bet.stake)}</strong></div>
          <div className="right"><span>{returnLabel}</span><strong>{pts(returnValue)}</strong></div>
        </footer>
        <div className="ticket-cashout" aria-disabled="true">Cash Out Unavailable</div>
      </article>
    </section>
  );
}
