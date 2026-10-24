import { and, eq, inArray } from 'drizzle-orm';
import type { TransitionInput } from '@clearport/contracts';
import { uuidv7 } from '@clearport/kernel';
import {
  containerStages as containerStageDefs, describeNextSteps, initialContainerStatus, isDone, jobStages as jobStageDefs, planTransition, stageDef,
  type GuardContext, type StageState, type TransitionError, type WorkflowDefinition,
} from '@clearport/workflow';
import type { Q, Tx } from '../../lib/db';
import { ApiError, conflict, notFound, unprocessable } from '../../lib/errors';
import { container, customer, job, stageEvent, stageInstance, staff } from '../../lib/schema';
import { notifyStaff, onStageChanged } from '../engagement/service';
import { syncTripStatus } from '../fieldops/progress';
import { recordDisbursements } from '../finance/service';
import { documentTypesOnJob, getContainers, requireJob, touchJob, type JobRow } from '../jobs/queries';
import { getStaff, workflowRules } from '../settings/service';
import { getWorkflow } from './service';

type StageRow = typeof stageInstance.$inferSelect;

const hours = (h: number | undefined) => (h ? new Date(Date.now() + h * 3600_000) : null);

function toState(rows: StageRow[]): Record<string, StageState> {
  return Object.fromEntries(rows.map((r) => [r.stageKey, { status: r.status, assigneeId: r.assigneeStaffId }]));
}

/**
 * What the workflow engine sees when checking a step's gates. With per-step assignment switched off
 * (one person does everything) the "an assignee is required" gate is always met.
 */
export function guardContext(all: StageRow[], inst: StageRow, assignSteps = true): GuardContext {
  return {
    jobStages: toState(all.filter((s) => !s.containerId)),
    containerStages: inst.containerId ? toState(all.filter((s) => s.containerId === inst.containerId)) : undefined,
    self: { status: inst.status, assigneeId: inst.assigneeStaffId ?? (assignSteps ? null : 'not-required') },
  };
}

type Rules = { assignSteps: boolean; sequential: boolean };

/**
 * Steps one by one: the earliest step before this one (job steps by order, or the same container's steps)
 * that is not complete yet. Container steps only exist once the CCRO is issued, so job steps never block them.
 */
export function blockedBy(wf: WorkflowDefinition, all: StageRow[], inst: StageRow): string | null {
  const order = (s: StageRow) => stageDef(wf, s.stageKey)?.order ?? 0;
  const first = all
    .filter((s) => (s.containerId ?? null) === (inst.containerId ?? null) && !s.completedAt && order(s) < order(inst))
    .sort((a, b) => order(a) - order(b))[0];
  return first ? `Finish “${stageDef(wf, first.stageKey)?.label.en ?? first.stageKey}” first` : null;
}

/** A step's next moves with every rule applied: the workflow's gates, the assignee rule, and the one-by-one order. */
export function nextStepsFor(wf: WorkflowDefinition, all: StageRow[], inst: StageRow, rules: Rules) {
  const steps = describeNextSteps(wf, inst.stageKey, inst.status, guardContext(all, inst, rules.assignSteps));
  const block = rules.sequential ? blockedBy(wf, all, inst) : null;
  return block ? steps.map((st) => ({ ...st, gateOpen: false, waitingFor: [block] })) : steps;
}

function toProblem(e: TransitionError): ApiError {
  switch (e.code) {
    case 'GATE_NOT_MET':
      return conflict('This step is waiting for other stages', e.unmet.map((u) => ({ code: u.code, message: u.message })));
    case 'MISSING_FIELDS':
      return unprocessable('Required information is missing', e.fields.map((f) => ({ path: `fields.${f}`, code: 'required', message: `${f} is required` })));
    case 'MISSING_DOCUMENT': {
      // Plain words for people; the document type stays machine-readable in `path` for the app.
      const name = e.documentType.replace(/_/g, ' ').toLowerCase();
      return unprocessable(`Upload a ${name} first`, [{ code: 'document', path: e.documentType, message: `This step needs the ${name} attached to the job` }]);
    }
    case 'INVALID_TRANSITION':
      return conflict(`Cannot move from ${e.from} to ${e.to}`, e.allowed.map((a) => ({ code: 'allowed', message: a })));
    case 'UNKNOWN_STAGE':
      return notFound('Stage');
  }
}

