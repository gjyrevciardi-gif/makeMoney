'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteJson, getJson, postJson } from './api';
import { qk } from './queries';
import type { CasinoGame, CasinoGamesResponse } from './casino';

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
