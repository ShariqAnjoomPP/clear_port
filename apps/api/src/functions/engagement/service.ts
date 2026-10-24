import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { formatMoney, uuidv7 } from '@clearport/kernel';
import { config } from '../../lib/config';
import type { Q, Tx } from '../../lib/db';
import { conflict, notFound } from '../../lib/errors';
import { container, customer, customerApproval, disbursement, document, invoice, job, masterItem, notification, stageInstance } from '../../lib/schema';
import { newLinkToken } from '../../lib/tokens';
import type { JobRow } from '../jobs/queries';
import { render } from './templates';

type Vars = Record<string, string | number | undefined>;

export const approvalUrl = (token: string) => `${config.PUBLIC_APP_URL}/a/${token}`;
export const portalUrl = (token: string) => `${config.PUBLIC_APP_URL}/p/${token}`;

// ── sending (prototype: in-app is real, external channels are logged, never sent) ──

/** The agency's in-app inbox (the bell). With one demo user every staff alert lands here. */
export async function notifyStaff(q: Q, n: { jobId?: string | null; template: string; vars: Vars }) {
  const { title, body } = render(n.template, 'en', n.vars);
  await q.insert(notification).values({ id: uuidv7(), channel: 'IN_APP', recipient: 'staff', jobId: n.jobId ?? null, template: n.template, title, body, status: 'UNREAD' });
}

/** Logs a WhatsApp/email/SMS message exactly as it would be sent. Production plugs a sender in here. */
async function logOutbound(q: Q, n: { channel: 'WHATSAPP' | 'EMAIL' | 'SMS'; recipient: string; jobId: string | null; template: string; lang: string; vars: Vars; link?: string }) {
  const { title, body } = render(n.template, n.lang, n.vars);
  await q.insert(notification).values({
    id: uuidv7(), channel: n.channel, recipient: n.recipient, jobId: n.jobId, template: n.template, title,
    body: n.link ? `${body}\n${n.link}` : body, link: n.link ?? null, status: 'LOGGED',
  });
}

/** Messages every customer contact on their preferred channel, honouring WhatsApp consent, in the customer's language. */
export async function notifyCustomer(q: Q, customerId: string, jobId: string, template: string, vars: Vars, link?: string) {
  const [cust] = await q.select().from(customer).where(eq(customer.id, customerId));
  if (!cust) return;
  for (const ct of cust.contacts) {
    const whatsapp = cust.preferredChannel === 'WHATSAPP' && ct.whatsappOptIn && ct.phone;
    const channel = whatsapp ? 'WHATSAPP' : ct.email ? 'EMAIL' : ct.phone ? 'SMS' : null;
    if (!channel) continue;
    await logOutbound(q, { channel, recipient: (channel === 'EMAIL' ? ct.email : ct.phone)!, jobId, template, lang: cust.language, vars, link });
  }
}

export async function notifyDriver(q: Q, phone: string | null, jobId: string, vars: Vars, link: string) {
  if (phone) await logOutbound(q, { channel: 'WHATSAPP', recipient: phone, jobId, template: 'TRIP_ASSIGNED', lang: 'en', vars, link });
}

// ── workflow hooks (called directly after a stage changes; the prototype's replacement for event consumers) ──

export interface StageChange {
  job: JobRow;
  stageKey: string;
  stageLabel: string;
  containerId: string | null;
  from: string;
  to: string;
  data: Record<string, unknown>;
  actions: string[];
  stageInstanceId: string;
}

