'use client';

import Link from 'next/link';
import { memo, type ReactElement } from 'react';
import { categoryLabel } from '../../lib/casino-discovery';
import { formatPoints } from '../../lib/format';
import type { CasinoGame } from '../../lib/casino';
import { IconStar } from '../shell/icons';

/**
 * Original artwork.
 *
 * Every thumbnail is drawn here as inline SVG from the shared token palette.
 * No commercial casino-provider imagery is used anywhere in the product, and no
 * external image is fetched, so a card costs nothing beyond the markup.
 */
function GameArt({ thumbnailKey }: { thumbnailKey: string }) {
  const key = thumbnailKey.replace(/[^a-z0-9-]/g, '-');
  return (
    <div className={`casino-game-art art-${key}`} aria-hidden="true">
      <svg viewBox="0 0 64 64">{ART[thumbnailKey] ?? ART.dice}</svg>
    </div>
  );
}

const ART: Record<string, ReactElement> = {
  dice: (
    <g>
      <rect className="accent-stroke" x="10" y="10" width="34" height="34" rx="7" />
      <rect className="accent-stroke" x="22" y="22" width="32" height="32" rx="7" opacity="0.55" />
      <circle className="accent-fill" cx="20" cy="20" r="3" />
      <circle className="accent-fill" cx="34" cy="34" r="3" />
      <circle className="accent-fill" cx="20" cy="34" r="3" />
      <circle className="accent-fill" cx="34" cy="20" r="3" />
    </g>
  ),
  mines: (
    <g>
      <circle className="accent-stroke" cx="30" cy="36" r="15" />
      <path className="accent-stroke" d="M40 26l7-7M45 14l3 3M50 19l-3-3" />
      <circle className="accent-fill" cx="24" cy="31" r="3" opacity="0.8" />
    </g>
  ),
  crash: (
    <g>
      <path className="accent-stroke" d="M8 52C22 52 34 42 40 26l4-10" />
      <path className="accent-stroke" d="M38 12h10v10" />
      <circle className="accent-fill" cx="44" cy="16" r="3" />
    </g>
  ),
  plinko: (
    <g>
      <circle className="accent-fill" cx="32" cy="12" r="2.5" />
      <circle className="accent-fill" cx="24" cy="24" r="2.5" opacity="0.7" />
      <circle className="accent-fill" cx="40" cy="24" r="2.5" opacity="0.7" />
      <circle className="accent-fill" cx="16" cy="36" r="2.5" opacity="0.55" />
      <circle className="accent-fill" cx="32" cy="36" r="2.5" opacity="0.55" />
      <circle className="accent-fill" cx="48" cy="36" r="2.5" opacity="0.55" />
      <path className="accent-stroke" d="M32 8v6M28 18l-6 4M36 18l6 4" opacity="0.6" />
      <rect className="accent-stroke" x="10" y="46" width="44" height="8" rx="3" />
    </g>
  ),
  roulette: (
    <g>
      <circle className="accent-stroke" cx="32" cy="32" r="22" />
      <circle className="accent-stroke" cx="32" cy="32" r="9" opacity="0.6" />
      <path className="accent-stroke" d="M32 10v12M32 42v12M10 32h12M42 32h12" opacity="0.6" />
      <circle className="accent-fill" cx="32" cy="15" r="3" />
    </g>
  ),
  blackjack: (
    <g>
      <rect className="accent-stroke" x="12" y="14" width="24" height="34" rx="4" transform="rotate(-12 24 31)" />
      <rect className="accent-stroke" x="28" y="16" width="24" height="34" rx="4" transform="rotate(9 40 33)" />
      <path className="accent-fill" d="M40 26l5 7-5 7-5-7z" />
    </g>
  ),
  'fools-gold-rush': (
    <g>
      <path className="accent-stroke" d="M14 44l8-24 10 8 10-14 8 30z" />
      <circle className="accent-fill" cx="32" cy="14" r="3.5" />
      <path className="accent-stroke" d="M10 50h44" />
    </g>
  ),
};

type CardProps = {
  game: CasinoGame;
  favorite: boolean;
  favoritePending?: boolean;
  onFavorite: (game: CasinoGame) => void;
  contextLabel?: string;
};

/**
 * One polished, registry-driven game card.
 *
 * Availability is presented honestly: a game an operator has disabled or put
 * into maintenance is shown as such and is not linked, rather than inviting a
 * tap that the backend would refuse.
 */
function CasinoGameCardBase({ game, favorite, favoritePending, onFavorite, contextLabel }: CardProps) {
  const maintenance = Boolean(game.maintenance);
  const playable = game.enabled && !maintenance;

  const body = (
    <>
      <GameArt thumbnailKey={game.thumbnailKey} />
      <div className="casino-game-card-copy">
        <strong>{game.name}</strong>
        <p>{game.description}</p>
        <div className="casino-game-card-meta">
          <span className="pill">{categoryLabel(game.category)}</span>
          {contextLabel && <span className="pill">{contextLabel}</span>}
        </div>
      </div>
      <div className="casino-game-card-footer">
        <span className="slip-note">
          {formatPoints(game.minStake)}–{formatPoints(game.maxStake)} pts
        </span>
        <span className="casino-card-play">
          {playable ? 'Play →' : maintenance ? 'Maintenance' : 'Unavailable'}
        </span>
      </div>
    </>
  );

  return (
    <article className={`casino-game-card${playable ? '' : ' casino-game-card-disabled'}`}>
      {game.featured && playable && <span className="casino-card-tag">Featured</span>}
      {maintenance && <span className="casino-card-tag warn">Maintenance</span>}
      {!game.enabled && <span className="casino-card-tag bad">Unavailable</span>}

      <button
        type="button"
        className={`casino-favorite-button${favorite ? ' active' : ''}`}
        aria-pressed={favorite}
        aria-label={favorite ? `Remove ${game.name} from favourites` : `Add ${game.name} to favourites`}
        disabled={favoritePending}
        onClick={() => onFavorite(game)}
      >
        <IconStar filled={favorite} className="league-chevron" />
      </button>

      {playable
        ? <Link className="casino-game-card-link" href={game.route}>{body}</Link>
        : <div className="casino-game-card-link">{body}</div>}
    </article>
  );
}

export const CasinoGameCard = memo(CasinoGameCardBase);