/** Creates the job-level stages for a new job. The Documents stage starts its SLA clock straight away. */
export async function createJobStages(tx: Tx, jobId: string, wf: WorkflowDefinition) {
  const now = new Date();
  await tx.insert(stageInstance).values(
    jobStageDefs(wf).map((d) => ({
      id: uuidv7(), jobId, containerId: null, stageKey: d.key, status: d.initial, data: {},
      startedAt: d.key === 'DOCUMENTS' ? now : null,
      slaDueAt: d.key === 'DOCUMENTS' ? hours(d.slaHours) : null,
    })),
  );
}

/** After CCRO is issued every container gets its own execution stages. Safe to call again (adds only missing rows). */
export async function spawnContainerStages(tx: Tx, j: JobRow, wf: WorkflowDefinition) {
  const all = await tx.select().from(stageInstance).where(eq(stageInstance.jobId, j.id));
  const ccro = all.find((s) => s.stageKey === 'CCRO' && !s.containerId);
  if (ccro?.status !== 'ISSUED') return 0;
  const inspection = all.find((s) => s.stageKey === 'INSPECTION' && !s.containerId);
  const selected = (inspection?.data.selectedContainerIds as string[] | undefined) ?? [];
  const containers = (await getContainers(tx, j.id)).filter((c) => c.active);
  const existing = new Set(all.filter((s) => s.containerId).map((s) => `${s.containerId}:${s.stageKey}`));
  const now = new Date();
  const rows = containers.flatMap((c) =>
    containerStageDefs(wf)
      .filter((d) => !existing.has(`${c.id}:${d.key}`))
      .map((d) => {
        const status = initialContainerStatus(d, c.id, selected);
        const done = isDone(d, status);
        return {
          id: uuidv7(), jobId: j.id, containerId: c.id, stageKey: d.key, status, data: {},
          startedAt: d.key === 'TRUCK' || done ? now : null,
          completedAt: done ? now : null,
          slaDueAt: d.key === 'TRUCK' ? hours(d.slaHours) : null,
        };
      }),
  );
  if (rows.length) await tx.insert(stageInstance).values(rows).onConflictDoNothing();
  return rows.length;
}

/** The SLA clock starts when a stage becomes actionable (its first step's gate opens), not when the job is created. */
async function activateReadyStages(tx: Tx, wf: WorkflowDefinition, jobId: string) {
  const all = await tx.select().from(stageInstance).where(eq(stageInstance.jobId, jobId));
  const { sequential } = await workflowRules(tx);
  const now = new Date();
  for (const s of all) {
    if (s.startedAt || s.completedAt) continue;
    const def = stageDef(wf, s.stageKey);
    if (!def || s.status !== def.initial) continue;
    // A stage is "ready" once its gates (other than having an assignee) and its place in the order allow it.
    const steps = nextStepsFor(wf, all, s, { assignSteps: false, sequential });
    if (steps.some((st) => st.gateOpen)) {
      await tx.update(stageInstance).set({ startedAt: now, slaDueAt: hours(def.slaHours) }).where(eq(stageInstance.id, s.id));
    }
  }
}

export interface TransitionParams {
  jobId: string;
  stageInstanceId: string;
  input: TransitionInput;
}

