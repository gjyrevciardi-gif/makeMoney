import type { FeatureSelection, GameConfig, PaytableEntry } from "@slot-skills/schema";
import { evaluateGrid } from "./evaluators.js";
import type { Grid } from "./grid.js";

export type PredictionQuality = "exact" | "hybrid-provisional" | "hybrid-refined";

export interface PredictionComponent {
  id: string;
  label: string;
  method: "closed-form" | "dynamic-program" | "enumeration" | "control-variate" | "residual";
  rtpBps: number;
  errorBoundBps: number;
  triggerBps?: number;
  conditionalMeanMultiplier?: number;
}

export interface MathPredictionReport {
  version: "1.0";
  configurationDigest: string;
  betUnits: string;
  quality: PredictionQuality;
  rtpBps: number;
  rtpIntervalBps: [number, number];
  hitRateBps: number;
  variance: number;
  standardDeviation: number;
  phaseRtpBps: { base: number; freeSpins: number; holdAndWin: number; interactive: number };
  triggerBps: number;
  conditionalFeatureMultiplier: number;
  maxWinProbability: number;
  capAdjustmentBps: number;
  roundingAdjustmentBps: number;
  components: PredictionComponent[];
  warnings: string[];
  residual?: { rounds: number; seed: number; meanBps: number; error99Bps: number; digest: string };
  digest: string;
}

export interface PredictGameMathOptions {
  betUnits?: string;
  cachedResidual?: { meanBps: number; error99Bps: number; rounds: number; seed: number; digest: string };
}

export interface SolveGameMathTargets {
  rtpBps: number;
  volatility: "low" | "medium" | "high";
}

export interface MathSolveProposal {
  sourceDigest: string;
  update: { symbolWeights?: Record<string, number>; paytable: GameConfig["math"]["paytable"]; targets: GameConfig["math"]["targets"] };
  before: MathPredictionReport;
  after: MathPredictionReport;
  changes: Array<{ path: string; before: number; after: number }>;
  digest: string;
}

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
};

/** Small deterministic digest that is portable to browsers. Audited game locks still use SHA-256. */
export function predictiveDigest(value: unknown): string {
  const source = stable(value); let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) { hash ^= source.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const choose = (n: number, k: number): number => {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let index = 1; index <= Math.min(k, n - k); index += 1) result = result * (n - index + 1) / index;
  return result;
};
const binomial = (n: number, k: number, p: number): number => choose(n, k) * p ** k * (1 - p) ** (n - k);
const rows = (game: GameConfig): number[] => Array.isArray(game.layout.rows) ? [...game.layout.rows] : Array(game.layout.reels).fill(game.layout.rows) as number[];
const cells = (game: GameConfig): number => rows(game).reduce((sum, count) => sum + count, 0);
const enabled = (game: GameConfig, id: string): FeatureSelection | undefined => game.features.find((feature) => feature.enabled && feature.id === id);
const configNumber = (feature: FeatureSelection | undefined, key: string, fallback: number): number => {
  const value = feature?.config?.[key]; return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};
const totalWeight = (game: GameConfig): number => Object.values(game.math.symbolWeights ?? {}).reduce((sum, weight) => sum + weight, 0);
const probability = (game: GameConfig, symbolId: string): number => (game.math.symbolWeights?.[symbolId] ?? 0) / Math.max(1, totalWeight(game));
const payout = (entry: PaytableEntry | undefined, game: GameConfig): number => {
  if (!entry) return 0;
  const multiplier = Number(entry.payout.numerator) / Number(entry.payout.denominator);
  return entry.basis === "line-bet" ? multiplier / Math.max(1, game.math.paylines?.length ?? 1) : multiplier;
};
const entryFor = (game: GameConfig, symbolId: string, count: number): PaytableEntry | undefined =>
  game.math.paytable.filter((entry) => entry.symbolId === symbolId && entry.count <= count).sort((a, b) => b.count - a.count)[0];

interface BasePrediction { mean: number; hit: number; variance: number; method: PredictionComponent["method"]; exact: boolean; warnings: string[] }

