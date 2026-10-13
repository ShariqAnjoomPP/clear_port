import { Hono } from 'hono';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ApprovalDecisionInput } from '@clearport/contracts';
import { audit } from '../../shared/audit';
import { hashToken } from '../../shared/auth';
import { systemActor, type AppEnv } from '../../shared/context';
import { definerQuery, withTenant } from '../../shared/db';
import { makeEvent } from '../../shared/events';
import { parseBody, protectedRouter } from '../../shared/http';
import { requirePermission } from '../../shared/policy';
import { conflict, forbidden, notFound } from '../../shared/problem';
import { container, customerApproval, document, invoice, job, jobBoard, notification, stageInstance } from '../../shared/schema';
import { fileStore } from '../../shared/files';

/** Staff notifications (in-app inbox) and the outbound message log for a job. */
export function notificationRoutes() {
  const r = protectedRouter();
  r.get('/', async (c) => {
    const actor = c.get('actor');
    const items = await withTenant(actor, (tx) =>
      tx.select().from(notification).where(and(eq(notification.channel, 'IN_APP'), eq(notification.userId, actor.userId!))).orderBy(desc(notification.createdAt)).limit(50),
    );
    return c.json({ items, unread: items.filter((i) => !i.readAt).length });
  });
  r.post('/read-all', async (c) => {
    const actor = c.get('actor');
    await withTenant(actor, (tx) => tx.update(notification).set({ readAt: new Date() }).where(and(eq(notification.userId, actor.userId!), isNull(notification.readAt))));
    return c.json({ ok: true });
  });
  r.get('/outbound', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'job.read');
    const jobId = c.req.query('jobId');
    const items = await withTenant(actor, (tx) =>
      tx.select().from(notification).where(and(sql`${notification.channel} <> 'IN_APP'`, jobId ? eq(notification.jobId, jobId) : undefined)).orderBy(desc(notification.createdAt)).limit(100),
    );
    return c.json({ items });
  });
  return r;
}

const PHASE_FOR_CUSTOMER: Record<string, string> = {
  DOCUMENTS: 'Documents received', CLEARANCE: 'Customs clearance in progress', CCRO: 'Awaiting release', DELIVERY: 'Delivering', READY_TO_CLOSE: 'Delivered', CLOSED: 'Completed',
};

/** Customer portal API (CXP-001). RLS also restricts jobs to app.customer_id for these sessions. */
export function portalRoutes() {
  const r = protectedRouter();
  r.use('*', async (c, next) => {
    const actor = c.get('actor');
    requirePermission(actor, 'portal.access');
    if (!actor.customerId) throw forbidden();
    await next();
  });

  r.get('/jobs', async (c) => {
    const actor = c.get('actor');
    const items = await withTenant(actor, (tx) =>
      tx.select().from(jobBoard).where(eq(jobBoard.customerId, actor.customerId!)).orderBy(desc(jobBoard.updatedAt)).limit(200),
    );
    return c.json({ items: items.map((i) => ({ jobId: i.jobId, jobNo: i.jobNo, blNo: i.blNo, eta: i.eta, phase: i.phase, phaseLabel: PHASE_FOR_CUSTOMER[i.phase], containersTotal: i.containersTotal, containersDelivered: i.containersDelivered, updatedAt: i.updatedAt })) });
  });

  r.get('/jobs/:id', async (c) => {
    const actor = c.get('actor');
    const res = await withTenant(actor, async (tx) => {
      const [j] = await tx.select().from(job).where(and(eq(job.id, c.req.param('id')), eq(job.customerId, actor.customerId!)));
      if (!j) throw notFound('Shipment');
      const containers = await tx.select().from(container).where(eq(container.jobId, j.id));
      const stages = await tx.select().from(stageInstance).where(eq(stageInstance.jobId, j.id));
      const docs = await tx.select().from(document).where(and(eq(document.jobId, j.id), eq(document.customerVisible, true)));
      const invoices = await tx.select().from(invoice).where(and(eq(invoice.jobId, j.id), inArray(invoice.status, ['ISSUED', 'PAID'])));
      const approvals = await tx.select().from(customerApproval).where(and(eq(customerApproval.jobId, j.id), eq(customerApproval.status, 'PENDING')));
      const [board] = await tx.select().from(jobBoard).where(eq(jobBoard.jobId, j.id));
      const milestones = ['DOCUMENTS', 'BAYAN', 'CUSTOMER_COMM', 'INSPECTION', 'DO', 'CCRO'].map((k) => {
        const s = stages.find((x) => x.stageKey === k && !x.containerId);
        return { key: k, status: s?.status, done: !!s?.completedAt, completedAt: s?.completedAt };
      });
      return {
        jobId: j.id, jobNo: j.jobNo, blNo: j.blNo, vessel: j.vessel, eta: j.eta, commodity: j.commodity, phase: board?.phase, phaseLabel: PHASE_FOR_CUSTOMER[board?.phase ?? ''],
        milestones,
        containers: containers.map((ct) => {
          const cs = stages.filter((s) => s.containerId === ct.id);
          const delivery = cs.find((s) => s.stageKey === 'DELIVERY');
          return { id: ct.id, containerNo: ct.containerNo, sizeType: ct.sizeType, freeTimeExpiresAt: ct.freeTimeExpiresAt, status: delivery?.status ?? 'AWAITING_RELEASE', deliveredAt: delivery?.completedAt, receiverName: delivery?.data.receiverName ?? null, stages: cs.map((s) => ({ key: s.stageKey, status: s.status })) };
        }),
        documents: await Promise.all(docs.map(async (d) => ({ id: d.id, docType: d.docType, fileName: d.fileName, createdAt: d.createdAt, url: await fileStore.presignDownload(d.storageKey, d.fileName) }))),
        invoices: invoices.map((i) => ({ id: i.id, invoiceNo: i.invoiceNo, total: i.total, currency: i.currency, status: i.status, dueDate: i.dueDate })),
        pendingApprovals: approvals.map((a) => ({ id: a.id, summary: a.summary, expiresAt: a.expiresAt })),
      };
    });
    return c.json(res);
  });

  r.get('/approvals', async (c) => {
    const actor = c.get('actor');
    const items = await withTenant(actor, (tx) =>
      tx.select({ a: customerApproval }).from(customerApproval).innerJoin(job, eq(job.id, customerApproval.jobId)).where(and(eq(customerApproval.status, 'PENDING'), eq(job.customerId, actor.customerId!))),
    );
    return c.json({ items: items.map((i) => ({ id: i.a.id, jobId: i.a.jobId, summary: i.a.summary, expiresAt: i.a.expiresAt })) });
  });

  r.post('/approvals/:id/decision', async (c) => {
    const actor = c.get('actor');
    const input = await parseBody(c, ApprovalDecisionInput);
    await withTenant(actor, async (tx, uow) => {
      const [row] = await tx.select({ a: customerApproval }).from(customerApproval).innerJoin(job, eq(job.id, customerApproval.jobId)).where(and(eq(customerApproval.id, c.req.param('id')), eq(job.customerId, actor.customerId!)));
      if (!row) throw notFound('Approval');
      await decide(tx, uow, row.a, input.decision, actor.name, input.note);
      await audit(tx, actor, c.get('meta'), { action: `approval.${input.decision.toLowerCase()}`, entityType: 'customer_approval', entityId: row.a.id });
    });
    return c.json({ ok: true });
  });
  return r;
}

