// Offline payout-policy -> bankroll evidence run.
//
//   cd backend
//   node ../node_modules/@nestjs/cli/bin/nest.js build
//   node scripts/payout-policy-bankroll-evidence.mjs
//
// For every frozen TEST policy fixture it:
//   1. builds the exact reachable support once (bounded at 4096 boards),
//   2. drives the ACCEPTED simulateCohort/simulateSession accounting with a
//      policy-driven session source that selects a class + real reachable board
//      and executes the native Lucky Lady engine, then
//   3. writes a machine JSON report and a human Markdown report under
//      docs/agent-work/game-math-control/reports/lucky-lady/.
//
// It also attempts the accepted dense RTP50 profile and records the bounded
// index refusal verbatim - it does not pretend a class-equivalent fixture.
//
// Sample sizes and the horizon are bounded and overridable:
//   PAYOUT_POLICY_SESSIONS=200 PAYOUT_POLICY_HORIZON=10000 node scripts/...

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(HERE, '..');
const REPO = resolve(BACKEND, '..');
const DIST = join(BACKEND, 'dist', 'src');

const { buildDistributionSupport } = await import(`file://${join(DIST, 'casino/games/lucky-lady/lucky-lady.distribution.js')}`);
const { luckyLadyPolicySessionFactory } = await import(`file://${join(DIST, 'casino/games/lucky-lady/lucky-lady.distribution-session.js')}`);
const {
  PAYOUT_POLICY_FIXTURES,
  FROZEN_RTP50_REFERENCE,
} = await import(`file://${join(DIST, 'casino/games/lucky-lady/lucky-lady.distribution-fixtures.js')}`);
const {
  runPolicyBankroll,
  renderPolicyBankrollMarkdown,
  renderPolicyBankrollComparisonMarkdown,
} = await import(`file://${join(DIST, 'casino/platform/math-control/payout-policy-bankroll.js')}`);
const { defaultSessionConfig } = await import(`file://${join(DIST, 'casino/platform/math-control/math-control.bankroll.js')}`);
const { loadVerifiedMath } = await import(`file://${join(DIST, 'casino/games/lucky-lady/lucky-lady.math.js')}`);

const MAX_BOARDS = Number(process.env.PAYOUT_POLICY_MAX_BOARDS ?? 4_096);
const SESSION_OVERRIDE = Number(process.env.PAYOUT_POLICY_SESSIONS ?? 0);
const HORIZON_OVERRIDE = Number(process.env.PAYOUT_POLICY_HORIZON ?? 0);
const GENERATED_AT = process.env.REPORT_GENERATED_AT ?? new Date().toISOString();

const REPORT_ROOT = join(REPO, 'docs', 'agent-work', 'game-math-control', 'reports', 'lucky-lady');
mkdirSync(REPORT_ROOT, { recursive: true });

const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};
const writeText = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, 'utf8');
};

const { engine, rules } = loadVerifiedMath();
const started = Date.now();

const sessionConfigFor = (horizonPaidSpins) => ({
  ...defaultSessionConfig(),
  horizonPaidSpins: HORIZON_OVERRIDE > 0 ? HORIZON_OVERRIDE : horizonPaidSpins,
  // The requested checkpoint sets, explicit so they never depend on defaults.
  aliveCheckpoints: [100, 250, 500, 1000, 2500, 5000, 10_000],
  balanceCheckpoints: [100, 250, 500, 1000, 2500, 5000, 10_000],
  ruinCheckpoints: [100, 250, 500, 1000, 2500, 5000],
  reachTargets: [12_500, 15_000, 20_000],
  fallTargets: [8_000, 6_000, 4_000, 2_000],
});

const reports = [];
const unsuccessful = [];

