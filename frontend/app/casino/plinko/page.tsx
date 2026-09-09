'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CasinoGameShell } from '../../../components/casino/casino-game-shell';
import {
  CasinoRoundView,
  casinoGet,
  casinoGetRequired,
  casinoPost,
  describeError,
  fetchBalance,
  formatPoints,
  newIdempotencyKey,
} from '../../../lib/casino';

type PlinkoBoard = {
  rows: number;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  version: string;
  buckets: number;
  paytable: string[];
  rtpBps: number;
  rtpPercent: string;
};

type PlinkoConfig = {
  supportedRows: number[];
  riskLevels: ('LOW' | 'MEDIUM' | 'HIGH')[];
  minStake: string;
  maxStake: string;
  boards: PlinkoBoard[];
  note: string;
};

type PlinkoState = {
  rows: number;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  path: ('L' | 'R')[];
  bucketIndex: number;
  multiplier: string;
  paytable: string[];
  config: { version: string; rtpBps: number };
};

const STEP_MS = 90;

export default function PlinkoPage() {
  const [config, setConfig] = useState<PlinkoConfig | null>(null);
  const [balance, setBalance] = useState('0');
  const [stake, setStake] = useState('100');
  const [rows, setRows] = useState(12);
  const [risk, setRisk] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM');
  const [result, setResult] = useState<CasinoRoundView | null>(null);
  const [history, setHistory] = useState<CasinoRoundView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState('');
  const [retry, setRetry] = useState(0);
  /** How many of the authoritative path steps have been drawn so far. */
  const [step, setStep] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const board = config?.boards.find((entry) => entry.rows === rows && entry.risk === risk);

  const loadHistory = useCallback(async () => {
    const past = await casinoGet<{ rounds: CasinoRoundView[] }>(
      '/casino/history?gameType=PLINKO&limit=10',
    );
    setHistory(past?.rounds ?? []);
  }, []);

  useEffect(() => {
    setBootstrapLoading(true);
    setBootstrapError('');
    void (async () => {
      try {
        const [loaded, points] = await Promise.all([
          casinoGetRequired<PlinkoConfig>('/casino/games/PLINKO/config'),
          fetchBalance(),
        ]);
        setConfig(loaded);
        setBalance(points);
        await loadHistory();
      } catch {
        setBootstrapError('The game could not be loaded. Please retry.');
      } finally {
        setBootstrapLoading(false);
      }
    })();
    return () => timers.current.forEach(clearTimeout);
  }, [loadHistory, retry]);

  const state = result?.state as unknown as PlinkoState | undefined;
  const stakeValue = Number(stake);

  /**
   * Replays the authoritative path one peg at a time. The ball's position at
   * every step is the number of RIGHT decisions the server actually made, so
   * the animation cannot disagree with the settled bucket.
   */
  const animate = useCallback((path: ('L' | 'R')[]) => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setStep(0);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setStep(path.length);
      return;
    }
    for (let index = 1; index <= path.length; index += 1) {
      timers.current.push(setTimeout(() => setStep(index), index * STEP_MS));
    }
  }, []);

  async function play() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const round = await casinoPost<CasinoRoundView>('/casino/plinko/play', {
        stake: stakeValue,
        rows,
        risk,
        idempotencyKey: newIdempotencyKey(),
      });
      setResult(round);
      animate((round.state as unknown as PlinkoState).path);
      setBalance(await fetchBalance());
      await loadHistory();
    } catch (failure) {
      setError(describeError(failure as { code: string; message: string }));
    } finally {
      setBusy(false);
    }
  }

  // Ball offset after `step` pegs: RIGHT decisions taken so far.
  const rightsSoFar = state ? state.path.slice(0, step).filter((s) => s === 'R').length : 0;
  const landed = state !== undefined && step >= state.path.length;
  const paytable = board?.paytable ?? state?.paytable ?? [];

  return (
    <CasinoGameShell gameId="plinko" title="Plinko" balance={balance} loading={bootstrapLoading} error={bootstrapError} onRetry={() => setRetry((value) => value + 1)} ready={config !== null}>
      <div className="ops-content casino-game">
        <section className="casino-panel">
          <h2>Drop</h2>

          <label className="casino-field">
            <span>Stake (points)</span>
            <input
              inputMode="numeric"
              value={stake}
              onChange={(event) => setStake(event.target.value.replace(/[^\d]/g, ''))}
            />
          </label>

          <div className="casino-field">
            <span>Rows</span>
            <div className="casino-toggle">
              {(config?.supportedRows ?? [8, 12, 16]).map((option) => (
                <button
                  type="button"
                  key={option}
                  className={rows === option ? 'active' : ''}
                  onClick={() => setRows(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="casino-field">
            <span>Risk</span>
            <div className="casino-toggle">
              {(config?.riskLevels ?? ['LOW', 'MEDIUM', 'HIGH']).map((option) => (
                <button
                  type="button"
                  key={option}
                  className={risk === option ? 'active' : ''}
                  onClick={() => setRisk(option)}
                >
                  {option.charAt(0) + option.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>

          <dl className="casino-stats">
            <div><dt>Buckets</dt><dd>{rows + 1}</dd></div>
            <div><dt>Top pay</dt><dd>{paytable[0] ?? '—'}x</dd></div>
            <div><dt>RTP</dt><dd>{board ? `${(board.rtpBps / 100).toFixed(2)}%` : '—'}</dd></div>
          </dl>

          {stakeValue > Number(balance) && (
            <p className="casino-inline-error">Not enough virtual points.</p>
          )}
          {error && <p className="casino-inline-error">{error}</p>}

          <button
            className="ops-action casino-play"
            disabled={busy || stakeValue <= 0 || stakeValue > Number(balance)}
            onClick={() => void play()}
          >
            {busy ? 'Dropping…' : 'Drop ball'}
          </button>

          {board && (
            <p className="casino-meta">
              Paytable {board.version} · published by the server. {config?.note}
            </p>
          )}
        </section>

        <section className="casino-panel">
          <h2>Board</h2>

          {landed && state && result && (
            <p className={`casino-banner ${Number(result.payout) > Number(result.stake) ? 'good' : 'bad'}`}>
              Bucket {state.bucketIndex} · {state.multiplier}x ·{' '}
              {formatPoints(result.payout)} pts returned
            </p>
          )}

          <div className="casino-plinko-board">
            {Array.from({ length: rows }, (_, row) => (
              <div className="casino-peg-row" key={row}>
                {Array.from({ length: row + 1 }, (_, peg) => (
                  <span
                    className={`casino-peg ${
                      state && step > row && rightsSoFarAt(state.path, row + 1) === peg
                        ? 'lit'
                        : ''
                    }`}
                    key={peg}
                  />
                ))}
              </div>
            ))}
          </div>

          <div className="casino-buckets" style={{ '--buckets': rows + 1 } as React.CSSProperties}>
            {paytable.map((multiplier, bucket) => (
              <span
                key={bucket}
                className={`casino-bucket ${
                  landed && state?.bucketIndex === bucket ? 'hit' : ''
                } ${Number(multiplier) >= 1 ? 'up' : 'down'}`}
              >
                {multiplier}x
              </span>
            ))}
          </div>

          {state && !landed && (
            <p className="casino-meta">
              Replaying the server path: {state.path.slice(0, step).join(' ')}
            </p>
          )}

          {result && landed && (
            <details>
              <summary>Verifiable result</summary>
              <p className="casino-seed">Path: {state?.path.join('')}</p>
              <p className="casino-seed">Commitment: {result.fairness.serverSeedHash}</p>
              {result.fairness.serverSeed && (
                <p className="casino-seed">Server seed: {result.fairness.serverSeed}</p>
              )}
            </details>
          )}

          <h3 className="casino-subheading">Recent drops</h3>
          {history.length === 0 && <p className="state">No drops yet.</p>}
          <ul className="casino-history">
            {history.map((past) => {
              const previous = past.state as unknown as PlinkoState;
              return (
                <li key={past.roundId}>
                  <span className={Number(past.payout) > Number(past.stake) ? 'good' : 'bad'}>
                    {previous.multiplier}x
                  </span>
                  <span>{previous.rows} rows</span>
                  <span>{previous.risk}</span>
                  <span>{formatPoints(past.payout)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </CasinoGameShell>
  );
}

/** RIGHT decisions taken in the first `count` steps of the authoritative path. */
function rightsSoFarAt(path: ('L' | 'R')[], count: number) {
  return path.slice(0, count).filter((step) => step === 'R').length;
}
