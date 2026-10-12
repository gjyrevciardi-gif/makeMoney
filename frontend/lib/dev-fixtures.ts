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
import type { BoostedOffer, Jackpot, LiveInfo, LiveTable, MatchExtras } from './mobile';
import type { Session, Wallet } from './queries';
import type { BoardEvent, EventOdds, Sport, SportsBoard } from './sports';
import type { TicketBet } from '../components/sports/settled-ticket';

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
  { key: 'horseracing_uk', name: 'UK Racing', group: 'Horse Racing', active: true },
  { key: 'esports_lol', name: 'League of Legends', group: 'Esports', active: true },
  { key: 'golf_masters', name: 'Masters Tournament', group: 'Golf', active: true },
  { key: 'mma_mixed_martial_arts', name: 'UFC', group: 'MMA', active: true },
];

const fixtureEvent = (
  id: string, sportKey: string, competition: string, home: string, away: string,
  start: string, prices: [string, string, string] | [string, string],
  status: 'UPCOMING' | 'STARTED_UNKNOWN' = 'UPCOMING',
): BoardEvent => ({
  event: {
    provider: 'dev-fixture', providerEventId: `fixture-${id}`, sportKey, sportName: competition,
    competitionName: competition, homeTeam: home, awayTeam: away, startTime: start, status,
  },
  bookmaker: { key: 'dev-fixture', name: 'Dev fixture' },
  markets: [{
    key: 'h2h', name: 'Match Result',
    // A two-price tuple is a sport without a draw.
    selections: prices.length === 3
      ? [
        { key: 'home', name: home, price: prices[0] },
        { key: 'draw', name: 'Draw', price: prices[1] },
        { key: 'away', name: away, price: prices[2] },
      ]
      : [
        { key: 'home', name: home, price: prices[0] },
        { key: 'away', name: away, price: prices[1] },
      ],
  }, {
    key: 'totals', name: prices.length === 3 ? 'Total Goals' : 'Total Points',
    selections: [
      { key: 'over-2.5', name: 'Over', price: '1.90', point: '2.5' },
      { key: 'under-2.5', name: 'Under', price: '1.90', point: '2.5' },
      { key: 'over-3.5', name: 'Over', price: '3.10', point: '3.5' },
      { key: 'under-3.5', name: 'Under', price: '1.32', point: '3.5' },
    ],
  }],
});

/** Events that have started, for the phone Live preview. Only the sports named here have any. */
const liveEventsFor = (sportKey: string): BoardEvent[] => {
  const began = at(0, 0, 0);
  switch (sportKey) {
    case 'soccer_epl':
      return [
        fixtureEvent('live-1', sportKey, 'Premier League', 'Liverpool', 'Manchester City', began, ['1.36', '4.80', '9.50'], 'STARTED_UNKNOWN'),
        fixtureEvent('live-2', sportKey, 'Premier League', 'Inter', 'Juventus', began, ['2.40', '2.90', '3.60'], 'STARTED_UNKNOWN'),
        fixtureEvent('live-3', sportKey, 'Eredivisie', 'Ajax', 'PSV', began, ['9.00', '4.10', '1.40'], 'STARTED_UNKNOWN'),
      ];
    case 'tennis_atp':
      return [
        fixtureEvent('live-4', sportKey, 'ATP Masters', 'M. Laurent', 'D. Kovač', began, ['1.62', '2.25'], 'STARTED_UNKNOWN'),
        fixtureEvent('live-5', sportKey, 'ATP Masters', 'S. Reinholt', 'T. Okafor', began, ['3.10', '1.36'], 'STARTED_UNKNOWN'),
      ];
    case 'basketball_nba_preseason':
      return [fixtureEvent('live-6', sportKey, 'NBA Pre-Season', 'Los Angeles Lakers', 'Boston Celtics', began, ['2.40', '1.57'], 'STARTED_UNKNOWN')];
    case 'esports_lol':
      return [fixtureEvent('live-7', sportKey, 'LoL Pro League', 'Northwind', 'Iron Wolves', began, ['1.85', '1.95'], 'STARTED_UNKNOWN')];
    default:
      return [];
  }
};

/**
 * Live prices drift a little every 15 seconds, so the up / down flashes can be
 * previewed. Sample data only, like everything in this file.
 */
