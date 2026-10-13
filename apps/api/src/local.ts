import { serve } from '@hono/node-server';
import { config } from './config';
import { boot, CONTEXTS } from './composition';
import { relayOutbox } from './shared/bus';
import { fileStore, LocalFileStore } from './shared/files';
import { createApp } from './shared/http';
import { scanFreeTime, scanSlaBreaches } from './workers/timers';
import { dispatchAllTenants } from './modules/engagement/dispatcher';

/**
 * Local development server: every context in one process, plus the local stand-ins for
 * S3 presigned URLs, EventBridge Scheduler (intervals) and the SQS workers (in-process bus).
 */
boot();
const app = createApp((a) => {
  Object.values(CONTEXTS).forEach((mount) => mount(a));
  a.get('/health', (c) => c.json({ ok: true }));
  if (fileStore instanceof LocalFileStore) {
    const local = fileStore;
    a.put('/files/upload', async (c) => {
      try {
        await local.put(c.req.query('token') ?? '', c.req.header('content-type'), await c.req.arrayBuffer());
        return c.body(null, 204);
      } catch (e) {
        return c.json({ title: 'Upload rejected', status: 400, detail: (e as Error).message }, 400);
      }
    });
    a.get('/files/download', async (c) => {
      try {
        const f = await local.get(c.req.query('token') ?? '');
        return c.body(f.body, 200, { 'content-disposition': `inline; filename="${encodeURIComponent(f.fileName)}"`, 'cache-control': 'private, max-age=60' });
      } catch {
        return c.json({ title: 'Link expired', status: 403 }, 403);
      }
    });
  }
});

const every = (ms: number, name: string, fn: () => Promise<unknown>) =>
  setInterval(() => fn().catch((e) => console.error(JSON.stringify({ level: 'error', job: name, message: (e as Error).message }))), ms).unref();
every(30_000, 'outbox-relay', relayOutbox);
every(60_000, 'sla-scan', scanSlaBreaches);
every(60 * 60_000, 'free-time-scan', scanFreeTime);
every(30_000, 'dispatch', dispatchAllTenants);
setTimeout(() => void scanFreeTime().catch(() => undefined), 5_000);

serve({ fetch: app.fetch, port: config.API_PORT }, (info) => console.log(`ClearPort API on http://localhost:${info.port}`));
