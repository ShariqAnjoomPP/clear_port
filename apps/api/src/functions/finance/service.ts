import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { DisbursementInput } from '@clearport/contracts';
import { addAmounts, formatMoney, fromMinor, multiplyAmount, percentOf, toMinor, uuidv7 } from '@clearport/kernel';
import { stageDef } from '@clearport/workflow';
import type { Q, Tx } from '../../lib/db';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { customer, disbursement, document, invoice, invoiceLine, job, proFloat, staff } from '../../lib/schema';
import { notifyCustomer } from '../engagement/service';
import { getContainers, nextNumber, requireJob } from '../jobs/queries';
import { getCompany, listMaster } from '../settings/service';
import { getWorkflow } from '../workflow/service';

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400_000).toISOString().slice(0, 10);

// ── payments made on the customer's behalf ──

/** Records money paid for a job, optionally at a workflow stage (duty with Bayan, line charges with DO…). */
export async function recordDisbursements(
  tx: Tx, actorName: string,
  ref: { jobId: string; stageInstanceId: string | null; stageKey: string | null },
  inputs: DisbursementInput[],
) {
  if (!inputs.length) return [];
  const rows = [];
  for (const d of inputs) {
    if (d.receiptDocumentId) {
      const [doc] = await tx.select({ jobId: document.jobId }).from(document).where(eq(document.id, d.receiptDocumentId));
      if (doc?.jobId !== ref.jobId) throw unprocessable('Receipt must be a document on this job');
    }
    const [payer] = d.paidById ? await tx.select().from(staff).where(eq(staff.id, d.paidById)) : [];
    if (d.paidById && !payer?.active) throw unprocessable('Paid by must be an active staff member');
    rows.push({
      id: uuidv7(), jobId: ref.jobId, stageInstanceId: ref.stageInstanceId, stageKey: ref.stageKey,
      feeType: d.feeType, description: d.description ?? null, amount: d.amount, currency: d.currency, paymentMethod: d.paymentMethod,
      paidOn: d.paidOn, paidByStaffId: payer?.id ?? null, paidByName: payer?.name ?? actorName, receiptDocumentId: d.receiptDocumentId ?? null,
      billable: d.billable, markupPct: String(d.markupPct ?? 0),
    });
  }
  return tx.insert(disbursement).values(rows).returning();
}

/** Money summary for one job, per currency (job screen, close check). Reversed entries are left out. */
export async function jobFinanceSummary(q: Q, jobId: string) {
  return q
    .select({
      currency: disbursement.currency,
      paid: sql<string>`coalesce(sum(${disbursement.amount}), 0)`,
      billable: sql<string>`coalesce(sum(case when ${disbursement.billable} then ${disbursement.amount} else 0 end), 0)`,
      unreconciled: sql<number>`count(*) filter (where ${disbursement.status} = 'RECORDED')::int`,
      uninvoiced: sql<number>`count(*) filter (where ${disbursement.billable} and ${disbursement.invoiceId} is null)::int`,
    })
    .from(disbursement)
    .where(and(eq(disbursement.jobId, jobId), ne(disbursement.status, 'REVERSED')))
    .groupBy(disbursement.currency);
}

export async function listDisbursements(q: Q, filter: { jobId?: string; status?: string; paidById?: string } = {}) {
  const rows = await q
    .select({ d: disbursement, jobNo: job.jobNo, blNo: job.blNo, customerName: customer.name })
    .from(disbursement)
    .innerJoin(job, eq(job.id, disbursement.jobId))
    .innerJoin(customer, eq(customer.id, job.customerId))
    .where(and(
      filter.jobId ? eq(disbursement.jobId, filter.jobId) : undefined,
      filter.status ? eq(disbursement.status, filter.status) : undefined,
      filter.paidById ? eq(disbursement.paidByStaffId, filter.paidById) : undefined,
    ))
    .orderBy(desc(disbursement.createdAt))
    .limit(500);
  return rows.map((r) => ({ ...r.d, jobNo: r.jobNo, blNo: r.blNo, customerName: r.customerName }));
}

/** Accounts confirms a payment against its receipt. */
export async function reconcile(q: Q, id: string) {
  const [row] = await q
    .update(disbursement)
    .set({ status: 'RECONCILED', reconciledAt: new Date() })
    .where(and(eq(disbursement.id, id), eq(disbursement.status, 'RECORDED')))
    .returning();
  if (!row) throw conflict('Only recorded payments can be reconciled');
  return row;
}

/** Payments are never edited: a correction marks the original reversed and adds a negative entry, so both stay visible. */
export async function reverse(tx: Tx, id: string, reason: string) {
  const [orig] = await tx.select().from(disbursement).where(eq(disbursement.id, id));
  if (!orig) throw notFound('Payment');
  if (orig.status === 'REVERSED') throw conflict('Already reversed');
  if (orig.invoiceId) throw conflict('This payment is on an invoice. Void the invoice first.');
  await tx.update(disbursement).set({ status: 'REVERSED' }).where(eq(disbursement.id, orig.id));
  const [entry] = await tx.insert(disbursement).values({
    ...orig, id: uuidv7(), amount: fromMinor(-toMinor(orig.amount)), status: 'REVERSED', reversesId: orig.id,
    description: `Reversal: ${reason}`, createdAt: new Date(), reconciledAt: null,
  }).returning();
  return entry!;
}

