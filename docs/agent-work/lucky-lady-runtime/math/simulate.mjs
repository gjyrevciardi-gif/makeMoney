// Complete-round simulator. It calls the same pure engine the tests reference.
// A run either completes or fails; feature chains are never truncated or dropped.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRules, createRng, playRound, canonicalHash } from './engine.mjs';
import { readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));

export function run({ profile, rounds, seed, bet = 1, lines = 10, maxFeatureSpins = 20000 }) {
  const rules = loadRules();
  const rng = createRng(seed);
  const m = {
    rounds: 0, wager: 0, total: 0, base: 0, scatter: 0, feature: 0,
    winningRounds: 0, triggerRounds: 0, retriggers: 0, freeSpins: 0,
    lineWinRounds: 0, scatterWinRounds: 0, squares: 0, maxRoundReturn: 0,
    maxFeatureSpins: 0,
  };
  const started = Date.now();
  for (let i = 0; i < rounds; i++) {
    const round = playRound(rules, profile, { bet, lines, rng, maxFeatureSpins });
    const wager = round.wager;
    const r = round.totalWin / wager;
    m.rounds++; m.wager += wager; m.total += round.totalWin;
    m.base += round.mainEval.baseWin; m.scatter += round.mainEval.scatterWin;
    m.feature += round.feature.win;
    m.squares += r * r;
    if (round.totalWin > 0) m.winningRounds++;
    if (round.mainEval.lineWins.length) m.lineWinRounds++;
    if (round.mainEval.scatterWin > 0) m.scatterWinRounds++;
    if (round.mainEval.scatterCount >= 3) m.triggerRounds++;
    m.retriggers += round.feature.retriggers;
    m.freeSpins += round.feature.spins;
    if (round.feature.spins > m.maxFeatureSpins) m.maxFeatureSpins = round.feature.spins;
    if (r > m.maxRoundReturn) m.maxRoundReturn = r;
  }
  const n = m.rounds;
  const mean = m.total / m.wager;
  const meanR = m.total / (bet*lines) / n;
  const variance = m.squares / n - meanR * meanR;
  const stderr = Math.sqrt(Math.max(0, variance) / n);
  const z = 1.959963984540054;
  return {
    profileId: profile?.id ?? 'RAW-UNIFORM-ORIGINAL-STRIPS',
    profileHash: profile ? canonicalHash(profile) : null,
    evaluator: rules.evaluator,
    sourceHashes: rules.provenance,
    seed, bet, lines, rounds: n,
    wager: m.wager, totalReturn: m.total,
    rtpPercent: mean * 100,
    rtpStderrPercent: stderr * 100,
    rtpCi95Percent: [(mean - z * stderr) * 100, (mean + z * stderr) * 100],
    baseReturn: m.base, baseContributionPercent: m.base / m.wager * 100,
    scatterReturn: m.scatter, scatterContributionPercent: m.scatter / m.wager * 100,
    featureReturn: m.feature, featureContributionPercent: m.feature / m.wager * 100,
    hitRatePercent: m.winningRounds / n * 100,
    lineHitRatePercent: m.lineWinRounds / n * 100,
    scatterPayRatePercent: m.scatterWinRounds / n * 100,
    featureTriggerRatePercent: m.triggerRounds / n * 100,
    retriggerRatePercent: m.retriggers / n * 100,
    freeSpinsPerRound: m.freeSpins / n,
    maxFeatureSpinsInRound: m.maxFeatureSpins,
    maxRoundReturnX: m.maxRoundReturn,
    varianceOfRoundReturn: variance,
    sumSquares: m.squares,
    sumWager: m.wager,
    houseEdgePercent: 100 - mean * 100,
    gamble: 'excluded: the original gamble is a separate post-win double-or-nothing; it never changes board generation',
    seconds: (Date.now() - started) / 1000,
  };
}

if (process.argv[1] && process.argv[1].endsWith('simulate.mjs')) {
  const opts = Object.fromEntries(process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => { const i = a.indexOf('='); return [a.slice(2, i), a.slice(i + 1)]; }));
  const profilePath = opts.profile && opts.profile !== 'raw' ? opts.profile : null;
  const profile = profilePath ? JSON.parse(readFileSync(profilePath, 'utf8')) : null;
  const result = run({
    profile,
    rounds: Number(opts.rounds ?? 1000000),
    seed: opts.seed ?? 'raw-1',
    bet: Number(opts.bet ?? 1),
    lines: Number(opts.lines ?? 10),
  });
  const out = opts.out ? join(HERE, 'runs', opts.out) : null;
  if (out) writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
  console.log(JSON.stringify({
    profileId: result.profileId, rounds: result.rounds, seed: result.seed,
    rtpPercent: Math.round(result.rtpPercent * 10000) / 10000,
    rtpCi95Percent: result.rtpCi95Percent.map((v) => Math.round(v * 10000) / 10000),
    base: Math.round(result.baseContributionPercent * 100) / 100,
    scatter: Math.round(result.scatterContributionPercent * 100) / 100,
    feature: Math.round(result.featureContributionPercent * 100) / 100,
    hitRate: Math.round(result.hitRatePercent * 100) / 100,
    triggerRate: Math.round(result.featureTriggerRatePercent * 10000) / 10000,
    retriggerPerRound: Math.round(result.retriggerRatePercent * 10000) / 10000,
    freeSpinsPerRound: Math.round(result.freeSpinsPerRound * 10000) / 10000,
    maxRoundReturnX: Math.round(result.maxRoundReturnX * 100) / 100,
    seconds: result.seconds,
  }, null, 1));
}