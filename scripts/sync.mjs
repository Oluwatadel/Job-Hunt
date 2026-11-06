import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { hash,safePath,plan,parseTree,parseFiles,batches } from './sync-core.mjs';
import { connectFloot } from './floot-client.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);
const config=JSON.parse(await fs.readFile('floot.project.json','utf8'));
const source=config.sourceDirectory;
if(source!=='floot')throw new Error('Review the sync source directory before changing it.');
const mode=process.argv[2]||'plan';if(!['plan','pull','push','watch'].includes(mode))throw new Error('Use plan, pull, push or watch.');
await fs.mkdir('.floot-sync',{recursive:true});
let lock;
try{lock=await fs.open('.floot-sync/lock','wx');await lock.writeFile(String(process.pid));}catch{throw new Error('Another sync is running. If it exited, verify its PID before removing .floot-sync/lock.');}
const manifestFile='.floot-sync/manifest.json';let client;
const run=script=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,['--env-file-if-exists=.env',script],{stdio:'inherit'});p.on('error',reject);p.on('exit',c=>c===0?resolve():reject(new Error('Local verification failed. Nothing has been pushed.')));});
async function localFiles(dir,prefix=''){const files={};for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=prefix+e.name;const stat=await fs.lstat(path.join(dir,e.name));if(stat.isSymbolicLink())throw new Error('Symlinks are refused: '+p);if(e.isDirectory())Object.assign(files,await localFiles(path.join(dir,e.name),p+'/'));else files[safePath(p)]=await fs.readFile(path.join(dir,e.name),'utf8');}return files;}
const hashes=files=>Object.fromEntries(Object.entries(files).map(([p,c])=>[p,hash(c)]));
async function remoteFiles(tree,paths){let out={};for(const group of batches(paths.map(p=>[p,tree.files[p]]))){const names=group.map(x=>x[0]);const text=await client.call('read_files',{projectId:config.projectId,paths:names,limit:5000});const versions=[...text.matchAll(/\(version: (\d+)(?:, sha256: [a-f0-9]{64})?\)/g)].map(m=>Number(m[1]));if(versions.some(v=>v!==tree.version))throw new Error('Remote source changed during sync. Rerun to compare again.');Object.assign(out,parseFiles(text,names));}return out;}
async function backup(p,content){const dir='.floot-sync/backups/'+new Date().toISOString().replace(/[:.]/g,'-');await fs.mkdir(path.dirname(path.join(dir,p)),{recursive:true});await fs.writeFile(path.join(dir,p),content);}
async function sync(action){
 const base=JSON.parse(await fs.readFile(manifestFile,'utf8'));
 if(base.projectId!==config.projectId)throw new Error('Sync baseline is for a different Floot project.');
 const local=await localFiles(source),lh=hashes(local);
 let tree=parseTree(await client.call('list_files',{projectId:config.projectId}));
 const remotePaths=Object.keys(tree.files),remote={};let rh;
 // A matching project version proves the previous remote baseline is still current.
 if(tree.version===base.version)rh={...base.files};else{Object.assign(remote,await remoteFiles(tree,remotePaths));rh=hashes(remote);}
 if(base.pendingVerification?.length&&tree.version===base.version){
  const pending=await remoteFiles(tree,base.pendingVerification);
  for(const p of base.pendingVerification)if(hash(pending[p])!==base.files[p])throw new Error('Initial remote write verification did not match: '+p+'. Review Floot history before syncing.');
 }
 const changes=plan(base.files,lh,rh);console.log(JSON.stringify({action,...Object.fromEntries(Object.entries(changes).filter(([k])=>k!=='unchanged'))},null,2));
 if(changes.conflicts.length||changes.deletions.length)throw new Error('Conflicts/deletions require manual review. No source changes were applied.');
 if(action==='plan')return;
 if(base.pendingRemoteTypecheck){const check=await client.call('typecheck',{projectId:config.projectId});if(!/typecheck: clean/i.test(check))throw new Error('Final Floot typecheck is still pending or failed. No source changes were applied.\n'+check);}
 if(action==='pull'&&changes.pull.length){
  const missing=changes.pull.filter(p=>remote[p]===undefined);Object.assign(remote,await remoteFiles(tree,missing));
  // Check local content again before replacing it; preserve every existing version.
  for(const p of changes.pull){let old;try{old=await fs.readFile(path.join(source,p),'utf8');}catch{}if((old===undefined?undefined:hash(old))!==lh[p])throw new Error('Local file changed during sync: '+p);if(old!==undefined)await backup(p,old);await fs.mkdir(path.dirname(path.join(source,p)),{recursive:true});await fs.writeFile(path.join(source,p),remote[p]);local[p]=remote[p];}
 }
 if(action==='push'&&changes.pull.length)throw new Error('Pull remote changes first, review, then push.');
 if(action==='push'&&changes.push.length){
  await run('scripts/build.mjs');
  for(const p of changes.push)if(hash(await fs.readFile(path.join(source,p),'utf8'))!==lh[p])throw new Error('Local source changed during verification: '+p+'. Rerun sync.');
  for(const group of batches(changes.push.map(p=>[p,local[p].length]),12000)){
   const patch='*** Begin Patch\n'+group.map(([p])=>'*** Add File: '+p+'\n'+local[p].split('\n').map(l=>'+'+l).join('\n')).join('\n')+'\n*** End Patch';
   const result=await client.call('apply_patch',{projectId:config.projectId,expected_version:tree.version,patch});const m=result.match(/version:\s*(\d+)/);if(!m)throw new Error('Push result had no version. Inspect Floot history before retrying.');tree.version=Number(m[1]);
  }
  const check=await client.call('typecheck',{projectId:config.projectId});if(!/typecheck: clean/i.test(check))throw new Error('Floot typecheck did not pass. Pushed changes remain visible in Floot; fix them before the baseline can advance.\n'+check);
  const fresh=parseTree(await client.call('list_files',{projectId:config.projectId}));if(fresh.version!==tree.version)throw new Error('Remote changed after push. Rerun for conflict review.');
  const verified=await remoteFiles(fresh,changes.push);for(const p of changes.push){if(hash(verified[p])!==lh[p])throw new Error('Remote verification mismatch: '+p);rh[p]=lh[p];}
 }
 const newLocal=hashes(local);const common={...base.files};for(const p of new Set([...Object.keys(newLocal),...Object.keys(rh)]))if(newLocal[p]===rh[p]){if(rh[p]===undefined)delete common[p];else common[p]=rh[p];}
 // Keep the old remote version while some remote changes remain unapplied locally.
 const complete=Object.keys(newLocal).length===Object.keys(rh).length&&Object.keys(rh).every(p=>newLocal[p]===rh[p]);
 await fs.writeFile(manifestFile,JSON.stringify({projectId:config.projectId,version:complete?tree.version:base.version,files:common,syncedAt:new Date().toISOString()},null,2)+'\n');
 console.log(complete?'Both source copies match. Publishing remains a separate action.':'Synchronized requested direction; local edits remain to push.');
}
try{
 client=await connectFloot(config.mcpUrl);
 if(mode==='watch'){
  await sync('pull');await sync('push');
  const {watch}=await import('chokidar');let timer,busy=false,queued=false;
  const watcher=watch(source,{ignoreInitial:true,awaitWriteFinish:{stabilityThreshold:1500}});
  async function flush(){if(busy)return;busy=true;try{do{queued=false;await sync('push');}while(queued);}catch(e){console.error(e.message);console.error('Sync paused. Resolve this issue and restart watch.');await watcher.close();process.exitCode=1;process.emit('SIGTERM');}finally{busy=false;}}
  watcher.on('all',()=>{queued=true;clearTimeout(timer);timer=setTimeout(flush,2000);});
  console.log('Watching local source. Remote-only edits are pulled on restart or with sync:pull. Keep this terminal running.');
  await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});clearTimeout(timer);await watcher.close();
 }else await sync(mode);
}finally{await client?.close();await lock.close();await fs.unlink('.floot-sync/lock').catch(()=>{});}
