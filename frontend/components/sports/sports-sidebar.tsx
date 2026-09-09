'use client';

import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '../../lib/queries';
import { groupSports, isLive, type Sport, type SportsBoard } from '../../lib/sports';
import { IconLive, IconSports } from '../shell/icons';

type SportsSidebarProps = {
  sports: Sport[];
  selected: string | undefined;
  onSelect: (sportKey: string) => void;
  loading: boolean;
};

/**
 * Counts come only from boards this session already loaded.
 *
 * Reading the query cache means the sidebar never triggers a provider request
 * purely to decorate a number, and a sport with no cached board simply shows no
 * count rather than a guess.
 */
function useCachedCounts() {
  const client = useQueryClient();
  return (sportKey: string) => {
    const board = client.getQueryData<SportsBoard>(qk.board(sportKey));
    if (!board) return null;
    return {
      total: board.events.length,
      live: board.events.filter((row) => isLive(row.event)).length,
    };
  };
}

export function SportsSidebar({ sports, selected, onSelect, loading }: SportsSidebarProps) {
  const counts = useCachedCounts();
  const groups = groupSports(sports);

  return (
    <aside className="sb-sidebar">
      <div className="sb-sidebar-inner">
        <div className="sb-nav-group">
          <p className="sb-nav-title">Sportsbook</p>
          <Link className="sb-nav-item" href="/live">
            <IconLive className="sb-nav-icon" />
            <span className="sb-nav-label">Live now</span>
          </Link>
          <Link className="sb-nav-item" href="/my-bets">
            <IconSports className="sb-nav-icon" />
            <span className="sb-nav-label">My bets</span>
          </Link>
        </div>

        {loading && (
          <div className="sb-nav-group" aria-busy="true">
            <p className="sb-nav-title">Sports</p>
            {Array.from({ length: 7 }, (_, index) => (
              <span key={index} className="skeleton" style={{ height: 30, margin: '4px 0' }} />
            ))}
          </div>
        )}

        {groups.map((group) => (
          <div className="sb-nav-group" key={group.name}>
            <p className="sb-nav-title">{group.name}</p>
            {group.sports.map((sport) => {
              const count = counts(sport.key);
              return (
                <button
                  type="button"
                  key={sport.key}
                  className={`sb-nav-item${selected === sport.key ? ' active' : ''}`}
                  aria-current={selected === sport.key ? 'true' : undefined}
                  onClick={() => onSelect(sport.key)}
                >
                  <span className="sb-nav-label">{sport.name}</span>
                  {count && count.live > 0 && (
                    <span className="pill live" style={{ padding: '1px 5px' }}>
                      <span className="live-dot" />{count.live}
                    </span>
                  )}
                  {count && <span className="sb-nav-count">{count.total}</span>}
                </button>
              );
            })}
          </div>
        ))}

        {!loading && groups.length === 0 && (
          <p className="state" style={{ padding: '0 8px' }}>No sports are available right now.</p>
        )}
      </div>
    </aside>
  );
}

/** The same sport list as a horizontal strip, for narrow screens. */
export function SportTabs({ sports, selected, onSelect }: Omit<SportsSidebarProps, 'loading'>) {
  return (
    <div className="sb-sport-tabs" role="tablist" aria-label="Sports">
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