/** Command: move one stage to a new status, after the workflow engine has checked every rule. */
export async function transitionStage(tx: Tx, actorName: string, p: TransitionParams) {
  const j = await requireJob(tx, p.jobId);
  if (j.status === 'CLOSED') throw conflict('This job is closed');
  const wf = await getWorkflow(tx, j.workflowVersion);
  const all = await tx.select().from(stageInstance).where(eq(stageInstance.jobId, j.id));
  const inst = all.find((s) => s.id === p.stageInstanceId);
  if (!inst) throw notFound('Stage');

  const rules = await workflowRules(tx);
  const block = rules.sequential ? blockedBy(wf, all, inst) : null;
  if (block) throw conflict('Steps are done one by one', [{ code: 'ORDER', message: block }]);

  const plan = planTransition(wf, {
    stageKey: inst.stageKey,
    currentStatus: inst.status,
    to: p.input.to,
    fields: p.input.fields,
    storedData: inst.data,
    documentTypesOnJob: await documentTypesOnJob(tx, j.id),
    ctx: guardContext(all, inst, rules.assignSteps),
  });
  if (!plan.ok) throw toProblem(plan.error);
  const { to, from, done, data, actions, stage } = plan.value;

  if (stage.key === 'INSPECTION' && Array.isArray(data.selectedContainerIds)) {
    const ids = new Set((await getContainers(tx, j.id)).map((c) => c.id));
    if (!(data.selectedContainerIds as string[]).every((id) => ids.has(id))) throw unprocessable('Selected containers must belong to this job');
  }

  const now = new Date();
  const [updated] = await tx
    .update(stageInstance)
    .set({
      status: to,
      data,
      referenceNo: typeof data.referenceNo === 'string' ? data.referenceNo : inst.referenceNo,
      startedAt: inst.startedAt ?? now,
      completedAt: done ? now : null,
      // A finished stage keeps its due time so reports can tell on-time from late; overdue checks look at completed_at.
      slaDueAt: done ? inst.slaDueAt : hours(stage.slaHours),
      updatedAt: now,
    })
    .where(eq(stageInstance.id, inst.id))
    .returning();

  // The signature image is kept on the stage, not repeated in the history.
  const eventData = Object.fromEntries(Object.entries(p.input.fields).map(([k, v]) => [k, k === 'podSignature' ? '[signature captured]' : v]));
  await tx.insert(stageEvent).values({
    id: uuidv7(), jobId: j.id, containerId: inst.containerId, stageInstanceId: inst.id, stageKey: inst.stageKey,
    fromStatus: from, toStatus: to, actorName, remarks: p.input.remarks ?? null, data: eventData,
  });

  // Money paid at this step (duty with the Bayan, line charges with the DO…) is recorded in the same transaction.
  await recordDisbursements(tx, actorName, { jobId: j.id, stageInstanceId: inst.id, stageKey: inst.stageKey }, p.input.disbursements);

  if (actions.includes('SPAWN_CONTAINER_STAGES')) await spawnContainerStages(tx, j, wf);
  // Approval links, customer messages and staff alerts (REQUEST_CUSTOMER_APPROVAL, NOTIFY_CUSTOMER:*, CHECK_JOB_COMPLETE…).
  await onStageChanged(tx, { job: j, stageKey: stage.key, stageLabel: stage.label.en, containerId: inst.containerId, from, to, data, actions, stageInstanceId: inst.id });
  await activateReadyStages(tx, wf, j.id);
  if (inst.containerId) await syncTripStatus(tx, inst.containerId);
  await touchJob(tx, j.id);
  return updated!;
}

/** Assign a staff member (PRO, inspector, driver…) to a stage, or clear the assignment with null. */
export async function assignStage(tx: Tx, jobId: string, stageInstanceId: string, staffId: string | null) {
  const j = await requireJob(tx, jobId);
  if (j.status === 'CLOSED') throw conflict('This job is closed');
  const [inst] = await tx.select().from(stageInstance).where(and(eq(stageInstance.id, stageInstanceId), eq(stageInstance.jobId, jobId)));
  if (!inst) throw notFound('Stage');
  const person = staffId ? await getStaff(tx, staffId) : undefined;
  if (staffId && !person?.active) throw unprocessable('Assignee must be an active staff member');
  await tx.update(stageInstance).set({ assigneeStaffId: staffId, updatedAt: new Date() }).where(eq(stageInstance.id, inst.id));
  const wf = await getWorkflow(tx, j.workflowVersion);
  if (person) await notifyStaff(tx, { jobId: j.id, template: 'STAGE_ASSIGNED', vars: { stage: stageDef(wf, inst.stageKey)?.label.en ?? inst.stageKey, person: person.name, blNo: j.blNo, jobNo: j.jobNo } });
  await activateReadyStages(tx, wf, j.id);
  await touchJob(tx, j.id);
}

async function staffNames(q: Q, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map<string, { id: string; name: string; role: string }>();
  const rows = await q.select({ id: staff.id, name: staff.name, role: staff.role }).from(staff).where(inArray(staff.id, unique));
  return new Map(rows.map((r) => [r.id, r]));
}

