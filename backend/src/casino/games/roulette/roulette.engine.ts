import { Prisma } from '@prisma/client';
import { RouletteConfig } from '../../casino.config';
import { FairnessInput, FairnessStream } from '../../casino-fairness.service';

/**
 * European (single-zero) roulette.
 *
 * The wheel has 37 pockets, 0 through 36. Payouts are the canonical ones and
 * are deliberately *not* configurable: the house edge comes from the single
 * zero, exactly as the published rules say, rather than from a tuned table.
 *
 * Every supported bet therefore returns the same expectation:
 *
 *   straight: (1/37)  * 36 = 36/37
 *   even money: (18/37) * 2 = 36/37
 *   dozen/column: (12/37) * 3 = 36/37
 *
 * Zero loses every outside bet, which is the whole of the edge.
 *
 * Multipliers below are *total return* including the stake, matching the
 * convention used across this casino: a straight-up win pays 36x the stake,
 * i.e. 35:1 profit.
 */

export type RouletteBetType =
  | 'STRAIGHT'
  | 'RED'
  | 'BLACK'
  | 'ODD'
  | 'EVEN'
  | 'LOW'
  | 'HIGH'
  | 'DOZEN_1'
  | 'DOZEN_2'
  | 'DOZEN_3'
  | 'COLUMN_1'
  | 'COLUMN_2'
  | 'COLUMN_3';

export const ROULETTE_BET_TYPES: RouletteBetType[] = [
  'STRAIGHT', 'RED', 'BLACK', 'ODD', 'EVEN', 'LOW', 'HIGH',
  'DOZEN_1', 'DOZEN_2', 'DOZEN_3', 'COLUMN_1', 'COLUMN_2', 'COLUMN_3',
];

/** Canonical European wheel colouring. */
export const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export const isRed = (pocket: number) => RED_NUMBERS.has(pocket);
export const isBlack = (pocket: number) => pocket !== 0 && !RED_NUMBERS.has(pocket);

export function pocketColour(pocket: number): 'GREEN' | 'RED' | 'BLACK' {
  if (pocket === 0) return 'GREEN';
  return isRed(pocket) ? 'RED' : 'BLACK';
}

/** Total return multiplier for a winning bet, stake included. */
export function rouletteMultiplier(type: RouletteBetType): number {
  if (type === 'STRAIGHT') return 36;
  if (type.startsWith('DOZEN') || type.startsWith('COLUMN')) return 3;
  return 2;
}

/**
 * Whether a bet wins against a pocket. Zero is green, neither odd nor even,
 * and outside neither half, dozen, nor column, so it loses every outside bet.
 */
export function rouletteWins(
  type: RouletteBetType,
  pocket: number,
  straightNumber?: number,
): boolean {
  if (type === 'STRAIGHT') return straightNumber === pocket;
  if (pocket === 0) return false;
  switch (type) {
    case 'RED': return isRed(pocket);
    case 'BLACK': return isBlack(pocket);
    case 'ODD': return pocket % 2 === 1;
    case 'EVEN': return pocket % 2 === 0;
    case 'LOW': return pocket >= 1 && pocket <= 18;
    case 'HIGH': return pocket >= 19 && pocket <= 36;
    case 'DOZEN_1': return pocket >= 1 && pocket <= 12;
    case 'DOZEN_2': return pocket >= 13 && pocket <= 24;
    case 'DOZEN_3': return pocket >= 25 && pocket <= 36;
    case 'COLUMN_1': return pocket % 3 === 1;
    case 'COLUMN_2': return pocket % 3 === 2;
    case 'COLUMN_3': return pocket % 3 === 0;
    default: return false;
  }
}

/** Number of winning pockets, used to state the expectation explicitly. */
export function rouletteWinningPockets(
  type: RouletteBetType,
  straightNumber?: number,
): number {
  let count = 0;
  for (let pocket = 0; pocket <= 36; pocket += 1) {
    if (rouletteWins(type, pocket, straightNumber)) count += 1;
  }
  return count;
}

export const rouletteDomain = (config: RouletteConfig) => `casino:roulette:${config.version}`;

/** Deterministic winning pocket; reproducible by the public verifier. */
export function rouletteSpin(fairness: FairnessInput, config: RouletteConfig): number {
  return new FairnessStream(fairness).nextBelow(config.pockets);
}

export type RouletteBetInput = {
  type: RouletteBetType;
  amount: bigint;
  number?: number;
};

export type RouletteBetResult = {
  type: RouletteBetType;
  number: number | null;
  amount: string;
  won: boolean;
  multiplier: number;
  payout: string;
};

export type RouletteResolution = {
  pocket: number;
  colour: 'GREEN' | 'RED' | 'BLACK';
  bets: RouletteBetResult[];
  totalStake: bigint;
  totalPayout: bigint;
};

/**
 * Resolves a whole spin. Several bets may share one spin; each is settled
 * independently against the single authoritative pocket and the returns are
 * summed.
 */
export function resolveRoulette(
  fairness: FairnessInput,
  config: RouletteConfig,
  bets: RouletteBetInput[],
): RouletteResolution {
  const pocket = rouletteSpin(fairness, config);
  let totalStake = 0n;
  let totalPayout = 0n;
  const results = bets.map((bet) => {
    const won = rouletteWins(bet.type, pocket, bet.number);
    const multiplier = rouletteMultiplier(bet.type);
    const payout = won ? bet.amount * BigInt(multiplier) : 0n;
    totalStake += bet.amount;
    totalPayout += payout;
    return {
      type: bet.type,
      number: bet.number ?? null,
      amount: bet.amount.toString(),
      won,
      multiplier,
      payout: payout.toString(),
    };
  });
  return {
    pocket,
    colour: pocketColour(pocket),
    bets: results,
    totalStake,
    totalPayout,
  };
}

/**
 * Expected return of one bet type.
 *
 * Multiplied before dividing so the result is exactly 36/37 rather than a
 * rounded intermediate: for every supported bet, winningPockets * multiplier
 * is exactly 36, which is the real statement of the single-zero edge.
 */
export function rouletteExpectedReturn(type: RouletteBetType, straightNumber?: number) {
  const winning = rouletteWinningPockets(type, straightNumber);
  return new Prisma.Decimal(winning * rouletteMultiplier(type)).div(37);
}

/** Integer form of the same identity: exact, with no rounding involved. */
export function rouletteReturnNumerator(type: RouletteBetType, straightNumber?: number) {
  return rouletteWinningPockets(type, straightNumber) * rouletteMultiplier(type);
}
