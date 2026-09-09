import { Prisma } from '@prisma/client';
import { FairnessInput, FairnessStream } from '../../casino-fairness.service';
import {
  SlotGameDefinition,
  SlotLineWin,
  SlotScatterWin,
  SlotSpinResult,
  SlotSymbol,
} from './slot.types';

/**
 * The pure slot engine.
 *
 * Nothing in this file touches the database, the wallet, HTTP, or global state.
 * Given a definition and a set of reel stops it always produces the same
 * result, which is what makes a settled spin reproducible by the public
 * verifier and exhaustively testable without Nest.
 */

export const slotDomain = (definition: SlotGameDefinition, version: string) =>
  `casino:slots:${definition.gameId}:${version}`;

/** Symbol lookup by id, built once per definition. */
export function symbolIndex(definition: SlotGameDefinition): Map<string, SlotSymbol> {
  return new Map(definition.symbols.map((symbol) => [symbol.id, symbol]));
}

/**
 * One unbiased stop per reel, drawn in reel order from the committed stream.
 *
 * Each reel gets its own draw against its own strip length, using the shared
 * rejection-sampling reader, so a longer strip is never biased toward its low
 * indices.
 */
export function deriveStops(fairness: FairnessInput, definition: SlotGameDefinition): number[] {
  const stream = new FairnessStream(fairness);
  return definition.strips.map((strip) => stream.nextBelow(strip.length));
}

/**
 * Reads the visible window off each strip with wrap-around.
 *
 * `matrix[row][reel] = strip[reel][(stop[reel] + row) % length]`
 *
 * Visible cells are never rolled independently: they are a consequence of one
 * stop per reel, which is what gives the game real reel-strip probabilities and
 * an exactly analysable return.
 */
export function buildMatrix(definition: SlotGameDefinition, stops: number[]): string[][] {
  if (stops.length !== definition.reels) {
    throw new RangeError('stop count does not match the reel count');
  }
  return Array.from({ length: definition.rows }, (_, row) =>
    definition.strips.map((strip, reel) => {
      const stop = stops[reel];
      if (!Number.isInteger(stop) || stop < 0 || stop >= strip.length) {
        throw new RangeError(`reel stop ${stop} is outside strip ${reel}`);
      }
      return strip[(stop + row) % strip.length];
    }));
}

/**
 * Evaluates one payline left to right from reel 1.
 *
 * A win must start on the first reel and run through consecutive positions that
 * either match the candidate symbol or are Wild. Every paying symbol is tried
 * and the highest-paying interpretation wins, which makes a leading Wild
 * unambiguous: ties break on the definition's symbol order, so the result is
 * deterministic rather than dependent on object iteration order.
 */
export function evaluateLine(
  definition: SlotGameDefinition,
  symbols: Map<string, SlotSymbol>,
  lineSymbols: string[],
): { symbolId: string; count: number; multiplierCenti: number } | null {
  const wildIds = new Set(
    definition.symbols.filter((symbol) => symbol.type === 'WILD').map((symbol) => symbol.id),
  );
  let best: { symbolId: string; count: number; multiplierCenti: number } | null = null;

  for (const candidate of definition.symbols) {
    if (candidate.type !== 'NORMAL') continue;
    const table = definition.paytable[candidate.id];
    if (!table) continue;

    let matched = 0;
    while (
      matched < lineSymbols.length
      && (lineSymbols[matched] === candidate.id || wildIds.has(lineSymbols[matched]))
    ) {
      matched += 1;
    }
    const multiplierCenti = table[matched];
    if (matched >= 3 && multiplierCenti !== undefined && multiplierCenti > 0) {
      // Strictly greater keeps the earlier symbol on a tie, so the definition's
      // declared order is the tie-break and the outcome cannot vary.
      if (!best || multiplierCenti > best.multiplierCenti) {
        best = { symbolId: candidate.id, count: matched, multiplierCenti };
      }
    }
  }
  return best;
}

