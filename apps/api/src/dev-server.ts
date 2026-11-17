import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { config } from './lib/config';
import { FUNCTIONS } from './functions';

/**
 * Local development server: mounts every function at /api/<name> in one process,
 * exactly the paths API Gateway routes to each Lambda in production.
 */
const app = new Hono();
app.use('*', logger());
app.get('/api/health', (c) => c.json({ ok: true }));
for (const [name, fn] of Object.entries(FUNCTIONS)) app.route(`/api/${name}`, fn);
app.notFound((c) => c.json({ title: 'Not found', status: 404 }, 404));

serve({ fetch: app.fetch, port: config.API_PORT }, (info) => {
  console.log(`ClearPort Lite API on http://localhost:${info.port}`);
  console.log(`Functions: ${Object.keys(FUNCTIONS).map((n) => `/api/${n}`).join('  ')}`);
});
