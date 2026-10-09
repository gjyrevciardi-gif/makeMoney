'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '../../components/shell/app-shell';
import { getJson } from '../../lib/api';
import { humanize } from '../../lib/format';
import { SettledTicket, type TicketBet } from '../../components/sports/settled-ticket';
import { qk } from '../../lib/queries';
import { useSession } from '../../lib/queries';

const TABS = ['OPEN', 'WON', 'LOST', 'VOID', 'ALL'] as const;
type Tab = (typeof TABS)[number];

const EMPTY: Record<Tab, string> = {
  OPEN: 'No open bets.',
  WON: 'No winning bets yet.',
  LOST: 'No losing bets.',
  VOID: 'No void bets.',
  ALL: 'You have not placed a bet yet.',
};

export default function MyBetsPage() {
  const [tab, setTab] = useState<Tab>('OPEN');
  const session = useSession();

  const bets = useQuery({
    queryKey: qk.bets(tab),
    enabled: Boolean(session.data),
    queryFn: () => getJson<TicketBet[]>(`/bets/me?limit=50${tab === 'ALL' ? '' : `&status=${tab}`}`),
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

            <div className="ticket-grid">
              {bets.data?.map((bet) => <SettledTicket key={bet.id} bet={bet} />)}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
