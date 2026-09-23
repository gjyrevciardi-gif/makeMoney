import type { FeatureSelection, GameConfig } from "@slot-skills/schema";
import type { Grid, RngDraw, RngProvider, Win } from "@slot-skills/math";

export interface FeatureEvent {
  type: string;
  featureId: string;
  data: Record<string, unknown>;
}

export interface FeatureState {
  freeSpinsRemaining?: number;
  freeSpinMultiplier?: number;
  collection?: Record<string, number>;
  stickyCells?: Array<{ reel: number; row: number; symbolId: string; remaining: number }>;
  walkingWilds?: Array<{ reel: number; row: number; direction: -1 | 1 }>;
  meters?: Record<string, number>;
  lastGrid?: string[][];
  upgrades?: Record<string, number>;
  /** Book of Ra Deluxe session data; persisted by the host between requests. */
  bookOfRa?: {
    phase:
      | "IDLE" | "SPIN_PENDING" | "SPIN_RESOLVED" | "WIN_PRESENTATION"
      | "FREE_GAME_INTRO" | "FREE_GAME_ACTIVE" | "FREE_GAME_COMPLETE"
      | "GAMBLE_PENDING" | "ROUND_COMPLETE";
    betPerLine: string;
    totalBet: string;
    activeLines: number;
    specialSymbol?: string;
    freeSpinsRemaining: number;
    freeSpinsPlayed: number;
    featureWin?: string;
    pendingWin?: string;
    gambleAttempts: number;
    gambleColor?: "red" | "black";
    /** Frozen mathematics the session was opened under. */
    profileId?: string;
    profileFingerprint?: string;
    freeSpinsAwarded?: number;
    retriggerCount?: number;
    spinIndex?: number;
    gambleMaxAttempts?: number;
    /** Colours for the whole gamble ladder, drawn once when it was offered. */
    gambleColours?: Array<"red" | "black">;
    gambleHistory?: Array<Record<string, unknown>>;
    pendingActionId?: string;
    pendingRoundId?: string;
    lastOutcome?: Record<string, unknown>;
  };
}

export interface FeatureContext {
  game: GameConfig;
  grid: Grid;
  betUnits: string;
  wins: Win[];
  totalWinUnits: string;
  rng: RngProvider;
  draws: RngDraw[];
  events: FeatureEvent[];
  state: FeatureState;
  cascadeIndex: number;
  phase?: "base" | "free-spin" | "respin";
}

function enabled(game: GameConfig, id: string): FeatureSelection | undefined {
  return game.features.find((feature) => feature.id === id && feature.enabled);
}

function configNumber(feature: FeatureSelection | undefined, name: string, fallback: number): number {
  const value = feature?.config?.[name];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function configString(feature: FeatureSelection | undefined, name: string): string | undefined {
  const value = feature?.config?.[name];
  return typeof value === "string" ? value : undefined;
}

function configNumbers(feature: FeatureSelection | undefined, name: string, fallback: number[]): number[] {
  const value = feature?.config?.[name];
  const numbers = Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry)) : [];
  return numbers.length ? numbers : fallback;
}

function wildSymbol(game: GameConfig): string | undefined {
  return game.symbols.find((symbol) => symbol.kind === "wild")?.id;
}

function symbolIdsOfKind(game: GameConfig, kind: string): Set<string> {
  return new Set(game.symbols.filter((symbol) => symbol.kind === kind).map((symbol) => symbol.id));
}

function countCells(grid: Grid, ids: Set<string>): number {
  return grid.flat().filter((symbol) => ids.has(symbol)).length;
}

async function randomCell(ctx: FeatureContext, featureId: string): Promise<{ reel: number; row: number }> {
  const cellCount = ctx.grid.reduce((total, reel) => total + reel.length, 0);
  const draw = await ctx.rng.uniformInt(cellCount, `${featureId}:cell`);
  ctx.draws.push(draw);
  let cursor = draw.value;
  for (let reel = 0; reel < ctx.grid.length; reel += 1) {
    if (cursor < ctx.grid[reel]!.length) return { reel, row: cursor };
    cursor -= ctx.grid[reel]!.length;
  }
  throw new Error("Random cell fell outside the grid");
}

