import { asc, eq, sql } from 'drizzle-orm';
import type { Q, Tx } from '../../lib/db';
import { notFound } from '../../lib/errors';
import { container, counter, document, job } from '../../lib/schema';

/** Plain job lookups shared by the jobs and workflow functions (kept here to avoid a circular import). */
export type JobRow = typeof job.$inferSelect;

export async function getJob(q: Q, id: string) {
  const [row] = await q.select().from(job).where(eq(job.id, id));
  return row;
}

export async function requireJob(q: Q, id: string) {
  const row = await getJob(q, id);
  if (!row) throw notFound('Job');
  return row;
}

export async function getContainers(q: Q, jobId: string) {
  return q.select().from(container).where(eq(container.jobId, jobId)).orderBy(asc(container.containerNo));
}

/** Document types present on a job, counting every type inside a scanned pack (doc_type plus covers). */
export async function documentTypesOnJob(q: Q, jobId: string): Promise<string[]> {
  const rows = await q.select({ t: document.docType, covers: document.covers }).from(document).where(eq(document.jobId, jobId));
  return [...new Set(rows.flatMap((r) => [r.t, ...r.covers]))];
}

/** Gap-free yearly sequence (row lock serialises concurrent creates), e.g. CP-2026-00042. */
export async function nextNumber(tx: Tx, name: 'job' | 'invoice' | 'trip', prefix: string): Promise<string> {
  const year = new Date().getUTCFullYear();
  const [row] = await tx
    .insert(counter)
    .values({ name, year, value: 1 })
    .onConflictDoUpdate({ target: [counter.name, counter.year], set: { value: sql`${counter.value} + 1` } })
    .returning();
  return `${prefix}-${year}-${String(row!.value).padStart(5, '0')}`;
}

export const touchJob = (q: Q, jobId: string) => q.update(job).set({ updatedAt: new Date() }).where(eq(job.id, jobId));
