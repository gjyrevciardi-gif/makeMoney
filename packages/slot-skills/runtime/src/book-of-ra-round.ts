import type { GameConfig } from "@slot-skills/schema";
import {
  bookOfRaExpandingMinimum,
  bookOfRaExpandingWin,
  bookOfRaScatterMultiplier,
  evaluateBookOfRa,
  generateGrid,
  type Grid,
  type RngDraw,
  type RngProvider,
  type Win,
} from "@slot-skills/math";
import {
  BOOK_OF_RA_FREE_SPINS_AWARD,
  BOOK_OF_RA_GAME_ID,
  BOOK_OF_RA_LINES,
  BOOK_OF_RA_MAX_GAMBLE_ATTEMPTS,
  BOOK_OF_RA_PROFILE_ID,
  BOOK_OF_RA_RETRIGGER_SPINS,
  BOOK_OF_RA_SCATTER_SYMBOL,
} from "@slot-skills/math";
import type { FeatureState } from "@slot-skills/features";
import type { PendingAction } from "./types.js";

/**
 * The authoritative Book of Ra Deluxe round engine.
 *
 * This module owns every decision that can move money: which grid landed, what
 * it pays, whether the free games started, which symbol expands, how many spins
 * remain, and how a gamble resolves. The platform adapter, the reference host,
 * the simulation harness and the generic runtime engine all call these same
 * functions, so there is exactly one implementation of the game's mathematics
 * in the repository.
 *
 * Guarantees enforced here:
 * - `betPerLine`, `activeLines` and therefore `totalBet` are locked when the
 *   free games start and cannot be changed by a later request.
 * - The expanding symbol is chosen once, from the non-Book symbols, and persists
 *   across the whole feature including retriggers.
 * - Every gamble colour for the whole five-attempt ladder is drawn from the
 *   injected RNG when the gamble is offered, so resolving a choice is a pure,
 *   replayable state transition that needs no further randomness.
 * - A lost gamble zeroes the pending win and completes the round; a collected or
 *   won gamble leaves exactly one settlement for the caller to apply.
 */

export const BOOK_OF_RA_GAMBLE_CHOICES = ["red", "black", "collect"] as const;
export type BookOfRaGambleChoice = (typeof BOOK_OF_RA_GAMBLE_CHOICES)[number];
export type BookOfRaColour = "red" | "black";

export const BOOK_OF_RA_ROUND_STATES = [
  "IDLE",
  "SPIN_PENDING",
  "SPIN_RESOLVED",
  "WIN_PRESENTATION",
  "FREE_GAME_INTRO",
  "FREE_GAME_ACTIVE",
  "FREE_GAME_COMPLETE",
  "GAMBLE_PENDING",
  "ROUND_COMPLETE",
] as const;
export type BookOfRaRoundState = (typeof BOOK_OF_RA_ROUND_STATES)[number];

export type BookOfRaGambleAttempt = {
  attempt: number;
  choice: BookOfRaColour;
  winningColour: BookOfRaColour;
  won: boolean;
  pendingWinBefore: string;
  pendingWinAfter: string;
  at: string;
};

export interface BookOfRaGameState {
  profileId: string;
  profileFingerprint: string;
  gameId: string;
  phase: BookOfRaRoundState;
  activeLines: number;
  betPerLine: string;
  totalBet: string;
  specialSymbol?: string | undefined;
  freeSpinsAwarded: number;
  freeSpinsRemaining: number;
  freeSpinsPlayed: number;
  retriggerCount: number;
  featureWin: string;
  pendingWin: string;
 /** Spins played in this session: paid spins plus free spins. */
  spinIndex: number;
  gambleAttempts: number;
  gambleMaxAttempts: number;
  /** Colours for the whole gamble ladder, drawn once when the gamble is offered. */
  gambleColours?: BookOfRaColour[] | undefined;
  gambleHistory?: BookOfRaGambleAttempt[] | undefined;
  pendingActionId?: string | undefined;
  pendingRoundId?: string | undefined;
  lastOutcome?: BookOfRaSpinOutcome | undefined;
}

