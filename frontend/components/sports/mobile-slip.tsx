'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { combinedOdds, formatDateTime, formatOdds, formatPoints } from '../../lib/format';
import { pickId, useBetSlip, type PlacedBet, type ReconciledPick } from '../../lib/bet-slip';
import { describeSportsError } from '../../lib/sports';
import { useSession, useWallet } from '../../lib/queries';
import { IconBolt, IconClose } from '../shell/icons';

/** Chips add to the stake, in whole points. */
const CHIPS = [5, 10, 25, 50];

export const foldName = (count: number) => (count === 2 ? 'Double' : count === 3 ? 'Treble' : `${count}-fold`);

const STATUS_COPY: Record<'UNAVAILABLE' | 'STARTED', string> = {
  UNAVAILABLE: 'Unavailable — remove to continue',
  STARTED: 'Event has started — remove to continue',
};

/* ----------------------------------------------------------------- pick card */

function PickCard({ pick, single, stake }: { pick: ReconciledPick; single: boolean; stake: number }) {
  const slip = useBetSlip();
  const moved = pick.status === 'CHANGED';
  const now = pick.currentOdds ?? pick.displayedOdds;
  const wentUp = moved && Number(now) > Number(pick.displayedOdds);
  const blocked = pick.status === 'UNAVAILABLE' || pick.status === 'STARTED';

  return (
    <div className={`m-pick${moved ? ' moved' : ''}${blocked ? ' blocked' : ''}`}>
      <div className="m-pick-top">
        {pick.boosted && <IconBolt className="m-pick-bolt" />}
        <strong>{pick.selectionName}{pick.point ? ` ${pick.point}` : ''}</strong>
        <span className="m-pick-price">
          {pick.boosted && <s>{formatOdds(pick.boosted.was)}</s>}
          <b>{formatOdds(moved ? now : pick.displayedOdds)}</b>
        </span>
      </div>
      <span className="m-pick-event">{pick.marketName} · {pick.homeTeam} v {pick.awayTeam} · {formatDateTime(pick.startTime)}</span>
      {moved && (
        <span className={`m-pick-moved${wentUp ? '' : ' down'}`}>
          {wentUp ? '▲ Price went up from ' : '▼ Price went down from '}{formatOdds(pick.displayedOdds)}
        </span>
      )}
      {blocked && <span className="m-pick-moved down">{STATUS_COPY[pick.status as 'UNAVAILABLE' | 'STARTED']}</span>}
      {single && stake > 0 && (
        <span className="m-pick-return">
          <span>Stake {formatPoints(stake)} PTS</span>
          <span>Returns <b>{formatPoints(Math.floor(stake * Number(moved ? now : pick.displayedOdds)))} PTS</b></span>
        </span>
      )}
      <button type="button" className="m-pick-remove" aria-label={`Remove ${pick.selectionName}`} onClick={() => slip.remove(pickId(pick))}>
        <IconClose />
      </button>
    </div>
  );
}

/* ----------------------------------------------------------------- the slip */

/**
 * The phone bet slip.
 *
 * The slip's own arithmetic (total odds, return) is an estimate and says so;
 * the server re-prices every leg on placement and a moved price comes back as
 * ODDS_CHANGED, which still needs an explicit "Confirm at new prices".
 * "Accept any price changes" is a UI-only preference: the slip has no such
 * mode, so it never changes how a moved price is confirmed.
 */
