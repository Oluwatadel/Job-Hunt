import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {transform} from 'esbuild';
async function source(p){const r=await transform(await fs.readFile(p,'utf8'),{loader:'tsx',format:'esm',target:'node22'});return import('data:text/javascript;base64,'+Buffer.from(r.code).toString('base64'));}
test('automation requires current paid invoice or explicit owner/admin access',async()=>{
 const {hasAutomationAccess:access}=await source('floot/helpers/hasAutomationAccess.tsx');
 const now=new Date('2026-10-29'),past=new Date('2026-09-29'),future=new Date('2026-11-29');const base={userId:2,ownerId:1,now};
 assert.equal(access(base),false);assert.equal(access({...base,billing:{status:'active',periodEnd:future,paidThrough:null}}),false);
 for(const status of ['trialing','past_due','unpaid','incomplete','canceled'])assert.equal(access({...base,billing:{status,periodEnd:future,paidThrough:future}}),false);
 assert.equal(access({...base,billing:{status:'active',periodEnd:future,paidThrough:past}}),false);
 assert.equal(access({...base,billing:{status:'active',periodEnd:future,paidThrough:future}}),true);
 assert.equal(access({...base,userId:1}),true);assert.equal(access({...base,accessUntil:future}),true);assert.equal(access({...base,accessUntil:past}),false);assert.equal(access({...base,disabled:true,accessUntil:future}),false);
});
test('external providers require verified emails and immutable identities',async()=>{
 process.env.GITHUB_OAUTH_CLIENT_ID='test-client';process.env.GITHUB_OAUTH_CLIENT_SECRET='not-a-real-secret';
 const {ExternalOAuthProvider}=await source('floot/helpers/ExternalOAuthProvider.tsx');const p=new ExternalOAuthProvider('github','https://app.example/callback');
 const request=p.generateAuthorizationUrl('unguessable-state'),url=new URL(request.url);assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('scope'),'read:user user:email');assert.ok(request.codeVerifier.length>=43);assert.equal(url.searchParams.has('client_secret'),false);
 assert.throws(()=>p.mapUserData({id:1,email:'a@example.com',email_verified:false}));
 assert.equal(p.mapUserData({id:123,email:'A@EXAMPLE.COM',email_verified:true}).providerUserId,'123');
 assert.equal(p.mapUserData({id:123,email:'A@EXAMPLE.COM',email_verified:true}).email,'a@example.com');
});
