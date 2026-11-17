import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';
import { FUNCTIONS } from './functions';

/**
 * Hosted demo (Vercel): the whole API as one serverless function, the same app as the local dev server.
 * Every function is mounted at /api/<name>; Vercel routes /api/* here (see scripts/build-vercel.mjs).
 */
const app = new Hono();
app.get('/api/health', (c) => c.json({ ok: true }));
for (const [name, fn] of Object.entries(FUNCTIONS)) app.route(`/api/${name}`, fn);
app.notFound((c) => c.json({ title: 'Not found', status: 404 }, 404));

export default getRequestListener(app.fetch);