function countPrediction(game: GameConfig): BasePrediction {
  const size = cells(game); let mean = 0; let hitMiss = 1; let second = 0;
  for (const symbol of game.symbols.filter((candidate) => candidate.kind !== "scatter" && candidate.kind !== "bonus")) {
    const p = probability(game, symbol.id); let symbolMean = 0; let symbolSecond = 0; let noWin = 0;
    for (let count = 0; count <= size; count += 1) {
      const chance = binomial(size, count, p); const win = payout(entryFor(game, symbol.id, count), game);
      symbolMean += chance * win; symbolSecond += chance * win * win; if (!win) noWin += chance;
    }
    mean += symbolMean; second += symbolSecond; hitMiss *= noWin;
  }
  // Symbol-count wins are dependent under a multinomial grid. The mean is exact; the variance
  // is a conservative independent-component estimate until the continuation residual refines it.
  return { mean, hit: 1 - hitMiss, variance: Math.max(0, second - mean * mean), method: "closed-form", exact: false, warnings: ["Pay-anywhere first-drop RTP is exact; its provisional variance omits multinomial covariance and cascade continuation."] };
}

function paylinePrediction(game: GameConfig): BasePrediction {
  const reelCount = game.layout.reels; const wild = game.symbols.find((symbol) => symbol.kind === "wild")?.id;
  const pw = wild ? probability(game, wild) : 0; let lineMean = 0; let lineHit = 0; let lineSecond = 0;
  for (const symbol of game.symbols.filter((candidate) => candidate.kind === "normal")) {
    const ps = probability(game, symbol.id);
    for (let leadingWilds = 0; leadingWilds < reelCount; leadingWilds += 1) {
      for (let length = leadingWilds + 1; length <= reelCount; length += 1) {
        const terminal = length === reelCount ? 1 : Math.max(0, 1 - ps - pw);
        const chance = pw ** leadingWilds * ps * (ps + pw) ** (length - leadingWilds - 1) * terminal;
        const win = payout(entryFor(game, symbol.id, length), game);
        lineMean += chance * win; lineSecond += chance * win * win; if (win) lineHit += chance;
      }
    }
  }
  if (wild) {
    const chance = pw ** reelCount; const win = payout(entryFor(game, wild, reelCount), game);
    lineMean += chance * win; lineSecond += chance * win * win; if (win) lineHit += chance;
  }
  const lineCount = game.math.paylines?.length ?? 1;
  const transformed = Boolean(enabled(game, "stacked-wilds") || enabled(game, "random-wilds") || enabled(game, "wild-reels"));
  return {
    mean: lineMean * lineCount, hit: 1 - (1 - lineHit) ** lineCount,
    variance: Math.max(0, lineSecond * lineCount - lineMean * lineMean * lineCount),
    method: "closed-form", exact: !transformed,
    warnings: transformed ? ["The provisional payline value excludes pre-evaluation wild transforms; refinement measures their residual."] : [],
  };
}

function waysPrediction(game: GameConfig): BasePrediction {
  const heights = rows(game); const wild = game.symbols.find((symbol) => symbol.kind === "wild")?.id;
  const pw = wild ? probability(game, wild) : 0; let mean = 0; let hitMiss = 1; let second = 0;
  for (const symbol of game.symbols.filter((candidate) => candidate.kind === "normal")) {
    const ps = probability(game, symbol.id); const q = ps + pw;
    const firstWays = heights[0]! * ps + heights[0]! * pw * (1 - (1 - ps) ** Math.max(0, heights[0]! - 1));
    let prefixWays = firstWays; let symbolHit = 0; let symbolSecond = 0;
    for (let length = 1; length <= game.layout.reels; length += 1) {
      if (length > 1) prefixWays *= heights[length - 1]! * q;
      const stop = length === game.layout.reels ? 1 : (1 - q) ** heights[length]!;
      const expectedWays = prefixWays * stop; const win = payout(entryFor(game, symbol.id, length), game);
      mean += expectedWays * win; symbolSecond += expectedWays * win * win; if (win) symbolHit += Math.min(1, expectedWays);
    }
    second += symbolSecond; hitMiss *= Math.max(0, 1 - Math.min(1, symbolHit));
  }
  const transformed = Boolean(enabled(game, "expanding-wilds") || enabled(game, "random-wilds") || enabled(game, "wild-reels"));
  return { mean, hit: 1 - hitMiss, variance: Math.max(0, second - mean * mean), method: "closed-form", exact: !transformed, warnings: transformed ? ["The provisional ways value excludes pre-evaluation wild transforms; refinement measures their residual."] : [] };
}

