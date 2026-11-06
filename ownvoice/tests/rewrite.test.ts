import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rewriteDraft} from '../floot/helpers/rewriteDraft';
const draft='The study found that 42% of participants improved over 12 weeks (Smith, 2024). This result requires further careful study.';
const input={text:draft,tone:'Natural' as const,strength:'Balanced' as const,voice:''};
function echo(p:Record<string,unknown>){return Promise.resolve({status:'completed',output_text:JSON.parse(p.input as string).draft});}
test('preserves protected numbers and citations exactly',async()=>{const r=await rewriteDraft.run(input,echo);assert.equal(r.text,draft);});
test('rejects dropped protected tokens',async()=>{await assert.rejects(rewriteDraft.run(input,async()=>({output_text:'A new draft with the citations and results removed.'})),/protected references/);});
test('rejects duplicate protected tokens',async()=>{await assert.rejects(rewriteDraft.run(input,async p=>({output_text:JSON.parse(p.input as string).draft+' ⟦OV_0⟧'})),/protected references/);});
test('rejects incomplete model output',async()=>{await assert.rejects(rewriteDraft.run(input,async()=>({status:'incomplete'})),/did not finish/);});
test('validates request limits and enums',()=>{assert.equal(rewriteDraft.schema.safeParse({...input,text:'short'}).success,false);assert.equal(rewriteDraft.schema.safeParse({...input,text:'word '.repeat(4000)}).success,false);assert.equal(rewriteDraft.schema.safeParse({...input,tone:'Evasive'}).success,false);});
test('rejects marker injection before calling AI',async()=>{let called=false;await assert.rejects(rewriteDraft.run({...input,text:draft+' ⟦OV_0⟧'},async()=>{called=true;return {};}),/reserved/);assert.equal(called,false);});
test('protects quotes, numerical references and URLs',async()=>{const text='She wrote “Keep this exact quotation” in the final report [1, 3]. Read https://example.com/paper for more details about the study.';assert.equal((await rewriteDraft.run({...input,text},echo)).text,text);});
test('warns if a new numerical claim appears',async()=>{const r=await rewriteDraft.run(input,async p=>({output_text:JSON.parse(p.input as string).draft+' There were 999 people.'}));assert.match(r.warnings[0],/new numerical/);});
