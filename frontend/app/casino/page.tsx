'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { AppShell } from '../../components/shell/app-shell';
import { CasinoGameCard } from '../../components/casino/casino-game-card';
import { ExternalDemoCard } from '../../components/casino/external-demo-card';
import { describeError, type CasinoGame } from '../../lib/casino';
import {
  EXTERNAL_DEMO_GAMES,
  filterExternalDemoGames,
  type ExternalDemoGame,
} from '../../lib/external-demo-games';
import {
  useCasinoFavorites,
  useCasinoGames,
  useCasinoRecent,
  useToggleFavorite,
} from '../../lib/casino-queries';
import {
  categoryLabel,
  filterCasinoGames,
  normalizeCasinoSearch,
  registryCategories,
  type CasinoLobbyFilter,
} from '../../lib/casino-discovery';
import { ApiError } from '../../lib/api';

/**
 * The casino lobby.
 *
 * Everything on this page - names, categories, routes, stake limits, featured
 * flags and availability - comes from the backend registry. No game metadata is
 * duplicated in the frontend, so adding or retiring a game needs no change here.
 */
export default function CasinoLobby() {
  const gamesQuery = useCasinoGames();
  const favoritesQuery = useCasinoFavorites();
  const recentQuery = useCasinoRecent();
  const favoriteMutation = useToggleFavorite();

  const [filter, setFilter] = useState<CasinoLobbyFilter>('ALL');
  const [search, setSearch] = useState('');

  const games = useMemo(() => gamesQuery.data?.games ?? [], [gamesQuery.data]);
  const recent = useMemo(() => recentQuery.data?.games ?? [], [recentQuery.data]);
  const favoriteIds = useMemo(
    () => new Set((favoritesQuery.data?.games ?? []).map((game) => game.id)),
    [favoritesQuery.data],
  );
  const recentIds = useMemo(() => new Set(recent.map((game) => game.id)), [recent]);

  const categories = useMemo(() => registryCategories(games), [games]);
  const featured = useMemo(() => games.filter((game) => game.featured), [games]);
  const favorites = useMemo(
    () => games.filter((game) => favoriteIds.has(game.id)),
    [games, favoriteIds],
  );
  const filtered = useMemo(
    () => filterCasinoGames(
      filter === 'RECENT' ? recent : games,
      filter,
      search,
      favoriteIds,
      recentIds,
    ),
    [filter, recent, games, search, favoriteIds, recentIds],
  );

  // Third-party demos are matched separately and always rendered in their own
  // labelled group, so a search result can never blend a provider demo into the
  // list of games we actually settle.
  const demoMatches = useMemo(() => filterExternalDemoGames(search), [search]);

  const searching = normalizeCasinoSearch(search) !== '';
  const filtering = filter !== 'ALL' || searching;
  // Category, favourites and recent filters describe internal games only, so
  // demos surface under "All" and in searches rather than inside those tabs.
  const showDemos = filter === 'ALL';
  const playable = games.filter((game) => game.enabled && !game.maintenance);
  const maintenance = gamesQuery.data?.platform?.casinoMaintenance ?? false;

  const pendingFavorite = favoriteMutation.isPending
    ? new Set([favoriteMutation.variables?.game.id ?? ''])
    : new Set<string>();

  const toggleFavorite = (game: CasinoGame) => {
    favoriteMutation.mutate({ game, favorite: favoriteIds.has(game.id) });
  };

  const reset = () => { setSearch(''); setFilter('ALL'); };

  const sectionProps = {
    favoriteIds,
    pendingFavoriteIds: pendingFavorite,
    onFavorite: toggleFavorite,
  };

  return (
    <AppShell
      banner={maintenance ? (
        <p className="shell-banner" role="status">
          The casino is in maintenance. New rounds cannot be started right now.
        </p>
      ) : undefined}
    >
      <div className="casino-lobby-content">
        <section className="casino-hero">
          <div className="casino-hero-copy">
            <p className="kicker">Virtual points only</p>
            <h1>Find your game.</h1>
            <p>
              Seven original, server-settled games. Every result is generated on the server and
              published with a commitment you can verify afterwards.
            </p>
          </div>
          <div className="casino-lobby-stat">
            <strong>{playable.length}</strong>
            <span>games live</span>
          </div>
        </section>

        <section className="casino-discovery" aria-label="Find casino games">
          <div className="casino-search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" /></svg>
            <label className="sr-only" htmlFor="casino-search">Search casino games</label>
            <input
              id="casino-search"
              type="search"
              value={search}
              placeholder="Search games, categories, or styles"
              autoComplete="off"
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear casino search">Clear</button>
            )}
          </div>

          <div className="casino-filter-tabs" role="tablist" aria-label="Filter casino games">
            <FilterTab label="All" value="ALL" active={filter} onSelect={setFilter} />
            {categories.map((category) => (
              <FilterTab
                key={category}
                label={categoryLabel(category)}
                value={category}
                active={filter}
                onSelect={setFilter}
              />
            ))}
            <FilterTab label={`Favorites (${favoriteIds.size})`} value="FAVORITES" active={filter} onSelect={setFilter} />
            {recent.length > 0 && (
              <FilterTab label="Recent" value="RECENT" active={filter} onSelect={setFilter} />
            )}
          </div>
        </section>

        {favoriteMutation.isError && (
          <p className="alert bad" role="alert">
            Favourite was not saved. {describeError(
              favoriteMutation.error instanceof ApiError
                ? { code: favoriteMutation.error.code, message: favoriteMutation.error.message }
                : undefined,
            )}
          </p>
        )}

        {gamesQuery.isPending && <LobbySkeleton />}

        {gamesQuery.isError && (
          <div className="casino-empty-state">
            <strong>Casino is temporarily unavailable.</strong>
            <span>Please try again in a moment.</span>
            <button type="button" onClick={() => void gamesQuery.refetch()}>Retry</button>
          </div>
        )}

        {gamesQuery.data && filtering && (() => {
          // A query can match only demos. In that case the internal grid is
          // skipped entirely rather than shown empty above the demo results,
          // and the "nothing found" state waits until both lists are empty.
          const demoResults = showDemos ? demoMatches : [];
          return (
            <>
              {(filtered.length > 0 || demoResults.length === 0) && (
                <LobbySection
                  title={searching ? 'Search results' : filterLabel(filter)}
                  kicker={searching ? `MATCHING "${search.trim()}"` : 'FILTERED GAMES'}
                  games={filtered}
                  {...sectionProps}
                  empty={(
                    <div className="casino-empty-state">
                      <strong>No games match{searching ? ` "${search.trim()}"` : ' this filter'}.</strong>
                      <span>Try another title or browse the full game list.</span>
                      <button type="button" onClick={reset}>Reset search and filters</button>
                    </div>
                  )}
                />
              )}

              {demoResults.length > 0 && (
                <DemoSection
                  games={demoResults}
                  kicker={searching ? `MATCHING "${search.trim()}"` : 'PROVIDER-HOSTED PREVIEWS'}
                />
              )}
            </>
          );
        })()}

        {gamesQuery.data && !filtering && (
          <>
            <LobbySection title="Featured" kicker="HOUSE PICKS" games={featured} compact {...sectionProps} />

            {recent.length > 0 && (
              <LobbySection
                title="Recently played"
                kicker="PICK UP WHERE YOU LEFT OFF"
                games={recent}
                contextLabel="Recent"
                compact
                {...sectionProps}
              />
            )}

            <LobbySection
              title="Favorites"
              kicker="YOUR SHORTLIST"
              games={favorites}
              compact
              {...sectionProps}
              empty={(
                <div className="casino-favorites-empty">
                  <span aria-hidden="true">&#9734;</span>
                  <p>Tap the star on any game to keep it close.</p>
                </div>
              )}
            />

            {categories.map((category) => (
              <LobbySection
                key={category}
                title={categoryLabel(category)}
                kicker="BROWSE BY CATEGORY"
                games={games.filter((game) => game.category === category)}
                {...sectionProps}
              />
            ))}

            <LobbySection title="All games" kicker="FULL COLLECTION" games={games} {...sectionProps} />
          </>
        )}

        {/* Static provider links that depend on nothing of ours, so they render
            once loading settles whether or not the casino API answered. */}
        {!filtering && !gamesQuery.isPending && (
          <DemoSection games={EXTERNAL_DEMO_GAMES} kicker="PROVIDER-HOSTED PREVIEWS" />
        )}

        <p className="casino-disclaimer">
          Virtual points are non-redeemable and have no cash value. Results and payouts are
          authoritative on the server. Demo Games are hosted by third-party providers, are provided
          for preview only, and never use Fool&apos;s Gold points.
        </p>
      </div>
    </AppShell>
  );
}

