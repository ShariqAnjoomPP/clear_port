import { and, asc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { CustomerInput } from '@clearport/contracts';
import { uuidv7 } from '@clearport/kernel';
import { audit } from '../../shared/audit';
import { withTenant } from '../../shared/db';
import { ifMatchVersion, parseBody, protectedRouter } from '../../shared/http';
import { requirePermission } from '../../shared/policy';
import { notFound, preconditionFailed } from '../../shared/problem';
import { contact, customer, job } from '../../shared/schema';

export function customerRoutes() {
  const r = protectedRouter();

  r.get('/', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'customer.read');
    const q = c.req.query('q')?.trim();
    const items = await withTenant(actor, (tx) =>
      tx
        .select({
          id: customer.id, name: customer.name, customsCode: customer.customsCode, preferredChannel: customer.preferredChannel,
          creditLimit: customer.creditLimit, creditDays: customer.creditDays, tariff: customer.tariff,
          openJobs: sql<number>`(select count(*)::int from clearance.job j where j.customer_id = ${customer.id} and j.status = 'OPEN')`,
        })
        .from(customer)
        .where(and(isNull(customer.archivedAt), q ? or(ilike(customer.name, `%${q}%`), ilike(customer.customsCode, `%${q}%`)) : undefined))
        .orderBy(asc(customer.name))
        .limit(200),
    );
    return c.json({ items });
  });

  r.get('/:id', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'customer.read');
    const result = await withTenant(actor, async (tx) => {
      const [cust] = await tx.select().from(customer).where(eq(customer.id, c.req.param('id')));
      if (!cust) throw notFound('Customer');
      const contacts = await tx.select().from(contact).where(eq(contact.customerId, cust.id));
      // Customer 360 (CUS-004)
      const [stats] = await tx.execute<{ open_jobs: number; containers_in_progress: number; outstanding: string | null; avg_days: string | null }>(sql`
        select
          (select count(*)::int from clearance.job where customer_id = ${cust.id} and status = 'OPEN') as open_jobs,
          (select count(*)::int from clearance.container ct join clearance.job j on j.id = ct.job_id where j.customer_id = ${cust.id} and ct.active) as containers_in_progress,
          (select sum(total) from finance.invoice where customer_id = ${cust.id} and status = 'ISSUED') as outstanding,
          (select avg(extract(epoch from (closed_at - created_at)) / 86400) from clearance.job where customer_id = ${cust.id} and closed_at is not null) as avg_days
      `).then((r) => r.rows);
      return { ...cust, contacts, stats };
    });
    c.header('etag', `"${result.version}"`);
    return c.json(result);
  });

  r.post('/', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'customer.manage');
    const input = await parseBody(c, CustomerInput);
    const created = await withTenant(actor, async (tx) => {
      const id = uuidv7();
      const { contacts, ...rest } = input;
      const [cust] = await tx.insert(customer).values({ id, tenantId: actor.tenantId, ...rest, creditLimit: rest.creditLimit ?? null, tariff: rest.tariff ?? null }).returning();
      if (contacts.length) await tx.insert(contact).values(contacts.map((ct) => ({ ...ct, id: uuidv7(), tenantId: actor.tenantId, customerId: id })));
      await audit(tx, actor, c.get('meta'), { action: 'customer.created', entityType: 'customer', entityId: id, after: rest });
      return cust!;
    });
    return c.json(created, 201);
  });

  r.put('/:id', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'customer.manage');
    const input = await parseBody(c, CustomerInput);
    const expected = ifMatchVersion(c);
    const updated = await withTenant(actor, async (tx) => {
      const [before] = await tx.select().from(customer).where(eq(customer.id, c.req.param('id')));
      if (!before) throw notFound('Customer');
      if (expected !== undefined && expected !== before.version) throw preconditionFailed();
      const { contacts, ...rest } = input;
      const [after] = await tx.update(customer).set({ ...rest, creditLimit: rest.creditLimit ?? null, tariff: rest.tariff ?? null, version: before.version + 1 }).where(eq(customer.id, before.id)).returning();
      await tx.delete(contact).where(eq(contact.customerId, before.id));
      if (contacts.length) await tx.insert(contact).values(contacts.map((ct) => ({ ...ct, id: ct.id ?? uuidv7(), tenantId: actor.tenantId, customerId: before.id })));
      await audit(tx, actor, c.get('meta'), { action: 'customer.updated', entityType: 'customer', entityId: before.id, before, after });
      return after!;
    });
    return c.json(updated);
  });

  r.get('/:id/credit-check', async (c) => {
    // CUS-005: warn before opening a BL for a customer over their credit limit.
    const actor = c.get('actor');
    requirePermission(actor, 'customer.read');
    const res = await withTenant(actor, async (tx) => {
      const [cust] = await tx.select().from(customer).where(eq(customer.id, c.req.param('id')));
      if (!cust) throw notFound('Customer');
      const rows = await tx.execute<{ outstanding: string | null; unbilled: string | null }>(sql`
        select (select coalesce(sum(total),0) from finance.invoice where customer_id = ${cust.id} and status = 'ISSUED') as outstanding,
               (select coalesce(sum(d.amount),0) from finance.disbursement d join clearance.job j on j.id = d.job_id
                 where j.customer_id = ${cust.id} and d.billable and d.invoice_id is null and d.status <> 'REVERSED') as unbilled`);
      const exposure = Number(rows.rows[0]?.outstanding ?? 0) + Number(rows.rows[0]?.unbilled ?? 0);
      const limit = cust.creditLimit ? Number(cust.creditLimit) : null;
      return { exposure: exposure.toFixed(3), creditLimit: cust.creditLimit, overLimit: limit !== null && exposure > limit };
    });
    return c.json(res);
  });

  void job;
  return r;
}
