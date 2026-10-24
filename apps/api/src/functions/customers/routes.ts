import { CustomerInput } from '@clearport/contracts';
import { db } from '../../lib/db';
import { notFound } from '../../lib/errors';
import { createFunction, parseBody } from '../../lib/http';
import { portalUrl, regeneratePortalLink } from '../engagement/service';
import { createCustomer, creditCheck, customerStats, findSimilarCustomers, getCustomer, listCustomers, updateCustomer } from './service';

const app = createFunction();

app.get('/', async (c) => c.json({ items: await listCustomers(db, c.req.query('q')) }));
/** Possible duplicates while typing a new customer in Create job. */
app.get('/similar', async (c) => c.json({ items: await findSimilarCustomers(db, { name: c.req.query('name'), phone: c.req.query('phone') }) }));
app.post('/', async (c) => c.json(await createCustomer(db, await parseBody(c, CustomerInput)), 201));

app.get('/:id', async (c) => {
  const cust = await getCustomer(db, c.req.param('id'));
  if (!cust) throw notFound('Customer');
  const { portalToken, ...rest } = cust;
  return c.json({ ...rest, portalUrl: portalToken ? portalUrl(portalToken) : null, stats: await customerStats(db, cust.id) });
});
app.put('/:id', async (c) => c.json(await updateCustomer(db, c.req.param('id'), await parseBody(c, CustomerInput))));
/** A new portal link for the customer; the old one stops working. */
app.post('/:id/portal-link', async (c) => c.json({ url: await regeneratePortalLink(db, c.req.param('id')) }));
app.get('/:id/credit-check', async (c) => c.json(await creditCheck(db, c.req.param('id'))));

export default app;