function FilterTab({ label, value, active, onSelect }: {
  label: string;
  value: CasinoLobbyFilter;
  active: CasinoLobbyFilter;
  onSelect: (filter: CasinoLobbyFilter) => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active === value}
      className={active === value ? 'active' : ''}
      onClick={() => onSelect(value)}
    >
      {label}
    </button>
  );
}

function LobbySection({
  title, kicker, games, favoriteIds, pendingFavoriteIds, onFavorite, contextLabel, compact = false, empty,
}: {
  title: string;
  kicker: string;
  games: CasinoGame[];
  favoriteIds: ReadonlySet<string>;
  pendingFavoriteIds: ReadonlySet<string>;
  onFavorite: (game: CasinoGame) => void;
  contextLabel?: string;
  compact?: boolean;
  empty?: ReactNode;
}) {
  const id = `casino-section-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <section className="casino-lobby-section" aria-labelledby={id}>
      <div className="casino-lobby-section-heading">
        <div>
          <p>{kicker}</p>
          <h2 id={id}>{title}</h2>
        </div>
        {games.length > 0 && <span>{games.length} {games.length === 1 ? 'game' : 'games'}</span>}
      </div>
      {games.length > 0 ? (
        <div className={`casino-lobby-grid${compact ? ' casino-lobby-grid-compact' : ''}`}>
          {games.map((game) => (
            <CasinoGameCard
              key={game.id}
              game={game}
              favorite={favoriteIds.has(game.id)}
              favoritePending={pendingFavoriteIds.has(game.id)}
              onFavorite={onFavorite}
              contextLabel={contextLabel}
            />
          ))}
        </div>
      ) : empty ?? null}
    </section>
  );
}

/**
 * Third-party demos, kept in their own section and never merged into a games
 * grid. The heading states the rule once for the whole group, and every card
 * repeats it, so the distinction survives being screenshotted or skim-read.
 */
function DemoSection({ games, kicker }: { games: readonly ExternalDemoGame[]; kicker: string }) {
  if (games.length === 0) return null;
  return (
    <section className="casino-lobby-section casino-demo-section" aria-labelledby="casino-section-demo-games">
      <div className="casino-lobby-section-heading">
        <div>
          <p>{kicker}</p>
          <h2 id="casino-section-demo-games">Demo Games</h2>
        </div>
        <span>{games.length} {games.length === 1 ? 'demo' : 'demos'}</span>
      </div>
      <p className="casino-demo-explainer">
        Free demos hosted by the game providers themselves. They open in a new tab, run entirely on
        the provider&apos;s site, and are not part of Fool&apos;s Gold Club. No points are staked,
        won, or lost, and nothing here affects your balance or history.
      </p>
      <div className="casino-lobby-grid casino-demo-grid">
        {games.map((game) => <ExternalDemoCard key={game.id} game={game} />)}
      </div>
    </section>
  );
}

function LobbySkeleton() {
  return (
    <section className="casino-lobby-section" aria-label="Loading casino games" aria-busy="true">
      <div className="casino-lobby-section-heading">
        <div><p>LOADING</p><h2>Games</h2></div>
      </div>
      <div className="casino-lobby-grid">
        {Array.from({ length: 8 }, (_, index) => (
          <span className="skeleton casino-game-skeleton" key={index} />
        ))}
      </div>
    </section>
  );
}

function filterLabel(filter: CasinoLobbyFilter) {
  if (filter === 'FAVORITES') return 'Favorites';
  if (filter === 'RECENT') return 'Recently played';
  if (filter === 'ALL') return 'All games';
  return categoryLabel(filter);
}