// ── PRO cash floats ──

/** Per PRO and currency: cash issued, cash-float payments made, and what is left to settle. */
export async function floats(q: Q) {
  const r = await q.execute<{ staff_id: string; name: string; currency: string; issued: string; spent: string }>(sql`
    with issued as (select staff_id, currency, sum(amount) amt from pro_float group by 1, 2),
         spent as (select paid_by_staff_id staff_id, currency, sum(amount) amt from disbursement
                   where payment_method = 'CASH_FLOAT' and status <> 'REVERSED' and paid_by_staff_id is not null group by 1, 2)
    select s.id staff_id, s.name, coalesce(i.currency, sp.currency) currency, coalesce(i.amt, 0)::text issued, coalesce(sp.amt, 0)::text spent
    from issued i full join spent sp on sp.staff_id = i.staff_id and sp.currency = i.currency
    join staff s on s.id = coalesce(i.staff_id, sp.staff_id)
    order by s.name`);
  return r.rows.map((x) => ({
    staffId: x.staff_id, name: x.name, currency: x.currency, issued: x.issued, spent: x.spent,
    balance: fromMinor(toMinor(Number(x.issued).toFixed(3)) - toMinor(Number(x.spent).toFixed(3))),
  }));
}

export async function issueFloat(q: Q, input: { staffId: string; amount: string; currency: string; issuedOn: string; note?: string }) {
  const [person] = await q.select().from(staff).where(eq(staff.id, input.staffId));
  if (person?.role !== 'PRO' || !person.active) throw unprocessable('Floats can only be issued to active PROs');
  const [row] = await q.insert(proFloat).values({ id: uuidv7(), ...input, note: input.note ?? null }).returning();
  return row!;
}

// ── invoices ──

/**
 * Draft invoice for a job: the tariff's service fees (once per job, with VAT) plus every billable payment not yet
 * invoiced (with markup, no VAT: it is passed through at cost). Payments in another currency are left for a separate invoice.
 */
export async function generateInvoice(tx: Tx, jobId: string, dueInDays?: number) {
  const j = await requireJob(tx, jobId);
  const [cust] = await tx.select().from(customer).where(eq(customer.id, j.customerId));
  const company = await getCompany(tx);
  const tariff = cust!.tariff ?? { currency: company.baseCurrency, perBl: '0', perContainer: '0', vatPct: Number(company.vatPct), markupPct: 0 };
  const containers = (await getContainers(tx, j.id)).length;
  const existingService = await tx.select({ id: invoice.id }).from(invoice).where(and(eq(invoice.jobId, j.id), ne(invoice.status, 'VOID')));
  const pending = await tx.select().from(disbursement).where(and(eq(disbursement.jobId, j.id), eq(disbursement.billable, true), isNull(disbursement.invoiceId), ne(disbursement.status, 'REVERSED')));
  const sameCurrency = pending.filter((d) => d.currency === tariff.currency);

  type Line = { kind: 'SERVICE' | 'DISBURSEMENT'; description: string; quantity: number; unitPrice: string; amount: string; vatRate: number; disbursementId?: string };
  const lines: Line[] = [];
  if (!existingService.length) {
    if (toMinor(tariff.perBl) > 0n) lines.push({ kind: 'SERVICE', description: `Clearance service fee — BL ${j.blNo}`, quantity: 1, unitPrice: tariff.perBl, amount: tariff.perBl, vatRate: tariff.vatPct });
    if (toMinor(tariff.perContainer) > 0n && containers) lines.push({ kind: 'SERVICE', description: 'Handling fee per container', quantity: containers, unitPrice: tariff.perContainer, amount: multiplyAmount(tariff.perContainer, containers), vatRate: tariff.vatPct });
  }
  // Customer-facing wording: fee names from master data, stage names from the job's workflow.
  const feeNames = new Map((await listMaster(tx, 'FEE_TYPE')).map((f) => [f.code, f.name]));
  const wf = await getWorkflow(tx, j.workflowVersion);
  for (const d of sameCurrency) {
    const markup = Number(d.markupPct) || tariff.markupPct || 0;
    const amount = addAmounts(d.amount, percentOf(d.amount, markup));
    const fee = feeNames.get(d.feeType) ?? d.feeType.replace(/_/g, ' ').toLowerCase();
    const stage = d.stageKey ? stageDef(wf, d.stageKey)?.label.en : undefined;
    lines.push({ kind: 'DISBURSEMENT', description: `${fee}${stage ? ` — ${stage}` : ''}${d.description ? ` (${d.description})` : ''}`, quantity: 1, unitPrice: amount, amount, vatRate: 0, disbursementId: d.id });
  }
  if (!lines.length) throw unprocessable('Nothing to invoice: the service fee is already billed and there are no unbilled payments');

  const subtotal = addAmounts(...lines.map((l) => l.amount));
  const vat = addAmounts('0', ...lines.filter((l) => l.vatRate > 0).map((l) => percentOf(l.amount, l.vatRate)));
  const id = uuidv7();
  const [inv] = await tx.insert(invoice).values({
    id, jobId: j.id, customerId: j.customerId, invoiceNo: await nextNumber(tx, 'invoice', 'INV'),
    issueDate: today(), dueDate: addDays(today(), dueInDays ?? cust!.creditDays), currency: tariff.currency,
    subtotal, vatAmount: vat, total: addAmounts(subtotal, vat),
  }).returning();
  await tx.insert(invoiceLine).values(lines.map((l) => ({ id: uuidv7(), invoiceId: id, ...l, vatRate: String(l.vatRate), disbursementId: l.disbursementId ?? null })));
  if (sameCurrency.length) await tx.update(disbursement).set({ invoiceId: id }).where(inArray(disbursement.id, sameCurrency.map((d) => d.id)));
  return { ...inv!, excludedOtherCurrency: pending.length - sameCurrency.length };
}

