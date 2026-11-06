// Host-specific bootstrap; shared Floot sources do not depend on Render.
const configured = process.env.APP_URL?.trim() || process.env.RENDER_EXTERNAL_URL;
if (!configured) throw new Error('Set APP_URL or deploy this service on Render.');
const url = new URL(configured);
if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
  throw new Error('APP_URL must be a plain HTTPS origin, without a path, query or credentials.');
}
process.env.APP_URL = url.origin;
await import('../dist/server.mjs');
