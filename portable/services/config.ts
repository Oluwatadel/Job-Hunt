import postgres from 'postgres';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
export const runtimeContext = new AsyncLocalStorage<{request:Request}>();
export const appUrl = () => new URL(process.env.APP_URL || 'http://localhost:3000');
export function required(name:string) { const v=process.env[name];if(!v)throw new Error(`${name} must be configured for this feature.`);return v; }
let sqlClient:ReturnType<typeof postgres>;
export const runtimeDb = () => sqlClient ||= postgres(required('DATABASE_URL'),{prepare:false,max:4});
const key=()=>createHash('sha256').update(required('JWT_SECRET')).digest();
export function encrypt(value:unknown){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(),iv);const data=Buffer.concat([c.update(JSON.stringify(value),'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data]).toString('base64url');}
export function decrypt(value:string){const data=Buffer.from(value,'base64url'),c=createDecipheriv('aes-256-gcm',key(),data.subarray(0,12));c.setAuthTag(data.subarray(12,28));return JSON.parse(Buffer.concat([c.update(data.subarray(28)),c.final()]).toString('utf8'));}