function sampledClusterPrediction(game: GameConfig, rounds = 4_096): BasePrediction {
  const weights = Object.entries(game.math.symbolWeights ?? {}); const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
  let state = 0x9e3779b9; const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0x1_0000_0000; };
  let sum = 0; let squares = 0; let hits = 0;
  for (let round = 0; round < rounds; round += 1) {
    const grid: Grid = rows(game).map((height) => Array.from({ length: height }, () => {
      let cursor = random() * total;
      for (const [symbol, weight] of weights) { if (cursor < weight) return symbol; cursor -= weight; }
      return weights.at(-1)?.[0] ?? "";
    }));
    const value = Number(evaluateGrid(game, grid, "100").totalWinUnits) / 100;
    sum += value; squares += value * value; if (value > 0) hits++;
  }
  const mean = sum / rounds;
  return { mean, hit: hits / rounds, variance: Math.max(0, squares / rounds - mean * mean), method: "enumeration", exact: false, warnings: [`Cluster first-drop value uses ${rounds.toLocaleString("en")} deterministic stratified samples; drop continuation is residual.`] };
}

function scatterDistribution(game: GameConfig): number[] {
  const scatter = game.symbols.find((symbol) => symbol.kind === "scatter")?.id ?? "scatter";
  if (game.math.outcomeGenerator === "weighted-grid") {
    const count = cells(game); const p = probability(game, scatter);
    return Array.from({ length: count + 1 }, (_, landed) => binomial(count, landed, p));
  }
  const perReel = (game.math.reelStrips ?? []).map((strip, reel) => {
    const distribution = Array(rows(game)[reel]! + 1).fill(0) as number[];
    for (let stop = 0; stop < strip.length; stop += 1) {
      let count = 0; for (let row = 0; row < rows(game)[reel]!; row++) if (strip[(stop + row) % strip.length] === scatter) count++;
      distribution[count]! += 1 / strip.length;
    }
    return distribution;
  });
  let result = [1];
  for (const reel of perReel) {
    const next = Array(result.length + reel.length - 1).fill(0) as number[];
    result.forEach((left, a) => reel.forEach((right, b) => next[a + b]! += left * right)); result = next;
  }
  return result;
}

function holdAndWinMean(game: GameConfig, initial: number): number {
  const feature = enabled(game, "hold-and-win"); if (!feature) return 0;
  const size = cells(game); const p = configNumber(feature, "hitBps", configNumber(feature, "hitChanceBps", 2200)) / 10_000;
  const maxRespins = Math.floor(configNumber(feature, "maxRespins", 50)); const reset = feature.config?.resetLivesOnHit !== false;
  const memo = new Map<string, number>();
  const visit = (filled: number, lives: number, step: number): number => {
    if (filled >= size || lives <= 0 || step >= maxRespins) return filled;
    const key = `${filled}:${lives}:${step}`; const saved = memo.get(key); if (saved !== undefined) return saved;
    const open = size - filled; let expected = 0;
    for (let landed = 0; landed <= open; landed++) {
      const chance = binomial(open, landed, p);
      expected += chance * visit(filled + landed, landed ? (reset ? Math.floor(configNumber(feature, "lives", 3)) : lives) : lives - 1, step + 1);
    }
    memo.set(key, expected); return expected;
  };
  const prizes = Array.isArray(feature.config?.prizes) ? feature.config.prizes as Array<{ score?: number; weight?: number }> : undefined;
  const prizeMean = prizes?.length ? prizes.reduce((sum, item) => sum + Number(item.score ?? 0) * Number(item.weight ?? 0), 0) / Math.max(1, prizes.reduce((sum, item) => sum + Number(item.weight ?? 0), 0)) : configNumber(feature, "coinMultiplier", 1);
  return visit(initial, Math.floor(configNumber(feature, "lives", 3)), 0) * prizeMean;
}

function pickMean(game: GameConfig): number {
  const feature = enabled(game, "pick-and-click-bonus"); if (!feature) return 0;
  const prizes = Array.isArray(feature.config?.prizes) ? feature.config.prizes as Array<{ score?: number; weight?: number }> : undefined;
  if (prizes?.length) return prizes.reduce((sum, item) => sum + Number(item.score ?? 0) * Number(item.weight ?? 0), 0) / Math.max(1, prizes.reduce((sum, item) => sum + Number(item.weight ?? 0), 0));
  const awards = Array.isArray(feature.config?.awards) ? feature.config.awards.filter((value): value is number => typeof value === "number") : [1, 2, 5];
  return awards.reduce((sum, value) => sum + value, 0) / Math.max(1, awards.length);
}

type PredictiveBonusId = "free-spins" | "hold-and-win" | "pick-and-click-bonus";
function activeBonus(game: GameConfig): PredictiveBonusId | undefined {
  return (["free-spins", "hold-and-win", "pick-and-click-bonus"] as PredictiveBonusId[]).find((id) => enabled(game, id));
}

