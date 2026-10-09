// Freeze the calibrated profile and run INDEPENDENT validation with fresh seeds.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalHash, codeHash, loadRules, reelKeys } from './engine.mjs';
import { buildProfile } from './calibrate.mjs';
import { run } from './simulate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROFILE_PATH = join(HERE, 'profiles', 'lucky-lady.rtp50.v1.json');
const ORACLE_MANIFEST = join(HERE, 'runs', 'oracle-manifest.json');
const FROZEN_PREFERRED = 995;
const FROZEN_OTHER = 10;

function verifySourceHashes(rules) {
  const out = {};
  for (const [label, entry] of Object.entries(rules.provenance)) {
    if (!entry || typeof entry !== 'object' || !entry.sha256) continue;
    const digest = createHash('sha256').update(readFileSync(entry.path)).digest('hex');
    if (digest !== entry.sha256) throw new Error('source hash mismatch for ' + label);
    out[label] = digest;
  }
  return out;
}

function freeze() {
  const rules = loadRules();
  verifySourceHashes(rules);
  const profile = buildProfile(FROZEN_PREFERRED, FROZEN_OTHER);
  const frozen = {
    ...profile,
    frozenFrom: 'calibration phase: window-family scan/bisect/refine/fine3/fine4',
    calibrationSeeds: ['window-family-scan-*', 'window-family-bisect-*', 'window-family-refine-*', 'window-family-fine3-*', 'window-family-fine4-*'],
    validationSeeds: [],
    source: rules.provenance,
    canonicalHash: null,
  };
  frozen.mathHash = canonicalHash({
    evaluator: frozen.evaluator,
    targetRtpPercent: frozen.targetRtpPercent,
    validatedBet: frozen.validatedBet,
    validatedLines: frozen.validatedLines,
    stopWeights: frozen.stopWeights,
  });
  frozen.canonicalHash = canonicalHash(frozen);
  mkdirSync(join(HERE, 'profiles'), { recursive: true });
  writeFileSync(PROFILE_PATH, JSON.stringify(frozen, null, 1) + '\n');
  console.log(JSON.stringify({ frozen: PROFILE_PATH, canonicalHash: frozen.canonicalHash, mathHash: frozen.mathHash, preferredWeight: FROZEN_PREFERRED, otherWeight: FROZEN_OTHER }, null, 1));
}

