import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type { CargoLineInput, ContainerInput, CreateJobInput, UpdateContainerInput, UpdateJobInput } from '@clearport/contracts';
import { freeTimeEnd, uuidv7 } from '@clearport/kernel';
import { deriveJobPhase, isDone, stageDef } from '@clearport/workflow';
import type { Q, Tx } from '../../lib/db';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { cargoLine, comment, container, customer, disbursement, document, job, stageEvent, stageInstance, staff } from '../../lib/schema';
import { createCustomer, fromNewCustomer, requireCustomer } from '../customers/service';
import { listTrips } from '../fieldops/service';
import { jobFinanceSummary, listDisbursements, listInvoices } from '../finance/service';
import { getActiveWorkflow, getWorkflow } from '../workflow/service';
import { createJobStages, spawnContainerStages, stageView } from '../workflow/stages';
import { getContainers, nextNumber, requireJob, touchJob, type JobRow } from './queries';

const num = (v: number | undefined | null) => (v === undefined || v === null ? null : String(v));

async function insertContainers(tx: Tx, jobId: string, items: ContainerInput[]) {
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.containerNo)) throw unprocessable(`Container ${it.containerNo} is listed twice`);
    seen.add(it.containerNo);
  }
  return tx.insert(container).values(items.map((it) => ({
    id: uuidv7(), jobId, containerNo: it.containerNo, sizeType: it.sizeType, sealNo: it.sealNo ?? null,
    grossWeightKg: num(it.grossWeightKg), packages: it.packages ?? null, packageKind: it.packageKind ?? null,
    volumeCbm: num(it.volumeCbm), reeferTempC: num(it.reeferTempC), ventilation: it.ventilation ?? null,
    freeTimeExpiresAt: it.freeTimeExpiresAt ?? null, freeTimeManual: !!it.freeTimeExpiresAt,
  }))).returning();
}

/**
 * Free time printed on the B/L ("9 days combined at port of discharge") counts from arrival: the ATA once known, else the ETA.
 * Containers whose end date was typed by hand keep it.
 */
export async function syncFreeTime(q: Q, j: Pick<JobRow, 'id' | 'eta' | 'ata' | 'freeTimeDays'>) {
  if (j.freeTimeDays === null || j.freeTimeDays === undefined) return;
  await q.update(container)
    .set({ freeTimeExpiresAt: freeTimeEnd(j.ata ?? j.eta, j.freeTimeDays) })
    .where(and(eq(container.jobId, j.id), eq(container.freeTimeManual, false)));
}

/** The job's commodity and HS codes, as shown in lists and search, follow its goods lines. */
async function syncGoodsSummary(q: Q, jobId: string) {
  const lines = await q.select().from(cargoLine).where(eq(cargoLine.jobId, jobId)).orderBy(asc(cargoLine.lineNo));
  if (!lines.length) return;
  const commodity = [...new Set(lines.map((l) => l.description))].join(', ');
  const hsCodes = [...new Set(lines.map((l) => l.hsCode).filter((h): h is string => !!h))];
  await q.update(job).set({ commodity: commodity.length > 200 ? `${commodity.slice(0, 199)}…` : commodity, hsCodes }).where(eq(job.id, jobId));
}

async function containerIdByNo(q: Q, jobId: string, containerNo: string | undefined) {
  if (!containerNo) return null;
  const [ct] = await q.select({ id: container.id }).from(container).where(and(eq(container.jobId, jobId), eq(container.containerNo, containerNo)));
  if (!ct) throw unprocessable(`${containerNo} is not one of this job's containers`, [{ path: 'containerNo', message: `Container: ${containerNo} is not on this job` }]);
  return ct.id;
}

const cargoValues = (l: Partial<CargoLineInput>) => ({
  ...(l.description !== undefined && { description: l.description }),
  ...(l.hsCode !== undefined && { hsCode: l.hsCode ?? null }),
  ...(l.packages !== undefined && { packages: l.packages ?? null }),
  ...(l.packageKind !== undefined && { packageKind: l.packageKind ?? null }),
  ...(l.netWeightKg !== undefined && { netWeightKg: num(l.netWeightKg) }),
  ...(l.grossWeightKg !== undefined && { grossWeightKg: num(l.grossWeightKg) }),
  ...(l.volumeCbm !== undefined && { volumeCbm: num(l.volumeCbm) }),
  ...(l.originCountry !== undefined && { originCountry: l.originCountry ?? null }),
});

/**
 * Job intake: one Bill of Lading with its containers, for an existing customer or one created right here.
 * Everything runs in the caller's transaction, so a failure (say a duplicate container) creates neither job nor customer.
 */