export function predictGameMath(game: GameConfig, options: PredictGameMathOptions = {}): MathPredictionReport {
  const betUnits = options.betUnits ?? "100";
  const base = game.math.evaluator === "paylines" ? paylinePrediction(game) : game.math.evaluator === "ways" ? waysPrediction(game) : game.math.evaluator === "cluster" ? sampledClusterPrediction(game) : countPrediction(game);
  const scatter = scatterDistribution(game); const triggerFeature = enabled(game, "scatter-trigger");
  const required = Math.floor(configNumber(triggerFeature, "count", 3)); const trigger = scatter.slice(required).reduce((sum, chance) => sum + chance, 0);
  const scatterSymbol = game.symbols.find((symbol) => symbol.kind === "scatter")?.id ?? "scatter";
  let scatterMean = 0;
  scatter.forEach((chance, count) => scatterMean += chance * payout(entryFor(game, scatterSymbol, count), game));
  const bonus = activeBonus(game); let conditional = 0; let featureMethod: PredictionComponent["method"] = "closed-form";
  if (bonus === "free-spins") {
    const free = enabled(game, "free-spins"); const initial = Math.floor(configNumber(free, "spins", 8));
    const retrigger = enabled(game, "retriggering-free-spins"); const added = Math.floor(configNumber(retrigger, "spins", 3));
    const retriggerCount = Math.floor(configNumber(retrigger, "scatterCount", 3));
    const r = retrigger ? scatter.slice(retriggerCount).reduce((sum, chance) => sum + chance, 0) : 0;
    let states = new Map<number, number>([[initial, 1]]); let spinIndex = 0; let expectedValue = 0;
    while (states.size && spinIndex < 50) {
      const next = new Map<number, number>();
      for (const [remaining, chance] of states) {
        if (remaining <= 0) continue;
        const multiplier = enabled(game, "increasing-multipliers") ? spinIndex + 1 : 1;
        expectedValue += chance * (base.mean + scatterMean) * multiplier;
        const noRetrigger = remaining - 1;
        if (r > 0) next.set(noRetrigger + added, (next.get(noRetrigger + added) ?? 0) + chance * r);
        next.set(noRetrigger, (next.get(noRetrigger) ?? 0) + chance * (1 - r));
      }
      states = new Map([...next].filter(([remaining, chance]) => remaining > 0 && chance > 1e-14)); spinIndex++;
    }
    conditional = expectedValue; featureMethod = "dynamic-program";
  } else if (bonus === "hold-and-win") {
    let mean = 0;
    scatter.forEach((chance, count) => { if (count >= required) mean += chance / Math.max(trigger, Number.EPSILON) * holdAndWinMean(game, count); });
    conditional = mean; featureMethod = "dynamic-program";
  } else if (bonus === "pick-and-click-bonus") conditional = pickMean(game);
  const residual = options.cachedResidual; const baseRtp = (base.mean + scatterMean) * 10_000;
  const featureRtp = trigger * conditional * 10_000; const residualBps = residual?.meanBps ?? 0;
  const total = baseRtp + featureRtp + residualBps; const error = residual?.error99Bps ?? (base.exact && !residual ? 0 : Math.max(50, Math.round(Math.abs(total) * .05)));
  const phase = {
    base: Math.round(baseRtp), freeSpins: bonus === "free-spins" ? Math.round(featureRtp) : 0,
    holdAndWin: bonus === "hold-and-win" ? Math.round(featureRtp) : 0, interactive: bonus === "pick-and-click-bonus" ? Math.round(featureRtp) : 0,
  };
  const components: PredictionComponent[] = [
    { id: "base", label: "Base evaluation", method: base.method, rtpBps: Math.round(base.mean * 10_000), errorBoundBps: base.exact ? 0 : error },
    { id: "scatter", label: "Scatter pays", method: "closed-form", rtpBps: Math.round(scatterMean * 10_000), errorBoundBps: 0, triggerBps: Math.round(trigger * 10_000) },
  ];
  if (bonus) components.push({ id: bonus, label: bonus.replaceAll("-", " "), method: featureMethod, rtpBps: Math.round(featureRtp), errorBoundBps: base.exact ? 0 : error, triggerBps: Math.round(trigger * 10_000), conditionalMeanMultiplier: conditional });
  if (residual) components.push({ id: "residual", label: "Continuation residual", method: "control-variate", rtpBps: Math.round(residual.meanBps), errorBoundBps: residual.error99Bps });
  const configurationDigest = predictiveDigest({ math: game.math, features: game.features });
  const report: MathPredictionReport = {
    version: "1.0", configurationDigest, betUnits,
    quality: residual ? "hybrid-refined" : base.exact ? "exact" : "hybrid-provisional",
    rtpBps: Math.round(total), rtpIntervalBps: [Math.round(total - error), Math.round(total + error)],
    hitRateBps: Math.round((1 - (1 - base.hit) * (1 - trigger)) * 10_000),
    variance: base.variance, standardDeviation: Math.sqrt(Math.max(0, base.variance)),
    phaseRtpBps: phase, triggerBps: Math.round(trigger * 10_000), conditionalFeatureMultiplier: conditional,
    maxWinProbability: 0, capAdjustmentBps: 0, roundingAdjustmentBps: 0, components,
    warnings: [...base.warnings, ...(game.math.maxCascades && game.math.maxCascades > 1 ? ["Cascade/drop continuation requires residual refinement."] : [])],
    ...(residual ? { residual: { rounds: residual.rounds, seed: residual.seed, meanBps: residual.meanBps, error99Bps: residual.error99Bps, digest: residual.digest } } : {}),
    digest: "",
  };
  report.digest = predictiveDigest({ ...report, digest: undefined }); return report;
}

