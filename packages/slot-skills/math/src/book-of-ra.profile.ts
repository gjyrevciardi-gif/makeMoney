import type { GameConfig, PaytableEntry, Rational } from "@slot-skills/schema";
import { hashMathContract } from "@slot-skills/schema";

/**
 * The Book of Ra Deluxe profile.
 *
 * This object is the single published source of truth for the game's
 * mathematics: the paytable, the symbol weights, the paylines, and the feature
 * configuration all live here, are frozen, and are identified by a stable
 * profile id plus a content fingerprint. A round records the fingerprint it was
 * played under, so a later mathematics change can never rewrite the meaning of
 * an already-settled round.
 *
 * Nothing in this file may depend on a player, a session, a balance, a streak,
 * or any prior outcome. Every spin is an independent draw from these fixed
 * weights; there is no adaptive or compensating behaviour anywhere in the
 * engine.
 */

export const BOOK_OF_RA_GAME_ID = "book-of-the-sands";
export const BOOK_OF_RA_PROFILE_ID = "book-of-ra.v1.rtp5000";
export const BOOK_OF_RA_REELS = 5;
export const BOOK_OF_RA_ROWS = 3;
export const BOOK_OF_RA_LINES = 10;
export const BOOK_OF_RA_SCATTER_SYMBOL = "scatter";
export const BOOK_OF_RA_FREE_SPINS_AWARD = 10;
export const BOOK_OF_RA_RETRIGGER_SPINS = 10;
export const BOOK_OF_RA_MAX_GAMBLE_ATTEMPTS = 5;
export const BOOK_OF_RA_DECLARED_RTP_BPS = 5_000;

/** High symbols expand from two reels, honour cards from three. */
export const BOOK_HIGH_SYMBOL_MINIMUM_REELS = 2;
export const BOOK_LOW_SYMBOL_MINIMUM_REELS = 3;

/**
 * Multipliers are per line bet, in whole units: `bookOfRaPayout` is the
 * canonical reader for this table. Scatter tiers are on the total stake.
 */
export const BOOK_OF_RA_PAYTABLE: Readonly<Record<string, Readonly<Record<number, number>>>> =
  Object.freeze({
    "high-1": Object.freeze({ 2: 10, 3: 100, 4: 1_000, 5: 5_000 }),
    "high-2": Object.freeze({ 2: 5, 3: 40, 4: 400, 5: 2_000 }),
    "high-3": Object.freeze({ 2: 5, 3: 30, 4: 100, 5: 750 }),
    "high-4": Object.freeze({ 2: 5, 3: 30, 4: 100, 5: 750 }),
    "low-1": Object.freeze({ 3: 5, 4: 40, 5: 150 }),
    "low-2": Object.freeze({ 3: 5, 4: 40, 5: 150 }),
    "low-3": Object.freeze({ 3: 5, 4: 25, 5: 100 }),
    "low-4": Object.freeze({ 3: 5, 4: 25, 5: 100 }),
    "low-5": Object.freeze({ 3: 5, 4: 25, 5: 100 }),
  });

/** Scatter multipliers are on the total stake, not the line bet. */
export const BOOK_OF_RA_SCATTER_PAYS: Readonly<Record<number, number>> = Object.freeze({
  3: 2,
  4: 20,
  5: 200,
});

/**
 * Symbol weights for the weighted-grid generator.
 *
 * These are the only tuning dial: with the paytable frozen, the published
 * return is set by how often each symbol lands. They are calibrated so the
 * simulated return, including free games, sits inside the profile's declared
 * 5000bps band; `docs/agent-work/book-backend/simulation.json` records the
 * validation run that measures it, and
 * `games/book-of-ra/scripts/calibrate-book-of-ra.mjs` records how they were
 * chosen. The mix keeps the Book (and therefore the free games) attainable:
 * roughly one feature per nine hundred paid spins.
 */
export const BOOK_OF_RA_SYMBOL_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  "high-1": 7,
  "high-2": 9,
  "high-3": 11,
  "high-4": 11,
  "low-1": 31,
  "low-2": 31,
  "low-3": 35,
  "low-4": 35,
  "low-5": 40,
  scatter: 3,
});

