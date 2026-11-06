// Read-only HTTP probes. This does not sign in, send mail, or alter records.
const argument = process.argv[2];
if (!argument) throw new Error('Usage: node scripts/check-deployment.mjs https://YOUR-HOST');
const url = new URL(argument);
if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
  throw new Error('Supply a plain HTTPS origin without credentials, a path, query or fragment.');
}
let failures = 0;
async function probe(path, expected, verify) {
  try {
    const response = await fetch(new URL(path, url), { signal: AbortSignal.timeout(20000), redirect: 'manual' });
    if (response.status !== expected) throw new Error('HTTP ' + response.status + '; expected ' + expected);
    if (verify) await verify(response);
    console.log('PASS ' + path);
  } catch (error) { failures++; console.error('FAIL ' + path + ': ' + error.message); }
}
await probe('/healthz', 200, async r => { if ((await r.json()).ok !== true) throw new Error('Invalid health response'); });
for (const path of ['/login', '/settings', '/documents']) {
  await probe(path, 200, async r => { if (!(r.headers.get('content-type') || '').includes('text/html')) throw new Error('Expected app HTML'); });
}
for (const path of ['/_api/account', '/_api/email/status']) {
  await probe(path, 401, async r => { if (!(r.headers.get('cache-control') || '').includes('no-store')) throw new Error('Private response must not be cached'); });
}
console.log(failures ? 'Deployment probes failed.' : 'HTTP probes passed. Complete the signed-in Gmail and database checks in the hosting guide.');
process.exitCode = failures ? 1 : 0;
