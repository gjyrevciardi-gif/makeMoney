import { hashMathContract, type GameConfig } from "@slot-skills/schema";
import { SeededRngProvider } from "@slot-skills/math";
import { DefaultGameEngine, roundCostUnits } from "./engine.js";
import type { FeatureState } from "@slot-skills/features";
import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";

export const RUNTIME_EVIDENCE_VERSION = "1.1.0";

export interface SymbolHitStats {
  hits: number;
  winUnits: string;
  /** Raw matched-symbol count per win event -> occurrences (e.g. "8": 1201). */
  countDistribution: Record<string, number>;
}

export interface FeatureStats {
  triggers: number;
  totalWinUnits: string;
}

export interface WinHistogramBucket {
  label: string;
  /** Upper bound (inclusive) of the round-win multiplier for this bucket; null for the open-ended top bucket. */
  maxMultiplier: number | null;
  rounds: number;
  winUnits: string;
}

export const WIN_HISTOGRAM_BUCKETS: ReadonlyArray<{ label: string; maxMultiplier: number | null }> = [
  { label: "0x", maxMultiplier: 0 },
  { label: "0-1x", maxMultiplier: 1 },
  { label: "1-5x", maxMultiplier: 5 },
  { label: "5-20x", maxMultiplier: 20 },
  { label: "20-100x", maxMultiplier: 100 },
  { label: "100-500x", maxMultiplier: 500 },
  { label: "500x+", maxMultiplier: null },
];

function histogramBucketIndex(multiplier: number): number {
  if (multiplier <= 0) return 0;
  for (let index = 1; index < WIN_HISTOGRAM_BUCKETS.length; index += 1) {
    const max = WIN_HISTOGRAM_BUCKETS[index]!.maxMultiplier;
    if (max === null || multiplier <= max) return index;
  }
  return WIN_HISTOGRAM_BUCKETS.length - 1;
}

export type WinPhase = "base" | "freeSpins" | "holdAndWin" | "interactive";
const WIN_PHASES: readonly WinPhase[] = ["base", "freeSpins", "holdAndWin", "interactive"];

export class SimulationCancelledError extends Error {
  constructor() { super("Simulation cancelled"); this.name = "SimulationCancelledError"; }
}

export interface SimulationHooks {
  onProgress?: (roundsDone: number, roundsTotal: number) => void;
  /** How often (in rounds) progress is reported and cancellation is checked. Default 10,000. */
  progressEveryRounds?: number;
  signal?: AbortSignal;
}

export interface FullSimulationReport {
  runtimeEvidenceVersion: string;
  mathHash: string;
  rounds: number;
  seed: number;
  betUnits: string;
  totalBetUnits: string;
  totalWinUnits: string;
  rtpBps: number;
  hitRateBps: number;
  hitCount: number;
  featureEventCounts: Record<string, number>;
  winUnitsBySource: Record<string, string>;
  winUnitsBySymbol: Record<string, string>;
  /** Round totals attributed by phase; buckets always sum exactly to totalWinUnits. */
  winUnitsByPhase: Record<WinPhase, string>;
  rtpBpsByPhase: Record<WinPhase, number>;
  winMultiplierHistogram: WinHistogramBucket[];
  symbolStats: Record<string, SymbolHitStats>;
  featureStats: Record<string, FeatureStats>;
  maxObservedMultiplier: number;
  variance: number;
  standardDeviation: number;
  confidence99Bps: [number, number];
  multiplierSum: number;
  multiplierSquares: number;
  deterministicDigest: string;
}

export interface SimulationOptions {
  /** Feature id purchased on every round (e.g. "bonus-buy"); RTP is measured against the purchase cost. */
  purchasedFeatureId?: string;
  /** Ante bet active on every round; RTP is measured against the boosted stake. */
  anteBet?: boolean;
}

