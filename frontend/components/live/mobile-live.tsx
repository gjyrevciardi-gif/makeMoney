'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useHydrated } from '../../lib/hydrated';
import { useLiveBoards, useLiveInfoMap, type LiveInfo } from '../../lib/mobile';
import {
  groupByCompetition, isLive, isStale, sportGroup, useSports, type BoardEvent, type Sport,
} from '../../lib/sports';
import { IconStats, IconTv } from '../shell/icons';
import { PriceTriplet } from '../sports/price-triplet';
import { sportGroupLabel } from '../sports/sport-icon';

type LiveRowData = { row: BoardEvent; group: string };

function Score({ columns, strong }: { columns: (number | string)[]; strong: boolean }) {
  return (
    <>
      {columns.map((value, index) => {
        const last = index === columns.length - 1;
        return (
          <span key={index} className={`m-score${last ? ' last' : ''}${last && strong ? ' lead' : ''}${columns.length > 1 && last ? ' wide' : ''}`}>
            {value}
          </span>
        );
      })}
    </>
  );
}

function LiveRow({ row, info, stale }: { row: BoardEvent; info: LiveInfo | undefined; stale: boolean }) {
  const { event } = row;
  const href = `/sports/event/${encodeURIComponent(event.providerEventId)}?sport=${encodeURIComponent(event.sportKey)}`;
  const homeLead = info?.home && info.away ? lastNumber(info.home) > lastNumber(info.away) : false;
  const awayLead = info?.home && info.away ? lastNumber(info.away) > lastNumber(info.home) : false;

  return (
    <div className="m-live-row">
      <div className="m-live-top">
        <span className="m-ring" aria-hidden="true"><i /><i /></span>
        <span className="m-live-label">Live</span>
        {info?.clock && <span className="m-live-clock">{info.clock}</span>}
        {info?.goal && <span className="m-goal">{info.goal}</span>}
        <span className="m-live-tools">
          {info?.stream && <span className="m-tool static" role="img" aria-label={`Stream available for ${event.homeTeam} v ${event.awayTeam}`}><IconTv /></span>}
          <Link className="m-tool" href={href} aria-label={`Markets and stats, ${event.homeTeam} v ${event.awayTeam}`}><IconStats /></Link>
        </span>
      </div>
      <div className="m-live-main">
        <Link className="m-live-teams" href={href}>
          <span className="m-live-team">
            <i className={`m-serve${info?.serve === 'home' ? ' on' : ''}`} aria-hidden="true" />
            <span className="m-live-name">{event.homeTeam}</span>
            {info?.home && <Score columns={info.home} strong={homeLead} />}
          </span>
          <span className="m-live-team">
            <i className={`m-serve${info?.serve === 'away' ? ' on' : ''}`} aria-hidden="true" />
            <span className="m-live-name">{event.awayTeam}</span>
            {info?.away && <Score columns={info.away} strong={awayLead} />}
          </span>
        </Link>
        <PriceTriplet row={row} stale={stale} compact />
      </div>
    </div>
  );
}

const lastNumber = (columns: (number | string)[]) => Number(columns[columns.length - 1]) || 0;

export function MobileLiveSkeleton() {
  return (
    <div className="m-live" aria-busy="true" aria-label="Loading live events">
      <div className="m-pills m-scroll">{[0, 1, 2, 3].map((index) => <span key={index} className="skeleton m-pill-skel" />)}</div>
      {[0, 1].map((index) => <span key={index} className="skeleton m-live-skel" />)}
    </div>
  );
}

/**
 * The phone Live screen.
 *
 * "Live" means what the feed says it means: the fixture has started. The clock,
 * score, serving player, goal flash and stream marker are shown per row only
 * when the platform supplies them, which today it does not. Prices for a started
 * event are suspended (the backend refuses a stake on it), hatched with a lock.
 */
export function MobileLive() {
  // Fetching starts after mount, so the first client render matches the server's skeleton.
  const hydrated = useHydrated();
  return hydrated ? <LiveScreen /> : <MobileLiveSkeleton />;
}

function LiveScreen() {
  const sports = useSports();
  const list = useMemo<Sport[]>(() => sports.data ?? [], [sports.data]);
  const { boards, pending, allFailed } = useLiveBoards(list);
  const infoMap = useLiveInfoMap();
  const [filter, setFilter] = useState('all');

  const groupOf = useMemo(() => {
    const map = new Map(list.map((sport) => [sport.key, sportGroupLabel(sportGroup(sport))]));
    return (key: string) => map.get(key) ?? sportGroupLabel(key.split('_')[0] ?? key);
  }, [list]);

  const live = useMemo<LiveRowData[]>(() => {
    const seen = new Set<string>();
    const rows: LiveRowData[] = [];
    for (const board of boards) {
      for (const row of board.events) {
        if (!isLive(row.event) || seen.has(row.event.providerEventId)) continue;
        seen.add(row.event.providerEventId);
        rows.push({ row, group: groupOf(row.event.sportKey) });
      }
    }
    return rows;
  }, [boards, groupOf]);

  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of live) counts.set(entry.group, (counts.get(entry.group) ?? 0) + 1);
    return [...counts.entries()].map(([name, count]) => ({ name, count }));
  }, [live]);

  const active = filter === 'all' || groups.some((group) => group.name === filter) ? filter : 'all';
  const shown = live.filter((entry) => active === 'all' || entry.group === active);
  const competitions = useMemo(() => groupByCompetition(shown.map((entry) => entry.row)), [shown]);
  const staleOf = (key: string) => isStale(boards.find((board) => board.sportKey === key)?.staleAt);

  if (sports.isPending || (pending && boards.length === 0)) return <MobileLiveSkeleton />;

  if (sports.isError || allFailed) {
    return (
      <div className="empty-state">
        <strong>Live events are temporarily unavailable.</strong>
        <span>Nothing was charged and no bet was affected.</span>
        <button type="button" className="btn btn-sm" onClick={() => { void sports.refetch(); }}>Retry</button>
      </div>
    );
  }

  return (
    <div className="m-live">
      <div role="tablist" aria-label="Filter live events" className="m-pills m-scroll">
        <button type="button" role="tab" aria-selected={active === 'all'} className="m-pill-tab" onClick={() => setFilter('all')}>
          All<span>{live.length}</span>
        </button>
        {groups.map((group) => (
          <button
            key={group.name}
            type="button"
            role="tab"
            aria-selected={active === group.name}
            className="m-pill-tab"
            onClick={() => setFilter(group.name)}
          >
            {group.name}<span>{group.count}</span>
          </button>
        ))}
      </div>

      {live.length === 0 && (
        <div className="empty-state">
          <strong>No live events right now.</strong>
          <span>Events appear here as soon as they start.</span>
          <Link className="btn btn-sm" href="/">Browse upcoming</Link>
        </div>
      )}

      {competitions.map((competition) => (
        <section key={competition.name} className="m-league m-live-group" aria-label={competition.name}>
          <div className="m-live-group-head">
            <span className="m-league-name">{competition.name}</span>
            <span className="m-league-count">{competition.events.length}</span>
          </div>
          {competition.events.map((row) => (
            <LiveRow
              key={row.event.providerEventId}
              row={row}
              info={infoMap[row.event.providerEventId]}
              stale={staleOf(row.event.sportKey)}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
