import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
const {handle}=await import('../dist/rewrite.mjs');
const port=Number(process.env.PORT||3101);
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'};
const attempts=new Map();
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/_api/rewrite'){
   if(req.method!=='POST'){res.writeHead(405);res.end();return;}
   const origin=req.headers.origin;
   if(origin&&origin!==('http://'+req.headers.host)&&origin!==process.env.APP_URL){res.writeHead(403);res.end('Origin denied');return;}
   const id=req.socket.remoteAddress;const now=Date.now();let attempt=attempts.get(id);
   if(!attempt||now-attempt.start>60000){attempt={start:now,count:0};attempts.set(id,attempt);}
   if(++attempt.count>8){res.writeHead(429,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Please wait a minute before rewriting again.'}));return;}
   if(!process.env.AI_API_KEY||!process.env.AI_MODEL){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Local AI is not configured yet. Set AI_API_KEY and AI_MODEL in your .env file.'}));return;}
   let body='';for await(const chunk of req){body+=chunk.toString();if(body.length>100000){res.writeHead(413);res.end();return;}}
   const response=await handle(new Request('http://localhost:'+port+url.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body}));
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
  const root=path.resolve('dist/public');let target=path.resolve(root,'.'+decodeURIComponent(url.pathname));
  if(target!==root&&!target.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  if(path.extname(target)&&!await fs.stat(target).catch(()=>null)){res.writeHead(404);res.end();return;}
  if(!path.extname(target))target=path.join(root,'index.html');
  const content=await fs.readFile(target);res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:content);
 }catch{res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Request failed.'}));}
});
setInterval(()=>{const now=Date.now();for(const [id,a]of attempts)if(now-a.start>60000)attempts.delete(id);},60000).unref();
server.listen(port,'127.0.0.1',()=>console.log('OwnVoice ready at http://localhost:'+port));
