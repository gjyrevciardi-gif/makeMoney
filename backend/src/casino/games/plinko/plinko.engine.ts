import { Prisma } from '@prisma/client';
import { PlinkoConfig } from '../../casino.config';
import { FairnessInput, FairnessStream } from '../../casino-fairness.service';
import { binomial, twoPow } from '../../casino-math';

/**
 * Plinko mathematics.
 *
 * A ball falls through `rows` pegs, taking one binary decision per row. The
 * bucket it lands in is simply the number of RIGHT decisions, so with `rows`
 * rows there are `rows + 1` buckets and
 *
 *   P(bucket k) = C(rows, k) / 2^rows
 *
 * ---------------------------------------------------------------------------
 * Paytables are frozen, not generated at runtime
 * ---------------------------------------------------------------------------
 *
 * The nine tables below are version 1 constants stored in hundredths, and they
 * are the authoritative source of every Plinko payout. They were produced once
 * from a documented risk profile - relative weight P(k)^(-alpha) with alpha of
 * 0.30 (LOW), 0.55 (MEDIUM) and 0.85 (HIGH), scaled to a 97% target and with
 * the centre bucket tuned to close the rounding gap - and then frozen here.
 *
 * Because the table is the configuration, each table's theoretical RTP is
 * *computed* from it exactly:
 *
 *   RTP = sum_k P(k) * multiplier(k)
 *
 * and that exact value is embedded in the configuration version, so a settled
 * round always remains reproducible from what it recorded. There is deliberately
 * no environment variable that can silently reprice an existing table.
 */

export type PlinkoRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export const PLINKO_ROWS = [8, 12, 16] as const;
export const PLINKO_RISKS: PlinkoRisk[] = ['LOW', 'MEDIUM', 'HIGH'];

/** Frozen v1 paytables, in hundredths of a multiplier. Symmetric by construction. */
const PAYTABLES_V1: Record<string, number[]> = {
  'LOW:8': [295, 158, 108, 88, 83, 88, 108, 158, 295],
  'LOW:12': [636, 302, 181, 126, 99, 86, 81, 86, 99, 126, 181, 302, 636],
  'LOW:16': [
    1397, 608, 332, 209, 147, 113, 94, 85, 81, 85, 94, 113, 147, 209, 332, 608, 1397,
  ],
  'MEDIUM:8': [708, 226, 113, 77, 69, 77, 113, 226, 708],
  'MEDIUM:12': [2869, 731, 286, 148, 95, 73, 67, 73, 95, 148, 286, 731, 2869],
  'MEDIUM:16': [
    12104, 2634, 870, 373, 195, 120, 86, 71, 67, 71, 86, 120, 195, 373, 870, 2634, 12104,
  ],
  'HIGH:8': [1829, 312, 108, 60, 49, 60, 108, 312, 1829],
  'HIGH:12': [15024, 1818, 427, 153, 77, 52, 45, 52, 77, 153, 427, 1818, 15024],
  'HIGH:16': [
    133948, 12689, 2289, 618, 227, 108, 64, 48, 43, 48, 64, 108, 227, 618, 2289, 12689,
    133948,
  ],
};

export const isSupportedRows = (rows: number): boolean =>
  (PLINKO_ROWS as readonly number[]).includes(rows);

export const isSupportedRisk = (risk: string): risk is PlinkoRisk =>
  PLINKO_RISKS.includes(risk as PlinkoRisk);

/** The frozen table in hundredths. Throws for an unsupported combination. */
export function plinkoPaytableCenti(rows: number, risk: PlinkoRisk): number[] {
  const table = PAYTABLES_V1[`${risk}:${rows}`];
  if (!table) throw new RangeError(`no plinko paytable for ${risk}:${rows}`);
  return [...table];
}

/** The same table as display multipliers, e.g. 295 -> "2.95". */
export function plinkoPaytable(rows: number, risk: PlinkoRisk): string[] {
  return plinkoPaytableCenti(rows, risk).map((centi) =>
    new Prisma.Decimal(centi).div(100).toFixed(2));
}

