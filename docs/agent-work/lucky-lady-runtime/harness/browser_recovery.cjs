// Bounded real-client recovery acceptance in a fresh, separate disposable SQLite database.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {chromium}=require('C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const RUN='C:/Users/Admin/orca/research/game-pack-forensics/runtime/LuckyLadysCharmDX';
const name='recovery-browser-'+Date.now()+'.sqlite',dbPath=RUN+'/state/'+name;
const command=JSON.parse(fs.readFileSync(RUN+'/state/process.json')).command;
command[command.indexOf('-S')+1]='127.0.0.1:8768';
const log=fs.openSync(RUN+'/logs/recovery-browser-process.log','a');
const server=cp.spawn(command[0],command.slice(1),{cwd:RUN,env:{...process.env,LUCKY_PILOT_DB:name,LUCKY_PILOT_PORT:'8768'},windowsHide:true,stdio:['ignore',log,log]});
const results={outbound:[],pageErrors:[],states:{}};
let browser,db;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const fixture=mode=>fs.writeFileSync(dbPath+'.next.json',JSON.stringify({outcome:mode}));
const ledger=()=>db.prepare('SELECT * FROM ledger ORDER BY id').all();
(async()=>{
 try{
  for(let i=0;i<40;i++){try{await fetch('http://127.0.0.1:8768/');break;}catch{await sleep(100);}}
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
  const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'});
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():(results.outbound.push(r.request().url()),r.abort()));
  await context.routeWebSocket('**/*',s=>{results.outbound.push(s.url());s.close();});
  const page=await context.newPage();page.on('pageerror',e=>results.pageErrors.push(e.message));
  page.on('dialog',d=>d.dismiss());
  const ready=()=>page.waitForFunction(()=>window.pilotRecoveryReady,null,{timeout:15000});
  const phase=p=>page.waitForFunction(p=>slotState===p,p,{timeout:15000});
  const ui=()=>page.evaluate(()=>({state:slotState,server:pilotRecovery,credit:slotStateData.credit,win:slotStateData.totalWin,
    bonus:bonusMode,bet:slotStateData.betline,lines:slotStateData.lines,gambleVisible:gameGamble._view.visible,
    gambleAlpha:gameGamble._view.alpha,gambleWorldAlpha:gameGamble._view.worldAlpha,
    board:gameReels._view.children.map(c=>c.children.filter(s=>s.y>=0&&s.y<744).map(s=>s.texture.textureCacheIds[0]))}));
  async function refresh(label,expected){
   const before=(await ui()).server, money=ledger();
   await page.reload();await ready();await sleep(250);
   if(expected==='GAMBLE'){
    await page.waitForFunction(()=>gameGamble._view.visible && gameGamble._view.worldAlpha>=0.99,null,{timeout:5000});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   }
   const after=await ui();assert.equal(after.state,expected);assert.deepEqual(after.server,before);assert.deepEqual(ledger(),money);
   if(before.result)assert.deepEqual(after.board,[1,2,3,4,5].map(i=>before.result.serverResponse.reelsSymbols['reel'+i].slice(0,3)));
   results.states[label]=after;
   await page.screenshot({path:RUN+'/screenshots/recovery-'+label+'.png'});
   console.log(label+': PASS');return after;
  }
  await page.goto('http://127.0.0.1:8768/');await ready();db=new DatabaseSync(dbPath);
  fixture('none');await page.keyboard.press('Enter');await phase('IDLE');
  assert.equal((await ui()).server.version,1);await refresh('base','IDLE');
  fixture('win');await page.keyboard.press('Enter');await phase('AFTERWIN');
  const pending=await refresh('pending-win','AFTERWIN');assert(pending.win>0);
  const collectLedger=ledger();await page.keyboard.press('Enter');await phase('IDLE');assert.deepEqual(ledger(),collectLedger);
  await refresh('post-collect','IDLE');assert.equal((await ui()).server.pendingWin,0);
  fixture('win');await page.keyboard.press('Enter');await phase('AFTERWIN');
  await page.keyboard.press('8');await phase('GAMBLE');await refresh('gamble-entry','GAMBLE');
  fixture('gamble-win');let gamble=page.waitForResponse(r=>r.request().method()==='POST'&&r.request().postDataJSON()?.slotEvent==='slotGamble');
  await page.keyboard.press('9');await gamble;await sleep(1700);
  const g=await refresh('gamble-attempt','GAMBLE');assert.equal(g.server.gamble.attempts,1);assert.equal(g.server.gamble.cards.length,1);assert(g.gambleVisible);
  const beforeGambleCollect=ledger();await page.keyboard.press('Enter');await phase('IDLE');assert.deepEqual(ledger(),beforeGambleCollect);
  await refresh('gamble-collect','IDLE');
  fixture('win');await page.keyboard.press('Enter');await phase('AFTERWIN');await page.keyboard.press('8');await phase('GAMBLE');
  fixture('gamble-loss');gamble=page.waitForResponse(r=>r.request().method()==='POST'&&r.request().postDataJSON()?.slotEvent==='slotGamble');
  await page.keyboard.press('0');await gamble;await phase('IDLE');await refresh('gamble-loss','IDLE');
  const game=JSON.parse(db.prepare("SELECT data FROM records WHERE kind='Game'").get().data);game.stat_in=100000;
  db.prepare("UPDATE records SET data=? WHERE kind='Game'").run(JSON.stringify(game));
  fixture('bonus');await page.keyboard.press('Enter');await phase('WAITBONUS');await refresh('free-trigger','WAITBONUS');
  fixture('none');const free=page.waitForResponse(r=>r.request().method()==='POST'&&r.request().postDataJSON()?.slotEvent==='freespin');
  await page.keyboard.press('Enter');await free;
  // Wait only for response dispatch, then refresh before automatic next-free-spin scheduling.
  await page.waitForFunction(()=>pilotRecovery.free.current===1);
  const f=await refresh('active-free','WAITBONUS');assert.equal(f.server.free.current,1);assert.equal(f.server.free.remaining,14);assert(f.bonus);
  // Same original backend, bounded deterministic retrigger; no extra automatic spin on recovery.
  fixture('bonus');const prev=(await ui()).server;
  const rr=await context.request.post('http://127.0.0.1:8768/game/LuckyLadysCharmDX/server',{data:{slotEvent:'freespin',slotBet:'0.01',slotLines:10},headers:{'X-Pilot-Request-ID':'browser-retrigger','X-Pilot-Version':String(prev.version),'X-Pilot-Round':prev.roundId}});
  assert.equal(rr.status(),200);const retrigger=await rr.json();assert.equal(retrigger.recovery.free.total,30);
  await page.reload();await ready();const rt=await refresh('retrigger','WAITBONUS');assert.equal(rt.server.free.remaining,28);assert.equal(rt.server.roundId,prev.roundId);
  // Continue a recovered feature once; the exact locked stake and existing round must survive.
  fixture('none');const next=page.waitForResponse(r=>r.request().method()==='POST'&&r.request().postDataJSON()?.slotEvent==='freespin');
  await page.keyboard.press('Enter');const nr=await next;const nj=await nr.json();assert.equal(nj.recovery.free.current,3);assert.equal(nj.recovery.roundId,prev.roundId);
  await page.reload();await ready();
  assert.deepEqual(results.pageErrors,[]);assert.deepEqual(results.outbound,[]);
  results.database=dbPath;results.verdict='PASS';
  fs.writeFileSync(RUN+'/evidence/recovery-browser.json',JSON.stringify(results,null,2));
  console.log('Browser recovery regression: PASS');
 }catch(e){results.failure=e.stack;fs.writeFileSync(RUN+'/evidence/recovery-browser.json',JSON.stringify(results,null,2));throw e;}
 finally{if(browser)await browser.close();if(db)db.close();server.kill();fs.closeSync(log);}
})().catch(e=>{console.error(e);process.exitCode=1;});
