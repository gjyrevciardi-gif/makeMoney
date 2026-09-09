import { Prisma } from '@prisma/client';
import {
  buildMatrix,
  combineReturn,
  evaluateLine,
  evaluateLines,
  evaluateScatter,
  symbolIndex,
} from './slot.engine';
import { SlotGameDefinition } from './slot.types';

/**
 * Exact theoretical RTP for a slot definition.
 *
 * Two independent exact methods live here. Neither samples anything: a
 * statistical estimate is not a theoretical RTP.
 *
 * ---------------------------------------------------------------------------
 * 1. Analytic (fast, used in production and at startup validation)
 * ---------------------------------------------------------------------------
 *
 * Reel stops are uniform and independent, and a cyclic shift does not change a
 * strip's multiset, so the visible symbol on reel i has the *same* marginal
 * distribution at every row: the strip's own symbol frequencies. For a single
 * payline the five symbols are therefore independent, and every payline shares
 * one distribution regardless of which rows it visits.
 *
 * By linearity of expectation - valid even though the lines of one spin are
 * correlated - the expected line return is
 *
 *   lineCount * SUM over symbol tuples of  P(tuple) * lineCenti(tuple)
 *
 * which enumerates |symbols|^reels tuples rather than every stop combination.
 *
 * Scatter counts do depend on strip adjacency, so they are handled separately
 * but still exactly: for each reel the distribution of scatters in its visible
 * window is enumerated over that reel's stops, and the five distributions are
 * convolved.
 *
 * Everything is accumulated as an exact BigInt fraction over the product of
 * strip lengths, so the result carries no rounding at all.
 *
 * This method is only valid while the max-win cap cannot bind, which
 * `validateSlotDefinition` proves before accepting a definition.
 *
 * ---------------------------------------------------------------------------
 * 2. Exhaustive (slow, used in tests to prove the analytic method)
 * ---------------------------------------------------------------------------
 *
 * Enumerates every stop combination, builds every board, and evaluates it
 * through the same engine the live game uses.
 */

export type SlotRtpAnalysis = {
  /** Exact expected return numerator per spin, as a rational. */
  numerator: bigint;
  denominator: bigint;
  /** Exact RTP as a Decimal fraction, e.g. 0.94993125. */
  rtp: Prisma.Decimal;
  rtpBps: number;
  rtpPercent: string;
  lineRtp: Prisma.Decimal;
  scatterRtp: Prisma.Decimal;
  combinations: bigint;
};

const gcd = (a: bigint, b: bigint): bigint => {
  let left = a < 0n ? -a : a;
  let right = b < 0n ? -b : b;
  while (right) [left, right] = [right, left % right];
  return left;
};

/** Symbol frequency of each strip; the marginal distribution of any visible row. */
function stripCounts(definition: SlotGameDefinition): Map<string, bigint>[] {
  return definition.strips.map((strip) => {
    const counts = new Map<string, bigint>();
    for (const symbolId of strip) {
      counts.set(symbolId, (counts.get(symbolId) ?? 0n) + 1n);
    }
    return counts;
  });
}

/** Exact expected line-return numerator for one payline, as a fraction. */
function expectedLineNumerator(definition: SlotGameDefinition) {
  const counts = stripCounts(definition);
  const symbols = symbolIndex(definition);
  const tuple: string[] = new Array(definition.reels).fill('');
  let total = 0n;

  const walk = (reel: number, weight: bigint) => {
    if (reel === definition.reels) {
      const win = evaluateLine(definition, symbols, tuple);
      if (win) total += weight * BigInt(win.multiplierCenti);
      return;
    }
    for (const [symbolId, count] of counts[reel]) {
      tuple[reel] = symbolId;
      walk(reel + 1, weight * count);
    }
  };
  walk(0, 1n);
  return total;
}

/** Exact expected scatter numerator via per-reel window counts and convolution. */
function expectedScatterNumerator(definition: SlotGameDefinition) {
  const rule = definition.scatter;
  if (!rule) return 0n;

  const perReel = definition.strips.map((strip) => {
    const distribution = new Array<bigint>(definition.rows + 1).fill(0n);
    for (let stop = 0; stop < strip.length; stop += 1) {
      let seen = 0;
      for (let row = 0; row < definition.rows; row += 1) {
        if (strip[(stop + row) % strip.length] === rule.symbolId) seen += 1;
      }
      distribution[seen] += 1n;
    }
    return distribution;
  });

  let convolved: bigint[] = [1n];
  for (const distribution of perReel) {
    const next = new Array<bigint>(convolved.length + definition.rows).fill(0n);
    for (let index = 0; index < convolved.length; index += 1) {
      if (convolved[index] === 0n) continue;
      for (let count = 0; count < distribution.length; count += 1) {
        if (distribution[count] === 0n) continue;
        next[index + count] += convolved[index] * distribution[count];
      }
    }
    convolved = next;
  }

  const tiers = Object.keys(rule.tiers).map(Number).sort((left, right) => left - right);
  let total = 0n;
  for (let count = 0; count < convolved.length; count += 1) {
    if (count < rule.minimumCount || convolved[count] === 0n) continue;
    const applicable = [...tiers].reverse().find((tier) => count >= tier);
    if (applicable === undefined) continue;
    // Scatter pays on total stake, so it enters the numerator scaled by lines.
    total += convolved[count] * BigInt(rule.tiers[applicable] * definition.paylines.length);
  }
  return total;
}

