'use strict';

/**
 * Test-only call budget for a constructor-injected Classic RNG.
 *
 * Each budget is the number of int() calls one paid round's playRound makes.
 * The next call after the last budget throws, so a stray bet cannot draw.
 * This module starts no server and reads no environment.
 */

function createCallBudgetRng(budgets, nextDraw) {
  if (!Array.isArray(budgets) || budgets.length === 0 || budgets.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new Error('SCRIPTED_RNG_BUDGETS');
  }
  if (typeof nextDraw !== 'function') throw new Error('SCRIPTED_RNG_DRAW');
  let span = 0;
  let used = 0;
  let calls = 0;
  function rng(upper) {
    if (span >= budgets.length) {
      const error = new Error('SCRIPTED_RNG_EXHAUSTED');
      error.code = 'SCRIPTED_RNG_EXHAUSTED';
      throw error;
    }
    const value = nextDraw(span, upper);
    calls += 1;
    used += 1;
    if (used >= budgets[span]) {
      span += 1;
      used = 0;
    }
    return value;
  }
  rng.calls = () => calls;
  return rng;
}

module.exports = { createCallBudgetRng };
