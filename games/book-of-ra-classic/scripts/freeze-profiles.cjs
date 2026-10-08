const fs=require('node:fs');const path=require('node:path');
const e=require('../../../backend/dist/src/casino/games/book-of-ra-classic/classic.engine');
const dir=path.resolve(__dirname,'../../../backend/src/casino/games/book-of-ra-classic/math');
for(const cap of [20,50]){
 const profile=e.generateProfile(50,cap);
 const analysis=Array.from({length:9},(_,i)=>({lines:i+1,...e.analyze(profile,i+1)}));
 const id=cap===50?'book-of-ra-classic.rtp50.v1':'book-of-ra-classic.rtp50.maxwin20.v1';
 const record={id,hash:e.hash(profile),rulesHash:e.RULES_HASH,payload:profile,analysis};
 fs.writeFileSync(path.join(dir,`rtp50-maxwin${cap}.json`),JSON.stringify(record)+'\n');
 console.log(JSON.stringify({id,hash:record.hash,analysis}));
}