type ApprovalRow = typeof customerApproval.$inferSelect;
async function decide(tx: Parameters<Parameters<typeof withTenant>[1]>[0], uow: Parameters<Parameters<typeof withTenant>[1]>[1], a: ApprovalRow, decision: 'APPROVED' | 'REJECTED', by: string, note?: string) {
  if (a.status !== 'PENDING') throw conflict('This approval was already answered');
  if (a.expiresAt.getTime() < Date.now()) throw conflict('This approval link has expired');
  await tx.update(customerApproval).set({ status: decision, decidedAt: new Date(), decidedBy: by, note: note ?? null }).where(eq(customerApproval.id, a.id));
  uow.emit(makeEvent(a.tenantId, 'CustomerApprovalDecided', 'job', a.jobId, { jobId: a.jobId, stageInstanceId: a.stageInstanceId, approvalId: a.id, decision, decidedBy: by, note }));
}

/** One-tap approval link from WhatsApp/email (no login). The token is single-purpose, hashed at rest and expires. */
export function publicApprovalRoutes() {
  const r = new Hono<AppEnv>();
  const resolve = async (token: string) => {
    const rows = await definerQuery<{ approval_id: string; tenant_id: string }>('select * from engagement.resolve_approval_token($1)', [await hashToken(token)]);
    if (!rows[0]) throw notFound('Approval');
    return rows[0];
  };
  r.get('/:token', async (c) => {
    const ref = await resolve(c.req.param('token'));
    const a = await withTenant({ tenantId: ref.tenant_id, customerId: null }, async (tx) => (await tx.select().from(customerApproval).where(eq(customerApproval.id, ref.approval_id)))[0]);
    if (!a) throw notFound('Approval');
    return c.json({ status: a.status, summary: a.summary, expiresAt: a.expiresAt, decidedAt: a.decidedAt });
  });
  r.post('/:token/decision', async (c) => {
    const ref = await resolve(c.req.param('token'));
    const input = await parseBody(c, ApprovalDecisionInput);
    await withTenant({ tenantId: ref.tenant_id, customerId: null }, async (tx, uow) => {
      const [a] = await tx.select().from(customerApproval).where(eq(customerApproval.id, ref.approval_id));
      if (!a) throw notFound('Approval');
      await decide(tx, uow, a, input.decision, 'Customer (link)', input.note);
      await audit(tx, { ...systemActor(ref.tenant_id), kind: 'approval-link', name: 'Customer (link)' }, c.get('meta'), { action: `approval.${input.decision.toLowerCase()}`, entityType: 'customer_approval', entityId: a.id });
    });
    return c.json({ ok: true });
  });
  return r;
}