export type BookOfRaSpinOutcome = {
  roundId: string;
  board: Grid;
  finalGrid: Grid;
  regularWins: Win[];
  wins: Win[];
  scatterWin: string;
  bookCount: number;
  expandingReels: number[];
  expandingWin: string;
  totalSpinWin: string;
  specialSymbol?: string | undefined;
  freeSpin: boolean;
  freeSpinIndex?: number;
  freeSpinsRemaining: number;
  retriggered: number;
  phase: BookOfRaRoundState;
  pendingAction?: PendingAction | undefined;
  complete: boolean;
  betPerLine: string;
  totalBet: string;
  activeLines: number;
};

export interface BookOfRaGambleOutcome {
  roundId: string;
  attempt: number;
  choice: BookOfRaGambleChoice;
  resolved: boolean;
  winningColour?: BookOfRaColour | undefined;
  won?: boolean | undefined;
  pendingWinBefore: string;
  pendingWinAfter: string;
  settlement: string;
  attemptsRemaining: number;
  phase: BookOfRaRoundState;
  pendingAction?: PendingAction | undefined;
  complete: boolean;
}

export class BookOfRaStateError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "BookOfRaStateError";
    this.code = code;
  }
}

function positiveIntegerString(value: string, label: string): bigint {
  if (!/^[1-9]\d*$/.test(value)) throw new BookOfRaStateError("INVALID_STAKE", `${label} must be a positive integer of virtual points`);
  return BigInt(value);
}

export function createBookOfRaState(input: {
  profileId?: string | undefined;
  profileFingerprint: string;
  betPerLine: string;
  activeLines?: number | undefined;
  maxGambleAttempts?: number | undefined;
}): BookOfRaGameState {
  const activeLines = input.activeLines ?? BOOK_OF_RA_LINES;
  if (activeLines !== BOOK_OF_RA_LINES) {
    throw new BookOfRaStateError("INVALID_LINES", `Book of Ra Deluxe always plays ${BOOK_OF_RA_LINES} lines`);
  }
  const betPerLine = positiveIntegerString(input.betPerLine, "betPerLine");
  return {
    profileId: input.profileId ?? BOOK_OF_RA_PROFILE_ID,
    profileFingerprint: input.profileFingerprint,
    gameId: BOOK_OF_RA_GAME_ID,
    phase: "IDLE",
    activeLines,
    betPerLine: betPerLine.toString(),
    totalBet: (betPerLine * BigInt(activeLines)).toString(),
    freeSpinsAwarded: 0,
    freeSpinsRemaining: 0,
    freeSpinsPlayed: 0,
    retriggerCount: 0,
    featureWin: "0",
    pendingWin: "0",
    spinIndex: 0,
    gambleAttempts: 0,
    gambleMaxAttempts: input.maxGambleAttempts ?? BOOK_OF_RA_MAX_GAMBLE_ATTEMPTS,
  };
}

export function isBookOfRaFreeGameActive(state: Pick<BookOfRaGameState, "freeSpinsRemaining">): boolean {
  return state.freeSpinsRemaining > 0;
}

export function hasPendingBookOfRaAction(state: Pick<BookOfRaGameState, "phase" | "pendingActionId">): boolean {
  return state.phase === "GAMBLE_PENDING" || Boolean(state.pendingActionId);
}

/** Structural check before a persisted state is allowed to drive a round. */
export function assertBookOfRaState(state: BookOfRaGameState, profileFingerprint: string): void {
  if (state.gameId !== BOOK_OF_RA_GAME_ID) throw new BookOfRaStateError("INVALID_GAME", "This session does not belong to Book of the Sands");
  if (state.profileFingerprint !== profileFingerprint) {
    throw new BookOfRaStateError("PROFILE_MISMATCH", "The active mathematics changed after this session started");
  }
  if (state.activeLines !== BOOK_OF_RA_LINES) throw new BookOfRaStateError("INVALID_LINES", "The session must lock ten lines");
  positiveIntegerString(state.betPerLine, "betPerLine");
  positiveIntegerString(state.totalBet, "totalBet");
  if (BigInt(state.totalBet) !== BigInt(state.betPerLine) * BigInt(state.activeLines)) {
    throw new BookOfRaStateError("INVALID_STAKE", "totalBet must equal betPerLine multiplied by the locked lines");
  }
  if (state.freeSpinsRemaining < 0 || state.freeSpinsPlayed < 0 || state.retriggerCount < 0) {
    throw new BookOfRaStateError("INVALID_COUNTERS", "Free-game counters cannot be negative");
  }
  if (state.gambleAttempts < 0 || state.gambleAttempts > state.gambleMaxAttempts) {
    throw new BookOfRaStateError("INVALID_GAMBLE", "Gamble attempts are outside the configured cap");
  }
  if (state.specialSymbol === BOOK_OF_RA_SCATTER_SYMBOL) {
    throw new BookOfRaStateError("INVALID_SPECIAL_SYMBOL", "The Book can never be the expanding symbol");
  }
  if (state.freeSpinsRemaining > 0 && !state.specialSymbol) {
    throw new BookOfRaStateError("INVALID_FEATURE", "An active feature must pin its expanding symbol");
  }
}

