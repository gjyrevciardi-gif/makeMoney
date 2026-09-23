import { FairnessInput, FairnessStream } from '../../casino-fairness.service';
import {
  orbWeightTotal,
  symbolWeightTotal,
} from './tumble.definition';
import {
  TumbleCell,
  TumbleFeature,
  TumbleGameDefinition,
  TumbleMode,
  TumbleRetrigger,
  TumbleRoundResult,
  TumbleSpin,
  TumbleStep,
  TumbleWin,
} from './tumble.types';

/**
 * The pure tumbling-slot engine.
 *
 * Nothing in this file touches the database, the wallet, HTTP, or global state.
 * Given a definition and committed fairness inputs it always produces the same
 * round, which is what makes a settled round reproducible by the public
 * verifier and exhaustively testable without Nest.
 *
 * Every draw comes from one shared `FairnessStream` in a fixed order, so a
 * verifier replaying the same seed, client seed and nonce rebuilds the whole
 * round - the opening board, every refill, every orb face, and every free spin
 * - byte for byte.
 */

export const tumbleDomain = (definition: TumbleGameDefinition, version: string) =>
  `casino:tumble:${definition.gameId}:${version}`;

/** Draw order inside one board fill, kept explicit because it is the contract. */
type Stream = Pick<FairnessStream, 'nextBelow'>;

type Weighted = { id: string; weight: number };

/** Weighted choice over an integer weight table, using one uniform draw. */
function weightedPick(stream: Stream, entries: Weighted[], total: number): string {
  let roll = stream.nextBelow(total);
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) return entry.id;
  }
  // Unreachable while the table and its total agree; a definition that made it
  // reachable would already have failed validation.
  throw new RangeError('weight table does not sum to its declared total');
}

function payingEntries(definition: TumbleGameDefinition): Weighted[] {
  return definition.symbols
    .filter((symbol) => symbol.type === 'PAY')
    .map((symbol) => ({ id: symbol.id, weight: definition.symbolWeights[symbol.id] }));
}

function scatterId(definition: TumbleGameDefinition): string {
  return definition.symbols.find((symbol) => symbol.type === 'SCATTER')!.id;
}

function orbId(definition: TumbleGameDefinition): string {
  return definition.symbols.find((symbol) => symbol.type === 'ORB')!.id;
}

/** Symbol id -> wire code, and back, built once per definition. */
export function codeOf(definition: TumbleGameDefinition): Map<string, string> {
  return new Map(definition.symbols.map((symbol) => [symbol.id, symbol.code]));
}

/**
 * Fills one cell: a multiplier orb with its face, or a weighted paying symbol.
 *
 * The orb decision is always drawn first and always drawn, even when the orb
 * loses, so the stream position after a fill never depends on its outcome.
 */
function fillCell(
  stream: Stream,
  definition: TumbleGameDefinition,
  paying: Weighted[],
  payingTotal: number,
  orbFaces: Weighted[],
  orbTotal: number,
): TumbleCell {
  if (stream.nextBelow(10_000) < definition.orbWeight) {
    return { symbol: orbId(definition), orbValue: Number(weightedPick(stream, orbFaces, orbTotal)) };
  }
  return { symbol: weightedPick(stream, paying, payingTotal) };
}

/** Context carried through one round so the weight tables are built once. */
type Tables = {
  paying: Weighted[];
  payingTotal: number;
  orbFaces: Weighted[];
  orbTotal: number;
  scatter: string;
  orb: string;
  code: Map<string, string>;
};

export function buildTables(definition: TumbleGameDefinition): Tables {
  return {
    paying: payingEntries(definition),
    payingTotal: symbolWeightTotal(definition),
    orbFaces: definition.orbFaces.map((face) => ({
      id: String(face.value),
      weight: face.weight,
    })),
    orbTotal: orbWeightTotal(definition),
    scatter: scatterId(definition),
    orb: orbId(definition),
    code: codeOf(definition),
  };
}

const fill = (stream: Stream, definition: TumbleGameDefinition, tables: Tables) =>
  fillCell(stream, definition, tables.paying, tables.payingTotal, tables.orbFaces, tables.orbTotal);

/**
 * The opening board of one spin.
 *
 * Scatters are decided per reel before the reel is filled, at most one per reel,
 * which is what makes the trigger count a clean binomial over the reels and
 * keeps a refill from ever opening the feature mid-chain.
 */
export function openingBoard(
  stream: Stream,
  definition: TumbleGameDefinition,
  tables: Tables,
): TumbleCell[][] {
  const scatterRows: (number | null)[] = [];
  for (let reel = 0; reel < definition.reels; reel += 1) {
    const carries = stream.nextBelow(1_000) < definition.scatterReelWeight;
    scatterRows.push(carries ? stream.nextBelow(definition.rows) : null);
  }

  const board: TumbleCell[][] = Array.from(
    { length: definition.rows },
    () => new Array<TumbleCell>(definition.reels),
  );
  for (let reel = 0; reel < definition.reels; reel += 1) {
    for (let row = 0; row < definition.rows; row += 1) {
      board[row][reel] = scatterRows[reel] === row
        ? { symbol: tables.scatter }
        : fill(stream, definition, tables);
    }
  }
  return board;
}

