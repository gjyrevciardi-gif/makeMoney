import type { Board, EngineModule, Evaluation, RulesTable } from './lucky-lady.math';

/**
 * Exact mathematics for a Lucky Lady candidate profile.
 *
 * Nothing here re-implements the game. Every board is evaluated by the *same*
 * vendored evaluator the runtime uses (`engine.evaluate`), and every figure
 * below is derived from the complete set of boards a profile can actually
 * reach - never from a sample. That is what makes it possible to state a
 * maximum, a hit rate or a trigger probability as a proved fact instead of an
 * observation.
 *
 * The board space stays enumerable because generated profiles only give
 * positive pre-draw weight to a bounded number of stops per reel. A profile
 * with weight on every stop (123 per reel) could not be enumerated, and this
 * module refuses rather than guessing.
 */

export type LlStopWeights = Record<string, number[]>;

export type LlProfilePayload = {
  strips?: Record<string, string[]>;
  stopWeights?: LlStopWeights;
};

export type LlBoardOutcome = {
  stops: number[];
  /** Integer pre-draw weight of this board: the product of the stop weights. */
  weight: bigint;
  evaluation: Evaluation;
};

export type LlExactAnalysis = {
  reachableBoards: number;
  /** Expected complete paid-round return from the paid board only, in percent. */
  baseRtpPercent: number;
  /** Portion of `baseRtpPercent` that comes from paying lines. */
  lineRtpPercent: number;
  /** Portion of `baseRtpPercent` that comes from scatter pays of the paid board. */
  scatterRtpPercent: number;
  /** Expected return contributed by the free-spin feature, in percent. */
  featureRtpPercent: number;
  totalRtpPercent: number;
  triggerProbability: number;
  retriggerProbability: number;
  expectedFeatureSpins: number | null;
  featureDiverges: boolean;
  /** Exact distribution of the paid board's return, in stake multiples. */
  baseDistribution: Array<{ returnMultiplier: number; probability: number }>;
  hitRate: number;
  zeroRate: number;
  partialRate: number;
  /** P(X = 1): the acceptance contract's break-even outcome. */
  breakEvenRate: number;
  /** P(0.5 <= X < 1): the break-even band of the fine payout histogram. */
  breakEvenBandRate: number;
  /** Population standard deviation of the paid board's return multiplier. */
  baseVolatility: number;
  /** Largest single-board total win, in stake multiples. */
  maxBoardMultiplier: number;
  /** Largest single free spin, in stake multiples. */
  maxFreeSpinMultiplier: number;
  /**
   * Largest complete-round return the profile can produce, in stake multiples.
   * When the feature can retrigger this is the engine's own termination bound,
   * not a marketing ceiling.
   */
  maxRoundMultiplier: number;
  maxRoundBasis: string;
  /** True when a retriggering feature makes any smaller ceiling unprovable. */
  featureUnbounded: boolean;
};

const ENGINE_FEATURE_SPIN_CAP = 20_000;

/** Stop weights exactly as the engine reads them: `strip.length - 2` entries. */
export function stopWeightArrays(
  rules: RulesTable,
  payload: LlProfilePayload,
): { reelKey: string; strip: string[]; weights: number[] }[] {
  const strips = rules.reels as Record<string, string[]>;
  const reelKeys = Object.keys(strips).sort(
    (a, b) => Number(a.replace('reelStrip', '')) - Number(b.replace('reelStrip', '')),
  );
  return reelKeys.map((reelKey) => {
    const strip = (payload.strips?.[reelKey] as string[] | undefined) ?? strips[reelKey];
    const stops = strip.length - 2;
    const supplied = payload.stopWeights?.[reelKey];
    const weights = supplied ? [...supplied] : new Array(stops).fill(1);
    if (weights.length !== stops) {
      throw new Error(`LUCKY_LADY_WEIGHT_LENGTH: ${reelKey} expected ${stops}, received ${weights.length}`);
    }
    for (const weight of weights) {
      if (!Number.isSafeInteger(weight) || weight < 0) {
        throw new Error(`LUCKY_LADY_WEIGHT_INVALID: ${reelKey}`);
      }
    }
    if (weights.reduce((sum, weight) => sum + weight, 0) <= 0) {
      throw new Error(`LUCKY_LADY_WEIGHT_ALL_ZERO: ${reelKey}`);
    }
    return { reelKey, strip, weights };
  });
}

