// Reproducible Game Math Control evidence run.
//
//   cd backend
//   node ../node_modules/@nestjs/cli/bin/nest.js build
//   node scripts/math-control-evidence.mjs
//
// Writes, for every requested target return:
//   artifacts/math-validation/<gameId>/<profileId>/profile.json
//   artifacts/math-validation/<gameId>/<profileId>/validation.json
//   artifacts/math-validation/<gameId>/<profileId>/bankroll.json
//   docs/agent-work/game-math-profiles/reports/<gameId>/<profileId>-bankroll.md
// and a machine summary plus a comparison table under
//   artifacts/math-validation/<gameId>/summary.json
//   artifacts/math-validation/<gameId>/summary.md
//
// Unsupported requests are recorded too - with the exact constraint reasons -
// so a rejected target can never be mistaken for a delivered profile.
//
// Sample sizes are bounded and overridable:
//   MC_ROUNDS=40000 BANKROLL_SESSIONS=300 BANKROLL_HORIZON=3000 node scripts/...

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(HERE, '..');
const REPO = resolve(BACKEND, '..');
const DIST = join(BACKEND, 'dist', 'src');

const { LuckyLadyMathAdapter } = await import(`file://${join(DIST, 'casino/games/lucky-lady/lucky-lady.math-adapter.js')}`);
const { validatePolicy } = await import(`file://${join(DIST, 'casino/platform/math-control/math-control.policy.js')}`);
const { defaultSessionConfig } = await import(`file://${join(DIST, 'casino/platform/math-control/math-control.bankroll.js')}`);

const MC_ROUNDS = Number(process.env.MC_ROUNDS ?? 40_000);
const BANKROLL_SESSIONS = Number(process.env.BANKROLL_SESSIONS ?? 150);
// A horizon that actually reaches the 5 000 and 10 000 checkpoints: anything
// beyond it is reported as unobserved rather than as a zero.
const BANKROLL_HORIZON = Number(process.env.BANKROLL_HORIZON ?? 10_000);

const GAME_ID = 'lucky-lady';
/** Every whole-decade comparison target the operator asked for, plus customs. */
const TARGETS = [0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100, 33.3, 77.7];

/**
 * Named scenarios that are not part of the comparison ladder: they exist to
 * record the boundary behaviour (a genuinely zero return, a requested feature
 * that cannot be combined with a hard ceiling, and the unresolved optional
 * gamble scope) with the same evidence machinery as everything else.
 */
const SCENARIOS = [
  {
    name: 'zero-return-proof',
    label: 'true 0% return',
    overrides: { bigWinMinMultiplier: 1, bigWinMaxMultiplier: 1, volatility: 'LOW' },
    target: 0,
  },
  {
    name: 'feature-with-hard-ceiling',
    label: 'feature contribution 10..60% inside a 50x ceiling',
    overrides: { featureContribution: { minPercent: 10, maxPercent: 60 } },
    target: 50,
  },
  {
    name: 'total-ceiling-including-gamble',
    label: 'ceiling that includes the optional gamble',
    overrides: { maxWinScope: 'TOTAL_INCLUDING_OPTIONAL_GAMBLE' },
    target: 50,
  },
];

const checkpoints = [100, 250, 500, 1000, 2500, 5000, 10_000, 25_000, 50_000]
  .filter((value) => value <= BANKROLL_HORIZON);

const sessionConfig = {
  ...defaultSessionConfig(),
  horizonPaidSpins: BANKROLL_HORIZON,
  aliveCheckpoints: checkpoints.length > 0 ? checkpoints : [BANKROLL_HORIZON],
  balanceCheckpoints: [100, 250, 500, 1000, 5000].filter((value) => value <= BANKROLL_HORIZON),
  ruinCheckpoints: [100, 250, 500, 1000, 5000].filter((value) => value <= BANKROLL_HORIZON),
};

