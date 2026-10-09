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

type CrashConfig = {
  rtpPercent: string;
  houseEdgePercent: string;
  version: string;
  tickMs: number;
  growthNumerator: number;
  growthDenominator: number;
  minMultiplier: string;
  maxMultiplier: string;
  minAutoCashoutCenti: number;
  maxAutoCashoutCenti: number;
  maxRoundMs: number;
};

type CrashRound = CasinoRoundView & {
  timing: {
    startedAt: string;
    serverNow: string;
    elapsedMs: number | null;
    tickMs: number;
    growthNumerator: number;
    growthDenominator: number;
    maxMultiplier: string;
    currentMultiplier: string;
  };
  crash: {
    autoCashout: string | null;
    outcome: 'CASHED_OUT' | 'LOST' | null;
    automatic: boolean | null;
    cashoutMultiplier: string | null;
    crashPoint: string | null;
  };
};

/**
 * The same curve the server uses, mirrored locally for animation only.
 *
 * The browser draws frames from `startedAt` plus its own clock offset against
 * `serverNow`; it never decides an outcome. Every settlement is a single
 * explicit request, so nothing here polls.
 */
function curveMultiplier(elapsedMs: number, config: CrashConfig | null) {
  if (!config || elapsedMs <= 0) return 1;
  const ticks = Math.floor(elapsedMs / config.tickMs);
  const growth = config.growthNumerator / config.growthDenominator;
  const value = Math.pow(growth, ticks);
  return Math.min(value, Number(config.maxMultiplier));
}

