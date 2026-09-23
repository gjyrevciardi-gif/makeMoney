import { chromium } from '../slot-skills/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
await page.goto('http://127.0.0.1:4175/', { waitUntil: 'networkidle' });
await page.locator('slot-game').waitFor();
const before = await page.locator('slot-game').evaluate((element) => element.shadowRoot.querySelector('.sr-grid').textContent);
await page.locator('slot-game').evaluate((element) => element.shadowRoot.querySelector('.spin').click());
await page.waitForFunction(() => document.querySelector('slot-game')?.shadowRoot.querySelector('.state')?.textContent !== 'READY', undefined, { timeout: 3000 });
await page.waitForFunction(() => ['READY', 'WIN', 'FEATURE'].includes(document.querySelector('slot-game')?.shadowRoot.querySelector('.state')?.textContent ?? ''), undefined, { timeout: 20000 });
await page.waitForTimeout(300);
const after = await page.locator('slot-game').evaluate((element) => ({
  grid: element.shadowRoot.querySelector('.sr-grid').textContent,
  state: element.shadowRoot.querySelector('.state').textContent,
  credit: element.shadowRoot.querySelector('[data-credit]')?.textContent,
  win: element.shadowRoot.querySelector('.win-total output')?.textContent,
}));
console.log(JSON.stringify({ before, after, errors }, null, 2));
await page.screenshot({ path: 'screenshots/backend-spin-1440x900.png' });
await browser.close();
if (errors.length || before === after.grid) process.exitCode = 1;
