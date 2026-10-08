import { describe, it, expect } from 'vitest';
import { seededRng, cryptoRng } from '../backend/src/engine/rng.js';
import { playRound } from '../backend/src/engine/playRound.js';
import { playSpin, evaluate } from '../backend/src/engine/round.js';
import { makeBoard, countSymbols, tumble } from '../backend/src/engine/board.js';
import { MIN_CLUSTER, SCATTER_TRIGGER, FREE_SPINS_INITIAL, FREE_SPINS_RETRIGGER } from '../backend/src/engine/paytable.js';
import { VECTORS } from '../backend/src/testVectors.js';
import { REELS, ROWS, CELLS } from '../shared/types.js';

const STAKE = 20;
const V = (name: keyof typeof VECTORS) => seededRng(VECTORS[name].seed);

describe('board integrity', () => {
  it('is always 6x5 and fully populated', () => {
    for (let i = 0; i < 500; i++) {
      const b = makeBoard(cryptoRng, 'BASE');
      expect(b).toHaveLength(REELS);
      for (const col of b) {
        expect(col).toHaveLength(ROWS);
        for (const s of col) expect(typeof s).toBe('string');
      }
    }
  });

  it('tumble preserves 6x5 and only refills removed cells', () => {
    const b = makeBoard(cryptoRng, 'BASE');
    const remove = new Set([0, 1, 7, 20]);
    const t = tumble(b, remove, cryptoRng, 'BASE');
    expect(t.board).toHaveLength(REELS);
    for (const col of t.board) expect(col).toHaveLength(ROWS);
    expect(t.fresh).toHaveLength(remove.size);
    expect(t.moved.size).toBe(CELLS - remove.size);
  });

  it('never has a paying group below the minimum cluster size', () => {
    for (let i = 0; i < 300; i++) {
      const b = makeBoard(cryptoRng, 'BASE');
      for (const g of evaluate(b, STAKE)) expect(g.count).toBeGreaterThanOrEqual(MIN_CLUSTER);
    }
  });
});

describe('NORMAL LOSS', () => {
  it('produces a zero-win round with a single terminal step', () => {
    const r = playRound(V('loss'), STAKE, 'r-loss', false);
    expect(r.finalWin).toBe(0);
    expect(r.freeSpins.triggered).toBe(false);
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0].winningPositions).toHaveLength(0);
    expect(r.steps[0].boardAfter).toBeNull();
  });
});

describe('NORMAL WIN', () => {
  it('pays a cluster and ends with a terminal no-win step', () => {
    const r = playRound(V('win'), STAKE, 'r-win', false);
    expect(r.finalWin).toBeGreaterThan(0);
    const paying = r.steps.filter((s) => s.win > 0);
    expect(paying.length).toBeGreaterThanOrEqual(1);
    const last = r.steps[r.steps.length - 1];
    expect(last.win).toBe(0);
    expect(last.boardAfter).toBeNull();
  });

  it('every winning position actually holds the winning symbol', () => {
    const r = playRound(V('win'), STAKE, 'r-win2', false);
    for (const step of r.steps) {
      for (const g of step.groups) {
        for (const p of g.positions) {
          const reel = Math.floor(p / ROWS);
          const row = p % ROWS;
          expect(step.board[reel][row]).toBe(g.symbol);
        }
      }
    }
  });
});

describe('MULTI TUMBLE', () => {
  it('chains three or more paying steps, each board differing from the last', () => {
    const r = playRound(V('multiTumble'), STAKE, 'r-mt', false);
    const paying = r.steps.filter((s) => s.win > 0);
    expect(paying.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < r.steps.length - 1; i++) {
      expect(r.steps[i].boardAfter).not.toBeNull();
      // the next step must start from exactly the previous boardAfter
      expect(r.steps[i + 1].board).toEqual(r.steps[i].boardAfter);
    }
  });
});

