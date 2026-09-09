'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '../../components/shell/app-shell';
import { getJson } from '../../lib/api';
import { formatDateTime, formatOdds, formatPoints, humanize } from '../../lib/format';
import { qk } from '../../lib/queries';
import { useSession } from '../../lib/queries';

type Leg = {
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

type Bet = {
  id: string;
  type: 'SINGLE' | 'ACCUMULATOR';
  status: 'OPEN' | 'WON' | 'LOST' | 'VOID';
  stake: string;
  totalOdds: string;
  finalOdds?: string | null;
  potentialPayout: string;
  actualPayout?: string | null;
  createdAt: string;
  settledAt?: string | null;
  legs: Leg[];
};

const TABS = ['OPEN', 'WON', 'LOST', 'VOID', 'ALL'] as const;
type Tab = (typeof TABS)[number];

const EMPTY: Record<Tab, string> = {
  OPEN: 'No open bets.',
  WON: 'No winning bets yet.',
  LOST: 'No losing bets.',
  VOID: 'No void bets.',
  ALL: 'You have not placed a bet yet.',
};

function BetCard({ bet }: { bet: Bet }) {
  const settled = bet.status !== 'OPEN';
  return (
    <article className="panel bet-card">
      <header className="bet-card-head">
        <span className="pill brand">{humanize(bet.type)}</span>
        <span className={`pill ${bet.status.toLowerCase()}`}>{humanize(bet.status)}</span>
        <span className="slip-note">{bet.legs.length} {bet.legs.length === 1 ? 'leg' : 'legs'}</span>
        <time dateTime={bet.settledAt ?? bet.createdAt}>
          {settled && bet.settledAt
            ? `Settled ${formatDateTime(bet.settledAt)}`
            : `Placed ${formatDateTime(bet.createdAt)}`}
        </time>
      </header>

      <div className="bet-figures">
        <div className="bet-figure"><span>Stake</span><strong>{formatPoints(bet.stake)}</strong></div>
        <div className="bet-figure">
          <span>Total odds</span>
          <strong>{formatOdds(bet.finalOdds ?? bet.totalOdds)}</strong>
        </div>
        <div className="bet-figure">
          <span>Potential return</span>
          <strong>{formatPoints(bet.potentialPayout)}</strong>
        </div>
        <div className="bet-figure">
          <span>Paid out</span>
          <strong className={settled ? (Number(bet.actualPayout ?? 0) > 0 ? 'good' : 'bad') : undefined}>
            {settled ? formatPoints(bet.actualPayout ?? 0) : '—'}
          </strong>
        </div>
      </div>

      <details className="bet-legs" open={bet.legs.length <= 2}>
        <summary>Selections</summary>
        {bet.legs.map((leg) => (
          <div className="bet-leg" key={leg.id}>
            <span className="bet-leg-teams">{leg.homeTeam} v {leg.awayTeam}</span>
            <span className="bet-leg-selection">
              {leg.marketName}: {leg.selectionName}{leg.marketPoint ? ` ${leg.marketPoint}` : ''}
            </span>
            <span className="bet-leg-odds">{formatOdds(leg.acceptedOdds)}</span>
            <span className={`pill ${leg.status.toLowerCase()}`}>{humanize(leg.status)}</span>
            {leg.finalHomeScore !== null && leg.finalHomeScore !== undefined && (
              <span className="slip-note">Final {leg.finalHomeScore}–{leg.finalAwayScore}</span>
            )}
            <span className="slip-note">{formatDateTime(leg.eventStartTime)}</span>
          </div>
        ))}
      </details>
    </article>
  );
}

export default function MyBetsPage() {
  const [tab, setTab] = useState<Tab>('OPEN');
  const session = useSession();

  const bets = useQuery({
    queryKey: qk.bets(tab),
    enabled: Boolean(session.data),
    queryFn: () => getJson<Bet[]>(`/bets/me?limit=50${tab === 'ALL' ? '' : `&status=${tab}`}`),
  });

  return (
    <AppShell>
      <div className="page">
        <div className="page-head">
          <div>
            <p className="kicker">Your activity</p>
            <h1>My bets</h1>
            <p>Every settled figure below is the payout the server actually credited.</p>
          </div>
          <Link className="btn btn-sm" href="/sports">Back to sportsbook</Link>
        </div>

        {!session.isPending && !session.data && (
          <div className="empty-state">
            <strong>Sign in to see your bets.</strong>
            <span>Bet history is tied to your account.</span>
            <Link className="btn btn-sm btn-primary" href="/login">Sign in</Link>
          </div>
        )}

        {session.data && (
          <>
            <div className="tabs" role="tablist" aria-label="Bet status" style={{ marginBottom: 14 }}>
              {TABS.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  onClick={() => setTab(value)}
                >
                  {humanize(value)}
                </button>
              ))}
            </div>

            {bets.isPending && (
              <div aria-busy="true">
                {[0, 1, 2].map((row) => (
                  <span key={row} className="skeleton" style={{ height: 132, marginBottom: 9 }} />
                ))}
              </div>
            )}

            {bets.isError && (
              <div className="empty-state">
                <strong>Unable to load your bets.</strong>
                <span>Please try again in a moment.</span>
                <button type="button" className="btn btn-sm" onClick={() => void bets.refetch()}>Retry</button>
              </div>
            )}

            {bets.data?.length === 0 && (
              <div className="empty-state">
                <strong>{EMPTY[tab]}</strong>
                <span>Selections you place appear here as soon as they are accepted.</span>
                <Link className="btn btn-sm" href="/sports">Browse sports</Link>
              </div>
            )}

            {bets.data?.map((bet) => <BetCard key={bet.id} bet={bet} />)}
          </>
        )}
      </div>
    </AppShell>
  );
}
