import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
test('self-hosted server serves the app and refuses unauthenticated or cross-site work',async()=>{
 const url='http://127.0.0.1:31879';let output='';
 const child=spawn(process.execPath,['dist/server.mjs'],{env:{...process.env,APP_URL:url,PORT:'31879',DATABASE_URL:'postgres://unused:unused@127.0.0.1:1/unused',JWT_SECRET:'test-only-secret-at-least-thirty-two-characters',ENABLE_SCHEDULER:'false',NODE_ENV:'test',STRIPE_SECRET_KEY:'',GOOGLE_OAUTH_CLIENT_ID:'',GOOGLE_OAUTH_CLIENT_SECRET:'',FLOOT_OAUTH_CLIENT_ID:'',FLOOT_OAUTH_CLIENT_SECRET:'',GITHUB_OAUTH_CLIENT_ID:'',GITHUB_OAUTH_CLIENT_SECRET:'',LINKEDIN_OAUTH_CLIENT_ID:'',LINKEDIN_OAUTH_CLIENT_SECRET:''},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server did not start: '+output)),10000);child.stdout.on('data',()=>{if(output.includes('listening')){clearTimeout(timer);resolve();}});child.once('exit',code=>{clearTimeout(timer);reject(new Error('Server exited '+code+': '+output));});});
  assert.equal((await fetch(url+'/healthz')).status,200);assert.equal((await fetch(url+'/login')).status,200);assert.equal((await fetch(url+'/_api/account')).status,401);
  assert.equal((await fetch(url+'/_api/automations/request',{method:'POST',headers:{Origin:'https://other.example'},body:'{}'})).status,403);
  assert.equal((await fetch(url+'/_api/auth/oauth_callback?state=invalid')).status,400);
  const providers=await(await fetch(url+'/_api/auth/providers')).json();assert.deepEqual(providers.providers.map(p=>p.name),['Google','LinkedIn','GitHub']);assert.equal(providers.providers.every(p=>!p.enabled),true);
  assert.equal((await fetch(url+'/_api/payments/event',{method:'POST',body:'unsigned'})).status,400);
 }finally{child.kill();await new Promise(resolve=>child.once('exit',resolve));}
});
