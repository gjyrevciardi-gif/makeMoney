import { createHash, randomInt } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Verified math adapter for the imported Lucky Lady game.
 *
 * Nothing in this file reimplements game mathematics. The accepted evaluator,
 * rule table and frozen RTP profile are vendored byte-for-byte next to this
 * module and are hash-checked on first use, so a tampered or substituted
 * evaluator fails closed instead of quietly changing payouts. This module is
 * the single place the platform obtains outcomes for this game.
 */

export const LUCKY_LADY_GAME_ID = 'lucky-lady';
export const LUCKY_LADY_LINES = 10;
export const LUCKY_LADY_PROFILE_VERSION = 1;
/** Native per-line ladder: 0.01/0.02/0.05/0.10/0.20 on the client. */
export const LUCKY_LADY_LINE_STAKES = [1, 2, 5, 10, 20] as const;

export const PINNED_ENGINE_SHA256 = '0f02bb1e78eafdd99a51015c4bf83848050ca6b6e898123759d1442787d12843';
export const PINNED_RULES_SHA256 = '4c03dd436f18307d9f98dc2148ff422251faa2d5c1c928062257187883acfc57';
export const PINNED_PROFILE_FILE_SHA256 = '14a5f695611aebd33b0f27f7894731b5e0e03934fc2261366598f84a0314bb65';
export const FROZEN_PROFILE_CANONICAL_HASH = 'eb0a22171a3479cea3b0238269edd4b0dc5d9486c57e4b057fa6ee0f1a70be5f';

/** The engine-native pre-draw weighting a generated profile carries. */
export type EngineProfilePayload = {
  strips?: Record<string, string[]>;
  stopWeights?: Record<string, number[]>;
};

export type EngineModule = {
  loadRules: (path?: string) => RulesTable;
  playRound: (
    rules: RulesTable,
    profile: MathProfile | EngineProfilePayload,
    options: { bet: number; lines: number; rng: Rng; capture?: boolean },
  ) => CompleteRound;
  evaluate: (
    rules: RulesTable,
    board: Board,
    options: { bet: number; lines: number; isFree?: boolean },
  ) => Evaluation;
  createRng: (seed: string) => Rng;
  canonicalHash: (profile: unknown) => string;
};

export type Rng = { int: (min: number, max: number) => number };
export type Board = { rp: number[] } & Record<string, string[] | number[]>;

export type LineWin = { line: number; symbol: string; count: number; win: number };
export type Evaluation = {
  lineWins: LineWin[];
  baseWin: number;
  scatterCount: number;
  scatterWin: number;
  totalWin: number;
};
export type FeatureSpin = {
  index: number;
  board: Board;
  lineWins: LineWin[];
  scatterCount: number;
  scatterWin: number;
  spinWin: number;
  retriggered: boolean;
};
export type CompleteRound = {
  board: Board;
  mainEval: Evaluation;
  feature: { triggered: boolean; spins: number; win: number; retriggers: number; sequence: FeatureSpin[] };
  totalWin: number;
  wager: number;
};
export type RulesTable = {
  lines: number[][];
  wild: string[];
  scatter: string;
  constants: { slotWildMpl: number; slotFreeMpl: number; slotFreeCount: number };
  [key: string]: unknown;
};
export type MathProfile = { id: string; canonicalHash: string; targetRtpPercent: number; validatedLines: number };

const MATH_DIR_CANDIDATES = [
  join(__dirname, 'math'),
  join(__dirname, '..', '..', '..', '..', '..', 'src', 'casino', 'games', 'lucky-lady', 'math'),
  join(process.cwd(), 'src', 'casino', 'games', 'lucky-lady', 'math'),
  join(process.cwd(), 'backend', 'src', 'casino', 'games', 'lucky-lady', 'math'),
];

function resolveMathDir() {
  const found = MATH_DIR_CANDIDATES.find((candidate) => existsSync(join(candidate, 'engine.mjs')));
  if (!found) {
    throw new Error('LUCKY_LADY_MATH_MISSING: the vendored evaluator could not be located');
  }
  return found;
}

const sha256File = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

export type VerifiedMath = {
  engine: EngineModule;
  rules: RulesTable;
  profile: MathProfile;
  settings: Record<string, unknown>;
  language: Record<string, unknown>;
  hashes: {
    engineSha256: string;
    rulesSha256: string;
    profileFileSha256: string;
    profileCanonicalHash: string;
  };
};

let cached: VerifiedMath | null = null;

/**
 * Loads and verifies the evaluator, rules and frozen profile.
 *
 * The evaluator is an ES module; `createRequire` deliberately uses Node's own
 * loader rather than any bundler shim so the file that is hash-checked is the
 * exact file that executes.
 */
