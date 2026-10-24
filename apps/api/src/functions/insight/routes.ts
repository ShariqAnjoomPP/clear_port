import { z } from 'zod';
import { db } from '../../lib/db';
import { createFunction, parseQuery } from '../../lib/http';
import { board, containers, cycleTime, dashboard, disbursementsByCustomer, freeTimeExposure, home, profitability, team } from './service';

/** Read-only views across jobs: the board, the container tracker, the dashboard and reports. */
const app = createFunction();

app.get('/home', async (c) => c.json(await home(db)));
app.get('/board', async (c) => {
  const f = parseQuery(c, z.object({ coordinatorId: z.uuid().optional(), priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(), customerId: z.uuid().optional() }));
  return c.json({ items: await board(db, f) });
});
app.get('/containers', async (c) => c.json({ items: await containers(db) }));
app.get('/dashboard', async (c) => c.json(await dashboard(db)));

app.get('/reports/cycle-time', async (c) => {
  const { days } = parseQuery(c, z.object({ days: z.coerce.number().int().min(1).max(365).default(90) }));
  return c.json({ items: await cycleTime(db, days), days });
});
app.get('/reports/free-time', async (c) => c.json({ items: await freeTimeExposure(db) }));
app.get('/reports/disbursements', async (c) => c.json({ items: await disbursementsByCustomer(db) }));
app.get('/reports/profitability', async (c) => c.json({ items: await profitability(db) }));
app.get('/reports/team', async (c) => c.json({ items: await team(db) }));

export default app;
