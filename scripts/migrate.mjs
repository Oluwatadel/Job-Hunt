import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
if(!process.env.DATABASE_URL)throw new Error('Set DATABASE_URL first.');
const sql=postgres(process.env.DATABASE_URL,{max:1});
try{
 await sql.begin(async tx=>{
  await tx`SELECT pg_advisory_xact_lock(8310452)`;
  await tx`CREATE TABLE IF NOT EXISTS runtime_migrations (name text PRIMARY KEY, hash text NOT NULL, applied_at timestamptz NOT NULL DEFAULT NOW())`;
  for(const name of (await fs.readdir('migrations')).filter(n=>n.endsWith('.sql')).sort()){
   const source=await fs.readFile('migrations/'+name,'utf8'),hash=createHash('sha256').update(source).digest('hex');
   const rows=await tx`SELECT hash FROM runtime_migrations WHERE name=${name}`;
   if(rows.length){if(rows[0].hash!==hash)throw new Error('An applied migration was modified: '+name);continue;}
   if(name==='001-baseline.sql'){
    const exists=await tx`SELECT to_regclass('public.users') AS table_name`;
    if(exists[0].table_name)throw new Error('This database already contains users. Use a fresh database or follow the documented existing-data migration review.');
   }
   await tx.unsafe(source);await tx`INSERT INTO runtime_migrations(name,hash) VALUES(${name},${hash})`;console.log('Applied '+name);
  }
  const setting=await tx`SELECT owner_id FROM platform_settings WHERE id=1`;
  if(!setting.length){
   const email=process.env.OWNER_EMAIL?.trim().toLowerCase(),password=process.env.OWNER_PASSWORD;
   if(!email||!password||password.length<12)throw new Error('For a fresh database, set OWNER_EMAIL and OWNER_PASSWORD (at least 12 characters).');
   const [owner]=await tx`INSERT INTO users(email,display_name,role) VALUES(${email},${process.env.OWNER_NAME||'Owner'},'admin') RETURNING id`;
   await tx`INSERT INTO user_passwords(user_id,password_hash) VALUES(${owner.id},${await bcrypt.hash(password,12)})`;
   await tx`INSERT INTO platform_settings(id,owner_id,amount,currency,billing_enabled) VALUES(1,${owner.id},500000,'ngn',false)`;
   console.log('Owner created. Billing remains disabled until configured in Admin.');
  }
 });
}finally{await sql.end();}
