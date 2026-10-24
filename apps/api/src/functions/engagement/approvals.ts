import { eq } from 'drizzle-orm';
import type { Tx } from '../../lib/db';
import { stageInstance } from '../../lib/schema';
import { transitionStage } from '../workflow/stages';
import { recordDecision, type ApprovalRow } from './service';

/**
 * The customer's answer moves "Customer confirmation": approved → Confirmed, disputed → back to Pending.
 * Kept apart from service.ts so the workflow can call the engagement service without an import cycle.
 */
export async function decideApproval(tx: Tx, a: ApprovalRow, decision: 'APPROVED' | 'REJECTED', by: string, note?: string) {
  await recordDecision(tx, a, decision, by, note);
  const [inst] = await tx.select().from(stageInstance).where(eq(stageInstance.id, a.stageInstanceId));
  if (inst?.status !== 'SENT') return;
  await transitionStage(tx, `${by} (customer)`, {
    jobId: a.jobId,
    stageInstanceId: inst.id,
    input: { to: decision === 'APPROVED' ? 'CONFIRMED' : 'PENDING', fields: {}, remarks: note ?? (decision === 'APPROVED' ? 'Approved by customer' : 'Disputed by customer'), disbursements: [] },
  });
}
