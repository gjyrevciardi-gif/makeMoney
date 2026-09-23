import { describe, expect, it } from "vitest";
import { BOOK_OF_RA_GAME, BOOK_OF_RA_PROFILE, SeededRngProvider, evaluateBookOfRa, type RngDraw, type RngProvider } from "@slot-skills/math";
import {
  createBookOfRaState,
  fromFeatureState,
  hasPendingBookOfRaAction,
  isBookOfRaFreeGameActive,
  playBookOfRaRound,
  resolveBookOfRaGamble,
  toFeatureState,
  type BookOfRaGameState,
} from "./book-of-ra-round.js";
import type { Grid } from "@slot-skills/math";
import { DefaultGameEngine } from "./engine.js";

const GAME = BOOK_OF_RA_GAME;
const WEIGHTS = BOOK_OF_RA_PROFILE.symbolWeights as Record<string, number>;
const SYMBOL_ORDER = GAME.symbols.map((symbol) => symbol.id);
const NORMAL_ORDER = GAME.symbols.filter((symbol) => symbol.kind === "normal").map((symbol) => symbol.id);

/** Deterministic draw queue, so a test can dictate the exact board it plays. */
class ScriptedRng implements RngProvider {
  readonly id = "scripted-test-only";
  readonly production = false;
  #values: number[];
  #index = 0;

  constructor(values: number[]) {
    this.#values = values;
  }

  async uniformInt(maxExclusive: number, context: string): Promise<RngDraw> {
    const value = this.#values[this.#index] ?? 0;
    if (value < 0 || value >= maxExclusive) throw new Error(`scripted draw ${value} is outside ${maxExclusive} for ${context}`);
    const index = this.#index++;
    return { value, maxExclusive, index, source: this.id, reference: `${context}:${index}` };
  }
}

/** The first weight value that selects the requested symbol. */
function drawFor(symbolId: string): number {
  let cursor = 0;
  for (const id of SYMBOL_ORDER) {
    if (id === symbolId) return cursor;
    cursor += WEIGHTS[id]!;
  }
  throw new Error(`Unknown symbol ${symbolId}`);
}

function gridDraws(grid: Grid): number[] {
  const values: number[] = [];
  for (let reel = 0; reel < grid.length; reel += 1) {
    for (let row = 0; row < grid[reel]!.length; row += 1) values.push(drawFor(grid[reel]![row]!));
  }
  return values;
}

function blank(symbolId = "low-5"): Grid {
  return Array.from({ length: 5 }, () => [symbolId, symbolId, symbolId]);
}

function specialDraw(symbolId: string): number {
  const index = NORMAL_ORDER.indexOf(symbolId);
  if (index < 0) throw new Error(`Unknown expandable symbol ${symbolId}`);
  return index;
}

function state(betPerLine = "10"): BookOfRaGameState {
  return createBookOfRaState({
    profileId: BOOK_OF_RA_PROFILE.profileId,
    profileFingerprint: BOOK_OF_RA_PROFILE.fingerprint,
    betPerLine,
    activeLines: BOOK_OF_RA_PROFILE.activeLines,
  });
}

