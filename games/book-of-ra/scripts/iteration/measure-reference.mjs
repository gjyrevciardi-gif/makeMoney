/**
 * Derives measured presentation geometry from the approved reference captures.
 *
 * Read-only: it decodes the reference PNGs in a headless browser and reports
 * landmark proportions (pillar/frame/grid/control-panel bands). It never writes
 * to the references and never turns them into player assets.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { root, playwrightEntry, json } from './common.mjs';

const manifest = JSON.parse(await fs.readFile(path.join(root, 'reference/manifest.json'), 'utf8'));
const { chromium } = await import(new URL(`file:///${playwrightEntry.replaceAll('\\', '/')}`).href);
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const page = await browser.newPage();

const measurements = [];
for (const ref of manifest.references) {
  const file = path.join(root, ref.path);
  const data = (await fs.readFile(file)).toString('base64');
  const result = await page.evaluate(async ({ data }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const { data: px } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const at = (x, y) => { const i = (y * canvas.width + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };
    const isGold = (x, y) => { const [r, g, b] = at(x, y); return r > 140 && g > 95 && b < 140 && r - b > 45 && g > b * 0.7; };
    const isDark = (x, y) => { const [r, g, b] = at(x, y); return r < 70 && g < 70 && b < 70; };
    const isWarm = (x, y) => { const [r, g, b] = at(x, y); return r > 90 && r - b > 40 && g < r && g > b - 20; };

    const columns = new Array(canvas.width).fill(0);
    const rows = new Array(canvas.height).fill(0);
    const darkRows = new Array(canvas.height).fill(0);
    for (let x = 0; x < canvas.width; x++) for (let y = 0; y < canvas.height; y++) {
      if (isGold(x, y)) { columns[x]++; rows[y]++; }
      if (isDark(x, y)) darkRows[y]++;
    }
    const share = (list) => list.map((v, i) => ({ i, v, share: v / list.length }));
    const peakShare = (list) => Math.max(...list) / list.length;
    // Pillar band: leftmost run of columns whose gold share is close to the max.
    const threshold = Math.max(...columns) * 0.35;
    let gridLeft = 0; while (gridLeft < columns.length && columns[gridLeft] < threshold) gridLeft++;
    let gridRight = columns.length - 1; while (gridRight > 0 && columns[gridRight] < threshold) gridRight--;
    const top = share(rows).filter((r) => r.share > peakShare(rows) * 0.25);
    const dark = share(darkRows).filter((r) => r.share > 0.25);
    return {
      width: canvas.width, height: canvas.height,
      gridLeft, gridRight,
      gridLeftShare: gridLeft / canvas.width, gridRightShare: gridRight / canvas.width,
      goldRowRange: [top[0]?.i ?? 0, top.at(-1)?.i ?? 0],
      darkRowRange: [dark[0]?.i ?? 0, dark.at(-1)?.i ?? 0],
    };
  }, { data });
  measurements.push({ id: ref.id, path: ref.path, state: ref.state, ...result });
}

await browser.close();
await json(path.join(root, 'screenshots/runs/reference-measurements.json'), { generatedAt: new Date().toISOString(), method: 'gold/dark channel sharing per row/column, no crop or asset extraction', measurements });
for (const m of measurements) console.log(`${m.id} ${m.width}x${m.height} pillar=${m.gridLeftShare.toFixed(3)}..${m.gridRightShare.toFixed(3)} goldRows=${m.goldRowRange.join('-')} darkRows=${m.darkRowRange.join('-')}`);
