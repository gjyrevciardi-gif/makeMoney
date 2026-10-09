'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { combinedOdds, formatOdds, formatPoints } from '../../lib/format';
import { pickId, useBetSlip, type ReconciledPick } from '../../lib/bet-slip';
import { describeSportsError } from '../../lib/sports';
import { useSession, useWallet } from '../../lib/queries';
import { IconClose } from '../shell/icons';

const QUICK_STAKES = [100, 500, 1000, 5000];

const STATUS_COPY: Record<ReconciledPick['status'], { text: string; tone: 'bad' | 'warn' } | null> = {
  OK: null,
  CHANGED: { text: 'Price changed — review before placing', tone: 'warn' },
  UNAVAILABLE: { text: 'Unavailable — remove to continue', tone: 'bad' },
  STARTED: { text: 'Event has started — remove to continue', tone: 'bad' },
};

function SlipPickRow({ pick }: { pick: ReconciledPick }) {
  const slip = useBetSlip();
  const status = STATUS_COPY[pick.status];
  const classes = ['slip-pick'];
  if (pick.status === 'UNAVAILABLE' || pick.status === 'STARTED') classes.push('unavailable');
  if (pick.status === 'CHANGED') classes.push('changed');

  return (
    <div className={classes.join(' ')}>
      <button
        type="button"
        className="slip-pick-remove"
        aria-label={`Remove ${pick.selectionName}`}
        onClick={() => slip.remove(pickId(pick))}
      >
        ×
      </button>
      <div className="slip-pick-top">
        <span className="slip-pick-selection">
          {pick.selectionName}{pick.point ? ` ${pick.point}` : ''}
        </span>
        <span className="slip-pick-odds">{formatOdds(pick.displayedOdds)}</span>
      </div>
      <span className="slip-pick-market">{pick.marketName}</span>
      <span className="slip-pick-event">{pick.homeTeam} v {pick.awayTeam}</span>
      {status && (
        <p className={`slip-pick-status ${status.tone}`}>
          {status.text}
          {pick.status === 'CHANGED' && pick.currentOdds
            ? ` (now ${formatOdds(pick.currentOdds)})`
            : ''}
        </p>
      )}
    </div>
  );
}

/**
 * The bet slip.
 *
 * Total odds and estimated return are computed here purely to show the player
 * what they are about to submit. The backend re-prices every leg on placement,
 * and a disagreement comes back as ODDS_CHANGED, which is surfaced for explicit
 * re-confirmation rather than accepted silently.
 */