export default function CrashPage() {
  const [config, setConfig] = useState<CrashConfig | null>(null);
  const [balance, setBalance] = useState('0');
  const [stake, setStake] = useState('100');
  const [autoCashout, setAutoCashout] = useState('');
  const [round, setRound] = useState<CrashRound | null>(null);
  const [displayed, setDisplayed] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<CrashRound[]>([]);
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState('');
  const [retry, setRetry] = useState(0);
  /** serverNow - clientNow at the last response, so drift never accumulates. */
  const clockOffset = useRef(0);
  const frame = useRef<number | undefined>(undefined);

  const loadHistory = useCallback(async () => {
    const past = await casinoGet<{ rounds: CrashRound[] }>(
      '/casino/history?gameType=CRASH&limit=12',
    );
    setHistory(past?.rounds ?? []);
  }, []);

  const adopt = useCallback((next: CrashRound | null) => {
    if (next) {
      clockOffset.current = Date.parse(next.timing.serverNow) - Date.now();
    }
    setRound(next);
  }, []);

  useEffect(() => {
    setBootstrapLoading(true);
    setBootstrapError('');
    void (async () => {
      try {
        const [loaded, points, active] = await Promise.all([
          casinoGetRequired<CrashConfig>('/casino/games/CRASH/config'),
          fetchBalance(),
          casinoGet<CrashRound | null>('/casino/crash/active'),
        ]);
        setConfig(loaded);
        setBalance(points);
        if (active && Object.keys(active).length) adopt(active as CrashRound);
        await loadHistory();
      } catch {
        setBootstrapError('The game could not be loaded. Please retry.');
      } finally {
        setBootstrapLoading(false);
      }
    })();
  }, [adopt, loadHistory, retry]);

  // Animation reads the shared curve from server timestamps. No request is made
  // per frame; the backend is contacted only to start or to cash out.
  useEffect(() => {
    if (!round || round.status !== 'OPEN') {
      if (frame.current) cancelAnimationFrame(frame.current);
      return;
    }
    const startedAtMs = Date.parse(round.timing.startedAt);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setDisplayed(Number(round.timing.currentMultiplier));
      return;
    }
    const tick = () => {
      const serverNow = Date.now() + clockOffset.current;
      setDisplayed(curveMultiplier(serverNow - startedAtMs, config));
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [round, config]);

  const stakeValue = Number(stake);
  const open = round?.status === 'OPEN';
  const autoCashoutCenti = autoCashout ? Math.round(Number(autoCashout) * 100) : undefined;

  async function run(action: () => Promise<CrashRound>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      adopt(await action());
      setBalance(await fetchBalance());
      await loadHistory();
    } catch (failure) {
      setError(describeError(failure as { code: string; message: string }));
    } finally {
      setBusy(false);
    }
  }

  const startRound = () => run(async () => {
    setDisplayed(1);
    return casinoPost<CrashRound>('/casino/crash/start', {
      stake: stakeValue,
      ...(autoCashoutCenti ? { autoCashoutCenti } : {}),
      idempotencyKey: newIdempotencyKey(),
    });
  });

  const cashout = () => run(() =>
    casinoPost<CrashRound>(`/casino/crash/${round!.roundId}/cashout`, {
      idempotencyKey: newIdempotencyKey(),
    }));

  const shown = open ? displayed.toFixed(2) : round?.timing.currentMultiplier ?? '1.00';
  const lost = round?.crash.outcome === 'LOST';

  return (
    <CasinoGameShell gameId="crash" title="Crash" balance={balance} loading={bootstrapLoading} error={bootstrapError} onRetry={() => setRetry((value) => value + 1)} ready={config !== null}>
      <div className="ops-content casino-game">
        <section className="casino-panel">
          <h2>{open ? 'Round in play' : 'New round'}</h2>

          <label className="casino-field">
            <span>Stake (points)</span>
            <input
              inputMode="numeric"
              value={stake}
              disabled={open}
              onChange={(event) => setStake(event.target.value.replace(/[^\d]/g, ''))}
            />
          </label>

          <label className="casino-field">
            <span>Auto cash out (optional, e.g. 2.00)</span>
            <input
              inputMode="decimal"
              value={autoCashout}
              disabled={open}
              placeholder="none"
              onChange={(event) => setAutoCashout(event.target.value.replace(/[^\d.]/g, ''))}
            />
          </label>

          {round && (
            <dl className="casino-stats">
              <div><dt>Stake</dt><dd>{formatPoints(round.stake)}</dd></div>
              <div>
                <dt>Auto</dt>
                <dd>{round.crash.autoCashout ? `${round.crash.autoCashout}x` : '—'}</dd>
              </div>
              <div>
                <dt>{open ? 'Cash out now' : 'Returned'}</dt>
                <dd>
                  {open
                    ? formatPoints(Math.floor(Number(round.stake) * displayed))
                    : formatPoints(round.payout)}
                </dd>
              </div>
            </dl>
          )}

          {error && <p className="casino-inline-error">{error}</p>}

          {!open && (
            <button
              className="ops-action casino-play"
              disabled={busy || stakeValue <= 0 || stakeValue > Number(balance)}
              onClick={() => void startRound()}
            >
              {busy ? 'Starting…' : 'Start round'}
            </button>
          )}

          {open && (
            <button
              className="ops-action casino-play"
              disabled={busy}
              onClick={() => void cashout()}
            >
              Cash out {displayed.toFixed(2)}x
            </button>
          )}

          {config && (
            <p className="casino-meta">
              RTP {config.rtpPercent}% · House edge {config.houseEdgePercent}% ·
              Max {config.maxMultiplier}x · Config {config.version}
              <br />
              Progression is decided by the server clock; this page only mirrors it.
            </p>
          )}
        </section>

        <section className="casino-panel">
          <h2>Curve</h2>

          <div className={`casino-crash-display ${open ? 'live' : lost ? 'lost' : 'won'}`}>
            <span className="casino-crash-multiplier">{shown}x</span>
            {!round && <p>Start a round to begin.</p>}
            {open && <p>Cash out before it crashes.</p>}
            {round && !open && (
              <p>
                {lost
                  ? `Crashed at ${round.crash.crashPoint}x`
                  : `Cashed out at ${round.crash.cashoutMultiplier}x${
                    round.crash.automatic ? ' (auto)' : ''
                  } · crashed at ${round.crash.crashPoint}x`}
              </p>
            )}
          </div>

          {round && (
            <details>
              <summary>Verifiable result</summary>
              <p className="casino-seed">Commitment: {round.fairness.serverSeedHash}</p>
              {round.fairness.serverSeed
                ? <p className="casino-seed">Server seed: {round.fairness.serverSeed}</p>
                : <p className="casino-meta">The seed and crash point are revealed when
                  the round ends.</p>}
            </details>
          )}

          <h3 className="casino-subheading">Recent rounds</h3>
          {history.length === 0 && <p className="state">No rounds yet.</p>}
          <div className="casino-recent-pockets">
            {history.map((past) => (
              <span
                key={past.roundId}
                className={`casino-chip ${past.status === 'CASHED_OUT' ? 'green' : 'red'}`}
                title={`${formatPoints(past.stake)} staked · ${formatPoints(past.payout)} returned`}
              >
                {past.crash?.crashPoint ?? '—'}
              </span>
            ))}
          </div>
        </section>
      </div>
    </CasinoGameShell>
  );
}
