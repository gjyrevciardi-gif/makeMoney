'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSports, type Sport } from '../../lib/sports';
import { SportIcon } from '../sports/sport-icon';

const USAGE_KEY = 'fg.sport-usage';
const TRENDING_LIMIT = 10;
const MOST_USED_LIMIT = 4;

/** Per-viewer click counts; storage may be unavailable, so every access is guarded. */
function readUsage(): Record<string, number> {
  try {
    return JSON.parse(window.localStorage.getItem(USAGE_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

function SportLink({ sport, selected, onUse }: { sport: Sport; selected: boolean; onUse: (key: string) => void }) {
  return (
    <Link
      className="ref-nav-item"
      href={`/sports?sport=${encodeURIComponent(sport.key)}`}
      aria-current={selected ? 'page' : undefined}
      onClick={() => onUse(sport.key)}
    >
      <SportIcon sport={`${sport.key} ${sport.group ?? ''}`} className="ref-nav-icon" />
      <span>{sport.name}</span>
    </Link>
  );
}

/**
 * Left navigation: Trending, Most Used, A-Z.
 *
 * Every entry is a sport the provider actually lists. "Trending" is the
 * provider's own ordering (no popularity data exists); "Most Used" is this
 * browser's own click history, kept in localStorage and never sent anywhere.
 */
export function SportsNav() {
  const sports = useSports();
  const params = useSearchParams();
  const selected = params.get('sport');
  const [usage, setUsage] = useState<Record<string, number>>({});

  useEffect(() => setUsage(readUsage()), []);

  const onUse = useCallback((key: string) => {
    const next = { ...readUsage(), [key]: (readUsage()[key] ?? 0) + 1 };
    try { window.localStorage.setItem(USAGE_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    setUsage(next);
  }, []);

  const list = useMemo(() => sports.data ?? [], [sports.data]);
  const trending = list.slice(0, TRENDING_LIMIT);
  const mostUsed = useMemo(
    () => list.filter((sport) => (usage[sport.key] ?? 0) > 0)
      .sort((a, b) => (usage[b.key] ?? 0) - (usage[a.key] ?? 0))
      .slice(0, MOST_USED_LIMIT),
    [list, usage],
  );
  const alphabetical = useMemo(() => [...list].sort((a, b) => a.name.localeCompare(b.name)), [list]);

  return (
    <aside className="ref-sidebar" aria-label="Sports navigation">
      {sports.isPending && (
        <div aria-busy="true">
          {Array.from({ length: 8 }, (_, index) => <span key={index} className="skeleton ref-nav-skeleton" />)}
        </div>
      )}

      {sports.isError && (
        <p className="ref-nav-note">
          Sports are temporarily unavailable.{' '}
          <button type="button" onClick={() => void sports.refetch()}>Retry</button>
        </p>
      )}

      {sports.data && list.length === 0 && <p className="ref-nav-note">No sports are available right now.</p>}

      {trending.length > 0 && (
        <nav aria-labelledby="ref-nav-trending">
          <h2 id="ref-nav-trending" className="ref-nav-title">Trending</h2>
          {trending.map((sport) => (
            <SportLink key={sport.key} sport={sport} selected={selected === sport.key} onUse={onUse} />
          ))}
        </nav>
      )}

      {mostUsed.length > 0 && (
        <nav aria-labelledby="ref-nav-used">
          <h2 id="ref-nav-used" className="ref-nav-title">Most Used</h2>
          {mostUsed.map((sport) => (
            <SportLink key={sport.key} sport={sport} selected={selected === sport.key} onUse={onUse} />
          ))}
        </nav>
      )}

      {alphabetical.length > 0 && (
        <nav aria-labelledby="ref-nav-az">
          <h2 id="ref-nav-az" className="ref-nav-title">A-Z</h2>
          {alphabetical.map((sport) => (
            <SportLink key={sport.key} sport={sport} selected={selected === sport.key} onUse={onUse} />
          ))}
        </nav>
      )}
    </aside>
  );
}
