import fs from 'node:fs/promises';
import path from 'node:path';
import {root,toolkit,buildPackages,run,json} from './common.mjs';
const started=Date.now(),reportPath=path.join(root,'screenshots/acceptance/backend.json');
const runDir=path.join(root,'screenshots/runs',`backend-${new Date().toISOString().replaceAll(':','-')}`);
await fs.mkdir(runDir,{recursive:true});
try{
 await buildPackages(['host']);
 const raw=path.join(runDir,'vitest.json');
 const result=await run([path.join(toolkit,'node_modules/vitest/vitest.mjs'),'run',
   'packages/slot-schema/src','packages/slot-math/src','packages/slot-features/src','packages/slot-runtime/src','packages/slot-host/src',
   '--reporter=json',`--outputFile=${raw}`],{cwd:toolkit,log:path.join(runDir,'backend-test.log')});
 let data;try{data=JSON.parse(await fs.readFile(raw,'utf8'));}catch{throw Error(`vitest exit=${result.code}; ${path.relative(root,runDir)}/backend-test.log\n${result.output.slice(-1800)}`);}
 const failures=(data.testResults??[]).flatMap(file=>(file.assertionResults??[]).filter(t=>t.status==='failed').map(t=>({file:path.relative(root,file.name),test:t.fullName,messages:t.failureMessages})));
 const bookFiles=(data.testResults??[]).filter(f=>f.name.endsWith('book-of-ra.test.ts'));
 if(!bookFiles.length)failures.push({test:'Book of Ra suite was not discovered'});
 if(data.numPendingTests)failures.push({test:`Unexpected skipped tests: ${data.numPendingTests}`});
 if(result.code&&!failures.length)failures.push({test:`Vitest runner exit=${result.code}`,messages:[result.output.slice(-1800)]});
 const pass=result.code===0&&data.numFailedTests===0&&failures.length===0;
 await json(reportPath,{status:pass?'PASS':'FAIL',passed:data.numPassedTests,failed:data.numFailedTests,skipped:data.numPendingTests,bookOfRaTests:bookFiles.flatMap(f=>f.assertionResults).length,failures,durationMs:Date.now()-started,scope:'All existing schema, math, features, runtime and host tests; not a certification of missing Deluxe scenarios.'});
 console.log(`BACKEND ${pass?'PASS':'FAIL'} tests=${data.numPassedTests}/${data.numTotalTests} failed=${data.numFailedTests} skipped=${data.numPendingTests} ms=${Date.now()-started}`);
 for(const failure of failures)console.log(`FAIL ${failure.file??''} ${failure.test}`);
 if(!pass)process.exitCode=1;
}catch(error){await json(reportPath,{status:'FAIL',error:String(error),durationMs:Date.now()-started});console.error(`BACKEND FAIL ${error.message}`);process.exitCode=1;}
finally{await fs.copyFile(reportPath,path.join(runDir,'report.json'));}