export function MobileSlip({ onClose }: { onClose: () => void }) {
  const slip = useBetSlip();
  const session = useSession();
  const wallet = useWallet();
  const [acceptAny, setAcceptAny] = useState(false);

  const count = slip.picks.length;
  const multiple = count > 1;
  const balance = Number(wallet.data?.balance ?? 0);
  const stake = Number(slip.stake || 0);
  const total = useMemo(() => combinedOdds(slip.picks.map((pick) => pick.displayedOdds)), [slip.picks]);
  const estimatedReturn = Math.floor(stake * total);

  const invalidStake = !Number.isInteger(stake) || stake <= 0;
  const insufficient = stake > balance;
  const awaitingConfirmation = Boolean(slip.pendingChanges?.length);
  const canPlace = Boolean(session.data) && count > 0 && !invalidStake && !insufficient && !slip.blocked && !slip.placing;

  if (slip.lastPlaced && count === 0) return <BetPlaced bet={slip.lastPlaced} onClose={onClose} />;

  return (
    <div className="m-slip">
      <span className="m-slip-grab" aria-hidden="true" />
      <div className="m-slip-head">
        <h2>Bet Slip</h2>
        {count > 0 && <span className="m-slip-count">{count}</span>}
        {count > 0 && <button type="button" className="m-slip-clear" onClick={slip.clear}>Clear all</button>}
        <button type="button" className="m-slip-close" aria-label="Close bet slip" onClick={onClose}><IconClose /></button>
      </div>

      {count > 0 && (
        <div role="tablist" aria-label="Bet type" className="m-slip-type">
          <button
            type="button"
            role="tab"
            aria-selected={!multiple}
            disabled={multiple}
            title={multiple ? 'Several selections are placed together as one multiple' : undefined}
            onClick={() => undefined}
          >
            Singles
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={multiple}
            disabled={!multiple}
            title={!multiple ? 'Add a second selection to build a multiple' : undefined}
            onClick={() => undefined}
          >
            {multiple ? `Multiple · ${foldName(count)}` : 'Multiple'}
          </button>
        </div>
      )}

      <div className="m-slip-list m-scroll">
        {slip.picks.map((pick) => <PickCard key={pickId(pick)} pick={pick} single={!multiple} stake={stake} />)}

        {count === 0 && (
          <div className="m-slip-empty">
            <strong>Your slip is empty</strong>
            <span>Tap any price to add a selection.</span>
            <Link href="/" onClick={onClose}>Browse sports</Link>
          </div>
        )}

        {awaitingConfirmation && (
          <div className="m-slip-alert warn" role="alert">
            <strong>Odds changed</strong>
            <ul>
              {slip.pendingChanges?.map((change) => (
                <li key={`${change.eventId}:${change.selectionKey}`}>{formatOdds(change.oldOdds)} → {formatOdds(change.newOdds)}</li>
              ))}
            </ul>
            <button type="button" className="m-slip-accept-btn" onClick={slip.acknowledgeChanges}>Accept new prices</button>
          </div>
        )}

        {slip.errorCode && !awaitingConfirmation && (
          <p className="m-slip-alert bad" role="alert">{describeSportsError(slip.errorCode, slip.errorMessage)}</p>
        )}

        {count > 0 && (
          <button type="button" role="switch" aria-checked={acceptAny} className="m-switch-row" onClick={() => setAcceptAny((value) => !value)}>
            <span>
              <b>Accept any price changes</b>
              <small>When off, you confirm a moved price first.</small>
            </span>
            <span className={`m-switch${acceptAny ? ' on' : ''}`} aria-hidden="true"><i /></span>
          </button>
        )}
      </div>

      {count > 0 && (
        <div className="m-slip-foot">
          <div className="m-stake-row">
            <label htmlFor="m-slip-stake">Stake</label>
            <span className={`m-stake${insufficient ? ' over' : ''}`}>
              <span>PTS</span>
              <input
                id="m-slip-stake"
                inputMode="numeric"
                placeholder="0"
                value={slip.stake}
                onChange={(event) => slip.setStake(event.target.value.replace(/[^\d]/g, ''))}
              />
              <button type="button" aria-label="Clear stake" onClick={() => slip.setStake('')}><IconClose /></button>
            </span>
          </div>

          <div className="m-chips">
            {CHIPS.map((amount) => (
              <button key={amount} type="button" onClick={() => slip.setStake(String(stake + amount))}>+{amount}</button>
            ))}
          </div>

          <dl className="m-totals">
            <div><dt>Total odds</dt><dd>{formatOdds(total)}</dd></div>
            <div><dt>Total stake</dt><dd>{formatPoints(stake)} PTS</dd></div>
            <div className="big">
              <dt>Potential return</dt>
              <dd key={estimatedReturn}>{formatPoints(estimatedReturn)} PTS</dd>
            </div>
          </dl>

          {!session.data && <p className="m-slip-hint">Sign in to place a bet.</p>}
          {session.data && insufficient && <p className="m-slip-hint bad">Not enough virtual points.</p>}
          {slip.blocked && <p className="m-slip-hint bad">Remove unavailable selections to continue.</p>}

          {session.data ? (
            <button type="button" className="m-place" disabled={!canPlace} onClick={() => void slip.place()}>
              {slip.placing && <span className="m-spinner" aria-hidden="true" />}
              {slip.placing
                ? 'Placing bet…'
                : awaitingConfirmation
                  ? 'Confirm at new prices'
                  : `Place bet${stake > 0 ? ` · ${formatPoints(stake)} PTS` : ''}`}
            </button>
          ) : (
            <Link className="m-place" href="/login">Sign in to bet</Link>
          )}

          <p className="m-slip-note">
            <span className="m-age">18+</span>
            <span>Estimates only. Your stake, prices and return are confirmed by the server.</span>
          </p>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- bet placed */

const CONFETTI = Array.from({ length: 44 }, (_, index) => {
  // A fixed pseudo-random scatter, so every render of the burst is identical.
  const r = (n: number) => { const x = Math.sin(index * 12.9898 + n * 78.233) * 43758.5453; return x - Math.floor(x); };
  const strip = r(1) > 0.45;
  return {
    x: `${Math.round(r(2) * 100)}%`,
    w: strip ? 6 : 8,
    h: strip ? 14 : 8,
    round: !strip,
    tone: index % 5,
    dx: `${Math.round((r(3) - 0.5) * 160)}px`,
    rot: `${Math.round(360 + r(4) * 540)}deg`,
    d: `${(1.6 + r(5) * 1.2).toFixed(2)}s`,
    delay: `${(r(6) * 0.45).toFixed(2)}s`,
  };
});

/** The receipt shown after the server accepts a bet. Every figure comes from its reply. */
function BetPlaced({ bet, onClose }: { bet: PlacedBet; onClose: () => void }) {
  const slip = useBetSlip();
  const legs = bet.legs ?? [];
  const title = bet.type === 'SINGLE' ? 'Single' : `${foldName(legs.length || 2)}`;

  const keepSelections = () => {
    // Putting the same selections back is a plain re-add; it prices nothing.
    for (const leg of legs) slip.toggle(leg);
    slip.dismissReceipt();
  };
  const done = () => { slip.dismissReceipt(); onClose(); };

  return (
    <div className="m-placed" role="status">
      <div className="m-confetti" aria-hidden="true">
        {CONFETTI.map((piece, index) => (
          <span
            key={index}
            className={`tone-${piece.tone}`}
            style={{
              left: piece.x, width: piece.w, height: piece.h, borderRadius: piece.round ? '50%' : 2,
              ['--dx' as string]: piece.dx, ['--rot' as string]: piece.rot, animationDuration: piece.d, animationDelay: piece.delay,
            }}
          />
        ))}
      </div>

      <svg className="m-check" viewBox="0 0 64 64" width="88" height="88" aria-hidden="true">
        <circle className="bg" cx="32" cy="32" r="28" />
        <circle className="ring" cx="32" cy="32" r="28" transform="rotate(-90 32 32)" />
        <path className="tick" d="M20 33.5 28.5 42 45 24" />
      </svg>
      <h2>Bet placed</h2>
      <p>Good luck. You&apos;ll find it in My Bets.</p>

      <div className="m-receipt">
        <div className="m-receipt-head">
          <strong>{title} · {formatOdds(bet.totalOdds)}</strong>
          <span>Ticket {bet.id.slice(-8).toUpperCase()}</span>
        </div>
        {legs.map((leg) => (
          <div key={pickId(leg)} className="m-receipt-leg">
            <span><b>{leg.selectionName}{leg.point ? ` ${leg.point}` : ''}</b><small>{leg.homeTeam} v {leg.awayTeam}</small></span>
            <i>{formatOdds(leg.displayedOdds)}</i>
          </div>
        ))}
        <div className="m-receipt-totals">
          <div><small>Stake</small><b>{formatPoints(bet.stake)} PTS</b></div>
          <div><small>Potential return</small><b className="gain">{formatPoints(bet.potentialPayout)} PTS</b></div>
        </div>
      </div>

      <div className="m-placed-actions">
        <Link className="m-place" href="/my-bets" onClick={done}>View in My Bets</Link>
        <div>
          {legs.length > 0 && <button type="button" onClick={keepSelections}>Keep selections</button>}
          <button type="button" onClick={done}>Done</button>
        </div>
      </div>
    </div>
  );
}