describe("Book of Ra Deluxe profile", () => {
  it("reports ten awarded games in the feature introduction event", async () => {
    const grid = blank();
    grid[0]![0] = "scatter";
    grid[1]![1] = "scatter";
    grid[2]![2] = "scatter";
    const { result } = await new DefaultGameEngine().spin(GAME,
      { roundId: "intro", playerId: "p", betUnits: "10" },
      new ScriptedRng([...gridDraws(grid), specialDraw("high-2")]));
    expect(result.events.find(event => event.type === "feature-start" && event.data.featureId === "free-spins")?.data.spins).toBe(10);
  });

  it("removes the pending action when a gamble is collected or lost", async () => {
    for (const choice of ["collect", "black"]) {
      const engine = new DefaultGameEngine();
      const { continuation } = await engine.spin(GAME,
        { roundId: `terminal-${choice}`, playerId: "p", betUnits: "10" },
        new ScriptedRng([...gridDraws(blank()), 0, 0, 0, 0, 0]));
      expect(continuation).toBeDefined();
      const resolved = engine.resolveActionStep(continuation!, continuation!.action.id, choice);
      expect(resolved.result.complete).toBe(true);
      expect(resolved.result.pendingAction).toBeUndefined();
      expect(resolved.continuation).toBeUndefined();
    }
  });
  it("publishes a 5x3 board with exactly ten fixed lines", () => {
    expect(GAME.layout.reels).toBe(5);
    expect(GAME.layout.rows).toBe(3);
    expect(GAME.math.paylines).toHaveLength(10);
    expect(GAME.math.symbolWeights).toEqual(BOOK_OF_RA_PROFILE.symbolWeights);
  });

  it("pays three, four and five Books on the total stake", () => {
    for (const [count, multiplier] of [[3, 2], [4, 20], [5, 200] as const]) {
      const grid = blank();
      for (let index = 0; index < count; index += 1) grid[Math.floor(index / 3)]![index % 3] = "scatter";
      const evaluation = evaluateBookOfRa(GAME, grid, 10n, 10);
      expect(evaluation.scatterWin).toBe(100n * BigInt(multiplier));
    }
  });

  it("never expands the Book itself and refuses a Book as the special symbol", async () => {
    const dirty = { ...state(), specialSymbol: "scatter" };
    await expect(playBookOfRaRound({ game: GAME, state: dirty, rng: new SeededRngProvider(1), roundId: "r", betPerLine: 10n }))
      .rejects.toThrow(/Book can never be the expanding symbol/);
  });
});

describe("Book of Ra paid spin", () => {
  it("awards ten free games with the bet, lines and total bet locked", async () => {
    const grid = blank();
    grid[0]![0] = "scatter";
    grid[1]![1] = "scatter";
    grid[2]![2] = "scatter";
    const rng = new ScriptedRng([...gridDraws(grid), specialDraw("high-2")]);
    const played = await playBookOfRaRound({ game: GAME, state: state("25"), rng, roundId: "trigger", betPerLine: 25n, autoplay: true });

    expect(played.outcome.freeSpin).toBe(false);
    expect(played.outcome.phase).toBe("FREE_GAME_INTRO");
    expect(played.outcome.specialSymbol).toBe("high-2");
    expect(played.outcome.freeSpinsRemaining).toBe(10);
    expect(played.state.freeSpinsAwarded).toBe(10);
    expect(played.state.betPerLine).toBe("25");
    expect(played.state.activeLines).toBe(10);
    expect(played.state.totalBet).toBe("250");
    // The triggering spin pays its own scatter win immediately.
    expect(played.outcome.scatterWin).toBe((250n * 2n).toString());
    expect(played.outcome.pendingAction).toBeUndefined();
  });

  it("locks the bet for the whole feature even when a larger bet is offered", async () => {
    const trigger = blank();
    trigger[0]![0] = "scatter";
    trigger[1]![1] = "scatter";
    trigger[2]![2] = "scatter";
    const first = await playBookOfRaRound({
      game: GAME,
      state: state("5"),
      rng: new ScriptedRng([...gridDraws(trigger), specialDraw("high-1")]),
      roundId: "trigger",
      betPerLine: 5n,
      autoplay: true,
    });
    const free = await playBookOfRaRound({
      game: GAME,
      state: first.state,
      rng: new ScriptedRng(gridDraws(blank())),
      roundId: "free-1",
      betPerLine: 1_000n,
      autoplay: true,
    });
    expect(free.outcome.betPerLine).toBe("5");
    expect(free.outcome.totalBet).toBe("50");
    expect(free.state.betPerLine).toBe("5");
  });

  it("offers a gamble for a paid win but never during autoplay or free games", async () => {
    const winning = blank();
    for (let reel = 0; reel < 5; reel += 1) winning[reel]![1] = "high-1";
    const manual = await playBookOfRaRound({
      game: GAME,
      state: state("10"),
      rng: new ScriptedRng([...gridDraws(winning), 0, 1, 0, 1, 0]),
      roundId: "win",
      betPerLine: 10n,
    });
    expect(manual.outcome.phase).toBe("GAMBLE_PENDING");
    expect(manual.outcome.pendingAction?.type).toBe("gamble");
    expect(manual.state.gambleColours).toHaveLength(BOOK_OF_RA_PROFILE.maxGambleAttempts);

    const autoplay = await playBookOfRaRound({
      game: GAME,
      state: state("10"),
      rng: new ScriptedRng(gridDraws(winning)),
      roundId: "win-auto",
      betPerLine: 10n,
      autoplay: true,
    });
    expect(autoplay.outcome.pendingAction).toBeUndefined();
    expect(autoplay.outcome.phase).toBe("ROUND_COMPLETE");
  });

  it("refuses a new paid spin while a gamble is pending", async () => {
    const winning = blank();
    for (let reel = 0; reel < 5; reel += 1) winning[reel]![1] = "high-1";
    const pending = await playBookOfRaRound({
      game: GAME,
      state: state("10"),
      rng: new ScriptedRng([...gridDraws(winning), 0, 1, 0, 1, 0]),
      roundId: "pending",
      betPerLine: 10n,
    });
    expect(hasPendingBookOfRaAction(pending.state)).toBe(true);
    await expect(playBookOfRaRound({
      game: GAME,
      state: pending.state,
      rng: new SeededRngProvider(3),
      roundId: "second",
      betPerLine: 10n,
    })).rejects.toThrow(/pending gamble/);
  });

  it("starts a fresh paid spin from clean counters", async () => {
    const winning = blank();
    for (let reel = 0; reel < 5; reel += 1) winning[reel]![1] = "high-1";
    const played = await playBookOfRaRound({
      game: GAME,
      state: state("10"),
      rng: new ScriptedRng(gridDraws(winning)),
      roundId: "clean",
      betPerLine: 10n,
      autoplay: true,
    });
    const again = await playBookOfRaRound({
      game: GAME,
      state: played.state,
      rng: new ScriptedRng(gridDraws(blank())),
      roundId: "clean-2",
      betPerLine: 20n,
      autoplay: true,
    });
    expect(again.state.betPerLine).toBe("20");
    expect(again.state.pendingWin).toBe("0");
    expect(again.state.freeSpinsPlayed).toBe(0);
    expect(again.state.specialSymbol).toBeUndefined();
  });
});

