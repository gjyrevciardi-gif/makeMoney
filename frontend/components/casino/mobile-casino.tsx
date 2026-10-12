'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../lib/api';
import { describeError, type CasinoCategory, type CasinoGame } from '../../lib/casino';
import { matchesCasinoSearch, normalizeCasinoSearch } from '../../lib/casino-discovery';
import { useCasinoFavorites, useCasinoGames, useCasinoRecent, useToggleFavorite } from '../../lib/casino-queries';
import { formatPoints } from '../../lib/format';
import { useHydrated } from '../../lib/hydrated';
import { useJackpot, useLiveCasinoTables, type LiveTable } from '../../lib/mobile';
import { useAuthModal } from '../shell/auth-modal';
import { IconClose, IconFlame, IconSearch, IconStar } from '../shell/icons';
import { GameArt } from './casino-game-card';

type Filter = 'ALL' | CasinoCategory;

const CATEGORY_LABEL: Record<CasinoCategory, string> = { SLOTS: 'Slots', TABLE_GAMES: 'Table & Card', ORIGINALS: 'Arcade' };

/* ----------------------------------------------------------------- jackpot */

/** Rendered only when the platform reports a jackpot; today it does not. */
function JackpotCard() {
  const jackpot = useJackpot();
  if (!jackpot) return null;
  const progress = Math.max(0, Math.min(1, jackpot.amount / jackpot.mustDropBy));

  return (
    <section className="m-jackpot" aria-label="Jackpot">
      <span className="m-jackpot-shine" aria-hidden="true" />
      <div className="m-jackpot-top">
        <span>Fool&apos;s Gold Jackpot</span>
        {jackpot.playersOnline !== undefined && (
          <span className="m-online"><i aria-hidden="true" />{formatPoints(jackpot.playersOnline)} playing now</span>
        )}
      </div>
      <strong aria-live="off">{formatPoints(jackpot.amount)} PTS</strong>
      <div className="m-jackpot-meter">
        <div className="m-meter"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
        <div><span>Must drop by {formatPoints(jackpot.mustDropBy)} PTS</span>{jackpot.lastWon && <span>{jackpot.lastWon}</span>}</div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- tiles */

function GameTile({ game, favourite, pending, onFavourite }: {
  game: CasinoGame; favourite: boolean; pending: boolean; onFavourite: (game: CasinoGame) => void;
}) {
  const playable = game.enabled && !game.maintenance;
  const art = (
    <>
      <GameArt thumbnailKey={game.thumbnailKey} />
      <span className="m-tile-shade" aria-hidden="true" />
    </>
  );

  return (
    <article className={`m-tile${playable ? '' : ' off'}`}>
      {playable
        ? <Link className="m-tile-art" href={game.route} aria-label={`Play ${game.name}`}>{art}</Link>
        : <div className="m-tile-art">{art}</div>}
      {game.hot && playable && <span className="m-badge hot"><IconFlame />HOT</span>}
      {!game.hot && game.isNew && playable && <span className="m-badge new">NEW</span>}
      {game.maintenance && <span className="m-badge warn">Maintenance</span>}
      {!game.enabled && <span className="m-badge bad">Unavailable</span>}
      <button
        type="button"
        className={`m-tile-fav${favourite ? ' on' : ''}`}
        aria-pressed={favourite}
        aria-label={favourite ? `Remove ${game.name} from favourites` : `Add ${game.name} to favourites`}
        disabled={pending}
        onClick={() => onFavourite(game)}
      >
        <span><IconStar filled={favourite} /></span>
      </button>
      <div className="m-tile-copy">
        <strong>{game.name}</strong>
        <span>
          {game.playersNow !== undefined
            ? <><i aria-hidden="true" />{formatPoints(game.playersNow)} playing</>
            : <>{formatPoints(game.minStake)}–{formatPoints(game.maxStake)} PTS</>}
        </span>
      </div>
    </article>
  );
}

/* ----------------------------------------------------------------- live casino */

function TableArt({ kind }: { kind: LiveTable['kind'] }) {
  if (kind === 'blackjack') {
    return (
      <svg viewBox="0 0 64 64" width="88" height="88" aria-hidden="true">
        <g className="m-line">
          <rect x="12" y="14" width="24" height="34" rx="4" transform="rotate(-12 24 31)" />
          <rect x="28" y="16" width="24" height="34" rx="4" transform="rotate(9 40 33)" />
        </g>
        <path className="m-fill" d="M40 26l5 7-5 7-5-7z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 64" width="88" height="88" aria-hidden="true" className={kind === 'roulette' ? 'm-spin' : undefined}>
      <g className="m-line">
        <circle cx="32" cy="32" r="22" />
        <circle cx="32" cy="32" r="9" opacity="0.6" />
        <path d="M32 10v12M32 42v12M10 32h12M42 32h12" opacity="0.6" />
      </g>
      <circle className="m-fill" cx="32" cy="15" r="3" />
    </svg>
  );
}

/** Rendered only when the platform lists live tables; today it does not. */
function LiveCasinoRow() {
  const tables = useLiveCasinoTables();
  if (tables.length === 0) return null;
  return (
    <section id="live-casino" className="m-section" aria-labelledby="m-live-casino">
      <div className="m-section-head">
        <div>
          <span className="m-eyebrow live"><i aria-hidden="true" />Live dealers</span>
          <h2 id="m-live-casino">Live Casino</h2>
        </div>
      </div>
      <div className="m-rail m-scroll">
        {tables.map((table) => (
          <article key={table.id} className="m-table">
            <Link className="m-table-art" href={table.route} aria-label={`Join ${table.name}`}>
              <TableArt kind={table.kind} />
              <span className="m-live-pill"><i aria-hidden="true" />LIVE</span>
              {table.note && <span className="m-table-note">{table.note}</span>}
            </Link>
            <div className="m-table-foot">
              <span><strong>{table.name}</strong><small>{table.stakes} · {formatPoints(table.players)} playing</small></span>
              <Link href={table.route}>Join</Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- screen */

export function MobileCasinoSkeleton() {
  return (
    <div className="m-casino" aria-busy="true" aria-label="Loading casino">
      <div className="m-pills m-scroll">{[0, 1, 2, 3].map((index) => <span key={index} className="skeleton m-pill-skel" />)}</div>
      <div className="m-tiles">{[0, 1, 2, 3].map((index) => <span key={index} className="skeleton m-tile-skel" />)}</div>
    </div>
  );
}

/**
 * The phone casino lobby.
 *
 * Games, favourites and recent plays come from the existing casino queries
 * (favourites are saved on the server). The jackpot, live tables, HOT / NEW
 * badges and "playing now" counts appear only when the platform supplies them.
 */
export function MobileCasino() {
  const hydrated = useHydrated();
  return hydrated ? <LobbyScreen /> : <MobileCasinoSkeleton />;
}

function LobbyScreen() {
  const gamesQuery = useCasinoGames();
  const favouritesQuery = useCasinoFavorites();
  const recentQuery = useCasinoRecent();
  const toggle = useToggleFavorite();
  const auth = useAuthModal();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // The header's search button asks the lobby to open its field (phone widths only).
  useEffect(() => {
    const open = (event: Event) => {
      if (!window.matchMedia('(max-width: 899px)').matches) return;
      event.preventDefault();
      setSearchOpen(true);
      setTimeout(() => input.current?.focus(), 0);
    };
    window.addEventListener('fg:search', open);
    return () => window.removeEventListener('fg:search', open);
  }, []);

  const games = useMemo(() => gamesQuery.data?.games ?? [], [gamesQuery.data]);
  const recent = useMemo(() => recentQuery.data?.games ?? [], [recentQuery.data]);
  const favouriteIds = useMemo(() => new Set((favouritesQuery.data?.games ?? []).map((game) => game.id)), [favouritesQuery.data]);
  const categories = useMemo(() => [...new Set(games.map((game) => game.category))], [games]);
  const featured = useMemo(() => games.filter((game) => game.featured), [games]);
  const favourites = useMemo(() => games.filter((game) => favouriteIds.has(game.id)), [games, favouriteIds]);
  const searching = normalizeCasinoSearch(search) !== '';
  const maintenance = gamesQuery.data?.platform?.casinoMaintenance ?? false;
  const pendingId = toggle.isPending ? toggle.variables?.game.id : undefined;

  const tile = (game: CasinoGame) => (
    <GameTile
      key={game.id}
      game={game}
      favourite={favouriteIds.has(game.id)}
      pending={pendingId === game.id}
      onFavourite={(target) => toggle.mutate({ game: target, favorite: favouriteIds.has(target.id) })}
    />
  );

  const section = (title: string, eyebrow: string | undefined, list: CasinoGame[]) => (list.length === 0 ? null : (
    <section className="m-section pad" aria-label={title}>
      <div className="m-section-head">
        <div>{eyebrow && <span className="m-eyebrow">{eyebrow}</span>}<h2>{title}</h2></div>
      </div>
      <div className="m-tiles">{list.map(tile)}</div>
    </section>
  ));

  const error = gamesQuery.error instanceof ApiError ? gamesQuery.error : undefined;

  return (
    <div className="m-casino">
      {maintenance && <p className="m-note" role="status">The casino is in maintenance. New rounds cannot be started right now.</p>}

      {searchOpen && (
        <label className="m-search">
          <IconSearch />
          <span className="sr-only">Search for game or by provider</span>
          <input
            ref={input}
            type="search"
            value={search}
            placeholder="Search for a game"
            autoComplete="off"
            onChange={(event) => setSearch(event.target.value)}
          />
          <button type="button" aria-label="Close search" onClick={() => { setSearch(''); setSearchOpen(false); }}><IconClose /></button>
        </label>
      )}

      <JackpotCard />

      {games.length > 0 && (
        <div role="tablist" aria-label="Game categories" className="m-pills m-scroll">
          <button type="button" role="tab" aria-selected={filter === 'ALL'} className="m-pill-tab" onClick={() => setFilter('ALL')}>All</button>
          {categories.map((category) => (
            <button key={category} type="button" role="tab" aria-selected={filter === category} className="m-pill-tab" onClick={() => setFilter(category)}>
              {CATEGORY_LABEL[category]}
            </button>
          ))}
        </div>
      )}

      {toggle.isError && (
        <p className="m-slip-alert bad m-note" role="alert">
          Favourite was not saved. {describeError(toggle.error instanceof ApiError ? { code: toggle.error.code, message: toggle.error.message } : undefined)}
        </p>
      )}

      {gamesQuery.isPending && <div className="m-tiles" aria-busy="true">{[0, 1, 2, 3].map((index) => <span key={index} className="skeleton m-tile-skel" />)}</div>}

      {error?.status === 401 && (
        <div className="empty-state">
          <strong>Log in to see the games.</strong>
          <span>The game list is available to signed-in players.</span>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => auth.open()}>Log In</button>
        </div>
      )}
      {gamesQuery.isError && error?.status !== 401 && (
        <div className="empty-state">
          <strong>Casino is temporarily unavailable.</strong>
          <span>Please try again in a moment.</span>
          <button type="button" className="btn btn-sm" onClick={() => void gamesQuery.refetch()}>Retry</button>
        </div>
      )}

      {gamesQuery.data && searching && (
        games.filter((game) => matchesCasinoSearch(game, search)).length > 0
          ? section(`Results for “${search.trim()}”`, undefined, games.filter((game) => matchesCasinoSearch(game, search)))
          : <div className="empty-state"><strong>No games found.</strong><span>Try another title or clear the search.</span></div>
      )}

      {gamesQuery.data && !searching && filter === 'ALL' && (
        <>
          {section(featured.some((game) => game.hot) ? 'Hot right now' : 'Featured', featured.some((game) => game.hot) ? 'Popular' : undefined, featured)}
          {section('Recently played', undefined, recent)}
          {section('Favourites', undefined, favourites)}
          {section('All games', undefined, games)}
        </>
      )}
      {gamesQuery.data && !searching && filter !== 'ALL' && section(CATEGORY_LABEL[filter], undefined, games.filter((game) => game.category === filter))}

      {gamesQuery.data && !searching && filter === 'ALL' && <LiveCasinoRow />}

      <p className="m-footnote">
        <span className="m-age">18+</span>
        Outcomes are checked by the server · <Link href="/account#limits">Set limits</Link>
      </p>
    </div>
  );
}
