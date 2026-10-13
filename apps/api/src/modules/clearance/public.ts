import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../../shared/db';
import { notFound } from '../../shared/problem';
import { container, document, job, jobCounter } from '../../shared/schema';

/** Clearance context — public facade (read models other contexts may use). */
export async function getJob(tx: Tx, id: string) {
  const [j] = await tx.select().from(job).where(eq(job.id, id));
  return j;
}

export async function requireJob(tx: Tx, id: string) {
  const j = await getJob(tx, id);
  if (!j) throw notFound('Job');
  return j;
}

export async function getContainers(tx: Tx, jobId: string) {
  return tx.select().from(container).where(eq(container.jobId, jobId)).orderBy(container.containerNo);
}

export async function getContainersByIds(tx: Tx, ids: string[]) {
  if (!ids.length) return [];
  return tx.select().from(container).where(inArray(container.id, ids));
}

export async function documentTypesOnJob(tx: Tx, jobId: string): Promise<string[]> {
  const rows = await tx.selectDistinct({ t: document.docType }).from(document).where(eq(document.jobId, jobId));
  return rows.map((r) => r.t);
}

export async function getDocument(tx: Tx, id: string) {
  const [d] = await tx.select().from(document).where(eq(document.id, id));
  return d;
}

/** Gap-free per-tenant, per-year job number: CP-2026-00042. Row lock serialises concurrent creates. */
export async function nextJobNo(tx: Tx, tenantId: string): Promise<string> {
  const year = new Date().getUTCFullYear();
  const [row] = await tx
    .insert(jobCounter)
    .values({ tenantId, year, value: 1 })
    .onConflictDoUpdate({ target: [jobCounter.tenantId, jobCounter.year], set: { value: sql`${jobCounter.value} + 1` } })
    .returning();
  return `CP-${year}-${String(row!.value).padStart(5, '0')}`;
}

export async function touchJob(tx: Tx, jobId: string) {
  await tx.update(job).set({ updatedAt: new Date() }).where(and(eq(job.id, jobId)));
}
