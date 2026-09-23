import { createHash } from "node:crypto";
import type { FeatureSelection, GameConfig } from "@slot-skills/schema";
import { canonicalJson } from "@slot-skills/schema";
import { applyPostEvaluationFeatures, applyPreEvaluationFeatures, type FeatureContext, type FeatureEvent, type FeatureState } from "@slot-skills/features";
import { evaluateGrid, evaluateBookOfRa, bookOfRaPayout, generateGrid, rowCounts, scatterWins, type Cell, type Grid, type RngDraw, type RngProvider, type Win } from "@slot-skills/math";
import {
  BOOK_OF_RA_LINES,
  BOOK_OF_RA_MAX_GAMBLE_ATTEMPTS,
  BOOK_OF_RA_PROFILE_FINGERPRINT,
  BOOK_OF_RA_PROFILE_ID,
} from "@slot-skills/math";
import {
  createBookOfRaState,
  fromFeatureState,
  hasPendingBookOfRaAction,
  isBookOfRaFreeGameActive,
  playBookOfRaRound,
  resolveBookOfRaGamble,
  toFeatureState,
  type BookOfRaGambleChoice,
  type BookOfRaGameState,
} from "./book-of-ra-round.js";
import type { GameEngine, GameEvent, GameEventType, GameRoundRequest, GameRoundResult, InternalContinuation, PendingAction, RoundComputation } from "./types.js";

function selection(game: GameConfig, id: string): FeatureSelection | undefined {
  return game.features.find((feature) => feature.id === id && feature.enabled);
}

function configuredNumber(feature: FeatureSelection | undefined, key: string, fallback: number): number {
  const value = feature?.config?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function configuredString(feature: FeatureSelection | undefined, key: string): string | undefined {
  const value = feature?.config?.[key];
  return typeof value === "string" ? value : undefined;
}

function configuredNumbers(feature: FeatureSelection | undefined, key: string, fallback: number[]): number[] {
  const value = feature?.config?.[key];
  const numbers = Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry)) : [];
  return numbers.length ? numbers : fallback;
}

function boundedBps(feature: FeatureSelection | undefined, key: string, fallback: number): number {
  return Math.max(0, Math.min(10000, Math.floor(configuredNumber(feature, key, fallback))));
}

function nextEvent(events: GameEvent[], type: GameEventType, data: Record<string, unknown>): void {
  events.push({ sequence: events.length, type, data });
}

function appendFeatureEvents(events: GameEvent[], featureEvents: FeatureEvent[]): void {
  for (const event of featureEvents) nextEvent(events, event.type as GameEventType, { featureId: event.featureId, ...event.data });
}

function hashOutcome(result: Omit<GameRoundResult, "outcomeHash">): string {
  return createHash("sha256").update(canonicalJson(result)).digest("hex");
}

function isBookOfRaDeluxe(game: GameConfig): boolean {
  return game.id === "book-of-the-sands" && game.layout.reels === 5 && rowCounts(game).every((rows) => rows === 3) && (game.math.paylines?.length ?? 0) === 10;
}

/**
 * Book of Ra Deluxe is served by the dedicated round engine in
 * `book-of-ra-round.ts`. This adapter only maps the engine's authoritative
 * round state onto the generic result contract, so the reference host, the
 * simulation harness and the platform adapter all share one implementation.
 */
async function spinBookOfRaDeluxe(game: GameConfig, request: GameRoundRequest, rng: RngProvider): Promise<RoundComputation> {
  const restored = fromFeatureState(request.featureState, { profileFingerprint: BOOK_OF_RA_PROFILE_FINGERPRINT });
  if (restored && hasPendingBookOfRaAction(restored)) throw new Error("Resolve the pending gamble before another spin");
  const state = restored && isBookOfRaFreeGameActive(restored) && !hasPendingBookOfRaAction(restored)
    ? restored
    : createBookOfRaState({
      profileId: BOOK_OF_RA_PROFILE_ID,
      profileFingerprint: BOOK_OF_RA_PROFILE_FINGERPRINT,
      betPerLine: request.betUnits,
      activeLines: BOOK_OF_RA_LINES,
      maxGambleAttempts: BOOK_OF_RA_MAX_GAMBLE_ATTEMPTS,
    });

  const played = await playBookOfRaRound({
    game,
    state,
    rng,
    roundId: request.roundId,
    betPerLine: BigInt(request.betUnits),
    activeLines: BOOK_OF_RA_LINES,
    autoplay: request.autoplay === true,
  });
  const { outcome } = played;
  const total = BigInt(outcome.totalSpinWin);
  const totalBet = BigInt(outcome.totalBet);

  const events: GameEvent[] = [];
  nextEvent(events, "round-start", {
    betUnits: outcome.betPerLine,
    totalBet: outcome.totalBet,
    activeLines: outcome.activeLines,
    ...(outcome.freeSpin ? { freeSpin: outcome.freeSpinIndex } : {}),
  });
  nextEvent(events, "grid-reveal", { grid: structuredClone(outcome.board) });
  for (const win of outcome.regularWins) nextEvent(events, "win", { ...win, regular: true });
  if (BigInt(outcome.scatterWin) > 0n) {
    nextEvent(events, "win", {
      symbolId: game.symbols.find((symbol) => symbol.kind === "scatter")?.id ?? "scatter",
      scatterPay: true,
      bookCount: outcome.bookCount,
      payoutUnits: outcome.scatterWin,
    });
  }
  if (outcome.expandingReels.length && BigInt(outcome.expandingWin) > 0n) {
    nextEvent(events, "reel-transform", {
      featureId: "book-of-ra-expanding-symbol",
      specialSymbol: outcome.specialSymbol,
      expandingReels: [...outcome.expandingReels],
    });
    nextEvent(events, "win", {
      symbolId: outcome.specialSymbol,
      expanding: true,
      reels: [...outcome.expandingReels],
      payoutUnits: outcome.expandingWin,
    });
  }
  if (!outcome.freeSpin && outcome.phase === "FREE_GAME_INTRO") {
    nextEvent(events, "feature-start", {
      featureId: "free-spins",
      spins: played.state.freeSpinsAwarded,
      specialSymbol: outcome.specialSymbol,
      lockedBetPerLine: outcome.betPerLine,
      lockedTotalBet: outcome.totalBet,
    });
  }
  if (outcome.freeSpin) {
    if (outcome.retriggered > 0) {
      nextEvent(events, "feature-start", {
        featureId: "retriggering-free-spins",
        addedSpins: outcome.retriggered,
        remaining: outcome.freeSpinsRemaining,
        bookCount: outcome.bookCount,
      });
    }
    nextEvent(events, outcome.freeSpinsRemaining > 0 ? "free-spin" : "free-spins-end", {
      remaining: outcome.freeSpinsRemaining,
      specialSymbol: outcome.specialSymbol,
      ...(outcome.freeSpinsRemaining === 0 ? { totalWinUnits: played.state.featureWin } : {}),
    });
  }
  if (outcome.pendingAction) {
    nextEvent(events, "choice-required", {
      featureId: "gamble-feature",
      choices: ["red", "black", "collect"],
      maxAttempts: played.state.gambleMaxAttempts,
      actionId: outcome.pendingAction.id,
    });
  }
  nextEvent(events, "round-complete", { totalSpinWin: outcome.totalSpinWin, roundState: outcome.phase });

  const featureState = toFeatureState(played.state);
  const baseResult = {
    roundId: request.roundId,
    gameId: game.id,
    gameVersion: game.version,
    playerId: request.playerId,
    betUnits: outcome.betPerLine,
    totalWinUnits: total.toString(),
    netUnits: (total - (outcome.freeSpin ? 0n : totalBet)).toString(),
    finalGrid: outcome.finalGrid,
    board: outcome.board,
    events,
    draws: played.draws,
    featureState,
    complete: outcome.complete,
    roundState: outcome.phase,
    regularWins: outcome.regularWins,
    wins: outcome.wins,
    scatterWin: outcome.scatterWin,
    ...(outcome.specialSymbol ? { specialSymbol: outcome.specialSymbol } : {}),
    expandingReels: [...outcome.expandingReels],
    expandingWin: outcome.expandingWin,
    totalSpinWin: outcome.totalSpinWin,
    ...(outcome.pendingAction ? { pendingAction: outcome.pendingAction } : {}),
  } satisfies Omit<GameRoundResult, "outcomeHash">;
  const result: GameRoundResult = { ...baseResult, outcomeHash: hashOutcome(baseResult) };
  if (outcome.pendingAction) {
    return {
      result,
      continuation: {
        engine: "book-of-ra",
        action: outcome.pendingAction,
        awardsByChoice: bookOfRaGambleAwards(played.state),
        baseResult: result,
        bookOfRaState: played.state,
      },
    };
  }
  return { result };
}