const driftPrice = (price: string, seed: string) => {
  const slot = Math.floor(Date.now() / 15_000);
  let hash = 0;
  for (const char of `${seed}:${slot}`) hash = (hash * 31 + char.charCodeAt(0)) % 1000;
  const step = ((hash % 5) - 2) * 0.02;
  return Math.max(1.01, Number(price) + step).toFixed(2);
};

const eventsFor = (sportKey: string): BoardEvent[] => [
  fixtureEvent('1', sportKey, 'UEFA Nations League A', 'Croatia', 'Spain', at(0, 20, 45), ['10.00', '6.50', '1.25']),
  fixtureEvent('2', sportKey, 'UEFA Nations League A', 'England', 'Czechia', at(0, 20, 45), ['1.10', '9.00', '21.00']),
  fixtureEvent('3', sportKey, 'UEFA Nations League A', 'Scotland', 'Greece', at(0, 20, 45), ['1.75', '3.50', '4.75']),
  fixtureEvent('4', sportKey, 'UEFA Nations League B', 'Wales', 'Iceland', at(1, 19, 0), ['2.10', '3.20', '3.40']),
  fixtureEvent('5', sportKey, 'UEFA Nations League B', 'Norway', 'Austria', at(1, 21, 0), ['2.40', '3.30', '2.90']),
  ...liveEventsFor(sportKey).map((row) => ({
    ...row,
    markets: row.markets.map((market) => ({
      ...market,
      selections: market.selections.map((selection) => ({
        ...selection, price: driftPrice(selection.price, `${row.event.providerEventId}:${selection.key}`),
      })),
    })),
  })),
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
    { ...game('lucky-lady', "Lucky Lady's Charm Deluxe", 'SLOTS', '/casino/slots/lucky-lady', 'lucky-lady', true, 'Classic five-reel free-play slot.'), isNew: true, playersNow: 918 },
    { ...game('fools-gold-rush', "Fool's Gold Rush", 'SLOTS', '/casino/slots/fools-gold-rush', 'fools-gold-rush', true, 'Gold-rush themed slot.'), hot: true, playersNow: 2184 },
    game('blackjack', 'Blackjack', 'TABLE_GAMES', '/casino/blackjack', 'blackjack', true, 'Beat the dealer to 21.'),
    game('roulette', 'Roulette', 'TABLE_GAMES', '/casino/roulette', 'roulette', false, 'Single-zero wheel.'),
    { ...game('dice', 'Dice', 'ORIGINALS', '/casino/dice', 'dice', true, 'Roll over or under.'), playersNow: 1560 },
    { ...game('mines', 'Mines', 'ORIGINALS', '/casino/mines', 'mines', true, 'Avoid the mines.'), playersNow: 1207 },
    { ...game('crash', 'Crash', 'ORIGINALS', '/casino/crash', 'crash', false, 'Cash out before the crash.'), hot: true, playersNow: 3402 },
    { ...game('plinko', 'Plinko', 'ORIGINALS', '/casino/plinko', 'plinko', false, 'Drop and bounce.'), isNew: true, playersNow: 744 },
  ],
});

export const fixtureEmptyCasinoList = (): CasinoGamesResponse => ({ games: [] });

/* ---- phone-layout previews (sample data, never shown in production) ---------- */

export const fixtureLiveTables = (): LiveTable[] => [
  { id: 'gold-roulette', name: 'Gold Roulette', stakes: '1 – 5,000 PTS', players: 342, kind: 'roulette', route: '/casino/roulette' },
  { id: 'blackjack-classic', name: 'Blackjack Classic', stakes: '5 – 2,500 PTS', players: 58, note: '2 of 7 seats free', kind: 'blackjack', route: '/casino/blackjack' },
  { id: 'speed-roulette', name: 'Speed Roulette', stakes: '1 – 2,000 PTS', players: 211, note: '25-second rounds', kind: 'roulette', route: '/casino/roulette' },
];

