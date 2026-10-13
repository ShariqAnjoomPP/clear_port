import { Hono } from 'hono';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { MasterItemInput, UserInput } from '@clearport/contracts';
import { uuidv7 } from '@clearport/kernel';
import { DEFAULT_WORKFLOW, type WorkflowDefinition } from '@clearport/workflow';
import { audit } from '../../shared/audit';
import type { AppEnv } from '../../shared/context';
import { withTenant } from '../../shared/db';
import { parseBody, protectedRouter } from '../../shared/http';
import { requirePermission } from '../../shared/policy';
import { badRequest, notFound } from '../../shared/problem';
import { appUser, masterItem, stageDefinition, tenant } from '../../shared/schema';
import { getWorkflow } from './public';

export function platformRoutes() {
  const r = protectedRouter();

  r.get('/me', async (c) => {
    const actor = c.get('actor');
    return c.json(
      await withTenant(actor, async (tx) => {
        const [t] = await tx.select().from(tenant).where(eq(tenant.id, actor.tenantId));
        const [u] = actor.userId ? await tx.select().from(appUser).where(eq(appUser.id, actor.userId)) : [];
        return { user: { id: actor.userId, name: actor.name, email: u?.email, roles: actor.roles, customerId: actor.customerId, locale: u?.locale ?? 'en' }, tenant: t && { id: t.id, name: t.name, baseCurrency: t.baseCurrency, timezone: t.timezone } };
      }),
    );
  });

  // Users (ADM-001). Staff directory is readable by any staff member (assignment pickers).
  r.get('/admin/users', async (c) => {
    const actor = c.get('actor');
    if (actor.roles.includes('CUSTOMER')) return c.json({ items: [] });
    const items = await withTenant(actor, (tx) => tx.select().from(appUser).orderBy(asc(appUser.name)));
    return c.json({ items: items.map(({ tenantId, ...u }) => u) });
  });

  r.post('/admin/users', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'admin.users');
    const input = await parseBody(c, UserInput);
    if (input.roles.includes('CUSTOMER') && !input.customerId) throw badRequest('Customer users must be linked to a customer');
    const user = await withTenant(actor, async (tx) => {
      const [u] = await tx.insert(appUser).values({ id: uuidv7(), tenantId: actor.tenantId, email: input.email.toLowerCase(), name: input.name, phone: input.phone ?? null, roles: input.roles, customerId: input.customerId ?? null, locale: input.locale }).returning();
      await audit(tx, actor, c.get('meta'), { action: 'user.created', entityType: 'user', entityId: u!.id, after: { email: u!.email, roles: u!.roles } });
      return u!;
    });
    return c.json(user, 201);
  });

  r.patch('/admin/users/:id', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'admin.users');
    const input = await parseBody(c, UserInput.partial().extend({ active: z.boolean().optional() }));
    const user = await withTenant(actor, async (tx) => {
      const [before] = await tx.select().from(appUser).where(eq(appUser.id, c.req.param('id')));
      if (!before) throw notFound('User');
      const [u] = await tx.update(appUser).set({ ...input, email: input.email?.toLowerCase() }).where(eq(appUser.id, before.id)).returning();
      await audit(tx, actor, c.get('meta'), { action: 'user.updated', entityType: 'user', entityId: before.id, before: { roles: before.roles, active: before.active }, after: { roles: u!.roles, active: u!.active } });
      return u;
    });
    return c.json(user);
  });

  // Master data (ADM-003)
  r.get('/admin/master-data', async (c) => {
    const actor = c.get('actor');
    const kind = c.req.query('kind');
    const items = await withTenant(actor, (tx) =>
      tx.select().from(masterItem).where(kind ? and(eq(masterItem.kind, kind), eq(masterItem.active, true)) : eq(masterItem.active, true)).orderBy(asc(masterItem.kind), asc(masterItem.name)),
    );
    return c.json({ items });
  });

  r.post('/admin/master-data', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'admin.config');
    const input = await parseBody(c, MasterItemInput);
    const item = await withTenant(actor, async (tx) => {
      const [m] = await tx.insert(masterItem).values({ id: uuidv7(), tenantId: actor.tenantId, ...input }).returning();
      await audit(tx, actor, c.get('meta'), { action: 'master.created', entityType: 'master_item', entityId: m!.id, after: input });
      return m;
    });
    return c.json(item, 201);
  });

  r.delete('/admin/master-data/:id', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'admin.config');
    await withTenant(actor, async (tx) => {
      const [m] = await tx.update(masterItem).set({ active: false }).where(eq(masterItem.id, c.req.param('id'))).returning();
      if (!m) throw notFound('Item');
      await audit(tx, actor, c.get('meta'), { action: 'master.archived', entityType: 'master_item', entityId: m.id });
    });
    return c.json({ ok: true });
  });

  // Workflow configuration (ADM-002, NFR-012): stages are versioned config; running jobs keep their version.
  r.get('/admin/workflow', async (c) => {
    const actor = c.get('actor');
    return c.json(
      await withTenant(actor, async (tx) => {
        const wf = await getWorkflow(tx, actor.tenantId);
        const versions = await tx.select({ version: stageDefinition.version, active: stageDefinition.active, createdAt: stageDefinition.createdAt }).from(stageDefinition).orderBy(desc(stageDefinition.version));
        return { active: wf, versions };
      }),
    );
  });

  r.put('/admin/workflow/sla', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'admin.config');
    const input = await parseBody(c, z.object({ sla: z.record(z.string(), z.number().int().min(1).max(720)) }));
    const result = await withTenant(actor, async (tx) => {
      const current = await getWorkflow(tx, actor.tenantId);
      const next: WorkflowDefinition = { version: current.version + 1, stages: current.stages.map((s) => (input.sla[s.key] ? { ...s, slaHours: input.sla[s.key] } : s)) };
      await tx.update(stageDefinition).set({ active: false }).where(eq(stageDefinition.active, true));
      await tx.insert(stageDefinition).values({ id: uuidv7(), tenantId: actor.tenantId, version: next.version, definition: next, active: true, createdBy: actor.userId });
      await audit(tx, actor, c.get('meta'), { action: 'workflow.published', entityType: 'stage_definition', after: { version: next.version, sla: input.sla } });
      return next;
    });
    return c.json(result);
  });

  r.get('/admin/workflow/default', (c) => c.json(DEFAULT_WORKFLOW));

  return r;
}
