import { eq } from 'drizzle-orm';
import type { Tx } from '../../shared/db';
import { contact, customer } from '../../shared/schema';

/** Customer context — public facade. */
export async function getCustomer(tx: Tx, id: string) {
  const [c] = await tx.select().from(customer).where(eq(customer.id, id));
  return c;
}

export async function getCustomerContacts(tx: Tx, customerId: string) {
  return tx.select().from(contact).where(eq(contact.customerId, customerId));
}