describe("Book of Ra free games", () => {
  async function intoFeature(specialSymbol = "high-2"): Promise<BookOfRaGameState> {
    const trigger = blank();
    trigger[0]![0] = "scatter";
    trigger[1]![1] = "scatter";
    trigger[2]![2] = "scatter";
    const played = await playBookOfRaRound({
      game: GAME,
      state: state("10"),
      rng: new ScriptedRng([...gridDraws(trigger), specialDraw(specialSymbol)]),
      roundId: "trigger",
      betPerLine: 10n,
      autoplay: true,
    });
    return played.state;
  }

  it("expands a high symbol on non-adjacent reels and pays exactly once", async () => {
    const locked = await intoFeature("high-2");
    const grid = blank();
    grid[0]![0] = "high-2";
    grid[3]![2] = "high-2";
    const free = await playBookOfRaRound({
      game: GAME,
      state: locked,
      rng: new ScriptedRng(gridDraws(grid)),
      roundId: "free",
      autoplay: true,
    });
    expect(free.outcome.expandingReels).toEqual([0, 3]);
    // high-2 pays 5x the line bet at two reels, across ten lines: 5 x 10 x 10.
    expect(free.outcome.expandingWin).toBe("500");
    expect(free.outcome.wins.filter((win) => win.evaluator === "book-of-ra-expanding")).toHaveLength(1);
    // The reveal board is untouched: line wins were evaluated before any reel
    // was filled, and the expansion is added as one separate award.
    expect(free.outcome.board).toEqual(grid);
    // Every cell of a qualifying reel becomes the expanding symbol.
    for (const reel of [0, 3]) expect(new Set(free.outcome.finalGrid[reel])).toEqual(new Set(["high-2"]));
    // Every line win still points at the pre-expansion cells.
    for (const win of free.outcome.regularWins) {
      for (const cell of win.cells) {
        const value = free.outcome.board[cell.reel]![cell.row];
        expect(value === win.symbolId || value === "scatter").toBe(true);
      }
    }
  });

  it("requires three reels for an honour card but only two for a premium symbol", async () => {
    const highLocked = await intoFeature("high-1");
    const twoReels = blank();
    twoReels[1]![0] = "high-1";
    twoReels[4]![2] = "high-1";
    const high = await playBookOfRaRound({ game: GAME, state: highLocked, rng: new ScriptedRng(gridDraws(twoReels)), roundId: "high", autoplay: true });
    expect(high.outcome.expandingReels).toEqual([1, 4]);
    expect(BigInt(high.outcome.expandingWin)).toBeGreaterThan(0n);

    const lowLocked = await intoFeature("low-1");
    const lowReels = twoReels.map(reel => reel.map(symbol => symbol === "high-1" ? "low-1" : symbol));
    const low = await playBookOfRaRound({ game: GAME, state: lowLocked, rng: new ScriptedRng(gridDraws(lowReels)), roundId: "low", autoplay: true });
    expect(low.outcome.expandingReels).toEqual([]);
    expect(low.outcome.expandingWin).toBe("0");
    lowReels[2]![1] = "low-1";
    const three = await playBookOfRaRound({ game: GAME, state: low.state, rng: new ScriptedRng(gridDraws(lowReels)), roundId: "low-three", autoplay: true });
    expect(three.outcome.expandingReels).toEqual([1, 2, 4]);
    expect(BigInt(three.outcome.expandingWin)).toBeGreaterThan(0n);
  });

  it("counts ten spins exactly and stacks multiple retriggers", async () => {
    let current = await intoFeature("high-3");
    let played = 0;
    let retriggers = 0;
    while (isBookOfRaFreeGameActive(current)) {
      const grid = blank();
      // The first two free spins land three Books each, so the ladder of ten
      // spins is extended twice and still keeps its expanding symbol.
      if (played < 2) {
        grid[0]![0] = "scatter";
        grid[1]![1] = "scatter";
        grid[2]![2] = "scatter";
      }
      const round = await playBookOfRaRound({
        game: GAME,
        state: current,
        rng: new ScriptedRng(gridDraws(grid)),
        roundId: `free-${played}`,
        autoplay: true,
      });
      current = round.state;
      played += 1;
      retriggers += round.outcome.retriggered;
      expect(round.outcome.specialSymbol).toBe("high-3");
      if (played > 40) throw new Error("Free games did not terminate");
    }
    expect(played).toBe(30);
    expect(retriggers).toBe(20);
    expect(current.freeSpinsRemaining).toBe(0);
    expect(current.freeSpinsPlayed).toBe(30);
    expect(current.retriggerCount).toBe(2);
    expect(current.phase).toBe("FREE_GAME_COMPLETE");
  });

  it("keeps the expanding symbol across a retrigger", async () => {
    const locked = await intoFeature("low-3");
    const grid = blank();
    grid[0]![0] = "scatter";
    grid[1]![1] = "scatter";
    grid[2]![2] = "scatter";
    const round = await playBookOfRaRound({ game: GAME, state: locked, rng: new ScriptedRng(gridDraws(grid)), roundId: "retrigger", autoplay: true });
    expect(round.state.specialSymbol).toBe("low-3");
    // One spin is consumed, then the retrigger adds ten more.
    expect(round.state.freeSpinsRemaining).toBe(19);
    expect(round.state.retriggerCount).toBe(1);
  });
});

