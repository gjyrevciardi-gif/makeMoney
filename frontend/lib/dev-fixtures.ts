/**
 * DEV FIXTURE DATA - VISUAL COMPARISON ONLY.
 *
 * Sample sportsbook and casino lists so the player UI can be reviewed when no
 * sports provider key is configured. It is NEVER authoritative:
 *
 *  - It is active only when BOTH `NODE_ENV !== 'production'` AND
 *    `NEXT_PUBLIC_DEV_FIXTURES === '1'` are true. Each call site writes that condition
 *    INLINE and loads this module through a dynamic `import()` behind it, so a
 *    production build sees a literal `false`, drops the branch and never emits this
 *    module. Do NOT import this file statically or wrap the check in a helper: either
 *    would keep the sample data in the production bundle (verified by grepping the build).
 *  - It replaces only the read queries for the public sports catalogue, the sports
 *    board / event odds, and the casino lobby lists.
 *  - Everything that decides money still goes to the backend unchanged: the server
 *    re-prices every pick on placement and rejects a fixture event, so a bet on
 *    fixture data cannot be placed.
 *  - The shell shows a persistent "DEV FIXTURE DATA" banner whenever it is active.
 *
 * Enable locally with `NEXT_PUBLIC_DEV_FIXTURES=1`; remove the variable to turn it off.
 */
import type { CasinoGame, CasinoGamesResponse } from './casino';
import type { BoardEvent, EventOdds, Sport, SportsBoard } from './sports';

const at = (dayOffset: number, hour: number, minute: number) => {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
};

const SPORTS: Sport[] = [
  { key: 'soccer_uefa_nations_league', name: 'UEFA Nations League', group: 'Soccer', active: true },
  { key: 'americanfootball_nfl', name: 'NFL', group: 'American Football', active: true },
  { key: 'basketball_nba_preseason', name: 'NBA Pre-Season', group: 'Basketball', active: true },
  { key: 'tennis_atp', name: 'Upcoming Tennis', group: 'Tennis', active: true },
  { key: 'baseball_mlb', name: 'MLB', group: 'Baseball', active: true },
  { key: 'soccer_epl', name: 'English Premier League', group: 'Soccer', active: true },
  { key: 'icehockey_nhl', name: 'NHL', group: 'Ice Hockey', active: true },
];

const fixtureEvent = (
  id: string, sportKey: string, competition: string, home: string, away: string,
  start: string, prices: [string, string, string],
): BoardEvent => ({
  event: {
    provider: 'dev-fixture', providerEventId: `fixture-${id}`, sportKey, sportName: competition,
    competitionName: competition, homeTeam: home, awayTeam: away, startTime: start, status: 'UPCOMING',
  },
  bookmaker: { key: 'dev-fixture', name: 'Dev fixture' },
  markets: [{
    key: 'h2h', name: 'Match Result',
    selections: [
      { key: 'home', name: home, price: prices[0] },
      { key: 'draw', name: 'Draw', price: prices[1] },
      { key: 'away', name: away, price: prices[2] },
    ],
  }],
});

const eventsFor = (sportKey: string): BoardEvent[] => [
  fixtureEvent('1', sportKey, 'UEFA Nations League A', 'Croatia', 'Spain', at(0, 20, 45), ['10.00', '6.50', '1.25']),
  fixtureEvent('2', sportKey, 'UEFA Nations League A', 'England', 'Czechia', at(0, 20, 45), ['1.10', '9.00', '21.00']),
  fixtureEvent('3', sportKey, 'UEFA Nations League A', 'Scotland', 'Greece', at(0, 20, 45), ['1.75', '3.50', '4.75']),
  fixtureEvent('4', sportKey, 'UEFA Nations League B', 'Wales', 'Iceland', at(1, 19, 0), ['2.10', '3.20', '3.40']),
  fixtureEvent('5', sportKey, 'UEFA Nations League B', 'Norway', 'Austria', at(1, 21, 0), ['2.40', '3.30', '2.90']),
];

export const fixtureSports = (): Sport[] => SPORTS;

export const fixtureBoard = (sportKey: string): SportsBoard => ({
  sportKey,
  sportName: SPORTS.find((sport) => sport.key === sportKey)?.name ?? sportKey,
  fetchedAt: new Date().toISOString(),
  staleAt: new Date(Date.now() + 3_600_000).toISOString(),
  events: eventsFor(sportKey),
});

export const fixtureEventOdds = (sportKey: string, eventId: string): EventOdds => {
  const row = eventsFor(sportKey).find((entry) => entry.event.providerEventId === eventId) ?? eventsFor(sportKey)[0];
  return {
    event: row.event,
    bookmaker: { key: 'dev-fixture', name: 'Dev fixture' },
    markets: row.markets,
    fetchedAt: new Date().toISOString(),
    staleAt: new Date(Date.now() + 3_600_000).toISOString(),
  };
};

const game = (
  id: string, name: string, category: CasinoGame['category'], route: string, thumbnailKey: string,
  featured: boolean, description: string,
): CasinoGame => ({
  id, gameType: id.toUpperCase(), slug: id, name, category, description, route, enabled: true, maintenance: false,
  featured, keywords: [id], minStake: '10', maxStake: '5000', supportsFairness: true, gameVersion: 'fixture',
  thumbnailKey, stateful: false,
});

export const fixtureCasino = (): CasinoGamesResponse => ({
  platform: { casinoMaintenance: false },
  games: [
    game('lucky-lady', "Lucky Lady's Charm Deluxe", 'SLOTS', '/casino/slots/lucky-lady', 'lucky-lady', true, 'Classic five-reel free-play slot.'),
    game('fools-gold-rush', "Fool's Gold Rush", 'SLOTS', '/casino/slots/fools-gold-rush', 'fools-gold-rush', true, 'Gold-rush themed slot.'),
    game('blackjack', 'Blackjack', 'TABLE_GAMES', '/casino/blackjack', 'blackjack', true, 'Beat the dealer to 21.'),
    game('roulette', 'Roulette', 'TABLE_GAMES', '/casino/roulette', 'roulette', false, 'Single-zero wheel.'),
    game('dice', 'Dice', 'ORIGINALS', '/casino/dice', 'dice', true, 'Roll over or under.'),
    game('mines', 'Mines', 'ORIGINALS', '/casino/mines', 'mines', true, 'Avoid the mines.'),
    game('crash', 'Crash', 'ORIGINALS', '/casino/crash', 'crash', false, 'Cash out before the crash.'),
    game('plinko', 'Plinko', 'ORIGINALS', '/casino/plinko', 'plinko', false, 'Drop and bounce.'),
  ],
});

export const fixtureEmptyCasinoList = (): CasinoGamesResponse => ({ games: [] });
