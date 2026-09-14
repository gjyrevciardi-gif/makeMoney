import { Selection } from './domain';

/**
 * API-Football bet types -> our normalized market keys.
 *
 * Every mapping here was read off live responses during the discovery spike,
 * not from a guess, because the provider's two odds endpoints do not agree with
 * each other:
 *
 *   - Pre-match and live use SEPARATE bet-id namespaces. Pre-match id 10 is
 *     "Exact Score"; live id 23 is "Final Score". Mapping one table over both
 *     would silently mis-key half the markets, so there are two tables.
 *   - Pre-match embeds the line in the value ("Over 2.5"); live carries it in a
 *     separate `handicap` field ("Over" + handicap "1.5").
 *   - Pre-match writes correct scores with a colon ("1:0"); live uses a hyphen
 *     ("1-0"). Our settlement evaluator matches hyphens, so colons are converted
 *     rather than stored as-is — a stored "1:0" would never settle.
 *
 * Deliberately NOT mapped: pre-match bet 9 "Handicap Result". It is a THREE-way
 * European handicap whose values include "Draw -1", while our `spreads`
 * evaluator assumes a two-way home/away market. Mapping it to `spreads` would
 * settle draws as losses. It is left unmapped until a three-way evaluator
 * exists, which is the safe direction to be wrong in.
 */

/** Pre-match `/odds` bet id -> normalized market key. */
export const PREMATCH_BET_MARKETS: Record<number, string> = {
  1: 'h2h',                 // Match Winner        Home / Draw / Away
  2: 'draw_no_bet',         // Home/Away           Home / Away
  4: 'asian_handicap',      // Asian Handicap      display-only
  5: 'totals',              // Goals Over/Under    "Over 2.5"
  6: 'ht_totals',           // O/U First Half      display-only
  8: 'btts',                // Both Teams Score    Yes / No
  10: 'correct_score',      // Exact Score         "1:0"
  12: 'double_chance',      // Double Chance       "Home/Draw"
  13: 'ht_result',          // First Half Winner   display-only
  16: 'team_totals_home',   // Total - Home
  17: 'team_totals_away',   // Total - Away
  45: 'corners_totals',     // Corners Over Under  display-only
  55: 'corners_h2h',        // Corners 1x2         display-only
  80: 'cards_totals',       // Cards Over/Under    display-only
};

/** Live `/odds/live` bet id -> normalized market key. A different namespace. */
export const LIVE_BET_MARKETS: Record<number, string> = {
  23: 'correct_score',      // Final Score         "1-0"
  25: 'totals',             // Match Goals         "Over" + handicap
  33: 'asian_handicap',     // Asian Handicap      display-only
  48: 'draw_no_bet',        // Draw No Bet
  59: 'h2h',                // Fulltime Result
  69: 'btts',               // Both Teams to Score
  72: 'double_chance',      // Double Chance
  78: 'corners_h2h',        // Corners 1x2         display-only
};

/** One raw provider price, in either endpoint's shape. */
export type RawValue = { value: string | number; odd: string | number; handicap?: string | null; main?: boolean | null; suspended?: boolean | null };

const decimal = (value: string) => /^-?\d+(\.\d+)?$/.test(value.trim()) ? value.trim() : undefined;

/** "Over 2.5" -> { key: 'over', point: '2.5' }; "Over" + handicap -> same. */
const overUnder = (raw: string, handicap?: string | null) => {
  const text = raw.trim();
  const match = /^(over|under)\s*(-?\d+(?:\.\d+)?)?$/i.exec(text);
  if (!match) return undefined;
  const point = match[2] ?? (handicap ? decimal(String(handicap)) : undefined);
  return point === undefined ? undefined : { key: match[1].toLowerCase(), point };
};

const DOUBLE_CHANCE: Record<string, string> = { 'home/draw': 'home_draw', 'home/away': 'home_away', 'draw/away': 'draw_away' };
const OUTCOME: Record<string, string> = { home: 'home', draw: 'draw', away: 'away' };

/**
 * Normalize one provider price into a Selection, or undefined when the value
 * does not fit the market's expected shape.
 *
 * Returning undefined is deliberate and load-bearing: an unrecognised value is
 * dropped rather than guessed at, so a selection key our settlement evaluators
 * cannot read is never persisted on a bet leg.
 */
export function normalizeSelection(marketKey: string, raw: RawValue): Selection | undefined {
  const value = String(raw.value).trim();
  const price = decimal(String(raw.odd));
  if (!price) return undefined;
  const suspended = raw.suspended === true ? true : undefined;
  const base = { price, ...(suspended ? { suspended } : {}) };

  switch (marketKey) {
    case 'h2h': {
      const key = OUTCOME[value.toLowerCase()];
      return key ? { key, name: value, ...base } : undefined;
    }
    case 'draw_no_bet': {
      const key = OUTCOME[value.toLowerCase()];
      return key && key !== 'draw' ? { key, name: value, ...base } : undefined;
    }
    case 'double_chance': {
      const key = DOUBLE_CHANCE[value.toLowerCase()];
      return key ? { key, name: value, ...base } : undefined;
    }
    case 'btts': {
      const key = value.toLowerCase();
      return key === 'yes' || key === 'no' ? { key, name: value, ...base } : undefined;
    }
    case 'correct_score': {
      // Pre-match "1:0" and live "1-0" must land on one stored form, because
      // CorrectScoreSettlementEvaluator matches /^(\d{1,2})-(\d{1,2})$/.
      const match = /^(\d{1,2})\s*[:-]\s*(\d{1,2})$/.exec(value);
      return match ? { key: `${match[1]}-${match[2]}`, name: `${match[1]}-${match[2]}`, ...base } : undefined;
    }
    case 'totals':
    case 'ht_totals':
    case 'team_totals_home':
    case 'team_totals_away':
    case 'corners_totals':
    case 'cards_totals': {
      const parsed = overUnder(value, raw.handicap);
      return parsed ? { key: parsed.key, name: `${parsed.key === 'over' ? 'Over' : 'Under'} ${parsed.point}`, point: parsed.point, ...base } : undefined;
    }
    case 'asian_handicap': {
      // Display-only, so the key only has to be stable and unique, never
      // settleable. Pre-match spells it "Home -1.25"; live splits it into
      // value "Home" plus handicap "-0.75".
      const match = /^(home|away)\s*(-?\d+(?:\.\d+)?)?$/i.exec(value);
      if (!match) return undefined;
      const point = match[2] ?? (raw.handicap ? decimal(String(raw.handicap)) : undefined);
      if (point === undefined) return undefined;
      return { key: `${match[1].toLowerCase()}_${point}`, name: `${match[1]} ${point}`, point, ...base };
    }
    case 'ht_result':
    case 'corners_h2h': {
      const key = OUTCOME[value.toLowerCase()];
      return key ? { key, name: value, ...base } : undefined;
    }
    default:
      return undefined;
  }
}
