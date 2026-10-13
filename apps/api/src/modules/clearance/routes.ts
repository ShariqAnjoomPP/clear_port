import { open } from 'node:fs/promises';
import { and, asc, desc, eq, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AddContainersInput, CommentInput, CreateJobInput, PresignInput, RegisterDocumentInput, UpdateContainerInput, UpdateJobInput } from '@clearport/contracts';
import { uuidv7 } from '@clearport/kernel';
import { isDone, stageDef } from '@clearport/workflow';
import { audit } from '../../shared/audit';
import { withTenant, type Tx } from '../../shared/db';
import { makeEvent } from '../../shared/events';
import { fileStore, LocalFileStore, sniffContentType } from '../../shared/files';
import { ifMatchVersion, parseBody, protectedRouter } from '../../shared/http';
import { hasPermission, requirePermission } from '../../shared/policy';
import { conflict, notFound, preconditionFailed, unprocessable } from '../../shared/problem';
import { appUser, comment, container, customer, document, disbursement, invoice, job, jobBoard, stageEvent, stageInstance } from '../../shared/schema';
import { getCustomer } from '../customer/public';
import { jobFinanceSummary, listJobDisbursements } from '../finance/public';
import { listTripsForJob } from '../fieldops/public';
import { getWorkflow } from '../platform/public';
import { createJobStages, spawnContainerStages, stageView } from '../workflow/public';
import { nextJobNo, requireJob } from './public';
import { closeJob } from './service';

const MAX_UPLOAD = 20 * 1024 * 1024;

async function insertContainers(tx: Tx, tenantId: string, jobId: string, items: z.infer<typeof AddContainersInput>['containers']) {
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.containerNo)) throw unprocessable(`Container ${it.containerNo} is listed twice`);
    seen.add(it.containerNo);
  }
  return tx.insert(container).values(items.map((it) => ({
    id: uuidv7(), tenantId, jobId, containerNo: it.containerNo, sizeType: it.sizeType, sealNo: it.sealNo ?? null,
    grossWeightKg: it.grossWeightKg?.toString() ?? null, packages: it.packages ?? null, freeTimeExpiresAt: it.freeTimeExpiresAt ?? null,
  }))).returning();
}

