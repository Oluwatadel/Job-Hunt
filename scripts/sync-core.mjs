import { createHash } from 'node:crypto';
export const hash = content => createHash('sha256').update(content).digest('hex');
export function safePath(p) {
 if(p==='base.css')return p;
 if(typeof p!=='string'||p.includes('\\')||p.split('/').some(s=>!s||s==='.'||s==='..')||!/^(components|helpers|pages|endpoints|static)\//.test(p))throw new Error('Unsafe source path: '+p);
 if(/(^|\/)(\.env(?:\..*)?|node_modules|\.git)(\/|$)/.test(p))throw new Error('Private path refused: '+p);
 return p;
}
export function plan(baseline,local,remote){
 const result={push:[],pull:[],conflicts:[],deletions:[],unchanged:[]};
 for(const p of new Set([...Object.keys(baseline),...Object.keys(local),...Object.keys(remote)])){
  safePath(p);const b=baseline[p],l=local[p],r=remote[p];
  if(b!==undefined&&(l===undefined||r===undefined)){result.deletions.push(p);continue;}
  if(l===r){result.unchanged.push(p);continue;}
  if(l===b)result.pull.push(p);else if(r===b)result.push.push(p);else result.conflicts.push(p);
 }
 return result;
}
export function parseTree(text){
 const v=text.match(/\bversion:\s*(\d+)/);if(!v)throw new Error('Floot did not return a project version.');
 const files={};for(const l of text.split('\n')){const m=l.match(/^((?:base\.css|components\/\S+|pages\/\S+|helpers\/\S+|endpoints\/\S+|static\/\S+)) \((\d+) chars\)/);if(m)files[safePath(m[1])]=Number(m[2]);}
 if(!Object.keys(files).length)throw new Error('Floot source tree was empty or unrecognized.');return {version:Number(v[1]),files};
}
export function parseFiles(text,expected){
 const files={};let current,total=0,lines=[];
 function finish(){if(!current)return;if(lines.length!==total)throw new Error('Incomplete source response: '+current);files[current]=lines.join('\n');}
 for(const line of text.split('\n')){
  const m=line.match(/^(\S+) — lines 1-(\d+) of (\d+) \(version: (\d+)(?:, sha256: [a-f0-9]{64})?\)/);
  if(m){finish();if(m[2]!==m[3])throw new Error('Partial file refused: '+m[1]);current=safePath(m[1]);total=Number(m[3]);lines=[];continue;}
  if(current&&/^\s*\d+\t/.test(line))lines.push(line.replace(/^\s*\d+\t/,''));
 }
 finish();for(const p of expected)if(files[p]===undefined)throw new Error('Floot omitted '+p+'; no changes were applied.');return files;
}
export function batches(entries,maxChars=22000){const groups=[];let g=[],size=0;for(const e of entries){if(g.length&&(g.length>=20||size+e[1]>maxChars)){groups.push(g);g=[];size=0;}g.push(e);size+=e[1];}if(g.length)groups.push(g);return groups;}
