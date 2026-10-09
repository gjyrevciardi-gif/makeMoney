import { CasinoCategory, CasinoGame } from './casino';

export type CasinoLobbyFilter = 'ALL' | 'FAVORITES' | 'RECENT' | CasinoCategory;

export function categoryLabel(category: string) {
  return category
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function registryCategories(games: CasinoGame[]) {
  return games.reduce<CasinoCategory[]>((categories, game) => {
    if (!categories.includes(game.category)) categories.push(game.category);
    return categories;
  }, []);
}

export function normalizeCasinoSearch(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function matchesCasinoSearch(game: CasinoGame, value: string) {
  const search = normalizeCasinoSearch(value);
  if (!search) return true;

  const haystack = [
    game.name,
    game.description,
    game.category,
    categoryLabel(game.category),
    ...game.keywords,
  ].join(' ').toLowerCase();

  return search.split(' ').every((token) => haystack.includes(token));
}

export function filterCasinoGames(
  games: CasinoGame[],
  filter: CasinoLobbyFilter,
  search: string,
  favoriteIds: ReadonlySet<string>,
  recentIds: ReadonlySet<string>,
) {
  return games.filter((game) => {
    if (!matchesCasinoSearch(game, search)) return false;
    if (filter === 'ALL') return true;
    if (filter === 'FAVORITES') return favoriteIds.has(game.id);
    if (filter === 'RECENT') return recentIds.has(game.id);
    return game.category === filter;
  });
}
