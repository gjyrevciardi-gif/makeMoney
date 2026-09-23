import {
  BOOK_OF_RA_GAME,
  BOOK_OF_RA_PAYTABLE,
  BOOK_OF_RA_PROFILE,
  BOOK_OF_RA_PROFILE_ID,
  BOOK_OF_RA_SCATTER_PAYS,
  validateBookOfRaProfile,
} from '@slot-skills/math';
import type { GameConfig } from '@slot-skills/schema';

/**
 * Platform-facing identity and published rules for Book of the Sands.
 *
 * The engine's own game id (`book-of-the-sands`) is kept as the configuration
 * id, while the lobby, registry and routes use the shorter `book-of-ra` id the
 * platform already reserves for this cabinet. The mathematics itself is not
 * defined here: it is imported from the frozen profile in `@slot-skills/math`,
 * which is also what the platform adapter hands to the runtime engine.
 */

/** Registry id used by the lobby, favourites and routes. */
export const BOOK_GAME_ID = 'book-of-ra';
/** The engine configuration id carried inside `@slot-skills/math`. */
export const BOOK_ENGINE_GAME_ID = BOOK_OF_RA_PROFILE.gameId;
/** Immutable profile identity, recorded on every round this adapter opens. */
export const BOOK_PROFILE_ID = BOOK_OF_RA_PROFILE_ID;
/** Content fingerprint of the mathematics the round was played under. */
export const BOOK_PROFILE_FINGERPRINT = BOOK_OF_RA_PROFILE.fingerprint;
export const BOOK_ACTIVE_LINES = BOOK_OF_RA_PROFILE.activeLines;
export const BOOK_MAX_GAMBLE_ATTEMPTS = BOOK_OF_RA_PROFILE.maxGambleAttempts;
export const BOOK_FREE_SPINS = BOOK_OF_RA_PROFILE.freeSpins;
export const BOOK_RETRIGGER_SPINS = BOOK_OF_RA_PROFILE.retriggerSpins;
/** Recorded as `CasinoRound.gameVersion`; a maths change must produce a new one. */
export const BOOK_GAME_VERSION = BOOK_OF_RA_PROFILE_ID;
/** The frozen engine configuration. Never mutated at runtime. */
export const BOOK_GAME: GameConfig = BOOK_OF_RA_GAME;

export class BookOfRaDefinitionError extends Error {}

/**
 * Fail-fast validation of the published profile.
 *
 * Runs at startup instead of at the first spin: a profile whose paytable,
 * paylines or feature configuration disagrees with the published game is a
 * mathematics bug, not a runtime condition.
 */
export function validateBookOfRaEngine(): void {
  validateBookOfRaProfile(BOOK_GAME);
  if (BOOK_OF_RA_PROFILE.activeLines !== BOOK_OF_RA_PROFILE.reels * 2) {
    throw new BookOfRaDefinitionError('Book of the Sands publishes ten lines for five reels');
  }
  if (BOOK_OF_RA_PROFILE.fingerprint.length !== 64) {
    throw new BookOfRaDefinitionError('The profile fingerprint must be a sha256 hex digest');
  }
}

/**
 * Public rules for the lobby and the game shell.
 *
 * It contains the paytable, the paylines, the feature rules and the profile
 * fingerprint, and nothing that could be used to predict or reproduce a future
 * outcome. The published return is a measured figure, labelled as such.
 */
export function publicBookOfRaConfig(limits: { minStake: bigint; maxStake: bigint }) {
  const lines = BigInt(BOOK_ACTIVE_LINES);
  const configuredMinimum = (limits.minStake + lines - 1n) / lines;
  const perLineMinimum = configuredMinimum > 1n ? configuredMinimum : 1n;
  return {
    gameId: BOOK_GAME_ID,
    name: 'Book of the Sands',
    description: 'Five reels, ten lines, and a Book that pays anywhere and opens ten free games.',
    version: BOOK_OF_RA_PROFILE_ID,
    profileId: BOOK_OF_RA_PROFILE_ID,
    profileFingerprint: BOOK_PROFILE_FINGERPRINT,
    reels: BOOK_OF_RA_PROFILE.reels,
    rows: BOOK_OF_RA_PROFILE.rows,
    paylineCount: BOOK_OF_RA_PROFILE.activeLines,
    paylines: BOOK_GAME.math.paylines,
    symbols: BOOK_GAME.symbols,
    paytable: BOOK_OF_RA_PAYTABLE,
    scatter: BOOK_OF_RA_SCATTER_PAYS,
    freeSpins: {
      trigger: 3,
      award: BOOK_OF_RA_PROFILE.freeSpins,
      retrigger: BOOK_OF_RA_PROFILE.retriggerSpins,
      retriggerTrigger: 3,
    },
    expansion: {
      highSymbolReels: 2,
      lowSymbolReels: 3,
      adjacentRequired: false,
      paysOncePerSpin: true,
      wildSymbolCanExpand: false,
    },
    gamble: {
      choices: ['red', 'black', 'collect'],
      maxAttempts: BOOK_OF_RA_PROFILE.maxGambleAttempts,
      doublesOnWin: true,
      zeroesOnLoss: true,
      availableDuringAutoplay: false,
    },
    rtpBps: BOOK_OF_RA_PROFILE.declaredRtpBps,
    rtpPercent: (BOOK_OF_RA_PROFILE.declaredRtpBps / 100).toFixed(2),
    rtpBasis: 'simulated',
    houseEdgeBps: 10_000 - BOOK_OF_RA_PROFILE.declaredRtpBps,
    minBetPerLine: perLineMinimum.toString(),
    maxBetPerLine: (limits.maxStake / BigInt(BOOK_OF_RA_PROFILE.activeLines)).toString(),
    minTotalBet: (perLineMinimum * BigInt(BOOK_OF_RA_PROFILE.activeLines)).toString(),
    maxTotalBet: (limits.maxStake / BigInt(BOOK_OF_RA_PROFILE.activeLines) * BigInt(BOOK_OF_RA_PROFILE.activeLines)).toString(),
    symbolWeights: BOOK_OF_RA_PROFILE.symbolWeights,
    rules: {
      paylines: 'Ten fixed lines, always active. A line pays left to right from reel one.',
      linePayoutBasis: 'Paytable multipliers apply to the bet per line.',
      wild: 'The Book substitutes for every paying symbol and never expands.',
      scatter: 'Three, four or five Books anywhere pay 2x, 20x or 200x the total bet.',
      freeGames:
        'Three or more Books award ten free games with the bet per line, total bet and line count locked.',
      expandingSymbol:
        'One non-Book symbol is drawn for the whole feature. It fills every reel it lands on; two reels pay for high symbols, three for honour cards, and every qualifying reel is paid exactly once per spin.',
      retrigger: 'Three or more Books during the free games add ten more games and never change the expanding symbol.',
      gamble: 'An eligible paid win may be risked on red or black, up to five times. A loss ends the gamble with nothing; collect settles the current amount.',
      autoplay: 'Autoplay never offers the gamble.',
    },
  };
}