/** Customer messages, approval links and staff alerts that follow a stage change. */
export async function onStageChanged(tx: Tx, c: StageChange) {
  const j = c.job;
  const [ct] = c.containerId ? await tx.select().from(container).where(eq(container.id, c.containerId)) : [];
  const vars = { blNo: j.blNo, jobNo: j.jobNo, containerNo: ct?.containerNo };

  // Charges confirmed or reset by staff: any open approval link stops working.
  if (c.stageKey === 'CUSTOMER_COMM' && c.from === 'SENT') await expirePendingApprovals(tx, j.id);
  if (c.stageKey === 'DOCUMENTS' && c.to === 'RECEIVED') await notifyCustomer(tx, j.customerId, j.id, 'DOCS_RECEIVED', vars);
  if (c.stageKey === 'DELIVERY' && c.to === 'IN_TRANSIT') await notifyCustomer(tx, j.customerId, j.id, 'OUT_FOR_DELIVERY', vars);

  for (const action of c.actions) {
    if (action === 'REQUEST_CUSTOMER_APPROVAL') await requestCustomerApproval(tx, j, c.stageInstanceId);
    if (action === 'NOTIFY_CUSTOMER:CLEARED') {
      const n = (await tx.select({ id: container.id }).from(container).where(and(eq(container.jobId, j.id), eq(container.active, true)))).length;
      await notifyCustomer(tx, j.customerId, j.id, 'CLEARED', { ...vars, containers: n });
    }
    if (action === 'NOTIFY_CUSTOMER:DELIVERED') await notifyCustomer(tx, j.customerId, j.id, 'DELIVERED', { ...vars, receiver: String(c.data.receiverName ?? '') });
    if (action === 'CHECK_JOB_COMPLETE') {
      const deliveries = await tx.select().from(stageInstance).where(and(eq(stageInstance.jobId, j.id), eq(stageInstance.stageKey, 'DELIVERY')));
      if (deliveries.length && deliveries.every((d) => d.completedAt)) await notifyStaff(tx, { jobId: j.id, template: 'READY_TO_CLOSE', vars });
    }
  }
}

// ── customer approval of charges ──

export type ApprovalRow = typeof customerApproval.$inferSelect;

async function expirePendingApprovals(q: Q, jobId: string) {
  await q.update(customerApproval).set({ status: 'EXPIRED' }).where(and(eq(customerApproval.jobId, jobId), eq(customerApproval.status, 'PENDING')));
}

/** "Send charges to customer": a 7-day no-login link with every billable payment so far, sent on the customer's channel. */
export async function requestCustomerApproval(tx: Tx, j: JobRow, stageInstanceId: string) {
  await expirePendingApprovals(tx, j.id);
  const pays = await tx.select().from(disbursement).where(and(eq(disbursement.jobId, j.id), eq(disbursement.billable, true), ne(disbursement.status, 'REVERSED')));
  const feeNames = new Map((await tx.select().from(masterItem).where(eq(masterItem.kind, 'FEE_TYPE'))).map((m) => [m.code, m.name]));
  const totals = new Map<string, number>();
  for (const p of pays) totals.set(p.currency, (totals.get(p.currency) ?? 0) + Math.round(Number(p.amount) * 1000));
  const summary = {
    blNo: j.blNo, jobNo: j.jobNo,
    lines: pays.map((p) => ({ feeType: p.feeType, feeName: feeNames.get(p.feeType) ?? p.feeType, stageKey: p.stageKey, amount: p.amount, currency: p.currency, description: p.description })),
    totals: [...totals].map(([currency, thousandths]) => ({ currency, amount: (thousandths / 1000).toFixed(3) })),
  };
  const token = newLinkToken();
  await tx.insert(customerApproval).values({ id: uuidv7(), jobId: j.id, stageInstanceId, token, summary, expiresAt: new Date(Date.now() + 7 * 86400_000) });
  const total = summary.totals.map((t) => formatMoney({ amount: t.amount, currency: t.currency })).join(' + ') || '—';
  await notifyCustomer(tx, j.customerId, j.id, 'APPROVAL_REQUEST', { blNo: j.blNo, jobNo: j.jobNo, total }, approvalUrl(token));
}

export async function approvalByToken(q: Q, token: string) {
  const [a] = await q.select().from(customerApproval).where(eq(customerApproval.token, token));
  if (!a) throw notFound('Approval');
  return a;
}