const policyFor = (target) => ({
  targetRtpPercent: target,
  maxWinMultiplier: 50,
  maxWinScope: 'PAID_ROUND_BEFORE_OPTIONAL_GAMBLE',
  pacing: 'BALANCED',
  customPacing: null,
  hitRate: { mode: 'AUTO' },
  partialReturn: 'LOW',
  volatility: 'MED',
  bigWinMinMultiplier: 10,
  bigWinMaxMultiplier: 50,
  featureContribution: { minPercent: 0, maxPercent: 60 },
  presets: [],
});

const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const writeText = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, 'utf8');
};

const pct = (value, digits = 4) =>
  value === null || value === undefined || !Number.isFinite(value) ? 'n/a' : `${value.toFixed(digits)}%`;
const num = (value, digits = 4) =>
  value === null || value === undefined || !Number.isFinite(value) ? 'n/a' : value.toFixed(digits);

const adapter = new LuckyLadyMathAdapter();
const capabilities = await adapter.capabilities();

const artifactRoot = join(REPO, 'artifacts', 'math-validation', GAME_ID);
const reportRoot = join(REPO, 'docs', 'agent-work', 'game-math-profiles', 'reports', GAME_ID);
mkdirSync(join(artifactRoot, 'unsupported'), { recursive: true });
mkdirSync(reportRoot, { recursive: true });

const rows = [];
const unsupported = [];
const startedAt = new Date().toISOString();

const CASES = [
  ...TARGETS.map((target) => ({
    slug: `rtp${String(target).replace('.', 'p')}`,
    target,
    label: `${target}%`,
    overrides: {},
    scenario: null,
  })),
  ...SCENARIOS.map((scenario) => ({
    slug: `scenario-${scenario.name}`,
    target: scenario.target,
    label: scenario.label,
    overrides: scenario.overrides,
    scenario: scenario.name,
  })),
];

