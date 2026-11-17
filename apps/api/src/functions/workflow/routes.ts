import { z } from 'zod';
import { AssignInput, SlaInput, TransitionInput } from '@clearport/contracts';
import { db, transaction } from '../../lib/db';
import { createFunction, parseBody, parseQuery } from '../../lib/http';
import { requireJob } from '../jobs/queries';
import { getActiveWorkflow, listVersions, publishSla } from './service';
import { assignStage, listTasks, stageView, transitionStage } from './stages';

const app = createFunction();

// ── Definition (Settings → Workflow & SLAs) ──
app.get('/definition', async (c) => c.json({ active: await getActiveWorkflow(db), versions: await listVersions(db) }));

app.put('/definition/sla', async (c) => {
  const { sla } = await parseBody(c, SlaInput);
  return c.json(await transaction((tx) => publishSla(tx, sla)));
});

// ── Stages of one job ──
app.get('/jobs/:jobId/stages', async (c) => c.json(await stageView(db, await requireJob(db, c.req.param('jobId')))));

app.post('/jobs/:jobId/stages/:stageId/transitions', async (c) => {
  const input = await parseBody(c, TransitionInput);
  const jobId = c.req.param('jobId');
  await transaction((tx) => transitionStage(tx, c.get('user').name, { jobId, stageInstanceId: c.req.param('stageId'), input }));
  return c.json(await stageView(db, await requireJob(db, jobId)));
});

app.put('/jobs/:jobId/stages/:stageId/assignee', async (c) => {
  const { assigneeId } = await parseBody(c, AssignInput);
  const jobId = c.req.param('jobId');
  await transaction((tx) => assignStage(tx, jobId, c.req.param('stageId'), assigneeId));
  return c.json(await stageView(db, await requireJob(db, jobId)));
});

// ── Task list across jobs ──
app.get('/tasks', async (c) => {
  const { staffId } = parseQuery(c, z.object({ staffId: z.union([z.uuid(), z.literal('unassigned')]).optional() }));
  return c.json({ items: await listTasks(db, { staffId }) });
});

export default app;
