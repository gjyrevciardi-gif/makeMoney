/** Playwright capture + exact RGB comparison. Run from any working directory. */
import { chromium } from '../slot-skills/node_modules/playwright/index.mjs';
import { mkdir, readdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VIEWPORTS = [[1440, 900], [430, 932], [390, 844]];
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const url = option('--url', 'http://127.0.0.1:4175/');
const refDir = resolve(option('--reference-dir', join(ROOT, 'reference')));
const outDir = resolve(option('--output-dir', join(ROOT, 'screenshots')));
const fit = option('--fit', 'contain');
const threshold = Number(option('--threshold', '0'));
const referenceName = option('--reference', 'reference-02.png');
if (!['contain', 'cover', 'stretch'].includes(fit)) throw new Error('Invalid --fit');
if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) throw new Error('--threshold must be an integer 0..255');

async function imageData(file) {
  return `data:${MIME[extname(file).toLowerCase()]};base64,${(await readFile(file)).toString('base64')}`;
}

// Executed inside Chromium. Kept independent of the player and reference contents.
async function compareImages({ current, reference, width, height, fit, threshold }) {
  const load = async (src) => { const img = new Image(); img.src = src; await img.decode(); return img; };
  const canvas = () => { const c = document.createElement('canvas'); c.width = width; c.height = height; return c; };
  const normalize = (img) => {
    const c = canvas(), ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);
    const scale = fit === 'cover' ? Math.max(width / img.width, height / img.height) : Math.min(width / img.width, height / img.height);
    const dw = fit === 'stretch' ? width : img.width * scale;
    const dh = fit === 'stretch' ? height : img.height * scale;
    ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh);
    return { canvas: c, pixels: ctx.getImageData(0, 0, width, height).data,
      transform: { sourceWidth: img.width, sourceHeight: img.height, x: (width - dw) / 2, y: (height - dh) / 2, width: dw, height: dh, fit } };
  };
  const a = normalize(await load(current)), b = normalize(await load(reference));
  const overlay = canvas(), diff = canvas();
  const overlayContext = overlay.getContext('2d'), diffContext = diff.getContext('2d');
  const overlayPixels = overlayContext.createImageData(width, height), diffPixels = diffContext.createImageData(width, height);
  let changed = 0, totalError = 0;
  const tiles = new Map();
  for (let i = 0; i < a.pixels.length; i += 4) {
    let max = 0, error = 0;
    for (let channel = 0; channel < 3; channel++) {
      const delta = Math.abs(a.pixels[i + channel] - b.pixels[i + channel]);
      diffPixels.data[i + channel] = delta;
      overlayPixels.data[i + channel] = Math.round((a.pixels[i + channel] + b.pixels[i + channel]) / 2);
      max = Math.max(max, delta); error += delta;
    }
    overlayPixels.data[i + 3] = diffPixels.data[i + 3] = 255;
    if (max > threshold) changed++;
    totalError += error;
    const px = i / 4, x = Math.floor((px % width) / 64) * 64, y = Math.floor(Math.floor(px / width) / 64) * 64;
    const key = `${x},${y}`;
    const tile = tiles.get(key) ?? { x, y, width: Math.min(64, width - x), height: Math.min(64, height - y), error: 0, pixels: 0 };
    tile.error += error; tile.pixels++; tiles.set(key, tile);
  }
  overlayContext.putImageData(overlayPixels, 0, 0); diffContext.putImageData(diffPixels, 0, 0);
  return { images: { reference: b.canvas.toDataURL(), overlay: overlay.toDataURL(), diff: diff.toDataURL() },
    metrics: { changedPixels: changed, totalPixels: width * height, changedPixelPercentage: changed * 100 / (width * height),
      meanPixelError: totalError / (width * height * 3), threshold, referenceTransform: b.transform,
      largestMismatchRegions: [...tiles.values()].map(({ error, pixels, ...box }) => ({ ...box, meanPixelError: error / (pixels * 3) }))
        .sort((a, b) => b.meanPixelError - a.meanPixelError).slice(0, 10) } };
}

