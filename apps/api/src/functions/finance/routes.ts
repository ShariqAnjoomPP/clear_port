import { z } from 'zod';
import { DisbursementInput, FloatInput, GenerateInvoiceInput, ReverseInput } from '@clearport/contracts';
import { db, transaction } from '../../lib/db';
import { conflict } from '../../lib/errors';
import { createFunction, parseBody, parseQuery } from '../../lib/http';
import { requireJob } from '../jobs/queries';
import {
  floats, generateInvoice, invoiceDetail, issueFloat, listDisbursements, listInvoices, receivables, reconcile, recordDisbursements, reverse, setInvoiceStatus,
} from './service';

const app = createFunction();

// ── Payments ledger ──
app.get('/disbursements', async (c) => {
  const f = parseQuery(c, z.object({ jobId: z.uuid().optional(), status: z.enum(['RECORDED', 'RECONCILED', 'REVERSED']).optional().or(z.literal('').transform(() => undefined)), paidById: z.uuid().optional() }));
  return c.json({ items: await listDisbursements(db, f) });
});

/** A payment recorded outside a stage update (port storage, terminal handling…). */
app.post('/disbursements', async (c) => {
  const { jobId, ...d } = await parseBody(c, DisbursementInput.extend({ jobId: z.uuid() }));
  const [row] = await transaction(async (tx) => {
    const j = await requireJob(tx, jobId);
    if (j.status === 'CLOSED') throw conflict('This job is closed');
    return recordDisbursements(tx, c.get('user').name, { jobId, stageInstanceId: null, stageKey: null }, [d]);
  });
  return c.json(row, 201);
});

app.post('/disbursements/:id/reconcile', async (c) => c.json(await reconcile(db, c.req.param('id'))));
app.post('/disbursements/:id/reverse', async (c) => {
  const { reason } = await parseBody(c, ReverseInput);
  return c.json(await transaction((tx) => reverse(tx, c.req.param('id'), reason)), 201);
});

// ── PRO floats ──
app.get('/floats', async (c) => c.json({ items: await floats(db) }));
app.post('/floats', async (c) => c.json(await issueFloat(db, await parseBody(c, FloatInput)), 201));

// ── Invoices ──
app.post('/invoices', async (c) => {
  const { jobId, dueInDays } = await parseBody(c, GenerateInvoiceInput);
  return c.json(await transaction((tx) => generateInvoice(tx, jobId, dueInDays)), 201);
});
app.get('/invoices', async (c) => c.json({ items: await listInvoices(db, { status: c.req.query('status'), customerId: c.req.query('customerId'), jobId: c.req.query('jobId') }) }));
app.get('/invoices/:id', async (c) => c.json(await invoiceDetail(db, c.req.param('id'))));
app.post('/invoices/:id/issue', async (c) => c.json(await transaction((tx) => setInvoiceStatus(tx, c.req.param('id'), 'ISSUED'))));
app.post('/invoices/:id/mark-paid', async (c) => c.json(await transaction((tx) => setInvoiceStatus(tx, c.req.param('id'), 'PAID'))));
app.post('/invoices/:id/void', async (c) => c.json(await transaction((tx) => setInvoiceStatus(tx, c.req.param('id'), 'VOID'))));

// ── Money owed by customers ──
app.get('/receivables', async (c) => c.json({ items: await receivables(db) }));

export default app;
