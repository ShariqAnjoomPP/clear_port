import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { TransitionInput } from '@clearport/contracts';
import { uuidv7 } from '@clearport/kernel';
import {
  containerStages as containerStageDefs, describeNextSteps, initialContainerStatus, isDone, jobStages as jobStageDefs, planTransition, stageDef,
  type GuardContext, type StageState, type TransitionError, type WorkflowDefinition,
} from '@clearport/workflow';
import { audit } from '../../shared/audit';
import type { Actor, RequestMeta } from '../../shared/context';
import type { Tx, UnitOfWork } from '../../shared/db';
import { makeEvent } from '../../shared/events';
import { hasPermission, requirePermission } from '../../shared/policy';
import { ApiError, conflict, forbidden, notFound, preconditionFailed, unprocessable } from '../../shared/problem';
import { stageEvent, stageInstance } from '../../shared/schema';
import { documentTypesOnJob, getContainers, requireJob } from '../clearance/public';
import { requestCustomerApproval } from '../engagement/public';
import { recordDisbursements } from '../finance/public';
import { getUser, getUsers, getWorkflow } from '../platform/public';

type StageRow = typeof stageInstance.$inferSelect;
type JobRow = Awaited<ReturnType<typeof requireJob>>;

const hours = (h: number | undefined) => (h ? new Date(Date.now() + h * 3600_000) : null);

function toState(rows: StageRow[]): Record<string, StageState> {
  return Object.fromEntries(rows.map((r) => [r.stageKey, { status: r.status, assigneeId: r.assigneeId }]));
}

function guardContext(all: StageRow[], inst: StageRow): GuardContext {
  return {
    jobStages: toState(all.filter((s) => !s.containerId)),
    containerStages: inst.containerId ? toState(all.filter((s) => s.containerId === inst.containerId)) : undefined,
    self: { status: inst.status, assigneeId: inst.assigneeId },
  };
}

function toProblem(e: TransitionError): ApiError {
  switch (e.code) {
    case 'GATE_NOT_MET':
      return conflict('This step is waiting for other stages', e.unmet.map((u) => ({ code: u.code, message: u.message })));
    case 'MISSING_FIELDS':
      return unprocessable('Required information is missing', e.fields.map((f) => ({ path: `fields.${f}`, code: 'required', message: `${f} is required` })));
    case 'MISSING_DOCUMENT':
      return unprocessable(`Upload a ${e.documentType.replace(/_/g, ' ').toLowerCase()} first`, [{ code: 'document', message: e.documentType }]);
    case 'INVALID_TRANSITION':
      return conflict(`Cannot move from ${e.from} to ${e.to}`, e.allowed.map((a) => ({ code: 'allowed', message: a })));
    case 'UNKNOWN_STAGE':
      return notFound('Stage');
  }
}

/** Creates the job-level stages for a new BL (Factory step of job intake). */
export async function createJobStages(tx: Tx, tenantId: string, jobId: string, wf: WorkflowDefinition) {
  const now = new Date();
  await tx.insert(stageInstance).values(
    jobStageDefs(wf).map((d) => ({
      id: uuidv7(), tenantId, jobId, containerId: null, stageKey: d.key, status: d.initial, data: {},
      startedAt: d.key === 'DOCUMENTS' ? now : null,
      slaDueAt: d.key === 'DOCUMENTS' ? hours(d.slaHours) : null,
    })),
  );
}

/** After CCRO is issued, every container gets its own execution stages (BRD: "container based process"). */
export async function spawnContainerStages(tx: Tx, uow: UnitOfWork, job: JobRow, wf: WorkflowDefinition) {
  const all = await tx.select().from(stageInstance).where(eq(stageInstance.jobId, job.id));
  const ccro = all.find((s) => s.stageKey === 'CCRO' && !s.containerId);
  if (ccro?.status !== 'ISSUED') return 0;
  const inspection = all.find((s) => s.stageKey === 'INSPECTION' && !s.containerId);
  const selected = (inspection?.data.selectedContainerIds as string[] | undefined) ?? [];
  const containers = (await getContainers(tx, job.id)).filter((c) => c.active);
  const existing = new Set(all.filter((s) => s.containerId).map((s) => `${s.containerId}:${s.stageKey}`));
  const now = new Date();
  const rows = containers.flatMap((c) =>
    containerStageDefs(wf)
      .filter((d) => !existing.has(`${c.id}:${d.key}`))
      .map((d) => {
        const status = initialContainerStatus(d, c.id, selected);
        const done = isDone(d, status);
        return {
          id: uuidv7(), tenantId: job.tenantId, jobId: job.id, containerId: c.id, stageKey: d.key, status, data: {},
          startedAt: d.key === 'TRUCK' || done ? now : null,
          completedAt: done ? now : null,
          slaDueAt: d.key === 'TRUCK' ? hours(d.slaHours) : null,
        };
      }),
  );
  if (rows.length) {
    await tx.insert(stageInstance).values(rows).onConflictDoNothing();
    uow.emit(makeEvent(job.tenantId, 'ContainerStagesSpawned', 'job', job.id, { jobId: job.id, count: rows.length }));
  }
  return rows.length;
}

