'use client';

import { useCallback, useEffect, useState } from 'react';
import { CasinoGameShell } from '../../../../components/casino/casino-game-shell';
import { casinoPost, describeError, fetchBalance, formatPoints } from '../../../../lib/casino';

/**
 * Gateway origin for the imported client.
 *
 * The recovered game runs on its own loopback hostname so it never shares an
 * origin, cookie or credential with the platform application. Only the API
 * base URL and this gateway URL are read from the `NEXT_PUBLIC_` namespace.
 */
const GAME_ORIGIN = process.env.NEXT_PUBLIC_LUCKY_LADY_URL ?? 'http://127.0.0.1:8790';

type LaunchCapability = { token: string; expiresAt: string; path: string; gamePath: string };

const LINE_STAKES = [1, 2, 5, 10, 20];
const LINES = 10;

export default function LuckyLadyLauncherPage() {
  const [balance, setBalance] = useState('0');
  const [launch, setLaunch] = useState<LaunchCapability | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [capability, points] = await Promise.all([
        casinoPost<LaunchCapability>('/casino/lucky-lady/launch', {}),
        fetchBalance(),
      ]);
      setLaunch(capability);
      setBalance(points);
      setExpiresAt(new Date(capability.expiresAt).getTime());
    } catch (failure) {
      setError(describeError(failure as { code: string; message: string }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, retry]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const secondsLeft = expiresAt === null ? 0 : Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const usable = launch !== null && secondsLeft > 0;

  return (
    <CasinoGameShell
      gameId="lucky-lady"
      title="Lucky Lady's Charm Deluxe"
      balance={balance}
      loading={loading}
      error={error || undefined}
      onRetry={() => setRetry((value) => value + 1)}
      ready={true}
    >
      <div className="ops-content casino-game">
        <section className="casino-panel">
          <h2>Play</h2>
          {/*
            The one-time capability is submitted as a top-level form POST to the
            game's own origin, so nothing secret is ever placed in a URL and the
            platform session stays on the platform origin.
          */}
          <form action={`${GAME_ORIGIN}/launch`} method="post" target="_blank" rel="noopener">
            <input type="hidden" name="token" value={launch?.token ?? ''} />
            <button className="ops-action casino-play" type="submit" disabled={!usable}>
              {usable ? 'Launch game' : 'Loading\u2026'}
            </button>
          </form>
          {!loading && !usable && !error && (
            <p className="casino-inline-error">That launch link expired.</p>
          )}
          <button className="casino-secondary" type="button" onClick={() => setRetry((value) => value + 1)}>
            Start over
          </button>
        </section>

        <section className="casino-panel">
          <h2>Stake and rules</h2>
          <dl className="casino-stats">
            <div><dt>Lines</dt><dd>{LINES} (always active)</dd></div>
            <div><dt>Per line</dt><dd>{LINE_STAKES.join(' / ')} pts</dd></div>
            <div><dt>Total stake</dt><dd>{LINE_STAKES.map((line) => line * LINES).join(' / ')} pts</dd></div>
            <div><dt>Balance</dt><dd>{formatPoints(balance)} pts</dd></div>
          </dl>
          <p className="casino-meta">
            Ten lines, a red/black gamble and fifteen free games at x3. Winnings stay pending in
            the round until you collect.
          </p>
        </section>
      </div>
    </CasinoGameShell>
  );
}
