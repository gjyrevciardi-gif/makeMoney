import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const toolkit=path.join(root,'slot-skills');
export const cache=path.join(root,'.cache/iteration');
export const playerUrl='http://127.0.0.1:4175/';
export async function exists(file){try{await fs.access(file);return true;}catch{return false;}}
export async function json(file,value){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(value,null,2)+'\n');}
export async function fingerprint(paths){
  const hash=createHash('sha256');
  async function add(file){
    const stat=await fs.stat(file);
    if(stat.isDirectory()){for(const name of (await fs.readdir(file)).sort())await add(path.join(file,name));}
    else {hash.update(path.relative(root,file));hash.update(await fs.readFile(file));}
  }
  for(const file of paths)await add(file);
  hash.update(process.version);
  return hash.digest('hex');
}
export async function run(args,{cwd=root,log,timeout=180000}={}){
  return await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,NO_COLOR:'1',FORCE_COLOR:'0'}});
    let output='',timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill();},timeout);
    child.stdout.on('data',d=>{output+=d;});child.stderr.on('data',d=>{output+=d;});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',async(code)=>{clearTimeout(timer);try{if(log){await fs.mkdir(path.dirname(log),{recursive:true});await fs.writeFile(log,output);}resolve({code:timedOut?124:code??1,output});}catch(error){reject(error);}});
  });
}
const dependencies={schema:[],math:['schema'],features:['schema','math'],runtime:['schema','math','features'],host:['schema','math','features','runtime'],'canvas-effects':['schema'],spine:['schema'],'web-client':['schema','runtime','canvas-effects','spine']};
export async function buildPackages(names){
  const seen=new Set();
  async function build(name){
    if(seen.has(name))return;for(const dependency of dependencies[name]??[])await build(dependency);seen.add(name);
    const dir=path.join(toolkit,'packages',name==='canvas-effects'?name:`slot-${name}`);
    const files=[path.join(dir,'src'),path.join(dir,'tsconfig.json'),path.join(dir,'package.json'),path.join(toolkit,'tsconfig.base.json'),path.join(toolkit,'package-lock.json')];
    for(const dependency of dependencies[name]??[])files.push(path.join(cache,`build-${dependency}.json`));
    const signature=await fingerprint(files),stamp=path.join(cache,`build-${name}.json`);
    if(await exists(stamp)&&await exists(path.join(dir,'dist/index.js'))){const old=JSON.parse(await fs.readFile(stamp));if(old.signature===signature&&old.outputSignature===await fingerprint([path.join(dir,'dist')]))return;}
    const result=await run([path.join(toolkit,'node_modules/typescript/bin/tsc'),'-p',path.join(dir,'tsconfig.json')],{log:path.join(cache,`build-${name}.log`)});
    if(result.code)throw Error(`build ${name} exit=${result.code}; ${path.relative(root,path.join(cache,`build-${name}.log`))}\n${result.output.slice(-1800)}`);
    await json(stamp,{signature,outputSignature:await fingerprint([path.join(dir,'dist')])});
  }
  for(const name of names)await build(name);
}
export async function buildPlayer(){
  await buildPackages(['web-client']);
  const signature=await fingerprint([path.join(toolkit,'packages/slot-web-client/src'),...['schema','runtime','canvas-effects','spine'].map(n=>path.join(cache,`build-${n}.json`)),path.join(toolkit,'package-lock.json')]);
  const stamp=path.join(cache,'player-build.json'),output=path.join(root,'player/build/slot-client.js');
  if(await exists(stamp)&&await exists(output)){const old=JSON.parse(await fs.readFile(stamp));if(old.signature===signature&&old.outputSignature===await fingerprint([output]))return;}
  const {build}=await import('../../slot-skills/node_modules/vite/dist/node/index.js');
  await build({configFile:false,root:toolkit,logLevel:'silent',build:{lib:{entry:path.join(toolkit,'packages/slot-web-client/src/index.ts'),formats:['es'],fileName:()=> 'slot-client.js'},outDir:path.join(root,'player/build'),emptyOutDir:false,target:'es2022',sourcemap:true,minify:true}});
  await json(stamp,{signature,outputSignature:await fingerprint([output])});
}
export async function ensurePlayer(){
  const expected=await fs.readFile(path.join(root,'player/index.html'),'utf8');
  async function probe(){try{const response=await fetch(new URL('player/index.html',playerUrl),{signal:AbortSignal.timeout(1200)});if(!response.ok||await response.text()!==expected)throw Error('Port 4175 belongs to another server; it was not stopped.');return true;}catch(error){if(error.message.includes('another server'))throw error;return false;}}
  if(await probe())return;
  await fs.mkdir(cache,{recursive:true});const log=await fs.open(path.join(cache,'player-server.log'),'a');
  const child=spawn(process.execPath,[path.join(root,'scripts/serve-visual-player.mjs')],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd]});
  let spawnError;child.on('error',e=>{spawnError=e;});child.unref();await log.close();
  for(let i=0;i<50;i++){if(spawnError)throw spawnError;await new Promise(r=>setTimeout(r,100));if(await probe())return;}
  throw Error('Player startup timed out; see .cache/iteration/player-server.log');
}