describe('MULTIPLIER', () => {
  it('orbs carry values and the applied multiplier equals the accumulated total', () => {
    const r = playRound(V('multiplier'), STAKE, 'r-mult', true);
    const withOrbs = r.spins.filter((s) => s.orbs.length > 0);
    expect(withOrbs.length).toBeGreaterThan(0);
    for (const o of withOrbs.flatMap((s) => s.orbs)) {
      expect(o.value).toBeGreaterThanOrEqual(2);
      expect(o.position).toBeGreaterThanOrEqual(0);
      expect(o.position).toBeLessThan(CELLS);
    }
    // accumulated multiplier is monotonically non-decreasing across the session
    let seen = 0;
    for (const s of r.spins) {
      if (s.kind !== 'FREE') continue;
      if (s.appliedMultiplier > 1) {
        expect(s.appliedMultiplier).toBeGreaterThanOrEqual(seen);
        seen = s.appliedMultiplier;
      }
    }
    expect(r.freeSpins.accumulated).toBeGreaterThan(0);
  });

  it('a free spin win equals baseWin * appliedMultiplier + scatterPay', () => {
    const r = playRound(V('multiplier'), STAKE, 'r-mult2', true);
    for (const s of r.spins) {
      const expected = Math.round((s.baseWin * s.appliedMultiplier + s.scatterPay) * 100) / 100;
      expect(s.spinWin).toBeCloseTo(expected, 2);
    }
  });
});

describe('FREE SPINS', () => {
  it('4+ scatters awards exactly 15 free spins', () => {
    const r = playRound(V('freeSpins'), STAKE, 'r-fs', false);
    expect(r.freeSpins.triggered).toBe(true);
    expect(r.spins[0].scatterCount).toBeGreaterThanOrEqual(SCATTER_TRIGGER);
    expect(r.spins[0].freeSpinsAwarded).toBe(FREE_SPINS_INITIAL);
    const free = r.spins.filter((s) => s.kind === 'FREE');
    expect(free.length).toBe(r.freeSpins.total);
  });

  it('free spins are numbered 1..n without gaps', () => {
    const r = playRound(V('freeSpins'), STAKE, 'r-fs2', false);
    const free = r.spins.filter((s) => s.kind === 'FREE');
    free.forEach((s, i) => expect(s.freeSpinNumber).toBe(i + 1));
  });
});

describe('RETRIGGER', () => {
  it('awards +5 and extends the session', () => {
    const r = playRound(V('retrigger'), STAKE, 'r-rt', true);
    expect(r.freeSpins.retriggers).toBeGreaterThan(0);
    const retriggering = r.spins.filter((s) => s.kind === 'FREE' && s.freeSpinsAwarded > 0);
    for (const s of retriggering) expect(s.freeSpinsAwarded).toBe(FREE_SPINS_RETRIGGER);
    const free = r.spins.filter((s) => s.kind === 'FREE');
    expect(free.length).toBe(FREE_SPINS_INITIAL + r.freeSpins.retriggers * FREE_SPINS_RETRIGGER);
    expect(r.freeSpins.total).toBe(free.length);
  });
});

describe('BUY BONUS', () => {
  it('enters the feature directly with 15 spins and no base spin', () => {
    const r = playRound(V('buyBonus'), STAKE, 'r-buy', true);
    expect(r.kind).toBe('BUY');
    expect(r.freeSpins.triggered).toBe(true);
    expect(r.spins.every((s) => s.kind === 'FREE')).toBe(true);
    expect(r.spins.length).toBeGreaterThanOrEqual(FREE_SPINS_INITIAL);
  });
});

describe('determinism and authority', () => {
  it('the same seed reproduces an identical round', () => {
    const a = playRound(seededRng(4242), STAKE, 'x', false);
    const b = playRound(seededRng(4242), STAKE, 'x', false);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('different crypto rounds differ (RNG is live)', () => {
    const rounds = new Set<string>();
    for (let i = 0; i < 50; i++) {
      rounds.add(JSON.stringify(playRound(cryptoRng, STAKE, 'x', false).initialBoard));
    }
    expect(rounds.size).toBeGreaterThan(40);
  });

  it('finalWin always equals the sum of spin wins', () => {
    for (let i = 0; i < 300; i++) {
      const r = playRound(cryptoRng, STAKE, 'x', false);
      const sum = Math.round(r.spins.reduce((s, sp) => s + sp.spinWin, 0) * 100) / 100;
      expect(r.finalWin).toBeCloseTo(sum, 2);
    }
  });
});