/** Every position holding `symbolId`, top-left first. */
export function positionsOf(board: TumbleCell[][], symbolId: string): [number, number][] {
  const found: [number, number][] = [];
  for (let row = 0; row < board.length; row += 1) {
    for (let reel = 0; reel < board[row].length; reel += 1) {
      if (board[row][reel].symbol === symbolId) found.push([row, reel]);
    }
  }
  return found;
}

/** The band a count falls into, or null when it does not reach the minimum. */
export function bandFor(
  definition: TumbleGameDefinition,
  symbolId: string,
  count: number,
): number | null {
  if (count < definition.minCluster) return null;
  const bands = definition.paytable[symbolId];
  if (!bands) return null;
  // Bands are stored highest-first and validated strictly descending, so the
  // first band the count reaches is the only one that can apply.
  for (const band of bands) {
    if (count >= band.min) return band.centi;
  }
  return null;
}

/**
 * Pays anywhere: every paying symbol with at least `minCluster` copies visible
 * pays its band once, independently of where the copies sit.
 */
export function evaluateBoard(
  definition: TumbleGameDefinition,
  board: TumbleCell[][],
): TumbleWin[] {
  const counts = new Map<string, number>();
  for (const row of board) {
    for (const cell of row) {
      counts.set(cell.symbol, (counts.get(cell.symbol) ?? 0) + 1);
    }
  }
  const wins: TumbleWin[] = [];
  for (const symbol of definition.symbols) {
    if (symbol.type !== 'PAY') continue;
    const count = counts.get(symbol.id) ?? 0;
    const centi = bandFor(definition, symbol.id, count);
    if (centi !== null) wins.push({ symbolId: symbol.id, count, centi });
  }
  return wins;
}

/**
 * Clears every copy of the winning symbols, lets the survivors fall, and
 * refills from the top.
 *
 * Scatters and orbs never pay and therefore never clear: they ride the whole
 * chain, which is exactly why an orb that lands early still counts at the end
 * and why the chain is self-terminating - a board crowded with them can no
 * longer reach a cluster.
 */
export function clearAndDrop(
  stream: Stream,
  definition: TumbleGameDefinition,
  tables: Tables,
  board: TumbleCell[][],
  winning: Set<string>,
): TumbleCell[][] {
  const next: TumbleCell[][] = Array.from(
    { length: definition.rows },
    () => new Array<TumbleCell>(definition.reels),
  );
  for (let reel = 0; reel < definition.reels; reel += 1) {
    const survivors: TumbleCell[] = [];
    for (let row = definition.rows - 1; row >= 0; row -= 1) {
      const cell = board[row][reel];
      if (!winning.has(cell.symbol)) survivors.push(cell);
    }
    // Survivors settle on the floor in the order they fell.
    for (let index = 0; index < survivors.length; index += 1) {
      next[definition.rows - 1 - index][reel] = survivors[index];
    }
    for (let row = definition.rows - 1 - survivors.length; row >= 0; row -= 1) {
      next[row][reel] = fill(stream, definition, tables);
    }
  }
  return next;
}

function project(
  definition: TumbleGameDefinition,
  tables: Tables,
  board: TumbleCell[][],
): Pick<TumbleStep, 'rows' | 'orbs'> {
  const rows = board.map((row) => row.map((cell) => tables.code.get(cell.symbol)!).join(''));
  const orbs: TumbleStep['orbs'] = [];
  for (let row = 0; row < board.length; row += 1) {
    for (let reel = 0; reel < board[row].length; reel += 1) {
      const cell = board[row][reel];
      if (cell.orbValue !== undefined) orbs.push({ row, reel, value: cell.orbValue });
    }
  }
  return { rows, orbs };
}

/** The scatter band a count falls into, in centi of one bet. */
export function scatterCentiFor(definition: TumbleGameDefinition, count: number): number {
  const bands = Object.keys(definition.scatterPay)
    .map(Number)
    .sort((left, right) => right - left);
  const applicable = bands.find((band) => count >= band);
  return applicable === undefined ? 0 : definition.scatterPay[applicable];
}

/**
 * One spin: the opening drop, every tumble it caused, and what it paid.
 *
 * `carry` is the multiplier already banked by the session. The base game always
 * passes 0, so the same arithmetic covers both: an orb sum of zero pays at 1x,
 * and inside the feature the sum is added to what the session already holds.
 */
