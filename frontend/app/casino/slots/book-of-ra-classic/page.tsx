'use client';

import { useCallback, useEffect, useState } from 'react';
import { CasinoGameShell } from '../../../../components/casino/casino-game-shell';
import { casinoPost, describeError, fetchBalance, formatPoints } from '../../../../lib/casino';

/**
 * Gateway origin for the imported Classic client.
 *
 * The recovered game runs on its own loopback hostname so it never shares an
 * origin, cookie or credential with the platform application. Only the API base
 * URL and this gateway URL are read from the `NEXT_PUBLIC_` namespace.
 */
const GAME_ORIGIN = process.env.NEXT_PUBLIC_BOOK_CLASSIC_URL ?? 'http://127.0.0.1:8791';

type LaunchCapability = { token: string; expiresAt: string; path: string; gamePath: string };

const LINE_STAKES = [1, 2, 5, 10, 20];
const MIN_LINES = 1;
const MAX_LINES = 9;

export default function BookOfRaClassicLauncherPage() {
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
        casinoPost<LaunchCapability>('/casino/book-of-ra-classic/launch', {}),
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
      gameId="book-of-ra-classic"
      title="Book of Ra Classic"
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
            <div><dt>Lines</dt><dd>{MIN_LINES} to {MAX_LINES} (you choose)</dd></div>
            <div><dt>Per line</dt><dd>{LINE_STAKES.join(' / ')} pts</dd></div>
            <div>
              <dt>Total stake</dt>
              <dd>{LINE_STAKES[0] * MIN_LINES} to {LINE_STAKES[LINE_STAKES.length - 1] * MAX_LINES} pts</dd>
            </div>
            <div><dt>Balance</dt><dd>{formatPoints(balance)} pts</dd></div>
          </dl>
          <p className="casino-meta">
            Nine paylines. The Book is wild and pays 18 / 180 / 1800 times the total stake for three,
            four or five. Three or more Books start ten free games with one persistent expanding
            symbol, and more Books during the feature add ten more. A red or black gamble can double
            the pending win up to five times. Winnings stay pending in the round until you collect.
          </p>
        </section>
      </div>
    </CasinoGameShell>
  );
}