export function loadVerifiedMath(): VerifiedMath {
  if (cached) return cached;
  const dir = resolveMathDir();
  const enginePath = join(dir, 'engine.mjs');
  const rulesPath = join(dir, 'data', 'rules.json');
  const profilePath = join(dir, 'profiles', 'lucky-lady.rtp50.v1.json');

  const engineSha256 = sha256File(enginePath);
  if (engineSha256 !== PINNED_ENGINE_SHA256) {
    throw new Error(`LUCKY_LADY_ENGINE_TAMPERED: ${engineSha256}`);
  }
  const rulesSha256 = sha256File(rulesPath);
  if (rulesSha256 !== PINNED_RULES_SHA256) {
    throw new Error(`LUCKY_LADY_RULES_TAMPERED: ${rulesSha256}`);
  }
  const profileFileSha256 = sha256File(profilePath);
  if (profileFileSha256 !== PINNED_PROFILE_FILE_SHA256) {
    throw new Error(`LUCKY_LADY_PROFILE_TAMPERED: ${profileFileSha256}`);
  }

  const engine = createRequire(join(dir, 'engine-loader.cjs'))(enginePath) as EngineModule;
  const rules = engine.loadRules(rulesPath);
  const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as MathProfile;
  if (engine.canonicalHash(profile) !== profile.canonicalHash) {
    throw new Error('LUCKY_LADY_PROFILE_TAMPERED: canonical hash mismatch');
  }
  if (profile.canonicalHash !== FROZEN_PROFILE_CANONICAL_HASH) {
    throw new Error('LUCKY_LADY_PROFILE_TAMPERED: unexpected frozen profile hash');
  }
  if (profile.validatedLines !== LUCKY_LADY_LINES) {
    throw new Error('LUCKY_LADY_PROFILE_TAMPERED: profile line count changed');
  }

  cached = {
    engine,
    rules,
    profile,
    settings: JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as Record<string, unknown>,
    language: JSON.parse(readFileSync(join(dir, 'language.json'), 'utf8')) as Record<string, unknown>,
    hashes: { engineSha256, rulesSha256, profileFileSha256, profileCanonicalHash: profile.canonicalHash },
  };
  return cached;
}

/**
 * Production outcome source: the OS CSPRNG behind the engine's single
 * `int(min,max)` interface, exactly as the accepted runtime ran it.
 *
 * `engine.createRng` is a 32-bit simulation PRNG. It is *not* a CSPRNG, so it is
 * never used to draw a real outcome - seed entropy cannot make a weak generator
 * strong. The only production draw path is this function.
 */
export function createProductionRng(): Rng {
  return {
    int(min, max) {
      if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
        throw new Error('invalid RNG bounds');
      }
      return randomInt(min, max + 1);
    },
  };
}

/**
 * Explicit TEST injection only.
 *
 * The counter exists so an active-path test can prove that the default
 * production configuration never enters this path. Nothing on the HTTP surface,
 * in the environment or in a fixture file can select it: only a caller that
 * constructs the service itself can supply a factory.
 */
export const deterministicRngUsage = { calls: 0 };

export function createDeterministicRng(seed: string): Rng {
  deterministicRngUsage.calls += 1;
  return loadVerifiedMath().engine.createRng(seed);
}

export function assertSupportedLines(lines: number) {
  if (lines !== LUCKY_LADY_LINES) {
    const error = new Error(`unsupported line count ${lines}; this game runs only ${LUCKY_LADY_LINES} lines`) as Error & { code?: string };
    error.code = 'UNSUPPORTED_LINES';
    throw error;
  }
}

/** One clean-math integer unit is one platform point; the ladder is the native one. */
export function assertLineStake(units: number) {
  if (!Number.isSafeInteger(units) || !(LUCKY_LADY_LINE_STAKES as readonly number[]).includes(units)) {
    const error = new Error(`unsupported stake ${units}; the native ladder is ${LUCKY_LADY_LINE_STAKES.join(',')}`) as Error & { code?: string };
    error.code = 'UNSUPPORTED_STAKE';
    throw error;
  }
  return units;
}

/**
 * Draws one complete paid round: the paid board plus the entire future feature
 * sequence. Called once per accepted paid round; the result is persisted before
 * any accounting.
 */
export function generateCompleteRound({
  rng,
  bet,
  lines,
  weighting,
}: {
  rng: Rng;
  bet: number;
  lines: number;
  /**
   * The profile the round is pinned to. Omitted, the round runs on the accepted
   * frozen RTP50 artefact exactly as before. When supplied it must be the
   * engine-native payload of an activated, validated profile; the platform
   * never lets a request, header or environment value choose it.
   */
  weighting?: EngineProfilePayload;
}) {
  assertSupportedLines(lines);
  assertLineStake(bet);
  const { engine, rules, profile } = loadVerifiedMath();
  const round = engine.playRound(rules, weighting ?? profile, { bet, lines, rng, capture: true });
  return { rules, profile, round };
}

