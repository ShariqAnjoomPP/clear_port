import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Q } from '../../lib/db';
import { notFound } from '../../lib/errors';
import { throttle } from '../../lib/throttle';
import { config } from '../../lib/config';
import { cargoLine, comment, container, customer, job, stageEvent, stageInstance } from '../../lib/schema';
import { getCompany } from '../settings/service';
import { getWorkflow } from '../workflow/service';
import { jobSummaries } from '../jobs/service';

/**
 * Public tracking page (/track): a customer types the mobile number the agent has on file and sees their shipments.
 * A phone number is a weak check, so this view leaves out money and documents (those stay in the token portal).
 */

/** Last 8 digits: "+968 9911 2233", "99112233" and "0096899112233" are the same number. */
export const phoneKey = (v: string) => v.replace(/\D/g, '').slice(-8);
export const maskPhone = (v: string) => `•••• ${v.replace(/\D/g, '').slice(-4)}`;

/** Customers with a contact whose phone is this number. */
export async function customersByPhone(q: Q, phone: string) {
  const key = phoneKey(phone);
  return q
    .select({ id: customer.id, name: customer.name })
    .from(customer)
    .where(and(isNull(customer.archivedAt), sql`exists (
      select 1 from jsonb_array_elements(${customer.contacts}) ct
      where right(regexp_replace(coalesce(ct->>'phone', ''), '[^0-9]', '', 'g'), 8) = ${key})`))
    .orderBy(asc(customer.name));
}

/** Phone lookups per client address (the shared throttle in lib/throttle.ts). */
export const throttleLookup = (ip: string) =>
  throttle('track', ip, config.TRACK_LOOKUPS_PER_15MIN, 'Too many tries. Please wait a few minutes, or contact your agent.');

/** What a customer calls each phase of the job. */
export const PHASE_FOR_CUSTOMER: Record<string, string> = {
  DOCUMENTS: 'Documents received', CLEARANCE: 'Customs clearance in progress', CCRO: 'Awaiting port release', DELIVERY: 'Delivering', READY_TO_CLOSE: 'Delivered', CLOSED: 'Completed',
};
const PROGRESS: Record<string, number> = { DOCUMENTS: 10, CLEARANCE: 35, CCRO: 60, DELIVERY: 75, READY_TO_CLOSE: 100, CLOSED: 100 };

/** Open shipments first, then the ones completed in the last 90 days. */
export async function trackShipments(q: Q, customerIds: string[]) {
  const rows = (await Promise.all(customerIds.map((id) => jobSummaries(q, { customerId: id })))).flat();
  if (!rows.length) return [];
  const extra = await q.select({ id: job.id, commodity: job.commodity, ata: job.ata, closedAt: job.closedAt }).from(job).where(inArray(job.id, rows.map((r) => r.jobId)));
  const byId = new Map(extra.map((e) => [e.id, e]));
  const cutoff = Date.now() - 90 * 86400_000;
  return rows
    .filter((r) => r.phase !== 'CLOSED' || (byId.get(r.jobId)?.closedAt?.getTime() ?? 0) > cutoff)
    .sort((a, b) => Number(a.phase === 'CLOSED') - Number(b.phase === 'CLOSED') || +new Date(b.updatedAt) - +new Date(a.updatedAt))
    .map((r) => {
      const e = byId.get(r.jobId);
      const progress = r.phase === 'DELIVERY' && r.containersTotal ? 65 + Math.round((r.containersDelivered / r.containersTotal) * 30) : PROGRESS[r.phase] ?? 0;
      return {
        jobId: r.jobId, blNo: r.blNo, customerName: r.customerName, commodity: e?.commodity ?? '', eta: r.eta, ata: e?.ata ?? null,
        phase: r.phase, status: PHASE_FOR_CUSTOMER[r.phase] ?? r.phase, progress,
        containersTotal: r.containersTotal, containersDelivered: r.containersDelivered, updatedAt: r.updatedAt,
      };
    });
}

/** Customer words for each step. */
const STEP_NAME: Record<string, string> = {
  DOCUMENTS: 'Documents', BAYAN: 'Customs declaration', CUSTOMER_COMM: 'Your confirmation of charges', INSPECTION: 'Customs inspection', DO: 'Delivery order',
  CCRO: 'Port release', TRUCK: 'Truck', PHYSICAL_INSPECTION: 'Physical inspection', RELEASE: 'Release from port', DELIVERY: 'Delivery',
};
const MILESTONES = ['DOCUMENTS', 'BAYAN', 'INSPECTION', 'DO', 'CCRO'] as const;
const CONTAINER_STATUS: Record<string, string> = {
  AWAITING_RELEASE: 'Waiting for port release', NOT_STARTED: 'Released, truck being arranged', PENDING: 'Released, truck being arranged', IN_TRANSIT: 'On the way', DELIVERED: 'Delivered', EMPTY_RETURNED: 'Delivered',
};

