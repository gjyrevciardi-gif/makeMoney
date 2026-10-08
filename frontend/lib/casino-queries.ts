'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteJson, getJson, postJson } from './api';
import { invalidateAfterWagering, qk } from './queries';
import type { CasinoGame, CasinoGamesResponse } from './casino';
import { fetchBalance } from './casino';
import { useCallback } from 'react';

/**
 * Registry-driven lobby reads.
 *
 * `enabled` and `maintenance` come from the backend's merge of the registry and
 * the operator's persisted configuration, so a game an administrator has turned
 * off is presented as unavailable instead of failing only at the point of play.
 */
export function useCasinoGames() {
  return useQuery({
    queryKey: qk.casinoGames,
    queryFn: () => getJson<CasinoGamesResponse>('/casino/games'),
    staleTime: 60_000,
  });
}

export function useCasinoFavorites() {
  return useQuery({
    queryKey: qk.casinoFavorites,
    queryFn: () => getJson<CasinoGamesResponse>('/casino/favorites'),
    staleTime: 60_000,
  });
}

export function useCasinoRecent() {
  return useQuery({
    queryKey: qk.casinoRecent,
    queryFn: () => getJson<CasinoGamesResponse>('/casino/recent?limit=10'),
    staleTime: 30_000,
  });
}

/**
 * Optimistic favourite toggle.
 *
 * The star flips immediately and is rolled back if the server refuses, then the
 * favourites list is refetched so the cache ends up matching the database
 * rather than the optimistic guess.
 */
export function useToggleFavorite() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ game, favorite }: { game: CasinoGame; favorite: boolean }) => {
      const path = `/casino/games/${encodeURIComponent(game.id)}/favorite`;
      return favorite ? deleteJson(path) : postJson(path, {});
    },
    onMutate: async ({ game, favorite }) => {
      await client.cancelQueries({ queryKey: qk.casinoFavorites });
      const previous = client.getQueryData<CasinoGamesResponse>(qk.casinoFavorites);
      client.setQueryData<CasinoGamesResponse>(qk.casinoFavorites, (current) => {
        const games = current?.games ?? [];
        return {
          games: favorite
            ? games.filter((entry) => entry.id !== game.id)
            : [game, ...games.filter((entry) => entry.id !== game.id)],
        };
      });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) client.setQueryData(qk.casinoFavorites, context.previous);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: qk.casinoFavorites });
    },
  });
}

/**
 * Refreshes the balance a settled casino round has changed.
 *
 * Each game keeps its own balance in local state, which used to be refetched
 * directly. That updated the game panel but left the app header showing a stale
 * figure until a full page reload, because the header reads the shared `wallet`
 * query and nothing in the casino ever invalidated it — `invalidateAfterWagering`
 * documented itself as covering casino rounds but only the sportsbook called it.
 *
 * Returning the fresh value keeps the existing `setBalance(await ...)` shape at
 * every call site while also refreshing the header, casino history and the
 * recently-played row from one place.
 */
export function useSettledBalance() {
  const client = useQueryClient();
  return useCallback(async () => {
    const balance = await fetchBalance();
    invalidateAfterWagering(client);
    return balance;
  }, [client]);
}