export async function createJob(tx: Tx, input: CreateJobInput) {
  const customerId = input.newCustomer
    ? (await createCustomer(tx, fromNewCustomer(input.newCustomer))).id
    : (await requireCustomer(tx, input.customerId!)).id;
  const wf = await getActiveWorkflow(tx);
  const { containers, cargoLines, coordinatorId, newCustomer: _new, customerId: _id, ...rest } = input;
  const [j] = await tx.insert(job).values({
    id: uuidv7(), jobNo: await nextNumber(tx, 'job', 'CP'), ...rest, commodity: rest.commodity ?? cargoLines[0]!.description,
    customerId, coordinatorStaffId: coordinatorId ?? null, workflowVersion: wf.version,
    invoiceValue: rest.invoiceValue ?? null, invoiceCurrency: rest.invoiceCurrency ?? null,
  }).returning();
  const boxes = await insertContainers(tx, j!.id, containers);
  if (cargoLines.length) {
    const idByNo = new Map(boxes.map((b) => [b.containerNo, b.id]));
    await tx.insert(cargoLine).values(cargoLines.map((l, i) => ({
      id: uuidv7(), jobId: j!.id, lineNo: i + 1, containerId: l.containerNo ? idByNo.get(l.containerNo) ?? null : null,
      ...cargoValues(l), description: l.description, originCountry: l.originCountry ?? rest.countryOfOrigin ?? null,
    })));
    await syncGoodsSummary(tx, j!.id);
  }
  await syncFreeTime(tx, j!);
  await createJobStages(tx, j!.id, wf);
  return (await requireJob(tx, j!.id));
}

export async function updateJob(q: Q, id: string, input: UpdateJobInput) {
  const before = await requireJob(q, id);
  if (before.status === 'CLOSED') throw conflict('This job is closed');
  const { coordinatorId, ...rest } = input;
  const [after] = await q
    .update(job)
    .set({ ...rest, ...(coordinatorId !== undefined && { coordinatorStaffId: coordinatorId }), updatedAt: new Date() })
    .where(eq(job.id, id))
    .returning();
  if (input.eta !== undefined || input.ata !== undefined || input.freeTimeDays !== undefined) await syncFreeTime(q, after!);
  return after!;
}

export async function addCargoLine(q: Q, jobId: string, input: CargoLineInput) {
  const j = await requireJob(q, jobId);
  if (j.status === 'CLOSED') throw conflict('This job is closed');
  const [{ next }] = (await q.select({ next: sql<number>`coalesce(max(${cargoLine.lineNo}), 0) + 1` }).from(cargoLine).where(eq(cargoLine.jobId, j.id))) as [{ next: number }];
  const [row] = await q.insert(cargoLine).values({
    id: uuidv7(), jobId: j.id, lineNo: Number(next), containerId: await containerIdByNo(q, j.id, input.containerNo),
    ...cargoValues(input), description: input.description, originCountry: input.originCountry ?? j.countryOfOrigin ?? null,
  }).returning();
  await syncGoodsSummary(q, j.id);
  await touchJob(q, j.id);
  return row!;
}

export async function updateCargoLine(q: Q, jobId: string, lineId: string, input: Partial<CargoLineInput>) {
  const j = await requireJob(q, jobId);
  if (j.status === 'CLOSED') throw conflict('This job is closed');
  const [row] = await q.update(cargoLine)
    .set({ ...cargoValues(input), ...(input.containerNo !== undefined && { containerId: await containerIdByNo(q, j.id, input.containerNo) }) })
    .where(and(eq(cargoLine.id, lineId), eq(cargoLine.jobId, j.id)))
    .returning();
  if (!row) throw notFound('Goods line');
  await syncGoodsSummary(q, j.id);
  await touchJob(q, j.id);
  return row;
}

export async function removeCargoLine(q: Q, jobId: string, lineId: string) {
  const j = await requireJob(q, jobId);
  if (j.status === 'CLOSED') throw conflict('This job is closed');
  const [row] = await q.delete(cargoLine).where(and(eq(cargoLine.id, lineId), eq(cargoLine.jobId, j.id))).returning();
  if (!row) throw notFound('Goods line');
  await syncGoodsSummary(q, j.id);
  await touchJob(q, j.id);
  return { ok: true };
}