for (const current of CASES) {
  const target = current.target;
  const parsed = validatePolicy({ ...policyFor(target), ...current.overrides, gameId: GAME_ID });
  if (!parsed.ok) {
    unsupported.push({ case: current.slug, target, constraint: 'INVALID_POLICY', errors: parsed.errors });
    rows.push({ case: current.slug, target, scenario: current.scenario, status: 'INVALID_POLICY' });
    continue;
  }
  const generated = await adapter.generateProfile(parsed.policy);
  if (generated.status !== 'SUPPORTED') {
    unsupported.push({
      case: current.slug,
      target,
      scenario: current.scenario,
      status: 'UNSUPPORTED',
      reasons: generated.reasons,
      bestEffort: generated.bestEffort,
    });
    writeJson(join(artifactRoot, 'unsupported', `${current.slug}.json`), {
      target,
      scenario: current.scenario,
      status: 'UNSUPPORTED',
      reasons: generated.reasons,
      bestEffort: generated.bestEffort,
      policy: parsed.policy,
    });
    rows.push({
      case: current.slug,
      target,
      scenario: current.scenario,
      status: 'UNSUPPORTED',
      reasons: generated.reasons.map((reason) => reason.constraint).join('; '),
      bestEffortRtp: generated.bestEffort?.rtpPercent ?? null,
    });
    continue;
  }

  const artifact = generated.artifact;
  const dir = join(artifactRoot, artifact.profileId);
  const outcome = await adapter.validateProfile(parsed.policy, artifact, {
    validationSeedPrefix: `validation:${artifact.canonicalHash}:1`,
    bankrollSeedPrefix: `bankroll:${artifact.canonicalHash}:1`,
    monteCarloRounds: MC_ROUNDS,
    bankrollSessions: BANKROLL_SESSIONS,
    sessionConfig,
    rtpTolerancePercent: 0.25,
  });

  const evidence = {
    validationId: `evidence:${artifact.profileId}`,
    profileId: artifact.profileId,
    gameId: GAME_ID,
    profileHash: artifact.canonicalHash,
    engineSha256: artifact.engineSha256,
    rulesSha256: artifact.rulesSha256,
    createdAt: new Date().toISOString(),
    seeds: {
      calibrationPrefix: 'bounded-anchor-bisection (no sampled seeds)',
      validationPrefix: `validation:${artifact.canonicalHash}:1`,
      bankrollPrefix: `bankroll:${artifact.canonicalHash}:1`,
    },
    runs: outcome.runs,
    metrics: outcome.metrics,
    bankroll: outcome.bankroll,
    checks: outcome.checks,
    result: outcome.result,
  };

  writeJson(join(dir, 'profile.json'), {
    artifact,
    analysis: generated.analysis,
    calibration: generated.calibration,
  });
  writeJson(join(dir, 'validation.json'), evidence);
  writeJson(join(dir, 'bankroll.json'), outcome.bankroll);

  const bankroll = outcome.bankroll;
  const metrics = outcome.metrics;
  const alive = (key) => (bankroll.aliveAt[String(key)] === null || bankroll.aliveAt[String(key)] === undefined
    ? 'unobserved'
    : num(bankroll.aliveAt[String(key)]));
  const ruinAt = (key) => (bankroll.ruinBy[String(key)] === null || bankroll.ruinBy[String(key)] === undefined
    ? 'unknown'
    : num(bankroll.ruinBy[String(key)]));
  writeText(join(reportRoot, `${artifact.profileId}-bankroll.md`), [
    `# ${artifact.profileId} - bankroll validation`,
    '',
    `- Result: **${evidence.result}** (evidence grade **${evidence.grade}**)`,
    `- Artifact hash: \`${artifact.canonicalHash}\``,
    `- Engine: \`${artifact.engineSha256}\`, rules: \`${artifact.rulesSha256}\``,
    `- Requested return: ${parsed.policy.targetRtpPercent}%`,
    `- Exact return (computed by the game's own evaluator over every reachable board): ${pct(generated.analysis.exactRtpPercent)}`,
    `- Monte Carlo (${metrics.rounds} complete paid rounds, seed prefix \`${metrics.seedPrefix}\`): ${pct(metrics.measuredRtpPercent)}` +
      ` (95% CI half-width ${metrics.ci95Bps === null ? 'n/a' : `${(metrics.ci95Bps / 100).toFixed(4)}pp`})`,
    `- Proved maximum: ${num(generated.analysis.maxRoundMultiplier, 4)}x - ${generated.analysis.maxRoundBasis}`,
    `- Hit rate: ${num(metrics.hitRate)}; zero rate: ${num(metrics.zeroRate)}; partial-return rate: ${num(metrics.partialRate)}`,
    `- Feature trigger rate: ${num(metrics.featureTriggerRate)}; retrigger rate: ${num(metrics.featureRetriggerRate)}; feature share of return: ${pct(metrics.featureRtpPercent)}`,
    '',
    '## Session simulation',
    '',
    `Denomination: ${bankroll.denomination}`,
    '',
    `- Sessions: ${bankroll.sampleSize}; horizon: ${bankroll.horizonPaidSpins} paid spins`,
    `- Ruined inside the horizon: ${bankroll.ruinedCount}; censored at the horizon: ${bankroll.censoredCount}`,
    `- Measured return over total paid wager: ${pct(bankroll.measuredRtpPercent)} (house edge ${pct(bankroll.houseEdgePercent)})`,
    `- Ledger: opening ${bankroll.totals.openingUnits} + returned ${bankroll.totals.returnedUnits}` +
      ` - wager ${bankroll.totals.paidWagerUnits} = closing ${bankroll.totals.closingUnits}` +
      ` (delta ${bankroll.totals.ledgerDeltaUnits}, exact ${bankroll.totals.ledgerIdentityHolds})`,
    `- Turnover: ${num(bankroll.totals.turnoverPts, 2)} PTS over ${bankroll.totals.paidRounds} paid rounds`,
    `- Largest single paid round in the cohort: ${num(bankroll.maxWin.pts, 2)} PTS` +
      ` (session frequency ${num(bankroll.maxWin.sessionFrequency)})`,
    `- Observed duration (paid spins): mean ${num(bankroll.observedLengthPaidSpins.mean, 1)},` +
      ` median ${num(bankroll.observedLengthPaidSpins.median, 1)}, p90 ${num(bankroll.observedLengthPaidSpins.p90, 1)}`,
    `- Turnover (paid spins): mean ${num(bankroll.turnoverPaidSpins.mean, 1)}, median ${num(bankroll.turnoverPaidSpins.median, 1)}`,
    `- Ruin-before-bust quantiles (only sessions that busted): mean ${num(bankroll.observedBustQuantiles.mean, 1)},` +
      ` median ${num(bankroll.observedBustQuantiles.median, 1)}; a censored session contributes no bust time`,
    `- Max drawdown (units): mean ${num(bankroll.maxDrawdown.mean, 1)}, median ${num(bankroll.maxDrawdown.median, 1)},` +
      ` p90 ${num(bankroll.maxDrawdown.p90, 1)}, p95 ${num(bankroll.maxDrawdown.p95, 1)}`,
    '',
    '| Checkpoint (paid spins) | Alive@N | Balance mean | Balance median | Ruin by N |',
    '| --- | --- | --- | --- | --- |',
    ...checkpoints.map((key) =>
      `| ${key} | ${alive(key)} | ${num(bankroll.balanceAt[String(key)]?.mean, 1)} | ${num(bankroll.balanceAt[String(key)]?.median, 1)} | ${ruinAt(key)} |`),
    '',
    'Reach / fall probabilities:',
    '',
    ...Object.entries(bankroll.reachProbability).map(([key, value]) => `- reached ${key} units: ${num(value)}`),
    ...Object.entries(bankroll.fallBelowProbability).map(([key, value]) => `- fell below ${key} units: ${num(value)}`),
    '',
    '## Checks',
    '',
    ...outcome.checks.map((entry) => `- **${entry.status}** \`${entry.id}\`: ${entry.detail}`),
    '',
    '`Alive@N` means the session could still fund the next paid stake after N completed paid spins. A session that',
    'reached the horizon is censored, never reported as ruined, and its bust time stays unknown.',
    '',
  ].join('\n'));

  rows.push({
    case: current.slug,
    target,
    scenario: current.scenario,
    status: evidence.result === 'PASS' ? 'VALIDATED' : 'REJECTED',
    grade: evidence.grade,
    profileId: artifact.profileId,
    profileHash: artifact.canonicalHash,
    exactRtpPercent: generated.analysis.exactRtpPercent,
    measuredRtpPercent: metrics.measuredRtpPercent,
    hitRate: metrics.hitRate,
    maxObservedMultiplier: metrics.maxObservedMultiplier,
    provedMaxMultiplier: Number.isFinite(generated.analysis.maxRoundMultiplier)
      ? generated.analysis.maxRoundMultiplier
      : 'unbounded',
    medianSpins: bankroll.observedLengthPaidSpins.median,
    p90Spins: bankroll.observedLengthPaidSpins.p90,
    medianTurnover: bankroll.turnoverPaidSpins.median,
    turnoverPts: bankroll.totals.turnoverPts,
    ledgerExact: bankroll.totals.ledgerIdentityHolds,
    maxWinPts: bankroll.maxWin.pts,
    maxWinFrequency: bankroll.maxWin.sessionFrequency,
    alive500: bankroll.aliveAt['500'] ?? null,
    alive1000: bankroll.aliveAt['1000'] ?? null,
    alive5000: bankroll.aliveAt['5000'] ?? null,
    alive10000: bankroll.aliveAt['10000'] ?? null,
    reach150: bankroll.reachProbability['15000'] ?? null,
    ruin500: bankroll.ruinBy['500'] ?? null,
    ruin5000: bankroll.ruinBy['5000'] ?? null,
    featureRate: metrics.featureTriggerRate,
    exactRtpPercent: generated.analysis.exactRtpPercent,
    failedChecks: outcome.checks.filter((entry) => entry.status !== 'PASS').map((entry) => entry.id),
  });
}

