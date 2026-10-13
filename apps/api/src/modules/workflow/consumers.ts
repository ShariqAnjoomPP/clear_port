import { and, eq } from 'drizzle-orm';
import type { Consumer } from '../../shared/bus';
import { systemActor } from '../../shared/context';
import { stageInstance } from '../../shared/schema';
import { transitionStage } from './service';

/** Customer approval (portal or one-tap link) moves "Customer confirmation" without the engagement context importing workflow. */
export const approvalToWorkflow: Consumer = {
  name: 'workflow.approval',
  handles: ['CustomerApprovalDecided'],
  async handle(event, tx, uow) {
    const p = event.payload as { jobId: string; stageInstanceId: string; decision: 'APPROVED' | 'REJECTED'; decidedBy: string; note?: string };
    const [inst] = await tx.select().from(stageInstance).where(and(eq(stageInstance.id, p.stageInstanceId), eq(stageInstance.jobId, p.jobId)));
    if (!inst || inst.status !== 'SENT') return;
    const actor = { ...systemActor(event.tenantId), name: `${p.decidedBy} (customer)` };
    await transitionStage(tx, uow, actor, undefined, {
      jobId: p.jobId,
      stageInstanceId: inst.id,
      skipPermission: true,
      input: { to: p.decision === 'APPROVED' ? 'CONFIRMED' : 'PENDING', fields: {}, remarks: p.note ?? (p.decision === 'APPROVED' ? 'Approved by customer' : 'Disputed by customer'), disbursements: [] },
    });
  },
};