/** Read model for the job screen: every stage with labels, assignee, SLA and next steps (with "waiting for"). */
export async function stageView(q: Q, j: JobRow) {
  const wf = await getWorkflow(q, j.workflowVersion);
  const all = await q.select().from(stageInstance).where(eq(stageInstance.jobId, j.id));
  const people = await staffNames(q, all.map((s) => s.assigneeStaffId));
  const rules = await workflowRules(q);
  const now = Date.now();
  const view = (s: StageRow) => {
    const def = stageDef(wf, s.stageKey)!;
    const status = def.statuses.find((x) => x.key === s.status);
    return {
      id: s.id, key: s.stageKey, level: def.level, order: def.order, phase: def.phase, label: def.label, ownerRole: def.ownerRole,
      status: s.status, statusLabel: status?.label ?? { en: s.status, ar: s.status }, done: !!status?.done,
      statuses: def.statuses, fields: def.fields ?? [],
      assignee: s.assigneeStaffId ? people.get(s.assigneeStaffId) ?? null : null,
      referenceNo: s.referenceNo, data: s.data,
      startedAt: s.startedAt, completedAt: s.completedAt, slaDueAt: s.slaDueAt,
      overdue: !!s.slaDueAt && !s.completedAt && s.slaDueAt.getTime() < now,
      nextSteps: j.status === 'OPEN' ? nextStepsFor(wf, all, s, rules) : [],
    };
  };
  const jobLevel = all.filter((s) => !s.containerId).map(view).sort((a, b) => a.order - b.order);
  const byContainer: Record<string, ReturnType<typeof view>[]> = {};
  for (const s of all.filter((x) => x.containerId)) (byContainer[s.containerId!] ??= []).push(view(s));
  for (const k of Object.keys(byContainer)) byContainer[k]!.sort((a, b) => a.order - b.order);
  return { workflowVersion: wf.version, jobStages: jobLevel, containerStages: byContainer };
}

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

/**
 * Task list: ONE task per open job, its current step (the same step the job page's roadmap marks "Current").
 * That is the earliest unfinished step that can be worked on now (job steps in order, then each container's steps);
 * if none can, the earliest unfinished step, showing what it waits for. The next step appears once this one is done.
 * Optionally only tasks assigned to one staff member, or 'unassigned'.
 */
export async function listTasks(q: Q, filter: { staffId?: string | 'unassigned' }) {
  const jobs = await q
    .select({ id: job.id, jobNo: job.jobNo, blNo: job.blNo, wfv: job.workflowVersion, priority: job.priority, eta: job.eta, customerName: customer.name })
    .from(job).innerJoin(customer, eq(customer.id, job.customerId)).where(eq(job.status, 'OPEN'));
  if (!jobs.length) return [];
  const jobIds = jobs.map((j) => j.id);
  const [all, conts] = await Promise.all([
    q.select().from(stageInstance).where(inArray(stageInstance.jobId, jobIds)),
    q.select({ id: container.id, no: container.containerNo }).from(container).where(inArray(container.jobId, jobIds)),
  ]);
  const containerNo = new Map(conts.map((x) => [x.id, x.no]));
  const rules = await workflowRules(q);
  const now = Date.now();

  const picked = [];
  for (const j of jobs) {
    const wf = await getWorkflow(q, j.wfv);
    const mine = all.filter((x) => x.jobId === j.id);
    const order = (s: StageRow) => stageDef(wf, s.stageKey)?.order ?? 99;
    const candidates = mine
      .filter((s) => !s.completedAt)
      .sort((a, b) =>
        Number(!!a.containerId) - Number(!!b.containerId) ||
        String(containerNo.get(a.containerId ?? '') ?? '').localeCompare(String(containerNo.get(b.containerId ?? '') ?? '')) ||
        order(a) - order(b))
      .map((s) => ({ s, steps: nextStepsFor(wf, mine, s, rules) }));
    const current = candidates.find((c) => c.steps.some((n) => n.gateOpen)) ?? candidates[0];
    if (current) picked.push({ j, wf, ...current });
  }

  const visible = picked.filter(({ s }) => filter.staffId === 'unassigned' ? !s.assigneeStaffId : filter.staffId ? s.assigneeStaffId === filter.staffId : true);
  const people = await staffNames(q, visible.map(({ s }) => s.assigneeStaffId));
  const items = visible.map(({ j, wf, s, steps }) => {
    const def = stageDef(wf, s.stageKey)!;
    return {
      stageInstanceId: s.id, jobId: s.jobId, jobNo: j.jobNo, blNo: j.blNo, customerName: j.customerName, priority: j.priority, eta: j.eta,
      containerId: s.containerId, containerNo: s.containerId ? containerNo.get(s.containerId) ?? null : null,
      stageKey: s.stageKey, stageLabel: def.label, ownerRole: def.ownerRole, status: s.status,
      statusLabel: def.statuses.find((x) => x.key === s.status)?.label, fields: def.fields ?? [], data: s.data,
      assignee: s.assigneeStaffId ? people.get(s.assigneeStaffId) ?? null : null,
      slaDueAt: s.slaDueAt, overdue: !!s.slaDueAt && s.slaDueAt.getTime() < now,
      nextSteps: steps,
    };
  });
  return items.sort((a, b) =>
    Number(b.overdue) - Number(a.overdue) ||
    (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
    String(a.slaDueAt?.toISOString() ?? '9').localeCompare(String(b.slaDueAt?.toISOString() ?? '9')),
  );
}
