/**
 * Local inspection helper: writes a cropped/scaled copy of an image into a
 * gitignored screenshots/runs folder for side-by-side visual review.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { root, playwrightEntry } from './common.mjs';

const argv = process.argv.slice(2);
const option = (name, fallback = null) => { const index = argv.indexOf(name); return index < 0 ? fallback : argv[index + 1]; };
const source = option('--file');
const output = option('--out', path.join(root, 'screenshots/runs/crops/crop.png'));
const [x, y, width, height] = option('--box', '0,0,0,0').split(',').map(Number);
const scale = Number(option('--scale', '1'));

const { chromium } = await import(new URL(`file:///${playwrightEntry.replaceAll('\\', '/')}`).href);
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const page = await browser.newPage();
const data = (await fs.readFile(source)).toString('base64');
const clipped = await page.evaluate(async ({ data, x, y, width, height, scale }) => {
  const image = new Image();
  image.src = `data:image/png;base64,${data}`;
  await image.decode();
  const w = width || image.width, h = height || image.height;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(image, x, y, w, h, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}, { data, x, y, width, height, scale });
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, Buffer.from(clipped.split(',')[1], 'base64'));
console.log(path.relative(root, output));
await browser.close();