/** Native red/black gamble. The injected stream picks the card; no targeting. */
export function drawGamble({ rng, choice }: { rng: Rng; choice: 'red' | 'black' }) {
  const win = rng.int(1, 2) === 1;
  const winner = choice === 'red' ? ['D', 'H'] : ['C', 'S'];
  const loser = choice === 'red' ? ['C', 'S'] : ['D', 'H'];
  const dealerCard = (win ? winner : loser)[rng.int(0, 1)];
  return { win, dealerCard };
}

export const freeSpinCount = () => loadVerifiedMath().rules.constants.slotFreeCount;
export const freeSpinMultiplier = () => loadVerifiedMath().rules.constants.slotFreeMpl;

/**
 * One platform point per math unit.
 *
 * The native client renders numbers directly, so a point is emitted as the
 * whole integer the wallet actually holds. There is no fractional money
 * anywhere in this adapter, and a value that cannot be represented exactly is
 * refused rather than rounded.
 */
export const points = (value: number | bigint) => {
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new Error('POINT_VALUE_OUT_OF_RANGE');
    }
    return Number(value);
  }
  if (!Number.isSafeInteger(value)) throw new Error('POINT_VALUE_OUT_OF_RANGE');
  return value;
};

export function nativeWinLines(board: Board, lineWins: LineWin[], priorPoints = 0) {
  const { rules } = loadVerifiedMath();
  let running = priorPoints;
  return lineWins.map((lineWin) => {
    const rows = rules.lines[lineWin.line];
    running += lineWin.win;
    const entry: Record<string, unknown> = {
      Count: lineWin.count,
      Line: lineWin.line,
      Win: points(lineWin.win),
      stepWin: points(running),
    };
    for (let reel = 0; reel < 5; reel += 1) {
      if (reel < lineWin.count) {
        const symbol = (board[`reel${reel + 1}`] as string[])[rows[reel] - 1];
        entry[`winReel${reel + 1}`] = [rows[reel] - 1, rules.wild.includes(symbol) && symbol !== lineWin.symbol ? 'P_1_WILD' : symbol];
      } else {
        entry[`winReel${reel + 1}`] = ['none', 'none'];
      }
    }
    return entry;
  });
}

export function nativeSpin(
  board: Board,
  spin: { lineWins: LineWin[]; scatterCount: number; scatterWin: number },
  { isFree, priorPoints = 0 }: { isFree: boolean; priorPoints?: number },
) {
  const { rules } = loadVerifiedMath();
  const bonusInfo: Record<string, unknown> = {
    scattersType: spin.scatterCount >= 3 ? 'bonus' : (spin.scatterWin > 0 ? 'win' : 'none'),
    scattersWin: points(spin.scatterWin),
  };
  for (let reel = 1; reel <= 5; reel += 1) {
    const column = board[`reel${reel}`] as string[];
    for (let position = 0; position <= 2; position += 1) {
      if (column[position] === rules.scatter) bonusInfo[`winReel${reel}`] = [position, 'SCAT'];
    }
  }
  return {
    reelsSymbols: {
      reel1: board.reel1,
      reel2: board.reel2,
      reel3: board.reel3,
      reel4: board.reel4,
      reel5: board.reel5,
      rp: board.rp,
    },
    winLines: nativeWinLines(board, spin.lineWins, priorPoints),
    bonusInfo,
    multiplier: isFree ? freeSpinMultiplier() : 1,
  };
}

/**
 * Native settings with the validated 10-line configuration locked in.
 *
 * When a Game Math Control profile is active, its identity is what the client
 * is told is live; otherwise the accepted frozen RTP50 artefact is reported.
 */
export function nativeSettings(active?: {
  profileId: string;
  profileHash: string;
  targetRtpPercent: number;
  validatedLines: number;
} | null) {
  const { profile } = loadVerifiedMath();
  const settings = JSON.parse(JSON.stringify(loadVerifiedMath().settings)) as Record<string, unknown>;
  // Whole points, not the pilot's fractional display: one native stake step is
  // one platform point per line, so the displayed total stake (per line x 10
  // lines) is exactly the point amount the ledger debits.
  settings.Bet = [...LUCKY_LADY_LINE_STAKES];
  if ('gameBet' in settings) settings.gameBet = [...LUCKY_LADY_LINE_STAKES];
  settings.Line = [LUCKY_LADY_LINES];
  settings.gameLine = [LUCKY_LADY_LINES];
  const reported = active ?? {
    profileId: profile.id,
    profileHash: profile.canonicalHash,
    targetRtpPercent: profile.targetRtpPercent,
    validatedLines: profile.validatedLines,
  };
  settings.mathConfig = {
    gameId: reported.profileId,
    rtpControlEnabled: true,
    targetRtpPercent: reported.targetRtpPercent,
    activeMathProfile: reported.profileId,
    profileHash: reported.profileHash,
    validatedLines: reported.validatedLines,
    stakeUnit: 'WHOLE_POINTS',
  };
  return settings;
}

export function nativeLanguage() {
  return loadVerifiedMath().language;
}