const summary = {
  gameId: GAME_ID,
  startedAt,
  finishedAt: new Date().toISOString(),
  samples: { monteCarloRounds: MC_ROUNDS, bankrollSessions: BANKROLL_SESSIONS, bankrollHorizonPaidSpins: BANKROLL_HORIZON },
  capabilities,
  rows,
  unsupported,
  notes: [
    'Exact return is computed by the vendored evaluator over every board the profile can reach; the Monte Carlo run is an independent check on the same engine with its own seed domain.',
    'Proved maximum is support, not an observed sample maximum.',
    'A session that reached the horizon is censored; only sessions that could no longer fund the next stake count as ruined.',
    'Simulation denomination is 1 unit = 0.01 PTS. The live Lucky Lady ladder is whole points and was not changed.',
  ],
};

writeJson(join(artifactRoot, 'summary.json'), summary);

const columns = [
  'Profile', 'Target', 'Status', 'Grade', 'Measured', 'Exact', 'Hit', 'Max observed', 'Proved max',
  'Median spins', 'P90 spins', 'Turnover PTS', 'Max win PTS', 'Max-win freq', 'Ledger exact',
  'Alive500', 'Alive1000', 'Alive5000', 'Alive10000', 'Reach150', 'Ruin500', 'Ruin5000', 'Feature rate',
];
const cell = (value, digits = 4) => (value === null || value === undefined || typeof value === 'string'
  ? (typeof value === 'string' ? value : '-')
  : Number.isFinite(value) ? Number(value).toFixed(digits) : '-');