export function BetSlip({ onClose }: { onClose?: () => void }) {
  const slip = useBetSlip();
  const session = useSession();
  const wallet = useWallet();

  const balance = Number(wallet.data?.balance ?? 0);
  const stakeValue = Number(slip.stake || 0);
  const total = useMemo(
    () => combinedOdds(slip.picks.map((pick) => pick.displayedOdds)),
    [slip.picks],
  );
  const estimatedReturn = Math.floor(stakeValue * total);

  const invalidStake = !Number.isInteger(stakeValue) || stakeValue <= 0;
  const insufficient = stakeValue > balance;
  const awaitingConfirmation = Boolean(slip.pendingChanges?.length);
  const canPlace = Boolean(session.data)
    && slip.picks.length > 0
    && !invalidStake
    && !insufficient
    && !slip.blocked
    && !slip.placing;

  return (
    <div className="slip">
      <div className="slip-head">
        <h2>Bet Slip</h2>
        {slip.picks.length > 0 && <span className="slip-count">{slip.picks.length}</span>}
        {slip.picks.length > 0 && (
          <button type="button" className="slip-clear" onClick={slip.clear}>Clear all</button>
        )}
        {onClose && (
          <button type="button" className="slip-clear" aria-label="Close bet slip" onClick={onClose}>
            <IconClose className="league-chevron" />
          </button>
        )}
      </div>

      {slip.picks.length > 0 && (
        <div className="slip-mode">
          <div className="tabs" role="tablist" aria-label="Bet type">
            <button type="button" role="tab" aria-selected={slip.betType === 'SINGLE'} disabled>
              Single
            </button>
            <button type="button" role="tab" aria-selected={slip.betType === 'ACCUMULATOR'} disabled>
              Accumulator
            </button>
          </div>
          <p className="slip-note" style={{ marginTop: 6 }}>
            {slip.betType === 'SINGLE'
              ? 'One selection is placed as a single.'
              : `${slip.picks.length} selections are combined into one accumulator.`}
          </p>
        </div>
      )}

      <div className="slip-body">
        {slip.lastPlaced && (
          <div className="alert good" role="status">
            <div>
              <strong className="slip-placed">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="m7 12.5 3.2 3.2L17 9" /></svg>
                Bet placed
              </strong>
              <div className="slip-note" style={{ color: 'inherit' }}>
                {formatPoints(slip.lastPlaced.stake)} PTS at {formatOdds(slip.lastPlaced.totalOdds)} ·
                potential return {formatPoints(slip.lastPlaced.potentialPayout)} PTS
              </div>
              <Link className="ops-link" href="/my-bets">View in My Bets</Link>
            </div>
            <button type="button" aria-label="Dismiss" onClick={slip.dismissReceipt} style={{ marginLeft: 'auto' }}>×</button>
          </div>
        )}

        {slip.picks.length === 0 && !slip.lastPlaced && (
          <div className="empty-state" style={{ padding: '26px 14px' }}>
            <strong>Your slip is empty</strong>
            <span>Tap any price to add a selection.</span>
          </div>
        )}

        {slip.picks.map((pick) => <SlipPickRow key={pickId(pick)} pick={pick} />)}

        {awaitingConfirmation && (
          <div className="alert warn" role="alert">
            <div>
              <strong>Odds changed</strong>
              <ul style={{ marginTop: 4 }}>
                {slip.pendingChanges?.map((change) => (
                  <li key={`${change.eventId}:${change.selectionKey}`} className="slip-note" style={{ color: 'inherit' }}>
                    {formatOdds(change.oldOdds)} → {formatOdds(change.newOdds)}
                  </li>
                ))}
              </ul>
              <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={slip.acknowledgeChanges}>
                Accept new prices
              </button>
            </div>
          </div>
        )}

        {slip.errorCode && !awaitingConfirmation && (
          <p className="alert bad" role="alert">{describeSportsError(slip.errorCode, slip.errorMessage)}</p>
        )}
      </div>

      {slip.picks.length > 0 && (
        <div className="slip-foot">
          <div className="slip-stake-row">
            <label className="sr-only" htmlFor="slip-stake">Stake in virtual points</label>
            <input
              id="slip-stake"
              className="input"
              inputMode="numeric"
              placeholder="Stake"
              value={slip.stake}
              onChange={(event) => slip.setStake(event.target.value.replace(/[^\d]/g, ''))}
            />
            <span className="slip-note">of {formatPoints(balance)} PTS</span>
          </div>

          <div className="slip-quick">
            {QUICK_STAKES.map((amount) => (
              <button key={amount} type="button" onClick={() => slip.setStake(String(amount))}>
                {formatPoints(amount)}
              </button>
            ))}
          </div>

          <div className="slip-line">
            <span>Total odds</span>
            <span className="slip-figure">{formatOdds(total)}</span>
          </div>
          <div className="slip-line total">
            <span>Estimated return</span>
            <span className="slip-figure">{formatPoints(estimatedReturn)} PTS</span>
          </div>

          {!session.data && <p className="slip-note">Sign in to place a bet.</p>}
          {session.data && insufficient && <p className="slip-note" style={{ color: 'var(--color-bad)' }}>Not enough virtual points.</p>}
          {slip.blocked && <p className="slip-note" style={{ color: 'var(--color-bad)' }}>Remove unavailable selections to continue.</p>}

          {session.data ? (
            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={!canPlace}
              onClick={() => void slip.place()}
            >
              {slip.placing
                ? 'Placing…'
                : awaitingConfirmation
                  ? 'Confirm at new prices'
                  : 'Place bet'}
            </button>
          ) : (
            <Link className="btn btn-primary btn-block" href="/login">Sign in to bet</Link>
          )}

          <p className="slip-note">
            Estimates only. Your stake, prices and return are confirmed by the server.
          </p>
        </div>
      )}
    </div>
  );
}

/** Desktop: a right-hand drawer. Mobile: a near-full-width bottom sheet. Both open from a summary bar. */
export function BetSlipSheet() {
  const slip = useBetSlip();
  const stakeValue = Number(slip.stake || 0);

  // The receipt for a just-placed bet must stay reachable after the picks clear.
  if (slip.picks.length === 0 && !slip.lastPlaced) return null;

  return (
    <>
      {!slip.sheetOpen && (
        <button type="button" className="slip-bar" onClick={() => slip.setSheetOpen(true)}>
          <span key={slip.picks.length} className="slip-bar-label">{slip.picks.length > 0 ? `Bet Slip (${slip.picks.length})` : 'Bet placed'}</span>
          <span className="slip-bar-figure">
            {stakeValue > 0 ? `${formatPoints(stakeValue)} PTS` : slip.picks.length > 0 ? 'Add stake' : 'View'}
          </span>
        </button>
      )}

      {slip.sheetOpen && (
        <>
          <div className="slip-sheet-backdrop" onClick={() => slip.setSheetOpen(false)} />
          <div className="slip-sheet" role="dialog" aria-modal="true" aria-label="Bet slip">
            <BetSlip onClose={() => slip.setSheetOpen(false)} />
          </div>
        </>
      )}
    </>
  );
}
