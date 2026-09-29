// Isolated runtime maths. Imports the EXACT validated engine, rules and frozen profile.
// This module is the only place the runtime obtains outcomes.
import { createHash, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRules, canonicalHash, playRound, evaluate } from '../math/engine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const MATH_DIR = join(HERE, '..', 'math');
export const ENGINE_PATH = join(MATH_DIR, 'engine.mjs');
export const RULES_PATH = join(MATH_DIR, 'data', 'rules.json');
export const FROZEN_PROFILE_PATH = join(MATH_DIR, 'profiles', 'lucky-lady.rtp50.v1.json');

// Pinned from accepted commit 5beffea. Fail closed if the imported evaluator or rules change.
export const PINNED_ENGINE_SHA256 = '0f02bb1e78eafdd99a51015c4bf83848050ca6b6e898123759d1442787d12843';
export const PINNED_RULES_SHA256 = '4c03dd436f18307d9f98dc2148ff422251faa2d5c1c928062257187883acfc57';
export const PINNED_PROFILE_FILE_SHA256 = '14a5f695611aebd33b0f27f7894731b5e0e03934fc2261366598f84a0314bb65';
export const FROZEN_PROFILE_HASH = 'eb0a22171a3479cea3b0238269edd4b0dc5d9486c57e4b057fa6ee0f1a70be5f';
export const SUPPORTED_LINES = 10;
export const PROFILE_VERSION = 1;
export const NATIVE_STAKE_CENTS = [1, 2, 5, 10, 20];   // 0.01 .. 0.20 per line

const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
let cachedMath = null;

/** Loads and verifies the imported evaluator, rules and frozen profile. Fails closed. */
export function loadVerifiedMath() {
  if (cachedMath) return cachedMath;
  const engineDigest = sha256File(ENGINE_PATH);
  if (engineDigest !== PINNED_ENGINE_SHA256) throw new Error(`evaluator hash mismatch: ${engineDigest}`);
  const rulesDigest = sha256File(RULES_PATH);
  if (rulesDigest !== PINNED_RULES_SHA256) throw new Error(`rules hash mismatch: ${rulesDigest}`);
  const rules = loadRules();
  const profileFileDigest = sha256File(FROZEN_PROFILE_PATH);
  if (profileFileDigest !== PINNED_PROFILE_FILE_SHA256) throw new Error(`profile file hash mismatch: ${profileFileDigest}`);
  const profile = JSON.parse(readFileSync(FROZEN_PROFILE_PATH, 'utf8'));
  if (canonicalHash(profile) !== profile.canonicalHash) throw new Error('frozen profile is tampered');
  if (profile.canonicalHash !== FROZEN_PROFILE_HASH) throw new Error('unexpected frozen profile hash');
  if (profile.validatedLines !== SUPPORTED_LINES) throw new Error('profile no longer targets the supported line count');
  cachedMath = {
    rules, profile,
    hashes: { engineSha256: engineDigest, rulesSha256: rulesDigest, profileFileSha256: profileFileDigest, profileCanonicalHash: profile.canonicalHash },
  };
  return cachedMath;
}

/** Production RNG: OS CSPRNG behind the engine's single int(min,max) interface. */
export function createProductionRng() {
  return {
    int(min, max) {
      if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) throw new Error('invalid RNG bounds');
      return randomInt(min, max + 1);
    },
  };
}

/** Deterministic RNG. Constructed explicitly by the test entry point only. */
export function createDeterministicRng(seed) {
  let state = (0x9e3779b9 ^ parseInt(createHash('sha256').update(String(seed)).digest('hex').slice(0, 8), 16)) | 0;
  const UINT32 = 0x100000000;
  const next32 = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  return {
    int(min, max) {
      if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) throw new Error('invalid RNG bounds');
      const span = max - min + 1;
      if (span > UINT32) throw new Error('unsupported span');
      if (span === 1) return min;
      const limit = Math.floor(UINT32 / span) * span;
      let draw;
      do { draw = next32(); } while (draw >= limit);
      return min + (draw % span);
    },
  };
}

export function assertSupportedLines(lines) {
  if (lines !== SUPPORTED_LINES) {
    const error = new Error(`unsupported line count ${lines}; this pilot runs only ${SUPPORTED_LINES} lines`);
    error.code = 'UNSUPPORTED_LINES';
    error.status = 409;
    throw error;
  }
}

export function assertNativeStake(cents) {
  if (!Number.isSafeInteger(cents) || !NATIVE_STAKE_CENTS.includes(cents)) {
    const error = new Error(`unsupported stake ${cents} cents; native ladder is ${NATIVE_STAKE_CENTS.join(',')}`);
    error.code = 'UNSUPPORTED_STAKE';
    error.status = 409;
    throw error;
  }
  return cents;
}

/**
 * Draws one complete paid round: the paid board plus the whole future free-spin sequence.
 * Called once per accepted paid round; the result is persisted before any accounting.
 */
export function generateCompleteRound({ rng, bet, lines }) {
  assertSupportedLines(lines);
  assertNativeStake(bet);
  const { rules, profile } = loadVerifiedMath();
  const round = playRound(rules, profile, { bet, lines, rng, capture: true });
  return { rules, profile, round };
}

/** Native red/black gamble: the injected RNG picks the card; no bank or user targeting. */
export function drawGamble({ rng, choice }) {
  if (choice !== 'red' && choice !== 'black') throw new Error('invalid gamble choice');
  const win = rng.int(1, 2) === 1;
  const winner = choice === 'red' ? ['D', 'H'] : ['C', 'S'];
  const loser = choice === 'red' ? ['C', 'S'] : ['D', 'H'];
  const dealerCard = (win ? winner : loser)[rng.int(0, 1)];
  return { win, dealerCard };
}

export function evaluateBoard(board, { bet, lines, isFree }) {
  const { rules } = loadVerifiedMath();
  return evaluate(rules, board, { bet, lines, isFree });
}

export function freeSpinCount() {
  return loadVerifiedMath().rules.constants.slotFreeCount;
}
export function freeSpinMultiplier() {
  return loadVerifiedMath().rules.constants.slotFreeMpl;
}