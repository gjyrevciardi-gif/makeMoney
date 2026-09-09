import { Prisma } from '@prisma/client';
import { MinesConfig } from '../../casino.config';
import { FairnessInput, distinctPositions } from '../../casino-fairness.service';
import { binomial } from '../../casino-math';

/**
 * Mines math.
 *
 * A board of `cells` (25) hides `mines` bombs. After the player has safely
 * revealed `revealed` cells, the probability of having survived that far is
 *
 *   P(survive k) = C(cells - mines, k) / C(cells, k)
 *
 * so the fair (zero-edge) multiplier is its reciprocal, and the configured RTP
 * scales it:
 *
 *   multiplier(k) = (rtpBps / 10000) * C(cells, k) / C(cells - mines, k)
 *
 * For any fixed strategy "reveal exactly k cells then cash out" the expected
 * return is
 *
 *   P(survive k) * stake * multiplier(k) = stake * rtpBps / 10000
 *
 * i.e. exactly the configured RTP, independent of both the mine count and how
 * many cells the player chooses to open. There is therefore no strategy-based
 * RTP leak and no need to bias the board: the edge lives entirely in this
 * formula. Mine positions are drawn once, at round start, from the committed
 * server seed and never depend on who is playing or how they are doing.
 *
 * Binomials are computed in BigInt so that large boards stay exact; the final
 * division is a Decimal with 8 stored places.
 */

// Combinatorics live in the shared casino math module; re-exported here so the
// mines engine remains the single import surface for its own callers.
export { binomial };

export function minesMaxSafeCells(config: MinesConfig, mines: number) {
  return config.cells - mines;
}

/** Probability of surviving exactly `revealed` safe reveals. */
export function minesSurvivalProbability(config: MinesConfig, mines: number, revealed: number) {
  const safe = binomial(config.cells - mines, revealed);
  const total = binomial(config.cells, revealed);
  if (total === 0n) throw new RangeError('invalid mines survival parameters');
  return new Prisma.Decimal(safe.toString()).div(new Prisma.Decimal(total.toString()));
}

/**
 * Authoritative cashout multiplier after `revealed` safe reveals.
 * `revealed` must be at least 1: cashing out before opening a cell would return
 * less than the stake and is rejected at the service boundary.
 */
export function minesMultiplier(config: MinesConfig, mines: number, revealed: number) {
  if (revealed < 0 || revealed > minesMaxSafeCells(config, mines)) {
    throw new RangeError('invalid revealed count for mines multiplier');
  }
  const total = binomial(config.cells, revealed);
  const safe = binomial(config.cells - mines, revealed);
  if (safe === 0n) throw new RangeError('mines survival is impossible for this configuration');
  return new Prisma.Decimal(config.rtpBps)
    .div(10_000)
    .mul(new Prisma.Decimal(total.toString()))
    .div(new Prisma.Decimal(safe.toString()))
    .toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);
}

/** Total return in whole virtual points, floored. */
export function minesPayout(stake: bigint, multiplier: Prisma.Decimal): bigint {
  return BigInt(
    new Prisma.Decimal(stake.toString())
      .mul(multiplier)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_FLOOR)
      .toFixed(0),
  );
}

/**
 * Largest multiplier the configuration can ever produce, reached by clearing
 * every safe cell. Used to prove at startup that a maximum-stake win still
 * fits the BigInt wallet column.
 */
export function minesMaxMultiplier(config: MinesConfig) {
  let largest = new Prisma.Decimal(0);
  for (let mines = config.minMines; mines <= config.maxMines; mines += 1) {
    const candidate = minesMultiplier(config, mines, minesMaxSafeCells(config, mines));
    if (candidate.greaterThan(largest)) largest = candidate;
  }
  return largest;
}

export const minesDomain = (config: MinesConfig) => `casino:mines:${config.version}`;

/** Deterministic mine placement; reproducible by the public verifier. */
export function minesBoard(fairness: FairnessInput, config: MinesConfig, mines: number): number[] {
  return distinctPositions(fairness, config.cells, mines);
}

/** Full multiplier ladder, safe to publish: it is derived from public config only. */
export function minesLadder(config: MinesConfig, mines: number) {
  const ladder: { revealed: number; multiplier: string }[] = [];
  for (let revealed = 1; revealed <= minesMaxSafeCells(config, mines); revealed += 1) {
    ladder.push({ revealed, multiplier: minesMultiplier(config, mines, revealed).toString() });
  }
  return ladder;
}
