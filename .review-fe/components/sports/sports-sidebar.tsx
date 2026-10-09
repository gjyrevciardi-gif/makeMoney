'use client';

import type { Sport } from '../../lib/sports';

/** The sport list as a horizontal strip, for screens too narrow for the sidebar. */
export function SportTabs({ sports, selected, onSelect }: {
  sports: Sport[];
  selected: string | undefined;
  onSelect: (sportKey: string) => void;
}) {
  return (
    <div className="ref-sport-tabs" role="tablist" aria-label="Sports">
      {sports.map((sport) => (
        <button
          type="button"
          role="tab"
          key={sport.key}
          aria-selected={selected === sport.key}
          className={selected === sport.key ? 'active' : ''}
          onClick={() => onSelect(sport.key)}
        >
          {sport.name}
        </button>
      ))}
    </div>
  );
}