/**
 * Relative awards for the pending Book of Ra gamble. They are derived from the
 * colours drawn when the ladder was offered; they are informative for generic
 * consumers, while `book-of-ra-round.ts` remains the resolver of record.
 */
function bookOfRaGambleAwards(state: BookOfRaGameState): Record<string, string> {
  const amount = BigInt(state.pendingWin);
  const colour = state.gambleColours?.[state.gambleAttempts] ?? "red";
  return {
    red: colour === "red" ? amount.toString() : (-amount).toString(),
    black: colour === "black" ? amount.toString() : (-amount).toString(),
    collect: "0",
  };
}

function symbolIdsOfKind(game: GameConfig, kind: string): Set<string> {
  return new Set(game.symbols.filter((symbol) => symbol.kind === kind).map((symbol) => symbol.id));
}

function countSymbols(grid: Grid, ids: Set<string>): number {
  return grid.flat().filter((symbol) => ids.has(symbol)).length;
}

function scatterCount(game: GameConfig, grid: Grid): number {
  return countSymbols(grid, symbolIdsOfKind(game, "scatter"));
}

function applyPersistentState(game: GameConfig, grid: Grid, state: FeatureState, events: GameEvent[]): void {
  const wild = game.symbols.find((symbol) => symbol.kind === "wild")?.id;
  if (!wild) return;
  if (selection(game, "sticky-wilds") || selection(game, "sticky-symbols")) {
    const nextSticky = [] as NonNullable<FeatureState["stickyCells"]>;
    for (const cell of state.stickyCells ?? []) {
      if (grid[cell.reel]?.[cell.row] === undefined || cell.remaining <= 0) continue;
      grid[cell.reel]![cell.row] = cell.symbolId;
      nextSticky.push({ ...cell, remaining: cell.remaining - 1 });
      nextEvent(events, "symbol-transform", { featureId: selection(game, "sticky-wilds") ? "sticky-wilds" : "sticky-symbols", reel: cell.reel, row: cell.row, symbolId: cell.symbolId });
    }
    state.stickyCells = nextSticky;
  }
  if (selection(game, "walking-wilds") || selection(game, "shifting-wilds")) {
    const moved = [] as NonNullable<FeatureState["walkingWilds"]>;
    for (const walker of state.walkingWilds ?? []) {
      const reel = walker.reel + walker.direction;
      if (grid[reel]?.[walker.row] === undefined) continue;
      grid[reel]![walker.row] = wild;
      moved.push({ ...walker, reel });
      nextEvent(events, "symbol-transform", { featureId: selection(game, "walking-wilds") ? "walking-wilds" : "shifting-wilds", reel, row: walker.row, symbolId: wild });
    }
    state.walkingWilds = moved;
  }
}

function capturePersistentState(game: GameConfig, grid: Grid, state: FeatureState): void {
  const wild = game.symbols.find((symbol) => symbol.kind === "wild")?.id;
  if (selection(game, "sticky-wilds") && wild) {
    const spins = Math.max(1, Math.floor(configuredNumber(selection(game, "sticky-wilds"), "spins", 3)));
    state.stickyCells ??= [];
    grid.forEach((column, reel) => column.forEach((symbol, row) => {
      if (symbol === wild && !state.stickyCells!.some((cell) => cell.reel === reel && cell.row === row)) state.stickyCells!.push({ reel, row, symbolId: wild, remaining: spins });
    }));
  }
  const stickySymbols = selection(game, "sticky-symbols");
  if (stickySymbols) {
    const symbolId = configuredString(stickySymbols, "symbolId") ?? wild;
    if (symbolId) {
      const spins = Math.max(1, Math.floor(configuredNumber(stickySymbols, "spins", 2)));
      state.stickyCells ??= [];
      grid.forEach((column, reel) => column.forEach((symbol, row) => {
        if (symbol === symbolId && !state.stickyCells!.some((cell) => cell.reel === reel && cell.row === row)) state.stickyCells!.push({ reel, row, symbolId, remaining: spins });
      }));
    }
  }
  if (selection(game, "walking-wilds") && wild) {
    state.walkingWilds ??= [];
    grid.forEach((column, reel) => column.forEach((symbol, row) => {
      if (symbol === wild && !state.walkingWilds!.some((cell) => cell.reel === reel && cell.row === row)) state.walkingWilds!.push({ reel, row, direction: 1 });
    }));
  }
  if (selection(game, "shifting-wilds") && wild) {
    state.walkingWilds ??= [];
    grid.forEach((column, reel) => column.forEach((symbol, row) => {
      if (symbol === wild && !state.walkingWilds!.some((cell) => cell.reel === reel && cell.row === row)) state.walkingWilds!.push({ reel, row, direction: -1 });
    }));
  }
}

async function replacementSymbol(game: GameConfig, rng: RngProvider, draws: RngDraw[], context: string): Promise<string> {
  const weights = game.math.symbolWeights;
  if (weights) {
    const entries = Object.entries(weights).filter(([, weight]) => weight > 0);
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    const draw = await rng.uniformInt(total, context);
    draws.push(draw);
    let cursor = draw.value;
    for (const [symbol, weight] of entries) {
      if (cursor < weight) return symbol;
      cursor -= weight;
    }
  }
  const symbols = game.symbols.filter((symbol) => symbol.kind !== "scatter").map((symbol) => symbol.id);
  const draw = await rng.uniformInt(symbols.length, context);
  draws.push(draw);
  return symbols[draw.value]!;
}

async function cascadeGrid(game: GameConfig, grid: Grid, wins: Win[], rng: RngProvider, draws: RngDraw[], index: number, expandNeighbors: boolean): Promise<{ removed: Cell[]; grid: Grid }> {
  const unique = new Map<string, Cell>();
  for (const win of wins) for (const cell of win.cells) unique.set(`${cell.reel}:${cell.row}`, cell);
  if (expandNeighbors) {
    const scatters = symbolIdsOfKind(game, "scatter");
    for (const cell of [...unique.values()]) {
      for (const [reel, row] of [[cell.reel - 1, cell.row], [cell.reel + 1, cell.row], [cell.reel, cell.row - 1], [cell.reel, cell.row + 1]] as Array<[number, number]>) {
        const symbol = grid[reel]?.[row];
        if (symbol !== undefined && !scatters.has(symbol)) unique.set(`${reel}:${row}`, { reel, row });
      }
    }
  }
  const removed = [...unique.values()];
  const removedByReel = new Map<number, Set<number>>();
  for (const cell of removed) {
    const rows = removedByReel.get(cell.reel) ?? new Set<number>();
    rows.add(cell.row);
    removedByReel.set(cell.reel, rows);
  }
  for (let reel = 0; reel < grid.length; reel += 1) {
    const removeRows = removedByReel.get(reel) ?? new Set<number>();
    const survivors = grid[reel]!.filter((_, row) => !removeRows.has(row));
    const replacements: string[] = [];
    while (survivors.length + replacements.length < grid[reel]!.length) replacements.push(await replacementSymbol(game, rng, draws, `cascade:${index}:${reel}:${replacements.length}`));
    grid[reel] = [...replacements, ...survivors];
  }
  return { removed, grid };
}

interface SingleSpinResult {
  grid: Grid;
  triggerGrid: Grid;
  wins: Win[];
  totalWin: bigint;
  draws: RngDraw[];
  events: GameEvent[];
}

interface OrbSetup {
  symbolId: string;
  values: number[];
  weights: number[];
  weightTotal: number;
}

const DEFAULT_ORB_VALUES = [2, 4, 6, 8, 10, 15, 20, 25, 50, 100, 250, 500];
const DEFAULT_ORB_WEIGHTS = [290, 215, 160, 120, 90, 62, 40, 28, 12, 5, 2, 1];

function orbSetup(game: GameConfig): OrbSetup | undefined {
  const feature = selection(game, "tumble-multiplier-orbs");
  if (!feature) return undefined;
  const symbolId = configuredString(feature, "symbolId") ?? game.symbols.find((symbol) => symbol.kind === "bonus")?.id;
  if (!symbolId) return undefined;
  const values = configuredNumbers(feature, "values", DEFAULT_ORB_VALUES).map((value) => Math.max(1, Math.floor(value)));
  const rawWeights = configuredNumbers(feature, "weights", DEFAULT_ORB_WEIGHTS);
  const weights = values.map((_, index) => Math.max(1, Math.floor(rawWeights[index] ?? 1)));
  return { symbolId, values, weights, weightTotal: weights.reduce((sum, weight) => sum + weight, 0) };
}