async function weightedReplacement(ctx: FeatureContext, exclude: string, context: string): Promise<string> {
  const weights = Object.entries(ctx.game.math.symbolWeights ?? {}).filter(([symbol, weight]) => symbol !== exclude && weight > 0);
  const pool = weights.length ? weights : ctx.game.symbols.filter((symbol) => symbol.id !== exclude && symbol.kind === "normal").map((symbol) => [symbol.id, 1] as [string, number]);
  const total = pool.reduce((sum, [, weight]) => sum + weight, 0);
  const draw = await ctx.rng.uniformInt(Math.max(1, total), context);
  ctx.draws.push(draw);
  let cursor = draw.value;
  for (const [symbol, weight] of pool) {
    if (cursor < weight) return symbol;
    cursor -= weight;
  }
  return pool[0]?.[0] ?? exclude;
}

function emit(ctx: FeatureContext, featureId: string, type: string, data: Record<string, unknown>): void {
  ctx.events.push({ type, featureId, data });
}

function multiplyWins(ctx: FeatureContext, featureId: string, multiplier: number, affects?: (win: Win) => boolean): void {
  const factor = BigInt(Math.max(1, Math.floor(multiplier)));
  if (factor <= 1n || BigInt(ctx.totalWinUnits) <= 0n) return;
  if (affects && !ctx.wins.some(affects)) return;
  ctx.wins = ctx.wins.map((win) => (!affects || affects(win)) ? { ...win, payoutUnits: (BigInt(win.payoutUnits) * factor).toString() } : win);
  ctx.totalWinUnits = ctx.wins.reduce((total, win) => total + BigInt(win.payoutUnits), 0n).toString();
  emit(ctx, featureId, "win-multiplier", { multiplier: Number(factor) });
}

function winContainsSymbol(ctx: FeatureContext, symbolId: string): (win: Win) => boolean {
  return (win) => win.cells.some((cell) => ctx.grid[cell.reel]?.[cell.row] === symbolId);
}

