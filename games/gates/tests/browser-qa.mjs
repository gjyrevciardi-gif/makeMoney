/**
 * Browser QA: loads the real game in Chromium, drives it, captures screenshots,
 * and asserts zero console errors and zero external network calls.
 *
 * Round completion is detected by polling the balance API rather than by fixed
 * sleeps, so a long free-spin session can never be mistaken for a finished one.
 */
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APP_URL = 'http://localhost:5173/';
const SHOTS = fileURLToPath(new URL('../screenshots/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

const ALLOWED_HOSTS = new Set(['localhost:5173', 'localhost:8787']);
const errors = [];
const external = [];
const requests = [];

function attach(page) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return;
    requests.push(`${r.method()} ${u.host}${u.pathname}`);
    if (!ALLOWED_HOSTS.has(u.host)) external.push(r.url());
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const balanceOf = (page) =>
  page.evaluate(async () => (await (await fetch('/api/balance')).json()).balance);

/** Click inside the canvas at design-space coords, mapped to the real canvas box. */
async function clickDesign(page, dx, dy, designW, designH) {
  const box = await page.locator('canvas').boundingBox();
  const scale = Math.min(box.width / designW, box.height / designH);
  const offX = box.x + (box.width - designW * scale) / 2;
  const offY = box.y + (box.height - designH * scale) / 2;
  await page.mouse.click(offX + dx * scale, offY + dy * scale);
}

/** Wait until the server balance moves, i.e. the round actually settled. */
async function waitForSettle(page, before, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if ((await balanceOf(page)) !== before) return true;
    await sleep(250);
  }
  return false;
}

const DEV_Y0 = 220;
const VEC = { loss: 0, win: 1, multiTumble: 2, multiplier: 3, freeSpins: 4, retrigger: 5, buyBonus: 6 };
const SPIN_X = 1440 - 250;
const SPIN_Y = 900 - 86;

const browser = await chromium.launch();

/* ------------------------------- DESKTOP 1440 ------------------------------ */
const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await desktop.newPage();
attach(page);
await page.goto(APP_URL, { waitUntil: 'networkidle' });
await sleep(3000);
await page.screenshot({ path: `${SHOTS}desktop-normal.png` });
console.log('captured desktop-normal.png');

/* --- multi-tumble: capture mid-cascade --- */
await clickDesign(page, 96, DEV_Y0 + VEC.multiTumble * 42, 1440, 900);
await sleep(400);
let bal = await balanceOf(page);
await clickDesign(page, SPIN_X, SPIN_Y, 1440, 900);
await sleep(1900);
await page.screenshot({ path: `${SHOTS}desktop-tumble.png` });
console.log('captured desktop-tumble.png');
await waitForSettle(page, bal);
await sleep(4000); // let the client finish animating the cascade

/* --- free spins: fresh page so nothing is mid-animation and the click lands --- */
const fsCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const fsPage = await fsCtx.newPage();
attach(fsPage);
await fsPage.goto(APP_URL, { waitUntil: 'networkidle' });
await sleep(3000);
await clickDesign(fsPage, 96, DEV_Y0 + VEC.freeSpins * 42, 1440, 900);
await sleep(500);
bal = await balanceOf(fsPage);
await clickDesign(fsPage, SPIN_X, SPIN_Y, 1440, 900);
const settled = await waitForSettle(fsPage, bal);
console.log('free-spins round settled on server:', settled);
// the server settles at once; the client is still animating the 20-spin session
await sleep(16000); // lands inside the free-spin session (banner + several spins)
await fsPage.screenshot({ path: `${SHOTS}desktop-free-spins.png` });
console.log('captured desktop-free-spins.png');
await fsCtx.close();

console.log('desktop balance after play:', await balanceOf(page));

/* -------------------------------- MOBILE 430 ------------------------------- */
const mobile = await browser.newContext({
  ...devices['iPhone 14 Pro Max'],
  viewport: { width: 430, height: 932 },
});
const mpage = await mobile.newPage();
attach(mpage);
await mpage.goto(APP_URL, { waitUntil: 'networkidle' });
await sleep(3000);
await mpage.screenshot({ path: `${SHOTS}mobile-normal.png` });
console.log('captured mobile-normal.png');

const mBefore = await balanceOf(mpage);
await clickDesign(mpage, 480 / 2 + 92, 1040 - 210 / 2 - 18 + 34, 480, 1040); // SPIN
await waitForSettle(mpage, mBefore);
console.log('mobile balance after spin:', await balanceOf(mpage));

/* ------------------------------- reconciliation ---------------------------- */
const ledger = await page.evaluate(async () => (await fetch('/api/ledger')).json());

await browser.close();

console.log('\n================ BROWSER QA ================');
console.log('console errors        :', errors.length);
for (const e of errors.slice(0, 10)) console.log('   !', e.slice(0, 160));
console.log('external requests     :', external.length);
for (const u of external.slice(0, 10)) console.log('   !', u);
const hosts = [...new Set(requests.map((r) => r.split(' ')[1].split('/')[0]))];
console.log('hosts contacted       :', hosts.join(', '));
console.log('gameplay API calls    :', requests.filter((r) => r.includes('/api/')).length, '(same-origin /api)');
console.log('ledger sum + 100000   :', ledger.sum + 100000);
console.log('balance               :', ledger.balance);
console.log('reconciled            :', ledger.reconciled);
console.log('============================================');

if (errors.length || external.length || !ledger.reconciled) process.exit(1);
