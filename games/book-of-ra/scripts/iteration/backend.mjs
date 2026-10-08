import fs from 'node:fs/promises';
import path from 'node:path';
import {root,repo,toolkitVitest,run,json} from './common.mjs';
const started=Date.now(),reportPath=path.join(root,'screenshots/acceptance/backend.json');
const runDir=path.join(root,'screenshots/runs',`backend-${new Date().toISOString().replaceAll(':','-')}`);
await fs.mkdir(runDir,{recursive:true});
try{
 // Repository-owned slot-skills sources, exercised with the locally installed
 // toolkit toolchain read-only: no install, no source change. The config maps
 // ajv/yaml (not present in this worktree's partial root install) onto the
 // local toolkit checkout so the vendored sources can be imported as written.
 const raw=path.join(runDir,'vitest.json');
 const result=await run([
   toolkitVitest,'run',
   '--config',path.join(root,'scripts/iteration/vitest.config.mjs'),
   '--reporter=json',`--outputFile=${raw}`,
 ],{cwd:repo,log:path.join(runDir,'backend-test.log'),timeout:600000});
 let data=null;
 try{data=JSON.parse(await fs.readFile(raw,'utf8'));}catch{/* reported below */}
 const failures=[];
 if(data){
   failures.push(...(data.testResults??[]).flatMap(file=>(file.assertionResults??[]).filter(test=>test.status==='failed').map(test=>({file:path.relative(repo,file.name),test:test.fullName,messages:test.failureMessages}))));
   if(!(data.testResults??[]).some(file=>file.name.endsWith('book-of-ra.test.ts')))failures.push({test:'Book of Ra suite was not discovered'});
   if(data.numPendingTests)failures.push({test:`Unexpected skipped tests: ${data.numPendingTests}`});
 }
 if(!data&&!failures.length)failures.push({test:`Vitest produced no JSON report (exit=${result.code})`,messages:[result.output.slice(-1800)]});
 const pass=result.code===0&&failures.length===0&&Boolean(data)&&data.numFailedTests===0;
 await json(reportPath,{status:pass?'PASS':'FAIL',passed:data?.numPassedTests??null,failed:data?.numFailedTests??null,skipped:data?.numPendingTests??null,bookOfRaTests:(data?.testResults??[]).filter(file=>file.name.endsWith('book-of-ra.test.ts')).flatMap(file=>file.assertionResults??[]).length,runner:'toolkit tsc + vitest over repository sources',failures,durationMs:Date.now()-started,scope:'All existing schema, math, features, runtime and host tests; not a certification of missing Deluxe scenarios.'});
 console.log(`BACKEND ${pass?'PASS':'FAIL'} passed=${data?.numPassedTests??'n/a'} failed=${data?.numFailedTests??'n/a'} skipped=${data?.numPendingTests??'n/a'} ms=${Date.now()-started}`);
 for(const failure of failures)console.log(`FAIL ${failure.file??''} ${failure.test}`);
 if(!pass)process.exitCode=1;
}catch(error){await json(reportPath,{status:'FAIL',error:String(error),durationMs:Date.now()-started});console.error(`BACKEND FAIL ${error.message}`);process.exitCode=1;}
finally{await fs.copyFile(reportPath,path.join(runDir,'report.json'));}
