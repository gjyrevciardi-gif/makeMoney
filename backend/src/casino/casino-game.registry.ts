import {
  Injectable,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CasinoGameType, Prisma } from '@prisma/client';
import { casinoConfig, publicGameConfig } from './casino.config';
import {
  FOOLS_GOLD_RUSH_V1,
  slotVersion,
} from './games/slots/slot.definitions';
import { TITANS_TEMPEST_V1, tumbleVersion } from './games/slots/tumble.definition';
import { LUCKY_LADY_V1, luckyLadyVersion } from './games/lucky-lady/lucky-lady.definition';

export const CASINO_CATEGORIES = ['ORIGINALS', 'TABLE_GAMES', 'SLOTS'] as const;
export type CasinoCategory = (typeof CASINO_CATEGORIES)[number];

export const CASINO_GAME_IDS = [
  'dice',
  'mines',
  'roulette',
  'blackjack',
  'crash',
  'plinko',
  'fools-gold-rush',
  'titans-tempest',
  'lucky-lady',
  'book-of-ra-classic',
] as const;
export type CasinoGameId = (typeof CASINO_GAME_IDS)[number];

export type CasinoGameEntry = {
  /** Stable identifier used by preferences, recents, and URLs. */
  id: CasinoGameId;
  /** Kept separately so routing metadata remains explicit and evolvable. */
  slug: string;
  gameType: CasinoGameType;
  name: string;
  category: CasinoCategory;
  description: string;
  route: string;
  enabled: boolean;
  featured: boolean;
  keywords: string[];
  minStake: string;
  maxStake: string;
  stateful: boolean;
  supportsFairness: boolean;
  gameVersion: string;
  thumbnailKey: string;
};

export type CasinoGameFilters = {
  category?: CasinoCategory;
  featured?: boolean;
  search?: string;
};

type GameDefinition = Omit<
  CasinoGameEntry,
  'enabled' | 'minStake' | 'maxStake' | 'gameVersion'
> & {
  envKey: string;
  config: () => Pick<CasinoGameEntry, 'minStake' | 'maxStake' | 'gameVersion'>;
};

type StandardConfigKey = 'dice' | 'mines' | 'roulette' | 'blackjack' | 'crash';

const standardConfig = (key: StandardConfigKey) => () => {
  const config = casinoConfig()[key];
  return {
    minStake: config.minStake.toString(),
    maxStake: config.maxStake.toString(),
    gameVersion: config.version,
  };
};

/**
 * Discovery metadata has exactly one home. Game engines continue to own their
 * mathematical rules; this registry owns safe names, routes, categories, and
 * availability used by both the API and the lobby.
 */
