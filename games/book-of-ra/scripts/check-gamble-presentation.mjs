import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from '../slot-skills/node_modules/playwright/index.mjs';

const dir = `screenshots/runs/gamble-${new Date().toISOString().replaceAll(':','-')}`;
await fs.mkdir(dir, {recursive:true});
const browser = await chromium.launch({headless:true});
const results=[];
try {
 for(const [width,height] of [[1440,900],[1440,740],[430,932],[390,844]]) {
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  // Recover a pending server state without placing a wager or changing the demo wallet.
  await page.route('**/v1/state/**', route=>route.fulfill({json:{featureState:{}}}));
  await page.goto('http://127.0.0.1:4175/',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
  await page.screenshot({path:`${dir}/base-${width}x${height}.png`});
  const initial=await page.locator('slot-game').evaluate(async el=>{
    const img=new Image();img.src='/player/assets/symbol-atlas-original-v2.png';await img.decode();
    return {atlas:[img.naturalWidth,img.naturalHeight],icon:!!el.shadowRoot.querySelector('.spin-icon')};
  });
  assert.deepEqual(initial.atlas,[1983,793]);assert.ok(initial.icon);
  await page.evaluate(async()=>{
    const el=document.querySelector('slot-game');
    const result={roundId:'presentation-test',gameId:'book-of-the-sands',gameVersion:'1',playerId:'demo-player',betUnits:'10',totalWinUnits:'3000',netUnits:'2900',finalGrid:Array.from({length:5},()=>['low-2','high-2','low-3']),wins:[],draws:[],featureState:{},complete:false,roundState:'GAMBLE_PENDING',pendingAction:{id:'presentation-test:gamble',type:'gamble',featureId:'gamble-feature',choices:[{id:'red',labelKey:'Red'},{id:'black',labelKey:'Black'},{id:'collect',labelKey:'Collect'}]},outcomeHash:'fixture',events:[]};
    window.calls=[];
    el.transport={spin:async()=>{throw Error('No spin allowed during gamble');},action:async request=>{window.calls.push(request);await new Promise(r=>setTimeout(r,150));return request.choiceId==='collect'?{...result,complete:true,roundState:'ROUND_COMPLETE',pendingAction:undefined}:{...result,totalWinUnits:'6000',pendingAction:{...result.pendingAction,id:'presentation-test:gamble-2'}};}};
    await el.playResult(result);
  });
  await page.locator('.gamble-screen.active').waitFor({state:'visible'});
  await page.waitForTimeout(350);
  const geometry=await page.locator('slot-game').evaluate(el=>{
    const r=el.shadowRoot, b=e=>e.getBoundingClientRect().toJSON();
    return {host:b(el),stage:b(r.querySelector('.stage')),panel:b(r.querySelector('.bonus-panel')),collect:b(r.querySelector('.spin')),red:b(r.querySelector('[data-style="red"]')),black:b(r.querySelector('[data-style="black"]')),buttons:r.querySelectorAll('.bonus-choice').length,collectLabel:r.querySelector('.spin-label').textContent,autoplayDisabled:r.querySelector('[data-key="autoplay"]').disabled,overflow:document.documentElement.scrollWidth-innerWidth,vertical:document.documentElement.scrollHeight-innerHeight};
  });
  assert.equal(geometry.overflow,0);assert.equal(geometry.vertical,0);
  assert.ok(geometry.host.y>=0&&geometry.host.bottom<=height+1);
  assert.ok(geometry.panel.y>geometry.stage.y&&geometry.panel.bottom<=geometry.stage.bottom);
  assert.ok(geometry.red.right<geometry.black.x);
  assert.ok(geometry.collect.y>=geometry.stage.bottom&&geometry.collect.bottom<=height);
  assert.equal(geometry.buttons,2);assert.equal(geometry.collectLabel,'Collect');assert.ok(geometry.autoplayDisabled);
  await page.screenshot({path:`${dir}/gamble-${width}x${height}.png`});
  await page.locator('[data-style="red"]').evaluate(button=>{button.click();button.click();});
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>window.calls.length),1);
  assert.ok(await page.locator('.gamble-screen.active').isVisible());
  assert.equal(await page.locator('.gamble-amount output').textContent(),'60.00');
  await page.locator('.spin').evaluate(button=>{button.click();button.click();});
  await page.waitForTimeout(500);
  assert.deepEqual(await page.evaluate(()=>window.calls.map(c=>c.choiceId)),['red','collect']);
  assert.equal(await page.locator('.spin-label').textContent(),'Start');
  assert.equal(await page.locator('.bonus.active').count(),0);
  assert.equal(await page.locator('[data-key="autoplay"]').isDisabled(),false);
  await page.evaluate(()=>{
    const el=document.querySelector('slot-game');window.spinCalls=0;
    el.transport={spin:async()=>{
      window.spinCalls++;await new Promise(r=>setTimeout(r,250));
      const grid=Array.from({length:5},()=>['low-4','low-3','high-2']);
      return {roundId:'spin-presentation',gameId:'book-of-the-sands',gameVersion:'1',playerId:'demo-player',betUnits:'10',totalWinUnits:'0',netUnits:'-100',finalGrid:grid,wins:[],draws:[],featureState:{},complete:true,outcomeHash:'fixture',events:[{sequence:0,type:'grid-reveal',data:{grid}}]};
    },action:async()=>{throw Error('Unexpected action');}};
    const button=el.shadowRoot.querySelector('.spin');button.click();button.click();
  });
  assert.equal(await page.locator('.spin').isDisabled(),true);
  assert.equal(await page.locator('.spin-icon').evaluate(icon=>getComputedStyle(icon).animationName),'book-spin');
  assert.equal(await page.locator('.win-message').evaluate(message=>getComputedStyle(message).opacity),'0');
  await page.screenshot({path:`${dir}/spin-${width}x${height}.png`});
  await page.waitForFunction(()=>!document.querySelector('slot-game').shadowRoot.querySelector('.spin').disabled);
  assert.equal(await page.evaluate(()=>window.spinCalls),1);
  assert.equal(await page.locator('slot-game').getAttribute('reels-moving'),null);
  assert.deepEqual(errors,[]);
  results.push({width,height,geometry,status:'PASS'});
  console.log(`PASS ${width}x${height}: atlas decoded; no clipping; in-reel gamble; Collect below; repeated action guard; next gamble retained; controls restored; animated spin icon; duplicate spin guard.`);
  await page.close();
 }
 await fs.writeFile(`${dir}/checks.json`,JSON.stringify(results,null,2));
 console.log(`Review screenshots: ${dir}`);
}finally{await browser.close();}