function cloneGrid(grid: Grid): Grid {
  return grid.map((column) => [...column]);
}

/** Draws the persistent expanding symbol: any non-Book symbol, uniformly. */
async function drawSpecialSymbol(game: GameConfig, rng: RngProvider, draws: RngDraw[], context: string): Promise<string> {
  const pool = game.symbols.filter((symbol) => symbol.kind === "normal").map((symbol) => symbol.id);
  if (!pool.length) throw new BookOfRaStateError("INVALID_GAME", "The game has no expandable symbols");
  const draw = await rng.uniformInt(pool.length, context);
  draws.push(draw);
  return pool[draw.value] ?? pool[0]!;
}

function gambleAction(roundId: string, attempt: number): PendingAction {
  return {
    id: `${roundId}:gamble-feature:${attempt}`,
    type: "gamble",
    featureId: "gamble-feature",
    choices: [
      { id: "red", labelKey: "bonus.gamble.red" },
      { id: "black", labelKey: "bonus.gamble.black" },
      { id: "collect", labelKey: "bonus.gamble.collect" },
    ],
  };
}

export interface BookOfRaRoundRequest {
  game: GameConfig;
  state: BookOfRaGameState;
  rng: RngProvider;
  roundId: string;
  /** Required for a fresh paid spin; ignored while the free games are running. */
  betPerLine?: bigint;
  activeLines?: number;
  autoplay?: boolean;
  /** Overrides the locked free spins awarded by a trigger; used by tests only. */
  freeSpinsAward?: number;
  now?: () => Date;
}

/**
 * Plays one spin — paid or free — and returns the new authoritative state.
 *
 * The caller persists the returned state and settles `totalSpinWin`. Nothing in
 * this function reads a wallet, a request, or a client-supplied outcome.
 */
