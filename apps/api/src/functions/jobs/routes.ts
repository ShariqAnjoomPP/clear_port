import { z } from 'zod';
import { AddContainersInput, CargoLineInput, CommentInput, CreateJobInput, ReopenInput, UpdateContainerInput, UpdateJobInput } from '@clearport/contracts';
import { db, transaction } from '../../lib/db';
import { createFunction, parseBody, parseQuery } from '../../lib/http';
import { addCargoLine, addComment, addContainers, closeJob, createJob, jobDetail, jobSummaries, removeCargoLine, reopenJob, timeline, updateCargoLine, updateContainer, updateJob } from './service';

const app = createFunction();

app.get('/', async (c) => {
  const f = parseQuery(c, z.object({ q: z.string().optional(), status: z.enum(['OPEN', 'CLOSED']).optional().or(z.literal('').transform(() => undefined)), customerId: z.uuid().optional() }));
  return c.json({ items: await jobSummaries(db, f) });
});

app.post('/', async (c) => {
  const input = await parseBody(c, CreateJobInput);
  return c.json(await transaction((tx) => createJob(tx, input)), 201);
});

app.get('/:id', async (c) => c.json(await jobDetail(db, c.req.param('id'))));
app.patch('/:id', async (c) => c.json(await updateJob(db, c.req.param('id'), await parseBody(c, UpdateJobInput))));

app.post('/:id/containers', async (c) => {
  const { containers } = await parseBody(c, AddContainersInput);
  return c.json({ items: await transaction((tx) => addContainers(tx, c.req.param('id'), containers)) }, 201);
});
app.patch('/:id/containers/:cid', async (c) => c.json(await updateContainer(db, c.req.param('id'), c.req.param('cid'), await parseBody(c, UpdateContainerInput))));

// Goods lines on the B/L; each change refreshes the job's commodity and HS codes.
app.post('/:id/cargo-lines', async (c) => {
  const input = await parseBody(c, CargoLineInput);
  return c.json(await transaction((tx) => addCargoLine(tx, c.req.param('id'), input)), 201);
});
app.patch('/:id/cargo-lines/:lineId', async (c) => {
  const input = await parseBody(c, CargoLineInput.partial());
  return c.json(await transaction((tx) => updateCargoLine(tx, c.req.param('id'), c.req.param('lineId'), input)));
});
app.delete('/:id/cargo-lines/:lineId', async (c) => c.json(await transaction((tx) => removeCargoLine(tx, c.req.param('id'), c.req.param('lineId')))));

app.post('/:id/comments', async (c) => c.json(await addComment(db, c.req.param('id'), c.get('user').name, await parseBody(c, CommentInput)), 201));
app.get('/:id/timeline', async (c) => c.json({ items: await timeline(db, c.req.param('id')) }));

app.post('/:id/close', async (c) => c.json(await transaction((tx) => closeJob(tx, c.req.param('id')))));
app.post('/:id/reopen', async (c) => {
  const { reason } = await parseBody(c, ReopenInput);
  return c.json(await transaction((tx) => reopenJob(tx, c.req.param('id'), c.get('user').name, reason)));
});

export default app;
