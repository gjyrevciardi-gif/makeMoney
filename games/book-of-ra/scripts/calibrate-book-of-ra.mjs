#!/usr/bin/env node
/**
 * Weight calibration for the Book of Ra Deluxe profile.
 *
 * Tuning aid, not evidence. The published return is measured by
 * `simulate-book-of-ra.mjs`, which drives the production round engine; this
 * script only searches for the symbol weights that should make that run land
 * inside the declared band, so the search does not need thousands of full
 * engine passes.
 *
 * Method
 *  - Line and Book-anywhere wins come from the production payline evaluator
 *    (`evaluateBookOfRa`) over grids drawn from the candidate weights.
 *  - The free-game contribution is the exact expectation of the same rules the
 *    engine applies:
 *      trigger probability  f  = P(at least three Books in fifteen independent cells)
 *      expected spin count  E[S] = freeSpins / (1 - freeSpins * f)   (retriggers)
 *      per free spin        E[line wins] + E[Book pays] + E[expanding symbol]
 *    with the expanding symbol uniform over the nine non-Book symbols and each
 *    reel qualifying independently (P at least one of three cells = 1-(1-p)^3).
 *
 * Usage:
 *   node games/book-of-ra/scripts/calibrate-book-of-ra.mjs --spins 2000000
 */
import {
  BOOK_OF_RA_GAME,
  BOOK_OF_RA_PAYTABLE,
  BOOK_OF_RA_PROFILE,
  BOOK_OF_RA_SCATTER_PAYS,
  evaluateBookOfRa,
  bookOfRaExpandingMinimum,
} from "@slot-skills/math";

const BPS = 10_000n;

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? true : value;
}

function integerArgument(name, fallback) {
  const raw = argument(name, undefined);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`--${name} must be a positive integer`);
  return value;
}

