import { and, asc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import type { CustomerInput, NewCustomerInput } from '@clearport/contracts';
import { uuidv7 } from '@clearport/kernel';
import type { Q } from '../../lib/db';
import { notFound, unprocessable } from '../../lib/errors';
import { customer, type Contact } from '../../lib/schema';
import { newLinkToken } from '../../lib/tokens';

export type CustomerRow = typeof customer.$inferSelect;

export async function getCustomer(q: Q, id: string) {
  const [row] = await q.select().from(customer).where(eq(customer.id, id));
  return row;
}

export async function requireCustomer(q: Q, id: string) {
  const row = await getCustomer(q, id);
  if (!row || row.archivedAt) throw unprocessable('Customer not found');
  return row;
}

export async function listCustomers(q: Q, search?: string) {
  const term = search?.trim();
  return q
    .select({
      id: customer.id, name: customer.name, customsCode: customer.customsCode, preferredChannel: customer.preferredChannel,
      creditLimit: customer.creditLimit, creditDays: customer.creditDays, tariff: customer.tariff,
      // Outer column written out in full: a bare ${customer.id} renders as "id", which the subquery would resolve to job.id.
      openJobs: sql<number>`(select count(*)::int from job j where j.customer_id = "customer"."id" and j.status = 'OPEN')`,
      contacts: customer.contacts,
    })
    .from(customer)
    // Name, customs code, or any contact's name, phone or email.
    .where(and(isNull(customer.archivedAt), term ? or(ilike(customer.name, `%${term}%`), ilike(customer.customsCode, `%${term}%`), sql`${customer.contacts}::text ilike ${`%${term}%`}`) : undefined))
    .orderBy(asc(customer.name))
    .limit(200);
}

const toRow = (input: CustomerInput) => {
  const { contacts, ...rest } = input;
  return {
    ...rest,
    creditLimit: rest.creditLimit ?? null,
    tariff: rest.tariff ?? null,
    contacts: contacts.map((c): Contact => ({ ...c, id: c.id ?? uuidv7() })),
  };
};

export async function createCustomer(q: Q, input: CustomerInput) {
  const [row] = await q.insert(customer).values({ id: uuidv7(), ...toRow(input), portalToken: newLinkToken() }).returning();
  return row!;
}

/** Turns the short "new customer" form from Create job into a full customer record (one contact if any contact detail was given). */
export function fromNewCustomer(input: NewCustomerInput): CustomerInput {
  const { contactName, phone, email, whatsappOptIn, ...rest } = input;
  const contacts = contactName || phone || email ? [{ name: contactName ?? rest.name, phone, email, whatsappOptIn }] : [];
  return { ...rest, contacts } as CustomerInput;
}

const digits = (v: string) => v.replace(/\D/g, '').slice(-9);

/**
 * Possible duplicates while someone types a new customer: same name ignoring case and common suffixes,
 * a name that contains the other, or the same phone number (last 9 digits, so +971 and 0 prefixes match).
 */
export async function findSimilarCustomers(q: Q, input: { name?: string; phone?: string }) {
  const name = input.name?.trim().toLowerCase().replace(/\b(llc|fze|fzco|l\.l\.c\.?|co|ltd|trading)\b\.?/g, '').replace(/\s+/g, ' ').trim();
  const phone = input.phone ? digits(input.phone) : '';
  if ((!name || name.length < 3) && phone.length < 7) return [];
  return q
    .select({ id: customer.id, name: customer.name, contacts: customer.contacts })
    .from(customer)
    .where(and(isNull(customer.archivedAt), or(
      name && name.length >= 3 ? ilike(customer.name, `%${name}%`) : undefined,
      phone.length >= 7 ? sql`regexp_replace(${customer.contacts}::text, '[^0-9]', '', 'g') like ${`%${phone}%`}` : undefined,
    )))
    .orderBy(asc(customer.name))
    .limit(5);
}

export async function updateCustomer(q: Q, id: string, input: CustomerInput) {
  const [row] = await q.update(customer).set(toRow(input)).where(eq(customer.id, id)).returning();
  if (!row) throw notFound('Customer');
  return row;
}

/** Customer 360: the numbers shown on the customer card. */
export async function customerStats(q: Q, id: string) {
  const r = await q.execute<{ open_jobs: number; containers_in_progress: number; outstanding: string | null; avg_days: string | null }>(sql`
    select
      (select count(*)::int from job where customer_id = ${id} and status = 'OPEN') as open_jobs,
      (select count(*)::int from container ct join job j on j.id = ct.job_id where j.customer_id = ${id} and ct.active) as containers_in_progress,
      (select sum(total) from invoice where customer_id = ${id} and status = 'ISSUED') as outstanding,
      (select avg(extract(epoch from (closed_at - created_at)) / 86400) from job where customer_id = ${id} and closed_at is not null) as avg_days`);
  return r.rows[0]!;
}

/** Warn before opening a job for a customer over their credit limit (issued invoices + unbilled payments). */
export async function creditCheck(q: Q, id: string) {
  const cust = await getCustomer(q, id);
  if (!cust) throw notFound('Customer');
  const r = await q.execute<{ outstanding: string; unbilled: string }>(sql`
    select (select coalesce(sum(total), 0) from invoice where customer_id = ${id} and status = 'ISSUED') as outstanding,
           (select coalesce(sum(d.amount), 0) from disbursement d join job j on j.id = d.job_id
             where j.customer_id = ${id} and d.billable and d.invoice_id is null and d.status <> 'REVERSED') as unbilled`);
  const exposure = Number(r.rows[0]?.outstanding ?? 0) + Number(r.rows[0]?.unbilled ?? 0);
  const limit = cust.creditLimit ? Number(cust.creditLimit) : null;
  return { exposure: exposure.toFixed(3), creditLimit: cust.creditLimit, overLimit: limit !== null && exposure > limit };
}
