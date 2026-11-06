import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cron from 'node-cron';
import { appUrl, required, runtimeContext } from './services/config';
import { endpoints } from './generated/endpoints';
import { attachRealtime } from './services/realtime';
import { googleCallback } from './services/google-integrations';
import { registerTasks,startWorker } from './services/queueTask';
import { dailyJobMatches } from '../floot/helpers/dailyJobMatches';
import { searchUserJobs } from '../floot/helpers/searchUserJobs';
import { searchUserFailed } from '../floot/helpers/searchUserFailed';

// db helpers use the same server-side database URL on both hosts.
// Set before module evaluation through the build bootstrap (see build.mjs).
const root=path.dirname(fileURLToPath(import.meta.url)),publicRoot=path.join(root,'public');
const origin=appUrl();
if(required('JWT_SECRET').length<32||required('JWT_SECRET').startsWith('replace-'))throw new Error('Set a random JWT_SECRET of at least 32 characters.');
required('DATABASE_URL');
if(process.env.NODE_ENV==='production'&&origin.protocol!=='https:')throw new Error('Production APP_URL must use HTTPS.');
if(process.env.NODE_ENV==='production'&&process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_'))throw new Error('Production must not unlock subscriptions through Stripe test mode.');
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2','.txt':'text/plain'};
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url||'/',origin),method=req.method||'GET';
  // Reject origin-bearing state changes from other sites before any handler.
  if(method==='POST'&&req.headers.origin&&req.headers.origin!==origin.origin){res.writeHead(403);res.end('Cross-site request refused.');return;}
  if(url.pathname==='/healthz'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');return;}
  const handler=url.pathname==='/__runtime/google/callback'?googleCallback:endpoints[method+' '+url.pathname];
  if(handler){
   const parts:Buffer[]=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>6*1024*1024){res.writeHead(413);res.end('Request too large');req.destroy();return;}parts.push(chunk);}
   const headers=new Headers();for(const[k,v]of Object.entries(req.headers))if(v)headers.set(k,Array.isArray(v)?v.join(', '):v);
   const request=new Request(url,{method,headers,...(method!=='GET'&&method!=='HEAD'?{body:Buffer.concat(parts)}:{})});
   const response=await runtimeContext.run({request},()=>handler(request));
   res.statusCode=response.status;for(const[k,v]of response.headers)if(k!=='set-cookie')res.setHeader(k,v);
   const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('Set-Cookie',cookies.map(c=>origin.protocol==='http:'&&['localhost','127.0.0.1'].includes(origin.hostname)?c.replace(/; Secure/gi,''):c));
   res.setHeader('X-Content-Type-Options','nosniff');res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  if(url.pathname.startsWith('/_api/')||url.pathname.startsWith('/__runtime/')){res.writeHead(404);res.end('Not found');return;}
  if(method!=='GET'&&method!=='HEAD'){res.writeHead(405);res.end('Method not allowed');return;}
  const decoded=decodeURIComponent(url.pathname);const target=path.resolve(publicRoot,'.'+decoded);
  if(target!==publicRoot&&!target.startsWith(publicRoot+path.sep)){res.writeHead(404);res.end('Not found');return;}
  let file=target;const stat=await fs.stat(file).catch(()=>null);if(!stat?.isFile()){if(path.extname(url.pathname)){res.writeHead(404);res.end('Not found');return;}file=path.join(publicRoot,'index.html');}
  const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':file.endsWith('index.html')?'no-cache':'public,max-age=300'});res.end(method==='HEAD'?undefined:bytes);
 }catch{res.writeHead(500,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"error":"Unable to complete this request."}');}
});
attachRealtime(server);
if(process.env.ENABLE_SCHEDULER==='true'){
 registerTasks({searchUserJobs,searchUserFailed});startWorker();
 const jobs=JSON.parse(await fs.readFile(path.join(root,'schedule.json'),'utf8'));
 const j=jobs.dailyJobMatches;if(j?.enabled)cron.schedule(j.schedule,async()=>{try{await dailyJobMatches();}catch{console.error('Daily matching could not be scheduled.');}},{timezone:j.timezone,noOverlap:true});
}
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Job Hunt listening on '+origin.origin));