/** Totals of the goods lines, and whether they agree with the container weights (a typo check against the B/L). */
function cargoTotals(lines: (typeof cargoLine.$inferSelect)[], containers: (typeof container.$inferSelect)[]) {
  const sum = (xs: (string | number | null)[]) => xs.reduce<number>((t, x) => t + (x === null ? 0 : Number(x)), 0);
  const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;
  const totals = {
    lines: lines.length,
    packages: sum(lines.map((l) => l.packages)),
    netWeightKg: round(sum(lines.map((l) => l.netWeightKg)), 2),
    grossWeightKg: round(sum(lines.map((l) => l.grossWeightKg)), 2),
    volumeCbm: round(sum(lines.map((l) => l.volumeCbm)), 3),
  };
  const boxGross = round(sum(containers.map((c) => c.grossWeightKg)), 2);
  const warnings: string[] = [];
  if (totals.grossWeightKg && boxGross && Math.abs(totals.grossWeightKg - boxGross) > 1) {
    warnings.push(`Goods lines add up to ${totals.grossWeightKg.toLocaleString('en')} kg gross, containers to ${boxGross.toLocaleString('en')} kg`);
  }
  if (lines.some((l) => l.netWeightKg && l.grossWeightKg && Number(l.netWeightKg) > Number(l.grossWeightKg))) warnings.push('A goods line has more net weight than gross weight');
  return { ...totals, warnings };
}

export async function addContainers(tx: Tx, jobId: string, items: ContainerInput[]) {
  const j = await requireJob(tx, jobId);
  if (j.status === 'CLOSED') throw conflict('This job is closed');
  const added = await insertContainers(tx, j.id, items);
  // If the CCRO is already issued, the new containers get their delivery stages straight away.
  await spawnContainerStages(tx, j, await getWorkflow(tx, j.workflowVersion));
  await touchJob(tx, j.id);
  return added;
}

export async function updateContainer(q: Q, jobId: string, containerId: string, input: UpdateContainerInput) {
  const { freeTimeExpiresAt, grossWeightKg, volumeCbm, reeferTempC, ...rest } = input;
  const [row] = await q.update(container).set({
    ...rest,
    ...(grossWeightKg !== undefined && { grossWeightKg: num(grossWeightKg) }),
    ...(volumeCbm !== undefined && { volumeCbm: num(volumeCbm) }),
    ...(reeferTempC !== undefined && { reeferTempC: num(reeferTempC) }),
    // A typed date sticks; clearing it goes back to arrival + free days.
    ...(freeTimeExpiresAt !== undefined && { freeTimeExpiresAt, freeTimeManual: freeTimeExpiresAt !== null }),
  }).where(and(eq(container.id, containerId), eq(container.jobId, jobId))).returning();
  if (!row) throw notFound('Container');
  if (freeTimeExpiresAt === null) {
    await syncFreeTime(q, await requireJob(q, jobId));
    return (await q.select().from(container).where(eq(container.id, row.id)))[0]!;
  }
  return row;
}

/** Everything the job screen needs in one call. */
export async function jobDetail(q: Q, id: string) {
  const j = await requireJob(q, id);
  const [[cust], [coordinator], containers, documents, stages, trips, totals, payments, invoices, lines] = await Promise.all([
    q.select({ id: customer.id, name: customer.name, address: customer.address, preferredChannel: customer.preferredChannel, creditDays: customer.creditDays }).from(customer).where(eq(customer.id, j.customerId)),
    j.coordinatorStaffId ? q.select({ id: staff.id, name: staff.name }).from(staff).where(eq(staff.id, j.coordinatorStaffId)) : Promise.resolve([]),
    getContainers(q, j.id),
    q.select().from(document).where(eq(document.jobId, j.id)).orderBy(desc(document.createdAt)),
    stageView(q, j),
    listTrips(q, { jobId: j.id }),
    jobFinanceSummary(q, j.id),
    listDisbursements(q, { jobId: j.id }),
    listInvoices(q, { jobId: j.id }),
    q.select().from(cargoLine).where(eq(cargoLine.jobId, j.id)).orderBy(asc(cargoLine.lineNo)),
  ]);
  return {
    ...j, customer: cust ?? null, coordinator: coordinator ?? null, containers, documents, stages, trips, finance: { totals, payments }, invoices,
    cargoLines: lines, cargoTotals: cargoTotals(lines, containers),
  };
}

export async function addComment(q: Q, jobId: string, authorName: string, input: { body: string; customerVisible: boolean }) {
  const j = await requireJob(q, jobId);
  const [row] = await q.insert(comment).values({ id: uuidv7(), jobId: j.id, authorName, ...input }).returning();
  await touchJob(q, j.id);
  return row!;
}

