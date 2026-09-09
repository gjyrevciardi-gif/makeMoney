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

type RouletteConfig = {
  rtpPercent: string;
  houseEdgePercent: string;
  version: string;
  pockets: number;
  maxBetsPerSpin: number;
  betTypes: { type: string; multiplier: number; winningPockets: number }[];
  colours: { pocket: number; colour: 'GREEN' | 'RED' | 'BLACK' }[];
};

type RouletteState = {
  pocket: number;
  colour: 'GREEN' | 'RED' | 'BLACK';
  bets: {
    type: string;
    number: number | null;
    amount: string;
    won: boolean;
    multiplier: number;
    payout: string;
  }[];
  totalStake: string;
  totalPayout: string;
};

type PendingBet = { type: string; amount: number; number?: number };

const OUTSIDE_BETS: { type: string; label: string }[] = [
  { type: 'RED', label: 'Red' },
  { type: 'BLACK', label: 'Black' },
  { type: 'ODD', label: 'Odd' },
  { type: 'EVEN', label: 'Even' },
  { type: 'LOW', label: '1–18' },
  { type: 'HIGH', label: '19–36' },
  { type: 'DOZEN_1', label: '1st 12' },
  { type: 'DOZEN_2', label: '2nd 12' },
  { type: 'DOZEN_3', label: '3rd 12' },
  { type: 'COLUMN_1', label: 'Col 1' },
  { type: 'COLUMN_2', label: 'Col 2' },
  { type: 'COLUMN_3', label: 'Col 3' },
];