export async function listInvoices(q: Q, filter: { status?: string; customerId?: string; jobId?: string } = {}) {
  const rows = await q
    .select({ i: invoice, customerName: customer.name, jobNo: job.jobNo, blNo: job.blNo })
    .from(invoice)
    .innerJoin(customer, eq(customer.id, invoice.customerId))
    .innerJoin(job, eq(job.id, invoice.jobId))
    .where(and(
      filter.status ? eq(invoice.status, filter.status) : undefined,
      filter.customerId ? eq(invoice.customerId, filter.customerId) : undefined,
      filter.jobId ? eq(invoice.jobId, filter.jobId) : undefined,
    ))
    .orderBy(desc(invoice.createdAt))
    .limit(500);
  return rows.map((x) => ({ ...x.i, customerName: x.customerName, jobNo: x.jobNo, blNo: x.blNo }));
}

/** Printable invoice: lines, job, customer, and the issuing agency from company settings. */
export async function invoiceDetail(q: Q, id: string) {
  const [inv] = await q.select().from(invoice).where(eq(invoice.id, id));
  if (!inv) throw notFound('Invoice');
  const [lines, j, [cust], company] = await Promise.all([
    q.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, inv.id)),
    requireJob(q, inv.jobId),
    q.select().from(customer).where(eq(customer.id, inv.customerId)),
    getCompany(q),
  ]);
  return {
    ...inv, lines,
    job: { id: j.id, jobNo: j.jobNo, blNo: j.blNo, vessel: j.vessel },
    customer: cust ? { id: cust.id, name: cust.name, address: cust.address, tradeLicenceNo: cust.tradeLicenceNo } : null,
    issuer: { name: company.name, address: company.address, trn: company.trn },
  };
}

const NEXT: Record<'ISSUED' | 'PAID' | 'VOID', string[]> = { ISSUED: ['DRAFT'], PAID: ['ISSUED'], VOID: ['DRAFT', 'ISSUED'] };

/** Draft → issued → paid; draft or issued → void (which frees its payments to be invoiced again). */
export async function setInvoiceStatus(tx: Tx, id: string, to: 'ISSUED' | 'PAID' | 'VOID') {
  const [inv] = await tx
    .update(invoice)
    .set({ status: to, ...(to === 'PAID' && { paidAt: new Date() }) })
    .where(and(eq(invoice.id, id), inArray(invoice.status, NEXT[to])))
    .returning();
  if (!inv) throw conflict(`Invoice cannot be marked ${to.toLowerCase()} from its current status`);
  if (to === 'VOID') await tx.update(disbursement).set({ invoiceId: null }).where(eq(disbursement.invoiceId, inv.id));
  if (to === 'ISSUED') {
    const j = await requireJob(tx, inv.jobId);
    await notifyCustomer(tx, inv.customerId, inv.jobId, 'INVOICE_ISSUED', { invoiceNo: inv.invoiceNo, blNo: j.blNo, total: formatMoney({ amount: inv.total, currency: inv.currency }) });
  }
  return inv;
}

/** Issued, unpaid invoices by customer, aged by days past due. */
export async function receivables(q: Q) {
  const r = await q.execute<{ customer_id: string; customer_name: string; currency: string; current: string; d30: string; d60: string; d90: string; total: string }>(sql`
    select c.id customer_id, c.name customer_name, i.currency,
      sum(case when current_date <= i.due_date then i.total else 0 end)::text as current,
      sum(case when current_date - i.due_date between 1 and 30 then i.total else 0 end)::text as d30,
      sum(case when current_date - i.due_date between 31 and 60 then i.total else 0 end)::text as d60,
      sum(case when current_date - i.due_date > 60 then i.total else 0 end)::text as d90,
      sum(i.total)::text total
    from invoice i join customer c on c.id = i.customer_id
    where i.status = 'ISSUED' group by 1, 2, 3 order by sum(i.total) desc`);
  return r.rows;
}
