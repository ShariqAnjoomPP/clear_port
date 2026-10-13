import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { DisbursementInput } from '@clearport/contracts';
import { addAmounts, multiplyAmount, percentOf, toMinor, uuidv7 } from '@clearport/kernel';
import { audit } from '../../shared/audit';
import type { RequestMeta } from '../../shared/context';
import { getContainers, requireJob } from '../clearance/public';
import { getCustomer } from '../customer/public';
import type { Actor } from '../../shared/context';
import type { Tx, UnitOfWork } from '../../shared/db';
import { makeEvent } from '../../shared/events';
import { requirePermission } from '../../shared/policy';
import { unprocessable } from '../../shared/problem';
import { disbursement, document, invoice, invoiceCounter, invoiceLine } from '../../shared/schema';
import { getTenant, getUser } from '../platform/public';

/** Finance context — public facade. Records money paid at any stage (BAY-003, DO-003, CCR-002, FIN-001). */
export async function recordDisbursements(
  tx: Tx, uow: UnitOfWork, actor: Actor,
  ref: { jobId: string; stageInstanceId: string | null; stageKey: string | null },
  inputs: DisbursementInput[],
) {
  if (actor.kind !== 'system') requirePermission(actor, 'disbursement.create');
  const rows = [];
  for (const d of inputs) {
    if (d.receiptDocumentId) {
      const [doc] = await tx.select({ jobId: document.jobId }).from(document).where(eq(document.id, d.receiptDocumentId));
      if (doc?.jobId !== ref.jobId) throw unprocessable('Receipt must be a document on this job');
    }
    const payerId = d.paidById ?? actor.userId;
    const payer = payerId ? await getUser(tx, payerId) : undefined;
    rows.push({
      id: uuidv7(), tenantId: actor.tenantId, jobId: ref.jobId, stageInstanceId: ref.stageInstanceId, stageKey: ref.stageKey,
      feeType: d.feeType, description: d.description ?? null, amount: d.amount, currency: d.currency, paymentMethod: d.paymentMethod,
      paidOn: d.paidOn, paidBy: payer?.id ?? null, paidByName: payer?.name ?? actor.name, receiptDocumentId: d.receiptDocumentId ?? null,
      billable: d.billable, markupPct: String(d.markupPct ?? 0), status: 'RECORDED', createdBy: actor.userId,
    });
  }
  if (!rows.length) return [];
  const inserted = await tx.insert(disbursement).values(rows).returning();
  for (const r of inserted) {
    uow.emit(makeEvent(actor.tenantId, 'DisbursementRecorded', 'job', r.jobId, { jobId: r.jobId, disbursementId: r.id, amount: r.amount, currency: r.currency, feeType: r.feeType, stageKey: r.stageKey }));
  }
  return inserted;
}

/** Money summary for one job (job detail, customer approval, closure check). */
export async function jobFinanceSummary(tx: Tx, jobId: string) {
  const rows = await tx
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
  return rows;
}

export async function listJobDisbursements(tx: Tx, jobId: string) {
  return tx.select().from(disbursement).where(eq(disbursement.jobId, jobId)).orderBy(disbursement.createdAt);
}

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400_000).toISOString().slice(0, 10);

/** FIN-003: draft invoice = tariff service fee (once per job) + billable, unbilled disbursements with markup. */
export async function generateInvoice(tx: Tx, actor: Actor, meta: RequestMeta | undefined, jobId: string, dueInDays?: number) {
    const j = await requireJob(tx, jobId);
    const cust = (await getCustomer(tx, j.customerId))!;
    const tenantRow = await getTenant(tx, actor.tenantId);
    const tariff = cust.tariff ?? { currency: tenantRow!.baseCurrency, perBl: '0', perContainer: '0', vatPct: 5, markupPct: 0 };
    const containers = (await getContainers(tx, j.id)).length;
    const existingServiceInvoice = await tx.select({ id: invoice.id }).from(invoice).where(and(eq(invoice.jobId, j.id), ne(invoice.status, 'VOID')));
    const pending = await tx.select().from(disbursement).where(and(eq(disbursement.jobId, j.id), eq(disbursement.billable, true), isNull(disbursement.invoiceId), ne(disbursement.status, 'REVERSED')));
    const sameCurrency = pending.filter((d) => d.currency === tariff.currency);

    const lines: { kind: 'SERVICE' | 'DISBURSEMENT'; description: string; quantity: number; unitPrice: string; amount: string; vatRate: number; disbursementId?: string }[] = [];
    if (!existingServiceInvoice.length) {
      if (toMinor(tariff.perBl) > 0n) lines.push({ kind: 'SERVICE', description: `Clearance service fee — BL ${j.blNo}`, quantity: 1, unitPrice: tariff.perBl, amount: tariff.perBl, vatRate: tariff.vatPct });
      if (toMinor(tariff.perContainer) > 0n && containers) lines.push({ kind: 'SERVICE', description: 'Handling fee per container', quantity: containers, unitPrice: tariff.perContainer, amount: multiplyAmount(tariff.perContainer, containers), vatRate: tariff.vatPct });
    }
    for (const d of sameCurrency) {
      const markup = Number(d.markupPct) || tariff.markupPct || 0;
      const amount = addAmounts(d.amount, percentOf(d.amount, markup));
      lines.push({ kind: 'DISBURSEMENT', description: `${d.feeType.replace(/_/g, ' ')}${d.stageKey ? ` (${d.stageKey})` : ''}${d.description ? ` — ${d.description}` : ''}`, quantity: 1, unitPrice: amount, amount, vatRate: 0, disbursementId: d.id });
    }
    if (!lines.length) throw unprocessable('Nothing to invoice: no service fee and no unbilled payments');

    const subtotal = addAmounts(...lines.map((l) => l.amount));
    const vat = addAmounts('0', ...lines.filter((l) => l.vatRate > 0).map((l) => percentOf(l.amount, l.vatRate)));
    const year = new Date().getUTCFullYear();
    const [counter] = await tx.insert(invoiceCounter).values({ tenantId: actor.tenantId, year, value: 1 })
      .onConflictDoUpdate({ target: [invoiceCounter.tenantId, invoiceCounter.year], set: { value: sql`${invoiceCounter.value} + 1` } }).returning();
    const id = uuidv7();
    const [inv] = await tx.insert(invoice).values({
      id, tenantId: actor.tenantId, jobId: j.id, customerId: j.customerId, invoiceNo: `INV-${year}-${String(counter!.value).padStart(5, '0')}`,
      issueDate: today(), dueDate: addDays(today(), dueInDays ?? cust.creditDays), currency: tariff.currency,
      subtotal, vatAmount: vat, total: addAmounts(subtotal, vat), status: 'DRAFT',
    }).returning();
    await tx.insert(invoiceLine).values(lines.map((l) => ({ id: uuidv7(), tenantId: actor.tenantId, invoiceId: id, ...l, vatRate: String(l.vatRate), disbursementId: l.disbursementId ?? null })));
    if (sameCurrency.length) await tx.update(disbursement).set({ invoiceId: id }).where(inArray(disbursement.id, sameCurrency.map((d) => d.id)));
    await audit(tx, actor, meta, { action: 'invoice.drafted', entityType: 'invoice', entityId: id, after: { total: inv!.total } });
    return { ...inv!, excludedOtherCurrency: pending.length - sameCurrency.length };
}