/** The classic ten-line set for a 5x3 cabinet. Rows are 0 top, 2 bottom. */
export const BOOK_OF_RA_PAYLINES: ReadonlyArray<ReadonlyArray<number>> = Object.freeze([
  Object.freeze([1, 1, 1, 1, 1]),
  Object.freeze([0, 0, 0, 0, 0]),
  Object.freeze([2, 2, 2, 2, 2]),
  Object.freeze([0, 1, 2, 1, 0]),
  Object.freeze([2, 1, 0, 1, 2]),
  Object.freeze([0, 0, 1, 2, 2]),
  Object.freeze([2, 2, 1, 0, 0]),
  Object.freeze([1, 0, 1, 2, 1]),
  Object.freeze([1, 2, 1, 0, 1]),
  Object.freeze([0, 1, 1, 1, 0]),
]);

const rational = (numerator: number): Rational => ({ numerator: String(numerator), denominator: "1" });

function paytableEntries(): PaytableEntry[] {
  const entries: PaytableEntry[] = [];
  for (const [symbolId, tiers] of Object.entries(BOOK_OF_RA_PAYTABLE)) {
    for (const count of Object.keys(tiers).map(Number).sort((left, right) => left - right)) {
      entries.push({ symbolId, count, payout: rational(tiers[count]!), basis: "line-bet" });
    }
  }
  for (const count of Object.keys(BOOK_OF_RA_SCATTER_PAYS).map(Number).sort((left, right) => left - right)) {
    entries.push({
      symbolId: BOOK_OF_RA_SCATTER_SYMBOL,
      count,
      payout: rational(BOOK_OF_RA_SCATTER_PAYS[count]!),
      basis: "bet",
    });
  }
  return entries;
}

function symbolEntries() {
  const symbols = [
    { id: "high-1", name: "Explorer", tags: ["high"] },
    { id: "high-2", name: "Pharaoh", tags: ["high"] },
    { id: "high-3", name: "Scarab", tags: ["high"] },
    { id: "high-4", name: "Guardian Statue", tags: ["high"] },
    { id: "low-1", name: "Ace", tags: ["low"] },
    { id: "low-2", name: "King", tags: ["low"] },
    { id: "low-3", name: "Queen", tags: ["low"] },
    { id: "low-4", name: "Jack", tags: ["low"] },
    { id: "low-5", name: "Ten", tags: ["low"] },
  ];
  return [
    ...symbols.map((symbol) => ({
      id: symbol.id,
      name: symbol.name,
      kind: "normal" as const,
      asset: symbol.id,
      tags: [...symbol.tags],
    })),
    {
      id: BOOK_OF_RA_SCATTER_SYMBOL,
      name: "Book of the Sands",
      kind: "scatter" as const,
      asset: BOOK_OF_RA_SCATTER_SYMBOL,
    },
  ];
}

export function bookOfRaPaytableEntries(): PaytableEntry[] {
  return paytableEntries();
}

/**
 * The complete engine configuration.
 *
 * Everything the runtime reads is derived from the frozen constants above, so
 * two calls always describe the same game. The presentation, theme, locale and
 * asset sections are carried because the engine schema requires them; they
 * contain no randomness and are never consulted when an outcome is produced.
 */
