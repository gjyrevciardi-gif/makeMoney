import {
  MULTIPLIER, SCATTER,
  type Board, type OrbData, type RoundStep, type SpinKind,
  type SpinResult, type WinGroup,
} from '../../../shared/types.js';
import {
  FREE_SPINS_INITIAL, FREE_SPINS_RETRIGGER, MIN_CLUSTER,
  ORB_TABLE_TOTAL, RETRIGGER_SCATTERS, SCATTER_TRIGGER, payFor, pickOrbValue,
} from './paytable.js';
import { cloneBoard, countSymbols, makeBoard, tumble } from './board.js';
import type { Rng } from './rng.js';

/**
 * PTS are integer units - there are no fractional points. Every monetary value
 * is rounded to an integer at the moment it is created, so the wallet, the
 * ledger and the wire format are all exact integers and can never drift.
 */
const pts = (n: number): number => Math.round(n);

/** Evaluate one board: which symbols form a paying group. */
export function evaluate(board: Board, stake: number): WinGroup[] {
  const counts = countSymbols(board);
  const groups: WinGroup[] = [];
  for (const [symbol, positions] of counts) {
    if (symbol === MULTIPLIER) continue; // orbs never pay directly
    if (symbol === SCATTER) continue;    // scatter pays once per spin, not per tumble
    const count = positions.length;
    if (count < MIN_CLUSTER) continue;
    const mult = payFor(symbol, count);
    if (mult <= 0) continue;
    groups.push({ symbol, count, positions: [...positions], win: pts(mult * stake) });
  }
  groups.sort((a, b) => b.win - a.win || a.symbol.localeCompare(b.symbol));
  return groups;
}

/**
 * Run one spin: initial board, then tumble until no win.
 *
 * Multiplier orbs (free spins only) are counted ONCE when they land. They are
 * never part of a winning group, so they survive tumbles; their values are
 * carried across cascades via the survivor position map. At the end of the
 * spin every orb collected during that spin sums into a single multiplier,
 * applied once to the spin's accumulated tumble win.
 */
export interface MultiplierAccumulator {
  /** running total across the whole free-spin session */
  total: number;
}

export function playSpin(
  rng: Rng,
  stake: number,
  kind: SpinKind,
  freeSpinNumber: number,
  freeSpinsTotal: number,
  acc?: MultiplierAccumulator,
): SpinResult {
  const reelKind: 'BASE' | 'FREE' = kind === 'BASE' ? 'BASE' : 'FREE';
  let board = makeBoard(rng, reelKind);
  const initialBoard = cloneBoard(board);

  // scatters are counted on the opening board only
  const scatterCount = (countSymbols(board).get(SCATTER) ?? []).length;

  /** live orb values, keyed by current board position */
  let orbValues = new Map<number, number>();
  /** every orb collected this spin (for the multiplier total) */
  const collectedOrbs: OrbData[] = [];

  /** assign values to orbs sitting at `candidates` that we have not seen yet */
  const collectNewOrbs = (b: Board, candidates: number[] | null): void => {
    if (reelKind !== 'FREE') return;
    const orbPositions = countSymbols(b).get(MULTIPLIER) ?? [];
    const allow = candidates === null ? null : new Set(candidates);
    for (const p of orbPositions) {
      if (orbValues.has(p)) continue;              // already tracked
      if (allow !== null && !allow.has(p)) continue; // not a freshly drawn cell
      const value = pickOrbValue(rng.int(ORB_TABLE_TOTAL));
      orbValues.set(p, value);
      collectedOrbs.push({ position: p, value });
    }
  };

  // opening board: every orb is new
  collectNewOrbs(board, null);

  const steps: RoundStep[] = [];
  let baseWin = 0;
  let stepIndex = 0;

  for (;;) {
    const groups = evaluate(board, stake);
    const orbsHere: OrbData[] = [...orbValues.entries()]
      .map(([position, value]) => ({ position, value }))
      .sort((a, b) => a.position - b.position);

    if (groups.length === 0) {
      steps.push({
        index: stepIndex,
        board: cloneBoard(board),
        winningPositions: [],
        groups: [],
        win: 0,
        multiplierData: orbsHere,
        boardAfter: null,
      });
      break;
    }

    const winningPositions = groups.flatMap((g) => g.positions);
    const stepWin = pts(groups.reduce((s, g) => s + g.win, 0));
    baseWin = pts(baseWin + stepWin);

    const remove = new Set<number>(winningPositions);
    const t = tumble(board, remove, rng, reelKind);

    steps.push({
      index: stepIndex,
      board: cloneBoard(board),
      winningPositions,
      groups,
      win: stepWin,
      multiplierData: orbsHere,
      boardAfter: cloneBoard(t.board),
    });

    // carry orb values through the cascade using the survivor map
    if (reelKind === 'FREE') {
      const next = new Map<number, number>();
      for (const [oldPos, value] of orbValues) {
        const newPos = t.moved.get(oldPos);
        if (newPos !== undefined) next.set(newPos, value);
      }
      orbValues = next;
    }

    board = t.board;
    stepIndex += 1;
    collectNewOrbs(board, t.fresh); // only freshly drawn cells can be new orbs

    if (stepIndex > 40) break; // safety rail; practically unreachable
  }

  // scatter pay, awarded once per spin from the opening board
  const scatterPay = scatterCount >= SCATTER_TRIGGER
    ? pts(payFor(SCATTER, scatterCount) * stake)
    : 0;

  let freeSpinsAwarded = 0;
  if (kind === 'BASE' || kind === 'BUY') {
    if (scatterCount >= SCATTER_TRIGGER) freeSpinsAwarded = FREE_SPINS_INITIAL;
  } else if (scatterCount >= RETRIGGER_SCATTERS) {
    freeSpinsAwarded = FREE_SPINS_RETRIGGER;
  }

  // Persistent/accumulated multiplier: every orb that lands during the session
  // ADDS to a running total that never resets until the session ends. Each
  // spin's tumble win is multiplied by the total standing at the end of that
  // spin, so the feature builds as it progresses.
  const spinOrbTotal = collectedOrbs.reduce((s, o) => s + o.value, 0);
  if (reelKind === 'FREE' && acc) acc.total += spinOrbTotal;

  let appliedMultiplier = 1;
  if (reelKind === 'FREE' && baseWin > 0) {
    const running = acc ? acc.total : spinOrbTotal;
    appliedMultiplier = Math.max(running, 1);
  }

  const spinWin = pts(baseWin * appliedMultiplier + scatterPay);

  return {
    kind,
    freeSpinNumber,
    freeSpinsTotal,
    initialBoard,
    steps,
    baseWin,
    orbs: collectedOrbs,
    appliedMultiplier,
    spinWin,
    scatterCount,
    freeSpinsAwarded,
    scatterPay,
  };
}