/** Draws weighted 2x-500x style values for orb cells that do not have one yet; returns the newly valued cells. */
async function assignOrbValues(orbs: OrbSetup, grid: Grid, orbValues: Array<Array<number | undefined>>, rng: RngProvider, draws: RngDraw[], context: string): Promise<Array<{ reel: number; row: number; valueMultiplier: number }>> {
  const assigned: Array<{ reel: number; row: number; valueMultiplier: number }> = [];
  for (let reel = 0; reel < grid.length; reel += 1) {
    for (let row = 0; row < grid[reel]!.length; row += 1) {
      if (grid[reel]![row] !== orbs.symbolId || orbValues[reel]![row] !== undefined) continue;
      const draw = await rng.uniformInt(orbs.weightTotal, `${context}:${reel}:${row}`);
      draws.push(draw);
      let cursor = draw.value;
      let value = orbs.values[orbs.values.length - 1]!;
      for (let index = 0; index < orbs.values.length; index += 1) {
        if (cursor < orbs.weights[index]!) { value = orbs.values[index]!; break; }
        cursor -= orbs.weights[index]!;
      }
      orbValues[reel]![row] = value;
      assigned.push({ reel, row, valueMultiplier: value });
    }
  }
  return assigned;
}

async function singleSpin(game: GameConfig, betUnits: string, rng: RngProvider, state: FeatureState, context: string, guaranteedScatters = 0): Promise<SingleSpinResult> {
  const generated = await generateGrid(game, rng, context);
  const grid = generated.grid;
  const draws = [...generated.draws];
  const events: GameEvent[] = [];
  const phase = context.startsWith("free-spin") ? "free-spin" as const : context === "base" ? "base" as const : "respin" as const;
  const scatterId = game.symbols.find((symbol) => symbol.kind === "scatter")?.id;
  if (guaranteedScatters > 0 && scatterId) {
    const openCells: Cell[] = [];
    grid.forEach((column, reel) => column.forEach((symbol, row) => { if (symbol !== scatterId) openCells.push({ reel, row }); }));
    const shortfall = Math.min(guaranteedScatters - scatterCount(game, grid), openCells.length);
    for (let index = 0; index < shortfall; index += 1) {
      const draw = await rng.uniformInt(openCells.length - index, `forced-scatter:${index}`);
      draws.push(draw);
      const [cell] = openCells.splice(draw.value, 1);
      grid[cell!.reel]![cell!.row] = scatterId;
    }
  }
  applyPersistentState(game, grid, state, events);
  let wins: Win[] = [];
  let totalWin = 0n;
  let cascadeIndex = 0;
  let triggerGrid: Grid | undefined;
  const cascadesEnabled = ["cascading-reels", "avalanche-wins", "symbol-drop", "chain-reactions"].some((id) => selection(game, id));
  const chainReactions = Boolean(selection(game, "chain-reactions"));
  const maxCascades = game.math.maxCascades ?? 20;
  const orbs = orbSetup(game);
  const orbValues: Array<Array<number | undefined>> = grid.map((column) => column.map(() => undefined));
  while (true) {
    const featureEvents: FeatureEvent[] = [];
    const before: FeatureContext = { game, grid, betUnits, wins: [], totalWinUnits: "0", rng, draws, events: featureEvents, state, cascadeIndex, phase };
    if (cascadeIndex === 0) await applyPreEvaluationFeatures(before);
    appendFeatureEvents(events, featureEvents);
    if (cascadeIndex === 0) triggerGrid = structuredClone(grid);
    const assignedOrbs = orbs ? await assignOrbValues(orbs, grid, orbValues, rng, draws, `orb:${context}:${cascadeIndex}`) : [];
    nextEvent(events, cascadeIndex === 0 ? "grid-reveal" : "symbols-drop", { grid: structuredClone(grid), cascadeIndex, ...(orbs ? { orbValues: structuredClone(orbValues) } : {}) });
    for (const assigned of assignedOrbs) nextEvent(events, "symbol-value", { featureId: "tumble-multiplier-orbs", symbolId: orbs!.symbolId, cascadeIndex, ...assigned });
    const evaluated = evaluateGrid(game, grid, betUnits);
    const afterEvents: FeatureEvent[] = [];
    const after: FeatureContext = { game, grid, betUnits, wins: evaluated.wins, totalWinUnits: evaluated.totalWinUnits, rng, draws, events: afterEvents, state, cascadeIndex, phase };
    applyPostEvaluationFeatures(after);
    appendFeatureEvents(events, afterEvents);
    for (const win of after.wins) nextEvent(events, "win", { ...win, cascadeIndex });
    wins.push(...after.wins);
    totalWin += BigInt(after.totalWinUnits);
    if (!cascadesEnabled || !after.wins.length || cascadeIndex >= maxCascades - 1) break;
    if (chainReactions && cascadeIndex === 0) nextEvent(events, "feature-start", { featureId: "chain-reactions" });
    const cascade = await cascadeGrid(game, grid, after.wins, rng, draws, cascadeIndex, chainReactions);
    if (!cascade.removed.length) break;
    if (orbs) {
      const removedByReel = new Map<number, Set<number>>();
      for (const cell of cascade.removed) {
        const rows = removedByReel.get(cell.reel) ?? new Set<number>();
        rows.add(cell.row);
        removedByReel.set(cell.reel, rows);
      }
      for (let reel = 0; reel < grid.length; reel += 1) {
        const removeRows = removedByReel.get(reel) ?? new Set<number>();
        const survivors = orbValues[reel]!.filter((_, row) => !removeRows.has(row));
        orbValues[reel] = [...Array<undefined>(grid[reel]!.length - survivors.length).fill(undefined), ...survivors];
      }
    }
    nextEvent(events, "symbols-remove", { cells: cascade.removed, cascadeIndex });
    cascadeIndex += 1;
    nextEvent(events, "cascade-start", { cascadeIndex });
  }
  if (game.math.evaluator === "count") {
    const sequenceScatterWins = scatterWins(game, grid, BigInt(betUnits));
    for (const win of sequenceScatterWins) nextEvent(events, "win", { ...win, scatterPay: true });
    wins.push(...sequenceScatterWins);
    totalWin += sequenceScatterWins.reduce((sum, win) => sum + BigInt(win.payoutUnits), 0n);
  }
  if (orbs) {
    const orbSum = orbValues.flat().reduce<number>((sum, value) => sum + (value ?? 0), 0);
    if (orbSum > 0 && totalWin > 0n) {
      let totalMultiplier = orbSum;
      if (phase === "free-spin") {
        const meters = (state.meters ??= {});
        meters["orb-total"] = (meters["orb-total"] ?? 0) + orbSum;
        totalMultiplier = meters["orb-total"];
      }
      const winBefore = totalWin;
      totalWin *= BigInt(totalMultiplier);
      nextEvent(events, "tumble-multiplier", { featureId: "tumble-multiplier-orbs", sum: orbSum, totalMultiplier, winBeforeUnits: winBefore.toString(), winAfterUnits: totalWin.toString(), phase });
    }
  }
  capturePersistentState(game, grid, state);
  return { grid, triggerGrid: triggerGrid ?? structuredClone(grid), wins, totalWin, draws, events };
}

async function deriveRoundGame(game: GameConfig, request: GameRoundRequest, state: FeatureState, rng: RngProvider, draws: RngDraw[], events: GameEvent[]): Promise<GameConfig> {
  let derived = game;
  const ante = selection(game, "ante-bet");
  const anteActive = Boolean(ante && (ante.config?.["alwaysOn"] === true || request.anteBet));
  if (ante && anteActive && derived.math.symbolWeights) {
    // `scatterWeightMultiplierBps` allows fractional boosts (e.g. 11500 = x1.15); with a 4-scatter
    // trigger, symbol frequency scales the trigger chance roughly to the 4th power.
    const factorBps = ante.config?.["scatterWeightMultiplierBps"] !== undefined
      ? Math.max(10000, Math.floor(configuredNumber(ante, "scatterWeightMultiplierBps", 10000)))
      : Math.max(2, Math.floor(configuredNumber(ante, "scatterWeightMultiplier", 2))) * 10000;
    const scatters = symbolIdsOfKind(derived, "scatter");
    const weights = Object.fromEntries(Object.entries(derived.math.symbolWeights).map(([symbol, weight]) => [symbol, scatters.has(symbol) ? Math.max(1, Math.round(weight * factorBps / 10000)) : weight]));
    derived = { ...derived, math: { ...derived.math, symbolWeights: weights } };
    nextEvent(events, "feature-start", { featureId: "ante-bet", scatterWeightMultiplier: factorBps / 10000 });
  }
  const extra = selection(game, "extra-reel");
  if (extra) {
    const draw = await rng.uniformInt(10000, "extra-reel:chance");
    draws.push(draw);
    if (draw.value < boundedBps(extra, "chanceBps", 2500)) {
      const rows = Array.isArray(derived.layout.rows) ? [...derived.layout.rows, derived.layout.rows[derived.layout.rows.length - 1] ?? 3] : derived.layout.rows;
      derived = { ...derived, layout: { ...derived.layout, reels: derived.layout.reels + 1, rows } };
      nextEvent(events, "grid-resize", { featureId: "extra-reel", reels: derived.layout.reels, rows: derived.layout.rows });
    }
  }
  const expanding = selection(game, "expanding-grid");
  if (expanding) {
    const extraRows = Math.min(state.meters?.["expanding-grid"] ?? 0, Math.max(1, Math.floor(configuredNumber(expanding, "maxExtraRows", 3))));
    if (extraRows > 0) {
      const rows = Array.isArray(derived.layout.rows) ? derived.layout.rows.map((count) => count + extraRows) : derived.layout.rows + extraRows;
      derived = { ...derived, layout: { ...derived.layout, rows } };
      nextEvent(events, "grid-resize", { featureId: "expanding-grid", rows });
    }
  }
  const growth = selection(game, "reel-growth");
  if (growth) {
    const base = rowCounts(derived);
    const grown = base.map((count, reel) => count + Math.min(state.meters?.[`reel-growth:${reel}`] ?? 0, 2));
    if (grown.some((count, reel) => count !== base[reel])) {
      derived = { ...derived, layout: { ...derived.layout, rows: grown } };
      nextEvent(events, "grid-resize", { featureId: "reel-growth", rows: grown });
    }
  }
  return derived;
}

