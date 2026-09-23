import { casinoConfig } from './casino.config';
import { CasinoGameId } from './casino-game.registry';
import { GameConfigCandidate, RtpControl } from './casino-config.types';
import { PLINKO_RISKS, PLINKO_ROWS, plinkoTheoreticalRtpBps } from './games/plinko/plinko.engine';
import {
  FOOLS_GOLD_RUSH_PROFILES,
  slotProfile,
  slotVersion,
} from './games/slots/slot.definitions';
import { analyseSlotRtp } from './games/slots/slot.rtp';
import { TITANS_TEMPEST_V1, tumbleVersion } from './games/slots/tumble.definition';
import {
  BOOK_ACTIVE_LINES,
  BOOK_GAME_VERSION,
  BOOK_PROFILE_FINGERPRINT,
  validateBookOfRaEngine,
} from './games/book-of-ra/book-of-ra.definition';

/**
 * The code-level baseline for every game, and the rules for what an operator
 * may legitimately change.
 *
 * The seeded first version of each game reuses the exact label the engines
 * already produced, so rounds settled before this system existed keep matching
 * their configuration and stay verifiable.
 */

/** Platform-wide bounds, matching the range the game engines already enforce. */
export const MIN_RTP_BPS = 5_000;
export const MAX_RTP_BPS = 9_950;

export type GameConfigSpec = {
  gameId: CasinoGameId;
  rtpControl: RtpControl;
  /** Baseline candidate plus the label the engines currently emit. */
  baseline: () => GameConfigCandidate & { label: string };
  /** Builds the deterministic label for a candidate at a given version number. */
  label: (candidate: GameConfigCandidate, version: number) => string;
  /** Throws `CasinoConfigError` when the candidate is not mathematically valid. */
  validate: (candidate: GameConfigCandidate) => void;
};

const fail = (code: string, message: string) => {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  throw error;
};

function assertRtpRange(rtpBps: number | null) {
  if (rtpBps === null) fail('RTP_REQUIRED', 'This game requires an RTP value.');
  if (!Number.isInteger(rtpBps!) || rtpBps! < MIN_RTP_BPS || rtpBps! > MAX_RTP_BPS) {
    fail(
      'RTP_OUT_OF_RANGE',
      `RTP must be an integer between ${MIN_RTP_BPS} and ${MAX_RTP_BPS} basis points.`,
    );
  }
}

const numberList = (value: unknown): number[] | null =>
  Array.isArray(value) && value.every((entry) => Number.isInteger(entry))
    ? (value as number[])
    : null;