export async function playBookOfRaRound(request: BookOfRaRoundRequest): Promise<{
  state: BookOfRaGameState;
  outcome: BookOfRaSpinOutcome;
  draws: RngDraw[];
}> {
  const { game, rng, roundId } = request;
  if (game.id !== BOOK_OF_RA_GAME_ID) throw new BookOfRaStateError("INVALID_GAME", `Book of Ra requires the ${BOOK_OF_RA_GAME_ID} configuration`);
  const state: BookOfRaGameState = structuredClone(request.state);
  assertBookOfRaState(state, state.profileFingerprint);
  if (hasPendingBookOfRaAction(state)) {
    throw new BookOfRaStateError("ACTION_PENDING", "Resolve the pending gamble before starting another spin");
  }

  const freeGame = isBookOfRaFreeGameActive(state);
  let betPerLine = BigInt(state.betPerLine);
  if (!freeGame) {
    if (request.betPerLine === undefined || request.betPerLine <= 0n) {
      throw new BookOfRaStateError("INVALID_STAKE", "A paid spin requires a positive bet per line");
    }
    betPerLine = request.betPerLine;
    const activeLines = request.activeLines ?? state.activeLines;
    if (activeLines !== BOOK_OF_RA_LINES) {
      throw new BookOfRaStateError("INVALID_LINES", `Book of Ra Deluxe always plays ${BOOK_OF_RA_LINES} lines`);
    }
    state.activeLines = activeLines;
    state.betPerLine = betPerLine.toString();
    state.totalBet = (betPerLine * BigInt(activeLines)).toString();
    // A new paid spin starts from a clean feature ledger; the locked stake and
    // line count above are the only values that survive into the free games.
    state.featureWin = "0";
    state.freeSpinsAwarded = 0;
    state.freeSpinsPlayed = 0;
    state.retriggerCount = 0;
    state.specialSymbol = undefined;
    state.pendingWin = "0";
    state.gambleAttempts = 0;
    state.gambleColours = undefined;
    state.gambleHistory = undefined;
    state.pendingActionId = undefined;
    state.lastOutcome = undefined;
  }
  const activeLines = state.activeLines;

  const draws: RngDraw[] = [];
  const context = freeGame
    ? `book-of-ra:free:${state.freeSpinsPlayed}`
    : `book-of-ra:base:${state.spinIndex}`;
  const generated = await generateGrid(game, rng, context);
  draws.push(...generated.draws);
  const board = cloneGrid(generated.grid);

  const evaluated = evaluateBookOfRa(game, board, betPerLine, activeLines);
  const regularWins = evaluated.regularWins.map((win) => ({ ...win, cells: win.cells.map((cell) => ({ ...cell })) }));
  const bookSymbol = game.symbols.find((symbol) => symbol.kind === "scatter")?.id ?? BOOK_OF_RA_SCATTER_SYMBOL;

  let finalGrid = cloneGrid(board);
  let expandingReels: number[] = [];
  let expandingWin = 0n;
  if (freeGame && state.specialSymbol) {
    const candidates = board
      .map((column, reel) => (column.includes(state.specialSymbol!) ? reel : -1))
      .filter((reel) => reel >= 0);
    if (candidates.length >= bookOfRaExpandingMinimum(state.specialSymbol)) {
      const award = bookOfRaExpandingWin(state.specialSymbol, candidates.length, betPerLine, activeLines);
      if (award > 0n) {
        expandingReels = candidates;
        expandingWin = award;
        for (const reel of expandingReels) finalGrid[reel] = finalGrid[reel]!.map(() => state.specialSymbol!);
      }
    }
  }

  const spinWin = BigInt(evaluated.total) + expandingWin;
  const wins: Win[] = [...regularWins];
  if (evaluated.scatterWin > 0n) {
    wins.push({
      evaluator: "book-of-ra-scatter",
      symbolId: bookSymbol,
      count: evaluated.bookCount,
      ways: 1,
      cells: board.flatMap((column, reel) =>
        column.flatMap((value, row) => (value === bookSymbol ? [{ reel, row }] : [])),
      ),
      payoutUnits: evaluated.scatterWin.toString(),
    });
  }
  if (expandingWin > 0n && state.specialSymbol) {
    wins.push({
      evaluator: "book-of-ra-expanding",
      symbolId: state.specialSymbol,
      count: expandingReels.length,
      ways: activeLines,
      cells: expandingReels.flatMap((reel) => [0, 1, 2].map((row) => ({ reel, row }))),
      payoutUnits: expandingWin.toString(),
    });
  }

  state.spinIndex += 1;
  let retriggered = 0;
  let phase: BookOfRaRoundState;
  if (freeGame) {
    state.freeSpinsPlayed += 1;
    state.freeSpinsRemaining -= 1;
    state.featureWin = (BigInt(state.featureWin) + spinWin).toString();
    if (evaluated.bookCount >= 3) {
      retriggered = BOOK_OF_RA_RETRIGGER_SPINS;
      state.freeSpinsRemaining += BOOK_OF_RA_RETRIGGER_SPINS;
      state.retriggerCount += 1;
    }
    phase = state.freeSpinsRemaining > 0 ? "FREE_GAME_ACTIVE" : "FREE_GAME_COMPLETE";
  } else if (evaluated.bookCount >= 3) {
    state.specialSymbol = await drawSpecialSymbol(game, rng, draws, "book-of-ra:special-symbol");
    const award = request.freeSpinsAward ?? BOOK_OF_RA_FREE_SPINS_AWARD;
    state.freeSpinsAwarded = award;
    state.freeSpinsRemaining = award;
    state.freeSpinsPlayed = 0;
    state.retriggerCount = 0;
    phase = "FREE_GAME_INTRO";
  } else {
    phase = "ROUND_COMPLETE";
  }

  // A triggering spin hands straight over to the feature: its award becomes part
  // of the feature total and there is exactly one pending action at a time.
  const featureStarted = !freeGame && evaluated.bookCount >= 3;
  const gambleOffered = !freeGame && !featureStarted && spinWin > 0n && request.autoplay !== true;
  let pendingAction: PendingAction | undefined;
  if (gambleOffered) {
    const colours: BookOfRaColour[] = [];
    for (let attempt = 0; attempt < state.gambleMaxAttempts; attempt += 1) {
      const draw = await rng.uniformInt(2, `book-of-ra:gamble:${attempt}`);
      draws.push(draw);
      colours.push(draw.value === 0 ? "red" : "black");
    }
    state.gambleColours = colours;
    state.gambleAttempts = 0;
    state.gambleHistory = [];
    state.pendingWin = spinWin.toString();
    pendingAction = gambleAction(roundId, 0);
    state.pendingActionId = pendingAction.id;
    phase = "GAMBLE_PENDING";
  } else if (featureStarted) {
    state.pendingWin = "0";
  } else {
    // Nothing is at risk on a settled spin: `pendingWin` is reserved for the
    // amount a client can actually gamble, so a completed spin always reports 0
    // and the spin's own win lives in `totalSpinWin`.
    state.pendingWin = "0";
  }

  const outcome: BookOfRaSpinOutcome = {
    roundId,
    board,
    finalGrid,
    regularWins,
    wins,
    scatterWin: evaluated.scatterWin.toString(),
    bookCount: evaluated.bookCount,
    expandingReels,
    expandingWin: expandingWin.toString(),
    totalSpinWin: spinWin.toString(),
    ...(state.specialSymbol ? { specialSymbol: state.specialSymbol } : {}),
    freeSpin: freeGame,
    ...(freeGame ? { freeSpinIndex: state.freeSpinsPlayed } : {}),
    freeSpinsRemaining: state.freeSpinsRemaining,
    retriggered,
    phase,
    ...(pendingAction ? { pendingAction } : {}),
    complete: pendingAction ? false : true,
    betPerLine: state.betPerLine,
    totalBet: state.totalBet,
    activeLines: state.activeLines,
  };
  state.phase = phase;
  state.pendingRoundId = roundId;
  state.lastOutcome = outcome;
  if (freeGame && state.freeSpinsRemaining === 0) {
    // The feature is over: keep the counters for the presentation, but the next
    // paid spin re-initialises them.
    state.pendingWin = BigInt(state.pendingWin).toString();
  }
  return { state, outcome, draws };
}

