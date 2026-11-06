import { EventEmitter } from 'node:events';
import { SignJWT, jwtVerify } from 'jose';
import { WebSocketServer } from 'ws';
import type { Server } from 'node:http';
import { appUrl, required } from './config';
const bus=new EventEmitter();bus.setMaxListeners(0);
const secret=()=>new TextEncoder().encode(required('JWT_SECRET'));
export async function createToken({userId,channels,ttlSeconds=300}:{userId:string;channels:string[];ttlSeconds?:number}){
 const token=await new SignJWT({channels}).setProtectedHeader({alg:'HS256'}).setSubject(userId).setAudience('jobhunt-realtime').setExpirationTime(Math.floor(Date.now()/1000)+ttlSeconds).sign(secret());
 const url=appUrl();url.protocol=url.protocol==='https:'?'wss:':'ws:';url.pathname='/__runtime/realtime';
 return {ok:true,token,wssEndpoint:url.toString()};
}
export async function publish(channel:string,data:unknown){bus.emit(channel,data);return {ok:true,delivered:bus.listenerCount(channel)};}
export async function lastSeen(){return {ok:false,error:{message:'Presence is not enabled.'}};}
export function attachRealtime(server:Server){
 const ws=new WebSocketServer({noServer:true,maxPayload:16384});
 server.on('upgrade',async(request,socket,head)=>{
  try{const u=new URL(request.url||'/',appUrl());if(u.pathname!=='/__runtime/realtime')return socket.destroy();
   if(request.headers.origin!==appUrl().origin)throw new Error('Origin mismatch');
   const {payload}=await jwtVerify(u.searchParams.get('token')||'',secret(),{audience:'jobhunt-realtime'});
   if(!Array.isArray(payload.channels)||!payload.sub)throw new Error('Bad token');
   ws.handleUpgrade(request,socket,head,client=>{
    const subscriptions=new Map<string,(data:unknown)=>void>();const timer=setTimeout(()=>client.close(4001,'Refresh token'),Math.max(1,(Number(payload.exp)*1000-Date.now())));timer.unref();
    client.on('message',raw=>{try{const m=JSON.parse(raw.toString());if(m.action==='ping'){client.send('{"pong":true}');return;}
     if(typeof m.channel!=='string'||!payload.channels!.includes(m.channel))return client.close(1008,'Channel refused');
     if(m.action==='subscribe'&&!subscriptions.has(m.channel)){const fn=(data:unknown)=>{if(client.readyState===1)client.send(JSON.stringify({channel:m.channel,data}));};subscriptions.set(m.channel,fn);bus.on(m.channel,fn);}
     if(m.action==='unsubscribe'){const fn=subscriptions.get(m.channel);if(fn)bus.off(m.channel,fn);subscriptions.delete(m.channel);}
    }catch{client.close(1008,'Invalid message');}});
    client.on('close',()=>{clearTimeout(timer);for(const[c,fn]of subscriptions)bus.off(c,fn);});
   });
  }catch{socket.destroy();}
 });
}