/** Records the customer's answer once. The caller then moves "Customer confirmation" (see approvals.ts). */
export async function recordDecision(tx: Tx, a: ApprovalRow, decision: 'APPROVED' | 'REJECTED', by: string, note?: string) {
  if (a.status !== 'PENDING') throw conflict('This approval was already answered or has been replaced');
  if (a.expiresAt.getTime() < Date.now()) throw conflict('This approval link has expired');
  await tx.update(customerApproval).set({ status: decision, decidedAt: new Date(), decidedBy: by, note: note ?? null }).where(eq(customerApproval.id, a.id));
  const [j] = await tx.select().from(job).where(eq(job.id, a.jobId));
  await notifyStaff(tx, { jobId: a.jobId, template: 'CUSTOMER_DECISION', vars: { blNo: j?.blNo, decision: decision === 'APPROVED' ? 'approved' : 'disputed', by, note } });
}

export async function pendingApprovals(q: Q, filter: { customerId?: string; jobId?: string } = {}) {
  const rows = await q
    .select({ a: customerApproval, customerId: job.customerId })
    .from(customerApproval)
    .innerJoin(job, eq(job.id, customerApproval.jobId))
    .where(and(eq(customerApproval.status, 'PENDING'), filter.customerId ? eq(job.customerId, filter.customerId) : undefined, filter.jobId ? eq(customerApproval.jobId, filter.jobId) : undefined))
    .orderBy(desc(customerApproval.createdAt));
  return rows.map(({ a }) => ({ id: a.id, jobId: a.jobId, summary: a.summary, expiresAt: a.expiresAt, createdAt: a.createdAt }));
}

// ── inbox, outbound log, alerts ──

export async function inbox(q: Q) {
  const items = await q.select().from(notification).where(eq(notification.channel, 'IN_APP')).orderBy(desc(notification.createdAt)).limit(100);
  const [row] = await q.select({ n: sql<number>`count(*)::int` }).from(notification).where(and(eq(notification.channel, 'IN_APP'), eq(notification.status, 'UNREAD')));
  return { items, unread: row?.n ?? 0 };
}

export async function readAll(q: Q) {
  await q.update(notification).set({ status: 'READ', readAt: new Date() }).where(and(eq(notification.channel, 'IN_APP'), eq(notification.status, 'UNREAD')));
}

export async function outbound(q: Q, jobId?: string) {
  return q
    .select()
    .from(notification)
    .where(and(ne(notification.channel, 'IN_APP'), jobId ? eq(notification.jobId, jobId) : undefined))
    .orderBy(desc(notification.createdAt))
    .limit(200);
}

/**
 * Things that need attention now, worked out when asked (no scheduler needed in the prototype):
 * overdue stages on open jobs, and undelivered containers whose port free time ends within two days.
 */
export async function alerts(q: Q) {
  const overdue = await q.execute<{ job_id: string; job_no: string; bl_no: string; stage_key: string; container_no: string | null; sla_due_at: Date }>(sql`
    select j.id job_id, j.job_no, j.bl_no, si.stage_key, ct.container_no, si.sla_due_at
    from stage_instance si join job j on j.id = si.job_id left join container ct on ct.id = si.container_id
    where j.status = 'OPEN' and si.completed_at is null and si.sla_due_at < now()
    order by si.sla_due_at`);
  const freeTime = await q.execute<{ job_id: string; job_no: string; bl_no: string; container_no: string; free_time_expires_at: string }>(sql`
    select j.id job_id, j.job_no, j.bl_no, ct.container_no, ct.free_time_expires_at
    from container ct join job j on j.id = ct.job_id
    where j.status = 'OPEN' and ct.active and ct.free_time_expires_at <= current_date + 2
      and not exists (select 1 from stage_instance si where si.container_id = ct.id and si.stage_key = 'DELIVERY' and si.completed_at is not null)
    order by ct.free_time_expires_at`);
  return {
    overdue: overdue.rows.map((r) => ({ jobId: r.job_id, jobNo: r.job_no, blNo: r.bl_no, stageKey: r.stage_key, containerNo: r.container_no, slaDueAt: r.sla_due_at })),
    freeTime: freeTime.rows.map((r) => ({ jobId: r.job_id, jobNo: r.job_no, blNo: r.bl_no, containerNo: r.container_no, freeTimeExpiresAt: r.free_time_expires_at })),
  };
}