export default function RoulettePage() {
  const [config, setConfig] = useState<RouletteConfig | null>(null);
  const [balance, setBalance] = useState('0');
  const [chip, setChip] = useState('50');
  const [bets, setBets] = useState<PendingBet[]>([]);
  const [result, setResult] = useState<CasinoRoundView | null>(null);
  const [history, setHistory] = useState<CasinoRoundView[]>([]);
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
        const [loaded, points, past] = await Promise.all([
          casinoGetRequired<RouletteConfig>('/casino/games/ROULETTE/config'),
          fetchBalance(),
          casinoGet<{ rounds: CasinoRoundView[] }>('/casino/history?gameType=ROULETTE&limit=12'),
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

  const colourOf = useMemo(() => {
    const map = new Map<number, 'GREEN' | 'RED' | 'BLACK'>();
    for (const entry of config?.colours ?? []) map.set(entry.pocket, entry.colour);
    return map;
  }, [config]);

  const chipValue = Number(chip) || 0;
  const totalStake = bets.reduce((sum, bet) => sum + bet.amount, 0);

  /** Repeated clicks stack onto one bet, matching how the server expects them. */
  function addBet(type: string, pocket?: number) {
    if (chipValue <= 0) return;
    setBets((current) => {
      const index = current.findIndex(
        (bet) => bet.type === type && bet.number === pocket,
      );
      if (index >= 0) {
        const next = [...current];
        next[index] = { ...next[index], amount: next[index].amount + chipValue };
        return next;
      }
      if (current.length >= (config?.maxBetsPerSpin ?? 20)) return current;
      return [...current, { type, amount: chipValue, number: pocket }];
    });
  }

  const removeBet = (index: number) =>
    setBets((current) => current.filter((_, position) => position !== index));

  async function play() {
    if (busy || !bets.length) return;
    setBusy(true);
    setError('');
    try {
      const round = await casinoPost<CasinoRoundView>('/casino/roulette/play', {
        bets: bets.map((bet) => ({
          type: bet.type,
          amount: bet.amount,
          ...(bet.number === undefined ? {} : { number: bet.number }),
        })),
        idempotencyKey: newIdempotencyKey(),
      });
      setResult(round);
      setHistory((previous) => [round, ...previous].slice(0, 12));
      setBets([]);
      setBalance(await fetchBalance());
    } catch (failure) {
      setError(describeError(failure as { code: string; message: string }));
    } finally {
      setBusy(false);
    }
  }

  const state = result?.state as RouletteState | undefined;

  return (
    <CasinoGameShell gameId="roulette" title="Roulette" balance={balance} loading={bootstrapLoading} error={bootstrapError} onRetry={() => setRetry((value) => value + 1)} ready={config !== null}>
      <div className="ops-content casino-game">
        <section className="casino-panel">
          <h2>Your bets</h2>

          <label className="casino-field">
            <span>Chip size (points)</span>
            <input
              inputMode="numeric"
              value={chip}
              onChange={(event) => setChip(event.target.value.replace(/[^\d]/g, ''))}
            />
          </label>

          {bets.length === 0 && (
            <p className="state">Pick a chip size, then choose bets on the table.</p>
          )}
          {bets.length > 0 && (
            <ul className="casino-betlist">
              {bets.map((bet, index) => (
                <li key={`${bet.type}-${bet.number ?? 'x'}`}>
                  <span>
                    {bet.type === 'STRAIGHT' ? `Straight ${bet.number}` : bet.type.replace('_', ' ')}
                  </span>
                  <span>{formatPoints(bet.amount)}</span>
                  <button type="button" onClick={() => removeBet(index)} aria-label="Remove bet">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          <dl className="casino-stats">
            <div><dt>Bets</dt><dd>{bets.length}</dd></div>
            <div><dt>Total stake</dt><dd>{formatPoints(totalStake)}</dd></div>
            <div><dt>Balance</dt><dd>{formatPoints(balance)}</dd></div>
          </dl>

          {totalStake > Number(balance) && (
            <p className="casino-inline-error">Not enough virtual points.</p>
          )}
          {error && <p className="casino-inline-error">{error}</p>}

          <button
            className="ops-action casino-play"
            disabled={busy || !bets.length || totalStake > Number(balance)}
            onClick={() => void play()}
          >
            {busy ? 'Spinning…' : 'Spin'}
          </button>
          <button
            className="casino-secondary"
            type="button"
            disabled={busy || !bets.length}
            onClick={() => setBets([])}
          >
            Clear bets
          </button>

          {config && (
            <p className="casino-meta">
              Single-zero wheel · RTP {config.rtpPercent}% · House edge{' '}
              {config.houseEdgePercent}% · Config {config.version}
            </p>
          )}
        </section>

        <section className="casino-panel">
          <h2>Table</h2>

          {state && (
            <div className={`casino-pocket ${state.colour.toLowerCase()}`}>
              <span>{state.pocket}</span>
              <small>{state.colour}</small>
              <p className="casino-payout">
                {result!.status === 'WON'
                  ? `+${formatPoints(state.totalPayout)} pts`
                  : 'No winning bets'}
              </p>
            </div>
          )}

          <div className="casino-wheel-grid">
            <button
              type="button"
              className="casino-number green"
              onClick={() => addBet('STRAIGHT', 0)}
            >
              0
            </button>
            {Array.from({ length: 36 }, (_, index) => index + 1).map((pocket) => (
              <button
                type="button"
                key={pocket}
                className={`casino-number ${(colourOf.get(pocket) ?? 'RED').toLowerCase()}`}
                onClick={() => addBet('STRAIGHT', pocket)}
              >
                {pocket}
              </button>
            ))}
          </div>

          <div className="casino-outside">
            {OUTSIDE_BETS.map((bet) => (
              <button type="button" key={bet.type} onClick={() => addBet(bet.type)}>
                {bet.label}
              </button>
            ))}
          </div>

          <h3 className="casino-subheading">Recent spins</h3>
          {history.length === 0 && <p className="state">No spins yet.</p>}
          <div className="casino-recent-pockets">
            {history.map((round) => {
              const previous = round.state as RouletteState;
              return (
                <span
                  key={round.roundId}
                  className={`casino-chip ${previous.colour.toLowerCase()}`}
                  title={`${formatPoints(round.stake)} staked · ${formatPoints(round.payout)} returned`}
                >
                  {previous.pocket}
                </span>
              );
            })}
          </div>
        </section>
      </div>
    </CasinoGameShell>
  );
}