interface RespinOutcome {
  award: bigint;
  wins: Win[];
  finalGrid?: Grid;
}

async function respinFullGrid(game: GameConfig, betUnits: string, rng: RngProvider, events: GameEvent[], draws: RngDraw[], featureId: string, context: string, keepCells?: Map<string, string>): Promise<{ grid: Grid; total: bigint; wins: Win[] }> {
  const generated = await generateGrid(game, rng, context);
  draws.push(...generated.draws);
  const grid = generated.grid;
  for (const [key, symbolId] of keepCells ?? []) {
    const [reel, row] = key.split(":").map(Number) as [number, number];
    if (grid[reel]?.[row] !== undefined) grid[reel]![row] = symbolId;
  }
  const evaluated = evaluateGrid(game, grid, betUnits);
  nextEvent(events, "respin", { featureId, grid: structuredClone(grid), totalWinUnits: evaluated.totalWinUnits });
  for (const win of evaluated.wins) nextEvent(events, "win", { ...win, featureId });
  return { grid, total: BigInt(evaluated.totalWinUnits), wins: evaluated.wins };
}

async function resolveRespinFeatures(game: GameConfig, betUnits: string, base: SingleSpinResult, rng: RngProvider, state: FeatureState, events: GameEvent[], draws: RngDraw[]): Promise<RespinOutcome> {
  const outcome: RespinOutcome = { award: 0n, wins: [] };
  const lost = base.totalWin === 0n;
  const wild = game.symbols.find((symbol) => symbol.kind === "wild")?.id;
  const respins = selection(game, "respins");
  if (respins && lost) {
    const count = Math.max(1, Math.floor(configuredNumber(respins, "count", 1)));
    for (let index = 0; index < count; index += 1) {
      const spin = await respinFullGrid(game, betUnits, rng, events, draws, "respins", `respin:${index}`);
      outcome.award += spin.total;
      outcome.wins.push(...spin.wins);
      outcome.finalGrid = spin.grid;
      if (spin.total > 0n) break;
    }
  }
  const secondChance = selection(game, "second-chance");
  if (secondChance && lost && outcome.award === 0n) {
    const draw = await rng.uniformInt(10000, "second-chance:chance");
    draws.push(draw);
    if (draw.value < boundedBps(secondChance, "chanceBps", 5000)) {
      nextEvent(events, "feature-start", { featureId: "second-chance" });
      const spin = await respinFullGrid(game, betUnits, rng, events, draws, "second-chance", "second-chance");
      outcome.award += spin.total;
      outcome.wins.push(...spin.wins);
      outcome.finalGrid = spin.grid;
    }
  }
  const reelRespin = selection(game, "reel-respin");
  if (reelRespin && lost && outcome.award === 0n) {
    const grid = structuredClone(outcome.finalGrid ?? base.grid);
    const draw = await rng.uniformInt(grid.length, "reel-respin:reel");
    draws.push(draw);
    const reel = draw.value;
    for (let row = 0; row < grid[reel]!.length; row += 1) grid[reel]![row] = await replacementSymbol(game, rng, draws, `reel-respin:cell:${reel}:${row}`);
    const evaluated = evaluateGrid(game, grid, betUnits);
    nextEvent(events, "respin", { featureId: "reel-respin", reel, grid: structuredClone(grid), totalWinUnits: evaluated.totalWinUnits });
    for (const win of evaluated.wins) nextEvent(events, "win", { ...win, featureId: "reel-respin" });
    outcome.award += BigInt(evaluated.totalWinUnits);
    outcome.wins.push(...evaluated.wins);
    outcome.finalGrid = grid;
  }
  const nudge = selection(game, "nudge");
  if (nudge && lost && outcome.award === 0n) {
    const grid = structuredClone(outcome.finalGrid ?? base.grid);
    const draw = await rng.uniformInt(grid.length, "nudge:reel");
    draws.push(draw);
    const reel = draw.value;
    const incoming = await replacementSymbol(game, rng, draws, `nudge:cell:${reel}`);
    grid[reel] = [incoming, ...grid[reel]!.slice(0, -1)];
    const evaluated = evaluateGrid(game, grid, betUnits);
    nextEvent(events, "nudge", { featureId: "nudge", reel, direction: "down", grid: structuredClone(grid), totalWinUnits: evaluated.totalWinUnits });
    for (const win of evaluated.wins) nextEvent(events, "win", { ...win, featureId: "nudge" });
    outcome.award += BigInt(evaluated.totalWinUnits);
    outcome.wins.push(...evaluated.wins);
    outcome.finalGrid = grid;
  }
  const rewind = selection(game, "rewind");
  if (rewind && lost && state.lastGrid) {
    const grid = structuredClone(state.lastGrid) as Grid;
    const expected = rowCounts(game);
    if (grid.length === expected.length && grid.every((column, reel) => column.length === expected[reel])) {
      const multiplier = BigInt(Math.max(1, Math.floor(configuredNumber(rewind, "multiplier", 1))));
      const evaluated = evaluateGrid(game, grid, betUnits);
      const rewound = evaluated.wins.map((win) => ({ ...win, payoutUnits: (BigInt(win.payoutUnits) * multiplier).toString() }));
      const total = rewound.reduce((sum, win) => sum + BigInt(win.payoutUnits), 0n);
      nextEvent(events, "feature-start", { featureId: "rewind", multiplier: Number(multiplier) });
      nextEvent(events, "respin", { featureId: "rewind", grid: structuredClone(grid), totalWinUnits: total.toString() });
      for (const win of rewound) nextEvent(events, "win", { ...win, featureId: "rewind" });
      outcome.award += total;
      outcome.wins.push(...rewound);
    }
  }
  const wildRespin = selection(game, "wild-respin");
  if (wildRespin && wild && base.grid.some((column) => column.includes(wild))) {
    const keep = new Map<string, string>();
    base.grid.forEach((column, reel) => column.forEach((symbol, row) => {
      if (symbol === wild) keep.set(`${reel}:${row}`, wild);
    }));
    nextEvent(events, "feature-start", { featureId: "wild-respin", locked: keep.size });
    const spin = await respinFullGrid(game, betUnits, rng, events, draws, "wild-respin", "wild-respin", keep);
    outcome.award += spin.total;
    outcome.wins.push(...spin.wins);
    outcome.finalGrid = spin.grid;
  }
  return outcome;
}

