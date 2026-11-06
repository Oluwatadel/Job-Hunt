import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as bundle } from 'esbuild';
import { build as viteBuild } from 'vite';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
await fs.mkdir('portable/generated', { recursive: true });
async function walk(dir) { const out = []; for (const f of await fs.readdir(dir, { withFileTypes: true })) { const p = dir + '/' + f.name; out.push(...(f.isDirectory() ? await walk(p) : [p])); } return out; }
const endpoints = (await walk('floot/endpoints')).filter(p => /_(GET|POST)\.ts$/.test(p));
await fs.writeFile('portable/generated/endpoints.ts', endpoints.map((p,i) => `import {handle as h${i}} from '../../${p}';`).join('\n') + '\nexport const endpoints:Record<string,(r:Request)=>Promise<Response>>={' + endpoints.map((p,i) => { const [,name,method] = p.match(/^floot\/endpoints\/(.*)_(GET|POST)\.ts$/); return JSON.stringify(method + ' /_api/' + name) + ':h' + i; }).join(',') + '};');
const pages = (await walk('floot/pages')).filter(p => p.endsWith('.tsx') && !/\.__example|\.pageLayout/.test(p));
const exists = async p => !!await fs.stat(p).catch(() => null);
let pageCode = "import React from 'react';\n";
const routes = [];
for (const [i,p] of pages.entries()) {
  const name = p.slice('floot/pages/'.length, -4);
  const route = name === '_index' ? '/' : '/' + name.split('.').map(s => s === '$' ? '*' : s.startsWith('$') ? ':' + s.slice(1) : s.replace(/\[(.)\]/g,'$1')).join('/');
  pageCode += `import P${i} from '../../${p}';\n`;
  const layout = p.slice(0,-4) + '.pageLayout.tsx';
  if (await exists(layout)) pageCode += `import L${i} from '../../${layout}';\n`;
  routes.push(`{path:${JSON.stringify(route)},element:${await exists(layout) ? `L${i}.reduceRight((child,Layout)=><Layout>{child}</Layout>,<P${i}/>)` : `<P${i}/>`}}`);
}
await fs.writeFile('portable/generated/pages.tsx', pageCode + '\nexport const pages=[' + routes.join(',') + '];');
const services = ['ai','email','google-integrations','payments','push','queueTask','realtime','storage'];
const aliases = Object.fromEntries(services.map(n => ['@floot/' + n, path.join(root,'portable/services',n + '.ts')]));
await bundle({ entryPoints: ['portable/server.ts'], outfile:'dist/server.mjs', bundle:true, packages:'external', platform:'node', format:'esm', target:'node22', alias:aliases, banner:{js:'process.env.FLOOT_DATABASE_URL ||= process.env.DATABASE_URL;'}, sourcemap:true, logLevel:'info' });
await viteBuild({ root, configFile:false, resolve: { alias: aliases }, plugins:[{name:'public-config',load(id){if(id.replaceAll('\\','/').endsWith('/helpers/_publicConfigs.tsx'))return 'export const VAPID_PUBLIC_KEY='+JSON.stringify(process.env.VAPID_PUBLIC_KEY||'')+';';}}], build:{outDir:'dist/public',emptyOutDir:true}, logLevel:'warn' });
for(const f of await fs.readdir('floot/static',{withFileTypes:true}))if(f.isFile())await fs.copyFile('floot/static/'+f.name,'dist/public/'+f.name);
await fs.copyFile('portable/push-worker.js','dist/public/floot-push-sw.js');
await fs.cp('portable/assets','dist/public',{recursive:true});
await fs.copyFile('floot/static/__dev/scheduled-jobs.json','dist/schedule.json');
console.log('Build complete. Database migrations and service credentials must be configured before production use.');