export function clearanceRoutes() {
  const r = protectedRouter();

  // ── Search and list (OPS-006): reads the job_board projection ──
  r.get('/jobs', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'job.read');
    const q = c.req.query('q')?.trim().toUpperCase();
    const { phase, customerId, status, cursor } = c.req.query();
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 100);
    const items = await withTenant(actor, (tx) =>
      tx.select().from(jobBoard)
        .where(and(
          phase ? eq(jobBoard.phase, phase) : status === 'CLOSED' ? eq(jobBoard.phase, 'CLOSED') : status === 'OPEN' ? sql`${jobBoard.phase} <> 'CLOSED'` : undefined,
          customerId ? eq(jobBoard.customerId, customerId) : undefined,
          q ? or(ilike(jobBoard.blNo, `%${q}%`), ilike(jobBoard.jobNo, `%${q}%`), ilike(jobBoard.customerName, `%${q}%`),
            sql`exists (select 1 from clearance.container ct where ct.job_id = ${jobBoard.jobId} and ct.container_no ilike ${`%${q}%`})`,
            sql`exists (select 1 from workflow.stage_instance si where si.job_id = ${jobBoard.jobId} and si.reference_no ilike ${`%${q}%`})`) : undefined,
          cursor ? lt(jobBoard.updatedAt, new Date(cursor)) : undefined,
        ))
        .orderBy(desc(jobBoard.updatedAt)).limit(limit + 1),
    );
    const page = items.slice(0, limit);
    return c.json({ items: page, nextCursor: items.length > limit ? page.at(-1)!.updatedAt.toISOString() : null });
  });

  // ── Intake (JOB-001…005) ──
  r.post('/jobs', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'job.create');
    const input = await parseBody(c, CreateJobInput);
    const created = await withTenant(actor, async (tx, uow) => {
      const cust = await getCustomer(tx, input.customerId);
      if (!cust || cust.archivedAt) throw unprocessable('Customer not found');
      const wf = await getWorkflow(tx, actor.tenantId);
      const id = uuidv7();
      const jobNo = await nextJobNo(tx, actor.tenantId);
      const { containers, ...rest } = input;
      const [j] = await tx.insert(job).values({
        id, tenantId: actor.tenantId, jobNo, ...rest, coordinatorId: rest.coordinatorId ?? (actor.roles.includes('COORDINATOR') ? actor.userId : null),
        status: 'OPEN', workflowVersion: wf.version, createdBy: actor.userId,
        vessel: rest.vessel ?? null, voyage: rest.voyage ?? null, shippingLineCode: rest.shippingLineCode ?? null, portOfLoading: rest.portOfLoading ?? null,
        portOfDischarge: rest.portOfDischarge ?? null, terminal: rest.terminal ?? null, shippingDetails: rest.shippingDetails ?? null,
      }).returning();
      await insertContainers(tx, actor.tenantId, id, containers);
      await createJobStages(tx, actor.tenantId, id, wf);
      uow.emit(makeEvent(actor.tenantId, 'JobCreated', 'job', id, { jobId: id, jobNo, blNo: j!.blNo, customerId: j!.customerId, containers: containers.length }));
      await audit(tx, actor, c.get('meta'), { action: 'job.created', entityType: 'job', entityId: id, after: { blNo: j!.blNo, containers: containers.length } });
      return j!;
    });
    return c.json(created, 201);
  });

  // ── BL detail: composed from each context's public facade ──
  r.get('/jobs/:id', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'job.read');
    const res = await withTenant(actor, async (tx) => {
      const j = await requireJob(tx, c.req.param('id'));
      const [cust, containers, docs, stages, money, payments, trips, invoices, coordinator] = await Promise.all([
        getCustomer(tx, j.customerId),
        tx.select().from(container).where(eq(container.jobId, j.id)).orderBy(asc(container.containerNo)),
        tx.select().from(document).where(eq(document.jobId, j.id)).orderBy(desc(document.createdAt)),
        stageView(tx, actor, j),
        hasPermission(actor, 'invoice.read') || hasPermission(actor, 'disbursement.create') ? jobFinanceSummary(tx, j.id) : Promise.resolve([]),
        hasPermission(actor, 'invoice.read') || hasPermission(actor, 'disbursement.create') ? listJobDisbursements(tx, j.id) : Promise.resolve([]),
        listTripsForJob(tx, j.id),
        hasPermission(actor, 'invoice.read') ? tx.select().from(invoice).where(eq(invoice.jobId, j.id)) : Promise.resolve([]),
        j.coordinatorId ? tx.select({ id: appUser.id, name: appUser.name }).from(appUser).where(eq(appUser.id, j.coordinatorId)) : Promise.resolve([]),
      ]);
      return {
        ...j, coordinator: coordinator[0] ?? null,
        customer: cust && { id: cust.id, name: cust.name, preferredChannel: cust.preferredChannel, creditDays: cust.creditDays },
        containers, documents: docs, stages, finance: { totals: money, payments }, trips, invoices,
        permissions: {
          update: hasPermission(actor, 'job.update'), close: hasPermission(actor, 'job.close'), reopen: hasPermission(actor, 'job.reopen'),
          assign: hasPermission(actor, 'stage.assign'), upload: hasPermission(actor, 'document.upload'), pay: hasPermission(actor, 'disbursement.create'),
          reconcile: hasPermission(actor, 'disbursement.reconcile'), invoice: hasPermission(actor, 'invoice.manage'), trips: hasPermission(actor, 'field.manage'),
        },
      };
    });
    c.header('etag', `"${res.version}"`);
    return c.json(res);
  });

  r.patch('/jobs/:id', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'job.update');
    const input = await parseBody(c, UpdateJobInput);
    const expected = ifMatchVersion(c);
    const updated = await withTenant(actor, async (tx, uow) => {
      const before = await requireJob(tx, c.req.param('id'));
      if (before.status === 'CLOSED') throw conflict('This job is closed');
      if (expected !== undefined && expected !== before.version) throw preconditionFailed();
      const [after] = await tx.update(job).set({ ...input, updatedAt: new Date(), version: before.version + 1 }).where(and(eq(job.id, before.id), eq(job.version, before.version))).returning();
      if (!after) throw preconditionFailed();
      uow.emit(makeEvent(actor.tenantId, 'JobUpdated', 'job', before.id, { jobId: before.id }));
      await audit(tx, actor, c.get('meta'), { action: 'job.updated', entityType: 'job', entityId: before.id, before, after });
      return after;
    });
    return c.json(updated);
  });

  r.post('/jobs/:id/containers', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'job.update');
    const input = await parseBody(c, AddContainersInput);
    const rows = await withTenant(actor, async (tx, uow) => {
      const j = await requireJob(tx, c.req.param('id'));
      if (j.status === 'CLOSED') throw conflict('This job is closed');
      const added = await insertContainers(tx, actor.tenantId, j.id, input.containers);
      await spawnContainerStages(tx, uow, j, await getWorkflow(tx, j.tenantId, j.workflowVersion));
      uow.emit(makeEvent(actor.tenantId, 'ContainerAdded', 'job', j.id, { jobId: j.id, count: added.length }));
      await audit(tx, actor, c.get('meta'), { action: 'container.added', entityType: 'job', entityId: j.id, after: added.map((a) => a.containerNo) });
      return added;
    });
    return c.json({ items: rows }, 201);
  });

  r.patch('/jobs/:id/containers/:cid', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'job.update');
    const input = await parseBody(c, UpdateContainerInput);
    const row = await withTenant(actor, async (tx, uow) => {
      const [before] = await tx.select().from(container).where(and(eq(container.id, c.req.param('cid')), eq(container.jobId, c.req.param('id'))));
      if (!before) throw notFound('Container');
      const [after] = await tx.update(container).set(input).where(eq(container.id, before.id)).returning();
      uow.emit(makeEvent(actor.tenantId, 'JobUpdated', 'job', before.jobId, { jobId: before.jobId }));
      await audit(tx, actor, c.get('meta'), { action: 'container.updated', entityType: 'container', entityId: before.id, before, after });
      return after;
    });
    return c.json(row);
  });

  // ── Documents (DOC-001…003): presigned upload, then register ──
  r.post('/jobs/:id/documents/presign', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'document.upload');
    const input = await parseBody(c, PresignInput);
    const target = await withTenant(actor, async (tx) => {
      const j = await requireJob(tx, c.req.param('id'));
      const safe = input.fileName.replace(/[^\w.\-]+/g, '_').slice(-120);
      const key = `tenant/${actor.tenantId}/job/${j.id}/${uuidv7()}/${safe}`;
      return fileStore.presignUpload({ key, contentType: input.contentType, maxBytes: Math.min(input.sizeBytes, MAX_UPLOAD) });
    });
    return c.json(target, 201);
  });

  r.post('/jobs/:id/documents', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'document.upload');
    const input = await parseBody(c, RegisterDocumentInput);
    const doc = await withTenant(actor, async (tx, uow) => {
      const j = await requireJob(tx, c.req.param('id'));
      if (!input.uploadKey.startsWith(`tenant/${actor.tenantId}/job/${j.id}/`)) throw unprocessable('Upload does not belong to this job');
      const size = await fileStore.size(input.uploadKey);
      if (!size) throw unprocessable('The file was not uploaded');
      if (fileStore instanceof LocalFileStore) {
        const fh = await open(fileStore.path(input.uploadKey));
        const head = new Uint8Array(12);
        await fh.read(head, 0, 12, 0);
        await fh.close();
        const sniffed = sniffContentType(head);
        if (sniffed && sniffed !== input.contentType) throw unprocessable('File content does not match its type');
      }
      if (input.containerId) {
        const [ct] = await tx.select().from(container).where(and(eq(container.id, input.containerId), eq(container.jobId, j.id)));
        if (!ct) throw unprocessable('Container is not on this job');
      }
      const prev = await tx.select({ v: sql<number>`coalesce(max(${document.version}), 0)::int` }).from(document).where(and(eq(document.jobId, j.id), eq(document.docType, input.docType), input.containerId ? eq(document.containerId, input.containerId) : sql`${document.containerId} is null`));
      const [d] = await tx.insert(document).values({
        id: uuidv7(), tenantId: actor.tenantId, jobId: j.id, containerId: input.containerId ?? null, stageInstanceId: input.stageInstanceId ?? null,
        docType: input.docType, fileName: input.fileName, contentType: input.contentType, sizeBytes: size, storageKey: input.uploadKey,
        version: (prev[0]?.v ?? 0) + 1, customerVisible: input.customerVisible, uploadedBy: actor.userId, uploadedByName: actor.name,
      }).returning();
      uow.emit(makeEvent(actor.tenantId, 'DocumentUploaded', 'job', j.id, { jobId: j.id, documentId: d!.id, docType: d!.docType }));
      await audit(tx, actor, c.get('meta'), { action: 'document.uploaded', entityType: 'document', entityId: d!.id, after: { docType: d!.docType, fileName: d!.fileName } });
      return d!;
    });
    return c.json(doc, 201);
  });

  r.get('/documents/:id/download', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'document.read');
    const url = await withTenant(actor, async (tx) => {
      const [d] = await tx.select().from(document).where(eq(document.id, c.req.param('id')));
      if (!d) throw notFound('Document');
      return fileStore.presignDownload(d.storageKey, d.fileName);
    });
    return c.json({ url });
  });

  r.patch('/documents/:id', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'document.upload');
    const input = await parseBody(c, z.object({ customerVisible: z.boolean() }));
    const d = await withTenant(actor, async (tx) => {
      const [row] = await tx.update(document).set(input).where(eq(document.id, c.req.param('id'))).returning();
      if (!row) throw notFound('Document');
      await audit(tx, actor, c.get('meta'), { action: 'document.visibility', entityType: 'document', entityId: row.id, after: input });
      return row;
    });
    return c.json(d);
  });

  // ── Comments and timeline (OPS-003) ──
  r.post('/jobs/:id/comments', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'comment.create');
    const input = await parseBody(c, CommentInput);
    const row = await withTenant(actor, async (tx, uow) => {
      const j = await requireJob(tx, c.req.param('id'));
      const [cm] = await tx.insert(comment).values({ id: uuidv7(), tenantId: actor.tenantId, jobId: j.id, authorId: actor.userId, authorName: actor.name, ...input }).returning();
      uow.emit(makeEvent(actor.tenantId, 'CommentAdded', 'job', j.id, { jobId: j.id }));
      return cm;
    });
    return c.json(row, 201);
  });

  r.get('/jobs/:id/timeline', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'job.read');
    const items = await withTenant(actor, async (tx) => {
      const j = await requireJob(tx, c.req.param('id'));
      const wf = await getWorkflow(tx, j.tenantId, j.workflowVersion);
      const [events, comments, docs, pays, conts] = await Promise.all([
        tx.select().from(stageEvent).where(eq(stageEvent.jobId, j.id)),
        tx.select().from(comment).where(eq(comment.jobId, j.id)),
        tx.select().from(document).where(eq(document.jobId, j.id)),
        tx.select().from(disbursement).where(eq(disbursement.jobId, j.id)),
        tx.select({ id: container.id, no: container.containerNo }).from(container).where(eq(container.jobId, j.id)),
      ]);
      const cno = new Map(conts.map((x) => [x.id, x.no]));
      const label = (key: string, status: string | null) => (status ? stageDef(wf, key)?.statuses.find((s) => s.key === status)?.label.en ?? status : null);
      return [
        { at: j.createdAt, kind: 'created', title: `Job ${j.jobNo} created`, actor: null },
        ...events.map((e) => ({ at: e.occurredAt, kind: 'stage', title: `${stageDef(wf, e.stageKey)?.label.en ?? e.stageKey}: ${label(e.stageKey, e.fromStatus) ?? '—'} → ${label(e.stageKey, e.toStatus)}`, container: e.containerId ? cno.get(e.containerId) : null, actor: e.actorName, remarks: e.remarks })),
        ...comments.map((m) => ({ at: m.createdAt, kind: 'comment', title: m.body, actor: m.authorName, customerVisible: m.customerVisible })),
        ...docs.map((d) => ({ at: d.createdAt, kind: 'document', title: `${d.docType.replace(/_/g, ' ')} uploaded: ${d.fileName}`, actor: d.uploadedByName, documentId: d.id })),
        ...pays.map((p) => ({ at: p.createdAt, kind: 'payment', title: `${p.feeType.replace(/_/g, ' ')} ${p.amount} ${p.currency}${p.status === 'REVERSED' ? ' (reversed)' : ''}`, actor: p.paidByName })),
      ].sort((a, b) => +new Date(b.at) - +new Date(a.at));
    });
    return c.json({ items });
  });

  // ── Closure (DEL-004/005) ──
  r.post('/jobs/:id/close', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'job.close');
    const res = await withTenant(actor, (tx, uow) => closeJob(tx, uow, actor, c.get('meta'), c.req.param('id')));
    return c.json(res);
  });

  r.post('/jobs/:id/reopen', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'job.reopen');
    const { reason } = await parseBody(c, z.object({ reason: z.string().trim().min(5).max(300) }));
    const res = await withTenant(actor, async (tx, uow) => {
      const j = await requireJob(tx, c.req.param('id'));
      if (j.status !== 'CLOSED') throw conflict('Job is not closed');
      const [after] = await tx.update(job).set({ status: 'OPEN', closedAt: null, updatedAt: new Date(), version: j.version + 1 }).where(eq(job.id, j.id)).returning();
      await tx.update(container).set({ active: true }).where(eq(container.jobId, j.id));
      uow.emit(makeEvent(actor.tenantId, 'JobReopened', 'job', j.id, { jobId: j.id, reason }));
      await audit(tx, actor, c.get('meta'), { action: 'job.reopened', entityType: 'job', entityId: j.id, after: { reason } });
      return after;
    });
    return c.json(res);
  });

  void customer; void inArray;
  return r;
}