function resolveTriggerModifiers(game: GameConfig, request: GameRoundRequest, triggerGrid: Grid, state: FeatureState, events: GameEvent[], naturalTriggered: boolean, required: number, betUnits: bigint): boolean {
  let triggered = naturalTriggered;
  const meters = (state.meters ??= {});
  const buy = selection(game, "bonus-buy");
  if (buy && (request.purchasedFeatureId === "bonus-buy" || (!triggered && buy.config?.["alwaysBuy"] === true))) {
    triggered = true;
    nextEvent(events, "feature-start", { featureId: "bonus-buy", costUnits: (betUnits * BigInt(Math.max(1, Math.floor(configuredNumber(buy, "costMultiplier", 100))))).toString() });
  }
  const drop = selection(game, "feature-drop");
  if (drop) {
    const target = Math.max(1, Math.floor(configuredNumber(drop, "target", 6)));
    const landed = countSymbols(triggerGrid, symbolIdsOfKind(game, "bonus"));
    const remaining = (meters["feature-drop"] ?? target) - landed;
    if (landed > 0) nextEvent(events, "collection-update", { featureId: "feature-drop", meter: "feature-drop", added: landed, remaining: Math.max(0, remaining), target });
    if (remaining <= 0) {
      triggered = true;
      meters["feature-drop"] = target;
      nextEvent(events, "feature-start", { featureId: "feature-drop" });
    } else {
      meters["feature-drop"] = remaining;
    }
  }
  const guarantee = selection(game, "feature-guarantee");
  if (guarantee) {
    if (triggered) {
      meters["feature-guarantee"] = 0;
    } else {
      const rounds = Math.max(1, Math.floor(configuredNumber(guarantee, "rounds", 5)));
      meters["feature-guarantee"] = (meters["feature-guarantee"] ?? 0) + 1;
      if (meters["feature-guarantee"] >= rounds) {
        triggered = true;
        meters["feature-guarantee"] = 0;
        nextEvent(events, "feature-start", { featureId: "feature-guarantee" });
      }
    }
  }
  if (selection(game, "near-miss-enhancement") && !triggered && scatterCount(game, triggerGrid) === required - 1) {
    nextEvent(events, "near-miss", { featureId: "near-miss-enhancement", scatterCount: required - 1, required });
  }
  return triggered;
}

async function resolveFreeSpins(game: GameConfig, betUnits: string, rng: RngProvider, state: FeatureState, events: GameEvent[], draws: RngDraw[]): Promise<{ wins: Win[]; total: bigint; finalGrid?: Grid }> {
  const feature = selection(game, "free-spins");
  if (!feature) return { wins: [], total: 0n };
  if (selection(game, "tumble-multiplier-orbs")) (state.meters ??= {})["orb-total"] = 0;
  let remaining = Math.max(1, Math.floor(configuredNumber(feature, "spins", 8)));
  const retrigger = selection(game, "retriggering-free-spins");
  const retriggerSpins = Math.max(1, Math.floor(configuredNumber(retrigger, "spins", 3)));
  const expanding = selection(game, "expanding-reels");
  const trail = selection(game, "free-spins-trail");
  const allWins: Win[] = [];
  let total = 0n;
  let index = 0;
  let finalGrid: Grid | undefined;
  nextEvent(events, "free-spins-start", { spins: remaining });
  while (remaining > 0 && index < 50) {
    remaining -= 1;
    let spinGame = game;
    if (expanding) {
      const extraRows = Math.min(index, Math.max(1, Math.floor(configuredNumber(expanding, "maxExtraRows", 3))));
      if (extraRows > 0) {
        const rows = rowCounts(game).map((count) => count + extraRows);
        spinGame = { ...game, layout: { ...game.layout, rows } };
        nextEvent(events, "grid-resize", { featureId: "expanding-reels", rows });
      }
    }
    const spin = await singleSpin(spinGame, betUnits, rng, state, `free-spin:${index}`);
    draws.push(...spin.draws);
    for (const event of spin.events) nextEvent(events, event.type, { ...event.data, freeSpinIndex: index });
    const multiplier = selection(game, "increasing-multipliers") ? index + 1 : Math.max(1, state.freeSpinMultiplier ?? 1);
    const multiplied = spin.wins.map((win) => ({ ...win, payoutUnits: (BigInt(win.payoutUnits) * BigInt(multiplier)).toString() }));
    const spinTotal = spin.totalWin * BigInt(multiplier);
    total += spinTotal;
    allWins.push(...multiplied);
    finalGrid = spin.grid;
    nextEvent(events, "free-spin", { index, remaining, multiplier, grid: spin.grid, wins: multiplied, totalWinUnits: spinTotal.toString() });
    if (retrigger && scatterCount(spinGame, configuredString(retrigger, "countOn") === "final-grid" ? spin.grid : spin.triggerGrid) >= configuredNumber(retrigger, "scatterCount", 3)) {
      remaining += retriggerSpins;
      nextEvent(events, "feature-start", { featureId: "retriggering-free-spins", addedSpins: retriggerSpins, remaining });
    }
    if (trail) {
      const scatters = scatterCount(spinGame, spin.triggerGrid);
      if (scatters > 0) {
        const meters = (state.meters ??= {});
        const step = Math.max(1, Math.floor(configuredNumber(trail, "step", 2)));
        meters["free-spins-trail"] = (meters["free-spins-trail"] ?? 0) + scatters;
        nextEvent(events, "collection-update", { featureId: "free-spins-trail", meter: "free-spins-trail", added: scatters, total: meters["free-spins-trail"], step });
        while (meters["free-spins-trail"]! >= step) {
          meters["free-spins-trail"]! -= step;
          remaining += 1;
          nextEvent(events, "feature-start", { featureId: "free-spins-trail", addedSpins: 1, remaining });
        }
      }
    }
    index += 1;
  }
  state.freeSpinsRemaining = 0;
  if (selection(game, "persistent-multipliers")) state.freeSpinMultiplier = Math.max(1, (state.freeSpinMultiplier ?? 1) + index);
  nextEvent(events, "free-spins-end", { spinsPlayed: index, totalWinUnits: total.toString() });
  return { wins: allWins, total, ...(finalGrid ? { finalGrid } : {}) };
}

async function resolveHoldAndWin(game: GameConfig, betUnits: string, triggerGrid: Grid, rng: RngProvider, events: GameEvent[], draws: RngDraw[]): Promise<bigint> {
  const feature = selection(game, "hold-and-win") ?? selection(game, "lock-and-respin");
  if (!feature) return 0n;
  const bonusIds = new Set(game.symbols.filter((symbol) => symbol.kind === "bonus" || symbol.kind === "collect").map((symbol) => symbol.id));
  const configuredTriggerKind = configuredString(feature, "triggerSymbolKind");
  const triggerIds = configuredTriggerKind ? symbolIdsOfKind(game, configuredTriggerKind) : bonusIds;
  const landed = triggerGrid.flat().filter((symbol) => triggerIds.has(symbol)).length;
  const threshold = Math.floor(configuredNumber(feature, "triggerCount", 3));
  if (landed < threshold) return 0n;
  const cells = triggerGrid.map((column) => column.map((symbol) => triggerIds.has(symbol)));
  const requestedCoinSymbol = configuredString(feature, "coinSymbolId");
  const coinSymbol = requestedCoinSymbol && game.symbols.some((symbol) => symbol.id === requestedCoinSymbol) ? requestedCoinSymbol : [...bonusIds][0] ?? [...triggerIds][0] ?? game.symbols[0]?.id;
  const blankSymbol = game.symbols.find((symbol) => symbol.kind === "normal")?.id ?? coinSymbol;
  if (!coinSymbol || !blankSymbol) return 0n;
  const coinMultiplier = BigInt(Math.max(1, Math.floor(configuredNumber(feature, "coinMultiplier", 1))));
  const hitBps = boundedBps(feature, "hitBps", 2200);
  let lives = 3;
  let respin = 0;
  let newCoins = 0;
  const initialGrid = cells.map((column) => column.map((locked) => locked ? coinSymbol : blankSymbol));
  nextEvent(events, "hold-win-start", { featureId: feature.id, locked: landed, lives, cells: cells.map((column) => [...column]), grid: initialGrid });
  while (lives > 0 && respin < 50) {
    let hit = false;
    for (let reel = 0; reel < cells.length; reel += 1) {
      for (let row = 0; row < cells[reel]!.length; row += 1) {
        if (cells[reel]![row]) continue;
        const draw = await rng.uniformInt(10000, `hold-win:${respin}:${reel}:${row}`);
        draws.push(draw);
        if (draw.value < hitBps) {
          cells[reel]![row] = true;
          newCoins += 1;
          hit = true;
        }
      }
    }
    lives = hit ? 3 : lives - 1;
    const grid = cells.map((column) => column.map((locked) => locked ? coinSymbol : blankSymbol));
    nextEvent(events, "respin", { featureId: feature.id, index: respin, lives, locked: landed + newCoins, cells: cells.map((column) => [...column]), grid });
    respin += 1;
    if (cells.every((column) => column.every(Boolean))) break;
  }
  const award = BigInt(landed + newCoins) * BigInt(betUnits) * coinMultiplier;
  nextEvent(events, "hold-win-end", { featureId: feature.id, coins: landed + newCoins, awardUnits: award.toString() });
  return award;
}

interface PendingPlan {
  featureId: string;
  type: PendingAction["type"];
  choices: PendingAction["choices"];
  awardsByChoice: Record<string, string>;
  eventsByChoice?: InternalContinuation["eventsByChoice"];
}

