'use client';

import Link from 'next/link';
import { memo, useState } from 'react';
import { formatPoints } from '../../lib/format';
import type { CasinoGame } from '../../lib/casino';
import { IconInfo, IconStar } from '../shell/icons';
import { GameArt } from './casino-game-card';

/** A stable colour treatment per game, so a tile keeps its look between visits. */
const tone = (key: string) => [...key].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 6;

type Props = {
  game: CasinoGame;
  favorite: boolean;
  favoritePending?: boolean;
  onFavorite: (game: CasinoGame) => void;
};

/**
 * One lobby tile.
 *
 * Square, art-dominant, with compact metadata underneath the artwork. A game an
 * operator has disabled or put into maintenance is shown as such and is not
 * linked, rather than inviting a tap the backend would refuse. The info button
 * reveals the registry description in place; it navigates nowhere.
 */
function LobbyCardBase({ game, favorite, favoritePending, onFavorite }: Props) {
  const [info, setInfo] = useState(false);
  const maintenance = Boolean(game.maintenance);
  const playable = game.enabled && !maintenance;

  const art = (
    <>
      <GameArt thumbnailKey={game.thumbnailKey} />
      <span className="ref-game-name">{game.name}</span>
    </>
  );

  return (
    <article className={`ref-game-card tone-${tone(game.thumbnailKey)}${playable ? '' : ' disabled'}`}>
      {playable
        ? <Link className="ref-game-art" href={game.route} aria-label={`Play ${game.name}`}>{art}</Link>
        : <div className="ref-game-art">{art}</div>}

      {!playable && <span className="ref-game-tag">{maintenance ? 'Maintenance' : 'Unavailable'}</span>}

      <button
        type="button"
        className={`ref-game-fav${favorite ? ' active' : ''}`}
        aria-pressed={favorite}
        aria-label={favorite ? `Remove ${game.name} from favourites` : `Add ${game.name} to favourites`}
        disabled={favoritePending}
        onClick={() => onFavorite(game)}
      >
        <IconStar filled={favorite} />
      </button>

      <div className="ref-game-meta">
        <span>{formatPoints(game.minStake)}–{formatPoints(game.maxStake)} PTS</span>
        <button
          type="button"
          className="ref-game-info"
          aria-expanded={info}
          aria-label={`About ${game.name}`}
          onClick={() => setInfo((value) => !value)}
        >
          <IconInfo />
        </button>
      </div>

      {info && (
        <div className="ref-game-blurb" role="note">
          <strong>{game.name}</strong>
          <p>{game.description}</p>
          <button type="button" onClick={() => setInfo(false)}>Close</button>
        </div>
      )}
    </article>
  );
}

export const LobbyCard = memo(LobbyCardBase);
