import { randomBytes, createHash } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { appUrl, required, runtimeDb, runtimeContext, encrypt, decrypt } from './config';
import { serverAccess } from '../../floot/helpers/serverAccess';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const callback=()=>new URL('/__runtime/google/callback',appUrl()).toString();
const secret=()=>new TextEncoder().encode(required('JWT_SECRET'));
const cookie=(r:Request)=>r.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('google_connect_browser='))?.split('=')[1]||'';
export async function handleGoogleAuthorize(request:Request){
 const user=await serverAccess.current(request);
 const features=(new URL(request.url).searchParams.get('feature')||'driveFile').split(',');
 if(features.some(f=>!['driveFile','gmail'].includes(f)))throw new Error('Unsupported Google connection feature.');
 const scopes=['openid','email','profile',...(features.includes('driveFile')?['https://www.googleapis.com/auth/drive.file']:[]),...(features.includes('gmail')?['https://www.googleapis.com/auth/gmail.send']:[])];
 const nonce=randomBytes(32).toString('hex'),browser=randomBytes(32).toString('hex'),verifier=randomBytes(32).toString('base64url');
 await runtimeDb()`INSERT INTO runtime_oauth_pending (state_hash,user_id,browser_hash,verifier,expires_at) VALUES (${hash(nonce)},${user.id},${hash(browser)},${verifier},NOW()+INTERVAL '10 minutes')`;
 const state=await new SignJWT({nonce}).setProtectedHeader({alg:'HS256'}).setSubject(String(user.id)).setAudience('google-connect').setIssuer(appUrl().origin).setExpirationTime('10m').sign(secret());
 const params=new URLSearchParams({client_id:required('GOOGLE_INTEGRATION_CLIENT_ID'),redirect_uri:callback(),response_type:'code',scope:scopes.join(' '),access_type:'offline',prompt:'consent',state,code_challenge:hashBase64(verifier),code_challenge_method:'S256'});
 return Response.json({authorize_url:'https://accounts.google.com/o/oauth2/v2/auth?'+params},{headers:{'Cache-Control':'no-store','Set-Cookie':`google_connect_browser=${browser}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`}});
}
function hashBase64(v:string){return createHash('sha256').update(v).digest('base64url');}
export async function googleCallback(request:Request){
 try{
 const u=await serverAccess.current(request),url=new URL(request.url);
 const {payload}=await jwtVerify(url.searchParams.get('state')||'',secret(),{audience:'google-connect',issuer:appUrl().origin});
 if(payload.sub!==String(u.id)||typeof payload.nonce!=='string')throw new Error('Google connection account did not match.');
 const rows=await runtimeDb()`DELETE FROM runtime_oauth_pending WHERE state_hash=${hash(payload.nonce)} AND user_id=${u.id} AND browser_hash=${hash(cookie(request))} AND expires_at>NOW() RETURNING verifier`;
 if(!rows.length||!url.searchParams.get('code')||url.searchParams.has('error'))throw new Error('Google connection expired or declined.');
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:required('GOOGLE_INTEGRATION_CLIENT_ID'),client_secret:required('GOOGLE_INTEGRATION_CLIENT_SECRET'),code:url.searchParams.get('code')!,grant_type:'authorization_code',redirect_uri:callback(),code_verifier:rows[0].verifier})});
 const token=await r.json();if(!r.ok||!token.access_token)throw new Error('Google connection could not be completed.');
 const info=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+token.access_token}});if(!info.ok)throw new Error('Unable to verify Google email.');
 const user=await info.json();if(!user.email||user.email_verified!==true)throw new Error('A verified Google email is required.');
 const code=randomBytes(32).toString('hex');
 await runtimeDb()`INSERT INTO runtime_google_pending (code_hash,user_id,email,tokens,expires_at) VALUES (${hash(code)},${u.id},${user.email.toLowerCase()},${encrypt(token)},NOW()+INTERVAL '1 minute')`;
 return new Response('Returning to Job Hunt…',{status:302,headers:{Location:new URL('/_api/auth/google_integrations_callback?connection_code='+code,appUrl()).toString(),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
 }catch{return renderConnectionPopup({type:'GOOGLE_INTEGRATION_ERROR',error:'Google connection failed. Please reconnect from your workspace.'});}
}
export async function finalizeGoogleConnection(_db:unknown,{code}:{code:string}){
 const request=runtimeContext.getStore()?.request;if(!request)throw new Error('Missing request context.');const user=await serverAccess.current(request);
 return runtimeDb().begin(async sql=>{
 const rows=await sql`DELETE FROM runtime_google_pending WHERE code_hash=${hash(code)} AND user_id=${user.id} AND expires_at>NOW() RETURNING *`;
 if(!rows.length)throw new Error('Connection expired.');const c=rows[0],token=decrypt(c.tokens);
 const existing=await sql`SELECT user_id,email,tokens FROM runtime_google_tokens WHERE user_id=${user.id} OR email=${c.email} FOR UPDATE`;
 if(existing.some(x=>x.user_id!==user.id||x.email!==c.email))throw new Error('Disconnect the previous account first, or use a Google account not connected to another workspace.');
 if(!token.refresh_token&&existing[0])token.refresh_token=decrypt(existing[0].tokens).refresh_token;
 if(!token.refresh_token)throw new Error('Google offline access is required. Reconnect and grant access.');
 token.expires_at=Date.now()+(token.expires_in||3600)*1000;
 const scopes=String(token.scope||'').split(' ').filter(Boolean);
 await sql`INSERT INTO runtime_google_tokens(user_id,email,tokens) VALUES(${user.id},${c.email},${encrypt(token)}) ON CONFLICT(user_id) DO UPDATE SET email=EXCLUDED.email,tokens=EXCLUDED.tokens`;
 return {email:c.email,scopes};
 });
}
export async function getGoogleAccessToken(_db:unknown,email:string){
 const rows=await runtimeDb()`SELECT tokens FROM runtime_google_tokens WHERE email=${email}`;if(!rows.length)throw new Error('Reconnect Google.');let token=decrypt(rows[0].tokens);
 if(token.expires_at<Date.now()+60000){
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:required('GOOGLE_INTEGRATION_CLIENT_ID'),client_secret:required('GOOGLE_INTEGRATION_CLIENT_SECRET'),grant_type:'refresh_token',refresh_token:token.refresh_token})});const next=await r.json();if(!r.ok||!next.access_token)throw new Error('Reconnect Google.');token={...token,...next,expires_at:Date.now()+(next.expires_in||3600)*1000};await runtimeDb()`UPDATE runtime_google_tokens SET tokens=${encrypt(token)} WHERE email=${email}`;
 }
 return {access_token:token.access_token,email,scopes:String(token.scope||'').split(' ')};
}
export async function disconnectGoogle(_db:unknown,email:string){
 const rows=await runtimeDb()`SELECT tokens FROM runtime_google_tokens WHERE email=${email}`;
 if(rows.length){const t=decrypt(rows[0].tokens);await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:t.refresh_token||t.access_token})}).catch(()=>{});}
 await runtimeDb()`DELETE FROM runtime_google_tokens WHERE email=${email}`;
}
export function renderConnectionPopup(message:unknown){const data=JSON.stringify(message).replace(/</g,'\\u003c');return new Response(`<!doctype html><html><body><p>Return to Job Hunt to continue.</p><a href="/documents">Documents</a><script>if(window.opener){window.opener.postMessage(${data},location.origin);window.close();}</script></body></html>`,{headers:{'Content-Type':'text/html','Cache-Control':'no-store'}});}