export async function applyPreEvaluationFeatures(ctx: FeatureContext): Promise<void> {
  const wild = wildSymbol(ctx.game);
  if (wild) {
    const random = enabled(ctx.game, "random-wilds");
    const upgradeBonus = ctx.state.upgrades?.["random-wilds"] ?? 0;
    for (let index = 0; index < configNumber(random, "count", random ? 1 : 0) + (random ? upgradeBonus : 0); index += 1) {
      const cell = await randomCell(ctx, "random-wilds");
      ctx.grid[cell.reel]![cell.row] = wild;
      emit(ctx, "random-wilds", "symbol-transform", { ...cell, symbolId: wild });
    }
    const mysteryWilds = enabled(ctx.game, "mystery-wilds");
    if (mysteryWilds) {
      const maxCount = Math.max(1, Math.floor(configNumber(mysteryWilds, "maxCount", 3)));
      const countDraw = await ctx.rng.uniformInt(maxCount, "mystery-wilds:count");
      ctx.draws.push(countDraw);
      for (let index = 0; index <= countDraw.value; index += 1) {
        const cell = await randomCell(ctx, "mystery-wilds");
        ctx.grid[cell.reel]![cell.row] = wild;
        emit(ctx, "mystery-wilds", "symbol-transform", { ...cell, symbolId: wild });
      }
    }
    const wildReels = enabled(ctx.game, "wild-reels");
    if (wildReels) {
      const draw = await ctx.rng.uniformInt(ctx.grid.length, "wild-reels:reel");
      ctx.draws.push(draw);
      ctx.grid[draw.value] = ctx.grid[draw.value]!.map(() => wild);
      emit(ctx, "wild-reels", "reel-transform", { reel: draw.value, symbolId: wild });
    }
    const stacked = enabled(ctx.game, "stacked-wilds");
    if (stacked) {
      const height = Math.max(2, Math.floor(configNumber(stacked, "height", 2)));
      ctx.grid.forEach((column, reel) => {
        const top = column.indexOf(wild);
        if (top < 0) return;
        for (let row = top + 1; row < Math.min(column.length, top + height); row += 1) {
          if (ctx.grid[reel]![row] === wild) continue;
          ctx.grid[reel]![row] = wild;
          emit(ctx, "stacked-wilds", "symbol-transform", { reel, row, symbolId: wild });
        }
      });
    }
    if (enabled(ctx.game, "expanding-wilds")) {
      ctx.grid.forEach((column, reel) => {
        if (column.includes(wild)) {
          ctx.grid[reel] = column.map(() => wild);
          emit(ctx, "expanding-wilds", "reel-transform", { reel, symbolId: wild });
        }
      });
    }
    if (enabled(ctx.game, "spreading-wilds")) {
      const additions = new Set<string>();
      ctx.grid.forEach((column, reel) => column.forEach((symbol, row) => {
        if (symbol !== wild) return;
        const neighbors: Array<[number, number]> = [[reel - 1, row], [reel + 1, row], [reel, row - 1], [reel, row + 1]];
        for (const [nextReel, nextRow] of neighbors) {
          if (ctx.grid[nextReel]?.[nextRow] !== undefined) additions.add(`${nextReel}:${nextRow}`);
        }
      }));
      for (const key of additions) {
        const [reel, row] = key.split(":").map(Number) as [number, number];
        ctx.grid[reel]![row] = wild;
        emit(ctx, "spreading-wilds", "symbol-transform", { reel, row, symbolId: wild });
      }
    }
    if (enabled(ctx.game, "colossal-wilds") && ctx.grid.some((column) => column.includes(wild))) {
      const origin = await randomCell(ctx, "colossal-wilds");
      for (let reel = origin.reel; reel < Math.min(ctx.grid.length, origin.reel + 2); reel += 1) {
        for (let row = origin.row; row < Math.min(ctx.grid[reel]!.length, origin.row + 2); row += 1) ctx.grid[reel]![row] = wild;
      }
      emit(ctx, "colossal-wilds", "colossal-transform", { ...origin, width: 2, height: 2, symbolId: wild });
    }
  }
  for (const [id, fallbackSource, fallbackTarget] of [
    ["mystery-symbols", "mystery", ctx.game.symbols.find((symbol) => symbol.kind === "normal")?.id],
    ["symbol-upgrade", "low", ctx.game.symbols.find((symbol) => symbol.tags?.includes("high"))?.id],
    ["symbol-swap", "swap", ctx.game.symbols.find((symbol) => symbol.kind === "normal")?.id],
  ] as const) {
    const feature = enabled(ctx.game, id);
    if (!feature) continue;
    const source = configString(feature, "sourceSymbolId") ?? fallbackSource;
    const target = configString(feature, "targetSymbolId") ?? fallbackTarget;
    if (!target) continue;
    ctx.grid.forEach((column, reel) => column.forEach((symbol, row) => {
      if (symbol === source) {
        ctx.grid[reel]![row] = target;
        emit(ctx, id, "symbol-transform", { reel, row, from: source, symbolId: target });
      }
    }));
  }
  const clone = enabled(ctx.game, "symbol-clone");
  if (clone) {
    const source = configString(clone, "sourceSymbolId") ?? ctx.grid[0]?.[0];
    if (source) {
      const count = configNumber(clone, "count", 2);
      for (let index = 0; index < count; index += 1) {
        const cell = await randomCell(ctx, "symbol-clone");
        ctx.grid[cell.reel]![cell.row] = source;
        emit(ctx, "symbol-clone", "symbol-transform", { ...cell, symbolId: source });
      }
    }
  }
  const removal = enabled(ctx.game, "symbol-removal");
  if (removal) {
    const source = configString(removal, "sourceSymbolId") ?? ctx.game.symbols.find((symbol) => symbol.tags?.includes("low"))?.id;
    if (source) {
      for (const [reel, column] of ctx.grid.entries()) {
        for (const [row, symbol] of column.entries()) {
          if (symbol !== source) continue;
          const replacement = await weightedReplacement(ctx, source, `symbol-removal:${reel}:${row}`);
          ctx.grid[reel]![row] = replacement;
          emit(ctx, "symbol-removal", "symbol-transform", { reel, row, from: source, symbolId: replacement });
        }
      }
    }
  }
  const expansion = enabled(ctx.game, "symbol-expansion");
  if (expansion) {
    const symbolId = configString(expansion, "symbolId") ?? ctx.game.symbols.find((symbol) => symbol.tags?.includes("high"))?.id;
    if (symbolId) {
      ctx.grid.forEach((column, reel) => {
        if (!column.includes(symbolId)) return;
        ctx.grid[reel] = column.map(() => symbolId);
        emit(ctx, "symbol-expansion", "reel-transform", { reel, symbolId });
      });
    }
  }
  const oversized = enabled(ctx.game, "oversized-symbols");
  if (oversized) {
    const size = Math.max(2, Math.floor(configNumber(oversized, "size", 2)));
    const pool = ctx.game.symbols.filter((symbol) => symbol.kind === "normal").map((symbol) => symbol.id);
    if (pool.length) {
      const pick = await ctx.rng.uniformInt(pool.length, "oversized-symbols:symbol");
      ctx.draws.push(pick);
      const symbolId = pool[pick.value]!;
      const origin = await randomCell(ctx, "oversized-symbols");
      const reelStart = Math.max(0, Math.min(origin.reel, ctx.grid.length - size));
      let rowStart = origin.row;
      for (let reel = reelStart; reel < Math.min(ctx.grid.length, reelStart + size); reel += 1) {
        rowStart = Math.max(0, Math.min(origin.row, ctx.grid[reel]!.length - size));
        for (let row = rowStart; row < Math.min(ctx.grid[reel]!.length, rowStart + size); row += 1) ctx.grid[reel]![row] = symbolId;
      }
      emit(ctx, "oversized-symbols", "colossal-transform", { reel: reelStart, row: rowStart, width: size, height: size, symbolId });
    }
  }
  const reelSplit = enabled(ctx.game, "reel-split");
  if (reelSplit && ctx.grid.length > 1) {
    const draw = await ctx.rng.uniformInt(ctx.grid.length - 1, "reel-split:reel");
    ctx.draws.push(draw);
    const source = draw.value;
    const target = source + 1;
    ctx.grid[target] = ctx.grid[target]!.map((_, row) => ctx.grid[source]![row % ctx.grid[source]!.length]!);
    emit(ctx, "reel-split", "reel-transform", { reel: target, sourceReel: source, symbolId: ctx.grid[target]![0] });
  }
  const reelModifier = enabled(ctx.game, "random-reel-modifier");
  if (reelModifier) {
    const modifiers = ["wild-reel", "sync-reels", "stacked-symbol"] as const;
    const pick = await ctx.rng.uniformInt(modifiers.length, "random-reel-modifier:modifier");
    ctx.draws.push(pick);
    const reelDraw = await ctx.rng.uniformInt(ctx.grid.length, "random-reel-modifier:reel");
    ctx.draws.push(reelDraw);
    const modifier = modifiers[pick.value]!;
    const reel = reelDraw.value;
    emit(ctx, "random-reel-modifier", "feature-start", { modifier, reel });
    if (modifier === "wild-reel" && wild) {
      ctx.grid[reel] = ctx.grid[reel]!.map(() => wild);
      emit(ctx, "random-reel-modifier", "reel-transform", { reel, symbolId: wild });
    } else if (modifier === "sync-reels" && ctx.grid.length > 1) {
      const source = reel === 0 ? 1 : reel - 1;
      ctx.grid[reel] = ctx.grid[reel]!.map((_, row) => ctx.grid[source]![row % ctx.grid[source]!.length]!);
      emit(ctx, "random-reel-modifier", "reel-transform", { reel, sourceReel: source, symbolId: ctx.grid[reel]![0] });
    } else {
      const pool = ctx.game.symbols.filter((symbol) => symbol.kind === "normal").map((symbol) => symbol.id);
      const symbolDraw = await ctx.rng.uniformInt(Math.max(1, pool.length), "random-reel-modifier:symbol");
      ctx.draws.push(symbolDraw);
      const symbolId = pool[symbolDraw.value] ?? wild;
      if (symbolId) {
        ctx.grid[reel] = ctx.grid[reel]!.map(() => symbolId);
        emit(ctx, "random-reel-modifier", "reel-transform", { reel, symbolId });
      }
    }
  }
  const randomPrize = enabled(ctx.game, "random-prize");
  if (randomPrize) {
    const chanceBps = Math.max(0, Math.min(10000, Math.floor(configNumber(randomPrize, "chanceBps", 1500))));
    const chance = await ctx.rng.uniformInt(10000, "random-prize:chance");
    ctx.draws.push(chance);
    if (chance.value < chanceBps) {
      const values = configNumbers(randomPrize, "values", [2, 5, 10]);
      const pick = await ctx.rng.uniformInt(values.length, "random-prize:value");
      ctx.draws.push(pick);
      (ctx.state.meters ??= {})["random-prize:pending"] = Math.max(1, Math.floor(values[pick.value]!));
    }
  }
  const randomFeature = enabled(ctx.game, "random-feature");
  if (randomFeature) {
    const chanceBps = Math.max(0, Math.min(10000, Math.floor(configNumber(randomFeature, "chanceBps", 2000))));
    const chance = await ctx.rng.uniformInt(10000, "random-feature:chance");
    ctx.draws.push(chance);
    if (chance.value < chanceBps) {
      const modifiers = ["wild-burst", "symbol-upgrade", "win-multiplier"] as const;
      const pick = await ctx.rng.uniformInt(modifiers.length, "random-feature:modifier");
      ctx.draws.push(pick);
      const modifier = modifiers[pick.value]!;
      emit(ctx, "random-feature", "feature-start", { modifier });
      if (modifier === "wild-burst" && wild) {
        for (let index = 0; index < 2; index += 1) {
          const cell = await randomCell(ctx, "random-feature");
          ctx.grid[cell.reel]![cell.row] = wild;
          emit(ctx, "random-feature", "symbol-transform", { ...cell, symbolId: wild });
        }
      } else if (modifier === "symbol-upgrade") {
        const target = ctx.game.symbols.find((symbol) => symbol.tags?.includes("high"))?.id;
        if (target) {
          ctx.grid.forEach((column, reel) => column.forEach((symbol, row) => {
            if (ctx.game.symbols.find((candidate) => candidate.id === symbol)?.tags?.includes("low")) {
              ctx.grid[reel]![row] = target;
              emit(ctx, "random-feature", "symbol-transform", { reel, row, from: symbol, symbolId: target });
            }
          }));
        }
      } else {
        (ctx.state.meters ??= {})["random-feature:multiplier"] = Math.max(2, Math.floor(configNumber(randomFeature, "multiplier", 2)));
      }
    }
  }
}

