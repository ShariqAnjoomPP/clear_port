import { desc, eq } from 'drizzle-orm';
import type { WorkflowDefinition } from '@clearport/workflow';
import { uuidv7 } from '@clearport/kernel';
import type { Q, Tx } from '../../lib/db';
import { notFound } from '../../lib/errors';
import { workflowDefinition } from '../../lib/schema';

/** Versions are immutable once published, so they are safe to cache per process (and per Lambda instance). */
const byVersion = new Map<number, WorkflowDefinition>();

export async function getWorkflow(q: Q, version: number): Promise<WorkflowDefinition> {
  const hit = byVersion.get(version);
  if (hit) return hit;
  const [row] = await q.select().from(workflowDefinition).where(eq(workflowDefinition.version, version));
  if (!row) throw notFound(`Workflow version ${version}`);
  const wf = { ...row.definition, version: row.version };
  byVersion.set(version, wf);
  return wf;
}

/** The workflow new jobs start on. Read from the DB each time so a newly published version is picked up everywhere. */
export async function getActiveWorkflow(q: Q): Promise<WorkflowDefinition> {
  const [row] = await q.select({ version: workflowDefinition.version }).from(workflowDefinition).where(eq(workflowDefinition.active, true));
  if (!row) throw notFound('Active workflow (run `npm run db:reset`)');
  return getWorkflow(q, row.version);
}

export async function listVersions(q: Q) {
  return q
    .select({ version: workflowDefinition.version, active: workflowDefinition.active, createdAt: workflowDefinition.createdAt })
    .from(workflowDefinition)
    .orderBy(desc(workflowDefinition.version));
}

export async function publishDefinition(tx: Tx, definition: WorkflowDefinition): Promise<WorkflowDefinition> {
  const current = await getActiveWorkflow(tx);
  const next: WorkflowDefinition = { ...definition, version: current.version + 1 };
  await tx.update(workflowDefinition).set({ active: false }).where(eq(workflowDefinition.active, true));
  await tx.insert(workflowDefinition).values({ id: uuidv7(), version: next.version, definition: next, active: true });
  return next;
}

/** Changing SLA hours publishes a new version; running jobs keep the version they started with. */
export async function publishSla(tx: Tx, sla: Record<string, number>): Promise<WorkflowDefinition> {
  const current = await getActiveWorkflow(tx);
  return publishDefinition(tx, { ...current, stages: current.stages.map((s) => (sla[s.key] ? { ...s, slaHours: sla[s.key] } : s)) });
}