export const GAME_CONFIG_SPECS: Record<CasinoGameId, GameConfigSpec> = {
  dice: {
    gameId: 'dice',
    rtpControl: 'DIRECT',
    baseline: () => {
      const config = casinoConfig().dice;
      return {
        minStake: config.minStake,
        maxStake: config.maxStake,
        rtpBps: config.rtpBps,
        gameSpecific: {},
        label: config.version,
      };
    },
    label: (candidate, version) => `dice.v${version}.rtp${candidate.rtpBps}`,
    validate: (candidate) => {
      assertRtpRange(candidate.rtpBps);
    },
  },

  mines: {
    gameId: 'mines',
    rtpControl: 'DIRECT',
    baseline: () => {
      const config = casinoConfig().mines;
      return {
        minStake: config.minStake,
        maxStake: config.maxStake,
        rtpBps: config.rtpBps,
        gameSpecific: {
          allowedMines: Array.from(
            { length: config.maxMines - config.minMines + 1 },
            (_, index) => config.minMines + index,
          ),
        },
        label: config.version,
      };
    },
    label: (candidate, version) => `mines.v${version}.rtp${candidate.rtpBps}`,
    validate: (candidate) => {
      assertRtpRange(candidate.rtpBps);
      const allowed = numberList(candidate.gameSpecific.allowedMines);
      if (!allowed || allowed.length === 0) {
        fail('INVALID_MINE_COUNTS', 'allowedMines must be a non-empty list of integers.');
      }
      const cells = casinoConfig().mines.cells;
      for (const mines of allowed!) {
        if (mines < 1 || mines > cells - 1) {
          fail('INVALID_MINE_COUNTS', `Mine counts must be between 1 and ${cells - 1}.`);
        }
      }
      if (new Set(allowed!).size !== allowed!.length) {
        fail('INVALID_MINE_COUNTS', 'allowedMines must not repeat a value.');
      }
    },
  },

  crash: {
    gameId: 'crash',
    rtpControl: 'DIRECT',
    baseline: () => {
      const config = casinoConfig().crash;
      return {
        minStake: config.minStake,
        maxStake: config.maxStake,
        rtpBps: config.rtpBps,
        gameSpecific: {
          maxMultiplierCenti: config.maxMultiplierCenti,
          minAutoCashoutCenti: config.minAutoCashoutCenti,
          maxAutoCashoutCenti: config.maxAutoCashoutCenti,
        },
        label: config.version,
      };
    },
    label: (candidate, version) => `crash.v${version}.rtp${candidate.rtpBps}`,
    validate: (candidate) => {
      assertRtpRange(candidate.rtpBps);
      const max = candidate.gameSpecific.maxMultiplierCenti;
      const autoMin = candidate.gameSpecific.minAutoCashoutCenti;
      const autoMax = candidate.gameSpecific.maxAutoCashoutCenti;
      for (const [name, value] of Object.entries({ max, autoMin, autoMax })) {
        if (!Number.isInteger(value)) fail('INVALID_CRASH_CONFIG', `${name} must be an integer.`);
      }
      // The curve starts at 1.00x, so a cap at or below it would make every
      // round an instant bust regardless of the seed.
      if ((max as number) <= 100) {
        fail('INVALID_CRASH_CONFIG', 'The maximum multiplier must exceed 1.00x.');
      }
      if ((max as number) > 100_000_000) {
        fail('INVALID_CRASH_CONFIG', 'The maximum multiplier is above the safe ceiling.');
      }
      if ((autoMin as number) <= 100) {
        fail('INVALID_CRASH_CONFIG', 'Auto cashout must be above 1.00x to be winnable.');
      }
      if ((autoMax as number) < (autoMin as number)) {
        fail('INVALID_CRASH_CONFIG', 'Auto cashout maximum must not be below the minimum.');
      }
      if ((autoMax as number) > (max as number)) {
        fail('INVALID_CRASH_CONFIG', 'Auto cashout cannot exceed the multiplier cap.');
      }
    },
  },

  plinko: {
    gameId: 'plinko',
    rtpControl: 'PROFILE',
    baseline: () => {
      const config = casinoConfig().plinko;
      return {
        minStake: config.minStake,
        maxStake: config.maxStake,
        // Plinko has one RTP per board, so the game-level dial stays null and
        // the per-board exact values are published instead.
        rtpBps: null,
        gameSpecific: { profile: 'V1' },
        label: `plinko.profile.v${config.mathVersion}`,
      };
    },
    label: (candidate, version) => `plinko.profile.v${version}.${candidate.gameSpecific.profile}`,
    validate: (candidate) => {
      if (candidate.gameSpecific.profile !== 'V1') {
        fail('UNKNOWN_PLINKO_PROFILE', 'Only the approved V1 paytable profile exists.');
      }
      // Re-derive every board's exact RTP from its frozen table and confirm it
      // still sits inside the platform bounds before the profile can be used.
      for (const rows of PLINKO_ROWS) {
        for (const risk of PLINKO_RISKS) {
          const bps = plinkoTheoreticalRtpBps(rows, risk);
          if (bps < MIN_RTP_BPS || bps > MAX_RTP_BPS) {
            fail(
              'INVALID_PLINKO_PROFILE',
              `Plinko ${rows}/${risk} computes ${bps}bps, outside the platform bounds.`,
            );
          }
        }
      }
    },
  },

  roulette: {
    gameId: 'roulette',
    rtpControl: 'CANONICAL',
    baseline: () => {
      const config = casinoConfig().roulette;
      return {
        minStake: config.minStake,
        maxStake: config.maxStake,
        rtpBps: config.rtpBps,
        gameSpecific: { pockets: config.pockets, maxBetsPerSpin: config.maxBetsPerSpin },
        label: config.version,
      };
    },
    label: (_candidate, version) => `roulette.v${version}.rtp${casinoConfig().roulette.rtpBps}`,
    validate: (candidate) => {
      // The single-zero wheel is the game. An operator may change limits and
      // availability, never the pocket distribution or its canonical return.
      const canonical = casinoConfig().roulette;
      if (candidate.rtpBps !== canonical.rtpBps) {
        fail(
          'ROULETTE_RTP_IS_CANONICAL',
          'European roulette pays 36/37 by its own rules; its return cannot be dialled.',
        );
      }
      if (candidate.gameSpecific.pockets !== canonical.pockets) {
        fail('ROULETTE_WHEEL_IS_FIXED', 'The single-zero wheel cannot be altered.');
      }
    },
  },

  blackjack: {
    gameId: 'blackjack',
    rtpControl: 'RULE_BASED',
    baseline: () => {
      const config = casinoConfig().blackjack;
      return {
        minStake: config.minStake,
        maxStake: config.maxStake,
        rtpBps: null,
        gameSpecific: {
          decks: config.decks,
          dealerStandsOnSoft17: config.dealerStandsOnSoft17,
          blackjackPayoutNumerator: config.blackjackPayoutNumerator,
          blackjackPayoutDenominator: config.blackjackPayoutDenominator,
          doubleDownEnabled: config.doubleDownEnabled,
        },
        label: config.version,
      };
    },
    label: (candidate, version) => {
      const decks = candidate.gameSpecific.decks;
      const stand = candidate.gameSpecific.dealerStandsOnSoft17 ? 's17' : 'h17';
      const numerator = candidate.gameSpecific.blackjackPayoutNumerator;
      const denominator = candidate.gameSpecific.blackjackPayoutDenominator;
      return `blackjack.v${version}.${decks}d.${stand}.bj${numerator}-${denominator}`;
    },
    validate: (candidate) => {
      if (candidate.rtpBps !== null) {
        fail(
          'BLACKJACK_RTP_IS_RULE_BASED',
          'Blackjack return depends on player decisions; configure its rules instead.',
        );
      }
      const decks = candidate.gameSpecific.decks;
      if (!Number.isInteger(decks) || (decks as number) < 1 || (decks as number) > 8) {
        fail('INVALID_BLACKJACK_RULES', 'Deck count must be between 1 and 8.');
      }
      if (typeof candidate.gameSpecific.dealerStandsOnSoft17 !== 'boolean') {
        fail('INVALID_BLACKJACK_RULES', 'dealerStandsOnSoft17 must be a boolean.');
      }
      if (typeof candidate.gameSpecific.doubleDownEnabled !== 'boolean') {
        fail('INVALID_BLACKJACK_RULES', 'doubleDownEnabled must be a boolean.');
      }
      const numerator = candidate.gameSpecific.blackjackPayoutNumerator;
      const denominator = candidate.gameSpecific.blackjackPayoutDenominator;
      if (!Number.isInteger(numerator) || !Number.isInteger(denominator)) {
        fail('INVALID_BLACKJACK_RULES', 'The blackjack payout must be a whole ratio.');
      }
      if ((denominator as number) < 1 || (numerator as number) < 1) {
        fail('INVALID_BLACKJACK_RULES', 'The blackjack payout ratio must be positive.');
      }
      // A natural must beat an ordinary win, otherwise the rule is meaningless.
      if ((numerator as number) / (denominator as number) < 1) {
        fail('INVALID_BLACKJACK_RULES', 'A natural must pay at least even money.');
      }
      if ((numerator as number) / (denominator as number) > 3) {
        fail('INVALID_BLACKJACK_RULES', 'The blackjack payout is above the safe ceiling.');
      }
    },
  },

  'fools-gold-rush': {
    gameId: 'fools-gold-rush',
    rtpControl: 'PROFILE',
    baseline: () => {
      const definition = FOOLS_GOLD_RUSH_PROFILES.STANDARD;
      const config = casinoConfig();
      const minimum = BigInt(definition.paylines.length);
      return {
        minStake: config.minStake > minimum ? config.minStake : minimum,
        maxStake: config.maxStake,
        rtpBps: definition.declaredRtpBps,
        gameSpecific: { profile: 'STANDARD' },
        label: slotVersion(definition),
      };
    },
    label: (candidate) => slotVersion(
      slotProfile('fools-gold-rush', candidate.gameSpecific.profile as string),
    ),
    validate: (candidate) => {
      const name = candidate.gameSpecific.profile;
      if (typeof name !== 'string' || !FOOLS_GOLD_RUSH_PROFILES[name]) {
        fail(
          'UNKNOWN_SLOT_PROFILE',
          `Profile must be one of ${Object.keys(FOOLS_GOLD_RUSH_PROFILES).join(', ')}.`,
        );
      }
      const definition = FOOLS_GOLD_RUSH_PROFILES[name as string];
      // The profile's declared return must equal what the exact calculator
      // derives from its own strips and paytable, or it cannot be activated.
      const analysis = analyseSlotRtp(definition);
      if (analysis.rtpBps !== definition.declaredRtpBps) {
        fail(
          'SLOT_PROFILE_RTP_MISMATCH',
          `Profile ${name} declares ${definition.declaredRtpBps}bps but computes ${analysis.rtpBps}bps.`,
        );
      }
      if (analysis.rtpBps < MIN_RTP_BPS || analysis.rtpBps > MAX_RTP_BPS) {
        fail('RTP_OUT_OF_RANGE', `Profile ${name} is outside the platform bounds.`);
      }
      if (candidate.rtpBps !== null && candidate.rtpBps !== analysis.rtpBps) {
        fail(
          'SLOT_PROFILE_RTP_MISMATCH',
          'The submitted RTP does not match the profile it names.',
        );
      }
      const minimum = BigInt(definition.paylines.length);
      if (candidate.minStake < minimum) {
        fail(
          'STAKE_BELOW_LINE_MINIMUM',
          `Minimum stake must cover one point per payline (${minimum}).`,
        );
      }
    },
  },

  'titans-tempest': {
    gameId: 'titans-tempest',
    rtpControl: 'CANONICAL',
    baseline: () => {
      const config = casinoConfig();
      return {
        minStake: config.minStake,
        maxStake: config.maxStake,
        rtpBps: TITANS_TEMPEST_V1.declaredRtpBps,
        gameSpecific: {},
        label: tumbleVersion(TITANS_TEMPEST_V1),
      };
    },
    // The mathematics is frozen in the definition, so the label never varies:
    // an operator moves the stake limits and availability, never the return.
    label: () => tumbleVersion(TITANS_TEMPEST_V1),
    validate: (candidate) => {
      if (candidate.rtpBps !== null && candidate.rtpBps !== TITANS_TEMPEST_V1.declaredRtpBps) {
        fail(
          'RTP_NOT_ADJUSTABLE',
          'This game’s return is fixed by its published mathematics and cannot be dialled.',
        );
      }
      if (Object.keys(candidate.gameSpecific).length > 0) {
        fail('UNKNOWN_SLOT_PROFILE', 'This game has no selectable profiles.');
      }
      // Buying the feature debits its published price, so the ceiling has to
      // leave room for at least one buyable bet or the button is dead on arrival.
      const price = BigInt(TITANS_TEMPEST_V1.buyFeatureCenti);
      if ((candidate.maxStake * 100n) / price < candidate.minStake) {
        fail(
          'STAKE_RANGE_TOO_NARROW',
          'The maximum stake must cover the feature price of at least the minimum bet.',
        );
      }
    },
  },

  'book-of-ra': {
    gameId: 'book-of-ra',
    // The return is fixed by the published profile. An operator moves the stake
    // limits and availability, never the mathematics.
    rtpControl: 'CANONICAL',
    baseline: () => {
      const config = casinoConfig();
      const minimum = BigInt(BOOK_ACTIVE_LINES);
      return {
        minStake: config.minStake > minimum ? config.minStake : minimum,
        maxStake: config.maxStake,
        rtpBps: 5_000,
        gameSpecific: { profile: BOOK_GAME_VERSION, profileFingerprint: BOOK_PROFILE_FINGERPRINT },
        label: BOOK_GAME_VERSION,
      };
    },
    // Configuration versions need unique labels even when the math stays fixed.
    label: (_candidate, version) => version === 1 ? BOOK_GAME_VERSION : `${BOOK_GAME_VERSION}.config${version}`,
    validate: (candidate) => {
      validateBookOfRaEngine();
      if (candidate.rtpBps !== null && candidate.rtpBps !== 5_000) {
        fail(
          'RTP_NOT_ADJUSTABLE',
          'This game\'s return is fixed by its published mathematics and cannot be dialled.',
        );
      }
      const profile = candidate.gameSpecific.profile;
      if (profile !== undefined && profile !== BOOK_GAME_VERSION) {
        fail('UNKNOWN_BOOK_OF_RA_PROFILE', `Only the ${BOOK_GAME_VERSION} profile exists.`);
      }
      const fingerprint = candidate.gameSpecific.profileFingerprint;
      if (fingerprint !== undefined && fingerprint !== BOOK_PROFILE_FINGERPRINT) {
        fail('BOOK_OF_RA_PROFILE_MISMATCH', 'The submitted profile fingerprint is not the active one.');
      }
      const minimum = BigInt(BOOK_ACTIVE_LINES);
      if (candidate.minStake < minimum) {
        fail(
          'STAKE_BELOW_LINE_MINIMUM',
          `Minimum stake must cover one point per payline (${minimum}).`,
        );
      }
    },
  },
};

/** Effective RTP for a candidate, resolving profile games to their exact value. */
export function candidateRtpBps(gameId: CasinoGameId, candidate: GameConfigCandidate) {
  if (gameId === 'fools-gold-rush') {
    const definition = slotProfile(gameId, candidate.gameSpecific.profile as string);
    return analyseSlotRtp(definition).rtpBps;
  }
  return candidate.rtpBps;
}
