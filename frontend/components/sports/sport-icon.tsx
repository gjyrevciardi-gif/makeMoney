import type { ReactElement } from 'react';

/**
 * Original sport glyphs, drawn inline. Chosen by matching words in the
 * provider's own sport key/group, so an unknown sport falls back to a plain
 * disc rather than a wrong picture.
 */
const ICONS: [RegExp, ReactElement][] = [
  // Horse Racing and Esports use the app's own colour variables, so they add no new colour.
  [/horse|racing/, (
    <g>
      <path
        d="M6.3 3.8C4.5 6.1 3.6 8.6 3.6 11.2c0 5 3.6 8.6 8.4 8.6s8.4-3.6 8.4-8.6c0-2.6-.9-5.1-2.7-7.4l-2.9 1.6c1.2 1.7 1.9 3.6 1.9 5.8 0 3.1-2 5.3-4.7 5.3s-4.7-2.2-4.7-5.3c0-2.2.7-4.1 1.9-5.8z"
        style={{ fill: 'var(--ref-odds)' }}
      />
      {[[6.4, 9.6], [6.9, 13.4], [17.6, 9.6], [17.1, 13.4]].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r=".8" style={{ fill: 'var(--ref-cell)' }} />
      ))}
    </g>
  )],
  [/esport|dota|csgo|counterstrike|valorant|leagueoflegends/, (
    <g>
      <path
        d="M7 7.5h10a4 4 0 0 1 3.9 3.2l.9 4.3a2.4 2.4 0 0 1-4.1 2.1l-2.1-2.4H8.4l-2.1 2.4a2.4 2.4 0 0 1-4.1-2.1l.9-4.3A4 4 0 0 1 7 7.5z"
        style={{ fill: 'var(--ref-muted)' }}
      />
      <path d="M7.6 9.9v3.2M6 11.5h3.2" strokeWidth="1.3" strokeLinecap="round" style={{ stroke: 'var(--ref-cell)' }} />
      <circle cx="16" cy="10.6" r=".95" style={{ fill: 'var(--ref-cell)' }} />
      <circle cx="17.7" cy="12.4" r=".95" style={{ fill: 'var(--ref-cell)' }} />
    </g>
  )],
  [/americanfootball|nfl|ncaaf/, (
    <g>
      <ellipse cx="12" cy="12" rx="9" ry="5.5" transform="rotate(-35 12 12)" fill="#8a4b24" />
      <path d="m8.5 15.5 7-7M10.5 10.5l3 3" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
    </g>
  )],
  [/basketball|nba|ncaab/, (
    <g>
      <circle cx="12" cy="12" r="9" fill="#e8742a" />
      <path d="M3 12h18M12 3v18M5.6 5.6c3 3 3 9.8 0 12.8M18.4 5.6c-3 3-3 9.8 0 12.8" stroke="#3a1a08" strokeWidth="1.1" fill="none" />
    </g>
  )],
  [/tennis/, (
    <g>
      <circle cx="12" cy="12" r="9" fill="#b6d92f" />
      <path d="M4 7c5 2 5 8 0 10M20 7c-5 2-5 8 0 10" stroke="#fff" strokeWidth="1.3" fill="none" />
    </g>
  )],
  [/baseball|mlb/, (
    <g>
      <circle cx="12" cy="12" r="9" fill="#f1f1f1" />
      <path d="M6 5c3 3 3 11 0 14M18 5c-3 3-3 11 0 14" stroke="#d13b3b" strokeWidth="1.3" fill="none" />
    </g>
  )],
  [/icehockey|nhl|hockey/, (
    <g>
      <ellipse cx="12" cy="14" rx="8" ry="3.2" fill="#d6d6d6" />
      <path d="M4 14v3c0 3.6 16 3.6 16 0v-3c0 3.6-16 3.6-16 0z" fill="#111" />
    </g>
  )],
  [/golf/, (
    <g><circle cx="12" cy="10" r="5" fill="#f1f1f1" /><path d="M12 15v6" stroke="#f1f1f1" strokeWidth="1.6" /></g>
  )],
  [/mma|boxing/, <rect x="6" y="6" width="12" height="12" rx="5" fill="#d13b3b" />],
  [/soccer|football|epl|uefa|league/, (
    <g>
      <circle cx="12" cy="12" r="9" fill="#f4f4f4" />
      <path d="m12 8 3.4 2.5-1.3 4h-4.2l-1.3-4z" fill="#1a1a1a" />
      <path d="M12 8V3.2M15.4 10.5l4.5-1.4M14.1 14.5l2.8 3.8M9.9 14.5l-2.8 3.8M8.6 10.5 4.1 9.1" stroke="#1a1a1a" strokeWidth="1" />
    </g>
  )],
];

export function SportIcon({ sport, className }: { sport: string; className?: string }) {
  const key = sport.toLowerCase().replace(/[^a-z]/g, '');
  const match = ICONS.find(([pattern]) => pattern.test(key));
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      {match ? match[1] : <circle cx="12" cy="12" r="8" fill="#9aa59f" />}
    </svg>
  );
}

/** The provider calls football "Soccer"; the player-facing label is Football. */
export const sportGroupLabel = (group: string) => (group === 'Soccer' ? 'Football' : group);