export async function simulateGame(game: GameConfig, rounds: number, seed = 1, betUnits = "100", options: SimulationOptions = {}, hooks: SimulationHooks = {}): Promise<FullSimulationReport> {
  if (!Number.isInteger(rounds) || rounds <= 0) throw new Error("Rounds must be a positive integer");
  const engine = new DefaultGameEngine();
  const rng = new SeededRngProvider(seed);
  const costUnits = roundCostUnits(game, { betUnits, ...(options.purchasedFeatureId ? { purchasedFeatureId: options.purchasedFeatureId } : {}), ...(options.anteBet ? { anteBet: true } : {}) });
  const featureState: FeatureState = {};
  const eventCounts: Record<string, number> = {};
  const sourceWins: Record<string, bigint> = { evaluated: 0n, freeSpins: 0n, holdAndWin: 0n, interactive: 0n };
  const symbolWins: Record<string, bigint> = {};
  const phaseWins: Record<WinPhase, bigint> = { base: 0n, freeSpins: 0n, holdAndWin: 0n, interactive: 0n };
  const symbolStats: Record<string, SymbolHitStats> = {};
  const symbolStatWins: Record<string, bigint> = {};
  const featureTriggers: Record<string, number> = {};
  const histogramRounds = WIN_HISTOGRAM_BUCKETS.map(() => 0);
  const histogramWins = WIN_HISTOGRAM_BUCKETS.map(() => 0n);
  const digest = createHash("sha256");
  const progressEvery = Math.max(1, hooks.progressEveryRounds ?? 10_000);
  let totalWin = 0n;
  let hits = 0;
  let maxMultiplier = 0;
  let multiplierSum = 0;
  let multiplierSquares = 0;
  for (let round = 0; round < rounds; round += 1) {
    if (round % progressEvery === 0) {
      if (hooks.signal?.aborted) throw new SimulationCancelledError();
      if (round > 0) hooks.onProgress?.(round, rounds);
    }
    const computation = await engine.spin(game, {
      roundId: `simulation-${round}`, playerId: "simulation", betUnits, featureState,
      ...(options.purchasedFeatureId ? { purchasedFeatureId: options.purchasedFeatureId } : {}),
      ...(options.anteBet ? { anteBet: true } : {}),
    }, rng);
    let result = computation.result;
    if (computation.continuation) result = engine.resolveAction(computation.continuation, computation.continuation.action.id, computation.continuation.action.choices[0]!.id);
    Object.assign(featureState, result.featureState);
    const win = BigInt(result.totalWinUnits);
    totalWin += win;
    if (win > 0n) hits += 1;
    const multiplier = Number(win) / Number(costUnits);
    maxMultiplier = Math.max(maxMultiplier, multiplier);
    multiplierSum += multiplier;
    multiplierSquares += multiplier * multiplier;
    const bucket = histogramBucketIndex(multiplier);
    histogramRounds[bucket] = (histogramRounds[bucket] ?? 0) + 1;
    histogramWins[bucket] = (histogramWins[bucket] ?? 0n) + win;
    let roundFreeSpins = 0n;
    let roundHoldAndWin = 0n;
    let roundInteractive = 0n;
    for (const event of result.events) {
      eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
      if (event.type === "win" && typeof event.data.payoutUnits === "string") {
        const payout = BigInt(event.data.payoutUnits);
        sourceWins.evaluated! += payout;
        if (typeof event.data.symbolId === "string") {
          symbolWins[event.data.symbolId] = (symbolWins[event.data.symbolId] ?? 0n) + payout;
          const stats = symbolStats[event.data.symbolId] ??= { hits: 0, winUnits: "0", countDistribution: {} };
          stats.hits += 1;
          symbolStatWins[event.data.symbolId] = (symbolStatWins[event.data.symbolId] ?? 0n) + payout;
          if (typeof event.data.count === "number") stats.countDistribution[String(event.data.count)] = (stats.countDistribution[String(event.data.count)] ?? 0) + 1;
        }
      }
      if (event.type === "feature-start" && typeof event.data.featureId === "string") featureTriggers[event.data.featureId] = (featureTriggers[event.data.featureId] ?? 0) + 1;
      if (event.type === "free-spins-end" && typeof event.data.totalWinUnits === "string") { const units = BigInt(event.data.totalWinUnits); sourceWins.freeSpins! += units; roundFreeSpins += units; }
      if (event.type === "hold-win-end" && typeof event.data.awardUnits === "string") { const units = BigInt(event.data.awardUnits); sourceWins.holdAndWin! += units; roundHoldAndWin += units; }
      if (event.type === "choice-resolved" && typeof event.data.awardUnits === "string") { const units = BigInt(event.data.awardUnits); sourceWins.interactive! += units; roundInteractive += units; }
    }
    // Subtraction keeps phases exact: per-event win payouts are pre-multiplier, but the round
    // total and the feature-end totals are both post-multiplier, so base falls out cleanly.
    phaseWins.freeSpins += roundFreeSpins;
    phaseWins.holdAndWin += roundHoldAndWin;
    phaseWins.interactive += roundInteractive;
    phaseWins.base += win - roundFreeSpins - roundHoldAndWin - roundInteractive;
    digest.update(result.outcomeHash);
  }
  hooks.onProgress?.(rounds, rounds);
  for (const [symbolId, units] of Object.entries(symbolStatWins)) symbolStats[symbolId]!.winUnits = units.toString();
  const totalBet = costUnits * BigInt(rounds);
  const mean = multiplierSum / rounds;
  const variance = Math.max(0, multiplierSquares / rounds - mean * mean);
  const standardDeviation = Math.sqrt(variance);
  const rtpBps = Number(totalWin * 10000n / totalBet);
  const error = 2.576 * standardDeviation / Math.sqrt(rounds) * 10000;
  const featureStats: Record<string, FeatureStats> = {};
  for (const [featureId, triggers] of Object.entries(featureTriggers)) featureStats[featureId] = { triggers, totalWinUnits: "0" };
  const lifecycles: Array<[string, string, WinPhase]> = [["free-spins", "free-spins-start", "freeSpins"], ["hold-and-win", "hold-win-start", "holdAndWin"], ["pick-and-click-bonus", "choice-required", "interactive"]];
  for (const [featureId, startEvent, phase] of lifecycles) {
    const triggers = eventCounts[startEvent] ?? 0;
    if (triggers > 0 || phaseWins[phase] > 0n) featureStats[featureId] = { triggers, totalWinUnits: phaseWins[phase].toString() };
  }
  return {
    runtimeEvidenceVersion: RUNTIME_EVIDENCE_VERSION, mathHash: hashMathContract(game), rounds, seed, betUnits, totalBetUnits: totalBet.toString(), totalWinUnits: totalWin.toString(),
    rtpBps, hitRateBps: Math.round(hits / rounds * 10000), hitCount: hits,
    featureEventCounts: eventCounts, winUnitsBySource: Object.fromEntries(Object.entries(sourceWins).map(([key, value]) => [key, value.toString()])),
    winUnitsBySymbol: Object.fromEntries(Object.entries(symbolWins).map(([key, value]) => [key, value.toString()])),
    winUnitsByPhase: Object.fromEntries(WIN_PHASES.map((phase) => [phase, phaseWins[phase].toString()])) as Record<WinPhase, string>,
    rtpBpsByPhase: Object.fromEntries(WIN_PHASES.map((phase) => [phase, Number(phaseWins[phase] * 10000n / totalBet)])) as Record<WinPhase, number>,
    winMultiplierHistogram: WIN_HISTOGRAM_BUCKETS.map((bucket, index) => ({ label: bucket.label, maxMultiplier: bucket.maxMultiplier, rounds: histogramRounds[index]!, winUnits: histogramWins[index]!.toString() })),
    symbolStats, featureStats,
    maxObservedMultiplier: maxMultiplier, variance, standardDeviation,
    confidence99Bps: [Math.max(0, Math.round(rtpBps - error)), Math.round(rtpBps + error)],
    multiplierSum, multiplierSquares,
    deterministicDigest: digest.digest("hex"),
  };
}

