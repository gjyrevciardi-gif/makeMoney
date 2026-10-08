import path from 'node:path';
import {root,run,json} from './common.mjs';
const started=Date.now();const suites=[];
// Sequential builds share a content cache; always run both suites even when one fails.
for(const name of ['visual','backend']){
 try{const result=await run([path.join(root,`scripts/iteration/${name}.mjs`)],{timeout:300000,log:path.join(root,`screenshots/acceptance/${name}.log`)});process.stdout.write(result.output);suites.push({name,exitCode:result.code});}
 catch(error){console.error(`${name.toUpperCase()} FAIL ${error.message}`);suites.push({name,exitCode:1});}
}
const pass=suites.every(s=>s.exitCode===0);
await json(path.join(root,'screenshots/acceptance/summary.json'),{status:pass?'PASS':'FAIL',suites,durationMs:Date.now()-started});
console.log(`ACCEPTANCE ${pass?'PASS':'FAIL'} suites=${suites.filter(s=>s.exitCode===0).length}/2 ms=${Date.now()-started}`);
process.exitCode=pass?0:1;
