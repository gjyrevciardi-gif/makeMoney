import fs from 'node:fs/promises';
import path from 'node:path';
import {root,playerUrl,playwrightEntry,buildPlayer,ensurePlayer,exists,json,fingerprint} from './common.mjs';
import {prepareState} from './fixtures.mjs';
import {assertReelMotion} from './motion.mjs';
const {chromium}=await import(new URL(`file:///${playwrightEntry.replaceAll('\\','/')}`).href);

const started=Date.now(),update=process.argv.includes('--update-baseline');
const reasonIndex=process.argv.indexOf('--reason'),reason=reasonIndex<0?'':process.argv[reasonIndex+1];
const labelIndex=process.argv.indexOf('--label'),label=labelIndex<0?'':process.argv[labelIndex+1];
const runId=`${label?label+'-':'visual-'}${new Date().toISOString().replaceAll(':','-')}`;
const out=path.join(root,'screenshots/runs',runId),baseline=path.join(root,'screenshots/baseline');
const report={status:'FAIL',mode:'approved-behavior-regression',runId,label:label||null,playerUrl,cases:[],failures:[],referenceParity:'Not certified. Reference scores are informational; the unchanged approved player is the regression baseline.'};
let browser;

async function compare(page,current,reference,width,height,fit='exact'){
  return await page.evaluate(async({a,b,width,height,fit})=>{
    const load=async data=>{const im=new Image();im.src=`data:image/png;base64,${data}`;await im.decode();return im;};
    const canvas=()=>{const c=document.createElement('canvas');c.width=width;c.height=height;return c;};
    const paint=im=>{const c=canvas(),ctx=c.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,width,height);const scale=Math.min(width/im.width,height/im.height);const w=fit==='contain'?im.width*scale:width,h=fit==='contain'?im.height*scale:height;ctx.drawImage(im,(width-w)/2,(height-h)/2,w,h);return {c,p:ctx.getImageData(0,0,width,height).data};};
    const [ia,ib]=await Promise.all([load(a),load(b)]);
    if(fit==='exact'&&(ia.width!==ib.width||ia.height!==ib.height))throw Error('Baseline dimensions changed');
    const ca=paint(ia),cb=paint(ib),overlay=canvas(),diff=canvas(),oc=overlay.getContext('2d'),dc=diff.getContext('2d'),op=oc.createImageData(width,height),dp=dc.createImageData(width,height);
    let changed=0,error=0;
    for(let i=0;i<ca.p.length;i+=4){let max=0;for(let ch=0;ch<3;ch++){const delta=Math.abs(ca.p[i+ch]-cb.p[i+ch]);max=Math.max(max,delta);error+=delta;op.data[i+ch]=Math.round((ca.p[i+ch]+cb.p[i+ch])/2);dp.data[i+ch]=delta;}if(max>0)changed++;op.data[i+3]=dp.data[i+3]=255;}
    oc.putImageData(op,0,0);dc.putImageData(dp,0,0);
    return {changedPixels:changed,changedPixelPercentage:changed*100/(width*height),meanPixelError:error/(width*height*3),reference:cb.c.toDataURL(),overlay:overlay.toDataURL(),diff:diff.toDataURL()};
  },{a:current.toString('base64'),b:reference.toString('base64'),width,height,fit});
}
async function saveImage(file,data){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,Buffer.from(data.split(',')[1],'base64'));}
const scores=r=>({changedPixels:r.changedPixels,changedPixelPercentage:r.changedPixelPercentage,meanPixelError:r.meanPixelError});

