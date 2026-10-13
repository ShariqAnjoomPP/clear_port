import { and, gte, isNotNull, isNull, lt } from 'drizzle-orm';
import { definerQuery, withTenant } from '../shared/db';
import { makeEvent } from '../shared/events';
import { sql } from 'drizzle-orm';
import { stageInstance } from '../shared/schema';

/**
 * Timers. Production: EventBridge Scheduler one-off schedules per SLA / free-time date (created by the timer consumer).
 * Local and fallback: a periodic scan with a moving window, so each breach fires once.
 */
let lastSlaScan = new Date(Date.now() - 10 * 60_000);

async function tenants() {
  return (await definerQuery<{ all_tenant_ids: string }>('select platform.all_tenant_ids()', [])).map((r) => r.all_tenant_ids);
}

export async function scanSlaBreaches() {
  const from = lastSlaScan;
  const to = new Date();
  lastSlaScan = to;
  let n = 0;
  for (const tenantId of await tenants()) {
    await withTenant({ tenantId, customerId: null }, async (tx, uow) => {
      const due = await tx.select().from(stageInstance).where(and(isNull(stageInstance.completedAt), isNotNull(stageInstance.slaDueAt), gte(stageInstance.slaDueAt, from), lt(stageInstance.slaDueAt, to)));
      for (const s of due) {
        uow.emit(makeEvent(tenantId, 'SlaBreached', 'job', s.jobId, { jobId: s.jobId, stageKey: s.stageKey, assigneeId: s.assigneeId, containerId: s.containerId, dedupe: `${s.id}:${s.slaDueAt!.toISOString()}` }));
        n++;
      }
    });
  }
  return n;
}

/** Free-time guard (BRD section 9): alerts at T-3, T-1 and on the expiry day for containers not yet out of the port. */
export async function scanFreeTime() {
  let n = 0;
  for (const tenantId of await tenants()) {
    await withTenant({ tenantId, customerId: null }, async (tx, uow) => {
      const rows = await tx.execute<{ id: string; container_no: string; job_id: string; free_time_expires_at: string; days_left: number }>(sql`
        select ct.id, ct.container_no, ct.job_id, ct.free_time_expires_at::text, (ct.free_time_expires_at - current_date) days_left
        from clearance.container ct
        where ct.active and ct.free_time_expires_at - current_date in (3, 1, 0)
          and not exists (select 1 from workflow.stage_instance si where si.container_id = ct.id and si.stage_key = 'RELEASE' and si.status = 'GATED_OUT')`);
      for (const r of rows.rows) {
        const when = r.days_left === 0 ? 'today' : r.days_left === 1 ? 'tomorrow' : `in ${r.days_left} days`;
        uow.emit(makeEvent(tenantId, 'FreeTimeExpiring', 'container', r.id, { jobId: r.job_id, containerNo: r.container_no, date: r.free_time_expires_at, when, dedupe: `${r.id}:${r.free_time_expires_at}:${r.days_left}` }));
        n++;
      }
    });
  }
  return n;
}
