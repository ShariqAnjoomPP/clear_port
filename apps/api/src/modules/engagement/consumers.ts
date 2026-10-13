import { and, eq } from 'drizzle-orm';
import { formatMoney } from '@clearport/kernel';
import type { Consumer } from '../../shared/bus';
import { appUser, container, customerApproval, job, stageInstance } from '../../shared/schema';
import { getContainers } from '../clearance/public';
import { notifyCustomer, queueNotification } from './public';
import { dispatchQueued } from './dispatcher';

const STAGE_NAMES: Record<string, string> = {
  DOCUMENTS: 'Documents', BAYAN: 'Bayan', CUSTOMER_COMM: 'Customer confirmation', INSPECTION: 'Customs inspection', DO: 'Delivery order',
  CCRO: 'CCRO', TRUCK: 'Truck assignment', PHYSICAL_INSPECTION: 'Physical inspection', RELEASE: 'Container release', DELIVERY: 'Delivery',
};

/** Notifier (notify-q): turns domain events into customer and staff messages (NTF-001/002). */
export const notifier: Consumer = {
  name: 'engagement.notifier',
  handles: ['StageStatusChanged', 'StageAssigned', 'InvoiceIssued', 'CustomerApprovalDecided', 'SlaBreached', 'FreeTimeExpiring'],
  async handle(event, tx) {
    const p = event.payload as Record<string, any>;
    const t = event.tenantId;

    if (event.type === 'StageAssigned' && p.assigneeId) {
      await queueNotification(tx, { tenantId: t, channel: 'IN_APP', recipient: p.assigneeId, userId: p.assigneeId, jobId: p.jobId, template: 'STAGE_ASSIGNED', vars: { stage: STAGE_NAMES[p.stageKey] ?? p.stageKey, blNo: p.blNo, jobNo: p.jobNo }, dedupeKey: `assign:${event.id}` });
    }

    if (event.type === 'StageStatusChanged') {
      const cont = p.containerId ? (await tx.select().from(container).where(eq(container.id, p.containerId)))[0] : undefined;
      const vars = { blNo: p.blNo, jobNo: p.jobNo, containerNo: cont?.containerNo };
      // Staff confirmed (or reset) the charges themselves: any open approval link must stop working.
      if (p.stageKey === 'CUSTOMER_COMM' && p.from === 'SENT') {
        await tx.update(customerApproval).set({ status: 'EXPIRED' }).where(and(eq(customerApproval.jobId, p.jobId), eq(customerApproval.status, 'PENDING')));
      }
      if (p.stageKey === 'DOCUMENTS' && p.to === 'RECEIVED') await notifyCustomer(tx, t, p.customerId, p.jobId, 'DOCS_RECEIVED', vars, `docs:${p.jobId}`);
      if (p.stageKey === 'CCRO' && p.to === 'ISSUED') {
        const n = (await getContainers(tx, p.jobId)).length;
        await notifyCustomer(tx, t, p.customerId, p.jobId, 'CLEARED', { ...vars, containers: n }, `cleared:${p.jobId}`);
      }
      if (p.stageKey === 'DELIVERY' && p.to === 'IN_TRANSIT') await notifyCustomer(tx, t, p.customerId, p.jobId, 'OUT_FOR_DELIVERY', vars, `transit:${p.containerId}`);
      if (p.stageKey === 'DELIVERY' && p.to === 'DELIVERED') {
        const [stage] = await tx.select().from(stageInstance).where(and(eq(stageInstance.containerId, p.containerId), eq(stageInstance.stageKey, 'DELIVERY')));
        await notifyCustomer(tx, t, p.customerId, p.jobId, 'DELIVERED', { ...vars, receiver: String(stage?.data.receiverName ?? '') }, `delivered:${p.containerId}`);
      }
    }

    if (event.type === 'InvoiceIssued') {
      const [j] = await tx.select().from(job).where(eq(job.id, p.jobId));
      if (j) await notifyCustomer(tx, t, p.customerId, p.jobId, 'INVOICE_ISSUED', { invoiceNo: p.invoiceNo, blNo: j.blNo, total: formatMoney({ amount: p.total, currency: p.currency }) }, `invoice:${p.invoiceId}`);
    }

    if (event.type === 'CustomerApprovalDecided') {
      const [j] = await tx.select().from(job).where(eq(job.id, p.jobId));
      if (j?.coordinatorId) {
        await queueNotification(tx, { tenantId: t, channel: 'IN_APP', recipient: j.coordinatorId, userId: j.coordinatorId, jobId: j.id, template: 'CUSTOMER_DECISION', vars: { blNo: j.blNo, decision: p.decision === 'APPROVED' ? 'approved' : 'disputed', by: p.decidedBy, note: p.note }, dedupeKey: `decision:${event.id}` });
      }
    }

    if (event.type === 'SlaBreached' || event.type === 'FreeTimeExpiring') {
      const [j] = await tx.select().from(job).where(eq(job.id, p.jobId));
      const recipients = new Set<string>([p.assigneeId, j?.coordinatorId].filter(Boolean));
      if (!recipients.size) {
        const owners = (await tx.select().from(appUser)).filter((u) => u.roles.includes('OWNER') || u.roles.includes('COORDINATOR'));
        owners.forEach((o) => recipients.add(o.id));
      }
      for (const uid of recipients) {
        await queueNotification(tx, {
          tenantId: t, channel: 'IN_APP', recipient: uid, userId: uid, jobId: p.jobId,
          template: event.type === 'SlaBreached' ? 'SLA_BREACHED' : 'FREE_TIME_EXPIRING',
          vars: { stage: STAGE_NAMES[p.stageKey] ?? p.stageKey, blNo: j?.blNo, containerNo: p.containerNo, date: p.date, when: p.when },
          dedupeKey: `${event.type}:${p.dedupe}:${uid}`,
        });
      }
    }

    setImmediate(() => void dispatchQueued(t).catch(() => undefined));
  },
};