/** One shipment for the tracking page: milestones, containers, goods and the latest updates in plain words. */
export async function trackShipment(q: Q, customerIds: string[], jobId: string) {
  const [j] = await q.select().from(job).where(and(eq(job.id, jobId), inArray(job.customerId, customerIds)));
  if (!j) throw notFound('Shipment');
  const [wf, [summary], boxes, stages, events, notes, goods] = await Promise.all([
    getWorkflow(q, j.workflowVersion),
    jobSummaries(q, { customerId: j.customerId }).then((rows) => rows.filter((r) => r.jobId === j.id)),
    q.select().from(container).where(eq(container.jobId, j.id)).orderBy(asc(container.containerNo)),
    q.select().from(stageInstance).where(eq(stageInstance.jobId, j.id)),
    q.select().from(stageEvent).where(eq(stageEvent.jobId, j.id)).orderBy(desc(stageEvent.occurredAt)),
    q.select().from(comment).where(and(eq(comment.jobId, j.id), eq(comment.customerVisible, true))).orderBy(desc(comment.createdAt)),
    q.select().from(cargoLine).where(eq(cargoLine.jobId, j.id)).orderBy(asc(cargoLine.lineNo)),
  ]);
  const statusLabel = (key: string, status: string) => wf.stages.find((s) => s.key === key)?.statuses.find((x) => x.key === status)?.label.en ?? status;
  const boxNo = new Map(boxes.map((b) => [b.id, b.containerNo]));
  const deliveryOf = (id: string) => stages.find((s) => s.containerId === id && s.stageKey === 'DELIVERY');
  const allDelivered = boxes.length > 0 && boxes.every((b) => ['DELIVERED', 'EMPTY_RETURNED'].includes(deliveryOf(b.id)?.status ?? ''));
  const lastDelivery = boxes.map((b) => deliveryOf(b.id)?.completedAt).filter((d): d is Date => !!d).sort((a, b) => +b - +a)[0] ?? null;

  const updates = [
    ...events.map((e) => ({
      at: e.occurredAt,
      text: `${STEP_NAME[e.stageKey] ?? e.stageKey}: ${statusLabel(e.stageKey, e.toStatus)}`,
      container: e.containerId ? boxNo.get(e.containerId) ?? null : null,
    })),
    ...notes.map((n) => ({ at: n.createdAt, text: `Note from your agent: ${n.body}`, container: null })),
  ].sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 29);
  // Opening the shipment always comes first in time, even when the first step shares its timestamp.
  updates.push({ at: j.createdAt, text: 'Shipment opened with your clearing agent', container: null });

  return {
    jobId: j.id, blNo: j.blNo, commodity: j.commodity, vessel: j.vessel, voyage: j.voyage, portOfLoading: j.portOfLoading, portOfDischarge: j.portOfDischarge,
    eta: j.eta, ata: j.ata, phase: summary?.phase ?? null, status: summary ? PHASE_FOR_CUSTOMER[summary.phase] : null,
    milestones: [
      ...MILESTONES.map((k) => {
        const s = stages.find((x) => x.stageKey === k && !x.containerId);
        return { key: k, label: STEP_NAME[k]!, done: !!s?.completedAt, at: s?.completedAt ?? null, current: !s?.completedAt && !!s?.startedAt };
      }),
      { key: 'DELIVERED', label: 'Delivered', done: allDelivered, at: allDelivered ? lastDelivery : null, current: false },
    ],
    containers: boxes.map((b) => {
      const d = deliveryOf(b.id);
      const status = d?.status ?? (stages.some((s) => s.containerId === b.id) ? 'NOT_STARTED' : 'AWAITING_RELEASE');
      return {
        containerNo: b.containerNo, sizeType: b.sizeType, status: CONTAINER_STATUS[status] ?? statusLabel('DELIVERY', status),
        delivered: ['DELIVERED', 'EMPTY_RETURNED'].includes(status), deliveredAt: d?.completedAt ?? null,
        receiverName: (d?.data.receiverName as string | undefined) ?? null, freeTimeExpiresAt: b.freeTimeExpiresAt,
      };
    }),
    goods: goods.map((g) => ({ description: g.description, packages: g.packages, packageKind: g.packageKind, container: g.containerId ? boxNo.get(g.containerId) ?? null : null })),
    updates,
  };
}

/** How customers reach the agency. */
export async function agencyContact(q: Q) {
  const c = await getCompany(q);
  return { name: c.name, phone: c.phone, whatsapp: c.whatsapp, email: c.email };
}
