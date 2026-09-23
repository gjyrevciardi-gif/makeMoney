import assert from 'node:assert/strict';
import { chromium } from '../slot-skills/node_modules/playwright/index.mjs';
import { symbols } from '../player/symbols.mjs';
const browser=await chromium.launch({headless:true});
try{
 for(const [width,height] of [[1440,900],[430,932],[390,844]]){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
  const failures=[];page.on('pageerror',e=>failures.push(e.message));
  page.on('response',r=>{if(r.status()>=400)failures.push(`${r.status()} ${r.url()}`);});
  await page.goto('http://127.0.0.1:4175/',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
  const result=await page.evaluate(async(registry)=>{
   const element=document.querySelector('slot-game'),root=element.shadowRoot;
   const images=await Promise.all(Object.values(registry).map(async art=>{const img=new Image();img.src='/'+art.src;await img.decode();return {width:img.naturalWidth,height:img.naturalHeight};}));
   const bounds=element.getBoundingClientRect();
   return {overflow:document.documentElement.scrollWidth-innerWidth,vertical:document.documentElement.scrollHeight-innerHeight,
    bounds:{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height},geometry:element.presentationGeometry(),images,
    disabled:root.querySelector('.spin').disabled,grid:root.querySelector('.sr-grid').textContent,
    minus:[...root.querySelectorAll('.meter-adjust')].map(el=>el.textContent),title:document.title};
  },symbols);
  assert.equal(result.overflow,0);assert.equal(result.vertical,0);assert.equal(result.geometry.cells.length,5);
  assert.ok(result.geometry.cells.every(column=>column.length===3));assert.equal(result.images.length,11);
  assert.ok(result.images.every(image=>image.width>0&&image.height>0));assert.equal(result.disabled,false);
  assert.deepEqual(result.minus,['−','+','−','+']);assert.ok(!result.title.includes('Sands'));assert.deepEqual(failures,[]);
  if(width===1440){assert.ok(Math.abs(result.bounds.x-(1440-1120)/2)<1);assert.ok(result.bounds.width<=1120.5);}
  await page.locator('.paytable').click();await page.locator('dialog').waitFor({state:'visible'});
  await page.locator('dialog .close').click();assert.equal(await page.locator('dialog').isVisible(),false);
  console.log(`PASS ${width}x${height}: bounds, zero overflow, 5x3, 11 decodable image registrations, fixture controls, paytable dialog, no resource/browser errors.`);
  await page.close();
 }
}finally{await browser.close();}
