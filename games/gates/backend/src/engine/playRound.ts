import type { RoundResponse, SpinKind, SpinResult } from '../../../shared/types.js';
import { FREE_SPINS_INITIAL } from './paytable.js';
import { playSpin, type MultiplierAccumulator } from './round.js';
import type { Rng } from './rng.js';

/**
 * PTS are integer units - there are no fractional points. Every monetary value
 * is rounded to an integer at the moment it is created, so the wallet, the
 * ledger and the wire format are all exact integers and can never drift.
 */
const pts = (n: number): number => Math.round(n);

/** Hard cap so a pathological retrigger chain can never hang the server. */
const MAX_FREE_SPINS = 500;

/**
 * Play one complete round: the paid spin, plus the entire free-spin session if
 * one triggers. The outcome is generated ONCE here and is authoritative.
 *
 * There is deliberately no bank gate, no percent knob, and no result
 * regeneration - the first outcome produced is the outcome returned.
 */
export function playRound(
  rng: Rng,
  stake: number,
  roundId: string,
  buyBonus: boolean,
): Omit<RoundResponse, 'balanceAfter'> {
  const spins: SpinResult[] = [];
  const kind: SpinKind = buyBonus ? 'BUY' : 'BASE';

  let freeSpinsRemaining = 0;
  let freeSpinsTotal = 0;
  let retriggers = 0;
  const acc: MultiplierAccumulator = { total: 0 };

  if (buyBonus) {
    // Buy Bonus enters the feature directly with the standard 15 spins.
    freeSpinsRemaining = FREE_SPINS_INITIAL;
    freeSpinsTotal = FREE_SPINS_INITIAL;
  } else {
    const first = playSpin(rng, stake, 'BASE', 0, 0);
    spins.push(first);
    if (first.freeSpinsAwarded > 0) {
      freeSpinsRemaining = first.freeSpinsAwarded;
      freeSpinsTotal = first.freeSpinsAwarded;
    }
  }

  let played = 0;
  while (freeSpinsRemaining > 0 && played < MAX_FREE_SPINS) {
    freeSpinsRemaining -= 1;
    played += 1;
    const fs = playSpin(rng, stake, 'FREE', played, freeSpinsTotal, acc);
    if (fs.freeSpinsAwarded > 0) {
      freeSpinsRemaining += fs.freeSpinsAwarded;
      freeSpinsTotal += fs.freeSpinsAwarded;
      retriggers += 1;
      fs.freeSpinsTotal = freeSpinsTotal;
    }
    spins.push(fs);
  }

  const finalWin = pts(spins.reduce((s, sp) => s + sp.spinWin, 0));
  const accumulated = acc.total;

  const head = spins[0];

  return {
    roundId,
    stake,
    kind,
    initialBoard: head.initialBoard,
    steps: head.steps,
    spins,
    freeSpins: {
      triggered: freeSpinsTotal > 0,
      total: freeSpinsTotal,
      retriggers,
      accumulated,
    },
    finalWin,
    createdAt: Date.now(),
  };
}