/** History of a job: creation, every stage change, comments and documents, newest first. */
export async function timeline(q: Q, jobId: string) {
  const j = await requireJob(q, jobId);
  const wf = await getWorkflow(q, j.workflowVersion);
  const [events, comments, docs, pays, conts] = await Promise.all([
    q.select().from(stageEvent).where(eq(stageEvent.jobId, j.id)),
    q.select().from(comment).where(eq(comment.jobId, j.id)),
    q.select().from(document).where(eq(document.jobId, j.id)),
    q.select().from(disbursement).where(eq(disbursement.jobId, j.id)),
    q.select({ id: container.id, no: container.containerNo }).from(container).where(eq(container.jobId, j.id)),
  ]);
  const cno = new Map(conts.map((x) => [x.id, x.no]));
  const label = (key: string, status: string | null) => (status ? stageDef(wf, key)?.statuses.find((s) => s.key === status)?.label.en ?? status : null);
  return [
    { at: j.createdAt, kind: 'created', title: `Job ${j.jobNo} created`, actor: null },
    ...events.map((e) => ({ at: e.occurredAt, kind: 'stage', title: `${stageDef(wf, e.stageKey)?.label.en ?? e.stageKey}: ${label(e.stageKey, e.fromStatus) ?? '—'} → ${label(e.stageKey, e.toStatus)}`, container: e.containerId ? cno.get(e.containerId) ?? null : null, actor: e.actorName, remarks: e.remarks })),
    ...comments.map((m) => ({ at: m.createdAt, kind: 'comment', title: m.body, actor: m.authorName, customerVisible: m.customerVisible })),
    ...docs.map((d) => ({ at: d.createdAt, kind: 'document', title: `${d.docType.replace(/_/g, ' ').toLowerCase()} uploaded: ${d.fileName}`, actor: d.uploadedByName, documentId: d.id })),
    ...pays.filter((p) => !p.reversesId).map((p) => ({ at: p.createdAt, kind: 'payment', title: `${p.feeType.replace(/_/g, ' ').toLowerCase()} ${p.amount} ${p.currency} paid${p.status === 'REVERSED' ? ' (reversed)' : ''}`, actor: p.paidByName })),
    ...(j.closedAt ? [{ at: j.closedAt, kind: 'closed', title: `Job ${j.jobNo} closed`, actor: null }] : []),
  ].sort((a, b) => +new Date(b.at) - +new Date(a.at));
}

export type JobSummary = {
  jobId: string; jobNo: string; blNo: string; customerId: string; customerName: string; phase: string; eta: string; priority: string;
  coordinatorId: string | null; coordinatorName: string | null; containersTotal: number; containersDelivered: number; stages: Record<string, string>;
  nextSlaDueAt: Date | null; overdue: boolean; freeTimeNext: string | null; updatedAt: Date;
};

const DELIVERED = ['DELIVERED', 'EMPTY_RETURNED'];

/**
 * One row per job for lists and the board: phase, progress and warnings computed from the live stage rows
 * (the prototype's replacement for the production job_board projection).
 */
