import { CasinoGameType } from '@prisma/client';

/**
 * Central, fixed, versioned casino configuration.
 *
 * RTP is expressed in basis points where 10000 bps = 100%:
 *
 *   RTP        = rtpBps / 10000
 *   houseEdge  = 1 - RTP        (houseEdgeBps = 10000 - rtpBps)
 *
 * Two rules are structural, not stylistic:
 *
 *  1. RTP is a property of the *game configuration*, never of the player. No
 *     value here is ever derived from a user id, a user's win/loss history, or
 *     the virtual house balance. The RNG stays independent and authoritative.
 *  2. Configuration is versioned. `version` embeds both the math revision and
 *     the effective RTP, so a round created under one configuration keeps an
 *     exact, reproducible reference to the numbers that produced it even after
 *     an operator changes the environment.
 */

const MIN_RTP_BPS = 5_000; // 50.00%
/** 36/37 rounded to basis points: the canonical single-zero roulette return. */
export const ROULETTE_RTP_BPS = 9_730;
const MAX_RTP_BPS = 9_950; // 99.50%

/** Largest payout the BigInt/int64 wallet column may ever be asked to hold. */
export const MAX_SAFE_PAYOUT = 9_000_000_000_000_000n;

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

function rtpBps(name: string, fallback: number) {
  return boundedInteger(process.env[name], fallback, MIN_RTP_BPS, MAX_RTP_BPS);
}

/** `dice.v1.rtp9700` — math revision plus effective RTP, stable per round. */
function versionOf(gameId: string, mathVersion: number, effectiveRtpBps: number) {
  return `${gameId}.v${mathVersion}.rtp${effectiveRtpBps}`;
}

export type CasinoStakeLimits = { minStake: bigint; maxStake: bigint };

export type CasinoGameMath = CasinoStakeLimits & {
  gameType: CasinoGameType;
  gameId: string;
  version: string;
  mathVersion: number;
  rtpBps: number;
  houseEdgeBps: number;
};

export type DiceConfig = CasinoGameMath & {
  scale: number;
  minTarget: number;
  maxTarget: number;
};

export type MinesConfig = CasinoGameMath & {
  cells: number;
  minMines: number;
  maxMines: number;
};

/**
 * Roulette and blackjack keep their canonical mathematics instead of taking a
 * configurable RTP. Distorting a single-zero wheel or biasing a shoe to hit an
 * arbitrary return target would mean rigging the game rather than configuring
 * it, so their return is a consequence of the published rules alone.
 */
export type RouletteConfig = CasinoGameMath & {
  pockets: number;
  maxBetsPerSpin: number;
};

export type BlackjackConfig = CasinoStakeLimits & {
  gameType: CasinoGameType;
  gameId: string;
  version: string;
  mathVersion: number;
  decks: number;
  dealerStandsOnSoft17: boolean;
  blackjackPayoutNumerator: number;
  blackjackPayoutDenominator: number;
  doubleDownEnabled: boolean;
};

/**
 * Crash progression is a pure function of *server* elapsed time.
 *
 * The curve advances one tick every `tickMs` and multiplies by the exact
 * rational `growthNumerator / growthDenominator` per tick, so the authoritative
 * multiplier is computed entirely in BigInt with no floating point anywhere:
 *
 *   multiplierCenti(ticks) = floor(100 * num^ticks / den^ticks)
 *
 * Both the curve and the crash point are integers in hundredths ("centi"), so
 * the crash comparison is an exact integer comparison with no same-millisecond
 * ambiguity.
 */
export type CrashConfig = CasinoGameMath & {
  tickMs: number;
  growthNumerator: number;
  growthDenominator: number;
  minMultiplierCenti: number;
  maxMultiplierCenti: number;
  minAutoCashoutCenti: number;
  maxAutoCashoutCenti: number;
};

/**
 * Plinko paytables are frozen constants rather than values derived from an
 * environment variable: the published table *is* the configuration, and each
 * table's theoretical RTP is computed exactly from it. That keeps a settled
 * round's payout reproducible from its recorded version forever.
 */
export type PlinkoConfig = CasinoStakeLimits & {
  gameType: CasinoGameType;
  gameId: string;
  mathVersion: number;
  supportedRows: number[];
  riskLevels: string[];
  /** Target used only to validate the frozen tables, never to generate payouts. */
  targetRtpBps: number;
  rtpToleranceBps: number;
};

export type CasinoConfig = {
  minStake: bigint;
  maxStake: bigint;
  dice: DiceConfig;
  mines: MinesConfig;
  roulette: RouletteConfig;
  blackjack: BlackjackConfig;
  crash: CrashConfig;
  plinko: PlinkoConfig;
};

