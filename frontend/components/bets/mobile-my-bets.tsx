'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatOdds, formatPoints } from '../../lib/format';
import { useHydrated } from '../../lib/hydrated';
import { useBets, useCashOutAction } from '../../lib/mobile';
import { invalidateAfterWagering, useSession } from '../../lib/queries';
import { IconCheck } from '../shell/icons';
import { foldName } from '../sports/mobile-slip';
import type { TicketBet, TicketLeg } from '../sports/settled-ticket';

type Tab = 'open' | 'settled';
type Mark = 'won' | 'lost' | 'void' | 'pending';

const markOf = (status: string): Mark =>
  status === 'WON' ? 'won' : status === 'LOST' ? 'lost' : status === 'VOID' || status === 'CANCELLED' ? 'void' : 'pending';
const MARK_LABEL: Record<Mark, string> = { won: 'Won', lost: 'Lost', void: 'Void', pending: 'Pending' };
const MARK_GLYPH: Record<Mark, string> = { won: '✓', lost: '×', void: '–', pending: '' };

const PILL: Record<TicketBet['status'], { label: string; tone: string }> = {
  OPEN: { label: 'Open', tone: 'open' },
  WON: { label: 'Won', tone: 'won' },
  LOST: { label: 'Lost', tone: 'lost' },
  VOID: { label: 'Void', tone: 'void' },
  CANCELLED: { label: 'Void', tone: 'void' },
};

const titleOf = (bet: TicketBet) => (bet.type === 'SINGLE' ? 'Single' : foldName(bet.legs.length));

function Leg({ leg }: { leg: TicketLeg }) {
  const mark = markOf(leg.status);
  return (
    <div className="m-bet-leg">
      <span className={`m-mark ${mark}`} role="img" aria-label={MARK_LABEL[mark]}>{MARK_GLYPH[mark]}</span>
      <span className="m-bet-leg-text">
        <span className="m-bet-leg-top">
          <b>{leg.selectionName}{leg.marketPoint ? ` ${leg.marketPoint}` : ''}</b>
          <i>{formatOdds(leg.acceptedOdds)}</i>
        </span>
        <small>{leg.marketName} · {leg.homeTeam} v {leg.awayTeam}</small>
      </span>
    </div>
  );
}

/**
 * Cash Out, with a live value that flashes when it moves and an inline confirm.
 * It is built only for a bet that carries a value, and only when an action to
 * perform it exists. The platform has neither today, so bets show
 * "Cash Out Unavailable" instead.
 */
function CashOut({ bet, perform }: { bet: TicketBet; perform: (betId: string) => Promise<void> }) {
  const client = useQueryClient();
  const value = bet.cashOutValue ?? '0';
  const [phase, setPhase] = useState<'idle' | 'confirming' | 'working' | 'done' | 'failed'>('idle');
  const [move, setMove] = useState<'up' | 'down' | null>(null);
  const shown = useRef(value);
  const cashedFor = useRef(value);

  useEffect(() => {
    const before = shown.current;
    shown.current = value;
    if (before === value || phase !== 'idle') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    setMove(Number(value) > Number(before) ? 'up' : 'down');
    const timer = setTimeout(() => setMove(null), 1600);
    return () => clearTimeout(timer);
  }, [value, phase]);

  const confirm = async () => {
    cashedFor.current = value;
    setPhase('working');
    try {
      await perform(bet.id);
      setPhase('done');
      // Let the "Cashed out" state be read before the bet leaves the Open list.
      setTimeout(() => invalidateAfterWagering(client), 2500);
    } catch {
      setPhase('failed');
    }
  };

  return (
    <div className="m-cash">
      {phase === 'idle' && (
        <button type="button" className={`m-cash-btn${move ? ` ${move}` : ''}`} onClick={() => setPhase('confirming')}>
          Cash Out <span>{formatPoints(value)} PTS</span>
          {move && <i aria-hidden="true">{move === 'up' ? '▲' : '▼'}</i>}
        </button>
      )}
      {(phase === 'confirming' || phase === 'working') && (
        <div className="m-cash-confirm">
          <span>Cash out now for <b>{formatPoints(value)} PTS</b>? This closes the bet.</span>
          <div>
            <button type="button" disabled={phase === 'working'} onClick={() => setPhase('idle')}>Keep bet</button>
            <button type="button" className="primary" disabled={phase === 'working'} onClick={() => void confirm()}>
              {phase === 'working' ? 'Cashing out…' : 'Confirm'}
            </button>
          </div>
        </div>
      )}
      {phase === 'done' && (
        <div className="m-cash-done" role="status"><IconCheck />Cashed out <span>{formatPoints(cashedFor.current)} PTS</span></div>
      )}
      {phase === 'failed' && (
        <div className="m-cash-confirm">
          <span className="bad">The cash-out did not go through. Your bet is unchanged.</span>
          <div><button type="button" onClick={() => setPhase('idle')}>Back</button></div>
        </div>
      )}
    </div>
  );
}

