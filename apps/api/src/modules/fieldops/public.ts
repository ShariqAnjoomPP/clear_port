import { eq, inArray } from 'drizzle-orm';
import type { Tx } from '../../shared/db';
import { driver, trip, tripContainer, vehicle } from '../../shared/schema';

/** Field operations — public facade. */
export async function listTripsForJob(tx: Tx, jobId: string) {
  const trips = await tx.select({ t: trip, driverName: driver.name, driverPhone: driver.phone, plateNo: vehicle.plateNo })
    .from(trip).innerJoin(driver, eq(driver.id, trip.driverId)).innerJoin(vehicle, eq(vehicle.id, trip.vehicleId)).where(eq(trip.jobId, jobId));
  const links = trips.length ? await tx.select().from(tripContainer).where(inArray(tripContainer.tripId, trips.map((t) => t.t.id))) : [];
  return trips.map(({ t, ...rest }) => {
    const { linkTokenHash, ...safe } = t;
    void linkTokenHash;
    return { ...safe, ...rest, containerIds: links.filter((l) => l.tripId === t.id).map((l) => l.containerId) };
  });
}