const JACKPOT_TIER_DEFAULTS: Record<string, number> = { mini: 10, minor: 25, major: 100, grand: 500 };

async function drawJackpotTier(feature: FeatureSelection, rng: RngProvider, draws: RngDraw[], context: string): Promise<{ tier: string; multiplier: number }> {
  const tiers = ["mini", "minor", "major", "grand"];
  const weights = configuredNumbers(feature, "weights", [60, 25, 10, 5]).slice(0, tiers.length);
  while (weights.length < tiers.length) weights.push(1);
  const total = weights.reduce((sum, weight) => sum + Math.max(1, Math.floor(weight)), 0);
  const draw = await rng.uniformInt(total, context);
  draws.push(draw);
  let cursor = draw.value;
  for (const [index, tier] of tiers.entries()) {
    const weight = Math.max(1, Math.floor(weights[index]!));
    if (cursor < weight) return { tier, multiplier: Math.max(1, Math.floor(configuredNumber(feature, tier, JACKPOT_TIER_DEFAULTS[tier]!))) };
    cursor -= weight;
  }
  return { tier: "mini", multiplier: JACKPOT_TIER_DEFAULTS["mini"]! };
}

async function resolveJackpotFeatures(game: GameConfig, betUnits: bigint, triggerGrid: Grid, rng: RngProvider, state: FeatureState, events: GameEvent[], draws: RngDraw[]): Promise<{ award: bigint; plan?: PendingPlan }> {
  let award = 0n;
  let plan: PendingPlan | undefined;
  const meters = (state.meters ??= {});
  const jackpotIds = symbolIdsOfKind(game, "jackpot");
  const jackpotSymbols = countSymbols(triggerGrid, jackpotIds);
  const fixed = selection(game, "fixed-jackpot");
  if (fixed && jackpotSymbols >= Math.max(1, Math.floor(configuredNumber(fixed, "count", 3)))) {
    const units = betUnits * BigInt(Math.max(1, Math.floor(configuredNumber(fixed, "multiplier", 100))));
    award += units;
    nextEvent(events, "jackpot-award", { featureId: "fixed-jackpot", tier: "fixed", awardUnits: units.toString() });
  }
  const tiers = selection(game, "jackpot-tiers");
  if (tiers && jackpotSymbols >= 3) {
    const names = ["mini", "minor", "major", "grand"] as const;
    const tier = names[Math.min(jackpotSymbols - 3, names.length - 1)]!;
    const units = betUnits * BigInt(Math.max(1, Math.floor(configuredNumber(tiers, tier, JACKPOT_TIER_DEFAULTS[tier]!))));
    award += units;
    nextEvent(events, "jackpot-award", { featureId: "jackpot-tiers", tier, symbols: jackpotSymbols, awardUnits: units.toString() });
  }
  for (const [id, tier, contributionFallback, triggerFallback, seedFallback] of [
    ["progressive-jackpot", "progressive", 100, 5, 100],
    ["local-jackpot", "local", 150, 20, 25],
  ] as const) {
    const feature = selection(game, id);
    if (!feature) continue;
    const contribution = Number(betUnits * BigInt(boundedBps(feature, "contributionBps", contributionFallback)) / 10000n) || 1;
    meters[id] = (meters[id] ?? 0) + contribution;
    nextEvent(events, "jackpot-contribution", { featureId: id, contributionUnits: contribution.toString(), poolUnits: String(meters[id]) });
    const draw = await rng.uniformInt(10000, `${id}:trigger`);
    draws.push(draw);
    if (draw.value < boundedBps(feature, "triggerBps", triggerFallback)) {
      const units = BigInt(meters[id]!) + betUnits * BigInt(Math.max(0, Math.floor(configuredNumber(feature, "seedMultiplier", seedFallback))));
      meters[id] = 0;
      award += units;
      nextEvent(events, "jackpot-award", { featureId: id, tier, awardUnits: units.toString() });
    }
  }
  const mustWin = selection(game, "must-win-by-jackpot");
  if (mustWin) {
    const contribution = Number(betUnits * BigInt(boundedBps(mustWin, "contributionBps", 200)) / 10000n) || 1;
    meters["must-win-by-jackpot"] = (meters["must-win-by-jackpot"] ?? 0) + contribution;
    const ceiling = betUnits * BigInt(Math.max(1, Math.floor(configuredNumber(mustWin, "mustWinByMultiplier", 20))));
    nextEvent(events, "jackpot-contribution", { featureId: "must-win-by-jackpot", contributionUnits: contribution.toString(), poolUnits: String(meters["must-win-by-jackpot"]), ceilingUnits: ceiling.toString() });
    if (BigInt(meters["must-win-by-jackpot"]!) >= ceiling) {
      const units = BigInt(meters["must-win-by-jackpot"]!);
      meters["must-win-by-jackpot"] = 0;
      award += units;
      nextEvent(events, "jackpot-award", { featureId: "must-win-by-jackpot", tier: "must-win-by", forced: true, awardUnits: units.toString() });
    }
  }
  const mystery = selection(game, "mystery-jackpot");
  if (mystery) {
    const draw = await rng.uniformInt(10000, "mystery-jackpot:trigger");
    draws.push(draw);
    if (draw.value < boundedBps(mystery, "triggerBps", 30)) {
      const values = configuredNumbers(mystery, "values", [20, 50, 100]);
      const pick = await rng.uniformInt(values.length, "mystery-jackpot:value");
      draws.push(pick);
      const units = betUnits * BigInt(Math.max(1, Math.floor(values[pick.value]!)));
      award += units;
      nextEvent(events, "jackpot-award", { featureId: "mystery-jackpot", tier: "mystery", awardUnits: units.toString() });
    }
  }
  const wheel = selection(game, "jackpot-wheel");
  if (wheel && jackpotSymbols >= Math.max(1, Math.floor(configuredNumber(wheel, "count", 3)))) {
    const outcome = await drawJackpotTier(wheel, rng, draws, "jackpot-wheel:tier");
    const units = betUnits * BigInt(outcome.multiplier);
    plan = {
      featureId: "jackpot-wheel", type: "wheel",
      choices: [{ id: "spin", labelKey: "bonus.wheel.spin" }],
      awardsByChoice: { spin: units.toString() },
      eventsByChoice: { spin: [{ type: "jackpot-award", data: { featureId: "jackpot-wheel", tier: outcome.tier, awardUnits: units.toString() } }] },
    };
  }
  const pickBonus = selection(game, "jackpot-pick-bonus");
  if (!plan && pickBonus && jackpotSymbols >= Math.max(1, Math.floor(configuredNumber(pickBonus, "count", 3)))) {
    const choiceCount = Math.max(2, Math.min(6, Math.floor(configuredNumber(pickBonus, "choices", 3))));
    const choices: PendingAction["choices"] = [];
    const awardsByChoice: Record<string, string> = {};
    const eventsByChoice: NonNullable<InternalContinuation["eventsByChoice"]> = {};
    for (let index = 0; index < choiceCount; index += 1) {
      const id = `choice-${index + 1}`;
      const outcome = await drawJackpotTier(pickBonus, rng, draws, `jackpot-pick-bonus:tier:${index}`);
      const units = betUnits * BigInt(outcome.multiplier);
      choices.push({ id, labelKey: `bonus.choice.${index + 1}` });
      awardsByChoice[id] = units.toString();
      eventsByChoice[id] = [{ type: "jackpot-award", data: { featureId: "jackpot-pick-bonus", tier: outcome.tier, awardUnits: units.toString() } }];
    }
    plan = { featureId: "jackpot-pick-bonus", type: "pick", choices, awardsByChoice, eventsByChoice };
  }
  return { award, ...(plan ? { plan } : {}) };
}

