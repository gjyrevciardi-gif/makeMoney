/**
 * Pure market helpers and the shapes they operate on.
 *
 * Deliberately free of React, react-query and the API client so it can be unit
 * tested directly by the node:test runner. `lib/sports.ts` re-exports
 * everything here, so callers import from one place as before.
 */

export type SportsEvent = {
  provider: string;
  /** The provider's own id, as stored on a bet leg. */
  providerEventId: string;
  /**
   * The namespaced id used for links and odds lookups. It encodes which
   * provider owns the event, so routing cannot send an API-Football fixture
   * into The Odds API's id space. Optional so older payloads still parse.
   */
  internalEventId?: string;
  sportKey: string;
  sportName: string;
  competitionName?: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  status: 'UPCOMING' | 'STARTED_UNKNOWN';
};

export type Selection = { key: string; name: string; price: string; point?: string; suspended?: boolean };

export type MarketKey = string;
export type MarketGroup =
  | 'popular' | 'match_result' | 'goals' | 'handicaps'
  | 'halves' | 'team' | 'corners' | 'cards' | 'correct_score';

/**
 * `bettable` is the display/stake split. It is advisory on the client — the
 * server re-derives it on placement — but the UI must honour it so a
 * display-only or suspended market never reaches the bet slip.
 */
export type Market = {
  key: MarketKey;
  name: string;
  group?: MarketGroup;
  selections: Selection[];
  bettable?: boolean;
  suspended?: boolean;
  unavailableReason?: string;
};

/** Live state for an in-play fixture. Absent for pre-match events. */
export type LiveState = { status: string; minute?: number; homeScore?: number; awayScore?: number };

export type BoardEvent = {
  event: SportsEvent;
  bookmaker: { key: string; name: string } | null;
  markets: Market[];
};

export const MARKET_GROUP_ORDER: MarketGroup[] = ['popular', 'match_result', 'goals', 'handicaps', 'halves', 'team', 'corners', 'cards', 'correct_score'];
export const MARKET_GROUP_NAMES: Record<MarketGroup, string> = {
  popular: 'Popular', match_result: 'Match Result', goals: 'Goals', handicaps: 'Handicaps',
  halves: 'Halves', team: 'Team', corners: 'Corners', cards: 'Cards', correct_score: 'Correct Score',
};

/**
 * A selection may enter the slip only if its market AND itself both allow it.
 * `bettable` absent means unknown, and unknown is never treated as permission.
 */
export const isSelectable = (market: Market, selection: Selection) =>
  market.bettable === true && market.suspended !== true && selection.suspended !== true;

/** Group markets for the event page, preserving catalogue order, dropping empties. */
export function groupMarkets(markets: Market[]): { group: MarketGroup; name: string; markets: Market[] }[] {
  const byGroup = new Map<MarketGroup, Market[]>();
  for (const market of markets) {
    const group = (market.group ?? 'popular') as MarketGroup;
    byGroup.set(group, [...(byGroup.get(group) ?? []), market]);
  }
  return MARKET_GROUP_ORDER
    .filter(group => (byGroup.get(group)?.length ?? 0) > 0)
    .map(group => ({ group, name: MARKET_GROUP_NAMES[group], markets: byGroup.get(group)! }));
}

export const findMarket = (markets: Market[], key: MarketKey) =>
  markets.find((market) => market.key === key);

/**
 * The three match-result cells, in 1 / X / 2 order.
 *
 * Canonical keys are tried first. API-Football normalizes outcomes to
 * home/draw/away and names them "Home"/"Draw"/"Away", so matching on the team
 * name found only the draw — which rendered as "— X 4.00 —", losing both the
 * home and away prices on every soccer row.
 */
export function h2hCells(row: BoardEvent): (Selection | null)[] {
  const market = findMarket(row.markets, 'h2h');
  if (!market) return [null, null, null];

  const byKey = (key: string) => market.selections.find((s) => s.key === key) ?? null;
  const keyed: (Selection | null)[] = [byKey('home'), byKey('draw'), byKey('away')];
  if (keyed.some(Boolean)) return keyed;

  // The Odds API names outcomes after the teams and uses composite keys.
  const home = market.selections.find((s) => s.name === row.event.homeTeam) ?? null;
  const away = market.selections.find((s) => s.name === row.event.awayTeam) ?? null;
  const draw = market.selections.find((s) => s.name.toLowerCase() === 'draw') ?? null;
  if (home || away || draw) return [home, draw, away];

  // Last resort: provider order, which lists home, away, then draw.
  return [market.selections[0] ?? null, market.selections[2] ?? null, market.selections[1] ?? null];
}
