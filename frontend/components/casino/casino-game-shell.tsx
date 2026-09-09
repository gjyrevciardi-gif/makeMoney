'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppShell } from '../shell/app-shell';
import { formatPoints } from '../../lib/format';
import { useCasinoGames } from '../../lib/casino-queries';

type CasinoGameShellProps = {
  /** The game's display name, or omitted for the lobby-level pages. */
  title?: string;
  /** Backend-authoritative balance for this page, already fetched by the game. */
  balance: string;
  /** Rules / fairness / paytable content, shown in the header disclosure. */
  rules?: ReactNode;
  gameId: string;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  ready?: boolean;
  children: ReactNode;
};

/**
 * The frame every casino page shares.
 *
 * Breadcrumbs, the registry-backed game switcher, the balance and the rules
 * disclosure live here once instead of being repeated in seven game pages. The
 * games themselves keep full ownership of their own board and controls - and of
 * the rule that every result comes from the server.
 */
export function CasinoGameShell({
  title, balance, rules, gameId, loading = false, error, onRetry, ready = true, children,
}: CasinoGameShellProps) {
  const games = useCasinoGames();
  const game = games.data?.games.find((entry) => entry.id === gameId);
  const available = (games.data?.games ?? []).filter((entry) => entry.enabled && !entry.maintenance);
  const unavailable = game && (!game.enabled || game.maintenance);

  return (
    <AppShell>
      <div className="casino-game-shell">
        <div className="casino-game-topbar">
          <nav className="casino-breadcrumbs" aria-label="Breadcrumb">
            <Link href="/casino">Casino</Link>
            {title && (
              <>
                <span className="ops-divider" aria-hidden="true">/</span>
                <span className="casino-current-game">{title}</span>
              </>
            )}
          </nav>

          <div className="casino-navigation-actions">
            {rules && (
              <details className="casino-game-switcher">
                <summary>Rules</summary>
                <div className="casino-game-switcher-menu" style={{ minWidth: 260, maxWidth: 340 }}>
                  {rules}
                </div>
              </details>
            )}
            <details className="casino-game-switcher">
              <summary>Switch game</summary>
              <div className="casino-game-switcher-menu">
                <span className="casino-game-switcher-label">Available now</span>
                {available.map((game) => (
                  <Link key={game.id} href={game.route}>{game.name}</Link>
                ))}
                {available.length === 0 && <span className="casino-game-switcher-label">None available</span>}
              </div>
            </details>
            <Link href="/casino/history">History</Link>
            <span className="casino-balance">{formatPoints(balance)} pts</span>
          </div>
        </div>

        {loading || games.isPending ? (
          <div className="casino-game-state" aria-busy="true">
            <span className="skeleton" />
            <strong>Loading game</strong>
            <span>Checking the latest game configuration.</span>
          </div>
        ) : error ? (
          <div className="casino-game-state" role="alert">
            <strong>Game unavailable</strong>
            <span>{error}</span>
            {onRetry && <button type="button" className="btn btn-sm" onClick={onRetry}>Retry</button>}
          </div>
        ) : unavailable ? (
          <div className="casino-game-state" role="status">
            <strong>{game.maintenance ? 'Game maintenance' : 'Game unavailable'}</strong>
            <span>{game.maintenance ? 'This game is temporarily under maintenance.' : 'This game is not currently available.'}</span>
            <Link className="btn btn-sm" href="/casino">Back to casino</Link>
          </div>
        ) : ready ? children : (
          <div className="casino-game-state" aria-busy="true">
            <span className="skeleton" />
            <strong>Loading game</strong>
            <span>Loading the latest game configuration.</span>
          </div>
        )}

        <p className="casino-disclaimer">
          Outcomes are generated and settled on the server. Animations here replay a result that has
          already been decided; they never produce one.
        </p>
      </div>
    </AppShell>
  );
}