function BetCard({ bet, perform }: { bet: TicketBet; perform: ((betId: string) => Promise<void>) | undefined }) {
  const settled = bet.status !== 'OPEN';
  const pill = PILL[bet.status];
  const returned = settled ? bet.actualPayout ?? 0 : bet.potentialPayout;
  const odds = settled && bet.finalOdds ? bet.finalOdds : bet.totalOdds;

  return (
    <article className="m-bet" aria-label={`${titleOf(bet)}, ${pill.label.toLowerCase()}`}>
      <div className="m-bet-head">
        <strong>{titleOf(bet)}</strong>
        <span className="m-bet-odds">{formatOdds(odds)}</span>
        <span className={`m-status ${pill.tone}`}>{pill.label}</span>
      </div>
      {bet.legs.map((leg) => <Leg key={leg.id} leg={leg} />)}
      <div className="m-bet-money">
        <div><small>Stake</small><b>{formatPoints(bet.stake)} PTS</b></div>
        <div><small>{settled ? 'Returned' : 'To return'}</small><b className={bet.status === 'WON' ? 'won' : ''}>{formatPoints(returned)} PTS</b></div>
      </div>

      {!settled && (
        <div className="m-cash-slot">
          {bet.cashOutValue && perform
            ? <CashOut bet={bet} perform={perform} />
            : <div className="m-cash-off" aria-disabled="true">Cash Out Unavailable</div>}
        </div>
      )}

      <div className="m-bet-foot"><span>{formatDateTime(bet.createdAt)}</span><span>FG-{bet.id.slice(-8).toUpperCase()}</span></div>
    </article>
  );
}

export function MobileMyBetsSkeleton() {
  return (
    <div className="m-bets" aria-busy="true" aria-label="Loading your bets">
      <span className="skeleton m-skel-seg" />
      {[0, 1, 2].map((index) => <span key={index} className="skeleton m-skel-bet" />)}
    </div>
  );
}

/**
 * The phone My Bets screen.
 *
 * Every figure and every leg status is what the server recorded. The Settled
 * summary only adds up the settled bets that were loaded; it says so when the
 * list was cut off at the page limit.
 */
export function MobileMyBets() {
  const hydrated = useHydrated();
  return hydrated ? <BetsScreen /> : <MobileMyBetsSkeleton />;
}

const PAGE = 50;

function BetsScreen() {
  const session = useSession();
  const open = useBets('OPEN');
  const all = useBets('ALL');
  const perform = useCashOutAction();
  const [tab, setTab] = useState<Tab>('open');

  const openBets = open.data ?? [];
  const settled = useMemo(() => (all.data ?? []).filter((bet) => bet.status !== 'OPEN'), [all.data]);
  const totals = useMemo(() => {
    const staked = settled.reduce((sum, bet) => sum + Number(bet.stake), 0);
    const returned = settled.reduce((sum, bet) => sum + Number(bet.actualPayout ?? 0), 0);
    return { staked, returned, net: returned - staked };
  }, [settled]);

  if (session.isPending) return <MobileMyBetsSkeleton />;
  if (!session.data) {
    return (
      <div className="empty-state">
        <strong>Sign in to see your bets.</strong>
        <span>Bet history is tied to your account.</span>
        <Link className="btn btn-sm btn-primary" href="/login">Sign in</Link>
      </div>
    );
  }

  const current = tab === 'open' ? open : all;
  const list = tab === 'open' ? openBets : settled;

  return (
    <div className="m-bets">
      <div role="tablist" aria-label="Bet status" className="m-segment">
        <button type="button" role="tab" aria-selected={tab === 'open'} onClick={() => setTab('open')}>
          Open{openBets.length > 0 && <span>{openBets.length}</span>}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'settled'} onClick={() => setTab('settled')}>Settled</button>
      </div>

      {tab === 'settled' && settled.length > 0 && (
        <>
          <div className="m-summary">
            <div><small>Staked</small><b>{formatPoints(totals.staked)}</b></div>
            <div><small>Returned</small><b>{formatPoints(totals.returned)}</b></div>
            <div><small>Net</small><b className={totals.net >= 0 ? 'won' : 'lost'}>{totals.net > 0 ? '+' : ''}{formatPoints(totals.net)}</b></div>
          </div>
          {(all.data?.length ?? 0) >= PAGE && <p className="m-bets-note">Totals cover your {PAGE} most recent bets.</p>}
        </>
      )}

      {current.isPending && [0, 1, 2].map((index) => <span key={index} className="skeleton m-skel-bet" />)}

      {current.isError && (
        <div className="empty-state">
          <strong>Unable to load your bets.</strong>
          <span>Please try again in a moment.</span>
          <button type="button" className="btn btn-sm" onClick={() => void current.refetch()}>Retry</button>
        </div>
      )}

      {current.data && list.length === 0 && (
        <div className="empty-state">
          <strong>{tab === 'open' ? 'No open bets.' : 'No settled bets yet.'}</strong>
          <span>Selections you place appear here as soon as they are accepted.</span>
          <Link className="btn btn-sm" href="/">Browse sports</Link>
        </div>
      )}

      {list.map((bet) => <BetCard key={bet.id} bet={bet} perform={perform} />)}

      <p className="m-footnote"><span className="m-age">18+</span>Every figure above is the one the server recorded.</p>
    </div>
  );
}