export function bookOfRaGameConfig(): GameConfig {
  const symbols = symbolEntries();
  return {
    schemaVersion: "2.0",
    engineApi: "1.0",
    id: BOOK_OF_RA_GAME_ID,
    version: "1.0.0",
    title: "Book of the Sands",
    layout: { reels: BOOK_OF_RA_REELS, rows: BOOK_OF_RA_ROWS, orientation: "responsive", maxVisibleCells: 100 },
    symbols,
    math: {
      evaluator: "paylines",
      outcomeGenerator: "weighted-grid",
      targets: {
        rtpBps: BOOK_OF_RA_DECLARED_RTP_BPS,
        volatility: "high",
        hitRateBps: [2_200, 3_200],
        maxWinMultiplier: { numerator: "5000", denominator: "1" },
      },
      paytable: paytableEntries(),
      paylines: BOOK_OF_RA_PAYLINES.map((line) => [...line]),
      symbolWeights: { ...BOOK_OF_RA_SYMBOL_WEIGHTS },
      featureWeights: {},
      maxCascades: 1,
    },
    features: [
      { id: "scatter-trigger", enabled: true, config: { count: 3, countOn: "final-grid" } },
      { id: "free-spins", enabled: true, config: { spins: BOOK_OF_RA_FREE_SPINS_AWARD } },
      {
        id: "retriggering-free-spins",
        enabled: true,
        config: { scatterCount: 3, spins: BOOK_OF_RA_RETRIGGER_SPINS, countOn: "final-grid" },
      },
      { id: "symbol-expansion", enabled: true, config: { symbolId: "high-1" } },
      { id: "gamble-feature", enabled: true, config: { maxAttempts: BOOK_OF_RA_MAX_GAMBLE_ATTEMPTS } },
    ],
    assets: [
      ...symbols.map((symbol) => ({
        id: symbol.asset,
        role: "symbol",
        path: `assets/${symbol.asset}.svg`,
        mediaType: "image/svg+xml",
      })),
      { id: "background", role: "background", path: "assets/background.svg", mediaType: "image/svg+xml" },
    ],
    theme: {
      id: "book-of-the-sands-theme",
      palette: ["#150d07", "#4a2f17", "#e8b93c", "#c0392b", "#f3e2bd"],
      components: {
        reels: "renderer:dom-grid",
        hud: "renderer:default-hud",
        paytable: "renderer:default-paytable",
        effects: "renderer:canvas-overlay",
      },
      effects: {
        "round-start": "reel-spin-blur",
        "reel-stop": "reel-stop-impact",
        win: "symbol-win-pulse",
        "reel-transform": "symbol-wild-reveal",
        "free-spins-start": "light-rays",
        "free-spins-end": "shine-starburst",
        "feature-start": "light-radial-pulse",
        "max-win": "fire-inferno",
      },
      sounds: {},
    },
    locales: { default: "en", packs: { en: "locales/en.json", "en-XA": "locales/en-XA.json" } },
    jurisdiction: {
      profileId: "mt-mga-reference",
      reviewedAt: "2026-09-18",
      reviewBy: "2026-12-18",
      sourceUrls: [
        "https://legislation.mt/eli/cap/583/eng",
        "https://www.mga.org.mt/app/uploads/Player-Protection-Directive-Directive-2-of-2018.pdf",
        "https://gaminglabs.com/wp-content/uploads/2024/06/GLI-19-Interactive-Gaming-Systems-v3.0.pdf",
      ],
    },
    providers: {
      rng: "node-crypto",
      wallet: "platform",
      jackpot: "none",
      session: "platform",
      audit: "platform",
    },
    presentation: {
      cycleDurationMs: 2_600,
      autoPlay: true,
      turbo: true,
      slamStop: true,
      celebrateReturnAtOrBelowStake: false,
      reducedMotionFallback: true,
      symbolScale: 1.12,
    },
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry);
  }
  return value;
}

/** The one immutable game configuration every production path reads. */
export const BOOK_OF_RA_GAME: GameConfig = deepFreeze(bookOfRaGameConfig());

/** Content fingerprint of the mathematics and features, recorded per round. */
export const BOOK_OF_RA_PROFILE_FINGERPRINT: string = hashMathContract({
  math: BOOK_OF_RA_GAME.math,
  features: BOOK_OF_RA_GAME.features,
});

export interface BookOfRaProfileDescriptor {
  profileId: string;
  gameId: string;
  fingerprint: string;
  declaredRtpBps: number;
  reels: number;
  rows: number;
  activeLines: number;
  freeSpins: number;
  retriggerSpins: number;
  maxGambleAttempts: number;
  scatterSymbolId: string;
  paytable: Readonly<Record<string, Readonly<Record<number, number>>>>;
  scatterPays: Readonly<Record<number, number>>;
  symbolWeights: Readonly<Record<string, number>>;
}

export const BOOK_OF_RA_PROFILE: Readonly<BookOfRaProfileDescriptor> = Object.freeze({
  profileId: BOOK_OF_RA_PROFILE_ID,
  gameId: BOOK_OF_RA_GAME_ID,
  fingerprint: BOOK_OF_RA_PROFILE_FINGERPRINT,
  declaredRtpBps: BOOK_OF_RA_DECLARED_RTP_BPS,
  reels: BOOK_OF_RA_REELS,
  rows: BOOK_OF_RA_ROWS,
  activeLines: BOOK_OF_RA_LINES,
  freeSpins: BOOK_OF_RA_FREE_SPINS_AWARD,
  retriggerSpins: BOOK_OF_RA_RETRIGGER_SPINS,
  maxGambleAttempts: BOOK_OF_RA_MAX_GAMBLE_ATTEMPTS,
  scatterSymbolId: BOOK_OF_RA_SCATTER_SYMBOL,
  paytable: BOOK_OF_RA_PAYTABLE,
  scatterPays: BOOK_OF_RA_SCATTER_PAYS,
  symbolWeights: BOOK_OF_RA_SYMBOL_WEIGHTS,
});

export class BookOfRaProfileError extends Error {}

/**
 * Structural validation of the published profile.
 *
 * Runs at startup and in tests. A profile that fails here is a mathematics bug,
 * not a runtime condition, so it throws instead of degrading.
 */
