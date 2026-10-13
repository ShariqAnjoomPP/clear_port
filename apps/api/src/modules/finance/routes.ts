import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../shared/context';
import { DisbursementInput, FloatInput, GenerateInvoiceInput } from '@clearport/contracts';
import { fromMinor, toMinor, uuidv7 } from '@clearport/kernel';
import { audit } from '../../shared/audit';
import { withTenant } from '../../shared/db';
import { makeEvent } from '../../shared/events';
import { parseBody, protectedRouter } from '../../shared/http';
import { requirePermission } from '../../shared/policy';
import { conflict, notFound, unprocessable } from '../../shared/problem';
import { appUser, customer, disbursement, invoice, invoiceCounter, invoiceLine, job, proFloat } from '../../shared/schema';
import { requireJob } from '../clearance/public';
import { getCustomer } from '../customer/public';
import { getTenant } from '../platform/public';
import { generateInvoice, recordDisbursements } from './public';

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400_000).toISOString().slice(0, 10);

export function financeRoutes() {
  const r = protectedRouter();

  // ── Disbursement ledger (FIN-001) ──
  r.get('/disbursements', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'invoice.read');
    const { jobId, status, paidBy } = c.req.query();
    const items = await withTenant(actor, (tx) =>
      tx.select({ d: disbursement, jobNo: job.jobNo, blNo: job.blNo, customerName: customer.name })
        .from(disbursement).innerJoin(job, eq(job.id, disbursement.jobId)).innerJoin(customer, eq(customer.id, job.customerId))
        .where(and(jobId ? eq(disbursement.jobId, jobId) : undefined, status ? eq(disbursement.status, status) : undefined, paidBy ? eq(disbursement.paidBy, paidBy) : undefined))
        .orderBy(desc(disbursement.createdAt)).limit(500),
    );
    return c.json({ items: items.map((i) => ({ ...i.d, jobNo: i.jobNo, blNo: i.blNo, customerName: i.customerName })) });
  });

  r.post('/disbursements', async (c) => {
    const actor = c.get('actor');
    const input = await parseBody(c, DisbursementInput.extend({ jobId: z.uuid() }));
    const rows = await withTenant(actor, async (tx, uow) => {
      const j = await requireJob(tx, input.jobId);
      if (j.status === 'CLOSED') throw conflict('This job is closed');
      const { jobId, ...d } = input;
      const res = await recordDisbursements(tx, uow, actor, { jobId, stageInstanceId: null, stageKey: null }, [d]);
      await audit(tx, actor, c.get('meta'), { action: 'disbursement.recorded', entityType: 'disbursement', entityId: res[0]?.id, after: d });
      return res;
    });
    return c.json(rows[0], 201);
  });

  r.post('/disbursements/:id/reconcile', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'disbursement.reconcile');
    const row = await withTenant(actor, async (tx, uow) => {
      const [d] = await tx.update(disbursement).set({ status: 'RECONCILED', reconciledBy: actor.userId, reconciledAt: new Date() })
        .where(and(eq(disbursement.id, c.req.param('id')), eq(disbursement.status, 'RECORDED'))).returning();
      if (!d) throw conflict('Only recorded payments can be reconciled');
      uow.emit(makeEvent(actor.tenantId, 'DisbursementReconciled', 'job', d.jobId, { jobId: d.jobId, disbursementId: d.id }));
      await audit(tx, actor, c.get('meta'), { action: 'disbursement.reconciled', entityType: 'disbursement', entityId: d.id });
      return d;
    });
    return c.json(row);
  });

  /** Reconciled or invoiced amounts are never edited: a correction is a reversal entry (STRIDE: tampering). */
  r.post('/disbursements/:id/reverse', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'disbursement.reconcile');
    const { reason } = await parseBody(c, z.object({ reason: z.string().trim().min(3).max(300) }));
    const row = await withTenant(actor, async (tx) => {
      const [orig] = await tx.select().from(disbursement).where(eq(disbursement.id, c.req.param('id')));
      if (!orig) throw notFound('Payment');
      if (orig.status === 'REVERSED') throw conflict('Already reversed');
      if (orig.invoiceId) throw conflict('This payment is on an invoice. Void the invoice first.');
      await tx.update(disbursement).set({ status: 'REVERSED' }).where(eq(disbursement.id, orig.id));
      const [rev] = await tx.insert(disbursement).values({
        ...orig, id: uuidv7(), amount: fromMinor(-toMinor(orig.amount)), status: 'REVERSED', reversesId: orig.id,
        description: `Reversal: ${reason}`, createdBy: actor.userId, createdAt: new Date(), reconciledAt: null, reconciledBy: null,
      }).returning();
      await audit(tx, actor, c.get('meta'), { action: 'disbursement.reversed', entityType: 'disbursement', entityId: orig.id, before: orig, after: { reason } });
      return rev;
    });
    return c.json(row, 201);
  });

  // ── PRO floats (FIN-002) ──
  r.get('/floats', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'invoice.read');
    const items = await withTenant(actor, async (tx) => {
      const rows = await tx.execute<{ user_id: string; name: string; currency: string; issued: string; spent: string }>(sql`
        with issued as (select user_id, currency, sum(amount) amt from finance.pro_float group by 1, 2),
             spent as (select paid_by user_id, currency, sum(amount) amt from finance.disbursement
                       where payment_method = 'CASH_FLOAT' and status <> 'REVERSED' and paid_by is not null group by 1, 2)
        select u.id user_id, u.name, coalesce(i.currency, s.currency) currency, coalesce(i.amt, 0)::text issued, coalesce(s.amt, 0)::text spent
        from issued i full join spent s on s.user_id = i.user_id and s.currency = i.currency
        join platform.app_user u on u.id = coalesce(i.user_id, s.user_id)
        order by u.name`);
      return rows.rows.map((r) => ({ userId: r.user_id, name: r.name, currency: r.currency, issued: r.issued, spent: r.spent, balance: fromMinor(toMinor(Number(r.issued).toFixed(3)) - toMinor(Number(r.spent).toFixed(3))) }));
    });
    return c.json({ items });
  });

  r.post('/floats', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'float.manage');
    const input = await parseBody(c, FloatInput);
    const row = await withTenant(actor, async (tx) => {
      const [u] = await tx.select().from(appUser).where(eq(appUser.id, input.userId));
      if (!u?.roles.includes('PRO')) throw unprocessable('Floats can only be issued to PROs');
      const [f] = await tx.insert(proFloat).values({ id: uuidv7(), tenantId: actor.tenantId, ...input, note: input.note ?? null, createdBy: actor.userId }).returning();
      await audit(tx, actor, c.get('meta'), { action: 'float.issued', entityType: 'pro_float', entityId: f!.id, after: input });
      return f;
    });
    return c.json(row, 201);
  });

  // ── Invoices (FIN-003) ──
  r.post('/invoices', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'invoice.manage');
    const input = await parseBody(c, GenerateInvoiceInput);
    const result = await withTenant(actor, (tx) => generateInvoice(tx, actor, c.get('meta'), input.jobId, input.dueInDays));
    return c.json(result, 201);
  });

  r.get('/invoices', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'invoice.read');
    const { status, customerId, jobId } = c.req.query();
    const items = await withTenant(actor, (tx) =>
      tx.select({ i: invoice, customerName: customer.name, jobNo: job.jobNo, blNo: job.blNo }).from(invoice)
        .innerJoin(customer, eq(customer.id, invoice.customerId)).innerJoin(job, eq(job.id, invoice.jobId))
        .where(and(status ? eq(invoice.status, status) : undefined, customerId ? eq(invoice.customerId, customerId) : undefined, jobId ? eq(invoice.jobId, jobId) : undefined))
        .orderBy(desc(invoice.createdAt)).limit(500),
    );
    return c.json({ items: items.map((x) => ({ ...x.i, customerName: x.customerName, jobNo: x.jobNo, blNo: x.blNo })) });
  });

  r.get('/invoices/:id', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'invoice.read');
    const res = await withTenant(actor, async (tx) => {
      const [inv] = await tx.select().from(invoice).where(eq(invoice.id, c.req.param('id')));
      if (!inv) throw notFound('Invoice');
      const lines = await tx.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, inv.id));
      const j = await requireJob(tx, inv.jobId);
      const cust = await getCustomer(tx, inv.customerId);
      const t = await getTenant(tx, actor.tenantId);
      return { ...inv, lines, job: { id: j.id, jobNo: j.jobNo, blNo: j.blNo, vessel: j.vessel }, customer: cust && { id: cust.id, name: cust.name, address: cust.address, tradeLicenceNo: cust.tradeLicenceNo }, issuer: t && { name: t.name } };
    });
    return c.json(res);
  });

  const setStatus = (from: string[], to: 'ISSUED' | 'PAID' | 'VOID') => async (c: Context<AppEnv>) => {
    const actor = c.get('actor');
    requirePermission(actor, 'invoice.manage');
    const res = await withTenant(actor, async (tx, uow) => {
      const [inv] = await tx.update(invoice).set({ status: to, paidAt: to === 'PAID' ? new Date() : undefined })
        .where(and(eq(invoice.id, c.req.param('id')!), inArray(invoice.status, from))).returning();
      if (!inv) throw conflict(`Invoice cannot be marked ${to.toLowerCase()} from its current status`);
      if (to === 'VOID') await tx.update(disbursement).set({ invoiceId: null }).where(eq(disbursement.invoiceId, inv.id));
      if (to === 'ISSUED') uow.emit(makeEvent(actor.tenantId, 'InvoiceIssued', 'invoice', inv.id, { invoiceId: inv.id, jobId: inv.jobId, customerId: inv.customerId, invoiceNo: inv.invoiceNo, total: inv.total, currency: inv.currency }));
      await audit(tx, actor, c.get('meta'), { action: `invoice.${to.toLowerCase()}`, entityType: 'invoice', entityId: inv.id });
      return inv;
    });
    return c.json(res);
  };
  r.post('/invoices/:id/issue', setStatus(['DRAFT'], 'ISSUED'));
  r.post('/invoices/:id/mark-paid', setStatus(['ISSUED'], 'PAID'));
  r.post('/invoices/:id/void', setStatus(['DRAFT', 'ISSUED'], 'VOID'));

  // ── Receivables ageing (FIN-004) ──
  r.get('/receivables', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'invoice.read');
    const rows = await withTenant(actor, (tx) =>
      tx.execute<{ customer_id: string; customer_name: string; currency: string; current: string; d30: string; d60: string; d90: string; total: string }>(sql`
        select c.id customer_id, c.name customer_name, i.currency,
          sum(case when current_date <= i.due_date then i.total else 0 end)::text as current,
          sum(case when current_date - i.due_date between 1 and 30 then i.total else 0 end)::text as d30,
          sum(case when current_date - i.due_date between 31 and 60 then i.total else 0 end)::text as d60,
          sum(case when current_date - i.due_date > 60 then i.total else 0 end)::text as d90,
          sum(i.total)::text total
        from finance.invoice i join customer.customer c on c.id = i.customer_id
        where i.status = 'ISSUED' group by 1, 2, 3 order by sum(i.total) desc`),
    );
    return c.json({ items: rows.rows });
  });

  return r;
}
