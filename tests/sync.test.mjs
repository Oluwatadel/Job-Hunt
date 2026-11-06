import {test} from 'node:test';
import assert from 'node:assert/strict';
import {plan,safePath,parseTree,parseFiles,batches} from '../scripts/sync-core.mjs';
test('three-way sync keeps unrelated changes and refuses competing edits',()=>{
 const b={'helpers/a.tsx':'a','helpers/b.tsx':'b','helpers/c.tsx':'c'};
 const l={...b,'helpers/a.tsx':'local','helpers/c.tsx':'local-c'};
 const r={...b,'helpers/b.tsx':'remote','helpers/c.tsx':'remote-c'};
 const p=plan(b,l,r);assert.deepEqual(p.push,['helpers/a.tsx']);assert.deepEqual(p.pull,['helpers/b.tsx']);assert.deepEqual(p.conflicts,['helpers/c.tsx']);
});
test('deletions require review, including a file deleted on both sides',()=>{
 assert.deepEqual(plan({'helpers/a.tsx':'a'},{},{}).deletions,['helpers/a.tsx']);
 assert.deepEqual(plan({'helpers/a.tsx':'a'},{},{'helpers/a.tsx':'a'}).deletions,['helpers/a.tsx']);
});
test('only canonical source paths are accepted',()=>{
 for(const p of ['../.env','helpers/../../private','helpers/.env','helpers/a/../b.tsx','helpers\\a.tsx','portable/server.ts'])assert.throws(()=>safePath(p));
 assert.equal(safePath('pages/apply.$id.tsx'),'pages/apply.$id.tsx');
});
test('incomplete remote responses never become source code',()=>{
 const p='helpers/test.tsx';const text=`${p} — lines 1-2 of 2 (version: 100)\n    1\tconst a=1;\n    2\t`;
 assert.equal(parseFiles(text,[p])[p],'const a=1;\n');assert.throws(()=>parseFiles(text.slice(0,text.lastIndexOf('\n')),[p]));assert.throws(()=>parseFiles(text,['helpers/omitted.tsx']));
 assert.equal(parseFiles(text.replace('(version: 100)', '(version: 100, sha256: '+ 'a'.repeat(64) +')'),[p])[p],'const a=1;\n');
 assert.deepEqual(parseTree('version: 100\nbase.css (123 chars)'),{version:100,files:{'base.css':123}});
 assert.equal(batches(Array.from({length:25},(_,i)=>['helpers/'+i+'.tsx',100])).length,2);
});
