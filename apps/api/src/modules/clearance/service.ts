import { eq } from 'drizzle-orm';
import { isDone, stageDef } from '@clearport/workflow';
import { audit } from '../../shared/audit';
import type { Actor, RequestMeta } from '../../shared/context';
import type { Tx, UnitOfWork } from '../../shared/db';
import { makeEvent } from '../../shared/events';
import { conflict } from '../../shared/problem';
import { container, job, stageInstance } from '../../shared/schema';
import { jobFinanceSummary } from '../finance/public';
import { getWorkflow } from '../platform/public';
import { requireJob } from './public';

/** DEL-004: closure is a guarded command — every container delivered, every payment reconciled. Lists all blockers. */
export async function closeJob(tx: Tx, uow: UnitOfWork, actor: Actor, meta: RequestMeta | undefined, jobId: string) {
    const j = await requireJob(tx, jobId);
    if (j.status === 'CLOSED') throw conflict('Already closed');
    const wf = await getWorkflow(tx, j.tenantId, j.workflowVersion);
    const stages = await tx.select().from(stageInstance).where(eq(stageInstance.jobId, j.id));
    const conts = await tx.select().from(container).where(eq(container.jobId, j.id));
    const blockers: { code: string; message: string }[] = [];
    const ccro = stages.find((s) => s.stageKey === 'CCRO' && !s.containerId);
    if (ccro?.status !== 'ISSUED') blockers.push({ code: 'CCRO', message: 'CCRO is not issued' });
    const deliveryDef = stageDef(wf, 'DELIVERY')!;
    for (const ct of conts) {
      const d = stages.find((s) => s.containerId === ct.id && s.stageKey === 'DELIVERY');
      if (!d || !isDone(deliveryDef, d.status)) blockers.push({ code: 'CONTAINER', message: `${ct.containerNo} is not delivered` });
    }
    const unreconciled = (await jobFinanceSummary(tx, j.id)).reduce((n, s) => n + Number(s.unreconciled), 0);
    if (unreconciled) blockers.push({ code: 'PAYMENTS', message: `${unreconciled} payment(s) are not reconciled` });
    if (blockers.length) throw conflict('This job cannot be closed yet', blockers);
    const [after] = await tx.update(job).set({ status: 'CLOSED', closedAt: new Date(), updatedAt: new Date(), version: j.version + 1 }).where(eq(job.id, j.id)).returning();
    await tx.update(container).set({ active: false }).where(eq(container.jobId, j.id));
    uow.emit(makeEvent(actor.tenantId, 'JobClosed', 'job', j.id, { jobId: j.id, jobNo: j.jobNo }));
    await audit(tx, actor, meta, { action: 'job.closed', entityType: 'job', entityId: j.id });
    return after;
}
