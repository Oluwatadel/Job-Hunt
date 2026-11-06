import { spawn } from 'node:child_process';
const run = file => new Promise((resolve,reject) => { const p=spawn(process.execPath,[file],{stdio:'inherit'});p.on('exit',code=>code===0?resolve():reject(new Error('Build failed')));});
await run('scripts/build.mjs');
await import('../dist/server.mjs');
