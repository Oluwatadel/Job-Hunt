import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, transform } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresDialect, CamelCasePlugin } from 'kysely';
import superjson from 'superjson';

test('Gmail permissions and Sent links identify the authorized mailbox', async () => {
  const compiled = await transform(await fs.readFile('floot/helpers/applicationEmail.tsx', 'utf8'), { loader: 'tsx', format: 'esm' });
  const { applicationEmail: email } = await import('data:text/javascript;base64,' + Buffer.from(compiled.code).toString('base64'));
  assert.equal(email.canSend(['https://www.googleapis.com/auth/gmail.send']), true);
  assert.equal(email.canSend(['https://www.googleapis.com/auth/gmail.readonly']), false);
  assert.equal(email.canSend(['not-a-gmail-permission']), false);
  assert.equal(email.canSend(null), false);
  assert.equal(email.sameSender('Owner@Example.com', 'owner@example.com'), true);
  assert.equal(email.sameSender('other@example.com', 'owner@example.com'), false);
  const link = new URL(email.sentUrl('owner+jobs@example.com', 'receipt123'));
  assert.equal(link.origin, 'https://mail.google.com');
  assert.equal(link.searchParams.get('authuser'), 'owner+jobs@example.com');
  assert.equal(link.hash, '#sent/receipt123');
});