/** SLA clock starts when a stage becomes actionable (its first step's gate opens), not when the job is created. */
async function activateReadyStages(tx: Tx, wf: WorkflowDefinition, jobId: string) {
  const all = await tx.select().from(stageInstance).where(eq(stageInstance.jobId, jobId));
  const now = new Date();
  for (const s of all) {
    if (s.startedAt || s.completedAt) continue;
    const def = stageDef(wf, s.stageKey);
    if (!def || s.status !== def.initial) continue;
    const steps = describeNextSteps(wf, s.stageKey, s.status, { ...guardContext(all, s), self: { status: s.status, assigneeId: 'gate-preview' } });
    if (steps.some((st) => st.gateOpen)) {
      await tx.update(stageInstance).set({ startedAt: now, slaDueAt: hours(def.slaHours) }).where(eq(stageInstance.id, s.id));
    }
  }
}

const isSupervisor = (a: Actor) => a.kind === 'system' || a.roles.some((r) => r === 'OWNER' || r === 'COORDINATOR');

export interface TransitionParams {
  jobId: string;
  stageInstanceId: string;
  input: TransitionInput;
  expectedVersion?: number;
  /** Driver trip links and system consumers are authorised by their own token/rules. */
  skipPermission?: boolean;
}

/** Command handler: move one stage to a new status (BAY-002, DO-002, CCR-001/002, PHY-001, DEL-001…). */
export async function transitionStage(tx: Tx, uow: UnitOfWork, actor: Actor, meta: RequestMeta | undefined, p: TransitionParams) {
  const job = await requireJob(tx, p.jobId);
  if (job.status === 'CLOSED') throw conflict('This job is closed');
  const wf = await getWorkflow(tx, job.tenantId, job.workflowVersion);
  const all = await tx.select().from(stageInstance).where(eq(stageInstance.jobId, job.id));
  const inst = all.find((s) => s.id === p.stageInstanceId);
  if (!inst) throw notFound('Stage');

  if (!p.skipPermission) {
    requirePermission(actor, `stage.${inst.stageKey}.update`);
    // ABAC: field staff may only update stages assigned to them (or unassigned ones in their remit).
    if (!isSupervisor(actor) && inst.assigneeId && inst.assigneeId !== actor.userId) throw forbidden('This stage is assigned to someone else');
  }
  if (p.expectedVersion !== undefined && p.expectedVersion !== inst.version) throw preconditionFailed();

  const plan = planTransition(wf, {
    stageKey: inst.stageKey,
    currentStatus: inst.status,
    to: p.input.to,
    fields: p.input.fields,
    storedData: inst.data,
    documentTypesOnJob: await documentTypesOnJob(tx, job.id),
    ctx: guardContext(all, inst),
  });
  if (!plan.ok) throw toProblem(plan.error);
  const { to, from, done, data, actions, stage } = plan.value;

  if (stage.key === 'INSPECTION' && Array.isArray(data.selectedContainerIds)) {
    const ids = new Set((await getContainers(tx, job.id)).map((c) => c.id));
    if (!(data.selectedContainerIds as string[]).every((id) => ids.has(id))) throw unprocessable('Selected containers must belong to this job');
  }

  const now = new Date();
  const updated = await tx
    .update(stageInstance)
    .set({
      status: to,
      data,
      referenceNo: typeof data.referenceNo === 'string' ? data.referenceNo : inst.referenceNo,
      startedAt: inst.startedAt ?? now,
      completedAt: done ? now : null,
      slaDueAt: done ? null : hours(stage.slaHours),
      updatedAt: now,
      version: inst.version + 1,
    })
    .where(and(eq(stageInstance.id, inst.id), eq(stageInstance.version, inst.version)))
    .returning();
  if (!updated.length) throw preconditionFailed();

  const eventData = Object.fromEntries(Object.entries(p.input.fields).map(([k, v]) => [k, k === 'podSignature' ? '[signature captured]' : v]));
  await tx.insert(stageEvent).values({
    id: uuidv7(), tenantId: job.tenantId, jobId: job.id, containerId: inst.containerId, stageInstanceId: inst.id, stageKey: inst.stageKey,
    fromStatus: from, toStatus: to, actorId: actor.userId, actorName: actor.name, remarks: p.input.remarks ?? null, data: eventData,
    clientOccurredAt: p.input.clientOccurredAt ? new Date(p.input.clientOccurredAt) : null,
  });

  if (p.input.disbursements.length) {
    await recordDisbursements(tx, uow, actor, { jobId: job.id, stageInstanceId: inst.id, stageKey: inst.stageKey }, p.input.disbursements);
  }

  uow.emit(makeEvent(job.tenantId, 'StageStatusChanged', 'job', job.id, {
    jobId: job.id, jobNo: job.jobNo, blNo: job.blNo, customerId: job.customerId, containerId: inst.containerId,
    stageKey: inst.stageKey, stageLabel: stage.label.en, from, to, done, actorName: actor.name, actions,
  }));

  for (const action of actions) {
    if (action === 'SPAWN_CONTAINER_STAGES') await spawnContainerStages(tx, uow, job, wf);
    if (action === 'REQUEST_CUSTOMER_APPROVAL') await requestCustomerApproval(tx, uow, actor, job, inst.id);
  }
  await activateReadyStages(tx, wf, job.id);
  await audit(tx, actor, meta, { action: 'stage.transitioned', entityType: 'stage_instance', entityId: inst.id, before: { status: from }, after: { status: to, remarks: p.input.remarks } });
  return updated[0]!;
}