describe("Book of Ra gamble ladder", () => {
  async function pendingGamble(): Promise<BookOfRaGameState> {
    const winning = blank();
    for (let reel = 0; reel < 5; reel += 1) winning[reel]![1] = "high-1";
    // Colours: red, black, red, black, red.
    const played = await playBookOfRaRound({
      game: GAME,
      state: state("10"),
      rng: new ScriptedRng([...gridDraws(winning), 0, 1, 0, 1, 0]),
      roundId: "gamble",
      betPerLine: 10n,
    });
    return played.state;
  }

  it("collects the pending win and completes the round", async () => {
    const locked = await pendingGamble();
    const before = BigInt(locked.pendingWin);
    const { state: next, outcome } = resolveBookOfRaGamble(locked, "collect");
    expect(outcome.complete).toBe(true);
    expect(outcome.settlement).toBe(before.toString());
    expect(next.pendingWin).toBe(before.toString());
    expect(next.phase).toBe("ROUND_COMPLETE");
    expect(next.pendingActionId).toBeUndefined();
  });

  it("doubles a correct guess and lets the ladder reach its five-attempt cap", async () => {
    let current = await pendingGamble();
    const start = BigInt(current.pendingWin);
    // Colours are red, black, red, black, red; matching each one always wins.
    const guesses = current.gambleColours!;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const resolved = resolveBookOfRaGamble(current, guesses[attempt - 1]!);
      current = resolved.state;
      expect(resolved.outcome.won).toBe(true);
      expect(BigInt(current.pendingWin)).toBe(start * (2n ** BigInt(attempt)));
      expect(resolved.outcome.complete).toBe(false);
      expect(current.pendingActionId).toBe(`gamble:gamble-feature:${attempt}`);
    }
    const final = resolveBookOfRaGamble(current, guesses[4]!);
    expect(final.outcome.complete).toBe(true);
    expect(BigInt(final.state.pendingWin)).toBe(start * 32n);
    expect(final.state.pendingActionId).toBeUndefined();
    expect(final.outcome.attemptsRemaining).toBe(0);
  });

  it("zeroes the pending win on a wrong guess and ends the gamble", async () => {
    const locked = await pendingGamble();
    // The first drawn colour is red, so black loses.
    const { state: next, outcome } = resolveBookOfRaGamble(locked, "black");
    expect(outcome.won).toBe(false);
    expect(outcome.complete).toBe(true);
    expect(outcome.settlement).toBe("0");
    expect(next.pendingWin).toBe("0");
    expect(next.phase).toBe("ROUND_COMPLETE");
  });

  it("resolves identically when the same choice is replayed", async () => {
    const locked = await pendingGamble();
    const first = resolveBookOfRaGamble(locked, "red");
    const replay = resolveBookOfRaGamble(locked, "red");
    expect(replay.outcome).toEqual(first.outcome);
    expect(replay.state.pendingWin).toBe(first.state.pendingWin);
  });
});