function numberArgument(name, fallback) {
  const raw = argument(name, undefined);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a number`);
  return value;
}

function listArgument(name, fallback) {
  const raw = argument(name, undefined);
  if (raw === undefined) return fallback;
  return String(raw).split(",").map((entry) => Number(entry.trim())).filter((value) => Number.isFinite(value) && value > 0);
}

/** Deterministic 32-bit PRNG; the same stream is reused for every candidate. */
function makeRandom(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function buildCumulative(weights, symbols) {
  const total = symbols.reduce((sum, symbol) => sum + weights[symbol], 0);
  const cumulative = [];
  let running = 0;
  for (const symbol of symbols) {
    running += weights[symbol];
    cumulative.push({ symbol, threshold: running / total });
  }
  return { cumulative, total };
}

function drawSymbol(cumulative, random) {
  const value = random();
  for (const entry of cumulative) if (value < entry.threshold) return entry.symbol;
  return cumulative[cumulative.length - 1].symbol;
}

const SYMBOLS = ["high-1", "high-2", "high-3", "high-4", "low-1", "low-2", "low-3", "low-4", "low-5", "scatter"];

function logChoose(n, k) {
  let total = 0;
  for (let index = 1; index <= k; index += 1) total += Math.log(n - k + index) - Math.log(index);
  return total;
}

function binomialProbability(n, k, p) {
  if (p <= 0) return k === 0 ? 1 : 0;
  if (p >= 1) return k === n ? 1 : 0;
  return Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

/** Base line wins only, measured with the production evaluator. */
function measureLineRtp(weights, spins, seed) {
  const random = makeRandom(seed);
  const { cumulative } = buildCumulative(weights, SYMBOLS);
  const lines = BOOK_OF_RA_GAME.math.paylines;
  const activeLines = BOOK_OF_RA_PROFILE.activeLines;
  let total = 0n;
  const grid = [[], [], [], [], []];
  for (let spin = 0; spin < spins; spin += 1) {
    for (let reel = 0; reel < 5; reel += 1) {
      grid[reel][0] = drawSymbol(cumulative, random);
      grid[reel][1] = drawSymbol(cumulative, random);
      grid[reel][2] = drawSymbol(cumulative, random);
    }
    const evaluation = evaluateBookOfRa(BOOK_OF_RA_GAME, grid, 1n, activeLines);
    for (const win of evaluation.regularWins) total += BigInt(win.payoutUnits);
  }
  void lines;
  // Line wins are per line bet; the published denominator is the total bet.
  return Number(total) / spins / activeLines;
}

/** Exact per-spin expectations for the Book pays and the expanding symbol. */
function measureFeatureExpectations(weights) {
  const total = SYMBOLS.reduce((sum, symbol) => sum + weights[symbol], 0);
  const pBook = weights.scatter / total;
  const trigger = 1 - binomialProbability(15, 0, pBook) - binomialProbability(15, 1, pBook) - binomialProbability(15, 2, pBook);
  const scatterPay = [3, 4, 5].reduce(
    (sum, count) => sum + binomialProbability(15, count, pBook) * BOOK_OF_RA_SCATTER_PAYS[count],
    0,
  );
  const expandable = SYMBOLS.filter((symbol) => symbol !== "scatter");
  let expansion = 0;
  for (const symbol of expandable) {
    const p = weights[symbol] / total;
    const qualifying = 1 - Math.pow(1 - p, 3);
    const minimum = bookOfRaExpandingMinimum(symbol);
    let expected = 0;
    for (let k = minimum; k <= 5; k += 1) {
      expected += binomialProbability(5, k, qualifying) * (BOOK_OF_RA_PAYTABLE[symbol]?.[k] ?? 0);
    }
    expansion += expected / expandable.length;
  }
  const spinsExpected = BOOK_OF_RA_PROFILE.freeSpins / (1 - BOOK_OF_RA_PROFILE.freeSpins * trigger);
  return { trigger, scatterPay, expansion, spinsExpected };
}

function scaleWeights(base, highFactor, lowFactor, scatter, overall = 1) {
  const weights = {};
  for (const symbol of SYMBOLS) {
    if (symbol === "scatter") continue;
    const factor = symbol.startsWith("high-") ? highFactor : lowFactor;
    weights[symbol] = Math.max(1, Math.round(base[symbol] * factor * overall));
  }
  weights.scatter = scatter;
  return weights;
}

function evaluate(weights, lineRtp, freeSpins) {
  const expectations = measureFeatureExpectations(weights);
  const perFreeSpin = lineRtp + expectations.scatterPay + expectations.expansion;
  const feature = expectations.trigger * expectations.spinsExpected * perFreeSpin;
  const scatterPaid = expectations.scatterPay;
  return {
    weights,
    triggerBps: Math.round(expectations.trigger * 10_000),
    expectedFreeSpinsPerTrigger: expectations.spinsExpected,
    lineRtpBps: Math.round(lineRtp * 10_000),
    baseRtpBps: Math.round((lineRtp + scatterPaid) * 10_000),
    featureRtpBps: Math.round(feature * 10_000),
    totalRtpBps: Math.round((lineRtp + scatterPaid + feature) * 10_000),
    expansionPerFreeSpin: expectations.expansion,
  };
}

async function main() {
  const spins = integerArgument("spins", 1_000_000);
  const seed = integerArgument("seed", 424242);
  const explicit = argument("weights", undefined);
  const shiftMax = numberArgument("shift-max", 0.6);
  const shiftStep = numberArgument("shift-step", 0.02);
  const scatterWeights = listArgument("scatter", [1, 2]);
  const overallScales = listArgument("scale", [1]);
  const base = { ...BOOK_OF_RA_PROFILE.symbolWeights };
  const candidates = [];
  if (explicit !== undefined) {
    const values = String(explicit).split(",").map((entry) => Number(entry.trim()));
    if (values.length !== SYMBOLS.length || values.some((value) => !Number.isInteger(value) || value <= 0)) {
      throw new Error(`--weights needs ${SYMBOLS.length} positive integers in symbol order: ${SYMBOLS.join(",")}`);
    }
    candidates.push(Object.fromEntries(SYMBOLS.map((symbol, index) => [symbol, values[index]])));
  }
  for (const scale of overallScales) {
    for (const scatter of scatterWeights) {
      for (let step = 0; step * shiftStep <= shiftMax + 1e-9; step += 1) {
        const shift = Number((step * shiftStep).toFixed(4)); // highs down by `shift`, lows up by `shift`
        candidates.push(scaleWeights(base, 1 - shift, 1 + shift, scatter, scale));
      }
    }
  }
  const lineCache = new Map();
  const results = [];
  for (const weights of candidates) {
    const key = JSON.stringify(weights);
    let lineRtp = lineCache.get(key);
    if (lineRtp === undefined) {
      lineRtp = measureLineRtp(weights, spins, seed);
      lineCache.set(key, lineRtp);
    }
    results.push(evaluate(weights, lineRtp, BOOK_OF_RA_PROFILE.freeSpins));
  }
  results.sort((left, right) => Math.abs(left.totalRtpBps - 5_000) - Math.abs(right.totalRtpBps - 5_000));
  const best = results.slice(0, 8);
  console.log(JSON.stringify({
    spinsPerCandidate: spins,
    seed,
    baseLineRtpBps: Math.round(measureLineRtp(base, spins, seed) * 10_000),
    best,
  }, null, 2));
}

await main();