async function createChooseYourBonusPlan(game: GameConfig, betUnits: string, rng: RngProvider, state: FeatureState, draws: RngDraw[]): Promise<PendingPlan> {
  const chooser = selection(game, "choose-your-bonus")!;
  const raw = chooser.config?.["packages"];
  const packages = (Array.isArray(raw) ? raw.filter((entry): entry is { spins: number; multiplier: number } =>
    Boolean(entry) && typeof entry === "object" && typeof (entry as { spins?: unknown }).spins === "number" && typeof (entry as { multiplier?: unknown }).multiplier === "number") : []);
  const resolved = packages.length ? packages : [{ spins: 8, multiplier: 1 }, { spins: 5, multiplier: 2 }, { spins: 3, multiplier: 3 }];
  const choices: PendingAction["choices"] = [];
  const awardsByChoice: Record<string, string> = {};
  const eventsByChoice: NonNullable<InternalContinuation["eventsByChoice"]> = {};
  for (const [index, pack] of resolved.entries()) {
    const id = `package-${index + 1}`;
    choices.push({ id, labelKey: `bonus.package.${index + 1}` });
    const packageGame: GameConfig = { ...game, features: game.features.map((feature) => feature.id === "free-spins" ? { ...feature, config: { ...feature.config, spins: Math.max(1, Math.floor(pack.spins)) } } : feature) };
    const packageState = structuredClone(state);
    packageState.freeSpinMultiplier = Math.max(1, Math.floor(pack.multiplier));
    const packageEvents: GameEvent[] = [];
    const outcome = await resolveFreeSpins(packageGame, betUnits, rng, packageState, packageEvents, draws);
    awardsByChoice[id] = outcome.total.toString();
    eventsByChoice[id] = packageEvents.map(({ type, data }) => ({ type, data: { ...data, featureId: (data as { featureId?: string }).featureId ?? "choose-your-bonus" } }));
  }
  return { featureId: "choose-your-bonus", type: "pick", choices, awardsByChoice, eventsByChoice };
}

function interactiveFeature(game: GameConfig): FeatureSelection | undefined {
  const ids = ["pick-and-click-bonus", "wheel-bonus", "board-game-bonus", "treasure-chest-bonus", "match-three-bonus", "skill-style-bonus", "choose-a-path-bonus", "boss-battle-bonus"];
  return game.features.find((feature) => feature.enabled && ids.includes(feature.id));
}

async function createInteractivePlan(feature: FeatureSelection, betUnits: bigint, rng: RngProvider, draws: RngDraw[]): Promise<PendingPlan> {
  const choiceCount = Math.max(2, Math.min(12, Math.floor(configuredNumber(feature, "choices", 3))));
  const multipliers = Array.isArray(feature.config?.awards) ? feature.config.awards.filter((value): value is number => typeof value === "number" && value >= 0) : [1, 2, 5];
  const choices: PendingAction["choices"] = [];
  const awardsByChoice: Record<string, string> = {};
  for (let index = 0; index < choiceCount; index += 1) {
    const id = `choice-${index + 1}`;
    const draw = await rng.uniformInt(multipliers.length, `${feature.id}:award:${index}`);
    draws.push(draw);
    const multiplier = multipliers[draw.value] ?? 1;
    choices.push({ id, labelKey: `bonus.choice.${index + 1}` });
    awardsByChoice[id] = (betUnits * BigInt(Math.floor(multiplier))).toString();
  }
  const type: PendingAction["type"] = feature.id.includes("wheel") ? "wheel" : feature.id.includes("path") ? "path" : feature.id.includes("board") ? "board" : feature.id.includes("skill") || feature.id.includes("battle") ? "skill" : "pick";
  return { featureId: feature.id, type, choices, awardsByChoice };
}

async function createGamblePlan(game: GameConfig, totalWin: bigint, rng: RngProvider, draws: RngDraw[]): Promise<PendingPlan | undefined> {
  if (totalWin <= 0n) return undefined;
  const doubleFeature = selection(game, "double-or-nothing");
  const gambleFeature = selection(game, "gamble-feature");
  if (!doubleFeature && !gambleFeature) return undefined;
  if (doubleFeature) {
    const draw = await rng.uniformInt(2, "double-or-nothing:outcome");
    draws.push(draw);
    const won = draw.value === 0;
    return {
      featureId: "double-or-nothing", type: "gamble",
      choices: [{ id: "collect", labelKey: "bonus.gamble.collect" }, { id: "double", labelKey: "bonus.gamble.double" }],
      awardsByChoice: { collect: "0", double: (won ? totalWin : -totalWin).toString() },
      eventsByChoice: { double: [{ type: "feature-start", data: { featureId: "double-or-nothing", outcome: won ? "won" : "lost" } }] },
    };
  }
  const draw = await rng.uniformInt(2, "gamble-feature:outcome");
  draws.push(draw);
  const winning = draw.value === 0 ? "red" : "black";
  const awardFor = (color: string): string => (color === winning ? totalWin : -totalWin).toString();
  return {
    featureId: "gamble-feature", type: "gamble",
    choices: [{ id: "red", labelKey: "bonus.gamble.red" }, { id: "black", labelKey: "bonus.gamble.black" }],
    awardsByChoice: { red: awardFor("red"), black: awardFor("black") },
    eventsByChoice: {
      red: [{ type: "feature-start", data: { featureId: "gamble-feature", winningColor: winning, outcome: winning === "red" ? "won" : "lost" } }],
      black: [{ type: "feature-start", data: { featureId: "gamble-feature", winningColor: winning, outcome: winning === "black" ? "won" : "lost" } }],
    },
  };
}

async function updateRoundMemory(game: GameConfig, state: FeatureState, base: SingleSpinResult, totalWin: bigint, rng: RngProvider, draws: RngDraw[], events: GameEvent[]): Promise<void> {
  if (selection(game, "rewind")) state.lastGrid = structuredClone(base.grid);
  const expanding = selection(game, "expanding-grid");
  if (expanding && totalWin > 0n) {
    const meters = (state.meters ??= {});
    meters["expanding-grid"] = Math.min((meters["expanding-grid"] ?? 0) + 1, Math.max(1, Math.floor(configuredNumber(expanding, "maxExtraRows", 3))));
    nextEvent(events, "feature-start", { featureId: "expanding-grid", extraRows: meters["expanding-grid"] });
  }
  const growth = selection(game, "reel-growth");
  if (growth && totalWin > 0n) {
    const draw = await rng.uniformInt(game.layout.reels, "reel-growth:reel");
    draws.push(draw);
    const meters = (state.meters ??= {});
    const key = `reel-growth:${draw.value}`;
    meters[key] = Math.min((meters[key] ?? 0) + 1, 2);
    nextEvent(events, "feature-start", { featureId: "reel-growth", reel: draw.value, extraRows: meters[key] });
  }
}

/** Total stake reserved for a round: base bet, ante-boosted bet, or feature-purchase cost. */
export function roundCostUnits(game: GameConfig, request: Pick<GameRoundRequest, "betUnits" | "purchasedFeatureId" | "anteBet">): bigint {
  const bet = BigInt(request.betUnits);
  if (isBookOfRaDeluxe(game)) return bet * 10n;
  if (request.purchasedFeatureId === "bonus-buy") {
    const buy = selection(game, "bonus-buy");
    if (buy) return bet * BigInt(Math.max(1, Math.floor(configuredNumber(buy, "costMultiplier", 100))));
  }
  if (request.anteBet) {
    const ante = selection(game, "ante-bet");
    if (ante) return bet * BigInt(Math.max(10000, Math.floor(configuredNumber(ante, "stakeMultiplierBps", 12500)))) / 10000n;
  }
  return bet;
}

