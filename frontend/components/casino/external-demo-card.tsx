'use client';

import { memo, type ReactElement } from 'react';
import type { ExternalDemoGame } from '../../lib/external-demo-games';

/**
 * Locally drawn artwork, exactly as the internal cards do it.
 *
 * No provider logo, screenshot or other third-party asset is fetched or bundled:
 * each thumbnail is an abstract shape from the shared token palette that hints
 * at the theme without reproducing anything the provider owns.
 */
const ART: Record<string, ReactElement> = {
  olympus: (
    <g>
      <path className="demo-stroke" d="M12 46h40M16 46V26M32 46V22M48 46V26" />
      <path className="demo-stroke" d="M10 24 32 10l22 14z" />
      <path className="demo-fill" d="M30 30l-5 10h6l-3 8 8-11h-6z" />
    </g>
  ),
  bass: (
    <g>
      <path className="demo-stroke" d="M10 32c8-11 24-11 32 0-8 11-24 11-32 0z" />
      <path className="demo-stroke" d="M42 32l10-8v16z" />
      <circle className="demo-fill" cx="20" cy="29" r="2.5" />
      <path className="demo-stroke" d="M12 44c6 4 14 4 20 0" opacity="0.55" />
    </g>
  ),
  sugar: (
    <g>
      <circle className="demo-stroke" cx="32" cy="32" r="13" />
      <path className="demo-stroke" d="M19 32 8 25v14zM45 32l11-7v14z" />
      <circle className="demo-fill" cx="32" cy="32" r="4" />
    </g>
  ),
  starlight: (
    <g>
      <path className="demo-fill" d="M32 12l5 12 13 1-10 8 3 13-11-7-11 7 3-13-10-8 13-1z" />
      <circle className="demo-fill" cx="14" cy="46" r="2" opacity="0.7" />
      <circle className="demo-fill" cx="50" cy="44" r="2.5" opacity="0.7" />
    </g>
  ),
  book: (
    <g>
      <path className="demo-stroke" d="M12 16h16a6 6 0 016 6v26a6 6 0 00-6-6H12zM52 16H36a6 6 0 00-6 6v26a6 6 0 016-6h16z" />
      <circle className="demo-fill" cx="32" cy="30" r="3" />
    </g>
  ),
  legacy: (
    <g>
      <path className="demo-stroke" d="M12 50 32 12l20 38z" />
      <path className="demo-stroke" d="M22 50l10-19 10 19" opacity="0.6" />
      <circle className="demo-fill" cx="32" cy="40" r="3" />
    </g>
  ),
  reactoonz: (
    <g>
      <circle className="demo-stroke" cx="22" cy="26" r="9" />
      <circle className="demo-stroke" cx="42" cy="26" r="9" opacity="0.6" />
      <circle className="demo-stroke" cx="32" cy="44" r="9" opacity="0.8" />
      <circle className="demo-fill" cx="22" cy="26" r="2.5" />
      <circle className="demo-fill" cx="42" cy="26" r="2.5" />
    </g>
  ),
  joker: (
    <g>
      <path className="demo-stroke" d="M32 52c-9 0-15-6-15-14 0-9 8-13 8-22 6 4 8 8 8 13 3-2 4-5 4-8 6 5 10 11 10 17 0 8-6 14-15 14z" />
      <circle className="demo-fill" cx="32" cy="42" r="4" />
    </g>
  ),
};

/**
 * One third-party demo card.
 *
 * Deliberately different from an internal card: a different frame, an "External
 * Demo" badge, the provider's name, and no stake range, no favourite control and
 * no fairness note — because none of those exist for a game we do not run. It
 * opens the provider's own page in a new tab and touches nothing in our state.
 */
function ExternalDemoCardBase({ game }: { game: ExternalDemoGame }) {
  return (
    <article className="casino-demo-card">
      <span className="casino-demo-tag">External Demo</span>

      <a
        className="casino-demo-card-link"
        href={game.demoUrl}
        target="_blank"
        // noopener severs window.opener so the provider page cannot reach back
        // into this tab; noreferrer additionally withholds the referring URL.
        rel="noopener noreferrer"
      >
        <div className={`casino-demo-art demo-art-${game.artKey}`} aria-hidden="true">
          <svg viewBox="0 0 64 64">{ART[game.artKey] ?? ART.olympus}</svg>
        </div>

        <div className="casino-game-card-copy">
          <strong>{game.name}</strong>
          <p>{game.description}</p>
          <div className="casino-game-card-meta">
            <span className="pill demo-pill">{game.provider}</span>
          </div>
        </div>

        <div className="casino-demo-card-footer">
          <span className="casino-demo-note">Demo only — Fool&apos;s Gold points are not used.</span>
          <span className="casino-demo-play">
            Open demo
            <svg viewBox="0 0 24 24" aria-hidden="true" className="casino-demo-external-icon">
              <path d="M14 4h6v6M20 4l-9 9" />
              <path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />
            </svg>
            <span className="sr-only">(opens {game.provider} in a new tab)</span>
          </span>
        </div>
      </a>
    </article>
  );
}

export const ExternalDemoCard = memo(ExternalDemoCardBase);