/** Exact P(bucket k) = C(rows, k) / 2^rows. */
export function plinkoBucketProbability(rows: number, bucket: number) {
  return new Prisma.Decimal(binomial(rows, bucket).toString())
    .div(new Prisma.Decimal(twoPow(rows).toString()));
}

/**
 * Exact theoretical RTP of a frozen table, in basis points.
 *
 * Computed as an integer ratio so there is no rounding in the result itself:
 *
 *   rtpBps = sum_k C(rows,k) * centi(k) * 100 / 2^rows
 */
export function plinkoTheoreticalRtpBps(rows: number, risk: PlinkoRisk): number {
  const table = plinkoPaytableCenti(rows, risk);
  let weighted = 0n;
  for (let bucket = 0; bucket <= rows; bucket += 1) {
    weighted += binomial(rows, bucket) * BigInt(table[bucket]);
  }
  // Round to the nearest basis point.
  const scaled = (weighted * 100n * 2n) / twoPow(rows);
  return Number((scaled + 1n) / 2n);
}

/** Exact theoretical RTP as a Decimal fraction, for assertions and reporting. */
export function plinkoTheoreticalRtp(rows: number, risk: PlinkoRisk) {
  const table = plinkoPaytableCenti(rows, risk);
  let weighted = 0n;
  for (let bucket = 0; bucket <= rows; bucket += 1) {
    weighted += binomial(rows, bucket) * BigInt(table[bucket]);
  }
  return new Prisma.Decimal(weighted.toString())
    .div(new Prisma.Decimal((twoPow(rows) * 100n).toString()));
}

/**
 * Version of one Plinko configuration. Rows, risk and the table's own exact RTP
 * are all part of the identity, so a round can never be reinterpreted under a
 * different table later.
 */
export function plinkoVersion(config: PlinkoConfig, rows: number, risk: PlinkoRisk): string {
  return `plinko.v${config.mathVersion}.r${rows}.${risk.toLowerCase()}`
    + `.rtp${plinkoTheoreticalRtpBps(rows, risk)}`;
}

export const plinkoDomain = (version: string) => `casino:plinko:${version}`;

export type PlinkoStep = 'L' | 'R';

/**
 * Deterministic path: one binary decision per row, drawn from the committed
 * fairness stream. The same seed, nonce and configuration version always
 * reproduce the same path.
 */
export function plinkoPath(fairness: FairnessInput, rows: number): PlinkoStep[] {
  const stream = new FairnessStream(fairness);
  return Array.from({ length: rows }, () => (stream.nextBelow(2) === 1 ? 'R' : 'L'));
}

/** Bucket index is the number of RIGHT decisions, always within [0, rows]. */
export function plinkoBucket(path: PlinkoStep[]): number {
  return path.reduce((count, step) => count + (step === 'R' ? 1 : 0), 0);
}

/** Total return in whole virtual points, floored, matching the house convention. */
export function plinkoPayout(stake: bigint, multiplierCenti: number): bigint {
  return (stake * BigInt(multiplierCenti)) / 100n;
}

export type PlinkoResolution = {
  path: PlinkoStep[];
  bucketIndex: number;
  multiplierCenti: number;
  multiplier: string;
  payout: bigint;
  paytable: string[];
};

/** Full server-authoritative resolution of one Plinko drop. */
export function resolvePlinko(
  fairness: FairnessInput,
  rows: number,
  risk: PlinkoRisk,
  stake: bigint,
): PlinkoResolution {
  const path = plinkoPath(fairness, rows);
  const bucketIndex = plinkoBucket(path);
  const table = plinkoPaytableCenti(rows, risk);
  const multiplierCenti = table[bucketIndex];
  if (multiplierCenti === undefined) {
    throw new RangeError('plinko bucket fell outside its paytable');
  }
  return {
    path,
    bucketIndex,
    multiplierCenti,
    multiplier: new Prisma.Decimal(multiplierCenti).div(100).toFixed(2),
    payout: plinkoPayout(stake, multiplierCenti),
    paytable: plinkoPaytable(rows, risk),
  };
}