// ── customer portal (no login: one link per customer) ──

export async function customerByPortalToken(q: Q, token: string) {
  const [c] = await q.select().from(customer).where(eq(customer.portalToken, token));
  if (!c || c.archivedAt) throw notFound('Portal');
  return c;
}

export async function regeneratePortalLink(q: Q, customerId: string) {
  const token = newLinkToken();
  const [c] = await q.update(customer).set({ portalToken: token }).where(eq(customer.id, customerId)).returning();
  if (!c) throw notFound('Customer');
  return portalUrl(token);
}

const MILESTONES = ['DOCUMENTS', 'BAYAN', 'CUSTOMER_COMM', 'INSPECTION', 'DO', 'CCRO'];

/** One shipment as the customer sees it: progress, containers, shared documents, invoices and open approvals. */
export async function portalJob(q: Q, customerId: string, jobId: string) {
  const [j] = await q.select().from(job).where(and(eq(job.id, jobId), eq(job.customerId, customerId)));
  if (!j) throw notFound('Shipment');
  const [containers, stages, docs, invoices, approvals] = await Promise.all([
    q.select().from(container).where(eq(container.jobId, j.id)).orderBy(asc(container.containerNo)),
    q.select().from(stageInstance).where(eq(stageInstance.jobId, j.id)),
    q.select().from(document).where(and(eq(document.jobId, j.id), eq(document.customerVisible, true))),
    q.select().from(invoice).where(and(eq(invoice.jobId, j.id), inArray(invoice.status, ['ISSUED', 'PAID']))),
    pendingApprovals(q, { jobId: j.id }),
  ]);
  return {
    jobId: j.id, jobNo: j.jobNo, blNo: j.blNo, vessel: j.vessel, eta: j.eta, commodity: j.commodity, status: j.status,
    milestones: MILESTONES.map((k) => {
      const s = stages.find((x) => x.stageKey === k && !x.containerId);
      return { key: k, status: s?.status, done: !!s?.completedAt, completedAt: s?.completedAt ?? null };
    }),
    containers: containers.map((ct) => {
      const delivery = stages.find((s) => s.containerId === ct.id && s.stageKey === 'DELIVERY');
      return { id: ct.id, containerNo: ct.containerNo, sizeType: ct.sizeType, freeTimeExpiresAt: ct.freeTimeExpiresAt, status: delivery?.status ?? 'AWAITING_RELEASE', deliveredAt: delivery?.completedAt ?? null, receiverName: (delivery?.data.receiverName as string | undefined) ?? null };
    }),
    documents: docs.map((d) => ({ id: d.id, docType: d.docType, fileName: d.fileName, createdAt: d.createdAt })),
    invoices: invoices.map((i) => ({ id: i.id, invoiceNo: i.invoiceNo, total: i.total, currency: i.currency, status: i.status, dueDate: i.dueDate })),
    pendingApprovals: approvals,
  };
}

/** A document the customer may open: on one of their jobs and marked visible to them. */
export async function portalDocument(q: Q, customerId: string, documentId: string) {
  const [row] = await q
    .select({ d: document })
    .from(document)
    .innerJoin(job, eq(job.id, document.jobId))
    .where(and(eq(document.id, documentId), eq(job.customerId, customerId), eq(document.customerVisible, true)));
  if (!row) throw notFound('Document');
  return row.d;
}

export async function approvalForCustomer(q: Q, customerId: string, approvalId: string) {
  const [row] = await q
    .select({ a: customerApproval })
    .from(customerApproval)
    .innerJoin(job, eq(job.id, customerApproval.jobId))
    .where(and(eq(customerApproval.id, approvalId), eq(job.customerId, customerId)));
  if (!row) throw notFound('Approval');
  return row.a;
}