async function selfTest(browser) {
  const page = await browser.newPage();
  const fixtures = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 2; c.height = 1;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 2, 1);
    const black = c.toDataURL(); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1, 1);
    return { black, half: c.toDataURL() };
  });
  const input = { current: fixtures.black, reference: fixtures.half, width: 2, height: 1, fit: 'contain', threshold: 0 };
  const result = await page.evaluate(compareImages, input);
  assert.equal(result.metrics.changedPixelPercentage, 50);
  assert.equal(result.metrics.meanPixelError, 127.5);
  const identical = await page.evaluate(compareImages, { ...input, reference: fixtures.black });
  assert.equal(identical.metrics.changedPixels, 0); assert.equal(identical.metrics.meanPixelError, 0);
  const ignored = await page.evaluate(compareImages, { ...input, threshold: 255 });
  assert.equal(ignored.metrics.changedPixels, 0); assert.equal(ignored.metrics.meanPixelError, 127.5);
  const normalized = await page.evaluate(compareImages, { ...input, width: 4, height: 4 });
  assert.deepEqual(normalized.metrics.referenceTransform, { sourceWidth: 2, sourceHeight: 1, x: 0, y: 1, width: 4, height: 2, fit: 'contain' });
  const decoded = await page.evaluate(async ({ overlay, diff }) => {
    const read = async (src) => { const img = new Image(); img.src = src; await img.decode(); const c = document.createElement('canvas'); c.width = 2; c.height = 1; const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0); return [...ctx.getImageData(0, 0, 2, 1).data]; };
    return { overlay: await read(overlay), diff: await read(diff) };
  }, result.images);
  assert.deepEqual(decoded.overlay, [128, 128, 128, 255, 0, 0, 0, 255]);
  assert.deepEqual(decoded.diff, [255, 255, 255, 255, 0, 0, 0, 255]);
  await page.close(); console.log('PASS: exact RGB metrics, threshold, normalization, 50% overlay, absolute difference, and PNG decoding.');
}

