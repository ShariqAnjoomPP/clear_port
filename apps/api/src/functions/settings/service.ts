import { and, asc, eq } from 'drizzle-orm';
import type { CompanyInput, StaffInput } from '@clearport/contracts';
import { uuidv7 } from '@clearport/kernel';
import type { Q } from '../../lib/db';
import { notFound } from '../../lib/errors';
import { companySettings, masterItem, staff } from '../../lib/schema';

// ── company ──
export async function getCompany(q: Q) {
  const [row] = await q.select().from(companySettings).where(eq(companySettings.id, 1));
  if (!row) throw notFound('Company settings (run `npm run db:reset`)');
  return row;
}

/** Whether steps are assigned to individual staff (teams) or not (one person does everything). */
export async function assignStepsEnabled(q: Q) {
  return (await getCompany(q)).assignSteps;
}

/** How the workflow is run for this agency: per-step assignment and strict one-by-one order. */
export async function workflowRules(q: Q) {
  const c = await getCompany(q);
  return { assignSteps: c.assignSteps, sequential: c.sequentialSteps };
}

export async function updateCompany(q: Q, input: CompanyInput) {
  const [row] = await q
    .update(companySettings)
    .set({ ...input, vatPct: String(input.vatPct), phone: input.phone || null, whatsapp: input.whatsapp || null, email: input.email || null, updatedAt: new Date() })
    .where(eq(companySettings.id, 1))
    .returning();
  return row!;
}

// ── staff ──
export type StaffRow = typeof staff.$inferSelect;

export async function listStaff(q: Q, filter: { role?: string; includeInactive?: boolean } = {}) {
  const conditions = [filter.role ? eq(staff.role, filter.role) : undefined, filter.includeInactive ? undefined : eq(staff.active, true)];
  return q.select().from(staff).where(and(...conditions)).orderBy(asc(staff.name));
}

export async function getStaff(q: Q, id: string) {
  const [row] = await q.select().from(staff).where(eq(staff.id, id));
  return row;
}

export async function requireStaff(q: Q, id: string) {
  const row = await getStaff(q, id);
  if (!row?.active) throw notFound('Staff member');
  return row;
}

export async function createStaff(q: Q, input: StaffInput) {
  const [row] = await q.insert(staff).values({ id: uuidv7(), ...input }).returning();
  return row!;
}

export async function updateStaff(q: Q, id: string, input: Partial<StaffInput> & { active?: boolean }) {
  const [row] = await q.update(staff).set(input).where(eq(staff.id, id)).returning();
  if (!row) throw notFound('Staff member');
  return row;
}

// ── master data ──
export async function listMaster(q: Q, kind?: string) {
  return q
    .select()
    .from(masterItem)
    .where(and(eq(masterItem.active, true), kind ? eq(masterItem.kind, kind) : undefined))
    .orderBy(asc(masterItem.kind), asc(masterItem.name));
}

export async function createMaster(q: Q, input: { kind: string; code: string; name: string; data: Record<string, unknown> }) {
  const [row] = await q.insert(masterItem).values({ id: uuidv7(), ...input }).returning();
  return row!;
}

export async function archiveMaster(q: Q, id: string) {
  const [row] = await q.update(masterItem).set({ active: false }).where(eq(masterItem.id, id)).returning();
  if (!row) throw notFound('Item');
}
