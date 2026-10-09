'use client';

import { useEffect, useMemo, useState } from 'react';
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

type DiceConfig = {
  minStake: string;
  maxStake: string;
  rtpBps: number;
  houseEdgeBps: number;
  rtpPercent: string;
  houseEdgePercent: string;
  version: string;
  minTarget: number;
  maxTarget: number;
  scale: number;
};

type DiceState = {
  mode: 'ROLL_UNDER' | 'ROLL_OVER';
  target: number;
  roll: number;
  won: boolean;
  winCount: number;
  quotedMultiplier: string;
};

/** Display helper only: the server recomputes and owns the authoritative value. */
const estimate = (config: DiceConfig | null, mode: string, target: number) => {
  if (!config) return { chance: '0.00', multiplier: '0.00' };
  const winCount = mode === 'ROLL_UNDER' ? target : config.scale - 1 - target;
  if (winCount <= 0) return { chance: '0.00', multiplier: '0.00' };
  return {
    chance: ((winCount / config.scale) * 100).toFixed(2),
    multiplier: (config.rtpBps / winCount).toFixed(4),
  };
};

export default function DicePage() {
  const [config, setConfig] = useState<DiceConfig | null>(null);
  const [balance, setBalance] = useState('0');
  const [stake, setStake] = useState('100');
  const [mode, setMode] = useState<'ROLL_UNDER' | 'ROLL_OVER'>('ROLL_UNDER');
  const [target, setTarget] = useState(5_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CasinoRoundView | null>(null);
  const [history, setHistory] = useState<CasinoRoundView[]>([]);
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setBootstrapLoading(true);
    setBootstrapError('');
    void (async () => {
      try {
        const [loaded, points, past] = await Promise.all([
          casinoGetRequired<DiceConfig>('/casino/games/DICE/config'),
          fetchBalance(),
          casinoGet<{ rounds: CasinoRoundView[] }>('/casino/history?gameType=DICE&limit=10'),
        ]);
        setConfig(loaded);
        setBalance(points);
        setHistory(past?.rounds ?? []);
      } catch {
        setBootstrapError('The game could not be loaded. Please retry.');
      } finally {
        setBootstrapLoading(false);
      }
    })();
  }, [retry]);

  const projection = useMemo(() => estimate(config, mode, target), [config, mode, target]);
  const stakeValue = Number(stake);
  const insufficient = stakeValue > Number(balance);
  const invalidStake = !Number.isInteger(stakeValue) || stakeValue <= 0;

  async function play() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const round = await casinoPost<CasinoRoundView>('/casino/dice/play', {
        stake: stakeValue,
        mode,
        target,
        idempotencyKey: newIdempotencyKey(),
      });
      setResult(round);
      setHistory((previous) => [round, ...previous].slice(0, 10));
      // The wallet is refetched from the backend; it is never adjusted locally.
      setBalance(await fetchBalance());
    } catch (failure) {
      setError(describeError(failure as { code: string; message: string }));
    } finally {
      setBusy(false);
    }
  }

  const state = result?.state as DiceState | undefined;

  return (
    <CasinoGameShell gameId="dice" title="Dice" balance={balance} loading={bootstrapLoading} error={bootstrapError} onRetry={() => setRetry((value) => value + 1)} ready={config !== null}>
      <div className="ops-content casino-game">
        <section className="casino-panel">
          <h2>Place your roll</h2>

          <label className="casino-field">
            <span>Stake (points)</span>
            <input
              inputMode="numeric"
              value={stake}
              onChange={(event) => setStake(event.target.value.replace(/[^\d]/g, ''))}
            />
          </label>

          <div className="casino-field">
            <span>Direction</span>
            <div className="casino-toggle">
              <button
                type="button"
                className={mode === 'ROLL_UNDER' ? 'active' : ''}
                onClick={() => setMode('ROLL_UNDER')}
              >
                Roll under
              </button>
              <button
                type="button"
                className={mode === 'ROLL_OVER' ? 'active' : ''}
                onClick={() => setMode('ROLL_OVER')}
              >
                Roll over
              </button>
            </div>
          </div>

          <label className="casino-field">
            <span>Target · {(target / 100).toFixed(2)}</span>
            <input
              type="range"
              min={config?.minTarget ?? 100}
              max={config?.maxTarget ?? 9_899}
              value={target}
              onChange={(event) => setTarget(Number(event.target.value))}
            />
          </label>

          <dl className="casino-stats">
            <div><dt>Win chance</dt><dd>{projection.chance}%</dd></div>
            <div><dt>Multiplier</dt><dd>{projection.multiplier}x</dd></div>
            <div>
              <dt>Potential return</dt>
              <dd>
                {formatPoints(Math.floor(stakeValue * Number(projection.multiplier) || 0))} pts
              </dd>
            </div>
          </dl>

          {insufficient && <p className="casino-inline-error">Not enough virtual points.</p>}
          {error && <p className="casino-inline-error">{error}</p>}

          <button
            className="ops-action casino-play"
            disabled={busy || invalidStake || insufficient}
            onClick={() => void play()}
          >
            {busy ? 'Rolling…' : 'Roll'}
          </button>

          {config && (
            <p className="casino-meta">
              RTP {config.rtpPercent}% · House edge {config.houseEdgePercent}% ·
              Config {config.version}
            </p>
          )}
        </section>

        <section className="casino-panel">
          <h2>Result</h2>
          {!result && <p className="state">Roll to see a server-generated result.</p>}
          {result && state && (
            <div className={`casino-result ${result.status === 'WON' ? 'won' : 'lost'}`}>
              <span className="casino-roll">{(state.roll / 100).toFixed(2)}</span>
              <strong>{result.status === 'WON' ? 'Win' : 'Loss'}</strong>
              <p>
                {state.mode === 'ROLL_UNDER' ? 'Rolled under' : 'Rolled over'}{' '}
                {(state.target / 100).toFixed(2)} · {result.multiplier}x
              </p>
              <p className="casino-payout">
                {result.status === 'WON' ? '+' : ''}
                {formatPoints(result.payout)} pts returned
              </p>
              <details>
                <summary>Verifiable result</summary>
                <p className="casino-seed">Commitment: {result.fairness.serverSeedHash}</p>
                {result.fairness.serverSeed && (
                  <p className="casino-seed">Server seed: {result.fairness.serverSeed}</p>
                )}
                <p className="casino-seed">Client seed: {result.fairness.clientSeed}</p>
              </details>
            </div>
          )}

          <h3 className="casino-subheading">Recent rolls</h3>
          {history.length === 0 && <p className="state">No rounds yet.</p>}
          <ul className="casino-history">
            {history.map((round) => {
              const previous = round.state as DiceState;
              return (
                <li key={round.roundId}>
                  <span className={round.status === 'WON' ? 'good' : 'bad'}>
                    {(previous.roll / 100).toFixed(2)}
                  </span>
                  <span>{formatPoints(round.stake)} pts</span>
                  <span>{round.multiplier}x</span>
                  <span>{round.status === 'WON' ? `+${formatPoints(round.payout)}` : '—'}</span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </CasinoGameShell>
  );
}