async function main(browser) {
  await mkdir(outDir, { recursive: true });
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const archive = join(outDir, 'runs', runId); await mkdir(archive, { recursive: true });
  const analysis = await browser.newPage();
  const references = [];
  for (const entry of await readdir(refDir, { withFileTypes: true })) {
    if (!entry.isFile() || !MIME[extname(entry.name).toLowerCase()]) continue;
    const data = await imageData(join(refDir, entry.name));
    const size = await analysis.evaluate(async (src) => { const img = new Image(); img.src = src; await img.decode(); return { width: img.width, height: img.height }; }, data);
    references.push({ name: entry.name, ...size, data });
  }
  const report = { runId, url, referenceDirectory: refDir, fit, threshold,
    metricDefinition: 'Changed pixel: any RGB channel absolute delta > threshold. Mean pixel error: sum absolute RGB deltas / (width * height * 3), range 0..255. Alpha flattened onto black.',
    referenceInventory: references.map(({ data, ...ref }) => ref), viewports: [] };
  for (const [width, height] of VIEWPORTS) {
    const key = `${width}x${height}`;
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1,
      isMobile: width < 600, hasTouch: width < 600, reducedMotion: 'reduce', colorScheme: 'dark' });
    // Only read-only navigation/assets are allowed during this visual run.
    await context.route('**/*', (route) => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort());
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', response => { if(response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`); });
    const response = await page.goto(url, { waitUntil: 'networkidle' });
    if (!response?.ok()) throw new Error(`Player returned HTTP ${response?.status()}`);
    await page.locator('slot-game .reel-canvas').waitFor({ state: 'visible' });
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode().catch(() => {}))); });
    // Wait for the canvas and its asynchronously preloaded symbols to stabilize.
    let previous = '', stable = 0;
    for (let attempt = 0; attempt < 40 && stable < 3; attempt++) {
      const pixels = await page.locator('slot-game .reel-canvas').evaluate(c => c.toDataURL());
      stable = pixels === previous ? stable + 1 : 0; previous = pixels;
      await page.waitForTimeout(100);
    }
    if (stable < 3) throw new Error(`Canvas did not stabilize at ${key}; supply a deterministic visual state.`);
    const geometry = await page.evaluate(() => {
      const host = document.querySelector('slot-game'), shadow = host.shadowRoot;
      const box = (element) => { if (!element) return null; const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      return { viewport: { width: innerWidth, height: innerHeight }, horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        verticalOverflow: Math.max(0, document.documentElement.scrollHeight - innerHeight),
        host: box(host), game: box(shadow.querySelector('.game')), cabinet: box(shadow.querySelector('.stage')), reels: box(shadow.querySelector('.reel-canvas')),
        meters: box(shadow.querySelector('.cab-meters')), deck: box(shadow.querySelector('.cab-deck')),
        controls: [...shadow.querySelectorAll('.cab-meter, .cab-deck button')].map(el => ({ text: el.textContent.trim(), ...box(el) })),
        accessibleGrid: shadow.querySelector('.sr-grid')?.textContent,
        drawnGeometry: host.presentationGeometry?.() ?? null };
    });
    const currentName = `current-${key}.png`;
    await page.screenshot({ path: join(outDir, currentName), fullPage: false, animations: 'disabled' });
    await copyFile(join(outDir, currentName), join(archive, currentName));
    await context.close();
    // Never substitute a landscape reference for a portrait viewport or vice versa.
    const candidates = references.filter(ref => referenceName ? ref.name === referenceName : (ref.width > ref.height) === (width > height));
    const score = ref => Math.abs(Math.log((ref.width / ref.height) / (width / height)));
    candidates.sort((a, b) => score(a) - score(b) || Math.abs(a.width - width) - Math.abs(b.width - width) || a.name.localeCompare(b.name));
    const reference = candidates[0];
    const entry = { viewport: key, geometry, browserErrors: errors, status: reference ? 'compared' : 'missing-reference', reference: reference?.name ?? null,
      referenceScope: reference && (reference.width > reference.height) !== (width > height) ? 'Landscape reference normalized for comparison only; portrait geometry is an adaptation, not verified parity.' : 'Matching orientation',
      changedPixelPercentage: null, meanPixelError: null, files: { current: currentName } };
    if (reference) {
      const result = await analysis.evaluate(compareImages, { current: await imageData(join(outDir, currentName)), reference: reference.data, width, height, fit, threshold });
      Object.assign(entry, result.metrics);
      for (const [kind, data] of Object.entries(result.images)) {
        const name = `${kind}-${key}.png`; entry.files[kind] = name;
        await writeFile(join(outDir, name), Buffer.from(data.split(',')[1], 'base64'));
        await copyFile(join(outDir, name), join(archive, name));
      }
    }
    report.viewports.push(entry);
    console.log(`${key}: ${entry.status}; changed=${entry.changedPixelPercentage ?? 'N/A'}%; mean error=${entry.meanPixelError ?? 'N/A'}; overflow=${geometry.horizontalOverflow}px`);
  }
  report.status = report.viewports.some(v => v.status === 'missing-reference') ? 'blocked-missing-references' : 'compared';
  await writeFile(join(outDir, 'visual-report.json'), JSON.stringify(report, null, 2) + '\n');
  await copyFile(join(outDir, 'visual-report.json'), join(archive, 'visual-report.json'));
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Book of Ra visual comparison</title>
    <style>body{background:#171717;color:#eee;font:16px system-ui;margin:24px}section{border-top:1px solid #666;padding:16px 0}.images{display:flex;gap:16px;flex-wrap:wrap}figure{margin:0;max-width:46%}img{display:block;max-width:100%;max-height:640px;object-fit:contain;object-position:top left}figcaption{margin:8px 0}pre{white-space:pre-wrap}a{color:#9cf}</style>
    <h1>Visual comparison: ${escape(report.status)}</h1><p>${escape(runId)} · <a href="visual-report.json">Full measurements</a></p>
    <p>${escape(report.metricDefinition)}</p><p>Reference normalization: ${fit}. Missing references produce no reference, overlay, or diff images. Only files linked below belong to this report.</p>
    ${report.viewports.some(v => v.referenceScope?.startsWith('Landscape')) ? '<p><strong>Portrait limitation:</strong> No portrait reference was supplied. Mobile scores compare the adapted portrait page with a letterboxed landscape screenshot; they do not establish mobile parity.</p>' : ''}
    ${report.viewports.map(v => `<section><h2>${v.viewport}</h2><p>${v.status} · Reference: ${escape(v.reference ?? 'none supplied')} · Changed pixels: ${v.changedPixelPercentage ?? 'N/A'}% · Mean error: ${v.meanPixelError ?? 'N/A'} · Horizontal overflow: ${v.geometry.horizontalOverflow}px</p><div class="images">${Object.entries(v.files).map(([kind, name]) => `<figure><figcaption>${kind}</figcaption><a href="${name}"><img src="${name}" alt="${kind} ${v.viewport}"></a></figure>`).join('')}</div></section>`).join('')}</html>`;
  await writeFile(join(outDir, 'visual-report.html'), html);
  await copyFile(join(outDir, 'visual-report.html'), join(archive, 'visual-report.html'));
  await analysis.close();
  console.log(`Report: ${join(outDir, 'visual-report.json')}`);
  if (report.status === 'blocked-missing-references') process.exitCode = 2;
  else if (report.viewports.some(v => v.browserErrors.length || v.geometry.horizontalOverflow > 0)) process.exitCode = 1;
}

const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
try { if (args.includes('--self-test')) await selfTest(browser); else await main(browser); }
finally { await browser.close(); }
