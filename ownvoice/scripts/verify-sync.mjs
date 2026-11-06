import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(await fs.readFile(new URL('../.floot-sync/manifest.json',import.meta.url),'utf8'));
let failures=0;
for(const [p,hash]of Object.entries(manifest.files)){
 const content=await fs.readFile(new URL('../floot/'+p,import.meta.url),'utf8');
 if(createHash('sha256').update(content).digest('hex')!==hash){console.error('Changed since verified remote readback: '+p);failures++;}
}
if(failures)process.exitCode=1;else console.log('All '+Object.keys(manifest.files).length+' managed source files match the verified remote readback at version '+manifest.version+'. This is not a live remote check.');
