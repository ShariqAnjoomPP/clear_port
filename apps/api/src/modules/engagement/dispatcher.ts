import { and, eq, inArray } from 'drizzle-orm';
import { channels } from '../../shared/channels';
import { definerQuery, withTenant } from '../../shared/db';
import { notification } from '../../shared/schema';

/** Sends queued outbound messages for one tenant (notify-q worker in production). */
export async function dispatchQueued(tenantId: string, limit = 50) {
  const queued = await withTenant({ tenantId, customerId: null }, (tx) =>
    tx.select().from(notification).where(and(eq(notification.status, 'QUEUED'), inArray(notification.channel, ['WHATSAPP', 'EMAIL', 'SMS']))).limit(limit),
  );
  for (const n of queued) {
    const sender = channels[n.channel as 'WHATSAPP' | 'EMAIL' | 'SMS'];
    const res = await sender.send({ recipient: n.recipient, title: n.title, body: n.body, link: (n.payload as { link?: string }).link }).catch((e: Error) => ({ ok: false as const, error: e.message }));
    await withTenant({ tenantId, customerId: null }, (tx) =>
      tx.update(notification).set(res.ok ? { status: 'SENT', sentAt: new Date() } : { status: 'FAILED', error: res.error }).where(eq(notification.id, n.id)),
    );
  }
  return queued.length;
}

export async function dispatchAllTenants() {
  const tenants = await definerQuery<{ all_tenant_ids: string }>('select platform.all_tenant_ids()', []);
  for (const t of tenants) await dispatchQueued(t.all_tenant_ids);
}
