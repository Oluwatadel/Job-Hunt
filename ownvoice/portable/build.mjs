import {build} from 'esbuild';
import {build as buildClient} from 'vite';
import path from 'node:path';
await build({entryPoints:['floot/endpoints/rewrite_POST.ts'],outfile:'dist/rewrite.mjs',bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@floot/ai':path.resolve('portable/ai.ts')}});
await buildClient({build:{outDir:'dist/public',emptyOutDir:true}});