/** What the feed does not report about live events, keyed by the fixture event ids above. */
export const fixtureLiveInfo = (): Record<string, LiveInfo> => ({
  'fixture-live-1': {
    clock: "67'", home: [2], away: [1], stream: true,
    scorers: { home: "12' 38'", away: "54'" },
    tracker: {
      status: 'Dangerous attack · Liverpool', attacking: 'home',
      ball: [[58, 50], [70, 36], [82, 52], [88, 44], [76, 64], [62, 54]],
    },
    possession: { home: 58, away: 42 },
    stats: [
      { name: 'Shots', home: 14, away: 9 },
      { name: 'Shots on target', home: 6, away: 3 },
      { name: 'Corners', home: 7, away: 3 },
      { name: 'Fouls', home: 9, away: 12 },
      { name: 'Yellow cards', home: 1, away: 2 },
      { name: 'Pass accuracy', home: 88, away: 81, suffix: '%' },
    ],
  },
  'fixture-live-2': { clock: "23'", home: [0], away: [0], stream: true },
  'fixture-live-3': { clock: "81'", home: [1], away: [2], goal: 'Goal · PSV' },
  'fixture-live-4': { clock: 'Set 2', home: [1, 4, '40'], away: [0, 5, '30'], serve: 'home', stream: true },
  'fixture-live-5': { clock: 'Set 2', home: [0, 2, '15'], away: [1, 1, '0'], serve: 'away' },
  'fixture-live-6': { clock: 'Q4 06:12', home: [88], away: [91], stream: true },
  'fixture-live-7': { clock: 'Map 2', home: [1, 9], away: [0, 7], stream: true },
});

/** Same-match builder legs and corner markets, which the platform cannot price or place yet. */
export const fixtureMatchExtras = (): MatchExtras => ({
  builder: [
    { id: 'b1', name: 'Home team to win', note: 'Match result', price: '1.36' },
    { id: 'b2', name: 'Over 2.5 goals', note: 'Total goals', price: '1.50' },
    { id: 'b3', name: 'Both teams to score', note: 'Goals', price: '1.72' },
    { id: 'b4', name: 'Over 8.5 corners', note: 'Corners', price: '1.65' },
  ],
  corners: [
    { id: 'c1', name: 'Total corners', note: 'Full time', cols: 2, cells: [{ label: 'Over 9.5', price: '1.90' }, { label: 'Under 9.5', price: '1.90' }] },
    { id: 'c2', name: 'Most corners', note: 'Full time', cols: 3, cells: [{ label: 'Home', price: '1.55' }, { label: 'Tie', price: '7.00' }, { label: 'Away', price: '3.10' }] },
  ],
});

/** Signed-in preview, enabled only by NEXT_PUBLIC_DEV_FIXTURE_SESSION=1 on top of the fixtures flag. */
export const fixtureSession = (): Session => ({
  id: 'fixture-user', username: 'preview.player', email: null, role: 'USER', createdAt: at(-400, 12, 0),
});

export const fixtureWallet = (): Wallet => ({ id: 'fixture-wallet', balance: '124850', createdAt: at(-400, 12, 0) });

const fixtureLeg = (
  id: string, home: string, away: string, market: string, selection: string, odds: string, status: string, startOffset: number,
) => ({
  id, sportKey: 'soccer_epl', homeTeam: home, awayTeam: away, marketName: market, selectionName: selection,
  acceptedOdds: odds, status, eventStartTime: at(startOffset, 19, 45),
});

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

export const fixtureLedger = () => [
  { id: 'led-1', type: 'ADMIN_GRANT', amount: '100000', reason: 'Starting balance', createdAt: hoursAgo(300) },
  { id: 'led-2', type: 'BET_STAKE', amount: '-2000', reason: 'Single, Napoli v Roma', createdAt: hoursAgo(5) },
  { id: 'led-3', type: 'BET_PAYOUT', amount: '4200', reason: 'Bet won', createdAt: hoursAgo(1) },
];

const cashed = new Set<string>();

/** Open cash-out values drift slightly each refresh so the flash can be previewed. */
const driftCash = (value: number, seed: string) => {
  const slot = Math.floor(Date.now() / 20_000);
  let hash = 0;
  for (const char of `${seed}:${slot}`) hash = (hash * 31 + char.charCodeAt(0)) % 1000;
  return String(Math.max(1, value + ((hash % 5) - 2) * 9));
};

