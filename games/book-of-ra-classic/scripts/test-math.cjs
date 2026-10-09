const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const e=require('../../../backend/dist/src/casino/games/book-of-ra-classic/classic.engine');
const root=path.resolve(__dirname,'../../..');
const blank=()=>['A','K','Q','J','10'].map(s=>[s,s,s]);
const lines=[[1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],[1,2,2,2,1],[1,0,0,0,1],[2,2,1,0,0],[0,0,1,2,2]];
test('Classic identities, nine exact paths, and reference client paths agree',()=>{
 assert.equal(e.CLASSIC_ID,'book-of-ra-classic');assert.deepEqual(e.RULES.paylines,lines);
 const config=JSON.parse(fs.readFileSync(path.join(root,'games/book-of-ra-classic/client/config/desktop_view.json')));
 const objects=Object.values(config).flatMap(o=>Object.entries(o));
 for(let i=0;i<9;i++)for(let col=0;col<5;col++){
   const found=objects.find(([key])=>key===`lnLine${i+1}p${col}`);assert.ok(found,`client displays line ${i+1} column ${col}`);
   // Diagonal path sprites have different bounding boxes; only horizontal
   // paths share a row-centre origin. Every path/column must still exist.
   if(i<3) assert.equal(found[1].y,202+256*lines[i][col]);
 }
 assert.ok(!objects.some(([key])=>/^lnLine10/.test(key)));
});
test('no win; selected count determines exact wager semantics',()=>{
 assert.equal(e.evaluate(blank()).win,0);
 assert.throws(()=>e.evaluate(blank(),1,10),/INVALID_WAGER/);
 assert.throws(()=>e.evaluate(blank(),0.01,9),/INVALID_WAGER/);
});
for(let line=0;line<9;line++)test(`line ${line+1}: authoritative identity and client-visible payout`,()=>{
 const b=blank();lines[line].forEach((row,col)=>b[col][row]='P_1');
 const r=e.evaluate(b,2,9);const hit=r.lineWins.find(w=>w.line===line);
 assert.equal(hit.amount,10000);assert.deepEqual(hit.cells,lines[line].map((row,col)=>[col,row]));
 assert.ok(!e.evaluate(b,2,Math.max(1,line)).lineWins.some(w=>line>0&&w.line===line));
});
test('single low-symbol line and multiple lines settle once each',()=>{
 const b=blank(); b[0][1]=b[1][1]=b[2][1]='10';
 assert.deepEqual(e.evaluate(b,1,1).lineWins.map(w=>[w.line,w.amount]),[[0,5]]);
 const m=blank();m[0]=m[1]=['P_1','P_1','P_1'];
 assert.equal(e.evaluate(m).win,90);assert.equal(e.evaluate(m).lineWins.length,9);
});
test('native Book scatter 18/180/1800 times selected total stake; trigger ten',()=>{
 for(const n of [3,4,5]){const b=blank();for(let i=0;i<n;i++)b[i][0]='SCAT';const r=e.evaluate(b,2,7);assert.equal(r.scatterWin,[0,0,0,18,180,1800][n]*14);assert.equal(r.trigger,true);}
 assert.equal(e.RULES.freeSpins,10);assert.equal(e.RULES.retriggerSpins,10);
});
test('expansion pays nonadjacent reels across selected lines; Book does not substitute',()=>{
 const b=blank();b[1][0]='P_1';b[4][2]='P_1';
 const r=e.evaluate(b,3,7,'P_1');assert.deepEqual(r.expandingReels,[1,4]);assert.equal(r.expansionWin,210);
 const low=blank();low[0][0]='10';low[2][0]='10'; // reel 5 naturally contains 10
 assert.equal(e.evaluate(low,1,9,'10').expansionWin,45);
 const wild=blank();wild[1][0]='P_1';wild[4][2]='SCAT';assert.equal(e.evaluate(wild,1,9,'P_1').expansionWin,0);
});
test('gamble colours are server draws; collect means unchanged pending win',()=>{
 assert.deepEqual(e.gamble(25,'red',()=>0),{colour:'red',won:true,payout:50});
 assert.equal(e.gamble(25,'black',()=>0).payout,0);assert.throws(()=>e.gamble(25,'dealer'),/INVALID_GAMBLE/);
});
test('Deluxe accepted artifacts and historical validation remain untouched',()=>{
 const paths=['packages/slot-skills','games/book-of-ra'];
 assert.equal(cp.execFileSync('git',['diff','d6cb445','--',...paths],{cwd:root}).length,0);
 const historical='C:/Users/Admin/orca/workspaces/toto/book-backend';
 for(const file of ['packages/slot-skills/math/src/book-of-ra.profile.ts','packages/slot-skills/math/src/book-of-ra.ts','packages/slot-skills/runtime/src/book-of-ra-round.ts']){
  const accepted=cp.execFileSync('git',['show',`831cbfc:${file}`],{cwd:root}).toString().replace(/\r\n/g,'\n');
  assert.equal(fs.readFileSync(path.join(historical,file),'utf8').replace(/\r\n/g,'\n'),accepted);
 }
 const profile=cp.execFileSync('git',['show','831cbfc:packages/slot-skills/math/src/book-of-ra.profile.ts'],{cwd:root}).toString();
 assert.match(profile,/BOOK_OF_RA_LINES = 10/);assert.match(profile,/book-of-ra.v1.rtp5000/);
 const review=fs.readFileSync(path.join(historical,'docs/agent-work/book-backend/ASTRA-REVIEW.md'),'utf8');assert.match(review,/49\.9976/);
});
