import { db } from '../../lib/db';
import { createFunction } from '../../lib/http';
import { alerts, inbox, outbound, pendingApprovals, readAll } from './service';

const app = createFunction();

// In-app inbox (the bell in the header).
app.get('/notifications', async (c) => c.json(await inbox(db)));
app.post('/notifications/read-all', async (c) => {
  await readAll(db);
  return c.json({ ok: true });
});

// WhatsApp / email / SMS messages as they would have been sent (logged only in the prototype).
app.get('/outbound', async (c) => c.json({ items: await outbound(db, c.req.query('jobId')) }));

// Overdue stages and container free time running out, worked out on request.
app.get('/alerts', async (c) => c.json(await alerts(db)));

// Charges waiting for the customer's answer.
app.get('/approvals', async (c) => c.json({ items: await pendingApprovals(db) }));

export default app;
