/**
 * Fast reference capture loop: current -> normalized reference -> overlay ->
 * pixel diff, for every reference state at every target viewport. Writes only
 * under screenshots/runs/<label>/ and never rewrites approved baselines.
 *
 * Usage: node scripts/iteration/capture.mjs --label after --case 01-base-1440x900
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { root, playerUrl, playwrightEntry, buildPlayer, ensurePlayer, exists, json } from './common.mjs';
import { prepareState } from './fixtures.mjs';

const { chromium } = await import(new URL(`file:///${playwrightEntry.replaceAll('\\', '/')}`).href);
const argv = process.argv.slice(2);
const option = (name, fallback = null) => { const index = argv.indexOf(name); return index < 0 ? fallback : argv[index + 1]; };
const label = option('--label', 'adhoc');
const onlyCase = option('--case');
const onlyState = option('--state');
// Comparison sizes per reference: the capture itself, the capture's shape at
// 1440 wide, the capture's shape at 900 tall, and the two portrait targets.
// `--with-portrait` adds the portrait layout cases.
const includePortrait = argv.includes('--with-portrait');
const out = path.join(root, 'screenshots/runs', label);
const manifest = JSON.parse(await fs.readFile(path.join(root, 'reference/manifest.json'), 'utf8'));

if (!argv.includes('--skip-build')) console.log((await buildPlayer()).split('\n').at(-1));
await ensurePlayer();

async function compare(page, current, reference, width, height) {
  return await page.evaluate(async ({ a, b, width, height }) => {
    const load = async (data) => { const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode(); return image; };
    const make = () => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas; };
    const paint = (image) => { const canvas = make(), ctx = canvas.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height); const scale = Math.min(width / image.width, height / image.height); const w = image.width * scale, h = image.height * scale; ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h); return { canvas, pixels: ctx.getImageData(0, 0, width, height).data }; };
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const ca = paint(ia), cb = paint(ib);
    const overlay = make(), diff = make(), oc = overlay.getContext('2d'), dc = diff.getContext('2d');
    const op = oc.createImageData(width, height), dp = dc.createImageData(width, height);
    let changed = 0, error = 0;
    for (let i = 0; i < ca.pixels.length; i += 4) {
      let max = 0;
      for (let channel = 0; channel < 3; channel++) { const delta = Math.abs(ca.pixels[i + channel] - cb.pixels[i + channel]); max = Math.max(max, delta); error += delta; op.data[i + channel] = Math.round((ca.pixels[i + channel] + cb.pixels[i + channel]) / 2); dp.data[i + channel] = delta; }
      if (max > 0) changed++;
      op.data[i + 3] = dp.data[i + 3] = 255;
    }
    oc.putImageData(op, 0, 0); dc.putImageData(dp, 0, 0);
    return { changedPixels: changed, changedPixelPercentage: changed * 100 / (width * height), meanPixelError: error / (width * height * 3), reference: cb.canvas.toDataURL(), overlay: overlay.toDataURL(), diff: diff.toDataURL() };
  }, { a: current.toString('base64'), b: reference.toString('base64'), width, height });
}

const saveImage = async (file, data) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.from(data.split(',')[1], 'base64')); };
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const analysis = await browser.newPage();
const cases = [];

for (const reference of manifest.references) {
  if (onlyState && reference.id !== onlyState) continue;
  const referenceData = await fs.readFile(path.join(root, reference.path));
  const native = [referenceData.readUInt32BE(16), referenceData.readUInt32BE(20)];
  const aspect = native[0] / native[1];
  const at1440 = [1440, Math.round(1440 / aspect)];
  const at900 = [Math.round(900 * aspect), 900];
  const portrait = includePortrait ? manifest.viewports.filter(([, height]) => height > 800) : [];
  const sizes = [native, at1440, ...portrait, at900].filter((value, index, all) => all.findIndex((entry) => entry[0] === value[0] && entry[1] === value[1]) === index);
  for (const [width, height] of sizes) {
    const key = `${reference.id}-${width}x${height}`;
    if (onlyCase && onlyCase !== key) continue;
    const sameShape = Math.abs(width / height - native[0] / native[1]) < 0.02;
    const entry = { key, state: reference.state, width, height, reference: reference.path, scope: sameShape ? (width === native[0] && height === native[1] ? 'reference native size' : 'matched reference shape') : (width < height ? 'portrait layout check (no portrait reference supplied)' : 'letterbox proxy: target viewport shape differs from reference') };
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'no-preference', colorScheme: 'dark' });
    const errors = [];
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/v1/state/')) return route.fulfill({ json: { featureState: {} } });
      if (url.pathname.startsWith('/v1/') || !['GET', 'HEAD'].includes(route.request().method())) { errors.push(`Unexpected API request ${route.request().method()} ${url.pathname}`); return route.abort(); }
      return route.continue();
    });
    await context.addInitScript(() => { let seed = 1729; Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => { if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`); });
    const time = new Date('2026-09-21T00:00:00Z');
    await page.clock.install({ time });
    await page.goto(`${playerUrl}?state=${reference.id}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    await page.evaluate(async () => { await document.fonts.ready; const { symbols } = await import('/symbols.mjs'); await Promise.all([...new Set([...Object.values(symbols).map((symbol) => symbol.src), 'player/assets/title-original-v2.png'])].map(async (src) => { const image = new Image(); image.src = '/' + src; await image.decode(); })); });
    await page.clock.pauseAt(new Date(time.getTime() + 60000));
    entry.fixture = await prepareState(page, reference.id);
    entry.geometry = await page.locator('slot-game').evaluate((el) => { const rect = el.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom, horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth), verticalOverflow: Math.max(0, document.documentElement.scrollHeight - innerHeight), cells: el.presentationGeometry().cells.map((column) => column.length) }; });
    entry.errors = errors;
    if (!errors.length) {
      await fs.mkdir(path.join(out, 'current'), { recursive: true });
      const current = await page.screenshot({ path: path.join(out, 'current', `${key}.png`) });
      const comparison = await compare(analysis, current, referenceData, width, height);
      entry.metrics = { changedPixels: comparison.changedPixels, changedPixelPercentage: comparison.changedPixelPercentage, meanPixelError: comparison.meanPixelError };
      for (const kind of ['reference', 'overlay', 'diff']) await saveImage(path.join(out, kind, `${key}.png`), comparison[kind]);
    } else entry.metrics = null;
    await context.close();
    cases.push(entry);
    console.log(`${key} overflow=${entry.geometry.horizontalOverflow}/${entry.geometry.verticalOverflow} cells=${entry.geometry.cells.join('')} ${entry.metrics ? `changed=${entry.metrics.changedPixelPercentage.toFixed(2)}% mean=${entry.metrics.meanPixelError.toFixed(2)}` : `ERRORS ${errors.join('; ')}`}`);
  }
}

await browser.close();
await json(path.join(out, 'capture-report.json'), { label, generatedAt: new Date().toISOString(), playerUrl, referenceNormalization: manifest.referenceNormalization, cases });
const scored = cases.filter((entry) => entry.metrics);
console.log(`CAPTURE ${cases.length} cases, ${scored.length} scored, mean=${scored.length ? (scored.reduce((sum, entry) => sum + entry.metrics.meanPixelError, 0) / scored.length).toFixed(2) : 'n/a'} -> ${path.relative(root, out)}`);
