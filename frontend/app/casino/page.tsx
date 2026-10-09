'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { AppShell } from '../../components/shell/app-shell';
import { IconSearch } from '../../components/shell/icons';
import { LobbyCard } from '../../components/casino/lobby-card';
import { describeError, type CasinoCategory, type CasinoGame } from '../../lib/casino';
import {
  useCasinoFavorites,
  useCasinoGames,
  useCasinoRecent,
  useToggleFavorite,
} from '../../lib/casino-queries';
import { matchesCasinoSearch, normalizeCasinoSearch } from '../../lib/casino-discovery';
import { ApiError } from '../../lib/api';
import { useAuthModal } from '../../components/shell/auth-modal';

type View = 'HOME' | 'ALL' | CasinoCategory;

/**
 * The category rail follows the reference. Only categories the backend registry
 * actually has are selectable; the others are shown unavailable instead of
 * leading to an empty or invented section.
 */
const RAIL: { label: string; view?: View; icon: ReactNode }[] = [
  { label: 'Home', view: 'HOME', icon: <path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z" /> },
  { label: "What's New", icon: <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8z" /> },
  { label: 'Live Casino', icon: <path d="M12 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM5 21c0-4 3-7 7-7s7 3 7 7z" /> },
  { label: 'Slots', view: 'SLOTS', icon: <path d="M12 8c-3-4-8-1-6 3 1 2 4 3 6 6 2-3 5-4 6-6 2-4-3-7-6-3zM12 8V4" /> },
  { label: 'Table & Card', view: 'TABLE_GAMES', icon: <path d="M7 4h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 9l3-3 3 3-3 3z" /> },
  { label: 'Arcade', view: 'ORIGINALS', icon: <path d="M13 3c3 1 6 4 7 8l-5 2zM11 8 5 14l-2 6 6-2 6-6zM8 16l-2 2" /> },
  { label: 'Poker', icon: <path d="M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" /> },
  { label: 'Jackpots', icon: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /> },
  { label: 'Exclusives', icon: <path d="M8 5v14M8 5h5a3.5 3.5 0 0 1 0 7H8M8 12h6a3.5 3.5 0 0 1 0 7H8" /> },
  { label: 'All Games', view: 'ALL', icon: <path d="m12 3 4 4-4 4-4-4zM12 13l4 4-4 4-4-4zM3 8l4 4-4 4zM21 8v8l-4-4z" /> },
];

const SECTION_LABEL: Record<CasinoCategory, string> = {
  SLOTS: 'Slots',
  TABLE_GAMES: 'Table & Card',
  ORIGINALS: 'Arcade',
};

export default function CasinoLobby() {
  const gamesQuery = useCasinoGames();
  const favoritesQuery = useCasinoFavorites();
  const recentQuery = useCasinoRecent();
  const favoriteMutation = useToggleFavorite();
  const auth = useAuthModal();

  const [view, setView] = useState<View>('HOME');
  const [search, setSearch] = useState('');

  const games = useMemo(() => gamesQuery.data?.games ?? [], [gamesQuery.data]);
  const recent = useMemo(() => recentQuery.data?.games ?? [], [recentQuery.data]);
  const favoriteIds = useMemo(
    () => new Set((favoritesQuery.data?.games ?? []).map((game) => game.id)),
    [favoritesQuery.data],
  );
  const featured = useMemo(() => games.filter((game) => game.featured), [games]);
  const favorites = useMemo(() => games.filter((game) => favoriteIds.has(game.id)), [games, favoriteIds]);
  const categories = useMemo(() => [...new Set(games.map((game) => game.category))], [games]);

  const searching = normalizeCasinoSearch(search) !== '';
  const results = useMemo(() => games.filter((game) => matchesCasinoSearch(game, search)), [games, search]);
  const maintenance = gamesQuery.data?.platform?.casinoMaintenance ?? false;

  const pending = favoriteMutation.isPending
    ? new Set([favoriteMutation.variables?.game.id ?? ''])
    : new Set<string>();
  const toggleFavorite = (game: CasinoGame) =>
    favoriteMutation.mutate({ game, favorite: favoriteIds.has(game.id) });

  const card = (game: CasinoGame) => (
    <LobbyCard
      key={game.id}
      game={game}
      favorite={favoriteIds.has(game.id)}
      favoritePending={pending.has(game.id)}
      onFavorite={toggleFavorite}
    />
  );

  const rail = (title: string, list: CasinoGame[], onViewAll?: () => void) => (
    list.length === 0 ? null : (
      <section key={title} className="ref-casino-section" aria-label={title}>
        <div className="ref-section-head compact">
          <h2>{title}</h2>
          {onViewAll && <button type="button" className="ref-outline-pill" onClick={onViewAll}>View All</button>}
        </div>
        <div className="ref-game-rail">{list.map(card)}</div>
      </section>
    )
  );

  const grid = (title: string, list: CasinoGame[]) => (
    <section className="ref-casino-section" aria-label={title}>
      <div className="ref-section-head compact"><h2>{title}</h2></div>
      {list.length > 0
        ? <div className="ref-game-grid">{list.map(card)}</div>
        : (
          <div className="empty-state">
            <strong>No games found.</strong>
            <span>Try another title or browse all games.</span>
            <button type="button" className="btn btn-sm" onClick={() => { setSearch(''); setView('ALL'); }}>Browse all games</button>
          </div>
        )}
    </section>
  );

  return (
    <AppShell
      banner={maintenance ? (
        <p className="shell-banner" role="status">
          The casino is in maintenance. New rounds cannot be started right now.
        </p>
      ) : undefined}
    >
      <div className="ref-casino">
        <label className="ref-search">
          <IconSearch />
          <span className="sr-only">Search for game or by provider</span>
          <input
            id="ref-search"
            type="search"
            value={search}
            placeholder="Search for Game or by Provider"
            autoComplete="off"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        <nav className="ref-cat-rail" aria-label="Casino categories">
          {RAIL.map(({ label, view: target, icon }) => {
            const available = target !== undefined && (target === 'HOME' || target === 'ALL' || categories.includes(target));
            const selected = available && !searching && view === target;
            return (
              <button
                key={label}
                type="button"
                className={selected ? 'active' : ''}
                aria-current={selected ? 'true' : undefined}
                aria-disabled={!available}
                disabled={!available}
                title={available ? undefined : 'Not available yet'}
                onClick={() => { if (target) { setSearch(''); setView(target); } }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">{icon}</svg>
                <span>{label}</span>
              </button>
            );
          })}
        </nav>

        {favoriteMutation.isError && (
          <p className="alert bad" role="alert">
            Favourite was not saved. {describeError(
              favoriteMutation.error instanceof ApiError
                ? { code: favoriteMutation.error.code, message: favoriteMutation.error.message }
                : undefined,
            )}
          </p>
        )}

        {gamesQuery.isPending && (
          <div className="ref-game-rail" aria-busy="true" aria-label="Loading casino games">
            {Array.from({ length: 7 }, (_, index) => <span key={index} className="skeleton ref-game-card" />)}
          </div>
        )}

        {gamesQuery.isError && gamesQuery.error instanceof ApiError && gamesQuery.error.status === 401 && (
          <div className="empty-state">
            <strong>Log in to see the games.</strong>
            <span>The game list is available to signed-in players.</span>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => auth.open()}>Log In</button>
          </div>
        )}

        {gamesQuery.isError && !(gamesQuery.error instanceof ApiError && gamesQuery.error.status === 401) && (
          <div className="empty-state">
            <strong>Casino is temporarily unavailable.</strong>
            <span>Please try again in a moment.</span>
            <button type="button" className="btn btn-sm" onClick={() => void gamesQuery.refetch()}>Retry</button>
          </div>
        )}

        {gamesQuery.data && searching && grid(`Results for “${search.trim()}”`, results)}

        {gamesQuery.data && !searching && view === 'ALL' && grid('All Games', games)}

        {gamesQuery.data && !searching && view !== 'HOME' && view !== 'ALL' &&
          grid(SECTION_LABEL[view], games.filter((game) => game.category === view))}

        {gamesQuery.data && !searching && view === 'HOME' && (
          <>
            <div className="ref-hero-rail">
              <article className="ref-hero tone-green">
                <small>FREE-PLAY CASINO</small>
                <strong>PLAY FOR PTS.<br />NOTHING TO LOSE.</strong>
                <em>PTS are virtual and have no cash value.</em>
              </article>
              {featured.slice(0, 4).map((game) => {
                const playable = game.enabled && !game.maintenance;
                const body = (
                  <>
                    <span className="ref-hero-tag">FEATURED</span>
                    <strong>{game.name.toUpperCase()}</strong>
                    <em>{game.description}</em>
                  </>
                );
                return playable
                  ? <Link key={game.id} href={game.route} className="ref-hero tone-game">{body}</Link>
                  : <div key={game.id} className="ref-hero tone-game disabled">{body}</div>;
              })}
            </div>

            {rail('Games Of The Month', featured, () => setView('ALL'))}
            {rail('Recently Played', recent)}
            {rail('Favorites', favorites)}
            {categories.map((category) => rail(
              SECTION_LABEL[category],
              games.filter((game) => game.category === category),
              () => setView(category),
            ))}
          </>
        )}

        <p className="casino-disclaimer ref-disclaimer">
          PTS are virtual, non-redeemable and have no cash value. Results and payouts are
          authoritative on the server.
        </p>
      </div>
    </AppShell>
  );
}
