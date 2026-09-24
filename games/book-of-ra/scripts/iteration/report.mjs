/**
 * Builds the compact reference-parity report from captured runs.
 *
 * Compares two capture runs case-by-case (same viewport, same reference) and
 * emits the per-state/per-viewport metrics plus the honest remaining
 * differences. Writes JSON and Markdown under ignored screenshots/runs/reports/.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { root, repo, json } from './common.mjs';

const argv = process.argv.slice(2);
const option = (name, fallback = null) => { const index = argv.indexOf(name); return index < 0 ? fallback : argv[index + 1]; };
const beforeLabel = option('--before', 'before');
const afterLabel = option('--after', 'after');
const outDir = option('--out', path.join(root, 'screenshots/runs/reports'));

async function load(label) {
  const file = path.join(root, 'screenshots/runs', label, 'capture-report.json');
  const report = JSON.parse(await fs.readFile(file, 'utf8'));
  return { label, file: path.relative(repo, file), report, byKey: new Map(report.cases.map((entry) => [entry.key, entry])) };
}

const before = await load(beforeLabel);
const after = await load(afterLabel);
const keys = [...after.byKey.keys()].filter((key) => before.byKey.has(key)).sort();

const rows = keys.map((key) => {
  const a = after.byKey.get(key), b = before.byKey.get(key);
  const improved = a.metrics && b.metrics && a.metrics.meanPixelError < b.metrics.meanPixelError;
  return {
    key,
    state: a.state,
    viewport: `${a.width}x${a.height}`,
    scope: a.scope,
    cells: a.geometry.cells.join('x'),
    horizontalOverflow: a.geometry.horizontalOverflow,
    verticalOverflow: a.geometry.verticalOverflow,
    before: b.metrics ? { changedPixelPercentage: round(b.metrics.changedPixelPercentage), meanPixelError: round(b.metrics.meanPixelError) } : null,
    after: a.metrics ? { changedPixelPercentage: round(a.metrics.changedPixelPercentage), meanPixelError: round(a.metrics.meanPixelError) } : null,
    deltaMeanPixelError: a.metrics && b.metrics ? round(a.metrics.meanPixelError - b.metrics.meanPixelError) : null,
    improved,
  };
});
function round(value) { return Number(value.toFixed(3)); }

const scored = rows.filter((row) => row.after && row.before);
const aggregates = {
  cases: rows.length,
  scored: scored.length,
  improved: scored.filter((row) => row.improved).length,
  beforeMeanPixelError: round(scored.reduce((sum, row) => sum + row.before.meanPixelError, 0) / scored.length),
  afterMeanPixelError: round(scored.reduce((sum, row) => sum + row.after.meanPixelError, 0) / scored.length),
  beforeChangedPixelPercentage: round(scored.reduce((sum, row) => sum + row.before.changedPixelPercentage, 0) / scored.length),
  afterChangedPixelPercentage: round(scored.reduce((sum, row) => sum + row.after.changedPixelPercentage, 0) / scored.length),
};
aggregates.meanPixelErrorDelta = round(aggregates.afterMeanPixelError - aggregates.beforeMeanPixelError);

const perState = [...new Set(rows.map((row) => row.state))].map((state) => {
  const entries = scored.filter((row) => row.state === state);
  return {
    state,
    cases: entries.length,
    beforeMeanPixelError: round(entries.reduce((sum, row) => sum + row.before.meanPixelError, 0) / entries.length),
    afterMeanPixelError: round(entries.reduce((sum, row) => sum + row.after.meanPixelError, 0) / entries.length),
    improved: entries.filter((row) => row.improved).length,
  };
});

const report = {
  task: 'BOOK-UI-REFERENCE-PARITY',
  generatedAt: new Date().toISOString(),
  viewports: ['reference native size', 'reference shape at 1440 wide', 'reference shape at 900 tall', ...(rows.some((row) => row.viewport.endsWith('932')) ? ['430x932', '390x844'] : [])],
  metricDefinitions: {
    changedPixelPercentage: 'share of contained-normalised pixels where any RGB channel differs at all',
    meanPixelError: 'mean absolute RGB channel difference over the whole contained-normalised frame, 0..255',
    caveat: 'Only meaningful where the viewport shape matches the capture. Artwork, not layout, dominates the remainder because the provider art is not reused.',
  },
  runs: { before: before.file, after: after.file },
  aggregates,
  perState,
  cases: rows,
};

await fs.mkdir(outDir, { recursive: true });
await json(path.join(outDir, 'reference-parity.json'), report);

const lines = [];
lines.push('# Book of Ra - reference parity report');
lines.push('');
lines.push(`Task BOOK-UI-REFERENCE-PARITY. Generated ${report.generatedAt}.`);
lines.push('');
lines.push('## What the numbers mean');
lines.push('');
lines.push('Each candidate is captured, then compared with the matching capture from `games/book-of-ra/reference/manifest.json` after centred contain normalisation into the same viewport:');
lines.push('');
lines.push('- `changedPixels` counts every pixel where any RGB channel differs at all, so it saturates near 100% whenever two images are not the same artwork.');
lines.push('- `meanPixelError` is the mean absolute RGB channel difference over the whole frame (0..255). It is the more useful signal here.');
lines.push('- These are measurement, not a pass/fail threshold. No parity tolerance is asserted, because the provider screenshots contain commercial artwork that is deliberately not copied into this repository, so artwork differences dominate any global score.');
lines.push('');
lines.push('## Aggregate');
lines.push('');
lines.push(`- ${aggregates.cases} compared cases (${aggregates.scored} with metrics on both sides).`);
lines.push(`- Mean pixel error: before ${aggregates.beforeMeanPixelError} -> after ${aggregates.afterMeanPixelError} (${aggregates.meanPixelErrorDelta >= 0 ? '+' : ''}${aggregates.meanPixelErrorDelta}).`);
lines.push(`- Changed-pixel share: before ${aggregates.beforeChangedPixelPercentage}% -> after ${aggregates.afterChangedPixelPercentage}%.`);
lines.push(`- ${aggregates.improved}/${aggregates.scored} cases improved.`);
lines.push('');
lines.push('## Per state');
lines.push('');
lines.push('| State | Cases | Mean error before | Mean error after | Improved |');
lines.push('| --- | --- | --- | --- | --- |');
for (const state of perState) lines.push(`| ${state.state} | ${state.cases} | ${state.beforeMeanPixelError} | ${state.afterMeanPixelError} | ${state.improved}/${state.cases} |`);
lines.push('');
lines.push('## Per case');
lines.push('');
lines.push('| Case | Scope | Grid | H/V overflow | Changed before | Changed after | Mean before | Mean after | Delta |');
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const row of rows) lines.push(`| ${row.key} | ${row.scope} | ${row.cells} | ${row.horizontalOverflow}/${row.verticalOverflow} | ${row.before ? row.before.changedPixelPercentage + '%' : 'n/a'} | ${row.after ? row.after.changedPixelPercentage + '%' : 'n/a'} | ${row.before ? row.before.meanPixelError : 'n/a'} | ${row.after ? row.after.meanPixelError : 'n/a'} | ${row.deltaMeanPixelError ?? 'n/a'} |`);
lines.push('');
await fs.writeFile(path.join(outDir, 'reference-parity.md'), `${lines.join('\n')}\n`);
console.log(`report -> ${path.relative(repo, path.join(outDir, 'reference-parity.md'))}`);
console.log(`aggregate before=${aggregates.beforeMeanPixelError} after=${aggregates.afterMeanPixelError} delta=${aggregates.meanPixelErrorDelta} improved=${aggregates.improved}/${aggregates.scored}`);