function mergeBigIntRecords(reports: FullSimulationReport[], key: "winUnitsBySource" | "winUnitsBySymbol"): Record<string, string> {
  const merged: Record<string, bigint> = {};
  for (const report of reports) for (const [name, value] of Object.entries(report[key])) merged[name] = (merged[name] ?? 0n) + BigInt(value);
  return Object.fromEntries(Object.entries(merged).map(([name, value]) => [name, value.toString()]));
}

function mergeSymbolStats(reports: FullSimulationReport[]): Record<string, SymbolHitStats> {
  const merged: Record<string, SymbolHitStats> = {};
  const wins: Record<string, bigint> = {};
  for (const report of reports) for (const [symbolId, stats] of Object.entries(report.symbolStats)) {
    const target = merged[symbolId] ??= { hits: 0, winUnits: "0", countDistribution: {} };
    target.hits += stats.hits;
    wins[symbolId] = (wins[symbolId] ?? 0n) + BigInt(stats.winUnits);
    for (const [count, occurrences] of Object.entries(stats.countDistribution)) target.countDistribution[count] = (target.countDistribution[count] ?? 0) + occurrences;
  }
  for (const [symbolId, units] of Object.entries(wins)) merged[symbolId]!.winUnits = units.toString();
  return merged;
}

function mergeFeatureStats(reports: FullSimulationReport[]): Record<string, FeatureStats> {
  const merged: Record<string, FeatureStats> = {};
  const wins: Record<string, bigint> = {};
  for (const report of reports) for (const [featureId, stats] of Object.entries(report.featureStats)) {
    const target = merged[featureId] ??= { triggers: 0, totalWinUnits: "0" };
    target.triggers += stats.triggers;
    wins[featureId] = (wins[featureId] ?? 0n) + BigInt(stats.totalWinUnits);
  }
  for (const [featureId, units] of Object.entries(wins)) merged[featureId]!.totalWinUnits = units.toString();
  return merged;
}

