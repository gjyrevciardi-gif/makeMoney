#!/usr/bin/env node
/**
 * Book of Ra Deluxe simulation harness.
 *
 * This script does not implement any part of the game. It drives the exact
 * production functions the platform adapter and the runtime engine call:
 * `playBookOfRaRound` (grid generation, payline evaluation, scatter pays, the
 * free-game state machine, expanding-symbol selection and retriggering) and
 * `resolveBookOfRaGamble` (the five-attempt red/black ladder).
 *
 * The return measured here is therefore the return the platform actually
 * serves under profile `book-of-ra.v1.rtp5000`, not a parallel model.
 *
 * Usage:
 *   node games/book-of-ra/scripts/simulate-book-of-ra.mjs --spins 1000000 --seed 20260923
 *   node games/book-of-ra/scripts/simulate-book-of-ra.mjs --spins 100000 --gamble-seeds 20
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createBookOfRaState,
  playBookOfRaRound,
  resolveBookOfRaGamble,
} from "@slot-skills/runtime";
import {
  BOOK_OF_RA_GAME,
  BOOK_OF_RA_PROFILE,
  BOOK_OF_RA_PROFILE_ID,
  SeededRngProvider,
} from "@slot-skills/math";

const here = path.dirname(fileURLToPath(import.meta.url));
const reportDir = path.resolve(here, "../../../docs/agent-work/book-backend");

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? true : value;
}

function integerArgument(name, fallback) {
  const raw = argument(name, undefined);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`--${name} must be a positive integer`);
  return value;
}

function integerList(name, fallback) {
  const raw = argument(name, undefined);
  if (raw === undefined) return fallback;
  const values = String(raw).split(",").map((entry) => Number(entry.trim()));
  if (!values.length || values.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error(`--${name} must be a comma separated list of positive integers`);
  }
  return values;
}

const BPS = 10_000n;

function bps(numerator, denominator) {
  if (denominator === 0n) return 0;
  return Number((numerator * BPS) / denominator);
}

function ratioPercent(numerator, denominator) {
  if (denominator === 0n) return "0.000000";
  return (Number(numerator * 1_000_000n / denominator) / 10_000).toFixed(6);
}

/**
 * Plays one paid spin plus every free spin it triggers, to completion.
 *
 * Gamble is deliberately not offered: the published return excludes it, and
 * the ladder is measured separately below.
 */
async function playPaidSpin(state, rng, roundPrefix, betPerLine) {
  const paid = await playBookOfRaRound({
    game: BOOK_OF_RA_GAME,
    state,
    rng,
    roundId: `${roundPrefix}:paid`,
    betPerLine,
    autoplay: true,
  });
  const paidSpin = {
    wager: BigInt(paid.outcome.totalBet),
    baseWin: BigInt(paid.outcome.totalSpinWin),
    featureWin: 0n,
    hit: BigInt(paid.outcome.totalSpinWin) > 0n,
  };
  const freeSpins = [];
  let featureState = paid.state;
  let guard = 0;
  while (featureState.freeSpinsRemaining > 0) {
    if (guard++ > 10_000) throw new Error("Free-game sequence did not terminate");
    const free = await playBookOfRaRound({
      game: BOOK_OF_RA_GAME,
      state: featureState,
      rng,
      roundId: `${roundPrefix}:free:${featureState.freeSpinsPlayed}`,
      autoplay: true,
    });
    freeSpins.push({
      win: BigInt(free.outcome.totalSpinWin),
      expandingReels: free.outcome.expandingReels.length,
      retriggered: free.outcome.retriggered,
      specialSymbol: free.outcome.specialSymbol,
    });
    featureState = free.state;
  }
  return { state: featureState, paidSpin, freeSpins };
}

