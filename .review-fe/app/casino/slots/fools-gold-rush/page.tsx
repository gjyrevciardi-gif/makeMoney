'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CasinoGameShell } from '../../../../components/casino/casino-game-shell';
import {
  CasinoRoundView,
  casinoGet,
  casinoGetRequired,
  casinoPost,
  describeError,
  fetchBalance,
  formatPoints,
  newIdempotencyKey,
} from '../../../../lib/casino';

type SlotSymbol = { id: string; name: string; type: 'NORMAL' | 'WILD' | 'SCATTER' };

type SlotConfig = {
  gameId: string;
  name: string;
  description: string;
  version: string;
  reels: number;
  rows: number;
  paylineCount: number;
  paylines: { id: number; rows: number[] }[];
  symbols: SlotSymbol[];
  paytable: Record<string, Record<string, number>>;
  scatter: { symbolId: string; minimumCount: number; tiers: Record<string, number> } | null;
  volatility: string;
  rtpBps: number;
  rtpPercent: string;
  houseEdgeBps: number;
  maxWinMultiplier: string;
  minStake: string;
  maxStake: string;
  rules: {
    paylineDirection: string;
    activePaylines: string;
    wild: string;
    scatter: string | null;
    payoutSemantics: string;
  };
};

type LineWin = {
  lineId: number;
  symbolId: string;
  count: number;
  multiplierCenti: number;
  positions: [number, number][];
};

type SlotState = {
  gameId: string;
  stops: number[];
  matrix: string[][];
  lineWins: LineWin[];
  scatterWin: { symbolId: string; count: number; multiplierCenti: number; positions: [number, number][] } | null;
  returnNumerator: number;
  totalMultiplier: string;
  capped: boolean;
  config: { version: string; rtpBps: number; paylineCount: number };
};

/** Short glyphs for the original mining symbol set. */
const GLYPHS: Record<string, string> = {
  GOLD: '★', NUGGET: '◆', CART: '▣', PICKAXE: '⛏', LANTERN: '✦',
  HORSESHOE: '∩', WILD: 'W', SCATTER: '✹',
};

const REEL_STOP_MS = 260;