export function validateBookOfRaProfile(game: GameConfig = BOOK_OF_RA_GAME): void {
  const fail = (message: string): never => {
    throw new BookOfRaProfileError(`${BOOK_OF_RA_PROFILE_ID}: ${message}`);
  };

  if (game.id !== BOOK_OF_RA_GAME_ID) fail(`game id must be ${BOOK_OF_RA_GAME_ID}`);
  if (game.layout.reels !== BOOK_OF_RA_REELS || game.layout.rows !== BOOK_OF_RA_ROWS) {
    fail("layout must be 5 reels by 3 rows");
  }
  if ((game.math.paylines ?? []).length !== BOOK_OF_RA_LINES) fail("exactly ten paylines are required");
  for (const line of game.math.paylines ?? []) {
    if (line.length !== BOOK_OF_RA_REELS || line.some((row) => !Number.isInteger(row) || row < 0 || row >= BOOK_OF_RA_ROWS)) {
      fail("every payline must name one in-range row per reel");
    }
  }
  if (game.math.outcomeGenerator !== "weighted-grid" || !game.math.symbolWeights) {
    fail("the profile must generate outcomes from fixed symbol weights");
  }
  if (game.math.reelStrips) fail("the profile must not carry reel strips");
  const weights = game.math.symbolWeights ?? {};
  for (const symbol of game.symbols) {
    const weight = weights[symbol.id];
    if (typeof weight !== "number" || !Number.isInteger(weight) || weight <= 0) {
      fail(`symbol ${symbol.id} needs a positive integer weight`);
    }
  }
  for (const symbolId of Object.keys(weights)) {
    if (!game.symbols.some((symbol) => symbol.id === symbolId)) fail(`unknown symbol weight ${symbolId}`);
  }

  const scatterSymbols = game.symbols.filter((symbol) => symbol.kind === "scatter");
  if (scatterSymbols.length !== 1 || scatterSymbols[0]!.id !== BOOK_OF_RA_SCATTER_SYMBOL) {
    fail("the Book must be the single scatter-kind symbol");
  }
  if (game.symbols.some((symbol) => symbol.kind === "wild")) fail("the Book is the wild; no second wild may exist");

  const scatterEntries = new Map(game.math.paytable.filter((entry) => entry.symbolId === BOOK_OF_RA_SCATTER_SYMBOL).map((entry) => [entry.count, entry]));
  for (const [count, multiplier] of Object.entries(BOOK_OF_RA_SCATTER_PAYS)) {
    const entry = scatterEntries.get(Number(count));
    if (!entry) fail(`scatter tier ${count} is missing`);
    if (entry!.basis !== "bet") fail(`scatter tier ${count} must pay on the total stake`);
    if (Number(entry!.payout.numerator) !== multiplier || entry!.payout.denominator !== "1") {
      fail(`scatter tier ${count} must pay ${multiplier}x the total stake`);
    }
  }
  for (const [symbolId, tiers] of Object.entries(BOOK_OF_RA_PAYTABLE)) {
    for (const [count, multiplier] of Object.entries(tiers)) {
      const entry = game.math.paytable.find((candidate) => candidate.symbolId === symbolId && candidate.count === Number(count));
      if (!entry) fail(`paytable entry ${symbolId} x${count} is missing`);
      if (entry!.basis !== "line-bet") fail(`${symbolId} must pay on the line bet`);
      if (Number(entry!.payout.numerator) !== multiplier || entry!.payout.denominator !== "1") {
        fail(`${symbolId} x${count} must pay ${multiplier}x the line bet`);
      }
    }
  }

  const featureConfig = (id: string) => game.features.find((feature) => feature.id === id && feature.enabled)?.config;
  if (featureConfig("free-spins")?.spins !== BOOK_OF_RA_FREE_SPINS_AWARD) fail("free games must award ten spins");
  if (featureConfig("retriggering-free-spins")?.spins !== BOOK_OF_RA_RETRIGGER_SPINS) fail("a retrigger must add ten spins");
  if (featureConfig("retriggering-free-spins")?.scatterCount !== 3) fail("a retrigger requires three Books");
  if (featureConfig("scatter-trigger")?.count !== 3) fail("the free games require three Books");
  if (featureConfig("gamble-feature")?.maxAttempts !== BOOK_OF_RA_MAX_GAMBLE_ATTEMPTS) fail("the gamble cap must be five attempts");
  if (game.math.targets.rtpBps !== BOOK_OF_RA_DECLARED_RTP_BPS) fail(`the declared return must be ${BOOK_OF_RA_DECLARED_RTP_BPS}bps`);
}

validateBookOfRaProfile();
