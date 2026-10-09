// Fresh RTP regression through the SAME runtime-math module and frozen profile.
// Deterministic injection is offline-only and never reachable from the HTTP entry point.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadVerifiedMath, createDeterministicRng, generateCompleteRound, SUPPORTED_LINES, FROZEN_PROFILE_HASH } from './runtime-math.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'runs', 'rtp-regression.json');
mkdirSync(dirname(OUT), { recursive: true });

const opts = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const i = a.indexOf('='); return [a.slice(2, i), a.slice(i + 1)];
}));
const seeds = (opts.seeds || 'runtime-rtp-a,runtime-rtp-b,runtime-rtp-c,runtime-rtp-d').split(',');
const roundsPerSeed = Number(opts.rounds || 1000000);
const bet = Number(opts.bet || 1);

const { profile } = loadVerifiedMath();
if (profile.canonicalHash !== FROZEN_PROFILE_HASH) throw new Error('frozen profile hash mismatch');

const batches = [];
for (const seed of seeds) {
  const rng = createDeterministicRng(seed);
  let wager = 0; let total = 0; let base = 0; let feature = 0; let squares = 0;
  let wins = 0; let triggers = 0; let retriggers = 0; let freeSpins = 0; let maxRound = 0;
  const started = Date.now();
  for (let i = 0; i < roundsPerSeed; i++) {
    const { round } = generateCompleteRound({ rng, bet, lines: SUPPORTED_LINES });
    const stake = bet * SUPPORTED_LINES;
    const r = round.totalWin / stake;
    wager += stake; total += round.totalWin; base += round.mainEval.totalWin; feature += round.feature.win;
    squares += r * r;
    if (round.totalWin > 0) wins++;
    if (round.feature.spins > 0) triggers++;
    retriggers += round.feature.retriggers;
    freeSpins += round.feature.spins;
    if (r > maxRound) maxRound = r;
  }
  const mean = total / wager;
  const meanX = total / (bet * SUPPORTED_LINES) / roundsPerSeed;
  const variance = squares / roundsPerSeed - meanX * meanX;
  const stderr = Math.sqrt(Math.max(0, variance) / roundsPerSeed);
  batches.push({
    seed, rounds: roundsPerSeed, wager, return: total, baseReturn: base, featureReturn: feature,
    rtpPercent: mean * 100, stderrPercent: stderr * 100,
    hitRatePercent: wins / roundsPerSeed * 100,
    triggerRatePercent: triggers / roundsPerSeed * 100,
    freeSpins, retriggers, maxRoundReturnX: maxRound,
    seconds: (Date.now() - started) / 1000,
    sumSquares: squares,
  });
  console.log(`seed=${seed} rounds=${roundsPerSeed} rtp=${(mean * 100).toFixed(4)} trig=${(triggers / roundsPerSeed * 100).toFixed(4)}`);
}

const totalRounds = batches.reduce((a, b) => a + b.rounds, 0);
const totalWager = batches.reduce((a, b) => a + b.wager, 0);
const totalReturn = batches.reduce((a, b) => a + b.return, 0);
const totalSquares = batches.reduce((a, b) => a + b.sumSquares, 0);
const meanX = totalReturn / (bet * SUPPORTED_LINES) / totalRounds;
const variance = totalSquares / totalRounds - meanX * meanX;
const stderr = Math.sqrt(Math.max(0, variance) / totalRounds);
const rtp = totalReturn / totalWager * 100;
const z = 1.959963984540054;
const ci = [rtp - z * stderr * 100, rtp + z * stderr * 100];
const result = {
  phase: 'fresh runtime RTP regression (same runtime-math module and frozen profile)',
  runId: 'runtime-rtp-' + new Date().toISOString(),
  profileId: profile.id,
  profileCanonicalHash: profile.canonicalHash,
  evaluatorId: profile.evaluator,
  lines: SUPPORTED_LINES,
  bet,
  seeds, roundsPerSeed, totalRounds,
  totalWager, totalReturn,
  baseReturn: batches.reduce((a, b) => a + b.baseReturn, 0),
  featureReturn: batches.reduce((a, b) => a + b.featureReturn, 0),
  freeSpins: batches.reduce((a, b) => a + b.freeSpins, 0),
  retriggers: batches.reduce((a, b) => a + b.retriggers, 0),
  observedRtpPercent: rtp,
  observedStderrPercent: stderr * 100,
  observedCi95Percent: ci,
  gate: '49.5 .. 50.5',
  gatePass: rtp >= 49.5 && rtp <= 50.5,
  gambleExcluded: 'gamble is a separate post-win double-or-nothing and is not part of slot RTP',
  batches,
};
writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n');
console.log(JSON.stringify({ totalRounds, observedRtpPercent: rtp, ci, gatePass: result.gatePass, seconds: batches.reduce((a, b) => a + b.seconds, 0) }, null, 1));