for (const fixture of PAYOUT_POLICY_FIXTURES) {
  const supportResult = buildDistributionSupport(
    { profileId: fixture.artifact.profileId, profileHash: fixture.artifact.canonicalHash, payload: fixture.payload },
    fixture.policy,
    { maxBoards: MAX_BOARDS },
  );
  if (!supportResult.ok) {
    unsuccessful.push({
      fixtureId: fixture.fixtureId,
      label: fixture.label,
      profileId: fixture.artifact.profileId,
      profileHash: fixture.artifact.canonicalHash,
      constraints: supportResult.reasons,
    });
    console.log(`unsupported: ${fixture.fixtureId}: ${supportResult.reasons.map((entry) => entry.constraint).join(', ')}`);
    continue;
  }
  const support = supportResult.support;
  const config = sessionConfigFor(fixture.horizonPaidSpins);
  const sessions = SESSION_OVERRIDE > 0 ? SESSION_OVERRIDE : fixture.sessions;
  const seedPrefix = `payout-policy:${fixture.fixtureId}:v1`;
  const { report } = runPolicyBankroll({
    gameId: 'lucky-lady',
    policy: fixture.policy,
    support,
    config,
    sessions,
    seedPrefix,
    generatedAt: GENERATED_AT,
    sessionSourceFactory: luckyLadyPolicySessionFactory({
      support,
      payload: fixture.payload,
      config,
      rules,
      engine,
    }),
  });
  reports.push(report);
  writeJson(join(REPORT_ROOT, `${fixture.fixtureId}.json`), report);
  writeText(join(REPORT_ROOT, `${fixture.fixtureId}.md`), renderPolicyBankrollMarkdown(report));
  console.log(
    `${fixture.fixtureId}: support ${support.reachableBoards} boards, ${report.sample.sessions} sessions, ` +
      `${report.sample.actualPaidRounds} paid rounds, expected ${report.expected.rtpPercentExact}% vs measured ` +
      `${report.measured.rtpPercentExact}% (ruined ${report.sample.ruinedCount}, censored ${report.sample.censoredCount})`,
  );
}

// The accepted dense RTP50 profile: attempt the bounded build and keep the refusal.
{
  const referencePolicy = {
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
      LOSS: 0,
      PARTIAL_LOW: 0,
      PARTIAL_HIGH: 0,
      BREAK_EVEN: 0,
      SMALL: 10_000,
      MEDIUM: 0,
      BIG: 0,
      MAX: 0,
      FEATURE_TRIGGER: 0,
    },
  };
  const attempt = buildDistributionSupport(
    {
      profileId: FROZEN_RTP50_REFERENCE.profileId,
      profileHash: FROZEN_RTP50_REFERENCE.profileHash,
      payload: FROZEN_RTP50_REFERENCE.payload,
    },
    referencePolicy,
    { maxBoards: MAX_BOARDS },
  );
  unsuccessful.push({
    fixtureId: 'frozen-rtp50-reference',
    label: FROZEN_RTP50_REFERENCE.label,
    profileId: FROZEN_RTP50_REFERENCE.profileId,
    profileHash: FROZEN_RTP50_REFERENCE.profileHash,
    note: FROZEN_RTP50_REFERENCE.note,
    constraints: attempt.ok ? [] : attempt.reasons,
  });
  console.log(
    `frozen-rtp50-reference: ${attempt.ok ? 'unexpectedly enumerable' : attempt.reasons.map((entry) => entry.constraint).join(', ')}`,
  );
}

writeJson(join(REPORT_ROOT, 'comparison.json'), {
  testOnly: true,
  activated: false,
  generatedAt: GENERATED_AT,
  maxBoards: MAX_BOARDS,
  reports,
  unsupported: unsuccessful,
  notes: [
    'Offline behaviour fixtures for the payout-policy -> bankroll bridge. Not activated, not validated, not generated.',
    'Expected RTP comes from the exact reachable support of the policy; measured RTP is complete paid-round return over paid wager.',
    'The accepted dense RTP50 profile is refused by the bounded support index and is recorded as unsupported rather than approximated.',
    'Historical reference only: an earlier 20M-round run measured 49.8624% under a different methodology; it is not a current session result.',
  ],
});
writeText(join(REPORT_ROOT, 'comparison.md'), [
  renderPolicyBankrollComparisonMarkdown(reports),
  '## Unsupported / refused',
  '',
  ...unsuccessful.map((entry) =>
    `- \`${entry.fixtureId}\`: ${entry.constraints.length === 0 ? 'enumeration succeeded (no refusal)' : entry.constraints.map((reason) => `\`${reason.constraint}\` (${reason.detail})`).join('; ')}` +
    `${entry.note ? ` - ${entry.note}` : ''}`),
  '',
  '## Fixtures',
  '',
  ...PAYOUT_POLICY_FIXTURES.map((fixture) =>
    `- \`${fixture.fixtureId}\` (${fixture.label}): ${fixture.description}. Expectation: ${fixture.expectation}.`),
  '',
  `Run wall time: ${((Date.now() - started) / 1000).toFixed(2)}s.`,
  '',
].join('\n'));
