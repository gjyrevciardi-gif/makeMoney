'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { ApiError, newIdempotencyKey, postJson } from './api';
import { invalidateAfterWagering, qk } from './queries';
import type { EventOdds, Market, SportsBoard } from './sports';

export type SlipPick = {
  eventId: string;
  sportKey: string;
  marketKey: string;
  marketName: string;
  selectionKey: string;
  selectionName: string;
  point?: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  /** The price the player saw when they tapped. Sent to the backend to verify. */
  displayedOdds: string;
};

export type PickStatus = 'OK' | 'CHANGED' | 'UNAVAILABLE' | 'STARTED';

export type ReconciledPick = SlipPick & {
  status: PickStatus;
  /** The latest price seen in cache, when it differs from `displayedOdds`. */
  currentOdds?: string;
};

export type PlacedBet = {
  id: string;
  type: 'SINGLE' | 'ACCUMULATOR';
  stake: string;
  totalOdds: string;
  potentialPayout: string;
};

type OddsChangeRow = {
  eventId: string;
  marketKey: string;
  selectionKey: string;
  oldOdds: string;
  newOdds: string;
};

type SlipState = {
  picks: SlipPick[];
  stake: string;
  sheetOpen: boolean;
  placing: boolean;
  errorCode?: string;
  errorMessage?: string;
  /** Set when the backend answered ODDS_CHANGED; cleared once re-submitted. */
  pendingChanges?: OddsChangeRow[];
  lastPlaced?: PlacedBet;
};

export const pickId = (pick: Pick<SlipPick, 'eventId' | 'marketKey' | 'selectionKey'>) =>
  `${pick.eventId}:${pick.marketKey}:${pick.selectionKey}`;

type SlipContextValue = {
  picks: ReconciledPick[];
  ids: ReadonlySet<string>;
  stake: string;
  sheetOpen: boolean;
  placing: boolean;
  errorCode?: string;
  errorMessage?: string;
  pendingChanges?: OddsChangeRow[];
  lastPlaced?: PlacedBet;
  betType: 'SINGLE' | 'ACCUMULATOR';
  blocked: boolean;
  toggle: (pick: SlipPick) => void;
  remove: (id: string) => void;
  clear: () => void;
  setStake: (value: string) => void;
  setSheetOpen: (open: boolean) => void;
  acknowledgeChanges: () => void;
  dismissReceipt: () => void;
  place: () => Promise<void>;
};

const SlipContext = createContext<SlipContextValue | null>(null);

/**
 * The bet slip.
 *
 * It holds selections and a stake, nothing more. Odds, returns and acceptance
 * are decided by the backend: the slip's own arithmetic is labelled an estimate
 * everywhere it is shown, and a price the server disagrees with is surfaced for
 * explicit re-confirmation rather than quietly accepted.
 */
export function BetSlipProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [state, setState] = useState<SlipState>({ picks: [], stake: '', sheetOpen: false, placing: false });

  const patch = useCallback((next: Partial<SlipState>) => {
    setState((current) => ({ ...current, ...next }));
  }, []);

  const toggle = useCallback((pick: SlipPick) => {
    setState((current) => {
      const id = pickId(pick);
      const exists = current.picks.some((entry) => pickId(entry) === id);
      return {
        ...current,
        errorCode: undefined,
        errorMessage: undefined,
        pendingChanges: undefined,
        lastPlaced: undefined,
        picks: exists
          ? current.picks.filter((entry) => pickId(entry) !== id)
          : [...current.picks, pick],
      };
    });
  }, []);

  const remove = useCallback((id: string) => {
    setState((current) => ({
      ...current,
      picks: current.picks.filter((entry) => pickId(entry) !== id),
      errorCode: undefined,
      errorMessage: undefined,
      pendingChanges: undefined,
    }));
  }, []);

  const clear = useCallback(() => {
    setState((current) => ({
      ...current,
      picks: [],
      errorCode: undefined,
      errorMessage: undefined,
      pendingChanges: undefined,
    }));
  }, []);

  const reconciled = useReconciledPicks(state.picks, state.pendingChanges);

  const betType: 'SINGLE' | 'ACCUMULATOR' = state.picks.length > 1 ? 'ACCUMULATOR' : 'SINGLE';
  const blocked = reconciled.some((pick) => pick.status === 'UNAVAILABLE' || pick.status === 'STARTED');

  const place = useCallback(async () => {
    const stakeValue = Number(state.stake);
    if (!state.picks.length || !Number.isInteger(stakeValue) || stakeValue <= 0) return;

    patch({ placing: true, errorCode: undefined, errorMessage: undefined, lastPlaced: undefined });
    try {
      const bet = await postJson<PlacedBet>('/bets', {
        type: state.picks.length > 1 ? 'ACCUMULATOR' : 'SINGLE',
        stake: stakeValue,
        // A fresh key per attempt: a re-confirmation after ODDS_CHANGED is a new
        // submission, not a replay of the rejected one.
        idempotencyKey: newIdempotencyKey(),
        selections: state.picks.map((pick) => ({
          eventId: pick.eventId,
          sportKey: pick.sportKey,
          marketKey: pick.marketKey,
          selectionKey: pick.selectionKey,
          displayedOdds: pick.displayedOdds,
        })),
      });
      setState({ picks: [], stake: '', sheetOpen: true, placing: false, lastPlaced: bet });
      invalidateAfterWagering(client);
    } catch (error) {
      const failure = error instanceof ApiError
        ? error
        : new ApiError('REQUEST_FAILED', 'Request failed.', 0);

      if (failure.code === 'ODDS_CHANGED') {
        const detail = failure.detail as { selections?: OddsChangeRow[] } | undefined;
        const changes = detail?.selections ?? [];
        // The new prices are adopted into the slip so the player can see exactly
        // what moved, but the bet is NOT resubmitted for them.
        setState((current) => ({
          ...current,
          placing: false,
          errorCode: failure.code,
          errorMessage: failure.message,
          pendingChanges: changes,
          picks: current.picks.map((pick) => {
            const change = changes.find((row) => row.eventId === pick.eventId
              && row.marketKey === pick.marketKey
              && row.selectionKey === pick.selectionKey);
            return change ? { ...pick, displayedOdds: change.newOdds } : pick;
          }),
        }));
        return;
      }

      patch({ placing: false, errorCode: failure.code, errorMessage: failure.message });
    }
  }, [client, patch, state.picks, state.stake]);

  const value = useMemo<SlipContextValue>(() => ({
    picks: reconciled,
    ids: new Set(state.picks.map(pickId)),
    stake: state.stake,
    sheetOpen: state.sheetOpen,
    placing: state.placing,
    errorCode: state.errorCode,
    errorMessage: state.errorMessage,
    pendingChanges: state.pendingChanges,
    lastPlaced: state.lastPlaced,
    betType,
    blocked,
    toggle,
    remove,
    clear,
    setStake: (stake: string) => patch({ stake, errorCode: undefined, errorMessage: undefined }),
    setSheetOpen: (sheetOpen: boolean) => patch({ sheetOpen }),
    acknowledgeChanges: () => patch({ pendingChanges: undefined, errorCode: undefined, errorMessage: undefined }),
    dismissReceipt: () => patch({ lastPlaced: undefined }),
    place,
  }), [reconciled, state, betType, blocked, toggle, remove, clear, patch, place]);

  return <SlipContext.Provider value={value}>{children}</SlipContext.Provider>;
}