const DEFINITIONS: GameDefinition[] = [
  {id:'book-of-ra-classic',slug:'book-of-ra-classic',gameType:'SLOTS',name:'Book of Ra Classic',category:'SLOTS',description:'Nine paylines, Book scatters and expanding-symbol free games.',route:'/casino/slots/book-of-ra-classic',featured:false,keywords:['book','ra','classic','slots'],stateful:true,supportsFairness:false,thumbnailKey:'book-of-ra-classic',envKey:'CASINO_GAME_BOOK_CLASSIC_ENABLED',config:()=>({minStake:'1',maxStake:'180',gameVersion:'book-of-ra-classic.v1'})},
  {
    id: 'dice',
    slug: 'dice',
    gameType: 'DICE',
    name: 'Dice',
    category: 'ORIGINALS',
    description: 'Pick a target, roll under or over, and take a verifiable result.',
    route: '/casino/dice',
    featured: false,
    keywords: ['dice', 'roll', 'under', 'over', 'original'],
    stateful: false,
    supportsFairness: true,
    thumbnailKey: 'dice',
    envKey: 'CASINO_GAME_DICE_ENABLED',
    config: standardConfig('dice'),
  },
  {
    id: 'mines',
    slug: 'mines',
    gameType: 'MINES',
    name: 'Mines',
    category: 'ORIGINALS',
    description: 'Uncover safe cells and cash out before you hit a mine.',
    route: '/casino/mines',
    featured: true,
    keywords: ['mines', 'mine', 'bomb', 'grid', 'cashout', 'original'],
    stateful: true,
    supportsFairness: true,
    thumbnailKey: 'mines',
    envKey: 'CASINO_GAME_MINES_ENABLED',
    config: standardConfig('mines'),
  },
  {
    id: 'crash',
    slug: 'crash',
    gameType: 'CRASH',
    name: 'Crash',
    category: 'ORIGINALS',
    description: 'Ride the curve and cash out before it crashes. Server clock decides.',
    route: '/casino/crash',
    featured: true,
    keywords: ['crash', 'curve', 'multiplier', 'cashout', 'original'],
    stateful: true,
    supportsFairness: true,
    thumbnailKey: 'crash',
    envKey: 'CASINO_GAME_CRASH_ENABLED',
    config: standardConfig('crash'),
  },
  {
    id: 'plinko',
    slug: 'plinko',
    gameType: 'PLINKO',
    name: 'Plinko',
    category: 'ORIGINALS',
    description: 'Drop a ball through the pegs onto a published paytable.',
    route: '/casino/plinko',
    featured: false,
    keywords: ['plinko', 'ball', 'peg', 'drop', 'risk', 'original'],
    stateful: false,
    supportsFairness: true,
    thumbnailKey: 'plinko',
    envKey: 'CASINO_GAME_PLINKO_ENABLED',
    config: () => {
      const config = casinoConfig().plinko;
      return {
        minStake: config.minStake.toString(),
        maxStake: config.maxStake.toString(),
        // Individual boards append rows/risk/RTP to this family version.
        gameVersion: `plinko.v${config.mathVersion}`,
      };
    },
  },
  {
    id: 'roulette',
    slug: 'roulette',
    gameType: 'ROULETTE',
    name: 'European Roulette',
    category: 'TABLE_GAMES',
    description: 'Single-zero wheel with canonical payouts. Back several bets on one spin.',
    route: '/casino/roulette',
    featured: false,
    keywords: ['roulette', 'wheel', 'table', 'number', 'red', 'black'],
    stateful: false,
    supportsFairness: true,
    thumbnailKey: 'roulette',
    envKey: 'CASINO_GAME_ROULETTE_ENABLED',
    config: standardConfig('roulette'),
  },
  {
    id: 'blackjack',
    slug: 'blackjack',
    gameType: 'BLACKJACK',
    name: 'Blackjack',
    category: 'TABLE_GAMES',
    description: 'Six decks, dealer stands on all 17s, blackjack pays 3:2.',
    route: '/casino/blackjack',
    featured: false,
    keywords: ['blackjack', 'black', 'cards', 'twenty one', '21', 'table'],
    stateful: true,
    supportsFairness: true,
    thumbnailKey: 'blackjack',
    envKey: 'CASINO_GAME_BLACKJACK_ENABLED',
    config: standardConfig('blackjack'),
  },
  {
    id: 'fools-gold-rush',
    slug: 'fools-gold-rush',
    gameType: 'SLOTS',
    name: "Fool's Gold Rush",
    category: 'SLOTS',
    description: '5 reels, 20 fixed lines, wilds and dynamite scatters.',
    route: '/casino/slots/fools-gold-rush',
    featured: true,
    keywords: ['fools gold rush', 'gold', 'mine', 'slot', 'slots', 'reels', 'scatter', 'wild'],
    stateful: false,
    supportsFairness: true,
    thumbnailKey: 'fools-gold-rush',
    envKey: 'CASINO_GAME_FOOLS_GOLD_RUSH_ENABLED',
    config: () => {
      const config = casinoConfig();
      const minimum = BigInt(FOOLS_GOLD_RUSH_V1.paylines.length);
      return {
        minStake: (config.minStake > minimum ? config.minStake : minimum).toString(),
        maxStake: config.maxStake.toString(),
        gameVersion: slotVersion(FOOLS_GOLD_RUSH_V1),
      };
    },
  },
  {
    id: 'titans-tempest',
    slug: 'titans-tempest',
    gameType: 'SLOTS',
    name: 'Titan’s Tempest',
    category: 'SLOTS',
    description: '6x5 pays anywhere, tumbling wins, storm orbs and free spins.',
    route: '/casino/slots/titans-tempest',
    featured: true,
    keywords: [
      'titans tempest', 'titan', 'tempest', 'storm', 'olympus', 'zeus', 'temple', 'myth',
      'slot', 'slots', 'tumble', 'cascade', 'scatter', 'multiplier', 'free spins',
    ],
    stateful: false,
    supportsFairness: true,
    thumbnailKey: 'titans-tempest',
    envKey: 'CASINO_GAME_TITANS_TEMPEST_ENABLED',
    config: () => {
      const config = casinoConfig();
      return {
        minStake: config.minStake.toString(),
        maxStake: config.maxStake.toString(),
        gameVersion: tumbleVersion(TITANS_TEMPEST_V1),
      };
    },
  },
  {
    id: 'lucky-lady',
    slug: 'lucky-lady',
    gameType: 'SLOTS',
    name: "Lucky Lady's Charm Deluxe",
    category: 'SLOTS',
    description: 'Imported Novomatic/Greentube 10-line classic with a red/black gamble and 15 free games.',
    route: '/casino/slots/lucky-lady',
    featured: true,
    keywords: [
      'lucky lady', 'lucky ladys charm', 'lady', 'charm', 'imported', 'slot', 'slots',
      'gamble', 'free spins', 'free games', 'scatter', 'wild', 'deluxe', 'novomatic', 'greentube',
    ],
    // The recovered client is served from its own loopback origin, so the
    // launch route is a platform page rather than an in-app board.
    stateful: true,
    // Outcomes come from the platform CSPRNG through the accepted evaluator.
    // The generic commit/reveal verifier does not reproduce this game's draws,
    // so the registry must not advertise that guarantee for it.
    supportsFairness: false,
    thumbnailKey: 'lucky-lady',
    envKey: 'CASINO_GAME_LUCKY_LADY_ENABLED',
    config: () => ({
      // Ten lines are always active, so the registry publishes the total
      // stake range the native 1/2/5/10/20 per-line ladder produces.
      minStake: LUCKY_LADY_V1.minStake.toString(),
      maxStake: LUCKY_LADY_V1.maxStake.toString(),
      gameVersion: luckyLadyVersion(),
    }),
  },
];

