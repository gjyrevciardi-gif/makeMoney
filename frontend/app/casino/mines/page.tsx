'use client';

import { useEffect, useState } from 'react';
import { CasinoGameShell } from '../../../components/casino/casino-game-shell';
import {
  MinesRoundView,
  casinoGet,
  casinoGetRequired,
  casinoPost,
  describeError,
  fetchBalance,
  formatPoints,
  newIdempotencyKey,
} from '../../../lib/casino';
import { useSettledBalance } from '../../../lib/casino-queries';

type MinesConfig = {
  minStake: string;
  maxStake: string;
  rtpPercent: string;
  houseEdgePercent: string;
  version: string;
  cells: number;
  minMines: number;
  maxMines: number;
};

type MinesPublicState = {
  cells: number;
  mines: number;
  revealed: number[];
  hitCell: number | null;
};

const MINE_CHOICES = [1, 3, 5, 10, 15, 24];

export default function MinesPage() {
  const refreshBalance = useSettledBalance();
  const [config, setConfig] = useState<MinesConfig | null>(null);
  const [balance, setBalance] = useState('0');
  const [stake, setStake] = useState('100');
  const [mineCount, setMineCount] = useState(5);
  const [round, setRound] = useState<MinesRoundView | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingCell, setPendingCell] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setBootstrapLoading(true);
    setBootstrapError('');
    void (async () => {
      try {
        const [loaded, points, active] = await Promise.all([
          casinoGetRequired<MinesConfig>('/casino/games/MINES/config'),
          fetchBalance(),
          casinoGet<MinesRoundView | null>('/casino/mines/active'),
        ]);
        setConfig(loaded);
        setBalance(points);
        if (active) setRound(active);
      } catch {
        setBootstrapError('The game could not be loaded. Please retry.');
      } finally {
        setBootstrapLoading(false);
      }
    })();
  }, [retry]);

  const state = round?.state as MinesPublicState | undefined;
  const revealed = new Set(state?.revealed ?? []);
  const finished = round !== null && round.status !== 'OPEN';
  const bombs = new Set(
    (round?.fairness.revealedState as { minePositions?: number[] } | undefined)?.minePositions
    ?? [],
  );
  const stakeValue = Number(stake);

  async function run<T>(action: () => Promise<T>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      setBalance(await refreshBalance());
    } catch (failure) {
      setError(describeError(failure as { code: string; message: string }));
    } finally {
      setBusy(false);
      setPendingCell(null);
    }
  }

  const start = () => run(async () => {
    const started = await casinoPost<MinesRoundView>('/casino/mines/start', {
      stake: stakeValue,
      mines: mineCount,
      idempotencyKey: newIdempotencyKey(),
    });
    setRound(started);
  });

  const reveal = (cell: number) => {
    if (!round || round.status !== 'OPEN' || revealed.has(cell)) return;
    setPendingCell(cell);
    void run(async () => {
      const updated = await casinoPost<MinesRoundView>(
        `/casino/mines/${round.roundId}/reveal`,
        { cell, idempotencyKey: newIdempotencyKey() },
      );
      setRound(updated);
    });
  };

  const cashout = () => run(async () => {
    if (!round) return;
    const settled = await casinoPost<MinesRoundView>(
      `/casino/mines/${round.roundId}/cashout`,
      { idempotencyKey: newIdempotencyKey() },
    );
    setRound(settled);
  });

  return (
    <CasinoGameShell gameId="mines" title="Mines" balance={balance} loading={bootstrapLoading} error={bootstrapError} onRetry={() => setRetry((value) => value + 1)} ready={config !== null}>
      <div className="ops-content casino-game">
        <section className="casino-panel">
          <h2>{round && round.status === 'OPEN' ? 'Round in play' : 'New round'}</h2>

          <label className="casino-field">
            <span>Stake (points)</span>
            <input
              inputMode="numeric"
              value={stake}
              disabled={round?.status === 'OPEN'}
              onChange={(event) => setStake(event.target.value.replace(/[^\d]/g, ''))}
            />
          </label>

          <div className="casino-field">
            <span>Mines</span>
            <div className="casino-toggle">
              {MINE_CHOICES.map((choice) => (
                <button
                  type="button"
                  key={choice}
                  disabled={round?.status === 'OPEN'}
                  className={mineCount === choice ? 'active' : ''}
                  onClick={() => setMineCount(choice)}
                >
                  {choice}
                </button>
              ))}
            </div>
          </div>

          {round && (
            <dl className="casino-stats">
              <div>
                <dt>Revealed</dt>
                <dd>{round.progress.revealedCount} / {round.progress.maxSafeCells}</dd>
              </div>
              <div>
                <dt>Multiplier</dt>
                <dd>{round.progress.currentMultiplier ?? '—'}x</dd>
              </div>
              <div>
                <dt>Cash out</dt>
                <dd>{formatPoints(round.progress.potentialPayout)} pts</dd>
              </div>
            </dl>
          )}

          {round?.progress.nextMultiplier && round.status === 'OPEN' && (
            <p className="casino-meta">
              Next safe cell pays {round.progress.nextMultiplier}x ·{' '}
              {formatPoints(round.progress.nextPayout ?? '0')} pts
            </p>
          )}

          {error && <p className="casino-inline-error">{error}</p>}

          {(!round || finished) && (
            <button
              className="ops-action casino-play"
              disabled={busy || stakeValue <= 0 || stakeValue > Number(balance)}
              onClick={() => void start()}
            >
              {busy ? 'Starting…' : 'Start game'}
            </button>
          )}

          {round?.status === 'OPEN' && (
            <button
              className="ops-action casino-play"
              disabled={busy || !round.progress.canCashout}
              onClick={() => void cashout()}
            >
              Cash out {formatPoints(round.progress.potentialPayout)} pts
            </button>
          )}

          {config && (
            <p className="casino-meta">
              RTP {config.rtpPercent}% · House edge {config.houseEdgePercent}% ·
              Config {config.version}
            </p>
          )}
        </section>

        <section className="casino-panel">
          <h2>Board</h2>
          {finished && (
            <p className={`casino-banner ${round.status === 'LOST' ? 'bad' : 'good'}`}>
              {round.status === 'LOST'
                ? 'You hit a mine.'
                : `Round finished · ${formatPoints(round.payout)} pts returned`}
            </p>
          )}

          <div className="casino-board" aria-label="Mines board">
            {Array.from({ length: config?.cells ?? 25 }, (_, cell) => {
              const isRevealed = revealed.has(cell);
              const isBomb = bombs.has(cell);
              const isHit = state?.hitCell === cell;
              const classes = ['casino-cell'];
              if (isRevealed) classes.push('safe');
              if (finished && isBomb) classes.push('mine');
              if (isHit) classes.push('hit');
              if (pendingCell === cell) classes.push('pending');
              return (
                <button
                  type="button"
                  key={cell}
                  className={classes.join(' ')}
                  disabled={busy || !round || round.status !== 'OPEN' || isRevealed}
                  onClick={() => reveal(cell)}
                  aria-label={`Cell ${cell + 1}`}
                >
                  {isRevealed ? '◆' : finished && isBomb ? '✷' : ''}
                </button>
              );
            })}
          </div>

          {!round && (
            <p className="state">Start a round to reveal cells. The board is generated
              and held on the server.</p>
          )}

          {round && (
            <details>
              <summary>Verifiable result</summary>
              <p className="casino-seed">Commitment: {round.fairness.serverSeedHash}</p>
              {round.fairness.serverSeed
                ? <p className="casino-seed">Server seed: {round.fairness.serverSeed}</p>
                : <p className="casino-meta">The seed is revealed when the round ends.</p>}
            </details>
          )}
        </section>
      </div>
    </CasinoGameShell>
  );
}
