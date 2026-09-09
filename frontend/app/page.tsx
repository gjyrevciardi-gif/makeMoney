'use client';

import Link from 'next/link';
import { AppShell } from '../components/shell/app-shell';
import { formatPoints } from '../lib/format';
import { useSession, useWallet } from '../lib/queries';

export default function Home() {
  const session = useSession();
  const wallet = useWallet();

  return (
    <AppShell>
      <section className="home-hero">
        <p className="kicker">Private members&apos; club</p>
        <h1>Your picks.<br />Nothing to lose.</h1>
        <p>
          A sportsbook and casino played entirely in virtual points. No deposits, no
          withdrawals, no cash value — just the game.
        </p>
        <div className="home-actions">
          <Link className="btn btn-primary" href="/sports">Browse sportsbook</Link>
          <Link className="btn" href="/casino">Enter the casino</Link>
        </div>
        {session.data && (
          <p className="slip-note" style={{ marginTop: 16 }}>
            Signed in as {session.data.email} · balance{' '}
            <strong className="tnum">{formatPoints(wallet.data?.balance ?? 0)} pts</strong>
          </p>
        )}
        {!session.isPending && !session.data && (
          <p className="slip-note" style={{ marginTop: 16 }}>
            New accounts begin at exactly zero points. Ask an administrator for a grant.
          </p>
        )}
      </section>

      <div className="page">
        <div className="home-grid">
          <article className="panel home-tile">
            <span className="pill brand">Sportsbook</span>
            <h3>Real fixtures, real prices</h3>
            <p>
              Singles and accumulators across the sports our data feed covers. Every price is
              re-checked by the server the moment you place a bet.
            </p>
            <Link className="home-tile-link" href="/sports">Open the sportsbook →</Link>
          </article>

          <article className="panel home-tile">
            <span className="pill brand">Casino</span>
            <h3>Seven original games</h3>
            <p>
              Dice, Mines, Crash, Plinko, Roulette, Blackjack and Fool&apos;s Gold Rush — each
              settled on the server with a published, verifiable commitment.
            </p>
            <Link className="home-tile-link" href="/casino">Enter the casino →</Link>
          </article>

          <article className="panel home-tile">
            <span className="pill brand">Provably fair</span>
            <h3>Check any result</h3>
            <p>
              Every round publishes a seed commitment before play and reveals the seed once it
              finishes, so any outcome can be recomputed independently.
            </p>
            <Link className="home-tile-link" href="/casino/history">See your history →</Link>
          </article>
        </div>

        <p className="casino-disclaimer">
          Virtual points are non-redeemable and have no cash value. This club offers no real-money
          wagering, deposits, withdrawals or prizes.
        </p>
      </div>
    </AppShell>
  );
}
