import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { MathValidationEvidence } from './math-control.types';

/**
 * Validation evidence on disk.
 *
 * The database row is the authority; these files are the human- and
 * machine-readable copy the control plane promises. Paths are built from a
 * server-issued game id and profile id that are re-validated here, so an
 * operator can never steer a write outside the artifact roots.
 */

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,119}$/i;

export class ArtifactPathError extends Error {
  constructor(message: string) {
    super(`MATH_ARTIFACT_PATH_INVALID: ${message}`);
  }
}

/** Walk up from the current directory until the repository root is recognisable. */
export function repositoryRoot(start = process.cwd()): string {
  let current = resolve(start);
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(current, 'backend')) && existsSync(join(current, 'frontend'))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolve(start);
}

export function assertSafeId(value: string, label: string) {
  if (typeof value !== 'string' || !SAFE_ID.test(value) || value.includes('..')) {
    throw new ArtifactPathError(`${label} "${value}" is not a safe path segment`);
  }
  return value;
}

export type ValidationArtifactPaths = {
  root: string;
  jsonPath: string;
  bankrollPath: string;
  markdownPath: string;
  relativeJson: string;
  relativeMarkdown: string;
};

export function validationArtifactPaths(
  gameId: string,
  profileId: string,
  attempt: number,
  roots: { artifactRoot?: string; reportRoot?: string; repoRoot?: string } = {},
): ValidationArtifactPaths {
  const game = assertSafeId(gameId, 'gameId');
  const profile = assertSafeId(profileId, 'profileId');
  if (!Number.isSafeInteger(attempt) || attempt < 1) {
    throw new ArtifactPathError(`attempt ${attempt} must be a positive integer`);
  }
  const repo = roots.repoRoot ?? repositoryRoot();
  const artifactRoot = roots.artifactRoot ?? process.env.MATH_CONTROL_ARTIFACT_ROOT ?? join(repo, 'artifacts', 'math-validation');
  const reportRoot = roots.reportRoot ?? process.env.MATH_CONTROL_REPORT_ROOT ?? join(repo, 'docs', 'agent-work', 'game-math-profiles', 'reports');
  const dir = join(artifactRoot, game, profile);
  const reportDir = join(reportRoot, game);
  return {
    root: dir,
    jsonPath: join(dir, `validation-${attempt}.json`),
    bankrollPath: join(dir, `bankroll-${attempt}.json`),
    markdownPath: join(reportDir, `${profile}-bankroll.md`),
    relativeJson: join('artifacts', 'math-validation', game, profile, `validation-${attempt}.json`),
    relativeMarkdown: join('docs', 'agent-work', 'game-math-profiles', 'reports', game, `${profile}-bankroll.md`),
  };
}

/**
 * Fixed-decimal presentation with a scientific fallback.
 *
 * A finite non-zero statistic that would render as all zeros at the requested
 * precision (for example 1e-16 at four decimals) is shown in scientific
 * notation instead, so a rounded statistical figure can never look like a true
 * zero. Accounting figures do not go through this helper.
 */
const num = (value: number | null | undefined, digits = 4) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  const fixed = value.toFixed(digits);
  if (value !== 0 && Number(fixed) === 0) return value.toExponential();
  return fixed;
};
const pct = (value: number | null | undefined, digits = 4) => `${num(value, digits)}%`;