describe("Book of Ra session recovery", () => {
  it("round-trips the whole feature state through persistence", async () => {
    const trigger = blank();
    trigger[0]![0] = "scatter";
    trigger[1]![1] = "scatter";
    trigger[2]![2] = "scatter";
    const started = await playBookOfRaRound({
      game: GAME,
      state: state("15"),
      rng: new ScriptedRng([...gridDraws(trigger), specialDraw("high-4")]),
      roundId: "recovery",
      betPerLine: 15n,
      autoplay: true,
    });
    const free = await playBookOfRaRound({
      game: GAME,
      state: started.state,
      rng: new ScriptedRng(gridDraws(blank())),
      roundId: "recovery-free",
      autoplay: true,
    });
    const restored = fromFeatureState(toFeatureState(free.state), { profileFingerprint: BOOK_OF_RA_PROFILE.fingerprint });
    expect(restored).toBeDefined();
    expect(restored!.specialSymbol).toBe("high-4");
    expect(restored!.freeSpinsRemaining).toBe(9);
    expect(restored!.freeSpinsPlayed).toBe(1);
    expect(restored!.totalBet).toBe("150");
    expect(restored!.featureWin).toBe(free.state.featureWin);
    expect(restored!.lastOutcome).toEqual(free.state.lastOutcome);
  });

  it("keeps a pending gamble recoverable with its drawn colours", async () => {
    const winning = blank();
    for (let reel = 0; reel < 5; reel += 1) winning[reel]![1] = "high-1";
    const played = await playBookOfRaRound({
      game: GAME,
      state: state("10"),
      rng: new ScriptedRng([...gridDraws(winning), 0, 1, 0, 1, 0]),
      roundId: "gamble-recovery",
      betPerLine: 10n,
    });
    const restored = fromFeatureState(toFeatureState(played.state), { profileFingerprint: BOOK_OF_RA_PROFILE.fingerprint })!;
    expect(restored.gambleColours).toEqual(["red", "black", "red", "black", "red"]);
    const resolved = resolveBookOfRaGamble(restored, "red");
    expect(resolved.outcome.won).toBe(true);
  });
});
