import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import open from 'open';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export async function connectFloot(url){
 const file='.floot-sync/auth.json',redirect='http://127.0.0.1:34179/callback';
 let saved=JSON.parse(await fs.readFile(file,'utf8').catch(()=>'{}'));
 const save=async()=>{await fs.mkdir('.floot-sync',{recursive:true});await fs.writeFile(file,JSON.stringify(saved,null,2),{mode:0o600});};
 let callbackServer,callbackPromise,resolveCallback,rejectCallback;
 const expectedState=randomBytes(32).toString('hex');
 const provider={
  redirectUrl:redirect,
  clientMetadata:{client_name:'Job Hunt source synchronization',redirect_uris:[redirect],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'},
  state:()=>expectedState,
  clientInformation:()=>saved.client,
  saveClientInformation:async value=>{saved.client=value;await save();},
  tokens:()=>saved.tokens,
  saveTokens:async value=>{saved.tokens=value;await save();},
  saveCodeVerifier:async value=>{saved.verifier=value;await save();},
  codeVerifier:()=>saved.verifier,
  invalidateCredentials:async scope=>{if(scope==='all')saved={};else if(scope==='client')delete saved.client;else if(scope==='tokens')delete saved.tokens;else if(scope==='verifier')delete saved.verifier;await save();},
  redirectToAuthorization:async auth=>{
   if(!callbackPromise){callbackPromise=new Promise((resolve,reject)=>{resolveCallback=resolve;rejectCallback=reject;});callbackPromise.catch(()=>{});
    callbackServer=createServer((req,res)=>{const u=new URL(req.url,redirect);if(u.pathname!=='/callback'||u.searchParams.get('state')!==expectedState){res.writeHead(400);res.end('Invalid OAuth state.');return;}if(!u.searchParams.get('code')||u.searchParams.has('error')){res.writeHead(400);res.end('Authorization declined.');rejectCallback(new Error('Floot authorization declined.'));return;}res.writeHead(200,{'Content-Type':'text/plain'});res.end('Floot connected. You can return to the terminal.');resolveCallback(u.searchParams.get('code'));});
    await new Promise((resolve,reject)=>{callbackServer.once('error',reject);callbackServer.listen(34179,'127.0.0.1',resolve);});
   }
   console.log('Authorize source sync in your browser:\n'+auth.toString());await open(auth.toString()).catch(()=>{});
  }
 };
 let transport=new StreamableHTTPClientTransport(new URL(url),{authProvider:provider});
 let client=new Client({name:'job-hunt-source-sync',version:'1.0.0'});
 try{await client.connect(transport);}catch(error){
  if(!callbackPromise){await client.close().catch(()=>{});throw error;}
  try{const code=await callbackPromise;await transport.finishAuth(code);await transport.close().catch(()=>{});transport=new StreamableHTTPClientTransport(new URL(url),{authProvider:provider});client=new Client({name:'job-hunt-source-sync',version:'1.0.0'});await client.connect(transport);}finally{callbackServer?.close();}
 }
 callbackServer?.close();
 const listed=await client.listTools();
 return {
  close:()=>client.close(),
  async call(suffix,args){
   const matches=listed.tools.filter(t=>t.name===suffix||t.name.endsWith('_'+suffix));if(matches.length!==1)throw new Error('Floot tool not uniquely available: '+suffix);
   const r=await client.callTool({name:matches[0].name,arguments:args});const text=r.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');if(r.isError)throw new Error(text);return text;
  }
 };
}
