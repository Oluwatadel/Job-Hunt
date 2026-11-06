import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('fresh PostgreSQL schema enforces tenant and identity constraints',async()=>{
 const db=new PGlite();try{
  for(const name of ['001-baseline.sql','002-portable-runtime.sql'])await db.exec(await fs.readFile('migrations/'+name,'utf8'));
  await db.query("INSERT INTO users(email,display_name) VALUES ('a@example.com','A'),('b@example.com','B')");
  await db.query("INSERT INTO applications(user_id,doc_id,company,role,status) VALUES (1,'same','A','Role','needs_input'),(2,'same','B','Role','needs_input')");
  assert.equal((await db.query('SELECT count(*)::int AS n FROM applications')).rows[0].n,2);
  await assert.rejects(()=>db.query("INSERT INTO applications(user_id,doc_id,company,role) VALUES (1,'same','A','Role')"));
  await db.query("INSERT INTO oauth_accounts(user_id,provider,provider_user_id,provider_email) VALUES (1,'github','immutable','a@example.com')");
  await assert.rejects(()=>db.query("INSERT INTO oauth_accounts(user_id,provider,provider_user_id,provider_email) VALUES (2,'github','immutable','b@example.com')"));
  const billing=await db.query("INSERT INTO billing_accounts(user_id,is_live) VALUES (2,true) RETURNING status,paid_through");assert.equal(billing.rows[0].status,'none');assert.equal(billing.rows[0].paid_through,null);
 }finally{await db.close();}
});