function enabledFromEnvironment(key: string) {
  const value = process.env[key];
  if (value === undefined) return true;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase().replace(/[_\s]+/g, ' ');
}

/**
 * Ids, slugs and routes stay unique; game *types* deliberately do not. A type
 * is a settlement category, and two slots with completely different mathematics
 * both settle as SLOTS. Every lookup that needs one specific game therefore
 * goes through the id, which is also what a slot round records in its state.
 */
export function validateCasinoGameEntries(games: CasinoGameEntry[]) {
  if (games.length !== CASINO_GAME_IDS.length) {
    throw new Error(`Casino registry must contain exactly ${CASINO_GAME_IDS.length} games.`);
  }

  const ids = new Set<string>();
  const slugs = new Set<string>();
  const routes = new Set<string>();
  const knownGameTypes = new Set(Object.values(CasinoGameType));
  for (const game of games) {
    if (!CASINO_GAME_IDS.includes(game.id)) throw new Error(`Unknown casino game id: ${game.id}`);
    if (!CASINO_CATEGORIES.includes(game.category)) throw new Error(`Invalid category for ${game.id}.`);
    if (!knownGameTypes.has(game.gameType)) throw new Error(`Invalid game type for ${game.id}.`);
    if (!game.name.trim() || !game.description.trim()) throw new Error(`Missing metadata for ${game.id}.`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(game.slug)) throw new Error(`Invalid slug for ${game.id}.`);
    if (!/^\/[a-z0-9/-]+$/.test(game.route)) throw new Error(`Invalid route for ${game.id}.`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(game.thumbnailKey)) {
      throw new Error(`Invalid thumbnail key for ${game.id}.`);
    }
    if (!/^[a-z0-9][a-z0-9.-]{1,119}$/.test(game.gameVersion)) {
      throw new Error(`Invalid game version for ${game.id}.`);
    }
    if (typeof game.enabled !== 'boolean'
      || typeof game.featured !== 'boolean'
      || typeof game.stateful !== 'boolean'
      || typeof game.supportsFairness !== 'boolean') {
      throw new Error(`Invalid boolean metadata for ${game.id}.`);
    }
    if (!Array.isArray(game.keywords)
      || game.keywords.length === 0
      || game.keywords.some((keyword) => typeof keyword !== 'string'
        || !keyword.trim()
        || keyword.length > 64)) {
      throw new Error(`Invalid keywords for ${game.id}.`);
    }
    if (ids.has(game.id)) throw new Error(`Duplicate casino game id: ${game.id}`);
    if (slugs.has(game.slug)) throw new Error(`Duplicate casino game slug: ${game.slug}`);
    if (routes.has(game.route)) throw new Error(`Duplicate casino game route: ${game.route}`);
    if (!/^\d+$/.test(game.minStake) || !/^\d+$/.test(game.maxStake)) {
      throw new Error(`Invalid stake metadata for ${game.id}.`);
    }
    if (BigInt(game.minStake) < 1n || BigInt(game.maxStake) < BigInt(game.minStake)) {
      throw new Error(`Invalid stake range for ${game.id}.`);
    }
    ids.add(game.id);
    slugs.add(game.slug);
    routes.add(game.route);
  }

  for (const expectedId of CASINO_GAME_IDS) {
    if (!ids.has(expectedId)) throw new Error(`Casino registry is missing ${expectedId}.`);
  }
}