async function simulate(seed, paidSpins, betPerLine) {
  const rng = new SeededRngProvider(seed);
  let state = createBookOfRaState({
    profileId: BOOK_OF_RA_PROFILE_ID,
    profileFingerprint: BOOK_OF_RA_PROFILE.fingerprint,
    betPerLine: betPerLine.toString(),
    activeLines: BOOK_OF_RA_PROFILE.activeLines,
  });
  let paid = 0;
  let freeSpins = 0;
  let wager = 0n;
  let baseWin = 0n;
  let featureWin = 0n;
  let paidHits = 0;
  let allSpins = 0;
  let allHits = 0;
  let triggers = 0;
  let retriggers = 0;
  let expansionSpins = 0;
  let scattersLanded = 0;
  let maxSpinsInFeature = 0;
  const symbolSelection = new Map();
  const ROUNDS = 5_000;
  while (paid < paidSpins) {
    const round = await playPaidSpin(state, rng, `sim-${seed}-${paid}`, betPerLine);
    state = round.state;
    paid += 1;
    wager += round.paidSpin.wager;
    baseWin += round.paidSpin.baseWin;
    if (round.paidSpin.hit) paidHits += 1;
    allSpins += 1;
    if (round.paidSpin.baseWin > 0n) allHits += 1;
    if (round.freeSpins.length) {
      triggers += 1;
      maxSpinsInFeature = Math.max(maxSpinsInFeature, round.freeSpins.length);
      for (const spin of round.freeSpins) {
        freeSpins += 1;
        featureWin += spin.win;
        allSpins += 1;
        if (spin.win > 0n) allHits += 1;
        if (spin.retriggered > 0) retriggers += 1;
        if (spin.expandingReels > 0) expansionSpins += 1;
        if (spin.specialSymbol) symbolSelection.set(spin.specialSymbol, (symbolSelection.get(spin.specialSymbol) ?? 0) + 1);
      }
    }
    if (paid % ROUNDS === 0) {
      process.stdout.write(`  seed ${seed}: ${paid}/${paidSpins} paid spins (${freeSpins} free, ${triggers} features)\r`);
    }
  }
  process.stdout.write(" ".repeat(80) + "\r");
  const totalWin = baseWin + featureWin;
  return {
    seed,
    paidSpins,
    freeSpins,
    spins: paid + freeSpins,
    wagerUnits: wager.toString(),
    baseWinUnits: baseWin.toString(),
    featureWinUnits: featureWin.toString(),
    totalWinUnits: totalWin.toString(),
    baseRtpBps: bps(baseWin, wager),
    featureRtpBps: bps(featureWin, wager),
    totalRtpBps: bps(totalWin, wager),
    houseEdgeBps: 10_000 - bps(totalWin, wager),
    paidHits,
    paidHitRateBps: bps(BigInt(paidHits), BigInt(paid)),
    allHits,
    allHitRateBps: bps(BigInt(allHits), BigInt(allSpins)),
    triggers,
    retriggers,
    expansionSpins,
    scattersLanded,
    maxSpinsInFeature,
    specialSymbolDistribution: Object.fromEntries([...symbolSelection.entries()].sort((left, right) => right[1] - left[1])),
  };
}

/**
 * The gamble ladder, measured on its own so it can never leak into the
 * published slot return. Each trial starts from a pending win, then either
 * collects immediately, or plays the ladder to its five-attempt cap.
 */
