import { Prisma } from '@prisma/client';
import { CrashConfig } from '../../casino.config';
import { FairnessInput, FairnessStream } from '../../casino-fairness.service';

/**
 * Crash mathematics.
 *
 * Everything here is exact integer arithmetic. Multipliers are integers in
 * hundredths ("centi"): 100 = 1.00x. That matters because the crash decision is
 * a comparison between the current curve value and the hidden crash point, and
 * an exact integer comparison removes any same-millisecond or floating-point
 * ambiguity from the boundary.
 *
 * ---------------------------------------------------------------------------
 * The curve
 * ---------------------------------------------------------------------------
 *
 *   ticks(elapsedMs)      = floor(elapsedMs / tickMs)
 *   multiplierCenti(t)    = floor(100 * num^t / den^t)      clamped to [100, cap]
 *
 * with num/den = 201/200 per 50ms tick. It starts at exactly 1.00x, is
 * monotonically non-decreasing in elapsed time, is computed with BigInt only,
 * and is bounded by the configured cap, so it can never be NaN or Infinity.
 *
 * ---------------------------------------------------------------------------
 * The crash point
 * ---------------------------------------------------------------------------
 *
 * One uniform 32-bit draw `u` from the committed fairness stream becomes
 *
 *   crashPointCenti = 1 + floor( rtpBps * 2^32 / (100 * (u + 1)) )
 *
 * clamped to [100, cap].
 *
 * A round is crashed when `currentCenti >= crashPointCenti`, so a cashout at
 * target T succeeds exactly when `crashPointCenti >= T + 1`. Counting the `u`
 * values that satisfy that:
 *
 *   P(cashout at T succeeds) = floor(rtpBps * 2^32 / (100 * T)) / 2^32
 *                            ~= (rtpBps / 10000) / (T / 100)
 *
 * so the expected return of committing to any target t = T/100 is
 *
 *   t * P = rtpBps / 10000
 *
 * i.e. exactly the configured RTP for every target, with the floor costing at
 * most t / 2^32 and always in the house's favour. The `+ 1` in the derivation
 * is what makes this exact under the ">= crashes" boundary rule rather than
 * losing one tick of edge at every target.
 *
 * The house edge shows up as instant busts: whenever the raw value lands below
 * 1.00x the round crashes at 1.00x and can never be cashed out. That happens
 * with probability 1 - RTP, which is the edge.
 *
 * Nothing here depends on the player, their history, their balance, or the
 * house result. The only inputs are the committed seed and the round's frozen
 * configuration version.
 */

export const CRASH_UNIFORM_BOUND = 0x1_0000_0000; // 2^32

export const crashDomain = (config: CrashConfig) => `casino:crash:${config.version}`;

/** Whole ticks elapsed. Negative or fractional input floors to a whole tick. */
export function crashTicks(elapsedMs: number, config: CrashConfig): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return Math.floor(elapsedMs / config.tickMs);
}

const curveCache = new Map<string, number>();

/**
 * Authoritative curve value for a whole number of ticks, in centi.
 * Exact: `floor(100 * num^t / den^t)` evaluated entirely in BigInt.
 */
export function crashCurveCentiForTicks(ticks: number, config: CrashConfig): number {
  if (ticks <= 0) return config.minMultiplierCenti;
  // The curve saturates at the cap, so ticks are clamped before the BigInt
  // power. Without this an abandoned round could ask for 201^(hours/50ms).
  const bounded = Math.min(ticks, crashMaxTicks(config));
  const key = `${config.version}:${bounded}`;
  const cached = curveCache.get(key);
  if (cached !== undefined) return cached;

  const exponent = BigInt(bounded);
  const value = (100n * BigInt(config.growthNumerator) ** exponent)
    / (BigInt(config.growthDenominator) ** exponent);
  const clamped = value > BigInt(config.maxMultiplierCenti)
    ? config.maxMultiplierCenti
    : Number(value) < config.minMultiplierCenti
      ? config.minMultiplierCenti
      : Number(value);
  curveCache.set(key, clamped);
  return clamped;
}

/** Authoritative curve value for elapsed server time, in centi. */
export function crashCurveCenti(elapsedMs: number, config: CrashConfig): number {
  return crashCurveCentiForTicks(crashTicks(elapsedMs, config), config);
}

/** Ticks needed for the curve to first reach `targetCenti`. Exact binary search. */
export function crashTicksToReach(targetCenti: number, config: CrashConfig): number {
  if (targetCenti <= config.minMultiplierCenti) return 0;
  const capped = Math.min(targetCenti, config.maxMultiplierCenti);
  let low = 0;
  let high = crashMaxTicks(config);
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (crashCurveCentiForTicks(mid, config) >= capped) high = mid;
    else low = mid + 1;
  }
  return low;
}