export function applyPostEvaluationFeatures(ctx: FeatureContext): void {
  const wild = wildSymbol(ctx.game);
  const multiplierWild = enabled(ctx.game, "multiplier-wilds");
  if (multiplierWild && wild) {
    const multiplier = Math.max(1, Math.floor(configNumber(multiplierWild, "multiplier", 2)));
    multiplyWins(ctx, "multiplier-wilds", multiplier, winContainsSymbol(ctx, wild));
  }
  const splitSymbols = enabled(ctx.game, "split-symbols");
  if (splitSymbols) {
    const symbolId = configString(splitSymbols, "symbolId") ?? wild;
    if (symbolId) multiplyWins(ctx, "split-symbols", Math.max(2, Math.floor(configNumber(splitSymbols, "multiplier", 2))), winContainsSymbol(ctx, symbolId));
  }
  const enhanced = enabled(ctx.game, "enhanced-symbols");
  if (enhanced && ctx.phase === "free-spin") {
    const symbolId = configString(enhanced, "symbolId") ?? ctx.game.symbols.find((symbol) => symbol.tags?.includes("high"))?.id;
    if (symbolId) multiplyWins(ctx, "enhanced-symbols", Math.max(2, Math.floor(configNumber(enhanced, "multiplier", 2))), winContainsSymbol(ctx, symbolId));
  }
  const bonusIds = symbolIdsOfKind(ctx.game, "bonus");
  const bonusCount = countCells(ctx.grid, bonusIds);
  const multiplierSymbols = enabled(ctx.game, "multiplier-symbols");
  if (multiplierSymbols && bonusCount > 0) {
    const values = configNumbers(multiplierSymbols, "multipliers", [2, 3, 5]);
    multiplyWins(ctx, "multiplier-symbols", values[Math.min(bonusCount, values.length) - 1]!);
  }
  const additive = enabled(ctx.game, "additive-multipliers");
  if (additive && bonusCount > 0) multiplyWins(ctx, "additive-multipliers", bonusCount * Math.max(1, Math.floor(configNumber(additive, "value", 2))));
  const multiplying = enabled(ctx.game, "multiplying-multipliers");
  if (multiplying && bonusCount > 0) multiplyWins(ctx, "multiplying-multipliers", Math.pow(Math.max(2, Math.floor(configNumber(multiplying, "value", 2))), Math.min(bonusCount, 6)));
  const pendingRandomMultiplier = ctx.state.meters?.["random-feature:multiplier"];
  if (pendingRandomMultiplier && BigInt(ctx.totalWinUnits) > 0n) {
    multiplyWins(ctx, "random-feature", pendingRandomMultiplier);
    delete ctx.state.meters!["random-feature:multiplier"];
  }
  if (enabled(ctx.game, "increasing-cascade-multiplier") && ctx.cascadeIndex > 0 && BigInt(ctx.totalWinUnits) > 0n) {
    multiplyWins(ctx, "increasing-cascade-multiplier", ctx.cascadeIndex + 1);
  }
  const collection = enabled(ctx.game, "symbol-collection");
  if (collection) {
    const symbolId = configString(collection, "symbolId") ?? ctx.game.symbols.find((symbol) => symbol.kind === "collect")?.id;
    if (symbolId) {
      const landed = ctx.grid.flat().filter((symbol) => symbol === symbolId).length;
      ctx.state.collection ??= {};
      ctx.state.collection[symbolId] = (ctx.state.collection[symbolId] ?? 0) + landed;
      if (landed) emit(ctx, "symbol-collection", "collection-update", { symbolId, added: landed, total: ctx.state.collection[symbolId] });
    }
  }
  if (ctx.cascadeIndex === 0) applyPrizeAndCollectionFeatures(ctx, bonusCount, bonusIds);
}