/** Exact analytic RTP. No sampling, no rounding until the final display value. */
export function analyseSlotRtp(definition: SlotGameDefinition): SlotRtpAnalysis {
  const combinations = definition.strips.reduce(
    (product, strip) => product * BigInt(strip.length),
    1n,
  );
  const lineCount = BigInt(definition.paylines.length);
  // Each of the lineCount paylines contributes the same expectation.
  const lineNumerator = expectedLineNumerator(definition) * lineCount;
  const scatterNumerator = expectedScatterNumerator(definition);

  // RTP = E[returnNumerator] / (lineCount * 100)
  const numerator = lineNumerator + scatterNumerator;
  const denominator = combinations * lineCount * 100n;
  const divisor = gcd(numerator, denominator);

  const asDecimal = (value: bigint) =>
    new Prisma.Decimal(value.toString()).div(new Prisma.Decimal(denominator.toString()));

  const rtp = asDecimal(numerator);
  return {
    numerator: numerator / (divisor || 1n),
    denominator: denominator / (divisor || 1n),
    rtp,
    rtpBps: Number(rtp.mul(10_000).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)),
    rtpPercent: rtp.mul(100).toDecimalPlaces(6).toString(),
    lineRtp: asDecimal(lineNumerator),
    scatterRtp: asDecimal(scatterNumerator),
    combinations,
  };
}

export type SlotExhaustiveAnalysis = SlotRtpAnalysis & {
  /** Largest total return any stop combination can produce, in centi of stake. */
  maxReturnCenti: number;
  hitCombinations: bigint;
  hitFrequency: Prisma.Decimal;
};

/**
 * Exhaustive enumeration of every stop combination through the live engine.
 *
 * Deliberately slower than the analytic path and used to prove it. Also yields
 * the true maximum return, which is what justifies the claim that the max-win
 * cap can never bind.
 */
export function enumerateSlot(definition: SlotGameDefinition): SlotExhaustiveAnalysis {
  const lengths = definition.strips.map((strip) => strip.length);
  const combinations = lengths.reduce((product, length) => product * BigInt(length), 1n);
  const stops = new Array<number>(definition.reels).fill(0);
  let total = 0n;
  let maxReturnCenti = 0;
  let hits = 0n;

  const walk = (reel: number) => {
    if (reel === definition.reels) {
      const matrix = buildMatrix(definition, stops);
      const { returnNumerator } = combineReturn(
        definition,
        evaluateLines(definition, matrix),
        evaluateScatter(definition, matrix),
      );
      total += BigInt(returnNumerator);
      if (returnNumerator > maxReturnCenti) maxReturnCenti = returnNumerator;
      if (returnNumerator > 0) hits += 1n;
      return;
    }
    for (let stop = 0; stop < lengths[reel]; stop += 1) {
      stops[reel] = stop;
      walk(reel + 1);
    }
  };
  walk(0);

  const lineCount = BigInt(definition.paylines.length);
  const denominator = combinations * lineCount * 100n;
  const rtp = new Prisma.Decimal(total.toString())
    .div(new Prisma.Decimal(denominator.toString()));
  const divisor = gcd(total, denominator);
  return {
    numerator: total / (divisor || 1n),
    denominator: denominator / (divisor || 1n),
    rtp,
    rtpBps: Number(rtp.mul(10_000).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)),
    rtpPercent: rtp.mul(100).toDecimalPlaces(6).toString(),
    lineRtp: rtp,
    scatterRtp: new Prisma.Decimal(0),
    combinations,
    maxReturnCenti,
    hitCombinations: hits,
    hitFrequency: new Prisma.Decimal(hits.toString())
      .div(new Prisma.Decimal(combinations.toString())),
  };
}

/**
 * The largest return the paytable could theoretically produce, ignoring whether
 * the board can actually arrange it. Used to prove the cap never binds, which
 * is what keeps the fast analytic RTP exact.
 */
export function maxPossibleReturnNumerator(definition: SlotGameDefinition): number {
  const lineCount = definition.paylines.length;
  let bestLine = 0;
  for (const table of Object.values(definition.paytable)) {
    for (const multiplier of Object.values(table)) {
      if (multiplier > bestLine) bestLine = multiplier;
    }
  }
  const bestScatter = definition.scatter
    ? Math.max(0, ...Object.values(definition.scatter.tiers))
    : 0;
  return lineCount * bestLine + lineCount * bestScatter;
}
