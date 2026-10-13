import { and, desc, eq, inArray } from 'drizzle-orm';
import { DEFAULT_WORKFLOW, type WorkflowDefinition } from '@clearport/workflow';
import type { Tx } from '../../shared/db';
import { appUser, stageDefinition, tenant } from '../../shared/schema';

/** Platform context — public facade used by other contexts. */
const cache = new Map<string, WorkflowDefinition>();

/** Workflow catalogue for a tenant (a specific version for running jobs, else the active one). Cached per instance. */
export async function getWorkflow(tx: Tx, tenantId: string, version?: number): Promise<WorkflowDefinition> {
  const cacheKey = `${tenantId}:${version ?? 'active'}`;
  if (version && cache.has(cacheKey)) return cache.get(cacheKey)!;
  const [row] = await tx
    .select()
    .from(stageDefinition)
    .where(version ? and(eq(stageDefinition.tenantId, tenantId), eq(stageDefinition.version, version)) : and(eq(stageDefinition.tenantId, tenantId), eq(stageDefinition.active, true)))
    .orderBy(desc(stageDefinition.version))
    .limit(1);
  const wf = row ? ({ ...(row.definition as WorkflowDefinition), version: row.version } as WorkflowDefinition) : DEFAULT_WORKFLOW;
  if (version) cache.set(cacheKey, wf);
  return wf;
}

export async function getUsers(tx: Tx, ids: string[]) {
  if (!ids.length) return new Map<string, { id: string; name: string; phone: string | null; email: string; roles: string[] }>();
  const rows = await tx.select({ id: appUser.id, name: appUser.name, phone: appUser.phone, email: appUser.email, roles: appUser.roles }).from(appUser).where(inArray(appUser.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

export async function getUser(tx: Tx, id: string) {
  const [u] = await tx.select().from(appUser).where(eq(appUser.id, id));
  return u;
}

export async function usersWithRole(tx: Tx, role: string) {
  const rows = await tx.select().from(appUser).where(eq(appUser.active, true));
  return rows.filter((u) => u.roles.includes(role));
}

export async function getTenant(tx: Tx, tenantId: string) {
  const [t] = await tx.select().from(tenant).where(eq(tenant.id, tenantId));
  return t;
}