/**
 * Resolves one gamble choice against the colours drawn when the gamble started.
 *
 * Pure and synchronous: replaying the same choice on the same state always
 * produces the same result, which is what makes a retried request idempotent.
 */
export function resolveBookOfRaGamble(
  state: BookOfRaGameState,
  choice: BookOfRaGambleChoice,
): { state: BookOfRaGameState; outcome: BookOfRaGambleOutcome } {
  const next: BookOfRaGameState = structuredClone(state);
  if (next.phase !== "GAMBLE_PENDING" || !next.pendingActionId) {
    throw new BookOfRaStateError("NO_PENDING_GAMBLE", "There is no gamble waiting to be resolved");
  }
  const before = BigInt(next.pendingWin);
  if (before <= 0n) {
    throw new BookOfRaStateError("NO_PENDING_WIN", "There is no pending win to gamble");
  }
  if (choice === "collect") {
    next.phase = "ROUND_COMPLETE";
    next.pendingActionId = undefined;
    next.gambleColours = undefined;
    const outcome: BookOfRaGambleOutcome = {
      roundId: next.pendingRoundId ?? "",
      attempt: next.gambleAttempts,
      choice,
      resolved: true,
      pendingWinBefore: before.toString(),
      pendingWinAfter: before.toString(),
      settlement: before.toString(),
      attemptsRemaining: 0,
      phase: next.phase,
      complete: true,
    };
    if (next.lastOutcome) next.lastOutcome = { ...next.lastOutcome, phase: next.phase, complete: true, pendingAction: undefined };
    return { state: next, outcome };
  }

  const colours = next.gambleColours ?? [];
  const winningColour = colours[next.gambleAttempts];
  if (!winningColour) {
    throw new BookOfRaStateError("GAMBLE_EXHAUSTED", "The gamble ladder has no colour left to resolve");
  }
  const attempt = next.gambleAttempts + 1;
  const won = winningColour === choice;
  const after = won ? before * 2n : 0n;
  const record: BookOfRaGambleAttempt = {
    attempt,
    choice,
    winningColour,
    won,
    pendingWinBefore: before.toString(),
    pendingWinAfter: after.toString(),
    at: new Date().toISOString(),
  };
  next.gambleHistory = [...(next.gambleHistory ?? []), record];
  next.gambleAttempts = attempt;
  next.pendingWin = after.toString();

  const canContinue = won && attempt < next.gambleMaxAttempts;
  if (won && canContinue) {
    const pendingAction = gambleAction(next.pendingRoundId ?? "", attempt);
    next.pendingActionId = pendingAction.id;
    next.phase = "GAMBLE_PENDING";
    const outcome: BookOfRaGambleOutcome = {
      roundId: next.pendingRoundId ?? "",
      attempt,
      choice,
      resolved: false,
      winningColour,
      won,
      pendingWinBefore: before.toString(),
      pendingWinAfter: after.toString(),
      settlement: "0",
      attemptsRemaining: next.gambleMaxAttempts - attempt,
      phase: next.phase,
      pendingAction,
      complete: false,
    };
    if (next.lastOutcome) next.lastOutcome = { ...next.lastOutcome, phase: next.phase, complete: false, pendingAction };
    return { state: next, outcome };
  }

  next.phase = "ROUND_COMPLETE";
  next.pendingActionId = undefined;
  next.gambleColours = undefined;
  const outcome: BookOfRaGambleOutcome = {
    roundId: next.pendingRoundId ?? "",
    attempt,
    choice,
    resolved: true,
    winningColour,
    won,
    pendingWinBefore: before.toString(),
    pendingWinAfter: after.toString(),
    settlement: after.toString(),
    attemptsRemaining: next.gambleMaxAttempts - attempt,
    phase: next.phase,
    complete: true,
  };
  if (next.lastOutcome) next.lastOutcome = { ...next.lastOutcome, phase: next.phase, complete: true, pendingAction: undefined };
  return { state: next, outcome };
}