export class DefaultGameEngine implements GameEngine {
  async spin(game: GameConfig, request: GameRoundRequest, rng: RngProvider): Promise<RoundComputation> {
    if (!/^[1-9]\d*$/.test(request.betUnits)) throw new Error("betUnits must be a positive integer string");
    if (request.anteBet && request.purchasedFeatureId) throw new Error("Ante bet cannot be combined with a feature purchase");
    if (isBookOfRaDeluxe(game)) return spinBookOfRaDeluxe(game, request, rng);
    const bet = BigInt(request.betUnits);
    const costUnits = roundCostUnits(game, request);
    const state = structuredClone(request.featureState ?? {});
    const events: GameEvent[] = [];
    nextEvent(events, "round-start", { betUnits: request.betUnits, ...(costUnits !== bet ? { costUnits: costUnits.toString() } : {}), ...(request.anteBet ? { anteBet: true } : {}) });
    const draws: RngDraw[] = [];
    const roundGame = await deriveRoundGame(game, request, state, rng, draws, events);
    const guaranteedScatters = request.purchasedFeatureId === "bonus-buy" && selection(roundGame, "bonus-buy")
      ? Math.max(1, Math.floor(configuredNumber(selection(roundGame, "scatter-trigger"), "count", 3)))
      : 0;
    const base = await singleSpin(roundGame, request.betUnits, rng, state, "base", guaranteedScatters);
    events.push(...base.events.map((event) => ({ ...event, sequence: events.length + event.sequence })));
    draws.push(...base.draws);
    const wins = [...base.wins];
    let totalWin = base.totalWin;
    let finalGrid = base.grid;
    const respinOutcome = await resolveRespinFeatures(roundGame, request.betUnits, base, rng, state, events, draws);
    totalWin += respinOutcome.award;
    wins.push(...respinOutcome.wins);
    if (respinOutcome.finalGrid) finalGrid = respinOutcome.finalGrid;
    const scatterTrigger = selection(roundGame, "scatter-trigger");
    const requiredScatter = Math.floor(configuredNumber(scatterTrigger, "count", 3));
    const triggerCountGrid = configuredString(scatterTrigger, "countOn") === "final-grid" ? base.grid : base.triggerGrid;
    const naturalTrigger = scatterCount(roundGame, triggerCountGrid) >= requiredScatter;
    const triggered = resolveTriggerModifiers(roundGame, request, base.triggerGrid, state, events, naturalTrigger, requiredScatter, bet);
    let plan: PendingPlan | undefined;
    if (triggered && selection(roundGame, "choose-your-bonus") && selection(roundGame, "free-spins")) {
      nextEvent(events, "feature-start", { featureId: "choose-your-bonus" });
      plan = await createChooseYourBonusPlan(roundGame, request.betUnits, rng, state, draws);
    } else if (triggered && selection(roundGame, "free-spins")) {
      const freeSpins = await resolveFreeSpins(roundGame, request.betUnits, rng, state, events, draws);
      totalWin += freeSpins.total;
      wins.push(...freeSpins.wins);
      if (freeSpins.finalGrid) finalGrid = freeSpins.finalGrid;
    }
    totalWin += await resolveHoldAndWin(roundGame, request.betUnits, triggerCountGrid, rng, events, draws);
    const jackpots = await resolveJackpotFeatures(roundGame, bet, base.triggerGrid, rng, state, events, draws);
    totalWin += jackpots.award;
    plan ??= jackpots.plan;
    const interactive = interactiveFeature(roundGame);
    if (!plan && interactive && triggered) plan = await createInteractivePlan(interactive, bet, rng, draws);
    const combo = selection(roundGame, "feature-combination");
    if (combo && totalWin > 0n) {
      const contributors = new Set(events.map((event) => event.data.featureId).filter((id): id is string => typeof id === "string" && id !== "feature-combination"));
      if (contributors.size >= Math.max(2, Math.floor(configuredNumber(combo, "minFeatures", 2)))) {
        const multiplier = Math.max(2, Math.floor(configuredNumber(combo, "multiplier", 2)));
        totalWin *= BigInt(multiplier);
        nextEvent(events, "win-multiplier", { featureId: "feature-combination", multiplier, features: [...contributors].sort() });
      }
    }
    const cap = roundGame.math.targets.maxWinMultiplier;
    const capUnits = bet * BigInt(cap.numerator) / BigInt(cap.denominator);
    if (capUnits > 0n && totalWin > capUnits) {
      nextEvent(events, "max-win", { capUnits: capUnits.toString(), uncappedWinUnits: totalWin.toString() });
      totalWin = capUnits;
    }
    await updateRoundMemory(roundGame, state, base, totalWin, rng, draws, events);
    if (!plan) plan = await createGamblePlan(roundGame, totalWin, rng, draws);
    const requiresAction = Boolean(plan);
    if (!requiresAction) nextEvent(events, "round-complete", { totalWinUnits: totalWin.toString() });
    const baseResult = {
      roundId: request.roundId, gameId: game.id, gameVersion: game.version, playerId: request.playerId,
      betUnits: request.betUnits, totalWinUnits: totalWin.toString(), netUnits: (totalWin - costUnits).toString(),
      finalGrid, wins, events, draws, featureState: state, complete: true,
    } satisfies Omit<GameRoundResult, "outcomeHash">;
    let result: GameRoundResult = { ...baseResult, outcomeHash: hashOutcome(baseResult) };
    if (plan) {
      const action: PendingAction = { id: `${request.roundId}:${plan.featureId}`, type: plan.type, featureId: plan.featureId, choices: plan.choices };
      nextEvent(result.events, "choice-required", { action });
      result = { ...result, pendingAction: action, complete: false };
      const { outcomeHash: _pendingHash, ...pendingWithoutHash } = result;
      result.outcomeHash = hashOutcome(pendingWithoutHash);
      const continuation: InternalContinuation = { action, awardsByChoice: plan.awardsByChoice, ...(plan.eventsByChoice ? { eventsByChoice: plan.eventsByChoice } : {}), baseResult: result };
      return { result, continuation };
    }
    return { result };
  }

  /**
   * Resolves one pending action and reports any continuation it leaves behind.
   *
   * The generic path resolves in a single step. Book of Ra's gamble ladder can
   * leave a further pending action, which the caller persists before the next
   * request, so a retry can never resolve the same attempt twice.
   */
  resolveActionStep(
    continuation: InternalContinuation,
    actionId: string,
    choiceId: string,
  ): { result: GameRoundResult; continuation?: InternalContinuation } {
    if (continuation.engine === "book-of-ra" || continuation.bookOfRaState !== undefined) {
      return this.resolveBookOfRaActionStep(continuation, actionId, choiceId);
    }
    return { result: this.resolveGenericAction(continuation, actionId, choiceId) };
  }

  resolveAction(continuation: InternalContinuation, actionId: string, choiceId: string): GameRoundResult {
    return this.resolveActionStep(continuation, actionId, choiceId).result;
  }

  /** Book of Ra's server-authoritative red/black ladder. */
  private resolveBookOfRaActionStep(
    continuation: InternalContinuation,
    actionId: string,
    choiceId: string,
  ): { result: GameRoundResult; continuation?: InternalContinuation } {
    const stored = continuation.bookOfRaState as BookOfRaGameState | undefined;
    if (!stored) throw new Error("Pending action lost its authoritative Book of Ra state");
    if (stored.pendingActionId !== actionId) throw new Error("Pending action ID does not match this round");
    const { state, outcome } = resolveBookOfRaGamble(stored, choiceId as BookOfRaGambleChoice);
    const total = BigInt(state.pendingWin);
    const totalBet = BigInt(state.totalBet);
    const events = [...continuation.baseResult.events];
    nextEvent(events, "choice-resolved", {
      actionId,
      choiceId,
      attempt: outcome.attempt,
      winningColour: outcome.winningColour ?? null,
      won: outcome.won ?? null,
      pendingWinUnits: state.pendingWin,
      settlementUnits: outcome.settlement,
    });
    if (!outcome.complete && outcome.pendingAction) {
      nextEvent(events, "choice-required", {
        featureId: "gamble-feature",
        choices: ["red", "black", "collect"],
        maxAttempts: state.gambleMaxAttempts,
        actionId: outcome.pendingAction.id,
      });
    }
    nextEvent(events, "round-complete", { totalWinUnits: total.toString(), roundState: state.phase });
    const baseResult = {
      ...continuation.baseResult,
      totalWinUnits: total.toString(),
      netUnits: (total - totalBet).toString(),
      featureState: toFeatureState(state),
      events,
      complete: outcome.complete,
      roundState: state.phase,
      ...(outcome.pendingAction ? { pendingAction: outcome.pendingAction } : {}),
    } satisfies Omit<GameRoundResult, "outcomeHash">;
    if (!outcome.pendingAction) delete baseResult.pendingAction;
    const result = { ...baseResult, outcomeHash: hashOutcome(baseResult) } as GameRoundResult;
    if (outcome.pendingAction) {
      return {
        result,
        continuation: {
          engine: "book-of-ra",
          action: outcome.pendingAction,
          awardsByChoice: bookOfRaGambleAwards(state),
          baseResult: result,
          bookOfRaState: state,
        },
      };
    }
    return { result };
  }

  private resolveGenericAction(continuation: InternalContinuation, actionId: string, choiceId: string): GameRoundResult {
    if (continuation.action.id !== actionId) throw new Error("Pending action ID does not match this round");
    const award = continuation.awardsByChoice[choiceId];
    if (award === undefined) throw new Error("Unknown bonus choice");
    const events = [...continuation.baseResult.events];
    for (const extra of continuation.eventsByChoice?.[choiceId] ?? []) nextEvent(events, extra.type, extra.data);
    nextEvent(events, "choice-resolved", { actionId, choiceId, awardUnits: award });
    const totalWinUnits = (BigInt(continuation.baseResult.totalWinUnits) + BigInt(award)).toString();
    nextEvent(events, "round-complete", { totalWinUnits });
    const complete = {
      ...continuation.baseResult,
      totalWinUnits,
      netUnits: (BigInt(totalWinUnits) - (continuation.baseResult.gameId === "book-of-the-sands" ? BigInt(continuation.baseResult.betUnits) * 10n : BigInt(continuation.baseResult.featureState.bookOfRa?.totalBet ?? continuation.baseResult.betUnits))).toString(),
      events,
      complete: true,
    } as GameRoundResult;
    delete complete.pendingAction;
    const { outcomeHash: _outcomeHash, ...withoutHash } = complete;
    complete.outcomeHash = hashOutcome(withoutHash);
    return complete;
  }
}