test('application sends require approval, correct sender and Gmail receipt; histories are private', async () => {
  const pg = new PGlite();
  const client = { query: async (q, values) => { const text = typeof q === 'string' ? q : q.text; const r = await pg.query(text, values || q.values || []); return { rows: r.rows, rowCount: r.affectedRows || r.rows.length, command: text.split(' ')[0] }; }, release() {}, on() {} };
  const db = new Kysely({ dialect: new PostgresDialect({ pool: { connect: async () => client, end: async () => {} } }), plugins: [new CamelCasePlugin()] });
  const originalFetch = globalThis.fetch;
  globalThis.__emailDb = db;
  globalThis.__emailUserId = 1;
  globalThis.__emailPaid = true;
  globalThis.__emailScopes = ['https://www.googleapis.com/auth/gmail.send'];
  globalThis.__emailSaveFailure = false;
  const requests = [];
  let response = () => Response.json({ id: 'receipt123', labelIds: ['SENT'] });
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return response(); };
  try {
    await pg.exec(await fs.readFile('migrations/001-baseline.sql', 'utf8'));
    await pg.exec("INSERT INTO users(email,display_name) VALUES ('owner@example.com','Owner'),('other@example.com','Other'); INSERT INTO google_connections(user_id,email,scopes) VALUES(1,'sender@example.com','[\"https://www.googleapis.com/auth/gmail.send\"]');");
    const jobs = [];
    for (let n = 0; n < 7; n++) jobs.push(await db.insertInto('applications').values({ userId: n === 6 ? 2 : 1, docId: 'job-' + n, company: 'Employer ' + n, role: 'Developer', status: 'needs_input' }).returningAll().executeTakeFirstOrThrow());
    const result = await build({ stdin: { contents: "export {handle as send} from './floot/endpoints/applications/send_POST.ts';export {handle as status} from './floot/endpoints/email/status_GET.ts';export {handle as disconnect} from './floot/endpoints/drive/disconnect_POST.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external', plugins: [{ name: 'isolated-email', setup(b) {
      b.onResolve({ filter: /^@floot\/google-integrations$/ }, () => ({ path: 'integration', namespace: 'fixture' }));
      b.onResolve({ filter: /helpers\/(db|serverAccess|googleAccess|saveApplication)$/ }, args => ({ path: args.path.split('/').at(-1), namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'ts', resolveDir: process.cwd(), contents: {
        db: 'export const db=globalThis.__emailDb;',
        integration: 'export async function disconnectGoogle(){return {disconnected:true}};',
        serverAccess: `import superjson from 'superjson';export const serverAccess={async current(){return {id:globalThis.__emailUserId}},async paid(){return globalThis.__emailPaid},fail(message,status=400){throw Object.assign(new Error(message),{status})},json(value,status=200){return new Response(superjson.stringify(value),{status})},error(e){return this.json({error:e.message},e.status||400)}};`,
        googleAccess: `export const googleAccess={async connection(userId){return globalThis.__emailDb.selectFrom('googleConnections').selectAll().where('userId','=',userId).executeTakeFirstOrThrow()},async token(){return {email:'sender@example.com',access_token:'mock-token',scopes:globalThis.__emailScopes}},async file(userId,kind){return {document:{kind,googleEmail:'sender@example.com'},bytes:Buffer.from('%PDF-fake-test-document')}}};`,
        saveApplication: `export async function saveApplication(user,job){if(globalThis.__emailSaveFailure)throw new Error('save failed');await globalThis.__emailDb.updateTable('applications').set({status:job.status,confirmation:job.confirmation,dateApplied:job.dateApplied}).where('id','=',job.id).where('userId','=',user.id).execute();}`
      }[args.path] }));
    } }] });
    const file = path.resolve('tests/.generated/email-backend.mjs'); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, result.outputFiles[0].text);
    const api = await import(pathToFileURL(file).href);
    const send = (job, extra = {}) => api.send(new Request('https://app.example/_api/applications/send', { method: 'POST', body: superjson.stringify({ id: String(job.id), senderEmail: 'sender@example.com', to: 'hiring@example.com', subject: 'Application — Developer', body: 'Please consider my application for this position.', documents: ['resume'], approved: true, ...extra }) }));
    const data = async r => superjson.parse(await r.text());
    assert.equal((await send(jobs[0], { approved: false })).status, 400);
    assert.equal((await send(jobs[0], { senderEmail: 'old@example.com' })).status, 409);
    globalThis.__emailScopes = ['https://www.googleapis.com/auth/gmail.readonly'];
    assert.equal((await send(jobs[0])).status, 409);
    globalThis.__emailScopes = ['https://www.googleapis.com/auth/gmail.send'];
    globalThis.__emailPaid = false; assert.equal((await send(jobs[0])).status, 402); globalThis.__emailPaid = true;
    assert.equal((await send(jobs[6])).status, 404);
    assert.equal(requests.length, 0);
    const sent = await data(await send(jobs[0]));
    assert.equal(sent.sent, true); assert.equal(sent.senderEmail, 'sender@example.com'); assert.match(sent.sentUrl, /#sent\/receipt123$/);
    assert.equal(requests.length, 1); assert.equal(requests[0].url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    const mime = Buffer.from(JSON.parse(requests[0].options.body).raw, 'base64url').toString();
    assert.match(mime, /^From: sender@example.com\r\nTo: hiring@example.com\r\n/); assert.match(mime, /filename="resume.pdf"/);
    assert.ok(mime.includes(Buffer.from('%PDF-fake-test-document').toString('base64')));
    assert.equal((await db.selectFrom('applications').select('status').where('id', '=', jobs[0].id).executeTakeFirstOrThrow()).status, 'applied');
    assert.equal((await send(jobs[0])).status, 400); assert.equal(requests.length, 1);
    response = () => Response.json({ error: 'denied' }, { status: 403 });
    assert.equal((await send(jobs[1])).status, 409);
    assert.equal((await send(jobs[1])).status, 409); assert.equal(requests.length, 2);
    assert.equal((await db.selectFrom('applications').select('status').where('id', '=', jobs[1].id).executeTakeFirstOrThrow()).status, 'needs_input');
    response = () => Response.json({}); assert.equal((await send(jobs[2])).status, 409);
    response = () => { throw new Error('network timeout'); }; assert.equal((await send(jobs[3])).status, 409);
    response = () => Response.json({ id: 'receiptSaved' }); globalThis.__emailSaveFailure = true;
    const saved = await data(await send(jobs[4])); assert.equal(saved.sent, true); assert.match(saved.warning, /Do not resend/);
    assert.equal((await db.selectFrom('emailSubmissions').select('messageId').where('applicationId', '=', jobs[4].id).executeTakeFirstOrThrow()).messageId, 'receiptSaved');
    assert.equal((await send(jobs[4])).status, 409);
    assert.equal((await send(jobs[5])).status, 429);
    globalThis.__emailUserId = 2;
    const other = await data(await api.status(new Request('https://app.example/_api/email/status')));
    assert.equal(other.connection, null); assert.deepEqual(other.submissions, []);
    globalThis.__emailUserId = 1;
    const history = await data(await api.status(new Request('https://app.example/_api/email/status?applicationId=' + jobs[1].id)));
    assert.equal(history.submissions.length, 1); assert.equal(history.submissions[0].sentUrl, null);
    assert.equal((await api.disconnect(new Request('https://app.example/_api/drive/disconnect',{method:'POST'}))).status,200);
    const disconnected=await data(await api.status(new Request('https://app.example/_api/email/status')));
    assert.equal(disconnected.connection,null);
    assert.ok(disconnected.submissions.every(row=>row.messageId===null&&row.sentUrl===null));
    assert.ok(disconnected.submissions.some(row=>row.status==='sent'));
  } finally { globalThis.fetch = originalFetch; await db.destroy(); await pg.close(); for (const name of ['__emailDb', '__emailUserId', '__emailPaid', '__emailScopes', '__emailSaveFailure']) delete globalThis[name]; }
});