/**
 * Read fresh on every call so deployment configuration and integration tests
 * take effect without rebuilding the Nest dependency graph.
 */
export function casinoConfig(): CasinoConfig {
  const minStake = BigInt(boundedInteger(process.env.CASINO_MIN_STAKE, 1, 1, 1_000_000));
  const maxStake = BigInt(
    boundedInteger(process.env.CASINO_MAX_STAKE, 1_000_000, 1, 1_000_000_000),
  );
  const limits: CasinoStakeLimits = {
    minStake,
    maxStake: maxStake >= minStake ? maxStake : minStake,
  };

  const diceRtp = rtpBps('CASINO_DICE_RTP_BPS', 9_700);
  const minesRtp = rtpBps('CASINO_MINES_RTP_BPS', 9_700);
  const crashRtp = rtpBps('CASINO_CRASH_RTP_BPS', 9_700);

  return {
    ...limits,
    dice: {
      ...limits,
      gameType: CasinoGameType.DICE,
      gameId: 'dice',
      mathVersion: 1,
      version: versionOf('dice', 1, diceRtp),
      rtpBps: diceRtp,
      houseEdgeBps: 10_000 - diceRtp,
      // Rolls are integers on [0, 9999], displayed as 0.00 - 99.99.
      scale: 10_000,
      // Bounds keep at least 100 winning and 100 losing outcomes, capping the
      // multiplier at rtpBps/100 (97.00x at the default 97% RTP).
      minTarget: 100,
      maxTarget: 9_899,
    },
    mines: {
      ...limits,
      gameType: CasinoGameType.MINES,
      gameId: 'mines',
      mathVersion: 1,
      version: versionOf('mines', 1, minesRtp),
      rtpBps: minesRtp,
      houseEdgeBps: 10_000 - minesRtp,
      cells: 25,
      minMines: 1,
      maxMines: 24,
    },
    roulette: {
      ...limits,
      gameType: CasinoGameType.ROULETTE,
      gameId: 'roulette',
      mathVersion: 1,
      // Derived, not configurable: every canonical single-zero bet returns
      // 36/37 = 97.2972...% in expectation. Recorded rounded to basis points.
      version: versionOf('roulette', 1, ROULETTE_RTP_BPS),
      rtpBps: ROULETTE_RTP_BPS,
      houseEdgeBps: 10_000 - ROULETTE_RTP_BPS,
      pockets: 37,
      maxBetsPerSpin: 20,
    },
    blackjack: {
      ...limits,
      gameType: CasinoGameType.BLACKJACK,
      gameId: 'blackjack',
      mathVersion: 1,
      // Blackjack return depends on the player's decisions, so no single
      // theoretical RTP is recorded. The rules themselves are the version.
      version: 'blackjack.v1.6d.s17.bj3-2',
      decks: 6,
      dealerStandsOnSoft17: true,
      blackjackPayoutNumerator: 3,
      blackjackPayoutDenominator: 2,
      doubleDownEnabled: true,
    },
    crash: {
      ...limits,
      gameType: CasinoGameType.CRASH,
      gameId: 'crash',
      mathVersion: 1,
      version: versionOf('crash', 1, crashRtp),
      rtpBps: crashRtp,
      houseEdgeBps: 10_000 - crashRtp,
      // 1.005x every 50ms: 2.00x at ~6.95s, 10x at ~23.1s, the 10000x cap at ~92.4s.
      tickMs: 50,
      growthNumerator: 201,
      growthDenominator: 200,
      minMultiplierCenti: 100,
      maxMultiplierCenti: 1_000_000,
      // An auto-cashout at 1.00x could never win, so the minimum is one tick above.
      minAutoCashoutCenti: 101,
      maxAutoCashoutCenti: 1_000_000,
    },
    plinko: {
      ...limits,
      gameType: CasinoGameType.PLINKO,
      gameId: 'plinko',
      mathVersion: 1,
      supportedRows: [8, 12, 16],
      riskLevels: ['LOW', 'MEDIUM', 'HIGH'],
      targetRtpBps: 9_700,
      rtpToleranceBps: 50,
    },
  };
}

/** Public, non-secret projection of a game's configuration. */
export function publicGameConfig(math: CasinoGameMath & Record<string, unknown>) {
  const {
    gameType, gameId, version, mathVersion, rtpBps: rtp, houseEdgeBps, minStake, maxStake,
    ...rest
  } = math;
  return {
    gameType,
    gameId,
    version,
    mathVersion,
    rtpBps: rtp,
    houseEdgeBps,
    rtpPercent: (rtp / 100).toFixed(2),
    houseEdgePercent: (houseEdgeBps / 100).toFixed(2),
    minStake: minStake.toString(),
    maxStake: maxStake.toString(),
    ...rest,
  };
}