export function bankrollMarkdown(evidence: MathValidationEvidence): string {
  const { bankroll, metrics } = evidence;
  const checkpoints = Array.from(new Set([
    ...Object.keys(bankroll.aliveAt),
    ...Object.keys(bankroll.balanceAt),
    ...Object.keys(bankroll.ruinBy),
  ])).map(Number).sort((a, b) => a - b);
  // A rounded statistical string can legitimately read 0 while the underlying
  // ratio is non-zero; say so instead of presenting a false zero.
  const measuredRtpRounded = Number(bankroll.measuredRtpExact);
  const measuredRtpText = measuredRtpRounded === 0 &&
    bankroll.measuredRtpPercent !== null && bankroll.measuredRtpPercent !== 0
    ? `${num(bankroll.measuredRtpPercent, 6)}% (the stored 6-decimal presentation rounds this to 0)`
    : `${bankroll.measuredRtpExact}%`;
  return [
    `# ${evidence.profileId} - bankroll validation`,
    '',
    `- Result: **${evidence.result}** (evidence grade **${evidence.grade}**)`,
    `- Artifact hash: \`${evidence.profileHash}\``,
    `- Engine: \`${evidence.engineSha256}\`, rules: \`${evidence.rulesSha256}\``,
    `- Seed domains: validation \`${evidence.seeds.validationPrefix}\`, bankroll \`${evidence.seeds.bankrollPrefix}\``,
    metrics
      ? `- Monte Carlo: ${metrics.rounds} complete paid rounds measured ${pct(metrics.measuredRtpPercent)}` +
        ` (95% CI half-width ${metrics.ci95Bps === null ? 'n/a' : `${(metrics.ci95Bps / 100).toFixed(4)}pp`})`
      : '- Monte Carlo: not run',
    `- Hit rate: ${num(metrics?.hitRate)}; zero rate: ${num(metrics?.zeroRate)}; partial return ${num(metrics?.partialRate)};` +
      ` break-even (X = 1): ${num(metrics?.breakEvenRate)}`,
    `- Feature trigger ${num(metrics?.featureTriggerRate)}; retrigger ${num(metrics?.featureRetriggerRate)};` +
      ` feature share of return ${pct(metrics?.featureRtpPercent)}`,
    `- Largest single paid round in the cohort: ${bankroll.maxWin.unitsExact} units exact` +
      ` (${bankroll.maxWin.ptsExact} PTS rounded to 4dp, session frequency ${num(bankroll.maxWin.sessionFrequency)})`,
    '',
    '## Session simulation',
    '',
    `Denomination: ${bankroll.denomination}`,
    '',
    'Ledger figures below are exact integer unit strings copied verbatim from the authoritative BigInt',
    'accounting, and the PTS totals are their exact 1/100 scaling.',
    'Rates, rates-of-return and quantiles are rounded statistical presentation - never an accounting input.',
    '',
    `- Sessions: ${bankroll.sampleSize}; horizon: ${bankroll.horizonPaidSpins} paid spins`,
    `- Ruined inside the horizon: ${bankroll.ruinedCount}; censored at the horizon: ${bankroll.censoredCount}`,
    `- Measured return over total paid wager (rounded statistical presentation): ${measuredRtpText}` +
      `; house edge (rounded statistical presentation): ${bankroll.houseEdgeExact}%`,
    `- Ledger (exact units): opening ${bankroll.totals.openingUnitsExact}` +
      ` + returned ${bankroll.totals.returnedUnitsExact}` +
      ` - wager ${bankroll.totals.paidWagerUnitsExact}` +
      ` = closing ${bankroll.totals.closingUnitsExact}` +
      ` (delta ${bankroll.totals.ledgerDeltaUnitsExact} units, exact ${bankroll.totals.ledgerIdentityHolds})`,
    `- Exact split (units): base ${bankroll.totals.baseReturnUnitsExact}` +
      ` + feature ${bankroll.totals.featureReturnUnitsExact}` +
      ` = returned ${bankroll.totals.returnedUnitsExact}`,
    `- Turnover: ${bankroll.totals.paidWagerUnitsExact} units exact` +
      ` (= ${bankroll.totals.turnoverPtsExact} PTS at the exact 1/100 scaling)` +
      ` over ${bankroll.totals.paidRounds} paid rounds`,
    `- Observed duration (paid spins): mean ${num(bankroll.observedLengthPaidSpins.mean, 1)},` +
      ` median ${num(bankroll.observedLengthPaidSpins.median, 1)}, p90 ${num(bankroll.observedLengthPaidSpins.p90, 1)}` +
      ' (restricted observed duration; censored sessions are not bust-time estimates)',
    `- Drawdown (units): mean ${num(bankroll.maxDrawdown.mean, 1)}, median ${num(bankroll.maxDrawdown.median, 1)},` +
      ` p90 ${num(bankroll.maxDrawdown.p90, 1)}, p95 ${num(bankroll.maxDrawdown.p95, 1)}`,
    '',
    '| Checkpoint | Alive@N | Balance mean (rounded statistical) | Balance median (rounded statistical) | Ruin by N | Observable sessions |',
    '| ---: | ---: | ---: | ---: | ---: | ---: |',
    ...checkpoints.map((checkpoint) => {
      const alive = bankroll.aliveAt[String(checkpoint)];
      const ruin = bankroll.ruinBy[String(checkpoint)];
      const exactBalance = bankroll.balanceAtExact[String(checkpoint)];
      return `| ${checkpoint} | ${alive === null || alive === undefined ? 'unobserved' : num(alive)} | ` +
        `${exactBalance?.meanExact ?? 'n/a'} | ` +
        `${exactBalance?.medianExact ?? 'n/a'} | ` +
        `${ruin === null || ruin === undefined ? 'unknown' : num(ruin)} | ` +
        `${bankroll.ruinByObservedSessions[String(checkpoint)] ?? 0} |`;
    }),
    '',
    ...Object.entries(bankroll.reachProbability).map(([key, value]) => `- reached ${key} units: ${num(value)}`),
    ...Object.entries(bankroll.fallBelowProbability).map(([key, value]) => `- fell below ${key} units: ${num(value)}`),
    '',
    '## Checks',
    '',
    ...evidence.checks.map((entry) => `- **${entry.status}** \`${entry.id}\`: ${entry.detail}`),
    '',
    '`Alive@N` means the session could still fund the next paid stake after N completed paid spins. A checkpoint',
    'beyond the horizon is unobserved and is reported as such, not as a zero. A session that reached the horizon',
    'is censored; its exact bust time is unknown inside the horizon.',
    '',
  ].join('\n');
}

export function writeValidationArtifacts(
  evidence: MathValidationEvidence,
  attempt: number,
  roots: { artifactRoot?: string; reportRoot?: string; repoRoot?: string } = {},
) {
  const paths = validationArtifactPaths(evidence.gameId, evidence.profileId, attempt, roots);
  mkdirSync(dirname(paths.jsonPath), { recursive: true });
  mkdirSync(dirname(paths.markdownPath), { recursive: true });
  writeFileSync(paths.jsonPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  writeFileSync(paths.bankrollPath, `${JSON.stringify(evidence.bankroll, null, 2)}\n`, 'utf8');
  writeFileSync(paths.markdownPath, bankrollMarkdown(evidence), 'utf8');
  return paths;
}