/** Every winning payline on a board, each line counted at most once. */
export function evaluateLines(
  definition: SlotGameDefinition,
  matrix: string[][],
): SlotLineWin[] {
  const symbols = symbolIndex(definition);
  const wins: SlotLineWin[] = [];
  for (const payline of definition.paylines) {
    const lineSymbols = payline.rows.map((row, reel) => matrix[row][reel]);
    const win = evaluateLine(definition, symbols, lineSymbols);
    if (!win) continue;
    wins.push({
      lineId: payline.id,
      symbolId: win.symbolId,
      count: win.count,
      multiplierCenti: win.multiplierCenti,
      positions: payline.rows
        .slice(0, win.count)
        .map((row, reel) => [row, reel] as [number, number]),
    });
  }
  return wins;
}

/**
 * Scatter pays on total count anywhere on the board, independently of paylines.
 * Wilds never substitute for it.
 */
export function evaluateScatter(
  definition: SlotGameDefinition,
  matrix: string[][],
): SlotScatterWin | null {
  const rule = definition.scatter;
  if (!rule) return null;
  const positions: [number, number][] = [];
  for (let row = 0; row < matrix.length; row += 1) {
    for (let reel = 0; reel < matrix[row].length; reel += 1) {
      if (matrix[row][reel] === rule.symbolId) positions.push([row, reel]);
    }
  }
  if (positions.length < rule.minimumCount) return null;
  const tiers = Object.keys(rule.tiers).map(Number).sort((left, right) => left - right);
  const applicable = [...tiers].reverse().find((tier) => positions.length >= tier);
  if (applicable === undefined) return null;
  return {
    symbolId: rule.symbolId,
    count: positions.length,
    multiplierCenti: rule.tiers[applicable],
    positions,
  };
}

/**
 * Combines line and scatter returns into the single integer numerator described
 * in `slot.types.ts`, applying the structural max-win cap last.
 */
export function combineReturn(
  definition: SlotGameDefinition,
  lineWins: SlotLineWin[],
  scatterWin: SlotScatterWin | null,
): { returnNumerator: number; capped: boolean } {
  const lineCount = definition.paylines.length;
  const lines = lineWins.reduce((sum, win) => sum + win.multiplierCenti, 0);
  const scatter = scatterWin ? scatterWin.multiplierCenti * lineCount : 0;
  const raw = lines + scatter;
  const cap = definition.maxWinCenti * lineCount;
  return raw > cap ? { returnNumerator: cap, capped: true } : { returnNumerator: raw, capped: false };
}

/** Total return as a display multiplier of the total stake. */
export function totalMultiplier(definition: SlotGameDefinition, returnNumerator: number) {
  return new Prisma.Decimal(returnNumerator)
    .div(definition.paylines.length * 100)
    .toDecimalPlaces(4, Prisma.Decimal.ROUND_DOWN);
}

/**
 * Total return in whole virtual points, floored once at the end:
 * `floor(stake * returnNumerator / (lineCount * 100))`.
 */
export function slotPayout(
  definition: SlotGameDefinition,
  stake: bigint,
  returnNumerator: number,
): bigint {
  return (stake * BigInt(returnNumerator)) / BigInt(definition.paylines.length * 100);
}

/** Full pure resolution of one spin from a set of reel stops. */
export function resolveStops(
  definition: SlotGameDefinition,
  stops: number[],
): SlotSpinResult {
  const matrix = buildMatrix(definition, stops);
  const lineWins = evaluateLines(definition, matrix);
  const scatterWin = evaluateScatter(definition, matrix);
  const { returnNumerator, capped } = combineReturn(definition, lineWins, scatterWin);
  return {
    stops,
    matrix,
    lineWins,
    scatterWin,
    returnNumerator,
    capped,
    totalMultiplier: totalMultiplier(definition, returnNumerator).toString(),
  };
}

/** Full pure resolution of one spin from committed fairness inputs. */
export function resolveSpin(
  fairness: FairnessInput,
  definition: SlotGameDefinition,
): SlotSpinResult {
  return resolveStops(definition, deriveStops(fairness, definition));
}