@Injectable()
export class CasinoGameRegistry implements OnModuleInit {
  onModuleInit() {
    validateCasinoGameEntries(this.list());
  }

  list(filters: CasinoGameFilters = {}): CasinoGameEntry[] {
    const search = filters.search === undefined ? '' : normalizeSearch(filters.search);
    return DEFINITIONS
      .map(({ envKey, config, ...definition }) => ({
        ...definition,
        ...config(),
        enabled: enabledFromEnvironment(envKey),
        keywords: [...definition.keywords],
      }))
      .filter((game) => filters.category === undefined || game.category === filters.category)
      .filter((game) => filters.featured === undefined || game.featured === filters.featured)
      .filter((game) => {
        if (!search) return true;
        const category = normalizeSearch(game.category);
        const haystack = normalizeSearch([
          game.id,
          game.name,
          game.description,
          category,
          ...game.keywords,
        ].join(' '));
        return haystack.includes(search);
      });
  }

  /**
   * The first game of a type. A type is no longer one-to-one with a game -
   * SLOTS backs both slot families - so anything that must name a specific slot
   * resolves it by id, or from the round's own public state, never from here.
   */
  find(gameType: CasinoGameType) {
    return this.list().find((game) => game.gameType === gameType);
  }

  findById(gameId: string) {
    return this.list().find((game) => game.id === gameId);
  }

  require(gameId: string) {
    const game = this.findById(gameId);
    if (!game) {
      throw new NotFoundException({
        code: 'CASINO_GAME_NOT_FOUND',
        message: 'That casino game does not exist.',
      });
    }
    return game;
  }

  enabled(game: CasinoGameType | string) {
    const entry = CASINO_GAME_IDS.includes(game as CasinoGameId)
      ? this.findById(game)
      : this.find(game as CasinoGameType);
    return entry?.enabled === true;
  }

  assertEnabled(gameId: string) {
    const game = this.require(gameId);
    if (!game.enabled) {
      throw new ServiceUnavailableException({
        code: 'CASINO_GAME_DISABLED',
        message: 'This casino game is currently unavailable.',
      });
    }
    return game;
  }

  /** Derives the stable registry ID stored in a round's public state. */
  gameIdForRound(gameType: CasinoGameType, publicState: Prisma.JsonValue): CasinoGameId | null {
    if (gameType === 'SLOTS') {
      const state = publicState && typeof publicState === 'object' && !Array.isArray(publicState)
        ? publicState as Prisma.JsonObject
        : null;
      const gameId = state?.gameId;
      return typeof gameId === 'string' && this.findById(gameId) ? gameId as CasinoGameId : null;
    }
    return this.find(gameType)?.id ?? null;
  }

  /** Public math/config for one game type, without any seed or hidden state. */
  config(gameType: CasinoGameType) {
    const config = casinoConfig();
    if (gameType === 'DICE') return publicGameConfig(config.dice);
    if (gameType === 'MINES') return publicGameConfig(config.mines);
    if (gameType === 'ROULETTE') return publicGameConfig(config.roulette);
    if (gameType === 'CRASH') return publicGameConfig(config.crash);
    return null;
  }
}
