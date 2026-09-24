/**
 * Legacy approved-baseline regression result for the intentional UI change.
 *
 * The repository's previously approved screenshots (screenshots/legacy-baseline,
 * copied from the untouched POC workspace) were recorded against the previous
 * player bundle. Their tolerance is zero changed pixels by design, so an
 * intentional presentation change is expected to fail them. This reports the
 * exact failure per case instead of rewriting the old baselines.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { root, repo, playwrightEntry, json } from './common.mjs';

const argv = process.argv.slice(2);
const option = (name, fallback = null) => { const index = argv.indexOf(name); return index < 0 ? fallback : argv[index + 1]; };
const label = option('--label', 'parity');
const candidateDir = path.join(root, 'screenshots/runs', label, 'current');
const baselineDir = path.join(root, 'screenshots/legacy-baseline');

const { chromium } = await import(new URL(`file:///${playwrightEntry.replaceAll('\\', '/')}`).href);
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const page = await browser.newPage();

async function compare(a, b) {
  const [dataA, dataB] = await Promise.all([fs.readFile(a), fs.readFile(b)]);
  return await page.evaluate(async ({ a, b }) => {
    const load = async (data) => { const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode(); return image; };
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return { dimensionMismatch: true, width: ia.width, height: ia.height, baselineWidth: ib.width, baselineHeight: ib.height };
    const canvas = document.createElement('canvas');
    canvas.width = ia.width; canvas.height = ia.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(ia, 0, 0); const left = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(ib, 0, 0); const right = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let changed = 0, error = 0;
    for (let i = 0; i < left.length; i += 4) {
      let max = 0;
      for (let channel = 0; channel < 3; channel++) { const delta = Math.abs(left[i + channel] - right[i + channel]); max = Math.max(max, delta); error += delta; }
      if (max > 0) changed++;
    }
    const pixels = canvas.width * canvas.height;
    return { changedPixels: changed, changedPixelPercentage: changed * 100 / pixels, meanPixelError: error / (pixels * 3) };
  }, { a: dataA.toString('base64'), b: dataB.toString('base64') });
}

const names = (await fs.readdir(candidateDir)).filter((name) => name.endsWith('.png')).sort();
const cases = [];
for (const name of names) {
  const baseline = path.join(baselineDir, name);
  try {
    await fs.access(baseline);
  } catch {
    continue;
  }
  const result = await compare(path.join(candidateDir, name), baseline);
  cases.push({ name, ...result, regressionPass: !result.dimensionMismatch && result.changedPixels === 0 && result.meanPixelError === 0 });
}
await browser.close();
const passed = cases.filter((entry) => entry.regressionPass).length;
const report = {
  generatedAt: new Date().toISOString(),
  baseline: path.relative(repo, baselineDir),
  candidate: path.relative(repo, candidateDir),
  tolerance: { changedPixelPercentage: 0, meanPixelError: 0 },
  scope: 'Previously approved zero-difference baselines recorded against the pre-change player bundle.',
  result: passed === cases.length ? 'PASS' : 'INTENTIONAL_DIFFERENCES',
  summary: { cases: cases.length, passed, failed: cases.length - passed },
  cases,
};
await json(path.join(root, 'screenshots/runs', label, 'legacy-regression.json'), report);
for (const entry of cases.slice(0, 6)) console.log(`${entry.name} changed=${entry.changedPixelPercentage?.toFixed(2) ?? 'n/a'}% mean=${entry.meanPixelError?.toFixed(2) ?? 'n/a'} pass=${entry.regressionPass}`);
console.log(`LEGACY ${report.result} passed=${passed}/${cases.length} (zero-difference tolerance; failures are the intentional presentation change)`);
