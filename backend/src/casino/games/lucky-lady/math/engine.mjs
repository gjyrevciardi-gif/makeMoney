// Pure Lucky Lady math: one stop draw per reel, one evaluation per board.
// No category selection, no rejection, no forced loss, no financial/history input.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const RULES_PATH = join(HERE, 'data', 'rules.json');
const UINT32 = 0x100000000;

export function loadRules(path = RULES_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key]);
    return out;
  }
  return value;
}

/** Canonical hash of an immutable profile: recursive key ordering, notes/hash excluded. */
export function canonicalHash(value) {
  const clone = JSON.parse(JSON.stringify(value));
  delete clone.hash;
  delete clone.canonicalHash;
  delete clone.mathHash;
  delete clone.notes;
  return createHash('sha256').update(JSON.stringify(sortKeysDeep(clone))).digest('hex');
}

export function codeHash(path = fileURLToPath(import.meta.url)) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function requireSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer (received ${value})`);
  }
  return value;
}

export function assertStake(bet, lines) {
  if (!Number.isSafeInteger(bet) || bet <= 0) throw new Error(`bet must be a positive integer (received ${bet})`);
  if (!Number.isSafeInteger(lines) || lines <= 0 || lines > 10) {
    throw new Error(`lines must be an integer in 1..10 (received ${lines})`);
  }
}

function hashSeed(seed) {
  const digest = createHash('sha256').update(String(seed)).digest();
  return digest.readUInt32BE(0);
}

/** Deterministic seeded generator. Production would inject a CSPRNG behind this interface. */
export function createRng(seed) {
  let state = 0x9e3779b9 ^ hashSeed(seed);
  const next32 = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  // Unbiased bounded sampling by rejection over the 32-bit range (no modulo bias).
  const int = (min, max) => {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) {
      throw new Error(`RNG bounds must be safe integers (received ${min}..${max})`);
    }
    if (max < min) throw new Error(`inverted RNG range ${min}..${max}`);
    const span = max - min + 1;
    if (!Number.isSafeInteger(span) || span <= 0) throw new Error(`unsupported RNG span ${span}`);
    if (span > UINT32) throw new Error(`RNG span ${span} exceeds the 32-bit generator capacity`);
    if (span === 1) return min;
    const limit = Math.floor(UINT32 / span) * span;
    let draw;
    do { draw = next32(); } while (draw >= limit);
    return min + (draw % span);
  };
  return { int, next32 };
}

export function reelKeys(rules) {
  return Object.keys(rules.reels).sort((a, b) =>
    Number(a.replace('reelStrip', '')) - Number(b.replace('reelStrip', '')));
}

export function stripFor(rules, profile, reelKey) {
  return (profile && profile.strips && profile.strips[reelKey]) || rules.reels[reelKey];
}

/** Stop weights: uniform unless the profile supplies legitimate pre-draw weights. */
export function stopWeights(rules, profile, reelKey) {
  const strip = stripFor(rules, profile, reelKey);
  const stops = strip.length - 2; // original: mt_rand(0, count-3), no wrapping
  const supplied = profile && profile.stopWeights && profile.stopWeights[reelKey];
  if (!supplied) return new Array(stops).fill(1);
  if (!Array.isArray(supplied)) throw new Error(`weights for ${reelKey} must be an array`);
  if (supplied.length !== stops) throw new Error(`weight length mismatch for ${reelKey}`);
  for (const w of supplied) requireSafeInteger(w, `weight for ${reelKey}`);
  const total = supplied.reduce((a, b) => a + b, 0);
  requireSafeInteger(total, `weight total for ${reelKey}`);
  if (total <= 0) throw new Error(`all-zero weights for ${reelKey}`);
  return supplied;
}

function pickWeighted(weights, rng) {
  let total = 0;
  for (const w of weights) {
    requireSafeInteger(w, 'weight');
    total += w;
  }
  requireSafeInteger(total, 'weight total');
  if (total <= 0) throw new Error('weight total must be positive');
  const draw = rng.int(1, total);
  if (!Number.isSafeInteger(draw) || draw < 1 || draw > total) {
    throw new Error(`injected RNG returned ${draw} outside 1..${total}`);
  }
  let remaining = draw;
  for (let i = 0; i < weights.length; i++) {
    remaining -= weights[i];
    if (remaining <= 0) return i;
  }
  throw new Error('weighted selection failed to resolve a stop');
}

export function drawBoard(rules, profile, rng) {
  const board = { rp: [] };
  for (const key of reelKeys(rules)) {
    const strip = stripFor(rules, profile, key);
    const idx = Number(key.replace('reelStrip', ''));
    const weights = stopWeights(rules, profile, key);
    const stop = pickWeighted(weights, rng);
    board[`reel${idx}`] = [strip[stop], strip[stop + 1], strip[stop + 2], rules.emptyRow];
    board.rp.push(stop);
  }
  return board;
}

// Per-rules memo so two different rule sets can never share a cached symbol list.
const symbolCache = new WeakMap();
function evalSymbols(rules) {
  let cached = symbolCache.get(rules);
  if (!cached) {
    cached = rules.symbols.filter((s) => s !== rules.scatter && rules.paytable[s]);
    symbolCache.set(rules, cached);
  }
  return cached;
}

const pay = (table, symbol, count) => {
  const row = table[symbol];
  if (!row) return 0;
  const value = row[count];
  return Number.isFinite(value) ? value : 0;
};

/**
 * Faithful port of the original Server.php evaluation block (lines 397-575):
 * left-to-right prefixes, wild = P_1, wild multiplier only when some-but-not-all
 * leading positions are wild, plus the original 4-cell scatter scan per reel.
 */
export function evaluate(rules, board, { bet, lines, isFree = false }) {
  const bonusMpl = isFree ? rules.constants.slotFreeMpl : 1;
  const wild = rules.wild;
  const isWild = (s) => wild.includes(s);
  const lineWins = [];
  let baseWin = 0;
  for (let k = 0; k < lines; k++) {
    const idx = rules.lines[k];
    const s = [board.reel1[idx[0] - 1], board.reel2[idx[1] - 1], board.reel3[idx[2] - 1],
      board.reel4[idx[3] - 1], board.reel5[idx[4] - 1]];
    let best = 0;
    let bestSymbol = null;
    let bestCount = 0;
    for (const symbol of evalSymbols(rules)) {
      let limit = 0;
      while (limit < 5 && (s[limit] === symbol || isWild(s[limit]))) limit++;
      for (let count = 1; count <= limit; count++) {
        let wildCount = 0;
        for (let i = 0; i < count; i++) if (isWild(s[i])) wildCount++;
        const mpl = wildCount === 0 || wildCount === count ? 1 : rules.constants.slotWildMpl;
        const win = pay(rules.paytable, symbol, count) * bet * mpl * bonusMpl;
        if (win > best) { best = win; bestSymbol = symbol; bestCount = count; }
      }
    }
    if (best > 0) { lineWins.push({ line: k, symbol: bestSymbol, count: bestCount, win: best }); baseWin += best; }
  }
  let scatterCount = 0;
  for (let r = 1; r <= 5; r++) {
    for (let p = 0; p <= 3; p++) {
      if (board[`reel${r}`][p] === rules.scatter) scatterCount++;
    }
  }
  const scatterWin = pay(rules.paytable, rules.scatter, scatterCount) * bet * lines;
  return { lineWins, baseWin, scatterCount, scatterWin, totalWin: baseWin + scatterWin, bonusMpl };
}

/**
 * One complete paid round including every resulting free spin and retrigger.
 * Optional `capture` records the free-spin sequence for tests; bulk simulation leaves it off.
 */
export function playRound(rules, profile, { bet, lines, rng, maxFeatureSpins = 20000, capture = false }) {
  assertStake(bet, lines);
  const main = drawBoard(rules, profile, rng);
  const mainEval = evaluate(rules, main, { bet, lines, isFree: false });
  const triggered = mainEval.scatterCount >= 3;
  let remaining = triggered ? rules.constants.slotFreeCount : 0;
  let featureWin = 0;
  let freeSpins = 0;
  let retriggers = 0;
  const sequence = capture ? [] : null;
  const awarded = remaining;
  while (remaining > 0) {
    if (freeSpins >= maxFeatureSpins) {
      throw new Error(`feature chain exceeded ${maxFeatureSpins} spins - run fails, not truncated`);
    }
    remaining--;
    freeSpins++;
    const board = drawBoard(rules, profile, rng);
    const res = evaluate(rules, board, { bet, lines, isFree: true });
    featureWin += res.totalWin;
    const retriggered = res.scatterCount >= 3;
    if (retriggered) {
      remaining += rules.constants.slotFreeCount;
      retriggers++;
    }
    if (sequence) {
      sequence.push({
        index: freeSpins,
        board,
        lineWins: res.lineWins,
        scatterCount: res.scatterCount,
        scatterWin: res.scatterWin,
        spinWin: res.totalWin,
        cumulativeFeatureWin: featureWin,
        retriggered,
        remainingAfter: remaining,
      });
    }
  }
  return {
    board: main,
    mainEval,
    feature: {
      triggered,
      awarded,
      spins: freeSpins,
      win: featureWin,
      retriggers,
      multiplier: rules.constants.slotFreeMpl,
      sequence,
    },
    totalWin: mainEval.totalWin + featureWin,
    wager: bet * lines,
  };
}