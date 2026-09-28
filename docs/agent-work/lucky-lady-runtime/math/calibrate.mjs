// Calibration: legitimate PRE-OUTCOME stop weighting only. No category selection,
// no payout rejection, no forced loss, no financial/history feedback.
// The model is standard slot reel weighting: each reel keeps its original symbol
// sequence, and each stop is weighted by whether that reel's already-published
// symbol window lies inside the reel's designated symbol set. Nothing here looks
// at a drawn outcome.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRules, reelKeys } from './engine.mjs';
import { run } from './simulate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const rules = loadRules();

// Fixed per-reel preferred window families, chosen from windows that actually occur in
// the pinned strips. Adjacent reels use disjoint symbol families, so the weighting only
// changes how often each reel publishes a given symbol mix. Every symbol (including the
// wild and the scatter) keeps non-zero probability on every reel, so every feature stays
// possible. Weights are computed from the strip before any draw.
export const REEL_WINDOW_SETS = {
  reelStrip1: ['9', 'K', 'Q'],
  reelStrip2: ['P_2', 'P_5', 'P_6'],
  reelStrip3: ['9', 'J', 'P_3'],
  reelStrip4: ['P_1', 'P_4', 'Q'],
  reelStrip5: ['K', 'P_2', 'P_6'],
};

export function buildProfile(preferredWeight, otherWeight = 1) {
  const stopWeights = {};
  for (const key of reelKeys(rules)) {
    const strip = rules.reels[key];
    const stops = strip.length - 2;
    const set = REEL_WINDOW_SETS[key];
    stopWeights[key] = Array.from({ length: stops }, (_, i) => {
      const window = strip.slice(i, i + 3);
      return window.every((s) => set.includes(s)) ? preferredWeight : otherWeight;
    });
  }
  return {
    schema: 1,
    id: 'lucky-lady.rtp50.v1',
    game: 'LuckyLadysCharmDX',
    evaluator: rules.evaluator,
    targetRtpPercent: 50,
    validatedBet: 1,
    validatedLines: 10,
    weightScheme: {
      description: 'Fixed per-reel stop weighting over the ORIGINAL strips. A stop is weighted preferredWeight when its three published symbols all belong to that reel\'s designated window family, otherwise 1. Families are disjoint between adjacent reels. Weights are fixed before the spin; the original reels, paylines, paytable, wild, scatter, 15-spin award, x3 feature multiplier and retrigger rule are unchanged, and no draw, balance, bank or history value is consulted.',
      reelWindowFamilies: REEL_WINDOW_SETS,
      preferredWeight,
      otherWeight,
    },
    stopWeights,
  };
}

export function preferredWindowCounts() {
  const counts = {};
  for (const key of reelKeys(rules)) {
    const strip = rules.reels[key];
    const set = REEL_WINDOW_SETS[key];
    let n = 0;
    for (let i = 0; i <= strip.length - 3; i++) {
      if (strip.slice(i, i + 3).every((s) => set.includes(s))) n++;
    }
    counts[key] = { preferredStops: n, totalStops: strip.length - 2 };
  }
  return counts;
}
export function measure(preferredWeight, rounds, seed, otherWeight = 1) {
  return run({ profile: buildProfile(preferredWeight, otherWeight), rounds, seed });
}

if (process.argv.includes('--scan')) {
  const trials = [];
  const scan = (process.argv.find((a) => a.startsWith('--values=')) || '--values=2,4,8,16,24,32,48,64,96,128,192,256').split('=')[1].split(',').map(Number);
  const rounds = Number((process.argv.find((a) => a.startsWith('--rounds=')) || '--rounds=100000').split('=')[1]);
  const tag = (process.argv.find((a) => a.startsWith('--tag=')) || '--tag=scan').split('=')[1];
  const other = Number((process.argv.find((a) => a.startsWith('--other=')) || '--other=1').split('=')[1]);
  for (const M of scan) {
    let r;
    try { r = measure(Math.round(M * other), rounds, `${tag}-${M}`, other); }
    catch (error) {
      trials.push({ effectiveWeight: M, rounds, infeasible: String(error.message) });
      console.log(`M=${M} INFEASIBLE: ${error.message}`);
      continue;
    }
    trials.push({ effectiveWeight: M, preferredWeight: Math.round(M * other), otherWeight: other, rounds: r.rounds, rtpPercent: r.rtpPercent, ci: r.rtpCi95Percent, base: r.baseContributionPercent, scatter: r.scatterContributionPercent, feature: r.featureContributionPercent, triggerRate: r.featureTriggerRatePercent });
    console.log(`M=${M} rtp=${r.rtpPercent.toFixed(4)} ci=[${r.rtpCi95Percent.map((v) => v.toFixed(3)).join(',')}] base=${r.baseContributionPercent.toFixed(2)} feat=${r.featureContributionPercent.toFixed(2)} trig=${r.featureTriggerRatePercent.toFixed(4)}`);
  }
  writeFileSync(join(HERE, 'runs', `calibration-${tag}.json`), JSON.stringify({ method: 'reel-set stop weighting scan', rounds_per_trial: rounds, trials }, null, 1));
}