const rational = (value: number): { numerator: string; denominator: string } => {
  const precision = 1_000_000;
  const scaled = Math.max(1, Math.round(value * precision)); const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const divisor = gcd(scaled, precision); return { numerator: String(scaled / divisor), denominator: String(precision / divisor) };
};

export function solveGameMath(source: GameConfig, targets: SolveGameMathTargets): MathSolveProposal {
  if (!Number.isInteger(targets.rtpBps) || targets.rtpBps < 1 || targets.rtpBps > 11_000) throw new Error("Target RTP must be an integer from 1 to 11000 basis points");
  const before = predictGameMath(source); const candidate = structuredClone(source);
  const entries = candidate.math.paytable; const multipliers = entries.map((entry) => Number(entry.payout.numerator) / Number(entry.payout.denominator));
  const sorted = [...multipliers].sort((a, b) => a - b); const median = sorted[Math.floor(sorted.length / 2)] ?? 1;
  const tilt = targets.volatility === "low" ? .72 : targets.volatility === "high" ? 1.28 : 1;
  entries.forEach((entry, index) => {
    const current = multipliers[index]!;
    entry.payout = rational(current * Math.max(.25, (current / Math.max(.01, median)) ** (tilt - 1)));
  });
  let after = predictGameMath(candidate);
  for (let pass = 0; pass < 24 && Math.abs(after.rtpBps - targets.rtpBps) > 0; pass += 1) {
    const scale = targets.rtpBps / Math.max(1, after.rtpBps);
    entries.forEach((entry) => { const current = Number(entry.payout.numerator) / Number(entry.payout.denominator); entry.payout = rational(current * scale); });
    // Restore monotonic count tiers for each symbol.
    for (const symbol of new Set(entries.map((entry) => entry.symbolId))) {
      let floor = 0;
      for (const entry of entries.filter((item) => item.symbolId === symbol).sort((a, b) => a.count - b.count)) {
        const current = Number(entry.payout.numerator) / Number(entry.payout.denominator); floor = Math.max(floor, current); entry.payout = rational(floor);
      }
    }
    after = predictGameMath(candidate); if (Math.abs(after.rtpBps - targets.rtpBps) <= (after.quality === "exact" ? 1 : 25)) break;
  }
  candidate.math.targets.rtpBps = targets.rtpBps; candidate.math.targets.volatility = targets.volatility;
  const changes = candidate.math.paytable.map((entry, index) => ({
    path: `math.paytable.${entry.symbolId}.${entry.count}`, before: multipliers[index]!,
    after: Number(entry.payout.numerator) / Number(entry.payout.denominator),
  })).filter((change) => change.before !== change.after);
  const sourceDigest = predictiveDigest({ math: source.math, features: source.features });
  const update = { ...(candidate.math.symbolWeights ? { symbolWeights: { ...candidate.math.symbolWeights } } : {}), paytable: structuredClone(candidate.math.paytable), targets: structuredClone(candidate.math.targets) };
  return { sourceDigest, update, before, after, changes, digest: predictiveDigest({ sourceDigest, update, after: after.digest }) };
}