const sampleBets = (): TicketBet[] => [
  {
    id: 'fixture-open-1', type: 'ACCUMULATOR', status: 'OPEN', stake: '1000', totalOdds: '6.12', potentialPayout: '6120',
    createdAt: hoursAgo(2), cashOutValue: driftCash(412, 'o1'),
    legs: [
      fixtureLeg('o1a', 'Arsenal', 'Chelsea', 'Match Result', 'Arsenal', '2.10', 'PENDING', 0),
      fixtureLeg('o1b', 'Real Madrid', 'Barcelona', 'Match Result', 'Real Madrid', '2.30', 'PENDING', 0),
      fixtureLeg('o1c', 'Tottenham', 'Newcastle', 'Total Goals', 'Over 2.5', '1.27', 'PENDING', 1),
    ],
  },
  {
    id: 'fixture-open-2', type: 'SINGLE', status: 'OPEN', stake: '2000', totalOdds: '2.10', potentialPayout: '4200',
    createdAt: hoursAgo(6), cashOutValue: driftCash(1380, 'o2'),
    legs: [fixtureLeg('o2a', 'Inter', 'Juventus', 'Match Result', 'Inter', '2.10', 'PENDING', 0)],
  },
  {
    id: 'fixture-open-3', type: 'SINGLE', status: 'OPEN', stake: '500', totalOdds: '1.85', potentialPayout: '925',
    createdAt: hoursAgo(9),
    legs: [fixtureLeg('o3a', 'Aston Villa', 'Brighton', 'Match Result', 'Aston Villa', '1.85', 'PENDING', 1)],
  },
  {
    id: 'fixture-won-1', type: 'SINGLE', status: 'WON', stake: '2000', totalOdds: '2.10', finalOdds: '2.10',
    potentialPayout: '4200', actualPayout: '4200', createdAt: hoursAgo(5), settledAt: hoursAgo(1),
    legs: [fixtureLeg('w1a', 'Napoli', 'Roma', 'Match Result', 'Napoli', '2.10', 'WON', -1)],
  },
  {
    id: 'fixture-lost-1', type: 'ACCUMULATOR', status: 'LOST', stake: '1000', totalOdds: '4.40', finalOdds: '4.40',
    potentialPayout: '4400', actualPayout: '0', createdAt: hoursAgo(30), settledAt: hoursAgo(26),
    legs: [
      fixtureLeg('l1a', 'Everton', 'West Ham', 'Match Result', 'Everton', '2.20', 'WON', -2),
      fixtureLeg('l1b', 'Wolves', 'Fulham', 'Match Result', 'Wolves', '2.00', 'LOST', -2),
    ],
  },
  {
    id: 'fixture-void-1', type: 'SINGLE', status: 'VOID', stake: '500', totalOdds: '1.95', finalOdds: '1.00',
    potentialPayout: '975', actualPayout: '500', createdAt: hoursAgo(50), settledAt: hoursAgo(44),
    legs: [fixtureLeg('v1a', 'Brentford', 'Leeds', 'Match Result', 'Brentford', '1.95', 'VOID', -3)],
  },
];

/** Sample bets for the phone My Bets preview; a cashed-out bet drops out of Open. */
export const fixtureBets = (status: 'OPEN' | 'WON' | 'ALL'): TicketBet[] => {
  const bets = sampleBets().filter((bet) => !(bet.status === 'OPEN' && cashed.has(bet.id)));
  return status === 'ALL' ? bets : bets.filter((bet) => bet.status === status);
};

/** Simulates a cash-out so the confirm flow can be previewed. The real platform has none. */
export const fixtureCashOut = async (betId: string) => {
  await new Promise((resolve) => setTimeout(resolve, 600));
  cashed.add(betId);
};

export const fixtureBoosted = (): BoostedOffer[] => [{
  id: 'boost-1', eventId: 'fixture-live-1', headline: 'Win and 4+ goals', context: 'Liverpool 2–1 Manchester City',
  legs: ['Liverpool to win', 'Over 3.5 goals'], liveLabel: "Live 67'", was: '2.75', now: '3.25', href: '/sports',
}];

export const fixtureJackpot = (): Jackpot => ({
  amount: 1_284_553,
  mustDropBy: 1_500_000,
  playersOnline: 12_408,
  lastWon: 'Last won 3 days ago',
});
