import { z } from 'zod';
import { CompanyInput, MasterItemInput, StaffInput, STAFF_ROLES } from '@clearport/contracts';
import { db } from '../../lib/db';
import { createFunction, parseBody, parseQuery } from '../../lib/http';
import { archiveMaster, createMaster, createStaff, getCompany, listMaster, listStaff, updateCompany, updateStaff } from './service';

const app = createFunction();

app.get('/company', async (c) => c.json(await getCompany(db)));
app.put('/company', async (c) => c.json(await updateCompany(db, await parseBody(c, CompanyInput))));

app.get('/staff', async (c) => {
  const q = parseQuery(c, z.object({ role: z.enum(STAFF_ROLES).optional(), all: z.literal('1').optional() }));
  return c.json({ items: await listStaff(db, { role: q.role, includeInactive: !!q.all }) });
});
app.post('/staff', async (c) => c.json(await createStaff(db, await parseBody(c, StaffInput)), 201));
app.patch('/staff/:id', async (c) => {
  const input = await parseBody(c, StaffInput.partial().extend({ active: z.boolean().optional() }));
  return c.json(await updateStaff(db, c.req.param('id'), input));
});

app.get('/master-data', async (c) => c.json({ items: await listMaster(db, c.req.query('kind')) }));
app.post('/master-data', async (c) => c.json(await createMaster(db, await parseBody(c, MasterItemInput)), 201));
app.delete('/master-data/:id', async (c) => {
  await archiveMaster(db, c.req.param('id'));
  return c.json({ ok: true });
});

export default app;