export function playSpin(
  stream: Stream,
  definition: TumbleGameDefinition,
  tables: Tables,
  carry: number,
): { spin: TumbleSpin; carry: number } {
  const steps: TumbleStep[] = [];
  let board = openingBoard(stream, definition, tables);
  const scatterCount = positionsOf(board, tables.scatter).length;
  let rawCenti = 0;

  for (let tumble = 0; ; tumble += 1) {
    const wins = evaluateBoard(definition, board);
    const winCenti = wins.reduce((sum, win) => sum + win.centi, 0);
    steps.push({ ...project(definition, tables, board), wins, winCenti });
    rawCenti += winCenti;
    if (!wins.length || tumble >= definition.maxTumbles) break;
    board = clearAndDrop(
      stream,
      definition,
      tables,
      board,
      new Set(wins.map((win) => win.symbolId)),
    );
  }

  const orbTotal = board.reduce(
    (sum, row) => sum + row.reduce((inner, cell) => inner + (cell.orbValue ?? 0), 0),
    0,
  );
  const banked = carry + orbTotal;
  // Orbs only ever multiply symbol wins. A spin that lands orbs and pays
  // nothing pays nothing, and a spin with no orbs pays at face value.
  const appliedMultiplier = banked > 0 ? banked : 1;
  const scatterCenti = scatterCentiFor(definition, scatterCount);

  return {
    spin: {
      steps,
      scatterCount,
      scatterCenti,
      orbTotal,
      appliedMultiplier,
      rawCenti,
      winCenti: rawCenti * appliedMultiplier + scatterCenti,
    },
    carry: banked,
  };
}

/**
 * A whole free-spin session, played to exhaustion in one authoritative call.
 *
 * The session is not a persisted state machine: one request buys or triggers
 * it, the server resolves every spin, and the browser replays the result. That
 * is what keeps the wallet, the ledger and the idempotency key exactly as they
 * are for an instant game - one stake, one payout, one round.
 */
export function playFeature(
  stream: Stream,
  definition: TumbleGameDefinition,
  tables: Tables,
): TumbleFeature {
  const spins: TumbleSpin[] = [];
  const retriggers: TumbleRetrigger[] = [];
  const multiplierAfter: number[] = [];
  let remaining = definition.freeSpins.award;
  let awarded = definition.freeSpins.award;
  let carry = 0;

  while (remaining > 0 && spins.length < definition.freeSpins.maxSpins) {
    const played = playSpin(stream, definition, tables, carry);
    carry = played.carry;
    spins.push(played.spin);
    multiplierAfter.push(carry);
    remaining -= 1;
    if (played.spin.scatterCount >= definition.freeSpins.retrigger) {
      remaining += definition.freeSpins.retriggerAward;
      awarded += definition.freeSpins.retriggerAward;
      retriggers.push({
        spinIndex: spins.length - 1,
        scatterCount: played.spin.scatterCount,
        award: definition.freeSpins.retriggerAward,
      });
    }
  }

  return {
    spins,
    awarded,
    retriggers,
    multiplierAfter,
    totalCenti: spins.reduce((sum, spin) => sum + spin.winCenti, 0),
    truncated: remaining > 0,
  };
}

/**
 * Total return as a display multiplier of one bet.
 *
 * Formatted from the integer directly rather than through a decimal library:
 * the value is already in hundredths, so there is nothing to round and nothing
 * that could pick up a binary floating point representation on the way out.
 */
export function totalMultiplier(totalCenti: number): string {
  return `${Math.floor(totalCenti / 100)}.${String(totalCenti % 100).padStart(2, '0')}`;
}

/** Full pure resolution of one round from committed fairness inputs. */
export function resolveTumbleRound(
  fairness: FairnessInput,
  definition: TumbleGameDefinition,
  mode: TumbleMode,
): TumbleRoundResult {
  const stream = new FairnessStream(fairness);
  const tables = buildTables(definition);

  let base: TumbleSpin | null = null;
  let entersFeature = mode === 'BUY_FEATURE';
  if (mode === 'BASE') {
    base = playSpin(stream, definition, tables, 0).spin;
    entersFeature = base.scatterCount >= definition.freeSpins.trigger;
  }
  const feature = entersFeature ? playFeature(stream, definition, tables) : null;

  const raw = (base?.winCenti ?? 0) + (feature?.totalCenti ?? 0);
  const capped = raw > definition.maxWinCenti;
  const totalCenti = capped ? definition.maxWinCenti : raw;

  return {
    mode,
    base,
    feature,
    totalCenti,
    capped,
    totalMultiplier: totalMultiplier(totalCenti),
  };
}

/**
 * What the wallet is actually charged, rounded up so a fractional feature price
 * can never undercharge. The base game is always exactly one bet.
 */
export function tumbleCharge(
  definition: TumbleGameDefinition,
  bet: bigint,
  mode: TumbleMode,
): bigint {
  if (mode === 'BASE') return bet;
  return (bet * BigInt(definition.buyFeatureCenti) + 99n) / 100n;
}

/**
 * Total return in whole virtual points, floored once at the end:
 * `floor(bet * totalCenti / 100)`.
 */
export function tumblePayout(bet: bigint, totalCenti: number): bigint {
  return (bet * BigInt(totalCenti)) / 100n;
}