/** Elapsed milliseconds at which the curve first reaches `targetCenti`. */
export function crashElapsedMsToReach(targetCenti: number, config: CrashConfig): number {
  return crashTicksToReach(targetCenti, config) * config.tickMs;
}

const maxTicksCache = new Map<string, number>();

/**
 * An upper bound on useful ticks: the first power-of-two tick count at which
 * the curve has reached the cap. Binary search and the curve clamp both only
 * need a bound, not the exact saturation tick.
 */
export function crashMaxTicks(config: CrashConfig): number {
  const cached = maxTicksCache.get(config.version);
  if (cached !== undefined) return cached;
  // Grow geometrically until the cap is reached, then keep that as the bound.
  let ticks = 1;
  while (ticks < 1_000_000) {
    const exponent = BigInt(ticks);
    const value = (100n * BigInt(config.growthNumerator) ** exponent)
      / (BigInt(config.growthDenominator) ** exponent);
    if (value >= BigInt(config.maxMultiplierCenti)) break;
    ticks *= 2;
  }
  maxTicksCache.set(config.version, ticks);
  return ticks;
}

/**
 * Deterministic hidden crash point in centi, reproducible from the revealed
 * seed. Uses one uniform 32-bit draw from the committed fairness stream.
 */
export function deriveCrashPointCenti(fairness: FairnessInput, config: CrashConfig): number {
  const draw = new FairnessStream(fairness).nextBelow(CRASH_UNIFORM_BOUND);
  return crashPointFromDraw(draw, config);
}

/** Pure mapping from the uniform draw to a crash point; unit-testable on its own. */
export function crashPointFromDraw(draw: number, config: CrashConfig): number {
  const raw = 1n + (BigInt(config.rtpBps) * BigInt(CRASH_UNIFORM_BOUND))
    / (100n * BigInt(draw + 1));
  if (raw < BigInt(config.minMultiplierCenti)) return config.minMultiplierCenti;
  if (raw > BigInt(config.maxMultiplierCenti)) return config.maxMultiplierCenti;
  return Number(raw);
}

/**
 * Exact probability that a cashout committed at `targetCenti` succeeds, i.e.
 * that the crash point lands strictly above the target. Used by the tests that
 * assert the RTP identity; never used to decide an outcome.
 */
export function crashSuccessProbability(targetCenti: number, config: CrashConfig) {
  const count = (BigInt(config.rtpBps) * BigInt(CRASH_UNIFORM_BOUND))
    / (100n * BigInt(targetCenti));
  return new Prisma.Decimal(count.toString())
    .div(new Prisma.Decimal(CRASH_UNIFORM_BOUND.toString()));
}

/** Expected return of committing to `targetCenti`, as a Decimal. */
export function crashExpectedReturn(targetCenti: number, config: CrashConfig) {
  return crashSuccessProbability(targetCenti, config)
    .mul(targetCenti)
    .div(100);
}

export type CrashResolution =
  | { terminal: false; currentCenti: number }
  | { terminal: true; outcome: 'CASHED_OUT'; atCenti: number; automatic: boolean; currentCenti: number }
  | { terminal: true; outcome: 'LOST'; atCenti: number; automatic: boolean; currentCenti: number };

/**
 * The single authoritative decision for a round at a given server instant.
 *
 * Boundary rule: the round is crashed when `currentCenti >= crashPointCenti`,
 * so a cashout succeeds only while `currentCenti < crashPointCenti`.
 *
 * An auto-cashout strictly below the crash point always wins at exactly its
 * target, because the curve reaches the auto-cashout before it can reach the
 * crash point. If the auto-cashout is at or above the crash point, the crash
 * happens first and the round is lost.
 */
export function resolveCrash(input: {
  elapsedMs: number;
  crashPointCenti: number;
  autoCashoutCenti: number | null;
  config: CrashConfig;
}): CrashResolution {
  const currentCenti = crashCurveCenti(input.elapsedMs, input.config);
  const auto = input.autoCashoutCenti;

  if (auto !== null && auto < input.crashPointCenti && currentCenti >= auto) {
    return { terminal: true, outcome: 'CASHED_OUT', atCenti: auto, automatic: true, currentCenti };
  }
  if (currentCenti >= input.crashPointCenti) {
    return {
      terminal: true,
      outcome: 'LOST',
      atCenti: input.crashPointCenti,
      automatic: true,
      currentCenti,
    };
  }
  return { terminal: false, currentCenti };
}

/** Centi to a display/storage Decimal, e.g. 342 -> 3.42. */
export const centiToDecimal = (centi: number) => new Prisma.Decimal(centi).div(100);

/** Total return in whole virtual points, floored, matching the house convention. */
export function crashPayout(stake: bigint, multiplierCenti: number): bigint {
  return (stake * BigInt(multiplierCenti)) / 100n;
}