try{
  if(update&&!reason)throw Error('Baseline updates require --reason; normal visual:test never rewrites baselines.');
  const manifest=JSON.parse(await fs.readFile(path.join(root,'reference/manifest.json'),'utf8'));
  await fs.mkdir(out,{recursive:true});
  await buildPlayer();await ensurePlayer();
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  const analysis=await browser.newPage();
  const baselineManifest=await exists(path.join(baseline,'manifest.json'))?JSON.parse(await fs.readFile(path.join(baseline,'manifest.json'),'utf8')):null;
  report.browser=browser.version();report.platform=process.platform;report.limits=manifest.regressionLimits;
  // Presentation-motion evidence: symbols must move down and reels must stop 1->5.
  {
    const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,reducedMotion:'no-preference'});
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.pathname.startsWith('/v1/state/'))return route.fulfill({json:{featureState:{}}});
      if(url.pathname.startsWith('/v1/'))return route.abort();
      return route.continue();
    });
    const motionPage=await context.newPage();
    await motionPage.goto(`${playerUrl}?state=01-base`,{waitUntil:'networkidle'});
    await motionPage.waitForFunction(()=>document.documentElement.dataset.ready==='true');
    report.motion=await assertReelMotion(motionPage);
    await context.close();
    const m=report.motion;
    if(!m.sawMoving)report.failures.push({case:'motion',message:'Reels never entered a moving state'});
    if(m.topBandFrames<3)report.failures.push({case:'motion',message:`Top of the reel window never showed continuous motion: ${m.topBandFrames} frames`});
    if(m.firstTopChangeMs<=0||m.firstBottomChangeMs<=0)report.failures.push({case:'motion',message:`Reel window motion not observed at both bands (top=${m.firstTopChangeMs}ms bottom=${m.firstBottomChangeMs}ms)`});
    if(m.bottomBandMeanChange<=0.05&&m.topBandMeanChange>0.05)report.failures.push({case:'motion',message:`Motion did not reach the lower window band (top=${m.topBandMeanChange} bottom=${m.bottomBandMeanChange})`});
    // Stop order is asserted from the landing times the player itself scheduled
    // (115ms stagger, equal travel duration). Pixel "last change" times are
    // recorded for evidence only: reel 1 travels fast and blurred, so its last
    // detectable change under-reports its landing by up to one stagger step.
    const stops=m.reelLastChange.slice();
    const observed=stops.filter(value=>value>0);
    const scheduled=Array.isArray(m.reelScheduledStop)?m.reelScheduledStop:[];
    if(scheduled.length===5){
      for(let reel=1;reel<5;reel++)if(!(scheduled[reel]>scheduled[reel-1]))report.failures.push({case:'motion',message:`Scheduled reel landing times are not 1->5: ${scheduled.join(',')}`});
    }else report.failures.push({case:'motion',message:'Player did not report per-reel landing times'});
    if(observed.length<3)report.failures.push({case:'motion',message:`Too few reels produced a readable stop time: ${observed.join(',')}`});
  }
  if(!update&&!baselineManifest)throw Error('Missing approved baseline. Record it explicitly with npm run visual:baseline -- --reason "...".');
  if(!update&&baselineManifest.browser!==report.browser)throw Error(`Baseline browser=${baselineManifest.browser}; current=${report.browser}. Review a baseline update before changing browsers.`);
  const jobs=[];
  for(const ref of manifest.references){
    const reference=await fs.readFile(path.join(root,ref.path));
    const native=[reference.readUInt32BE(16),reference.readUInt32BE(20)];
    const sizes=[native,...manifest.viewports].filter((v,i,a)=>a.findIndex(x=>x[0]===v[0]&&x[1]===v[1])===i);
    for(const [width,height] of sizes)jobs.push({ref,reference,width,height});
  }
  let nextJob=0;
  async function captureWorker(){
    while(nextJob<jobs.length){
      const {ref,reference,width,height}=jobs[nextJob++];
      const key=`${ref.id}-${width}x${height}`,file=`${key}.png`;
      const entry={key,state:ref.state,width,height,reference:ref.path,referenceScope:width<height?'Landscape proxy; no portrait reference supplied':'Supplied landscape reference',status:'FAIL'};
      let context;
      try{
        context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'no-preference',colorScheme:'dark'});
        const errors=[];
        await context.route('**/*',route=>{
          const request=route.request(),url=new URL(request.url());
          if(url.pathname.startsWith('/v1/state/'))return route.fulfill({json:{featureState:{}}});
          if(url.pathname.startsWith('/v1/')||!['GET','HEAD'].includes(request.method())){errors.push(`Unexpected API request ${request.method()} ${url.pathname}`);return route.abort();}
          return route.continue();
        });
        // Seed presentation effects only, in an isolated browser fixture. Never backend RNG.
        await context.addInitScript(()=>{let seed=1729;Math.random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};});
        const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(`HTTP ${r.status()} ${r.url()}`);});
        const time=new Date('2026-09-21T00:00:00Z');await page.clock.install({time});
        await page.goto(`${playerUrl}?state=${ref.id}`,{waitUntil:'networkidle'});
        await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
        await page.evaluate(async()=>{await document.fonts.ready;const {symbols}=await import('/symbols.mjs');await Promise.all([...new Set([...Object.values(symbols).map(s=>s.src),'player/assets/title-original-v2.png'])].map(async src=>{const im=new Image();im.src='/'+src;await im.decode();}));});
        await page.clock.pauseAt(new Date(time.getTime()+60000));
        entry.fixture=await prepareState(page,ref.id);
        entry.geometry=await page.locator('slot-game').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,horizontalOverflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),verticalOverflow:Math.max(0,document.documentElement.scrollHeight-innerHeight),cells:el.presentationGeometry().cells.map(col=>col.length)};});
        if(entry.geometry.horizontalOverflow||entry.geometry.verticalOverflow||entry.geometry.y<-.5||entry.geometry.bottom>height+1)throw Error(`overflow horizontal=${entry.geometry.horizontalOverflow}px vertical=${entry.geometry.verticalOverflow}px bottom=${entry.geometry.bottom.toFixed(2)}/${height}`);
        if(JSON.stringify(entry.geometry.cells)!=='[3,3,3,3,3]')throw Error('Reel layout is not 5x3');
        if(errors.length)throw Error(errors.join('; '));
        await fs.mkdir(path.join(out,'current'),{recursive:true});
        const current=await page.screenshot({path:path.join(out,'current',file)});
        const comparison=await compare(analysis,current,reference,width,height,'contain');entry.referenceMetrics=scores(comparison);
        for(const kind of ['reference','overlay','diff'])await saveImage(path.join(out,kind,file),comparison[kind]);
        const baselineFile=path.join(baseline,file);
        if(update){entry.regressionMetrics={changedPixels:0,changedPixelPercentage:0,meanPixelError:0};entry.status='BASELINE_RECORDED';}
        else{
          if(!await exists(baselineFile))throw Error(`Missing baseline ${file}`);
          const regression=await compare(analysis,current,await fs.readFile(baselineFile),width,height);entry.regressionMetrics=scores(regression);
          await saveImage(path.join(out,'regression-diff',file),regression.diff);
          await saveImage(path.join(out,'regression-overlay',file),regression.overlay);
          if(regression.changedPixelPercentage>manifest.regressionLimits.changedPixelPercentage||regression.meanPixelError>manifest.regressionLimits.meanPixelError)throw Error(`regression changed=${regression.changedPixelPercentage.toFixed(5)}%/${manifest.regressionLimits.changedPixelPercentage}% mean=${regression.meanPixelError.toFixed(6)}/${manifest.regressionLimits.meanPixelError}`);
          entry.status='PASS';
        }
      }catch(error){entry.error=error.message;report.failures.push({case:key,message:error.message});console.error(`VISUAL FAIL ${key} ${error.message}`);}
      finally{if(context)await context.close();report.cases.push(entry);}
    }
  }
  await Promise.all([captureWorker(),captureWorker()]);
  report.cases.sort((a,b)=>a.key.localeCompare(b.key));
  if(!report.failures.length&&update){
    if(await exists(baseline))await fs.cp(baseline,path.join(out,'previous-baseline'),{recursive:true});
    await fs.mkdir(baseline,{recursive:true});
    for(const entry of report.cases)await fs.copyFile(path.join(out,'current',`${entry.key}.png`),path.join(baseline,`${entry.key}.png`));
    await json(path.join(baseline,'manifest.json'),{createdAt:new Date().toISOString(),reason,browser:report.browser,platform:process.platform,cases:report.cases.map(c=>c.key),fixtureSignature:await fingerprint([path.join(root,'scripts/iteration/fixtures.mjs')]),referenceManifest:manifest});
  }
  report.status=report.failures.length?'FAIL':update?'BASELINE_RECORDED':'PASS';
}catch(error){report.failures.push({case:'setup',message:error.message});console.error(`VISUAL FAIL ${error.message}`);}
finally{
  if(browser)await browser.close();report.durationMs=Date.now()-started;
  await json(path.join(out,'report.json'),report);await json(path.join(root,'screenshots/acceptance/visual.json'),report);
  const metrics=report.cases.filter(c=>c.referenceMetrics).map(c=>c.referenceMetrics.meanPixelError);
  console.log(`VISUAL ${report.status} cases=${report.cases.length} failures=${report.failures.length} referenceMean=${metrics.length?(metrics.reduce((a,b)=>a+b,0)/metrics.length).toFixed(3):'N/A'}/255 ms=${report.durationMs}`);
  console.log(`Artifacts: screenshots/runs/${runId}/report.json`);
  process.exitCode=report.failures.length?1:0;
}