interface WorkerEnvelope { type?: "progress" | "result"; roundsDone?: number; report?: FullSimulationReport; }

export async function simulateGameParallel(game: GameConfig, rounds: number, workers = 4, seed = 1, betUnits = "100", options: SimulationOptions = {}, hooks: SimulationHooks = {}): Promise<FullSimulationReport> {
  const workerCount = Math.max(1, Math.min(Math.floor(workers), rounds));
  if (workerCount === 1) return simulateGame(game, rounds, seed, betUnits, options, hooks);
  const base = Math.floor(rounds / workerCount);
  const remainder = rounds % workerCount;
  const workerRefs: Worker[] = [];
  const perWorkerDone: number[] = new Array<number>(workerCount).fill(0);
  let lastEmit = 0;
  const emitProgress = (force = false) => {
    const now = Date.now();
    if (!force && now - lastEmit < 250) return;
    lastEmit = now;
    hooks.onProgress?.(Math.min(rounds, perWorkerDone.reduce((total, done) => total + done, 0)), rounds);
  };
  const onAbort = () => { for (const worker of workerRefs) void worker.terminate(); };
  hooks.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const reports = await Promise.all(Array.from({ length: workerCount }, (_, index) => new Promise<FullSimulationReport>((resolve, reject) => {
      if (hooks.signal?.aborted) { reject(new SimulationCancelledError()); return; }
      const worker = new Worker(new URL("./simulation-worker.js", import.meta.url), {
        workerData: { game, rounds: base + (index < remainder ? 1 : 0), seed: seed + index * 1_000_003, betUnits, options },
      });
      workerRefs.push(worker);
      worker.on("message", (message) => {
        const envelope = message as WorkerEnvelope;
        if (envelope.type === "progress") { perWorkerDone[index] = envelope.roundsDone ?? 0; emitProgress(); return; }
        // A message without a type is a final report from a stale compiled worker (legacy protocol).
        resolve(envelope.type === "result" ? envelope.report! : message as FullSimulationReport);
      });
      worker.once("error", reject);
      worker.once("exit", (code) => { if (hooks.signal?.aborted) reject(new SimulationCancelledError()); else if (code !== 0) reject(new Error(`Simulation worker exited with ${code}`)); });
    })));
    const totalBet = reports.reduce((total, report) => total + BigInt(report.totalBetUnits), 0n);
    const totalWin = reports.reduce((total, report) => total + BigInt(report.totalWinUnits), 0n);
    const hitCount = reports.reduce((total, report) => total + report.hitCount, 0);
    const multiplierSum = reports.reduce((total, report) => total + report.multiplierSum, 0);
    const multiplierSquares = reports.reduce((total, report) => total + report.multiplierSquares, 0);
    const mean = multiplierSum / rounds;
    const variance = Math.max(0, multiplierSquares / rounds - mean * mean);
    const standardDeviation = Math.sqrt(variance);
    const rtpBps = Number(totalWin * 10000n / totalBet);
    const error = 2.576 * standardDeviation / Math.sqrt(rounds) * 10000;
    const eventCounts: Record<string, number> = {};
    for (const report of reports) for (const [type, count] of Object.entries(report.featureEventCounts)) eventCounts[type] = (eventCounts[type] ?? 0) + count;
    const phaseWins = Object.fromEntries(WIN_PHASES.map((phase) => [phase, reports.reduce((total, report) => total + BigInt(report.winUnitsByPhase[phase]), 0n)])) as Record<WinPhase, bigint>;
    const digest = createHash("sha256");
    reports.forEach((report) => digest.update(report.deterministicDigest));
    emitProgress(true);
    return {
      runtimeEvidenceVersion: RUNTIME_EVIDENCE_VERSION, mathHash: hashMathContract(game), rounds, seed, betUnits, totalBetUnits: totalBet.toString(), totalWinUnits: totalWin.toString(), rtpBps,
      hitRateBps: Math.round(hitCount / rounds * 10000), hitCount, featureEventCounts: eventCounts,
      winUnitsBySource: mergeBigIntRecords(reports, "winUnitsBySource"), winUnitsBySymbol: mergeBigIntRecords(reports, "winUnitsBySymbol"),
      winUnitsByPhase: Object.fromEntries(WIN_PHASES.map((phase) => [phase, phaseWins[phase].toString()])) as Record<WinPhase, string>,
      rtpBpsByPhase: Object.fromEntries(WIN_PHASES.map((phase) => [phase, Number(phaseWins[phase] * 10000n / totalBet)])) as Record<WinPhase, number>,
      winMultiplierHistogram: WIN_HISTOGRAM_BUCKETS.map((bucket, index) => ({
        label: bucket.label, maxMultiplier: bucket.maxMultiplier,
        rounds: reports.reduce((total, report) => total + (report.winMultiplierHistogram[index]?.rounds ?? 0), 0),
        winUnits: reports.reduce((total, report) => total + BigInt(report.winMultiplierHistogram[index]?.winUnits ?? "0"), 0n).toString(),
      })),
      symbolStats: mergeSymbolStats(reports), featureStats: mergeFeatureStats(reports),
      maxObservedMultiplier: Math.max(...reports.map((report) => report.maxObservedMultiplier)), variance, standardDeviation,
      confidence99Bps: [Math.max(0, Math.round(rtpBps - error)), Math.round(rtpBps + error)], multiplierSum, multiplierSquares,
      deterministicDigest: digest.digest("hex"),
    };
  } finally {
    hooks.signal?.removeEventListener("abort", onAbort);
  }
}
