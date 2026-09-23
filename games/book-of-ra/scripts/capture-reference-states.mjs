import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../slot-skills/node_modules/playwright/index.mjs';

const root = process.cwd();
const refs = await Promise.all(['01-base','02-paylines','03-paytable','04-win','05-free-games','06-gamble','07-autoplay'].map(async state=>{
  const png=await fs.readFile(`screenshots/reference/reference-${state}.png`);
  return [state,png.readUInt32BE(16),png.readUInt32BE(20)];
}));
const archive=path.join(root,'screenshots','runs',`reference-states-${new Date().toISOString().replaceAll(':','-')}`);
await fs.mkdir(archive,{recursive:true});
for(const name of ['current','overlay','diff','state-visual-report.json']) {
  const source=path.join(root,'screenshots',name);
  try {await fs.access(source);} catch {continue;}
  await fs.cp(source,path.join(archive,name),{recursive:true});
}
for (const name of ['reference', 'current', 'overlay', 'diff']) await fs.mkdir(path.join(root, 'screenshots', name), { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const [state, width, height] of refs) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.route('**/v1/state/**',route=>route.fulfill({json:{featureState:{}}}));
    await page.goto(`http://127.0.0.1:4175/?state=${state}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    if(state==='01-base') await page.evaluate(()=>{
      const el=document.querySelector('slot-game');el.setAttribute('visual-preview','');
      el.previewGrid([['low-2','high-4','low-4'],['low-4','low-5','low-2'],['low-3','low-4','low-5'],['low-3','high-4','high-3'],['low-3','high-1','low-1']]);
      el.removeAttribute('visual-preview');
    });
    if (state === '03-paytable') { await page.locator('.paytable').click(); await page.locator('dialog[open]').waitFor(); }
    if (state === '02-paylines' || state === '04-win') {
      await page.evaluate(async () => { const el = document.querySelector('slot-game'); const grid = [['low-2','low-2','low-2'],['low-2','low-2','low-2'],['low-2','low-2','low-2'],['low-2','low-2','low-2'],['low-2','low-2','low-2']]; const cells = [0,1,2,3,4].map(reel => ({ reel, row: 1 })); await el.playResult({ roundId:'fixture',gameId:'book-of-the-sands',gameVersion:'1',playerId:'fixture',betUnits:'10',totalWinUnits:'500',netUnits:'400',finalGrid:grid,wins:[],draws:[],featureState:{},complete:true,outcomeHash:'fixture',events:[{sequence:0,type:'grid-reveal',data:{grid}},{sequence:1,type:'win',data:{cells,payoutUnits:'500',regular:true}},{sequence:2,type:'round-complete',data:{totalWinUnits:'500'}}]}); });
    }
    if (state === '05-free-games') {
      await page.evaluate(async () => { const el = document.querySelector('slot-game'); const grid = [['low-2','scatter','low-2'],['low-2','scatter','low-2'],['low-2','low-2','low-2'],['low-2','low-2','low-2'],['low-2','low-2','low-2']]; await el.playResult({roundId:'fixture',gameId:'book-of-the-sands',gameVersion:'1',playerId:'fixture',betUnits:'10',totalWinUnits:'0',netUnits:'-100',finalGrid:grid,wins:[],draws:[],featureState:{},complete:true,outcomeHash:'fixture',events:[{sequence:0,type:'grid-reveal',data:{grid}},{sequence:1,type:'feature-start',data:{featureId:'free-spins',spins:10,specialSymbol:'low-2'}},{sequence:2,type:'round-complete',data:{totalWinUnits:'0'}}]}); });
    }
    if (state === '06-gamble') {
      await page.evaluate(async () => { const el = document.querySelector('slot-game'); await el.playResult({roundId:'fixture',gameId:'book-of-the-sands',gameVersion:'1',playerId:'fixture',betUnits:'10',totalWinUnits:'3000',netUnits:'2900',finalGrid:[['low-2','low-2','low-2'],['low-2','low-2','low-2'],['low-2','low-2','low-2'],['low-2','low-2','low-2'],['low-2','low-2','low-2']],wins:[],draws:[],featureState:{},complete:false,pendingAction:{id:'fixture:gamble',type:'gamble',featureId:'gamble-feature',choices:[{id:'red',labelKey:'Red'},{id:'black',labelKey:'Black'},{id:'collect',labelKey:'Collect'}]},outcomeHash:'fixture',events:[]}); });
      await page.locator('slot-game').locator('.bonus.active').waitFor({ state: 'attached', timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(250);
    }
    if (state === '07-autoplay') { await page.evaluate(()=>{
      const el=document.querySelector('slot-game');el.setAttribute('visual-preview','');
      el.previewGrid([['low-3','low-5','low-1'],['high-2','low-3','low-5'],['low-2','high-2','low-1'],['low-4','low-3','high-4'],['low-2','high-2','low-3']]);
      el.removeAttribute('visual-preview');
    }); }
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(root, 'screenshots', 'current', `${state}.png`) });
    await page.close();
  }
} finally { await browser.close(); }
console.log('Captured seven state screenshots in screenshots/current/.');