/** Stops that carry positive pre-draw weight: the only ones a board can hit. */
export function reachableStops(weights: readonly number[]): number[] {
  const stops: number[] = [];
  for (let index = 0; index < weights.length; index += 1) {
    if (weights[index] > 0) stops.push(index);
  }
  return stops;
}

export function boardFromStops(
  reels: { reelKey: string; strip: string[] }[],
  stops: readonly number[],
  emptyRow: string,
): Board {
  const board = { rp: [] as number[] } as Board;
  reels.forEach((reel, index) => {
    const stop = stops[index];
    const reelIndex = Number(reel.reelKey.replace('reelStrip', ''));
    board[`reel${reelIndex}`] = [reel.strip[stop], reel.strip[stop + 1], reel.strip[stop + 2], emptyRow];
    (board.rp as number[]).push(stop);
  });
  return board;
}

export function enumerateBoardOutcomes(
  rules: RulesTable,
  engine: EngineModule,
  payload: LlProfilePayload,
  maxBoards: number,
): { boards: LlBoardOutcome[]; totalWeight: bigint } {
  const reels = stopWeightArrays(rules, payload);
  const options = reels.map((reel) => reachableStops(reel.weights));
  const space = options.reduce((product, stops) => product * stops.length, 1);
  if (space > maxBoards) {
    throw new Error(`LUCKY_LADY_BOARD_SPACE_TOO_LARGE: ${space} > ${maxBoards}`);
  }

  const boards: LlBoardOutcome[] = [];
  let totalWeight = 0n;

  const walk = (index: number, stops: number[], weight: bigint) => {
    if (index === reels.length) {
      const board = boardFromStops(reels, stops, String(rules.emptyRow));
      const evaluation = engine.evaluate(rules, board, { bet: 1, lines: rules.lines.length });
      boards.push({ stops: [...stops], weight, evaluation });
      totalWeight += weight;
      return;
    }
    for (const stop of options[index]) {
      walk(index + 1, [...stops, stop], weight * BigInt(reels[index].weights[stop]));
    }
  };
  walk(0, [], 1n);
  return { boards, totalWeight };
}

/**
 * Exact analysis of a candidate profile.
 *
 * Return is measured against the paid wager only: one paid board plus the whole
 * free-spin chain it awards.
 */
