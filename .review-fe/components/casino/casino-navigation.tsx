'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CasinoGame, CasinoGamesResponse, casinoGet, formatPoints } from '../../lib/casino';

type CasinoNavigationProps = {
  balance: string;
  current?: string;
  games?: CasinoGame[];
};

/** A registry-backed game switcher shared by the lobby and every casino game. */
export function CasinoNavigation({ balance, current, games }: CasinoNavigationProps) {
  const [loadedGames, setLoadedGames] = useState<CasinoGame[]>([]);

  useEffect(() => {
    if (games) return;
    void casinoGet<CasinoGamesResponse>('/casino/games').then((response) => {
      setLoadedGames(response?.games ?? []);
    });
  }, [games]);

  const availableGames = (games ?? loadedGames).filter((game) => game.enabled);

  return (
    <header className="ops-header casino-navigation">
      <div className="casino-breadcrumbs">
        <Link className="brand" href="/">FOOL&apos;S GOLD</Link>
        <span className="ops-divider">/</span>
        {current ? <Link href="/casino">Casino</Link> : <span>Casino</span>}
        {current && (
          <>
            <span className="ops-divider">/</span>
            <span className="casino-current-game">{current}</span>
          </>
        )}
      </div>

      <nav className="casino-navigation-actions" aria-label="Casino navigation">
        <Link href="/sports">Sports</Link>
        <details className="casino-game-switcher">
          <summary>Games</summary>
          <div className="casino-game-switcher-menu">
            <span className="casino-game-switcher-label">Switch game</span>
            {availableGames.map((game) => (
              <Link key={game.id} href={game.route}>{game.name}</Link>
            ))}
          </div>
        </details>
        <Link href="/casino/history">History</Link>
        <span className="casino-balance">{formatPoints(balance)} pts</span>
      </nav>
    </header>
  );
}
