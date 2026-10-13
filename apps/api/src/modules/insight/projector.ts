import { eq } from 'drizzle-orm';
import { deriveJobPhase } from '@clearport/workflow';
import type { Consumer } from '../../shared/bus';
import type { Tx } from '../../shared/db';
import { appUser, container, customer, job, jobBoard, stageInstance } from '../../shared/schema';

/** Rebuilds one job's board row from the write model. Idempotent, so it can be replayed at any time (CQRS read model). */
export async function projectJob(tx: Tx, jobId: string) {
  const [j] = await tx.select().from(job).where(eq(job.id, jobId));
  if (!j) return;
  const [cust] = await tx.select({ name: customer.name }).from(customer).where(eq(customer.id, j.customerId));
  const [coord] = j.coordinatorId ? await tx.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, j.coordinatorId)) : [];
  const stages = await tx.select().from(stageInstance).where(eq(stageInstance.jobId, jobId));
  const conts = await tx.select().from(container).where(eq(container.jobId, jobId));
  const jobStages = Object.fromEntries(stages.filter((s) => !s.containerId).map((s) => [s.stageKey, s.status]));
  const delivery = stages.filter((s) => s.containerId && s.stageKey === 'DELIVERY');
  const open = stages.filter((s) => !s.completedAt && s.slaDueAt);
  const nextDue = open.map((s) => s.slaDueAt!).sort((a, b) => +a - +b)[0] ?? null;
  const delivered = delivery.filter((d) => d.status === 'DELIVERED' || d.status === 'EMPTY_RETURNED').length;
  const undeliveredFree = conts.filter((ct) => !delivery.find((d) => d.containerId === ct.id && d.completedAt) && ct.freeTimeExpiresAt).map((ct) => ct.freeTimeExpiresAt!).sort()[0] ?? null;
  const row = {
    jobId, tenantId: j.tenantId, jobNo: j.jobNo, blNo: j.blNo, customerId: j.customerId, customerName: cust?.name ?? '—',
    phase: deriveJobPhase({ closed: j.status === 'CLOSED', jobStages, containerDelivery: delivery.map((d) => d.status) }),
    eta: j.eta, priority: j.priority, coordinatorId: j.coordinatorId, coordinatorName: coord?.name ?? null,
    containersTotal: conts.length, containersDelivered: delivered, stages: jobStages,
    nextSlaDueAt: j.status === 'CLOSED' ? null : nextDue, overdue: j.status !== 'CLOSED' && !!nextDue && nextDue.getTime() < Date.now(),
    freeTimeNext: j.status === 'CLOSED' ? null : undeliveredFree, updatedAt: new Date(),
  };
  await tx.insert(jobBoard).values(row).onConflictDoUpdate({ target: jobBoard.jobId, set: row });
}

export const jobBoardProjector: Consumer = {
  name: 'insight.job-board',
  handles: '*',
  async handle(event, tx) {
    const jobId = (event.payload as { jobId?: string }).jobId ?? (event.aggregateType === 'job' ? event.aggregateId : undefined);
    if (jobId) await projectJob(tx, jobId);
  },
};
