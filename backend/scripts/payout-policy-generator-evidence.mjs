// Offline automatic payout-policy generator evidence run.
//
//   cd backend
//   node ../node_modules/@nestjs/cli/bin/nest.js build
//   node scripts/payout-policy-generator-evidence.mjs
//
// For every predeclared request it runs the whole pipeline - request
// validation, reachability, the exact weight solver, the accepted policy
// validator, the exact expected-return check, the frozen policy hash and the
// accepted bankroll simulator - and writes one JSON + one Markdown report per
// candidate plus a comparison table under
//   docs/agent-work/game-math-control/generated/lucky-lady/
//
// Nothing here activates anything. `status: VALIDATED` is an evidence status.
//
// Sample size and horizon are bounded and overridable:
//   GENERATOR_SESSIONS=80 GENERATOR_HORIZON=5000 node scripts/...

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(HERE, '..');
const REPO = resolve(BACKEND, '..');
const DIST = join(BACKEND, 'dist', 'src');

const {
  LUCKY_LADY_GENERATOR_MODEL_ID,
  GENERATED_SAMPLE_HORIZON,
  GENERATED_SAMPLE_SESSIONS,
  generateLuckyLadyPolicy,
  luckyLadyGeneratorMetadata,
  luckyLadyGeneratorModel,
  renderGeneratedPolicyMarkdown,
  runGeneratedPolicyEvidence,
} = await import(`file://${join(DIST, 'casino/games/lucky-lady/lucky-lady.policy-generator.js')}`);
const { FROZEN_RTP50_REFERENCE } = await import(`file://${join(DIST, 'casino/games/lucky-lady/lucky-lady.distribution-fixtures.js')}`);
const { buildDistributionSupport } = await import(`file://${join(DIST, 'casino/games/lucky-lady/lucky-lady.distribution.js')}`);
const { defaultSessionConfig } = await import(`file://${join(DIST, 'casino/platform/math-control/math-control.bankroll.js')}`);

const SESSIONS = Number(process.env.GENERATOR_SESSIONS ?? GENERATED_SAMPLE_SESSIONS);
const HORIZON = Number(process.env.GENERATOR_HORIZON ?? GENERATED_SAMPLE_HORIZON);
const GENERATED_AT = process.env.REPORT_GENERATED_AT ?? new Date().toISOString();

const REPORT_ROOT = join(REPO, 'docs', 'agent-work', 'game-math-control', 'generated', 'lucky-lady');
mkdirSync(REPORT_ROOT, { recursive: true });

// Exact rationals carry BigInt numerators/denominators; they are written as
// decimal strings so the JSON artifact stays lossless and parseable.
const jsonSafe = (_key, value) => (typeof value === 'bigint' ? value.toString() : value);