/**
 * Book of Ra's persistence shape inside the shared feature state, so the
 * reference host can keep storing one JSON blob per player and game.
 */
export function toFeatureState(state: BookOfRaGameState): FeatureState {
  return {
    bookOfRa: {
      phase: state.phase,
      betPerLine: state.betPerLine,
      totalBet: state.totalBet,
      activeLines: state.activeLines,
      ...(state.specialSymbol ? { specialSymbol: state.specialSymbol } : {}),
      freeSpinsRemaining: state.freeSpinsRemaining,
      freeSpinsPlayed: state.freeSpinsPlayed,
      featureWin: state.featureWin,
      pendingWin: state.pendingWin,
      gambleAttempts: state.gambleAttempts,
      profileId: state.profileId,
      profileFingerprint: state.profileFingerprint,
      freeSpinsAwarded: state.freeSpinsAwarded,
      retriggerCount: state.retriggerCount,
      spinIndex: state.spinIndex,
      gambleMaxAttempts: state.gambleMaxAttempts,
      ...(state.gambleColours ? { gambleColours: [...state.gambleColours] } : {}),
      ...(state.gambleHistory ? { gambleHistory: state.gambleHistory.map((entry) => ({ ...entry })) } : {}),
      ...(state.pendingActionId ? { pendingActionId: state.pendingActionId } : {}),
      ...(state.pendingRoundId ? { pendingRoundId: state.pendingRoundId } : {}),
      ...(state.lastOutcome ? { lastOutcome: structuredClone(state.lastOutcome) } : {}),
    },
  };
}