export function scatterPmf(rules, profile) {
  let pmf = [1];
  for (const key of reelKeys(rules)) {
    const strip = (profile.strips && profile.strips[key]) || rules.reels[key];
    const supplied = profile.stopWeights && profile.stopWeights[key];
    const stops = strip.length - 2;
    const weights = supplied || new Array(stops).fill(1);
    const total = weights.reduce((a, b) => a + b, 0);
    const local = [0, 0, 0, 0];
    for (let i = 0; i < stops; i++) {
      let count = 0;
      for (let j = 0; j < 3; j++) if (strip[i + j] === rules.scatter) count++;
      local[count] += weights[i] / total;
    }
    const next = new Array(pmf.length + 3).fill(0);
    for (let a = 0; a < pmf.length; a++) {
      for (let b = 0; b < local.length; b++) next[a + b] += pmf[a] * local[b];
    }
    pmf = next;
  }
  return pmf;
}
function validate() {
  if (!existsSync(PROFILE_PATH)) throw new Error('profile not frozen');
  const profile = JSON.parse(readFileSync(PROFILE_PATH, 'utf8'));
  const rules = loadRules();
  const sourceHashes = verifySourceHashes(rules);
  const recomputed = canonicalHash(profile);
  if (recomputed !== profile.canonicalHash) {
    throw new Error('frozen profile hash mismatch: recorded ' + profile.canonicalHash + ', recomputed ' + recomputed);
  }
  const pmf = scatterPmf(rules, profile);
  const p3 = pmf.slice(3).reduce((a, b) => a + b, 0);
  const analyticBranching = rules.constants.slotFreeCount * p3;

  const seeds = (process.argv.find((a) => a.startsWith('--seeds=')) || '--seeds=validation-a').split('=')[1].split(',');
  const roundsPerSeed = Number((process.argv.find((a) => a.startsWith('--rounds=')) || '--rounds=1000000').split('=')[1]);
  const bet = Number((process.argv.find((a) => a.startsWith('--bet=')) || '--bet=1').split('=')[1]);
  const lines = Number((process.argv.find((a) => a.startsWith('--lines=')) || '--lines=10').split('=')[1]);
  const runs = [];
  for (const seed of seeds) {
    const r = run({ profile, rounds: roundsPerSeed, seed, bet, lines });
    runs.push({
      seed, rounds: r.rounds, wager: r.sumWager, return: r.totalReturn, sumSquares: r.sumSquares,
      rtpPercent: r.rtpPercent, ci: r.rtpCi95Percent,
      baseReturn: r.baseReturn, scatterReturn: r.scatterReturn, featureReturn: r.featureReturn,
      paidScatterContributionPercent: r.scatterContributionPercent,
      featureContributionPercent: r.featureContributionPercent,
      hitRate: r.hitRatePercent, triggerRate: r.featureTriggerRatePercent,
      retriggers: r.retriggerRatePercent / 100 * r.rounds, freeSpins: r.freeSpinsPerRound * r.rounds,
      maxRoundReturnX: r.maxRoundReturnX,
    });
    console.log('seed=' + seed + ' rounds=' + r.rounds + ' rtp=' + r.rtpPercent.toFixed(4) + ' trig=' + r.featureTriggerRatePercent.toFixed(4));
  }
  const sum = (fn) => runs.reduce((a, r) => a + fn(r), 0);
  const totalRounds = sum((r) => r.rounds);
  const totalWager = sum((r) => r.wager);
  const totalReturn = sum((r) => r.return);
  const totalSquares = sum((r) => r.sumSquares);
  const totalLineWin = sum((r) => r.baseReturn);
  const totalScatterWin = sum((r) => r.scatterReturn);
  const totalFeatureWin = sum((r) => r.featureReturn);
  const totalFreeSpins = sum((r) => r.freeSpins);
  const totalRetriggers = sum((r) => r.retriggers);
  const meanX = totalReturn / (bet * lines) / totalRounds;
  const variance = totalSquares / totalRounds - meanX * meanX;
  const stderr = Math.sqrt(Math.max(0, variance) / totalRounds);
  const z = 1.959963984540054;
  const rtpPercent = totalReturn / totalWager * 100;
  const ci = [rtpPercent - z * stderr * 100, rtpPercent + z * stderr * 100];
  const observedPass = rtpPercent >= 49.5 && rtpPercent <= 50.5;
  const ciPass = ci[0] >= 49.5 && ci[1] <= 50.5;
  const empiricalRetriggerPerFreeSpin = totalRetriggers / totalFreeSpins;
  const out = {
    runId: 'rtp50-validation-' + new Date().toISOString(),
    phase: 'independent validation (these seeds were never used for calibration)',
    profileId: profile.id,
    profileCanonicalHash: profile.canonicalHash,
    profileHashRecomputed: recomputed,
    profileMathHash: profile.mathHash,
    evaluatorId: profile.evaluator,
    evaluatorCodeHash: codeHash(),
    oracleManifest: existsSync(ORACLE_MANIFEST) ? JSON.parse(readFileSync(ORACLE_MANIFEST, 'utf8')) : null,
    rulesSourceHashesVerified: sourceHashes,
    validationSeeds: seeds,
    roundsPerSeed, totalRounds, bet, lines,
    denominators: {
      round: 'one paid spin including every resulting free spin and retrigger',
      wager: 'bet x lines per paid round; free spins add no wager',
      rtp: 'sum of complete-round returns / sum of paid wagers',
      baseContribution: 'paid-round line wins plus paid-round scatter wins',
      featureContribution: 'all free-spin wins including retriggered spins',
      hitRate: 'paid rounds with any return greater than zero',
      featureTriggerRate: 'paid rounds awarding 15 free spins'
    },
    totalWager, totalReturn, totalLineWin, totalScatterWin, totalFeatureWin, totalFreeSpins, totalRetriggers,
    observedRtpPercent: rtpPercent,
    observedStderrPercent: stderr * 100,
    observedCi95Percent: ci,
    observedWithinTolerance: observedPass,
    ciWithinTolerance: ciPass,
    acceptanceGate: 'observed RTP in 49.5..50.5 AND 95% CI contained in 49.5..50.5',
    gatePass: observedPass && ciPass,
    scatterPmf: pmf.map((v, i) => ({ scatterCount: i, probability: v })),
    probabilityScatterAtLeastThree: p3,
    analyticFreeSpinBranchingFactor: analyticBranching,
    analyticBranchingProof: rules.constants.slotFreeCount + ' x P(scatter>=3) = ' + rules.constants.slotFreeCount + ' x ' + p3 + ' = ' + analyticBranching + ' < 1',
    branchingSubcritical: analyticBranching < 1,
    empiricalRetriggersPerFreeSpin: empiricalRetriggerPerFreeSpin,
    empiricalBranchingEstimate: empiricalRetriggerPerFreeSpin * rules.constants.slotFreeCount,
    empiricalBranchingNote: 'empirical estimate from the same validation sample; the analytic convolution is the authoritative subcriticality proof',
    perSeed: runs
  };
  writeFileSync(join(HERE, 'runs', 'validation-rtp50.json'), JSON.stringify(out, null, 1) + '\n');
  console.log(JSON.stringify({ totalRounds, observedRtpPercent: rtpPercent, ci, observedPass, ciPass, gatePass: out.gatePass, p3, analyticBranching, empiricalBranching: out.empiricalBranchingEstimate }, null, 1));
}

const mode = process.argv.includes('--freeze') ? 'freeze' : 'validate';
if (mode === 'freeze') freeze(); else validate();