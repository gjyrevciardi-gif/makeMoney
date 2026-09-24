/**
 * Local layout probe: dumps bounding boxes of the player's shadow-DOM boxes so
 * geometry changes can be reasoned about from numbers rather than guesses.
 */
import path from 'node:path';
import { root, playerUrl, playwrightEntry, ensurePlayer } from './common.mjs';

const argv = process.argv.slice(2);
const option = (name, fallback = null) => { const index = argv.indexOf(name); return index < 0 ? fallback : argv[index + 1]; };
const state = option('--state', '01-base');
const [width, height] = option('--size', '1255x761').split('x').map(Number);
const { chromium } = await import(new URL(`file:///${playwrightEntry.replaceAll('\\', '/')}`).href);
await ensurePlayer();
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
await context.route('**/*', (route) => {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith('/v1/state/')) return route.fulfill({ json: { featureState: {} } });
  if (url.pathname.startsWith('/v1/')) return route.abort();
  return route.continue();
});
const page = await context.newPage();
await page.goto(`${playerUrl}?state=${state}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const layout = await page.locator('slot-game').evaluate((el) => {
  const round = (value) => Math.round(value * 100) / 100;
  const box = (node) => { if (!node) return null; const rect = node.getBoundingClientRect(); return { x: round(rect.x), y: round(rect.y), w: round(rect.width), h: round(rect.height), bottom: round(rect.bottom), right: round(rect.right) }; };
  const shadow = el.shadowRoot;
  const boxes = {};
  for (const selector of ['*']) { void selector; }
  for (const node of shadow.querySelectorAll('*')) {
    const key = `${node.tagName.toLowerCase()}${node.className && typeof node.className === 'string' ? '.' + node.className.trim().replace(/\s+/g, '.') : ''}`;
    if (boxes[key]) continue;
    const rect = node.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    boxes[key] = box(node);
  }
  const geometry = el.presentationGeometry?.();
  return { host: box(el), canvasWidth: shadow.querySelector('canvas.reel-canvas')?.width, canvasHeight: shadow.querySelector('canvas.reel-canvas')?.height, cells: geometry?.cells?.length ? { glass: geometry.glass, first: geometry.cells[0][0], last: geometry.cells[4][2] } : null, boxes };
});
console.log(JSON.stringify(layout, null, 1));
await browser.close();
console.log(path.relative(root, root));
