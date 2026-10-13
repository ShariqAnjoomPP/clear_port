import { and, eq, inArray } from 'drizzle-orm';
import { AssignInput, TransitionInput } from '@clearport/contracts';
import { describeNextSteps, stageDef } from '@clearport/workflow';
import { withTenant } from '../../shared/db';
import { ifMatchVersion, parseBody, protectedRouter } from '../../shared/http';
import { hasPermission } from '../../shared/policy';
import { container, customer, job } from '../../shared/schema';
import { requireJob } from '../clearance/public';
import { getWorkflow } from '../platform/public';
import { assignStage, guardContext, myTasks, stageView, transitionStage } from './service';

export function workflowRoutes() {
  const r = protectedRouter();

  r.get('/jobs/:jobId/stages', async (c) => {
    const actor = c.get('actor');
    return c.json(await withTenant(actor, async (tx) => stageView(tx, actor, await requireJob(tx, c.req.param('jobId')))));
  });

  r.post('/jobs/:jobId/stages/:stageId/transitions', async (c) => {
    const actor = c.get('actor');
    const input = await parseBody(c, TransitionInput);
    const result = await withTenant(actor, async (tx, uow) => {
      await transitionStage(tx, uow, actor, c.get('meta'), { jobId: c.req.param('jobId'), stageInstanceId: c.req.param('stageId'), input, expectedVersion: ifMatchVersion(c) });
      return stageView(tx, actor, await requireJob(tx, c.req.param('jobId')));
    });
    return c.json(result);
  });

  r.put('/jobs/:jobId/stages/:stageId/assignee', async (c) => {
    const actor = c.get('actor');
    const { assigneeId } = await parseBody(c, AssignInput);
    const result = await withTenant(actor, async (tx, uow) => {
      await assignStage(tx, uow, actor, c.get('meta'), c.req.param('jobId'), c.req.param('stageId'), assigneeId);
      return stageView(tx, actor, await requireJob(tx, c.req.param('jobId')));
    });
    return c.json(result);
  });

  r.get('/tasks', async (c) => {
    const actor = c.get('actor');
    const items = await withTenant(actor, async (tx) => {
      const res = await myTasks(tx, actor);
      if (Array.isArray(res) || !res.rows.length) return [];
      const jobIds = [...new Set(res.rows.map((r) => r.jobId))];
      const jobs = await tx.select({ id: job.id, jobNo: job.jobNo, blNo: job.blNo, status: job.status, wfv: job.workflowVersion, customerName: customer.name, eta: job.eta, priority: job.priority })
        .from(job).innerJoin(customer, eq(customer.id, job.customerId)).where(inArray(job.id, jobIds));
      const jobMap = new Map(jobs.map((j) => [j.id, j]));
      const cIds = res.rows.map((r) => r.containerId).filter((x): x is string => !!x);
      const containers = cIds.length ? await tx.select({ id: container.id, no: container.containerNo }).from(container).where(inArray(container.id, cIds)) : [];
      const cMap = new Map(containers.map((x) => [x.id, x.no]));
      const now = Date.now();
      const out = [];
      for (const s of res.rows) {
        const j = jobMap.get(s.jobId);
        if (!j || j.status !== 'OPEN') continue;
        const wf = await getWorkflow(tx, actor.tenantId, j.wfv);
        const def = stageDef(wf, s.stageKey);
        if (!def) continue;
        const steps = hasPermission(actor, `stage.${s.stageKey}.update`) ? describeNextSteps(wf, s.stageKey, s.status, guardContext(res.all.filter((x) => x.jobId === s.jobId), s)) : [];
        out.push({
          stageInstanceId: s.id, jobId: s.jobId, jobNo: j.jobNo, blNo: j.blNo, customerName: j.customerName, priority: j.priority, eta: j.eta,
          containerId: s.containerId, containerNo: s.containerId ? cMap.get(s.containerId) ?? null : null,
          stageKey: s.stageKey, stageLabel: def.label, ownerRole: def.ownerRole, status: s.status,
          statusLabel: def.statuses.find((x) => x.key === s.status)?.label, fields: def.fields ?? [], data: s.data, version: s.version,
          slaDueAt: s.slaDueAt, overdue: !!s.slaDueAt && s.slaDueAt.getTime() < now, nextSteps: steps,
        });
      }
      const rank = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 } as Record<string, number>;
      return out.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (rank[a.priority]! - rank[b.priority]!) || String(a.slaDueAt ?? '9').localeCompare(String(b.slaDueAt ?? '9')));
    });
    return c.json({ items });
  });

  void and;
  return r;
}