export function analyzeProfileExact(
  rules: RulesTable,
  engine: EngineModule,
  payload: LlProfilePayload,
  maxBoards = 16_384,
): LlExactAnalysis {
  const lines = rules.lines.length;
  const { boards, totalWeight } = enumerateBoardOutcomes(rules, engine, payload, maxBoards);
  const freeMultiplier = rules.constants.slotFreeMpl;
  const freeCount = rules.constants.slotFreeCount;

  let lineUnits = 0n;
  let scatterUnits = 0n;
  let triggerWeight = 0n;
  let maxBoardUnits = 0n;
  let maxLineUnits = 0n;
  let maxScatterUnits = 0n;
  const distribution = new Map<string, bigint>();

  for (const outcome of boards) {
    const { evaluation } = outcome;
    lineUnits += BigInt(evaluation.baseWin) * outcome.weight;
    scatterUnits += BigInt(evaluation.scatterWin) * outcome.weight;
    if (evaluation.scatterCount >= 3) triggerWeight += outcome.weight;
    const boardUnits = BigInt(evaluation.totalWin);
    if (boardUnits > maxBoardUnits) maxBoardUnits = boardUnits;
    if (BigInt(evaluation.baseWin) > maxLineUnits) maxLineUnits = BigInt(evaluation.baseWin);
    if (BigInt(evaluation.scatterWin) > maxScatterUnits) maxScatterUnits = BigInt(evaluation.scatterWin);
    const key = String(evaluation.totalWin);
    distribution.set(key, (distribution.get(key) ?? 0n) + outcome.weight);
  }

  const wagerUnits = BigInt(rules.lines.length);
  const totalWeightNumber = Number(totalWeight);
  const lineRtp = (Number(lineUnits) / Number(totalWeight)) / lines * 100;
  const scatterRtp = (Number(scatterUnits) / Number(totalWeight)) / lines * 100;
  const triggerProbability = Number(triggerWeight) / totalWeightNumber;
  const perSpinFeatureWinUnits = BigInt(freeMultiplier) * lineUnits + scatterUnits;

  // Total progeny of a Galton-Watson chain with 15 starting spins and a
  // Binomial(15, p) retrigger count per spin: E[S] = 15 / (1 - 15p), and the
  // expectation diverges the moment 15p >= 1.
  const diverges = freeCount * triggerProbability >= 1;
  const expectedFeatureSpins = diverges ? null : freeCount / (1 - freeCount * triggerProbability);
  const featureRtp = diverges || expectedFeatureSpins === null
    ? Number.POSITIVE_INFINITY
    : (triggerProbability * expectedFeatureSpins * Number(perSpinFeatureWinUnits)) / Number(totalWeight) / lines * 100;

  const entries = [...distribution.entries()]
    .map(([key, weight]) => ({ units: Number(key), weight }))
    .sort((left, right) => left.units - right.units);
  const baseDistribution: Array<{ returnMultiplier: number; probability: number }> = entries.map((entry) => ({
    returnMultiplier: entry.units / lines,
    probability: Number(entry.weight) / totalWeightNumber,
  }));

  let hitWeight = 0n;
  let partialWeight = 0n;
  let breakEvenWeight = 0n;
  let breakEvenBandWeight = 0n;
  let sumSquares = 0;
  const meanMultiplier = Number(lineUnits + scatterUnits) / Number(totalWeight) / lines;
  for (const entry of entries) {
    const returnMultiplier = entry.units / lines;
    if (returnMultiplier > 0) hitWeight += entry.weight;
    if (returnMultiplier > 0 && returnMultiplier < 1) partialWeight += entry.weight;
    if (returnMultiplier === 1) breakEvenWeight += entry.weight;
    if (returnMultiplier >= 0.5 && returnMultiplier < 1) breakEvenBandWeight += entry.weight;
    sumSquares += (Number(entry.weight) / totalWeightNumber) * (returnMultiplier - meanMultiplier) ** 2;
  }
  const zeroWeight = distribution.get('0') ?? 0n;

  const maxBoardMultiplier = Number(maxBoardUnits) / Number(wagerUnits);
  const maxFreeSpinUnits = BigInt(freeMultiplier) * maxLineUnits + maxScatterUnits;
  const maxFreeSpinMultiplier = Number(maxFreeSpinUnits) / Number(wagerUnits);
  const featureUnbounded = triggerProbability > 0;
  // The engine's own 20000-spin safety exception is NOT a payout cap: it aborts
  // a round rather than bounding what a round may pay, and a retrigger with
  // positive probability can repeat indefinitely. A feature-bearing profile
  // therefore has no finite complete-round bound at all.
  const maxRoundMultiplier = featureUnbounded
    ? Number.POSITIVE_INFINITY
    : Number(maxBoardUnits) / Number(wagerUnits);

  return {
    reachableBoards: boards.length,
    baseRtpPercent: lineRtp + scatterRtp,
    lineRtpPercent: lineRtp,
    scatterRtpPercent: scatterRtp,
    featureRtpPercent: featureRtp,
    totalRtpPercent: Number.isFinite(featureRtp) ? lineRtp + scatterRtp + featureRtp : Number.POSITIVE_INFINITY,
    triggerProbability,
    retriggerProbability: triggerProbability,
    expectedFeatureSpins,
    featureDiverges: diverges,
    baseDistribution,
    hitRate: Number(hitWeight) / totalWeightNumber,
    zeroRate: Number(zeroWeight) / totalWeightNumber,
    partialRate: Number(partialWeight) / totalWeightNumber,
    breakEvenRate: Number(breakEvenWeight) / totalWeightNumber,
    breakEvenBandRate: Number(breakEvenBandWeight) / totalWeightNumber,
    baseVolatility: Math.sqrt(sumSquares),
    maxBoardMultiplier,
    maxFreeSpinMultiplier,
    maxRoundMultiplier,
    maxRoundBasis: featureUnbounded
      ? `no finite bound: a reachable free spin retriggers with probability ` +
        `${triggerProbability.toFixed(6)}, so the chain can repeat indefinitely ` +
        `(the engine's ${ENGINE_FEATURE_SPIN_CAP}-spin safety exception aborts a round and is not a payout cap)`
      : 'no reachable board awards 3 or more scatters, so the feature cannot run',
    featureUnbounded,
  };
}
