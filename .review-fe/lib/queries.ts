'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { ApiError, clearAccessToken, deleteJson, getJson, postJson } from './api';

/**
 * One server-state strategy for the whole product.
 *
 * Every read goes through TanStack Query with a key from `qk`, so a mutation
 * anywhere can invalidate exactly the views that depend on it. There is no
 * second fetching system: components never hold server data in `useState`.
 */
export const qk = {
  session: ['session'] as const,
  wallet: ['wallet'] as const,
  sports: ['sports'] as const,
  board: (sportKey: string) => ['sports', 'board', sportKey] as const,
  eventOdds: (sportKey: string, eventId: string) => ['sports', 'odds', sportKey, eventId] as const,
  bets: (status: string) => ['bets', status] as const,
  casinoGames: ['casino', 'games'] as const,
  casinoFavorites: ['casino', 'favorites'] as const,
  casinoRecent: ['casino', 'recent'] as const,
  casinoHistory: (gameType?: string) => ['casino', 'history', gameType ?? 'all'] as const,
  adminConfig: ['admin', 'casino', 'config'] as const,
  adminVersions: (gameId: string) => ['admin', 'casino', 'versions', gameId] as const,
  adminAnalytics: (period: string) => ['admin', 'casino', 'analytics', period] as const,
  adminUsers: (search: string) => ['admin', 'users', search] as const,
  adminUserDetail: (id: string) => ['admin', 'users', 'detail', id] as const,
  adminAudit: ['admin', 'audit'] as const,
  adminProviders: ['admin', 'sports', 'providers'] as const,
  adminStale: ['admin', 'sports', 'stale'] as const,
};

/** Refetch cadences. Deliberately conservative: no polling faster than 15s. */
export const CADENCE = {
  /** Prematch prices move slowly and the backend caches them for 20s anyway. */
  prematchOddsMs: 30_000,
  /** In-play listings change more often, but still nowhere near per-frame. */
  liveOddsMs: 15_000,
  /** A single event page is the user's focus, so it may refresh a little faster. */
  eventOddsMs: 20_000,
  /** The catalogue of sports barely changes. */
  catalogueMs: 15 * 60_000,
};

export type Session = { id: string; email: string; role: 'USER' | 'ADMIN' | 'SUPER_ADMIN'; createdAt: string };
export type Wallet = { id: string; balance: string; createdAt: string };

/**
 * The signed-in user, or `null` when nobody is signed in.
 *
 * A 401 is a *state*, not a failure, so it resolves to `null` instead of
 * throwing and retrying. Role here only drives which links are rendered; every
 * protected route is still enforced by the backend.
 */
export function useSession() {
  return useQuery({
    queryKey: qk.session,
    queryFn: async () => {
      try {
        return await getJson<Session>('/users/me');
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return null;
        throw error;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

/** Backend-authoritative virtual balance. Never derived from local state. */
export function useWallet() {
  const session = useSession();
  return useQuery({
    queryKey: qk.wallet,
    enabled: Boolean(session.data),
    queryFn: async () => {
      try {
        return await getJson<Wallet>('/wallet/me');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 10_000,
    retry: false,
  });
}

/**
 * Refetches everything a completed money-moving action can change.
 *
 * Called after a sports bet, a casino round, a cashout and an admin grant or
 * removal, so no screen keeps showing a balance the server has already moved on
 * from - and no screen reloads the whole application to find out.
 */
export function invalidateAfterWagering(client: QueryClient) {
  void client.invalidateQueries({ queryKey: qk.wallet });
  void client.invalidateQueries({ queryKey: ['bets'] });
  void client.invalidateQueries({ queryKey: ['casino', 'history'] });
  void client.invalidateQueries({ queryKey: qk.casinoRecent });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => postJson('/auth/logout'),
    onSettled: () => {
      // The refresh cookie is gone; drop the in-memory access token with it so
      // no cached credential survives the sign-out.
      clearAccessToken();
      client.clear();
    },
  });
}

export { getJson, postJson, deleteJson, ApiError };
