/**
 * The normalized market catalogue.
 *
 * Two properties are deliberately separate here, because conflating them is how
 * a sportsbook accepts a bet it cannot pay out:
 *
 *   displayable — we can render it from provider data.
 *   settleable  — our settlement engine can decide it deterministically from a
 *                 finished event's result, with no human judgement.
 *
 * `settleable: false` markets are shown but never accepted as stakes (§5). A
 * market becomes bettable only by gaining a real evaluator in
 * `settlement/evaluators.ts`; `markets.spec.ts` fails the build if the two ever
 * disagree, so this file cannot quietly grant betting rights.
 *
 * What is settleable today is bounded by NormalizedEventResult, which carries
 * only the full-time home and away score. Everything derivable from that pair
 * is settleable; everything needing half-time scores, corner counts, card
 * counts or quarter-line push maths is display-only until the result provider
 * supplies those figures.
 */

/** Groups drive the event-page accordions (§6) and their display order. */
export type MarketGroup =
  | 'popular'
  | 'match_result'
  | 'goals'
  | 'handicaps'
  | 'halves'
  | 'team'
  | 'corners'
  | 'cards'
  | 'correct_score';

export const MARKET_GROUP_ORDER: MarketGroup[] = [
  'popular',
  'match_result',
  'goals',
  'handicaps',
  'halves',
  'team',
  'corners',
  'cards',
  'correct_score',
];

export const MARKET_GROUP_NAMES: Record<MarketGroup, string> = {
  popular: 'Popular',
  match_result: 'Match Result',
  goals: 'Goals',
  handicaps: 'Handicaps',
  halves: 'Halves',
  team: 'Team',
  corners: 'Corners',
  cards: 'Cards',
  correct_score: 'Correct Score',
};

export type MarketDefinition = {
  key: string;
  name: string;
  group: MarketGroup;
  /** True only where an evaluator can decide this market from a final result. */
  settleable: boolean;
  /** Shown on the dense board (§7); everything else lives on the event page. */
  primary?: boolean;
  /** Why a displayable market cannot be staked — surfaced to the UI verbatim. */
  unsettleableReason?: string;
};

const NEEDS_HALF_TIME = 'Half-time scores are not available to settlement yet.';
const NEEDS_CORNERS = 'Corner counts are not available to settlement yet.';
const NEEDS_CARDS = 'Card counts are not available to settlement yet.';
const NEEDS_QUARTER_LINES = 'Asian quarter-line push handling is not implemented yet.';

/**
 * Keyed by our normalized market key, never by a provider's own id. Provider
 * bet ids map onto these in the provider adapter, so a provider renaming a bet
 * type cannot change what is bettable.
 */
export const MARKET_CATALOGUE: Record<string, MarketDefinition> = {
  // --- Pre-existing markets. Behaviour must not change (§4). ---
  h2h: { key: 'h2h', name: 'Match Winner', group: 'match_result', settleable: true, primary: true },
  spreads: { key: 'spreads', name: 'Handicap', group: 'handicaps', settleable: true },
  totals: { key: 'totals', name: 'Over/Under', group: 'goals', settleable: true, primary: true },

  // --- New soccer markets that a full-time score decides on its own. ---
  double_chance: { key: 'double_chance', name: 'Double Chance', group: 'match_result', settleable: true },
  draw_no_bet: { key: 'draw_no_bet', name: 'Draw No Bet', group: 'match_result', settleable: true },
  btts: { key: 'btts', name: 'Both Teams To Score', group: 'goals', settleable: true, primary: true },
  correct_score: { key: 'correct_score', name: 'Correct Score', group: 'correct_score', settleable: true },
  team_totals_home: { key: 'team_totals_home', name: 'Home Team Total', group: 'team', settleable: true },
  team_totals_away: { key: 'team_totals_away', name: 'Away Team Total', group: 'team', settleable: true },

  // --- Displayable, not settleable. Rendered, never staked. ---
  asian_handicap: {
    key: 'asian_handicap', name: 'Asian Handicap', group: 'handicaps', settleable: false,
    unsettleableReason: NEEDS_QUARTER_LINES,
  },
  ht_result: {
    key: 'ht_result', name: 'Half Time Result', group: 'halves', settleable: false,
    unsettleableReason: NEEDS_HALF_TIME,
  },
  ht_totals: {
    key: 'ht_totals', name: 'First Half Over/Under', group: 'halves', settleable: false,
    unsettleableReason: NEEDS_HALF_TIME,
  },
  ht_btts: {
    key: 'ht_btts', name: 'First Half Both Teams To Score', group: 'halves', settleable: false,
    unsettleableReason: NEEDS_HALF_TIME,
  },
  corners_totals: {
    key: 'corners_totals', name: 'Corners Over/Under', group: 'corners', settleable: false,
    unsettleableReason: NEEDS_CORNERS,
  },
  corners_h2h: {
    key: 'corners_h2h', name: 'Most Corners', group: 'corners', settleable: false,
    unsettleableReason: NEEDS_CORNERS,
  },
  cards_totals: {
    key: 'cards_totals', name: 'Cards Over/Under', group: 'cards', settleable: false,
    unsettleableReason: NEEDS_CARDS,
  },
};

export const marketDefinition = (key: string): MarketDefinition | undefined => MARKET_CATALOGUE[key];

/**
 * The betting gate. Anything absent from the catalogue is unknown and therefore
 * unbettable — a provider adding a bet type we have never seen cannot become
 * stakeable by accident.
 */
export const isBettableMarket = (key: string): boolean => MARKET_CATALOGUE[key]?.settleable === true;

export const isDisplayableMarket = (key: string): boolean => key in MARKET_CATALOGUE;

export const marketGroupOf = (key: string): MarketGroup => MARKET_CATALOGUE[key]?.group ?? 'popular';

/** Board markets (§7): the dense listing shows these and counts the rest. */
export const PRIMARY_MARKET_KEYS: string[] = Object.values(MARKET_CATALOGUE)
  .filter(definition => definition.primary)
  .map(definition => definition.key);

export const BETTABLE_MARKET_KEYS: string[] = Object.values(MARKET_CATALOGUE)
  .filter(definition => definition.settleable)
  .map(definition => definition.key);
