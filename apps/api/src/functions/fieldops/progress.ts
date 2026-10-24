import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../../lib/db';
import { stageInstance, trip, tripContainer } from '../../lib/schema';

/**
 * Keeps a trip's status in step with its containers: IN_PROGRESS once work starts at the port,
 * COMPLETED (and the driver link switched off) when every container is delivered.
 * Called directly after a container stage changes (the prototype's replacement for an event consumer).
 */
export async function syncTripStatus(tx: Tx, containerId: string) {
  const links = await tx.select().from(tripContainer).where(eq(tripContainer.containerId, containerId));
  for (const l of links) {
    const [t] = await tx.select().from(trip).where(eq(trip.id, l.tripId));
    if (!t || t.status === 'CANCELLED' || t.status === 'COMPLETED') continue;
    const ids = (await tx.select().from(tripContainer).where(eq(tripContainer.tripId, t.id))).map((x) => x.containerId);
    const stages = await tx.select().from(stageInstance).where(and(inArray(stageInstance.containerId, ids), inArray(stageInstance.stageKey, ['TRUCK', 'DELIVERY'])));
    const deliveries = stages.filter((s) => s.stageKey === 'DELIVERY');
    const allDelivered = deliveries.length === ids.length && deliveries.every((d) => d.completedAt);
    const started = stages.some((s) => s.stageKey === 'TRUCK' && s.status === 'AT_PORT');
    const next = allDelivered ? 'COMPLETED' : started ? 'IN_PROGRESS' : t.status;
    if (next !== t.status) await tx.update(trip).set({ status: next, linkToken: next === 'COMPLETED' ? null : t.linkToken }).where(eq(trip.id, t.id));
  }
}