export async function jobSummaries(q: Q, filter: { q?: string; status?: 'OPEN' | 'CLOSED'; customerId?: string; limit?: number } = {}): Promise<JobSummary[]> {
  const term = filter.q?.trim();
  const like = `%${term}%`;
  const rows = await q
    .select({ j: job, customerName: customer.name, coordinatorName: staff.name })
    .from(job)
    .innerJoin(customer, eq(customer.id, job.customerId))
    .leftJoin(staff, eq(staff.id, job.coordinatorStaffId))
    .where(and(
      filter.status ? eq(job.status, filter.status) : undefined,
      filter.customerId ? eq(job.customerId, filter.customerId) : undefined,
      term ? or(
        ilike(job.blNo, like), ilike(job.jobNo, like), ilike(customer.name, like), sql`${customer.contacts}::text ilike ${like}`,
        ilike(job.bookingNo, like), ilike(job.invoiceNo, like), ilike(job.shipper, like), ilike(job.commodity, like),
        sql`exists (select 1 from container ct where ct.job_id = "job"."id" and ct.seal_no ilike ${like})`,
        // Outer column written out in full so the subqueries cannot resolve it to their own id column.
        sql`exists (select 1 from container ct where ct.job_id = "job"."id" and ct.container_no ilike ${like})`,
        sql`exists (select 1 from stage_instance si where si.job_id = "job"."id" and si.reference_no ilike ${like})`,
      ) : undefined,
    ))
    .orderBy(desc(job.updatedAt))
    .limit(filter.limit ?? 100);
  if (!rows.length) return [];

  const ids = rows.map((r) => r.j.id);
  const [stages, conts] = await Promise.all([
    q.select().from(stageInstance).where(inArray(stageInstance.jobId, ids)),
    q.select().from(container).where(inArray(container.jobId, ids)).orderBy(asc(container.containerNo)),
  ]);
  const now = Date.now();

  return rows.map(({ j, customerName, coordinatorName }) => {
    const mine = stages.filter((s) => s.jobId === j.id);
    const jobLevel = Object.fromEntries(mine.filter((s) => !s.containerId).map((s) => [s.stageKey, s.status]));
    const delivery = mine.filter((s) => s.containerId && s.stageKey === 'DELIVERY');
    const deliveredIds = new Set(delivery.filter((d) => DELIVERED.includes(d.status)).map((d) => d.containerId));
    const jobContainers = conts.filter((c) => c.jobId === j.id);
    const openDue = mine.filter((s) => s.slaDueAt && !s.completedAt).map((s) => s.slaDueAt!.getTime());
    const freeTimes = jobContainers.filter((c) => c.active && c.freeTimeExpiresAt && !deliveredIds.has(c.id)).map((c) => c.freeTimeExpiresAt!).sort();
    return {
      jobId: j.id, jobNo: j.jobNo, blNo: j.blNo, customerId: j.customerId, customerName, eta: j.eta, priority: j.priority,
      phase: deriveJobPhase({ closed: j.status === 'CLOSED', jobStages: jobLevel, containerDelivery: delivery.map((d) => d.status) }),
      coordinatorId: j.coordinatorStaffId, coordinatorName,
      containersTotal: jobContainers.length, containersDelivered: deliveredIds.size, stages: jobLevel,
      nextSlaDueAt: openDue.length ? new Date(Math.min(...openDue)) : null,
      overdue: j.status === 'OPEN' && openDue.some((t) => t < now),
      freeTimeNext: freeTimes[0] ?? null, updatedAt: j.updatedAt,
    };
  });
}

/** Closing is a guarded command: CCRO issued, every container delivered, every payment reconciled. Lists all blockers at once. */
export async function closeJob(tx: Tx, jobId: string) {
  const j = await requireJob(tx, jobId);
  if (j.status === 'CLOSED') throw conflict('Already closed');
  const wf = await getWorkflow(tx, j.workflowVersion);
  const stages = await tx.select().from(stageInstance).where(eq(stageInstance.jobId, j.id));
  const conts = (await getContainers(tx, j.id)).filter((c) => c.active);
  const blockers: { code: string; message: string }[] = [];
  if (stages.find((s) => s.stageKey === 'CCRO' && !s.containerId)?.status !== 'ISSUED') blockers.push({ code: 'CCRO', message: 'Port release is not issued' });
  const deliveryDef = stageDef(wf, 'DELIVERY')!;
  for (const ct of conts) {
    const d = stages.find((s) => s.containerId === ct.id && s.stageKey === 'DELIVERY');
    if (!d || !isDone(deliveryDef, d.status)) blockers.push({ code: 'CONTAINER', message: `${ct.containerNo} is not delivered` });
  }
  const unreconciled = (await jobFinanceSummary(tx, j.id)).reduce((n, s) => n + Number(s.unreconciled), 0);
  if (unreconciled) blockers.push({ code: 'PAYMENTS', message: `${unreconciled} payment(s) are not reconciled` });
  if (blockers.length) throw conflict('This job cannot be closed yet', blockers);

  const now = new Date();
  const [after] = await tx.update(job).set({ status: 'CLOSED', closedAt: now, updatedAt: now }).where(eq(job.id, j.id)).returning();
  // Closed jobs release their container numbers, so the same box can arrive on a new job later.
  await tx.update(container).set({ active: false }).where(eq(container.jobId, j.id));
  return after!;
}

/** Reopening needs a reason, which is kept in the job's timeline. */
export async function reopenJob(tx: Tx, jobId: string, actorName: string, reason: string) {
  const j = await requireJob(tx, jobId);
  if (j.status !== 'CLOSED') throw conflict('Job is not closed');
  const [after] = await tx.update(job).set({ status: 'OPEN', closedAt: null, updatedAt: new Date() }).where(eq(job.id, j.id)).returning();
  await tx.update(container).set({ active: true }).where(eq(container.jobId, j.id));
  await tx.insert(comment).values({ id: uuidv7(), jobId: j.id, authorName: actorName, body: `Job reopened: ${reason}` });
  return after!;
}
