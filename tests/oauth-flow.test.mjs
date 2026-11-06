import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';
import {Kysely,PostgresDialect,CamelCasePlugin} from 'kysely';
import {SignJWT} from 'jose';
import superjson from 'superjson';

test('OAuth callback and exchange reject takeover, replay and browser mismatch',async()=>{
 const pg=new PGlite();process.env.JWT_SECRET='test-only-secret-for-browser-bound-oauth-flows';
 const client={query:async(q,values)=>{const text=typeof q==='string'?q:q.text;const r=await pg.query(text,values||q.values||[]);return {rows:r.rows,rowCount:r.affectedRows||r.rows.length,command:text.split(' ')[0]};},release(){},on(){}};
 const db=new Kysely({dialect:new PostgresDialect({pool:{connect:async()=>client,end:async()=>{}}}),plugins:[new CamelCasePlugin()]});globalThis.__oauthTestDb=db;
 const dir=path.resolve('tests/.generated');await fs.mkdir(dir,{recursive:true});
 try{
  await pg.exec(await fs.readFile('migrations/001-baseline.sql','utf8'));
  await db.insertInto('users').values({email:'owner@example.com',displayName:'Owner',role:'admin'}).execute();
  globalThis.__oauthIdentity={providerUserId:'new-immutable',email:'new@example.com',displayName:'New User',avatarUrl:null};
  const result=await build({stdin:{contents:`export {handle as authorize} from './floot/endpoints/auth/oauth_authorize_GET.ts';export {handle as callback} from './floot/endpoints/auth/oauth_callback_GET.ts';export {handle as establish} from './floot/endpoints/auth/establish_session_POST.ts';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',packages:'external',alias:{'@floot/payments':path.resolve('portable/services/payments.ts')},plugins:[{name:'isolated-oauth-db',setup(b){b.onResolve({filter:/helpers\/db$|^\.\/db$/},()=>({path:'test-db',namespace:'fixture'}));b.onResolve({filter:/getOAuthProvider$/},()=>({path:'provider',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='test-db'?'export const db=globalThis.__oauthTestDb;':`export function getOAuthProvider(name,redirectUri){return {redirectUri,generateAuthorizationUrl(state){return {url:'https://provider.example/authorize?state='+state,codeVerifier:'pkce-test'}},async exchangeCodeForTokens(){return {}},async fetchUserInfo(){return globalThis.__oauthIdentity},mapUserData(data){return data}}}`,loader:'ts'}));}}]});
  const file=path.join(dir,'oauth-backend.mjs');await fs.writeFile(file,result.outputFiles[0].text);const api=await import(pathToFileURL(file).href);
  const origin='https://app.example';
  async function start(extra='',session=''){
   const r=await api.authorize(new Request(origin+'/_api/auth/oauth_authorize?provider=github'+extra,{headers:{cookie:session}}));assert.equal(r.status,302);
   const state=new URL(r.headers.get('location')).searchParams.get('state');const browser=r.headers.get('set-cookie').split(';')[0];return {state,cookie:[browser,session].filter(Boolean).join('; ')};
  }
  const callback=(s,cookie=s.cookie)=>api.callback(new Request(origin+'/_api/auth/oauth_callback?state='+s.state+'&code=mock-code',{headers:{cookie}}));
  const exchange=(token,cookie)=>api.establish(new Request(origin+'/_api/auth/establish_session',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:superjson.stringify({tempToken:token})}));
  const s=await start();assert.equal((await callback(s,'')).status,400);const accepted=await callback(s);assert.equal(accepted.status,200);const html=await accepted.text();const token=html.match(/"token":"([a-f0-9]{64})"/)[1];
  assert.equal((await callback(s)).status,400);assert.equal((await exchange(token,'oauth_browser=wrong')).status,400);
  const completed=await exchange(token,s.cookie);assert.equal(completed.status,200);const user=superjson.parse(await completed.text()).user;assert.equal(user.role,'user');assert.equal(user.email,'new@example.com');assert.equal((await exchange(token,s.cookie)).status,400);
  const created=await db.selectFrom('users').selectAll().where('id','=',user.id).executeTakeFirstOrThrow();assert.equal(created.accessUntil,null);assert.equal((await db.selectFrom('billingAccounts').selectAll().where('userId','=',user.id).execute()).length,0);
  // An email collision cannot attach a new subject to the owner account.
  globalThis.__oauthIdentity={...globalThis.__oauthIdentity,providerUserId:'attacker-subject',email:'owner@example.com'};
  const collision=await start();assert.equal((await callback(collision)).status,400);assert.equal((await db.selectFrom('oauthAccounts').selectAll().where('userId','=',1).execute()).length,0);
  // Existing accounts can explicitly link a provider while authenticated.
  const sid='signed-owner-session',now=new Date();await db.insertInto('sessions').values({id:sid,userId:1,expiresAt:new Date(Date.now()+600000)}).execute();
  const jwt=await new SignJWT({id:sid,createdAt:now.getTime(),lastAccessed:now.getTime()}).setProtectedHeader({alg:'HS256'}).setExpirationTime('10m').sign(new TextEncoder().encode(process.env.JWT_SECRET));
  const link=await start('&link=1','floot_built_app_session='+jwt);assert.equal((await callback(link)).status,200);assert.equal((await db.selectFrom('oauthAccounts').selectAll().where('userId','=',1).execute()).length,1);
  // A linked subject continues to identify the same account after email changes.
  globalThis.__oauthIdentity={...globalThis.__oauthIdentity,email:'changed@example.com'};const again=await start();const signedIn=await callback(again);assert.equal(signedIn.status,200);const t=(await signedIn.text()).match(/"token":"([a-f0-9]{64})"/)[1];const owner=superjson.parse(await(await exchange(t,again.cookie)).text()).user;assert.equal(owner.id,1);assert.equal(owner.email,'owner@example.com');
  await db.updateTable('users').set({disabled:true}).where('id','=',1).execute();const suspended=await start();assert.equal((await callback(suspended)).status,400);
 }finally{await db.destroy();await pg.close();delete globalThis.__oauthTestDb;delete globalThis.__oauthIdentity;}
});