async function simulateGamble(seed, trials, betPerLine, strategy) {
  const rng = new SeededRngProvider(seed);
  // Five total bets is a typical Book of Ra paid win; the ladder itself does
  // not depend on the size of the amount at risk.
  const pending = BigInt(betPerLine) * BigInt(BOOK_OF_RA_PROFILE.activeLines) * 5n;
  let atRisk = 0n;
  let settled = 0n;
  let attempts = 0;
  let wins = 0;
  let losses = 0;
  let capped = 0;
  const settlements = [];
  for (let trial = 0; trial < trials; trial += 1) {
    const roundId = `gamble-${seed}-${trial}`;
    const colours = [];
    for (let attempt = 0; attempt < BOOK_OF_RA_PROFILE.maxGambleAttempts; attempt += 1) {
      const draw = await rng.uniformInt(2, `gamble-colour:${attempt}`);
      colours.push(draw.value === 0 ? "red" : "black");
    }
    // A real round hands the ladder its colours when it offers the gamble; the
    // trial enters at exactly that point.
    const offered = {
      ...createBookOfRaState({
        profileId: BOOK_OF_RA_PROFILE_ID,
        profileFingerprint: BOOK_OF_RA_PROFILE.fingerprint,
        betPerLine: betPerLine.toString(),
        activeLines: BOOK_OF_RA_PROFILE.activeLines,
      }),
      phase: "GAMBLE_PENDING",
      pendingWin: pending.toString(),
      pendingRoundId: roundId,
      pendingActionId: `${roundId}:gamble-feature:0`,
      gambleColours: colours,
      gambleHistory: [],
    };
    let result = resolveBookOfRaGamble(offered, strategy);
    while (!result.outcome.complete) {
      result = resolveBookOfRaGamble(result.state, strategy);
    }
    const final = BigInt(result.state.pendingWin);
    atRisk += pending;
    settled += final;
    attempts += result.state.gambleAttempts;
    settlements.push(final);
    if (final === 0n) losses += 1;
    else if (result.state.gambleAttempts >= BOOK_OF_RA_PROFILE.maxGambleAttempts) capped += 1;
    else wins += 1;
  }
  const mean = settlements.reduce((total, value) => total + value, 0n) / BigInt(trials);
  return {
    seed,
    trials,
    strategy,
    note: "Gamble is excluded from the slot return above and is reported only here.",
    pendingPerTrial: pending.toString(),
    atRiskUnits: atRisk.toString(),
    settledUnits: settled.toString(),
    returnBpsAgainstRisk: bps(settled, atRisk),
    meanSettlementUnits: mean.toString(),
    averageAttempts: attempts / trials,
    endedBelowCap: wins,
    endedAtCap: capped,
    losses,
    zeroWinRateBps: bps(BigInt(losses), BigInt(trials)),
  };
}