function applyPrizeAndCollectionFeatures(ctx: FeatureContext, bonusCount: number, bonusIds: Set<string>): void {
  const betUnits = BigInt(ctx.betUnits);
  const meters = (ctx.state.meters ??= {});
  const boostFeature = enabled(ctx.game, "prize-boost");
  const boost = boostFeature ? BigInt(Math.max(1, Math.floor(configNumber(boostFeature, "multiplier", 2)))) : 1n;
  let boostAnnounced = ctx.events.some((event) => event.featureId === "prize-boost");
  const addPrize = (featureId: string, units: bigint, data: Record<string, unknown> = {}): void => {
    if (units <= 0n) return;
    const final = units * boost;
    if (boost > 1n && !boostAnnounced) {
      emit(ctx, "prize-boost", "feature-start", { multiplier: Number(boost) });
      boostAnnounced = true;
    }
    ctx.totalWinUnits = (BigInt(ctx.totalWinUnits) + final).toString();
    emit(ctx, featureId, "prize-award", { awardUnits: final.toString(), ...data });
  };
  const pendingPrize = meters["random-prize:pending"];
  if (pendingPrize) {
    addPrize("random-prize", betUnits * BigInt(pendingPrize), { multiplier: pendingPrize });
    delete meters["random-prize:pending"];
  }
  const coinCells: Array<{ reel: number; row: number; value: number }> = [];
  const coinFeature = enabled(ctx.game, "coin-values") ?? enabled(ctx.game, "cash-collect");
  if (coinFeature) {
    const values = configNumbers(coinFeature, "values", [1, 2, 5]);
    ctx.grid.forEach((column, reel) => column.forEach((symbol, row) => {
      if (bonusIds.has(symbol)) coinCells.push({ reel, row, value: values[(reel + row) % values.length]! });
    }));
  }
  const coinTotal = coinCells.reduce((sum, coin) => sum + coin.value, 0);
  if (enabled(ctx.game, "coin-values") && coinTotal > 0) addPrize("coin-values", BigInt(coinTotal) * betUnits, { coins: coinCells });
  const cashCollect = enabled(ctx.game, "cash-collect");
  if (cashCollect && coinTotal > 0) {
    const collectorIds = symbolIdsOfKind(ctx.game, configString(cashCollect, "collectorKind") ?? "wild");
    if (countCells(ctx.grid, collectorIds) > 0) addPrize("cash-collect", BigInt(coinTotal) * betUnits, { coins: coinCells });
  }
  const instant = enabled(ctx.game, "instant-win");
  if (instant && bonusCount >= Math.max(1, Math.floor(configNumber(instant, "count", 3)))) {
    addPrize("instant-win", betUnits * BigInt(Math.max(1, Math.floor(configNumber(instant, "multiplier", 10)))), { symbols: bonusCount });
  }
  const scatterIds = symbolIdsOfKind(ctx.game, "scatter");
  const collectIds = symbolIdsOfKind(ctx.game, "collect");
  const meterFeature = enabled(ctx.game, "meter-progress");
  if (meterFeature) {
    const landed = countCells(ctx.grid, scatterIds.size ? scatterIds : bonusIds);
    if (landed > 0) {
      meters["meter-progress"] = (meters["meter-progress"] ?? 0) + landed;
      const target = Math.max(2, Math.floor(configNumber(meterFeature, "target", 6)));
      emit(ctx, "meter-progress", "collection-update", { meter: "meter-progress", added: landed, total: meters["meter-progress"], target });
      if (meters["meter-progress"] >= target) {
        addPrize("meter-progress", betUnits * BigInt(Math.max(1, Math.floor(configNumber(meterFeature, "awardMultiplier", 5)))), { meter: "meter-progress" });
        meters["meter-progress"] -= target;
      }
    }
  }
  const levelUp = enabled(ctx.game, "level-up-bonus");
  if (levelUp) {
    const landed = countCells(ctx.grid, bonusIds.size ? bonusIds : scatterIds);
    if (landed > 0) {
      meters["level-up-bonus"] = (meters["level-up-bonus"] ?? 0) + landed;
      const perLevel = Math.max(1, Math.floor(configNumber(levelUp, "perLevel", 3)));
      const level = Math.floor(meters["level-up-bonus"] / perLevel);
      emit(ctx, "level-up-bonus", "collection-update", { meter: "level-up-bonus", added: landed, total: meters["level-up-bonus"], level });
      const previous = meters["level-up-bonus:level"] ?? 0;
      if (level > previous) {
        meters["level-up-bonus:level"] = level;
        emit(ctx, "level-up-bonus", "feature-start", { level });
        addPrize("level-up-bonus", betUnits * BigInt(level - previous) * BigInt(Math.max(1, Math.floor(configNumber(levelUp, "awardMultiplier", 2)))), { level });
      }
    }
  }
  const persistent = enabled(ctx.game, "persistent-collection");
  if (persistent) {
    const ids = collectIds.size ? collectIds : bonusIds;
    const landed = countCells(ctx.grid, ids);
    if (landed > 0) {
      meters["persistent-collection"] = (meters["persistent-collection"] ?? 0) + landed;
      const target = Math.max(2, Math.floor(configNumber(persistent, "target", 12)));
      emit(ctx, "persistent-collection", "collection-update", { meter: "persistent-collection", added: landed, total: meters["persistent-collection"], target });
      if (meters["persistent-collection"] >= target) {
        addPrize("persistent-collection", betUnits * BigInt(Math.max(1, Math.floor(configNumber(persistent, "awardMultiplier", 10)))), { meter: "persistent-collection" });
        meters["persistent-collection"] -= target;
      }
    }
  }
  const ladderFeature = enabled(ctx.game, "prize-ladder");
  if (ladderFeature) {
    const ladder = configNumbers(ladderFeature, "ladder", [2, 4, 6, 10, 25]);
    const landed = countCells(ctx.grid, scatterIds.size ? scatterIds : bonusIds);
    if (landed > 0) {
      const next = (meters["prize-ladder"] ?? 0) + landed;
      if (next >= ladder.length) {
        emit(ctx, "prize-ladder", "collection-update", { meter: "prize-ladder", rung: ladder.length - 1, prize: ladder[ladder.length - 1] });
        addPrize("prize-ladder", betUnits * BigInt(Math.max(1, Math.floor(ladder[ladder.length - 1]!))), { rung: ladder.length - 1 });
        meters["prize-ladder"] = 0;
      } else {
        meters["prize-ladder"] = next;
        emit(ctx, "prize-ladder", "collection-update", { meter: "prize-ladder", rung: next, prize: ladder[next] });
      }
    }
  }
  const journey = enabled(ctx.game, "map-journey-bonus");
  if (journey) {
    const tiles = configNumbers(journey, "tiles", [0, 2, 0, 5, 0, 10]);
    const steps = countCells(ctx.grid, bonusIds.size ? bonusIds : scatterIds);
    if (steps > 0) {
      const position = ((meters["map-journey-bonus"] ?? 0) + steps) % tiles.length;
      meters["map-journey-bonus"] = position;
      emit(ctx, "map-journey-bonus", "feature-start", { position, steps, tile: tiles[position] });
      if (tiles[position]! > 0) addPrize("map-journey-bonus", betUnits * BigInt(Math.floor(tiles[position]!)), { position });
    }
  }
  const upgradeFeature = enabled(ctx.game, "feature-upgrade");
  if (upgradeFeature) {
    const ids = collectIds.size ? collectIds : bonusIds;
    const landed = countCells(ctx.grid, ids);
    if (landed > 0) {
      meters["feature-upgrade"] = (meters["feature-upgrade"] ?? 0) + landed;
      const perLevel = Math.max(1, Math.floor(configNumber(upgradeFeature, "perLevel", 3)));
      const level = Math.floor(meters["feature-upgrade"] / perLevel);
      emit(ctx, "feature-upgrade", "collection-update", { meter: "feature-upgrade", added: landed, total: meters["feature-upgrade"], level });
      const upgraded = configString(upgradeFeature, "targetFeatureId") ?? "random-wilds";
      const previous = ctx.state.upgrades?.[upgraded] ?? 0;
      if (level > previous) {
        (ctx.state.upgrades ??= {})[upgraded] = level;
        emit(ctx, "feature-upgrade", "feature-start", { level, upgraded });
      }
    }
  }
  const pot = enabled(ctx.game, "pot-collection");
  if (pot) {
    const coins = countCells(ctx.grid, bonusIds);
    if (coins > 0) {
      meters["pot-collection"] = (meters["pot-collection"] ?? 0) + coins;
      emit(ctx, "pot-collection", "collection-update", { meter: "pot-collection", added: coins, total: meters["pot-collection"] });
    }
    const collectorPresent = countCells(ctx.grid, collectIds.size ? collectIds : symbolIdsOfKind(ctx.game, "wild")) > 0;
    if (collectorPresent && (meters["pot-collection"] ?? 0) > 0) {
      addPrize("pot-collection", BigInt(meters["pot-collection"]!) * betUnits * BigInt(Math.max(1, Math.floor(configNumber(pot, "coinMultiplier", 1)))), { coins: meters["pot-collection"] });
      meters["pot-collection"] = 0;
    }
  }
}
