// Static recovery only: never executes the reference PHP or client scripts.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const research = 'C:/Users/Admin/orca/research/game-pack-forensics/external';
const pack = path.join(research, 'frontend-hunt');
const cached = path.join(pack, 'files/heidi-luong1109--game');
const tree = JSON.parse(fs.readFileSync(path.join(pack, 'heidi-luong1109--game.tree.json')));
const backendRepo = path.join(research, 'taxipult-goldsvet');
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const gitFile = name => cp.execFileSync('git', ['-C', backendRepo, 'show', `HEAD:casino/app/Games/BookOfRaCL/${name}`]);
const setting = gitFile('SlotSettings.php').toString('utf8');
const server = gitFile('Server.php').toString('utf8');
const reels = gitFile('reels.txt').toString('utf8');
const paytable = Object.fromEntries([...setting.matchAll(/\$this->Paytable\[(?:'([^']+)'|(\d+))\]\s*=\s*\[([^\]]+)\]/g)].map(m => [m[1] || m[2], m[3].split(',').map(x => Number(x.trim()))]));
const lines = [...server.matchAll(/\$linesId\[\d+\]\s*=\s*\[([^\]]+)\]/g)].map(m => m[1].split(',').map(x => Number(x.trim()) - 1));
if (lines.length !== 9 || Object.keys(paytable).length !== 10) throw Error('Reference rule extraction failed');
const strips = Object.fromEntries(reels.split(/\r?\n/).filter(x => /^reelStrip(?:Bonus)?[1-5]=/.test(x)).map(x => { const [k,v] = x.split('='); return [k,v.split(',').map(s => s.trim())]; }));
const dataDir = path.join(root, 'backend/src/casino/games/book-of-ra-classic/math');
fs.mkdirSync(dataDir, {recursive:true});
const rules = {gameId:'book-of-ra-classic', clientId:'BookOfRaCL', paylines:lines, paytable, strips, wild:'SCAT', scatter:'SCAT', freeSpins:10, retriggerSpins:10, expandingSymbols:['P_1','P_2','P_3','P_4','A','K','Q','J','10'], scatterBasis:'TOTAL_SELECTED_STAKE', source:{clientCommit:tree.sha, backendCommit:cp.execFileSync('git',['-C',backendRepo,'rev-parse','HEAD']).toString().trim(), settingsSha256:sha256(setting), serverSha256:sha256(server), reelsSha256:sha256(reels)}};
fs.writeFileSync(path.join(dataDir,'rules.json'), JSON.stringify(rules,null,2)+'\n');
const evidenceDir = path.join(root,'games/book-of-ra-classic/reference');
fs.mkdirSync(evidenceDir,{recursive:true});
for (const [name, contents] of [['SlotSettings.php',setting],['Server.php',server],['reels.txt',reels]]) fs.writeFileSync(path.join(evidenceDir,name+'.txt'),contents);
const files = tree.tree.filter(x => x.type === 'blob' && x.path.startsWith('public/games/BookOfRaCL/'));
const dest = path.join(root,'games/book-of-ra-classic/client');
const manifest=[];
async function main(){
 let cursor=0;
 await Promise.all(Array.from({length:6},async()=>{
  while(cursor<files.length){
   const f=files[cursor++]; const rel=f.path.slice('public/games/BookOfRaCL/'.length);
   const target=path.join(dest,rel); const src=path.join(cached,f.path);
   let bytes=fs.existsSync(src)?fs.readFileSync(src):null;
   const blobHash=b=>crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
   if(!bytes||blobHash(bytes)!==f.sha){
    const response=await fetch(`https://raw.githubusercontent.com/heidi-luong1109/game/${tree.sha}/${f.path}`);
    if(!response.ok) throw Error(`Asset unavailable: ${rel} ${response.status}`);
    bytes=Buffer.from(await response.arrayBuffer());
   }
   if(blobHash(bytes)!==f.sha) throw Error(`Asset hash mismatch: ${rel}`);
   fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
   manifest.push({path:rel,gitBlob:f.sha,sha256:sha256(bytes),bytes:bytes.length});
  }
 }));
 manifest.sort((a,b)=>a.path.localeCompare(b.path));
 fs.writeFileSync(path.join(evidenceDir,'client-manifest.json'),JSON.stringify({repository:'heidi-luong1109/game',commit:tree.sha,client:'BookOfRaCL',files:manifest},null,2)+'\n');
 console.log(JSON.stringify({clientFiles:files.length,bytes:manifest.reduce((s,x)=>s+x.bytes,0),paylines:lines,paytable,reference:rules.source}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
