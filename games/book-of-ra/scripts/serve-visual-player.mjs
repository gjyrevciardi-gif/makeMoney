/** Read-only local static frontend preview. No runtime, wallet, RNG or ledger imports. */
import { createServer, request as httpRequest } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.css':'text/css','.map':'application/json'};
createServer(async(req,res)=>{
 try{
  let pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(pathname.startsWith('/v1/')){
   const body=[]; for await (const chunk of req) body.push(chunk);
   const upstream=httpRequest({hostname:'127.0.0.1',port:4174,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:4174'}},up=>{
    res.writeHead(up.statusCode??502,up.headers); up.pipe(res);
   });
   upstream.on('error',error=>{res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({message:`Backend unavailable: ${error.message}`}));});
   if(body.length) upstream.write(Buffer.concat(body)); upstream.end(); return;
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end('Method not allowed');return;}
  if(pathname==='/')pathname='/player/index.html';
  else if(pathname==='/game.json')pathname='/book-of-the-sands/build/game.bundle.json';
  else if(pathname.startsWith('/assets/'))pathname='/book-of-the-sands'+pathname;
  else if(pathname==='/symbols.mjs'||pathname.startsWith('/build/'))pathname='/player'+pathname;
  const file=resolve(root,'.'+pathname);
  if(!file.startsWith(root+sep)||!types[extname(file)]||!['/player/','/screenshots/','/reference/','/book-of-the-sands/assets/','/book-of-the-sands/build/game.bundle.json'].some(prefix=>pathname.startsWith(prefix))){res.writeHead(404);res.end();return;}
  if(!(await stat(file)).isFile())throw new Error('Not a file');
  res.writeHead(200,{'content-type':types[extname(file)],'cache-control':'no-store'});res.end(req.method==='HEAD'?undefined:await readFile(file));
 }catch{res.writeHead(404);res.end('Not found');}
}).listen(Number(process.env.SLOT_PREVIEW_PORT??4275),'127.0.0.1',()=>console.log(`Visual player http://127.0.0.1:${Number(process.env.SLOT_PREVIEW_PORT??4275)}/`));