writeText(join(artifactRoot, 'summary.md'), [
  `# ${GAME_ID} math control evidence`,
  '',
  `Samples: ${MC_ROUNDS} Monte Carlo rounds, ${BANKROLL_SESSIONS} sessions x up to ${BANKROLL_HORIZON} paid spins.`,
  '',
  `| ${columns.join(' | ')} |`,
  `| ${columns.map(() => '---').join(' | ')} |`,
  ...rows.map((row) => [
    row.profileId ?? row.case,
    row.target,
    row.status,
    row.grade ?? '-',
    cell(row.measuredRtpPercent, 4),
    cell(row.exactRtpPercent, 4),
    cell(row.hitRate, 4),
    cell(row.maxObservedMultiplier, 2),
    cell(row.provedMaxMultiplier, 2),
    cell(row.medianSpins, 0),
    cell(row.p90Spins, 0),
    cell(row.medianTurnover, 0),
    cell(row.turnoverPts, 2),
    cell(row.maxWinPts, 2),
    cell(row.maxWinFrequency, 4),
    row.ledgerExact === undefined ? '-' : String(row.ledgerExact),
    cell(row.alive500, 3),
    cell(row.alive1000, 3),
    cell(row.alive5000, 3),
    cell(row.alive10000, 3),
    cell(row.reach150, 3),
    row.ruin500 === null || row.ruin500 === undefined ? 'unknown' : cell(row.ruin500, 3),
    row.ruin5000 === null || row.ruin5000 === undefined ? 'unknown' : cell(row.ruin5000, 3),
    cell(row.featureRate, 5),
  ].join(' | ')).map((line) => `| ${line} |`),
  '',
  'Unsupported requests (recorded, never presented as delivered):',
  '',
  ...unsupported.map((entry) =>
    `- ${entry.case} (target ${entry.target}%${entry.scenario ? `, ${entry.scenario}` : ''}): ${entry.status ?? entry.constraint}` +
    `${entry.reasons ? ` - ${entry.reasons.map((reason) => `${reason.constraint} (requested ${reason.requested}; achievable ${reason.achievable})`).join('; ')}` : ''}`),
  '',
].join('\n'));

process.stdout.write(`${JSON.stringify({
  event: 'MATH_CONTROL_EVIDENCE_WRITTEN',
  gameId: GAME_ID,
  rows: rows.length,
  validated: rows.filter((row) => row.status === 'VALIDATED').length,
  rejected: rows.filter((row) => row.status === 'REJECTED').length,
  unsupported: rows.filter((row) => row.status === 'UNSUPPORTED').length,
  samples: summary.samples,
  artifactRoot,
  reportRoot,
}, null, 2)}\n`);