async function main() {
  const paidSpins = integerArgument("spins", 1_000_000);
  const seeds = integerList("seeds", [integerArgument("seed", 20260923)]);
  const betPerLine = BigInt(integerArgument("bet-per-line", 10));
  const perSeed = [];
  for (const seed of seeds) {
    process.stdout.write(`Simulating ${paidSpins} paid spins with seed ${seed}...\n`);
    perSeed.push(await simulate(seed, paidSpins, betPerLine));
  }

  const aggregate = perSeed.reduce((total, report) => ({
    paidSpins: total.paidSpins + report.paidSpins,
    freeSpins: total.freeSpins + report.freeSpins,
    spins: total.spins + report.spins,
    wagerUnits: total.wagerUnits + BigInt(report.wagerUnits),
    baseWinUnits: total.baseWinUnits + BigInt(report.baseWinUnits),
    featureWinUnits: total.featureWinUnits + BigInt(report.featureWinUnits),
    totalWinUnits: total.totalWinUnits + BigInt(report.totalWinUnits),
    paidHits: total.paidHits + report.paidHits,
    allHits: total.allHits + report.allHits,
    triggers: total.triggers + report.triggers,
    retriggers: total.retriggers + report.retriggers,
    expansionSpins: total.expansionSpins + report.expansionSpins,
  }), {
    paidSpins: 0, freeSpins: 0, spins: 0, wagerUnits: 0n, baseWinUnits: 0n, featureWinUnits: 0n,
    totalWinUnits: 0n, paidHits: 0, allHits: 0, triggers: 0, retriggers: 0, expansionSpins: 0,
  });

  const gambleSeeds = integerList("gamble-seeds", []);
  const gambleTrials = integerArgument("gamble-trials", 20_000);
  const gamble = [];
  if (gambleSeeds.length) {
    for (const seed of gambleSeeds) {
      gamble.push(await simulateGamble(seed, gambleTrials, betPerLine, "red"));
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    profile: {
      profileId: BOOK_OF_RA_PROFILE.profileId,
      fingerprint: BOOK_OF_RA_PROFILE.fingerprint,
      declaredRtpBps: BOOK_OF_RA_PROFILE.declaredRtpBps,
      gameId: BOOK_OF_RA_PROFILE.gameId,
      gameVersion: BOOK_OF_RA_GAME.version,
      activeLines: BOOK_OF_RA_PROFILE.activeLines,
      freeSpins: BOOK_OF_RA_PROFILE.freeSpins,
      retriggerSpins: BOOK_OF_RA_PROFILE.retriggerSpins,
      maxGambleAttempts: BOOK_OF_RA_PROFILE.maxGambleAttempts,
      symbolWeights: BOOK_OF_RA_PROFILE.symbolWeights,
    },
    method: {
      engine: "playBookOfRaRound (production runtime engine)",
      rng: "SeededRngProvider (deterministic test RNG; production uses node:crypto CSPRNG)",
      gamble: "excluded from slot RTP; measured separately below",
      costModel: "one paid spin debits betPerLine x activeLines; free spins add no further wager",
      hitRateDefinition: "paidHitRateBps counts paid spins whose own grid returned a positive win; allHitRateBps counts every paid and free spin that returned a positive win",
      rtpDenominator: "every RTP figure divides by the total paid wager, including feature wins",
    },
    perSeed,
    aggregate: {
      seeds,
      paidSpins: aggregate.paidSpins,
      freeSpins: aggregate.freeSpins,
      spins: aggregate.spins,
      wagerUnits: aggregate.wagerUnits.toString(),
      baseWinUnits: aggregate.baseWinUnits.toString(),
      featureWinUnits: aggregate.featureWinUnits.toString(),
      totalWinUnits: aggregate.totalWinUnits.toString(),
      baseRtpBps: bps(aggregate.baseWinUnits, aggregate.wagerUnits),
      baseRtpPercent: ratioPercent(aggregate.baseWinUnits, aggregate.wagerUnits),
      featureRtpBps: bps(aggregate.featureWinUnits, aggregate.wagerUnits),
      featureRtpPercent: ratioPercent(aggregate.featureWinUnits, aggregate.wagerUnits),
      totalRtpBps: bps(aggregate.totalWinUnits, aggregate.wagerUnits),
      totalRtpPercent: ratioPercent(aggregate.totalWinUnits, aggregate.wagerUnits),
      houseEdgeBps: 10_000 - bps(aggregate.totalWinUnits, aggregate.wagerUnits),
      // Exact complement of the total return, not the rounded basis-point one.
      houseEdgePercent: (100 - Number(ratioPercent(aggregate.totalWinUnits, aggregate.wagerUnits))).toFixed(4),
      paidHitRateBps: bps(BigInt(aggregate.paidHits), BigInt(aggregate.paidSpins)),
      allHitRateBps: bps(BigInt(aggregate.allHits), BigInt(aggregate.spins)),
      featureTriggerFrequencyBps: bps(BigInt(aggregate.triggers), BigInt(aggregate.paidSpins)),
      featuresPerPaidSpin: (aggregate.triggers / aggregate.paidSpins).toFixed(8),
      averageFeatureReturnUnits: aggregate.triggers
        ? (aggregate.featureWinUnits / BigInt(aggregate.triggers)).toString()
        : "0",
      averageFeatureReturnInTotalBets: aggregate.triggers
        ? (Number(aggregate.featureWinUnits) / aggregate.triggers / Number(betPerLine * BigInt(BOOK_OF_RA_PROFILE.activeLines))).toFixed(6)
        : "0.000000",
      retriggerFrequencyPerFreeSpinBps: bps(BigInt(aggregate.retriggers), BigInt(aggregate.freeSpins)),
      expansionFrequencyPerFreeSpinBps: bps(BigInt(aggregate.expansionSpins), BigInt(aggregate.freeSpins)),
      averageFreeSpinsPerFeature: aggregate.triggers ? (aggregate.freeSpins / aggregate.triggers).toFixed(6) : "0",
    },
    gamble,
  };
  report.digest = createHash("sha256").update(JSON.stringify({
    profile: report.profile,
    aggregate: report.aggregate,
    perSeed: perSeed.map((seed) => ({ seed: seed.seed, paidSpins: seed.paidSpins, wagerUnits: seed.wagerUnits, totalWinUnits: seed.totalWinUnits })),
  })).digest("hex");

  const out = argument("out", undefined);
  if (out !== false && out !== undefined) {
    const file = path.resolve(process.cwd(), String(out));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`Wrote ${file}\n`);
  }
  process.stdout.write(
    `paidSpins=${report.aggregate.paidSpins} freeSpins=${report.aggregate.freeSpins} `
    + `totalRtp=${report.aggregate.totalRtpPercent}% (base ${report.aggregate.baseRtpPercent}%, feature ${report.aggregate.featureRtpPercent}%) `
    + `houseEdge=${report.aggregate.houseEdgePercent}% triggers=${report.aggregate.featureTriggerFrequencyBps}bps\n`,
  );
}

await main();