export default function FoolsGoldRushPage() {
  const [config, setConfig] = useState<SlotConfig | null>(null);
  const [balance, setBalance] = useState('0');
  const [stake, setStake] = useState('100');
  const [result, setResult] = useState<CasinoRoundView | null>(null);
  const [history, setHistory] = useState<CasinoRoundView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState('');
  const [retry, setRetry] = useState(0);
  /** Reels that have already landed on the authoritative symbols. */
  const [landed, setLanded] = useState(0);
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [showPaytable, setShowPaytable] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const cycler = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const [spinTick, setSpinTick] = useState(0);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (cycler.current) clearInterval(cycler.current);
    cycler.current = undefined;
  };

  const loadHistory = useCallback(async () => {
    const past = await casinoGet<{ rounds: CasinoRoundView[] }>(
      '/casino/history?gameType=SLOTS&limit=10',
    );
    setHistory(past?.rounds ?? []);
  }, []);

  useEffect(() => {
    setBootstrapLoading(true);
    setBootstrapError('');
    void (async () => {
      try {
        const [loaded, points] = await Promise.all([
          casinoGetRequired<SlotConfig>('/casino/slots/fools-gold-rush/config'),
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
    return clearTimers;
  }, [loadHistory, retry]);

  const state = result?.state as unknown as SlotState | undefined;
  const stakeValue = Number(stake);
  const reels = config?.reels ?? 5;
  const rows = config?.rows ?? 3;

  /**
   * Reels stop left to right onto the exact matrix the backend returned.
   *
   * While a reel is still spinning it shows visual filler only; that filler is
   * never treated as a result. The authoritative matrix is already settled
   * server-side before this runs, so an interrupted animation cannot lose or
   * change the outcome.
   */
  const animate = useCallback(() => {
    clearTimers();
    setLanded(0);
    setActiveLine(null);
    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setLanded(reels);
      return;
    }
    cycler.current = setInterval(() => setSpinTick((tick) => tick + 1), 70);
    for (let reel = 1; reel <= reels; reel += 1) {
      timers.current.push(setTimeout(() => {
        setLanded(reel);
        if (reel === reels) {
          if (cycler.current) clearInterval(cycler.current);
          cycler.current = undefined;
        }
      }, reel * REEL_STOP_MS));
    }
  }, [reels]);

  // Cycle the highlighted payline once every reel has landed.
  useEffect(() => {
    if (!state || landed < reels || state.lineWins.length === 0) return;
    let index = 0;
    setActiveLine(state.lineWins[0].lineId);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const rotate = setInterval(() => {
      index = (index + 1) % state.lineWins.length;
      setActiveLine(state.lineWins[index].lineId);
    }, 1_400);
    return () => clearInterval(rotate);
  }, [state, landed, reels]);

  async function play() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const round = await casinoPost<CasinoRoundView>(
        '/casino/slots/fools-gold-rush/spin',
        { stake: stakeValue, idempotencyKey: newIdempotencyKey() },
      );
      setResult(round);
      animate();
      setBalance(await fetchBalance());
      await loadHistory();
    } catch (failure) {
      setError(describeError(failure as { code: string; message: string }));
    } finally {
      setBusy(false);
    }
  }

  const finished = state !== undefined && landed >= reels;
  const highlighted = new Set<string>();
  if (finished && state) {
    for (const win of state.lineWins) {
      if (activeLine === null || win.lineId === activeLine) {
        for (const [row, reel] of win.positions) highlighted.add(`${row}:${reel}`);
      }
    }
    if (activeLine === null && state.scatterWin) {
      for (const [row, reel] of state.scatterWin.positions) highlighted.add(`${row}:${reel}`);
    }
  }

  const symbolName = (id: string) =>
    config?.symbols.find((symbol) => symbol.id === id)?.name ?? id;

  // Filler shown only while a reel is still moving.
  const fillerSymbols = config?.symbols.map((symbol) => symbol.id) ?? ['GOLD'];
  const cell = (row: number, reel: number) => {
    if (state && landed > reel) return state.matrix[row][reel];
    return fillerSymbols[(spinTick + row * 3 + reel * 5) % fillerSymbols.length];
  };

  return (
    <CasinoGameShell gameId="fools-gold-rush" title="Fool's Gold Rush" balance={balance} loading={bootstrapLoading} error={bootstrapError} onRetry={() => setRetry((value) => value + 1)} ready={config !== null}>
      <div className="ops-content casino-game">
        <section className="casino-panel">
          <h2>Spin</h2>

          <label className="casino-field">
            <span>Total stake (points)</span>
            <input
              inputMode="numeric"
              value={stake}
              onChange={(event) => setStake(event.target.value.replace(/[^\d]/g, ''))}
            />
          </label>

          <dl className="casino-stats">
            <div><dt>Lines</dt><dd>{config?.paylineCount ?? 20}</dd></div>
            <div>
              <dt>Per line</dt>
              <dd>{config ? (stakeValue / config.paylineCount).toFixed(2) : '—'}</dd>
            </div>
            <div><dt>RTP</dt><dd>{config ? `${config.rtpPercent}%` : '—'}</dd></div>
          </dl>

          {config && stakeValue < Number(config.minStake) && (
            <p className="casino-inline-error">
              Minimum stake is {config.minStake} points, one per payline.
            </p>
          )}
          {stakeValue > Number(balance) && (
            <p className="casino-inline-error">Not enough virtual points.</p>
          )}
          {error && <p className="casino-inline-error">{error}</p>}

          <button
            className="ops-action casino-play"
            disabled={
              busy
              || !config
              || stakeValue < Number(config?.minStake ?? 20)
              || stakeValue > Number(balance)
            }
            onClick={() => void play()}
          >
            {busy ? 'Spinning…' : 'Spin'}
          </button>

          <button
            className="casino-secondary"
            type="button"
            onClick={() => setShowPaytable((open) => !open)}
          >
            {showPaytable ? 'Hide paytable' : 'Paytable & rules'}
          </button>

          {config && (
            <p className="casino-meta">
              {config.version} · House edge {(config.houseEdgeBps / 100).toFixed(2)}% ·
              Volatility {config.volatility.toLowerCase()} · Max win {config.maxWinMultiplier}x
            </p>
          )}

          {showPaytable && config && (
            <div className="casino-paytable">
              <h3 className="casino-subheading">Paytable (per line bet)</h3>
              <table className="casino-paytable-grid">
                <thead>
                  <tr><th>Symbol</th><th>3</th><th>4</th><th>5</th></tr>
                </thead>
                <tbody>
                  {Object.entries(config.paytable).map(([symbolId, tiers]) => (
                    <tr key={symbolId}>
                      <td>
                        <span className={`casino-symbol mini ${symbolId.toLowerCase()}`}>
                          {GLYPHS[symbolId] ?? symbolId[0]}
                        </span>
                        {symbolName(symbolId)}
                      </td>
                      <td>{(tiers['3'] / 100).toFixed(0)}x</td>
                      <td>{(tiers['4'] / 100).toFixed(0)}x</td>
                      <td>{(tiers['5'] / 100).toFixed(0)}x</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {config.scatter && (
                <p className="casino-meta">
                  Scatter (on total stake):{' '}
                  {Object.entries(config.scatter.tiers)
                    .map(([count, value]) => `${count}+ = ${(value / 100).toFixed(0)}x`)
                    .join(' · ')}
                </p>
              )}
              <p className="casino-meta">{config.rules.wild}</p>
              <p className="casino-meta">
                Lines pay left to right from reel 1. All {config.paylineCount} lines are
                always active. {config.rules.payoutSemantics}
              </p>
            </div>
          )}
        </section>

        <section className="casino-panel">
          <h2>Reels</h2>

          {finished && state && result && (
            <p className={`casino-banner ${Number(result.payout) > 0 ? 'good' : 'bad'}`}>
              {Number(result.payout) > 0
                ? `${state.totalMultiplier}x · ${formatPoints(result.payout)} pts`
                : 'No win this spin'}
            </p>
          )}

          <div className="casino-reels" style={{ '--reels': reels } as React.CSSProperties}>
            {Array.from({ length: rows }, (_, row) =>
              Array.from({ length: reels }, (_, reel) => {
                const symbolId = cell(row, reel);
                const spinning = !state || landed <= reel;
                return (
                  <span
                    key={`${row}-${reel}`}
                    className={[
                      'casino-symbol',
                      symbolId.toLowerCase(),
                      spinning ? 'spinning' : '',
                      highlighted.has(`${row}:${reel}`) ? 'won' : '',
                    ].filter(Boolean).join(' ')}
                    title={spinning ? undefined : symbolName(symbolId)}
                  >
                    {GLYPHS[symbolId] ?? symbolId[0]}
                  </span>
                );
              }))}
          </div>

          {finished && state && state.lineWins.length > 0 && (
            <>
              <h3 className="casino-subheading">Winning lines</h3>
              <ul className="casino-linewins">
                {state.lineWins.map((win) => (
                  <li
                    key={win.lineId}
                    className={activeLine === win.lineId ? 'active' : ''}
                    onMouseEnter={() => setActiveLine(win.lineId)}
                  >
                    <span>Line {win.lineId}</span>
                    <span>{symbolName(win.symbolId)} ×{win.count}</span>
                    <span>
                      +{formatPoints(
                        Math.floor(Number(result?.stake ?? 0) * win.multiplierCenti
                          / ((config?.paylineCount ?? 20) * 100)),
                      )} pts
                    </span>
                  </li>
                ))}
                {state.scatterWin && (
                  <li>
                    <span>Scatter</span>
                    <span>×{state.scatterWin.count}</span>
                    <span>
                      +{formatPoints(
                        Math.floor(Number(result?.stake ?? 0)
                          * state.scatterWin.multiplierCenti / 100),
                      )} pts
                    </span>
                  </li>
                )}
              </ul>
            </>
          )}

          {!result && (
            <p className="state">Spin to begin. Every reel stop is generated on the
              server before these reels move.</p>
          )}

          {result && finished && (
            <details>
              <summary>Verifiable result</summary>
              <p className="casino-seed">Reel stops: {state?.stops.join(', ')}</p>
              <p className="casino-seed">Commitment: {result.fairness.serverSeedHash}</p>
              {result.fairness.serverSeed && (
                <p className="casino-seed">Server seed: {result.fairness.serverSeed}</p>
              )}
            </details>
          )}

          <h3 className="casino-subheading">Recent spins</h3>
          {history.length === 0 && <p className="state">No spins yet.</p>}
          <ul className="casino-history">
            {history.map((past) => {
              const previous = past.state as unknown as SlotState;
              return (
                <li key={past.roundId}>
                  <span className={Number(past.payout) > 0 ? 'good' : 'bad'}>
                    {previous.totalMultiplier}x
                  </span>
                  <span>{formatPoints(past.stake)} pts</span>
                  <span>{previous.lineWins.length} lines</span>
                  <span>{Number(past.payout) > 0 ? formatPoints(past.payout) : '—'}</span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </CasinoGameShell>
  );
}