/** Assign a PRO, inspection agent or driver to a stage (BAY-001, DO-002). */
export async function assignStage(tx: Tx, uow: UnitOfWork, actor: Actor, meta: RequestMeta | undefined, jobId: string, stageInstanceId: string, assigneeId: string | null) {
  if (actor.kind !== 'system') requirePermission(actor, 'stage.assign');
  const job = await requireJob(tx, jobId);
  if (job.status === 'CLOSED') throw conflict('This job is closed');
  const [inst] = await tx.select().from(stageInstance).where(and(eq(stageInstance.id, stageInstanceId), eq(stageInstance.jobId, jobId)));
  if (!inst) throw notFound('Stage');
  if (assigneeId) {
    const user = await getUser(tx, assigneeId);
    if (!user?.active || user.roles.includes('CUSTOMER')) throw unprocessable('Assignee must be an active staff member');
  }
  await tx.update(stageInstance).set({ assigneeId, updatedAt: new Date(), version: inst.version + 1 }).where(eq(stageInstance.id, inst.id));
  uow.emit(makeEvent(job.tenantId, 'StageAssigned', 'job', job.id, { jobId: job.id, jobNo: job.jobNo, blNo: job.blNo, stageKey: inst.stageKey, containerId: inst.containerId, assigneeId }));
  await activateReadyStages(tx, await getWorkflow(tx, job.tenantId, job.workflowVersion), job.id);
  await audit(tx, actor, meta, { action: 'stage.assigned', entityType: 'stage_instance', entityId: inst.id, before: { assigneeId: inst.assigneeId }, after: { assigneeId } });
}

/** Read model for the BL detail screen: every stage with labels, assignee, SLA and the next steps (with "waiting for"). */
export async function stageView(tx: Tx, actor: Actor, job: JobRow, opts: { customerView?: boolean } = {}) {
  const wf = await getWorkflow(tx, job.tenantId, job.workflowVersion);
  const all = await tx.select().from(stageInstance).where(eq(stageInstance.jobId, job.id)).orderBy(asc(stageInstance.stageKey));
  const users = await getUsers(tx, [...new Set(all.map((s) => s.assigneeId).filter((x): x is string => !!x))]);
  const now = Date.now();
  const view = (s: StageRow) => {
    const def = stageDef(wf, s.stageKey)!;
    const status = def.statuses.find((x) => x.key === s.status);
    const canUpdate = !opts.customerView && hasPermission(actor, `stage.${s.stageKey}.update`) && job.status === 'OPEN';
    return {
      id: s.id, key: s.stageKey, level: def.level, order: def.order, phase: def.phase, label: def.label, ownerRole: def.ownerRole,
      status: s.status, statusLabel: status?.label ?? { en: s.status, ar: s.status }, done: !!status?.done,
      statuses: def.statuses, fields: opts.customerView ? [] : def.fields ?? [],
      assignee: s.assigneeId ? { id: s.assigneeId, name: users.get(s.assigneeId)?.name ?? '—' } : null,
      referenceNo: s.referenceNo,
      data: opts.customerView ? {} : s.data,
      startedAt: s.startedAt, completedAt: s.completedAt, slaDueAt: s.slaDueAt,
      overdue: !!s.slaDueAt && !s.completedAt && s.slaDueAt.getTime() < now,
      version: s.version,
      nextSteps: canUpdate ? describeNextSteps(wf, s.stageKey, s.status, guardContext(all, s)) : [],
    };
  };
  const jobLevel = all.filter((s) => !s.containerId).map(view).sort((a, b) => a.order - b.order);
  const byContainer: Record<string, ReturnType<typeof view>[]> = {};
  for (const s of all.filter((x) => x.containerId)) (byContainer[s.containerId!] ??= []).push(view(s));
  for (const k of Object.keys(byContainer)) byContainer[k]!.sort((a, b) => a.order - b.order);
  return { workflowVersion: wf.version, jobStages: jobLevel, containerStages: byContainer };
}

export async function getStageRows(tx: Tx, jobIds: string[]) {
  if (!jobIds.length) return [];
  return tx.select().from(stageInstance).where(inArray(stageInstance.jobId, jobIds));
}

/** "My tasks" (OPS-005): open stages assigned to me, with whether I can act now. */
export async function myTasks(tx: Tx, actor: Actor) {
  if (!actor.userId) return [];
  const mine = await tx.select().from(stageInstance).where(and(eq(stageInstance.assigneeId, actor.userId), isNull(stageInstance.completedAt)));
  const jobIds = [...new Set(mine.map((m) => m.jobId))];
  const all = await getStageRows(tx, jobIds);
  return { rows: mine, all };
}
export { guardContext };
