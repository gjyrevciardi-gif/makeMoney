'use client';

import { useEffect, useState } from 'react';
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

type BlackjackHand = {
  playerCards: string[];
  dealerCards: string[];
  dealerHoleHidden: boolean;
  playerTotal: number;
  playerSoft: boolean;
  dealerTotal: number;
  doubled: boolean;
  outcome: string | null;
  canHit: boolean;
  canStand: boolean;
  canDouble: boolean;
};

type BlackjackRound = CasinoRoundView & { hand: BlackjackHand };

type BlackjackConfig = {
  version: string;
  decks: number;
  dealerStandsOnSoft17: boolean;
  blackjackPayout: string;
  minStake: string;
  maxStake: string;
  note: string;
};

const OUTCOME_TEXT: Record<string, string> = {
  PLAYER_BLACKJACK: 'Blackjack!',
  PLAYER_WIN: 'You win',
  DEALER_BUST: 'Dealer busts — you win',
  PLAYER_BUST: 'Bust',
  DEALER_WIN: 'Dealer wins',
  PUSH: 'Push — stake returned',
};

export default function BlackjackPage() {
  const [config, setConfig] = useState<BlackjackConfig | null>(null);
  const [balance, setBalance] = useState('0');
  const [stake, setStake] = useState('100');
  const [round, setRound] = useState<BlackjackRound | null>(null);
  const [busy, setBusy] = useState(false);
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
          casinoGetRequired<BlackjackConfig>('/casino/games/BLACKJACK/config'),
          fetchBalance(),
          casinoGet<BlackjackRound | null>('/casino/blackjack/active'),
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

  async function run(action: () => Promise<BlackjackRound>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      setRound(await action());
      setBalance(await fetchBalance());
    } catch (failure) {
      setError(describeError(failure as { code: string; message: string }));
    } finally {
      setBusy(false);
    }
  }

  const stakeValue = Number(stake);
  const open = round?.status === 'OPEN';
  const finished = round !== null && !open;

  const deal = () => run(() => casinoPost<BlackjackRound>('/casino/blackjack/start', {
    stake: stakeValue,
    idempotencyKey: newIdempotencyKey(),
  }));

  const act = (verb: 'hit' | 'stand' | 'double') => run(() =>
    casinoPost<BlackjackRound>(`/casino/blackjack/${round!.roundId}/${verb}`, {
      idempotencyKey: newIdempotencyKey(),
    }));

  return (
    <CasinoGameShell gameId="blackjack" title="Blackjack" balance={balance} loading={bootstrapLoading} error={bootstrapError} onRetry={() => setRetry((value) => value + 1)} ready={config !== null}>
      <div className="ops-content casino-game">
        <section className="casino-panel">
          <h2>{open ? 'Hand in play' : 'New hand'}</h2>

          <label className="casino-field">
            <span>Stake (points)</span>
            <input
              inputMode="numeric"
              value={stake}
              disabled={open}
              onChange={(event) => setStake(event.target.value.replace(/[^\d]/g, ''))}
            />
          </label>

          {round && (
            <dl className="casino-stats">
              <div><dt>Your total</dt><dd>{round.hand.playerTotal}{round.hand.playerSoft ? ' (soft)' : ''}</dd></div>
              <div><dt>Dealer</dt><dd>{round.hand.dealerHoleHidden ? `${round.hand.dealerTotal}+` : round.hand.dealerTotal}</dd></div>
              <div><dt>Committed</dt><dd>{formatPoints(round.stake)}</dd></div>
            </dl>
          )}

          {error && <p className="casino-inline-error">{error}</p>}

          {!open && (
            <button
              className="ops-action casino-play"
              disabled={busy || stakeValue <= 0 || stakeValue > Number(balance)}
              onClick={() => void deal()}
            >
              {busy ? 'Dealing…' : 'Deal'}
            </button>
          )}

          {open && (
            <div className="casino-actions">
              <button
                className="ops-action"
                disabled={busy || !round!.hand.canHit}
                onClick={() => void act('hit')}
              >
                Hit
              </button>
              <button
                className="ops-action"
                disabled={busy || !round!.hand.canStand}
                onClick={() => void act('stand')}
              >
                Stand
              </button>
              <button
                className="ops-action"
                disabled={busy || !round!.hand.canDouble || Number(round!.stake) > Number(balance)}
                onClick={() => void act('double')}
                title={round!.hand.canDouble ? 'Double your stake, take one card, and stand' : 'Only on your first two cards'}
              >
                Double
              </button>
            </div>
          )}

          {config && (
            <p className="casino-meta">
              {config.decks} decks · Dealer stands on all 17s · Blackjack pays{' '}
              {config.blackjackPayout} · Config {config.version}
              <br />
              {config.note}
            </p>
          )}
        </section>

        <section className="casino-panel">
          <h2>Table</h2>

          {!round && <p className="state">Deal a hand to begin. Cards are dealt from a shoe
            shuffled on the server before the first card is shown.</p>}

          {round && (
            <>
              {finished && round.hand.outcome && (
                <p className={`casino-banner ${round.payout === '0' ? 'bad' : 'good'}`}>
                  {OUTCOME_TEXT[round.hand.outcome] ?? round.hand.outcome}
                  {round.payout !== '0' && ` · ${formatPoints(round.payout)} pts returned`}
                </p>
              )}

              <div className="casino-hand">
                <span className="casino-hand-label">
                  Dealer {round.hand.dealerHoleHidden ? `showing ${round.hand.dealerTotal}` : round.hand.dealerTotal}
                </span>
                <div className="casino-cards">
                  {round.hand.dealerCards.map((card, index) => (
                    <span className="casino-card-face" key={`d-${index}-${card}`}>{card}</span>
                  ))}
                  {round.hand.dealerHoleHidden && (
                    <span className="casino-card-face hidden" aria-label="Face-down card">?</span>
                  )}
                </div>
              </div>

              <div className="casino-hand">
                <span className="casino-hand-label">
                  You {round.hand.playerTotal}{round.hand.playerSoft ? ' (soft)' : ''}
                  {round.hand.doubled ? ' · doubled' : ''}
                </span>
                <div className="casino-cards">
                  {round.hand.playerCards.map((card, index) => (
                    <span className="casino-card-face" key={`p-${index}-${card}`}>{card}</span>
                  ))}
                </div>
              </div>

              <details>
                <summary>Verifiable result</summary>
                <p className="casino-seed">Commitment: {round.fairness.serverSeedHash}</p>
                {round.fairness.serverSeed
                  ? <p className="casino-seed">Server seed: {round.fairness.serverSeed}</p>
                  : <p className="casino-meta">The shoe and seed are revealed when the hand ends.</p>}
              </details>
            </>
          )}
        </section>
      </div>
    </CasinoGameShell>
  );
}