/** Rebuilds the authoritative state from a persisted feature-state blob. */
export function fromFeatureState(featureState: FeatureState | undefined, fallback: { profileFingerprint: string; maxGambleAttempts?: number }): BookOfRaGameState | undefined {
  const stored = featureState?.bookOfRa;
  if (!stored) return undefined;
  const base = createBookOfRaState({
    profileId: stored.profileId ?? BOOK_OF_RA_PROFILE_ID,
    profileFingerprint: stored.profileFingerprint ?? fallback.profileFingerprint,
    betPerLine: stored.betPerLine,
    activeLines: stored.activeLines,
    maxGambleAttempts: stored.gambleMaxAttempts ?? fallback.maxGambleAttempts,
  });
  const storedPhase = stored.phase as BookOfRaRoundState;
  const phase: BookOfRaRoundState = stored.pendingActionId
    ? "GAMBLE_PENDING"
    : storedPhase === "FREE_GAME_INTRO" || storedPhase === "FREE_GAME_ACTIVE" || storedPhase === "FREE_GAME_COMPLETE"
      ? (stored.freeSpinsRemaining > 0 ? storedPhase : "FREE_GAME_COMPLETE")
      : "ROUND_COMPLETE";
  return {
    ...base,
    phase,
    totalBet: stored.totalBet,
    ...(stored.specialSymbol ? { specialSymbol: stored.specialSymbol } : {}),
    freeSpinsAwarded: stored.freeSpinsAwarded ?? 0,
    freeSpinsRemaining: stored.freeSpinsRemaining,
    freeSpinsPlayed: stored.freeSpinsPlayed,
    retriggerCount: stored.retriggerCount ?? 0,
    featureWin: stored.featureWin ?? "0",
    pendingWin: stored.pendingWin ?? "0",
    spinIndex: stored.spinIndex ?? 0,
    gambleAttempts: stored.gambleAttempts,
    ...(stored.gambleColours ? { gambleColours: [...stored.gambleColours] as BookOfRaColour[] } : {}),
    ...(stored.gambleHistory
      ? { gambleHistory: stored.gambleHistory.map((entry) => ({ ...entry }) as unknown as BookOfRaGambleAttempt) }
      : {}),
    ...(stored.pendingActionId ? { pendingActionId: stored.pendingActionId } : {}),
    ...(stored.pendingRoundId ? { pendingRoundId: stored.pendingRoundId } : {}),
    ...(stored.lastOutcome ? { lastOutcome: structuredClone(stored.lastOutcome) as BookOfRaSpinOutcome } : {}),
  };
}

/** The board a refresh renders: the last spin's final grid, if there was one. */
export function bookOfRaPresentation(state: BookOfRaGameState): {
  board?: Grid;
  wins?: Win[];
  expandingReels?: number[];
  specialSymbol?: string;
  totalSpinWin?: string;
  betPerLine: string;
  totalBet: string;
  activeLines: number;
  freeSpinsRemaining: number;
  freeSpinsPlayed: number;
  featureWin: string;
  pendingWin: string;
  gambleAttempts: number;
  gambleMaxAttempts: number;
  roundState: BookOfRaRoundState;
  pendingAction?: PendingAction;
} {
  const last = state.lastOutcome;
  return {
    ...(last ? { board: cloneGrid(last.finalGrid), wins: last.wins, totalSpinWin: last.totalSpinWin } : {}),
    ...(last && last.expandingReels.length ? { expandingReels: [...last.expandingReels] } : {}),
    ...(state.specialSymbol ? { specialSymbol: state.specialSymbol } : {}),
    betPerLine: state.betPerLine,
    totalBet: state.totalBet,
    activeLines: state.activeLines,
    freeSpinsRemaining: state.freeSpinsRemaining,
    freeSpinsPlayed: state.freeSpinsPlayed,
    featureWin: state.featureWin,
    pendingWin: state.pendingWin,
    gambleAttempts: state.gambleAttempts,
    gambleMaxAttempts: state.gambleMaxAttempts,
    roundState: state.phase,
    ...(state.pendingActionId ? { pendingAction: gambleAction(state.pendingRoundId ?? "", state.gambleAttempts) } : {}),
  };
}