export function useBetSlip() {
  const context = useContext(SlipContext);
  if (!context) throw new Error('useBetSlip must be used inside BetSlipProvider');
  return context;
}

/**
 * Cross-checks each pick against prices already in the query cache.
 *
 * Every observer here is `enabled: false`, so reconciliation issues no requests
 * of its own: it reads what the board and event pages have already fetched and
 * re-renders when they refresh. A selection that has vanished from its market,
 * or whose event has started, is flagged before the player tries to stake -
 * and the backend still performs the authoritative check on placement.
 */
function useReconciledPicks(picks: SlipPick[], pendingChanges: OddsChangeRow[] | undefined): ReconciledPick[] {
  const sportKeys = useMemo(
    () => [...new Set(picks.map((pick) => pick.sportKey))],
    [picks],
  );
  const eventKeys = useMemo(
    () => [...new Map(picks.map((pick) => [`${pick.sportKey}:${pick.eventId}`, pick])).values()]
      .map((pick) => ({ sportKey: pick.sportKey, eventId: pick.eventId })),
    [picks],
  );

  const boards = useQueries({
    queries: sportKeys.map((sportKey) => ({
      queryKey: qk.board(sportKey),
      enabled: false,
      staleTime: Infinity,
      queryFn: () => Promise.reject(new Error('cache-only')) as Promise<SportsBoard>,
    })),
  });

  const events = useQueries({
    queries: eventKeys.map(({ sportKey, eventId }) => ({
      queryKey: qk.eventOdds(sportKey, eventId),
      enabled: false,
      staleTime: Infinity,
      queryFn: () => Promise.reject(new Error('cache-only')) as Promise<EventOdds>,
    })),
  });

  const boardData = boards.map((entry) => entry.data as SportsBoard | undefined);
  const eventData = events.map((entry) => entry.data as EventOdds | undefined);
  // `useQueries` hands back fresh result objects every render, so the snapshot
  // is memoised against the fetch timestamps instead - they change if and only
  // if the underlying prices did.
  const fingerprint = [
    ...boardData.map((board) => board?.fetchedAt ?? '-'),
    ...eventData.map((odds) => odds?.fetchedAt ?? '-'),
  ].join('|');

  return useMemo(() => {
    const known = new Map<string, { markets: Market[]; startTime: string }>();
    for (const board of boardData) {
      for (const row of board?.events ?? []) {
        known.set(row.event.providerEventId, { markets: row.markets, startTime: row.event.startTime });
      }
    }
    // A dedicated event page carries the fuller market set, so it wins.
    for (const odds of eventData) {
      if (odds) known.set(odds.event.providerEventId, { markets: odds.markets, startTime: odds.event.startTime });
    }

    return picks.map((pick): ReconciledPick => {
      const changed = pendingChanges?.some((row) => row.eventId === pick.eventId
        && row.marketKey === pick.marketKey
        && row.selectionKey === pick.selectionKey);
      if (changed) return { ...pick, status: 'CHANGED' };

      const snapshot = known.get(pick.eventId);
      if (!snapshot) return { ...pick, status: 'OK' };

      if (Date.parse(snapshot.startTime) <= Date.now()) return { ...pick, status: 'STARTED' };

      const market = snapshot.markets.find((entry) => entry.key === pick.marketKey);
      const selection = market?.selections.find((entry) => entry.key === pick.selectionKey);
      if (!selection) return { ...pick, status: 'UNAVAILABLE' };

      if (selection.price !== pick.displayedOdds) {
        return { ...pick, status: 'CHANGED', currentOdds: selection.price };
      }
      return { ...pick, status: 'OK' };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint, picks, pendingChanges]);
}
