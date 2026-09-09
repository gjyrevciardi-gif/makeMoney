import { Prisma } from '@prisma/client';
import { DiceConfig } from '../../casino.config';
import { FairnessInput, FairnessStream } from '../../casino-fairness.service';

export type DiceMode = 'ROLL_UNDER' | 'ROLL_OVER';

/**
 * Dice math.
 *
 * The roll is an integer on [0, scale) — [0, 9999] by default — which the
 * client displays as 0.00 to 99.99. Targets use the same integer scale, so no
 * payout-critical decision ever depends on binary floating point.
 *
 *   ROLL_UNDER(t): the player wins iff roll <  t   =>  winCount = t
 *   ROLL_OVER(t):  the player wins iff roll >  t   =>  winCount = scale - 1 - t
 *
 *   probability = winCount / scale
 *   multiplier  = RTP / probability
 *               = (rtpBps / 10000) / (winCount / scale)
 *               = rtpBps / winCount            (exact, because scale = 10000)
 *   payout      = floor(stake * multiplier)    (total return, stake included)
 *
 * The multiplier definition makes the theoretical return
 *
 *   E[return]/stake = probability * multiplier
 *                   = (winCount / 10000) * (rtpBps / winCount)
 *                   = rtpBps / 10000
 *
 * identical to the configured RTP for *every* legal target. The house edge is
 * a property of this formula alone: it is never adjusted per player, per
 * session, or in response to results.
 */

export function diceWinCount(mode: DiceMode, target: number, config: DiceConfig): number {
  return mode === 'ROLL_UNDER' ? target : config.scale - 1 - target;
}

/** Exact win probability as a Decimal on (0, 1). */
export function diceProbability(mode: DiceMode, target: number, config: DiceConfig) {
  return new Prisma.Decimal(diceWinCount(mode, target, config)).div(config.scale);
}

/**
 * Multiplier applied to the stake on a win, truncated to 8 decimals so the
 * stored Decimal(28,8) column holds the exact value that was paid.
 */
export function diceMultiplier(mode: DiceMode, target: number, config: DiceConfig) {
  const winCount = diceWinCount(mode, target, config);
  if (winCount <= 0) throw new RangeError('dice target admits no winning outcomes');
  return new Prisma.Decimal(config.rtpBps)
    .div(winCount)
    .toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);
}

export function diceIsWin(roll: number, mode: DiceMode, target: number): boolean {
  return mode === 'ROLL_UNDER' ? roll < target : roll > target;
}

/** Total return in whole virtual points, floored. Losing rounds return 0. */
export function dicePayout(stake: bigint, multiplier: Prisma.Decimal): bigint {
  return BigInt(
    new Prisma.Decimal(stake.toString())
      .mul(multiplier)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_FLOOR)
      .toFixed(0),
  );
}

export const diceDomain = (config: DiceConfig) => `casino:dice:${config.version}`;

/** Deterministic roll for a round; reproducible by the public verifier. */
export function diceRoll(fairness: FairnessInput, config: DiceConfig): number {
  return new FairnessStream(fairness).nextBelow(config.scale);
}

export type DiceResolution = {
  roll: number;
  won: boolean;
  multiplier: Prisma.Decimal;
  payout: bigint;
  winCount: number;
  probability: Prisma.Decimal;
};

/** Full server-authoritative resolution of one dice round. */
export function resolveDice(
  fairness: FairnessInput,
  config: DiceConfig,
  mode: DiceMode,
  target: number,
  stake: bigint,
): DiceResolution {
  const roll = diceRoll(fairness, config);
  const won = diceIsWin(roll, mode, target);
  const multiplier = diceMultiplier(mode, target, config);
  return {
    roll,
    won,
    multiplier,
    payout: won ? dicePayout(stake, multiplier) : 0n,
    winCount: diceWinCount(mode, target, config),
    probability: diceProbability(mode, target, config),
  };
}