const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, jsonSafe, 2)}\n`, 'utf8');
};
const writeText = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, 'utf8');
};

/** The predeclared request set: every required target, both 70% objectives. */
const REQUESTS = [
  { label: 'rtp0', request: { targetRtpPercent: '0', objective: 'BALANCED' } },
  { label: 'rtp20', request: { targetRtpPercent: '20', objective: 'BALANCED' } },
  { label: 'rtp50', request: { targetRtpPercent: '50', objective: 'BALANCED' } },
  { label: 'rtp63p5', request: { targetRtpPercent: '63.5', objective: 'BALANCED' } },
  { label: 'rtp70-retention', request: { targetRtpPercent: '70', objective: 'RETENTION' } },
  { label: 'rtp70-volatile', request: { targetRtpPercent: '70', objective: 'VOLATILE' } },
  { label: 'rtp90', request: { targetRtpPercent: '90', objective: 'BALANCED' } },
  { label: 'rtp100', request: { targetRtpPercent: '100', objective: 'BALANCED' } },
];

const sessionConfig = {
  ...defaultSessionConfig(),
  horizonPaidSpins: HORIZON,
  aliveCheckpoints: [100, 250, 500, 1000, 2500, 5000, 10_000],
  balanceCheckpoints: [100, 250, 500, 1000, 2500, 5000],
  ruinCheckpoints: [100, 250, 500, 1000, 2500, 5000],
  reachTargets: [12_500, 15_000, 20_000],
  fallTargets: [8_000, 6_000, 4_000, 2_000],
};

const built = luckyLadyGeneratorMetadata();
const model = luckyLadyGeneratorModel();
const started = Date.now();

// The accepted dense profile is refused by the bounded index: record it.
const denseAttempt = buildDistributionSupport(
  {
    profileId: FROZEN_RTP50_REFERENCE.profileId,
    profileHash: FROZEN_RTP50_REFERENCE.profileHash,
    payload: FROZEN_RTP50_REFERENCE.payload,
  },
  {
    policyId: 'lucky-lady.rtp50.reference',
    version: 1,
    gameId: 'lucky-lady',
    mathProfileId: FROZEN_RTP50_REFERENCE.profileId,
    mathProfileHash: FROZEN_RTP50_REFERENCE.profileHash,
    maxWinScope: 'RESOLVED_SPIN',
    maxWinMultiplier: 50,
    granularity: 10_000,
    maxBandMin: 20,
    weights: {
      LOSS: 0, PARTIAL_LOW: 0, PARTIAL_HIGH: 0, BREAK_EVEN: 0, SMALL: 10_000,
      MEDIUM: 0, BIG: 0, MAX: 0, FEATURE_TRIGGER: 0,
    },
  },
  { maxBoards: 4_096 },
);

writeJson(join(REPORT_ROOT, 'model.json'), {
  testOnly: true,
  activation: false,
  generatedAt: GENERATED_AT,
  modelId: LUCKY_LADY_GENERATOR_MODEL_ID,
  modelHash: model.artifact.canonicalHash,
  engineSha256: model.artifact.engineSha256,
  rulesSha256: model.artifact.rulesSha256,
  maxWinScope: built.metadata.maxWinScope,
  maxWinMultiplier: built.metadata.maxWinMultiplier,
  maxBandMin: built.metadata.maxBandMin,
  reachableBoards: built.support.reachableBoards,
  reachableClasses: built.metadata.reachableClasses,
  unreachableClasses: built.metadata.unreachableClasses,
  analysis: built.analysis,
  provenance: model.provenance,
  frozenRtp50Reference: {
    profileId: FROZEN_RTP50_REFERENCE.profileId,
    profileHash: FROZEN_RTP50_REFERENCE.profileHash,
    boundedIndexRefused: !denseAttempt.ok,
    constraints: denseAttempt.ok ? [] : denseAttempt.reasons,
    note: FROZEN_RTP50_REFERENCE.note,
  },
});

const reports = [];
const comparisonRows = [];

for (const entry of REQUESTS) {
  const candidate = generateLuckyLadyPolicy({ request: { maxWinMultiplier: 50, ...entry.request } });
  const report = runGeneratedPolicyEvidence(candidate, {
    sessions: SESSIONS,
    horizonPaidSpins: HORIZON,
    seedPrefix: `generated:${entry.label}:v1`,
    generatedAt: GENERATED_AT,
    sessionConfig,
  });
  reports.push({ label: entry.label, ...report });
  const fileName = `${entry.label}${candidate.policyId ? `-${candidate.policyId.split('.').pop()}` : ''}`;
  writeJson(join(REPORT_ROOT, `${fileName}.json`), { label: entry.label, ...report });
  writeText(join(REPORT_ROOT, `${fileName}.md`), renderGeneratedPolicyMarkdown(report));
  comparisonRows.push({
    label: entry.label,
    request: entry.request,
    status: report.status,
    policyId: candidate.policyId,
    policyHash: candidate.policyHash,
    expectedRtpPercent: candidate.expected?.rtpPercentExact ?? null,
    absoluteErrorPercent: candidate.expected?.absoluteErrorPercentExact ?? null,
    measuredRtpPercent: report.statistical?.measuredRtpPercentExact ?? null,
    statisticalVerdict: report.statistical?.verdict ?? null,
    weights: candidate.weights,
    solverMethod: candidate.solver.method,
    solverSupport: candidate.solver.support,
    sessionCount: report.bankroll?.sample.sessions ?? 0,
    horizon: report.bankroll?.sample.horizonPaidSpins ?? null,
    ruined: report.bankroll?.sample.ruinedCount ?? null,
    censored: report.bankroll?.sample.censoredCount ?? null,
    paidRounds: report.bankroll?.sample.actualPaidRounds ?? null,
    freeSpins: report.bankroll?.spins.freeSpinsTotal ?? null,
    fullLossRate: report.bankroll?.paidEvents.fullLoss.rate ?? null,
    hitRate: report.bankroll?.paidEvents.hit.rate ?? null,
    partialRate: report.bankroll?.paidEvents.partial.rate ?? null,
    featureRate: report.bankroll?.paidEvents.featureTriggered.rate ?? null,
    maxPaidSpinUnits: report.bankroll?.maxObserved.paidSpinUnitsExact ?? null,
    maxFreeSpinUnits: report.bankroll?.maxObserved.freeSpinUnitsExact ?? null,
    featureAggregateUnits: report.bankroll?.maxObserved.featureAggregateUnitsExact ?? null,
    medianPaidSpins: report.bankroll?.spins.perSessionPaidSpins.median ?? null,
    p90PaidSpins: report.bankroll?.spins.perSessionPaidSpins.p90 ?? null,
    medianTurnoverPts: report.bankroll?.turnover.perSessionPts.medianExact ?? null,
    alive500: report.bankroll?.survival['500']?.rate ?? null,
    alive1000: report.bankroll?.survival['1000']?.rate ?? null,
    ruin500: report.bankroll?.ruin['500']?.rate ?? null,
    reach150: report.bankroll?.reach['15000'] ?? null,
    fullLossStreakP90: report.bankroll?.drySpells.fullLoss.longestPerSession.p90 ?? null,
    drawdownMedian: report.bankroll?.drawdown.median ?? null,
    meanHouseNetPts: report.bankroll?.house.meanNetPtsPerSession ?? null,
    warnings: report.warnings,
  });
  console.log(
    `${entry.label}: ${report.status} expected ${candidate.expected?.rtpPercentExact ?? 'n/a'}% ` +
      `(error ${candidate.expected?.absoluteErrorPercentExact ?? 'n/a'}pp) measured ` +
      `${report.statistical?.measuredRtpPercentExact ?? 'n/a'}% [${report.statistical?.verdict ?? 'n/a'}] ` +
      `support ${candidate.solver.support.join('+') || 'n/a'}`,
  );
}

writeJson(join(REPORT_ROOT, 'comparison.json'), {
  testOnly: true,
  activation: false,
  generatedAt: GENERATED_AT,
  solverSessions: SESSIONS,
  solverHorizon: HORIZON,
  modelId: LUCKY_LADY_GENERATOR_MODEL_ID,
  modelHash: model.artifact.canonicalHash,
  rows: comparisonRows,
  notes: [
    'Automatic generator evidence: every row was solved by the shared exact solver and simulated by the accepted bankroll simulator.',
    'VALIDATED is an evidence status from the analytical checks plus the statistical verdict; it is never an activation.',
    'No row is a preference claim: the 70% RETENTION and VOLATILE rows are reported side by side without ranking.',
  ],
});

const pctText = (value) => (value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(2)}%`);
writeText(join(REPORT_ROOT, 'comparison.md'), [
  '# Automatic payout-policy generator - comparison (TEST artifacts)',
  '',
  '`testOnly: true`, `activation: false`. The declared bounded model is NOT the accepted dense RTP50 profile;',
  'the dense profile is refused by the bounded index (see `model.json`). Every row is an offline fixture.',
  '',
  `- Model: \`${LUCKY_LADY_GENERATOR_MODEL_ID}\` hash \`${model.artifact.canonicalHash}\``,
  `- Reachable boards: ${built.support.reachableBoards}; reachable classes: ${built.metadata.reachableClasses.map((c) => c.classId).join(', ')}`,
  `- Unreachable classes: ${built.metadata.unreachableClasses.join(', ')}`,
  `- Sample: ${SESSIONS} sessions x horizon ${HORIZON} paid spins (predeclared seeds, no seed search)`,
  '',
  '| Request | Status | Expected RTP | Exact error | Measured RTP | Statistical | Support | Full loss | Partial | Feature | Median/P90 spins | Median turnover | Alive@500 | Ruin@500 | Reach 150 PTS | P90 full-loss streak | Mean house net (PTS) |',
  '| --- | --- | ---: | ---: | ---: | --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...comparisonRows.map((row) => [
    row.label,
    row.status,
    row.expectedRtpPercent ?? 'n/a',
    row.absoluteErrorPercent ?? 'n/a',
    row.measuredRtpPercent ?? 'n/a',
    row.statisticalVerdict ?? 'n/a',
    row.solverSupport.join('+') || 'n/a',
    pctText(row.fullLossRate),
    pctText(row.partialRate),
    pctText(row.featureRate),
    `${row.medianPaidSpins === null ? 'n/a' : row.medianPaidSpins.toFixed(0)}/${row.p90PaidSpins === null ? 'n/a' : row.p90PaidSpins.toFixed(0)}`,
    row.medianTurnoverPts ?? 'n/a',
    pctText(row.alive500),
    pctText(row.ruin500),
    pctText(row.reach150),
    row.fullLossStreakP90 === null ? 'n/a' : row.fullLossStreakP90.toFixed(1),
    row.meanHouseNetPts === null ? 'n/a' : row.meanHouseNetPts.toFixed(4),
  ].join(' | ')).map((row) => `| ${row} |`),
  '',
  `Run wall time: ${((Date.now() - started) / 1000).toFixed(2)}s.`,
  '',
].join('\n'));

console.log(`wrote ${reports.length} candidate reports to ${REPORT_ROOT}`);
