'use client';

import { useCallback, useEffect, useState } from 'react';
import { CasinoNavigation } from '../../../components/casino/casino-navigation';
import {
  CasinoRoundView,
  RoundStatus,
  casinoGet,
  fetchBalance,
  formatPoints,
} from '../../../lib/casino';

const STATUS_CLASS: Record<RoundStatus, string> = {
  OPEN: 'neutral',
  WON: 'good',
  LOST: 'bad',
  CASHED_OUT: 'good',
  CANCELLED: 'neutral',
};

const GAME_FILTERS = [
  'ALL', 'DICE', 'MINES', 'ROULETTE', 'BLACKJACK', 'CRASH', 'PLINKO', 'SLOTS',
] as const;
const STATUS_FILTERS = ['ALL', 'OPEN', 'WON', 'LOST', 'CASHED_OUT'] as const;

export default function CasinoHistory() {
  const [rounds, setRounds] = useState<CasinoRoundView[]>([]);
  const [balance, setBalance] = useState('0');
  const [game, setGame] = useState<(typeof GAME_FILTERS)[number]>('ALL');
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>('ALL');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const query = new URLSearchParams({ limit: '50' });
    if (game !== 'ALL') query.set('gameType', game);
    if (status !== 'ALL') query.set('status', status);
    const [history, points] = await Promise.all([
      casinoGet<{ rounds: CasinoRoundView[] }>(`/casino/history?${query.toString()}`),
      fetchBalance(),
    ]);
    setRounds(history?.rounds ?? []);
    setBalance(points);
    setLoading(false);
  }, [game, status]);

  useEffect(() => { void load(); }, [load]);

  return (
    <main className="ops-page">
      <CasinoNavigation balance={balance} current="History" />

      <div className="ops-content">
        <section className="ops-hero">
          <div>
            <p className="ops-kicker">YOUR ROUNDS</p>
            <h1>Casino history</h1>
          </div>
        </section>

        <div className="casino-filters">
          <div className="casino-toggle">
            {GAME_FILTERS.map((option) => (
              <button
                type="button"
                key={option}
                className={game === option ? 'active' : ''}
                onClick={() => setGame(option)}
              >
                {option === 'ALL' ? 'All games' : option}
              </button>
            ))}
          </div>
          <div className="casino-toggle">
            {STATUS_FILTERS.map((option) => (
              <button
                type="button"
                key={option}
                className={status === option ? 'active' : ''}
                onClick={() => setStatus(option)}
              >
                {option === 'ALL' ? 'All statuses' : option.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th>Game</th>
                <th>Status</th>
                <th>Stake</th>
                <th>Multiplier</th>
                <th>Returned</th>
                <th>Config</th>
                <th>Played</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td className="ops-empty" colSpan={7}>Loading…</td></tr>
              )}
              {!loading && rounds.length === 0 && (
                <tr><td className="ops-empty" colSpan={7}>No rounds yet.</td></tr>
              )}
              {!loading && rounds.map((round) => (
                <tr key={round.roundId}>
                  <td>{round.gameType}</td>
                  <td>
                    <span className={`ops-status ${STATUS_CLASS[round.status]}`}>
                      {round.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td>{formatPoints(round.stake)}</td>
                  <td>{round.multiplier ? `${round.multiplier}x` : '—'}</td>
                  <td>{round.payout === '0' ? '—' : formatPoints(round.payout)}</td>
                  <td><small>{round.gameVersion}</small></td>
                  <td><small>{new Date(round.createdAt).toLocaleString()}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
