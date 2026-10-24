import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { TripInput } from '@clearport/contracts';
import { uuidv7 } from '@clearport/kernel';
import { stageDef } from '@clearport/workflow';
import { config } from '../../lib/config';
import type { Q, Tx } from '../../lib/db';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { container, customer, job, stageInstance, staff, trip, tripContainer, vehicle } from '../../lib/schema';
import { newLinkToken } from '../../lib/tokens';
import { notifyDriver } from '../engagement/service';
import { nextNumber, requireJob } from '../jobs/queries';
import { workflowRules } from '../settings/service';
import { getWorkflow } from '../workflow/service';
import { nextStepsFor, transitionStage } from '../workflow/stages';

/** Container stages a driver works through on the trip link. */
export const DRIVER_STAGES = ['TRUCK', 'RELEASE', 'DELIVERY'];

const today = () => new Date().toISOString().slice(0, 10);
export const tripLinkUrl = (token: string) => `${config.PUBLIC_APP_URL}/t/${token}`;

// ── vehicles ──
export async function listVehicles(q: Q, includeInactive = false) {
  return q.select().from(vehicle).where(includeInactive ? undefined : eq(vehicle.active, true)).orderBy(asc(vehicle.plateNo));
}

export async function createVehicle(q: Q, input: { plateNo: string; type: string; registrationExpiry?: string; transporter?: string }) {
  const [row] = await q.insert(vehicle).values({ id: uuidv7(), ...input }).returning();
  return row!;
}

export async function updateVehicle(q: Q, id: string, input: { active?: boolean; registrationExpiry?: string | null; transporter?: string | null; type?: string }) {
  const [row] = await q.update(vehicle).set(input).where(eq(vehicle.id, id)).returning();
  if (!row) throw notFound('Vehicle');
  return row;
}

// ── trips ──
const containerNos = sql<string[]>`coalesce((select array_agg(ct.container_no order by ct.container_no) from trip_container tc join container ct on ct.id = tc.container_id where tc.trip_id = "trip"."id"), '{}')`;
const containerIds = sql<string[]>`coalesce((select array_agg(tc.container_id) from trip_container tc where tc.trip_id = "trip"."id"), '{}')`;

/** Trips with job, driver and vehicle details. The link token is never listed; it is shown once when issued. */
export async function listTrips(q: Q, filter: { status?: string; jobId?: string } = {}) {
  const rows = await q
    .select({
      t: trip, jobNo: job.jobNo, blNo: job.blNo, customerName: customer.name, driverName: staff.name, driverPhone: staff.phone, plateNo: vehicle.plateNo,
      containers: containerNos, containerIds,
    })
    .from(trip)
    .innerJoin(job, eq(job.id, trip.jobId))
    .innerJoin(customer, eq(customer.id, job.customerId))
    .innerJoin(staff, eq(staff.id, trip.driverStaffId))
    .innerJoin(vehicle, eq(vehicle.id, trip.vehicleId))
    .where(and(
      filter.jobId ? eq(trip.jobId, filter.jobId) : undefined,
      filter.status ? eq(trip.status, filter.status) : filter.jobId ? undefined : ne(trip.status, 'CANCELLED'),
    ))
    .orderBy(desc(trip.createdAt))
    .limit(200);
  return rows.map(({ t, ...rest }) => {
    const { linkToken, ...safe } = t;
    return { ...safe, ...rest, hasLink: !!linkToken };
  });
}

/** Containers ready for a truck: CCRO issued and their truck stage still unassigned. Earliest free-time expiry first. */
export async function readyContainers(q: Q) {
  return q
    .select({
      containerId: container.id, containerNo: container.containerNo, sizeType: container.sizeType, freeTimeExpiresAt: container.freeTimeExpiresAt,
      jobId: job.id, jobNo: job.jobNo, blNo: job.blNo, customerName: customer.name, portOfDischarge: job.portOfDischarge,
    })
    .from(stageInstance)
    .innerJoin(container, eq(container.id, stageInstance.containerId))
    .innerJoin(job, eq(job.id, stageInstance.jobId))
    .innerJoin(customer, eq(customer.id, job.customerId))
    .where(and(eq(stageInstance.stageKey, 'TRUCK'), eq(stageInstance.status, 'UNASSIGNED'), eq(job.status, 'OPEN')))
    .orderBy(asc(container.freeTimeExpiresAt), asc(container.containerNo));
}

/**
 * Assigns a driver and vehicle to one or more containers of a job: checks documents are valid, gives the driver
 * the truck/release/delivery stages, moves the truck stage to Assigned, and issues the driver's no-login link.
 */
export async function createTrip(tx: Tx, actorName: string, input: TripInput) {
  const j = await requireJob(tx, input.jobId);
  if (j.status !== 'OPEN') throw conflict('This job is closed');
  const [d] = await tx.select().from(staff).where(and(eq(staff.id, input.driverId), eq(staff.role, 'DRIVER'), eq(staff.active, true)));
  const [v] = await tx.select().from(vehicle).where(and(eq(vehicle.id, input.vehicleId), eq(vehicle.active, true)));
  if (!d || !v) throw unprocessable('Driver or vehicle not found');
  if (d.licenceExpiry && d.licenceExpiry < today()) throw unprocessable(`${d.name}'s licence expired on ${d.licenceExpiry}`);
  if (v.registrationExpiry && v.registrationExpiry < today()) throw unprocessable(`${v.plateNo} registration expired on ${v.registrationExpiry}`);
  if (input.inspectionAgentId) {
    const [insp] = await tx.select().from(staff).where(and(eq(staff.id, input.inspectionAgentId), eq(staff.active, true)));
    if (!insp) throw unprocessable('Inspection agent not found');
  }

  const truckStages = await tx.select().from(stageInstance).where(and(eq(stageInstance.jobId, j.id), eq(stageInstance.stageKey, 'TRUCK'), inArray(stageInstance.containerId, input.containerIds)));
  if (truckStages.length !== input.containerIds.length) throw unprocessable('All containers must be on this job and released by the port');
  if (truckStages.some((s) => s.status !== 'UNASSIGNED')) throw conflict('Some containers already have a truck assigned');

  const id = uuidv7();
  const tripNo = await nextNumber(tx, 'trip', 'TR');
  const token = newLinkToken();
  await tx.insert(trip).values({
    id, jobId: j.id, tripNo, driverStaffId: d.id, vehicleId: v.id, inspectorStaffId: input.inspectionAgentId ?? null,
    deliveryAddress: input.deliveryAddress, deliveryContact: input.deliveryContact ?? null, deliveryWindow: input.deliveryWindow ?? null,
    cost: input.cost ?? null, currency: input.currency ?? null, linkToken: token,
  });
  await tx.insert(tripContainer).values(input.containerIds.map((containerId) => ({ tripId: id, containerId })));

  await tx.update(stageInstance).set({ assigneeStaffId: d.id }).where(and(inArray(stageInstance.containerId, input.containerIds), inArray(stageInstance.stageKey, DRIVER_STAGES)));
  if (input.inspectionAgentId) {
    await tx.update(stageInstance).set({ assigneeStaffId: input.inspectionAgentId }).where(and(inArray(stageInstance.containerId, input.containerIds), eq(stageInstance.stageKey, 'PHYSICAL_INSPECTION')));
  }
  for (const s of truckStages) {
    await transitionStage(tx, actorName, { jobId: j.id, stageInstanceId: s.id, input: { to: 'ASSIGNED', fields: {}, remarks: `Trip ${tripNo}: ${d.name}, ${v.plateNo}`, disbursements: [] } });
  }
  const link = tripLinkUrl(token);
  const nos = (await tx.select({ no: container.containerNo }).from(container).where(inArray(container.id, input.containerIds))).map((x) => x.no);
  await notifyDriver(tx, d.phone, j.id, { tripNo, containers: nos.join(', '), port: j.portOfDischarge ?? 'port', address: input.deliveryAddress }, link);
  return { id, tripNo, link };
}

/** A fresh driver link; the previous one stops working. */
export async function reissueLink(q: Q, tripId: string) {
  const token = newLinkToken();
  const [t] = await q.update(trip).set({ linkToken: token }).where(and(eq(trip.id, tripId), inArray(trip.status, ['ASSIGNED', 'IN_PROGRESS']))).returning();
  if (!t) throw notFound('Active trip');
  return tripLinkUrl(token);
}

/** Only a trip that has not started can be cancelled; its containers go back to "ready for truck". */
export async function cancelTrip(tx: Tx, tripId: string) {
  const [t] = await tx.update(trip).set({ status: 'CANCELLED', linkToken: null }).where(and(eq(trip.id, tripId), eq(trip.status, 'ASSIGNED'))).returning();
  if (!t) throw conflict('Only trips that have not started can be cancelled');
  const ids = (await tx.select().from(tripContainer).where(eq(tripContainer.tripId, t.id))).map((x) => x.containerId);
  await tx
    .update(stageInstance)
    .set({ status: 'UNASSIGNED', assigneeStaffId: null, completedAt: null, updatedAt: new Date() })
    .where(and(inArray(stageInstance.containerId, ids), eq(stageInstance.stageKey, 'TRUCK'), eq(stageInstance.status, 'ASSIGNED')));
  return t;
}

// ── driver link (public, no login) ──
export async function tripByToken(q: Q, token: string) {
  const [row] = await q
    .select({ t: trip, driverName: staff.name, plateNo: vehicle.plateNo })
    .from(trip)
    .innerJoin(staff, eq(staff.id, trip.driverStaffId))
    .innerJoin(vehicle, eq(vehicle.id, trip.vehicleId))
    .where(eq(trip.linkToken, token));
  if (!row) throw notFound('Trip (the link may have expired or been replaced)');
  return row;
}

async function tripWithDriver(q: Q, tripId: string) {
  const [row] = await q
    .select({ t: trip, driverName: staff.name, plateNo: vehicle.plateNo })
    .from(trip)
    .innerJoin(staff, eq(staff.id, trip.driverStaffId))
    .innerJoin(vehicle, eq(vehicle.id, trip.vehicleId))
    .where(eq(trip.id, tripId));
  if (!row) throw notFound('Trip');
  return row;
}

/** What the driver sees: the trip, its containers and the next step for each container. */
export async function driverView(q: Q, token: string) {
  return tripView(q, (await tripByToken(q, token)).t.id);
}

/**
 * Built from the trip id, not the token: after the last delivery the trip completes and its link is switched off,
 * but the driver still gets the final state back.
 */
export async function tripView(q: Q, tripId: string) {
  const { t, driverName, plateNo } = await tripWithDriver(q, tripId);
  const j = await requireJob(q, t.jobId);
  const wf = await getWorkflow(q, j.workflowVersion);
  const ids = (await q.select().from(tripContainer).where(eq(tripContainer.tripId, t.id))).map((x) => x.containerId);
  const conts = await q.select().from(container).where(inArray(container.id, ids)).orderBy(asc(container.containerNo));
  const all = await q.select().from(stageInstance).where(eq(stageInstance.jobId, j.id));
  const active = t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS';
  const rules = await workflowRules(q);
  return {
    tripNo: t.tripNo, status: t.status, driverName, plateNo, deliveryAddress: t.deliveryAddress, deliveryContact: t.deliveryContact,
    deliveryWindow: t.deliveryWindow, blNo: j.blNo, port: j.portOfDischarge, terminal: j.terminal,
    containers: conts.map((ct) => ({
      id: ct.id, containerNo: ct.containerNo, sizeType: ct.sizeType,
      stages: all
        .filter((s) => s.containerId === ct.id)
        .map((s) => {
          const def = stageDef(wf, s.stageKey)!;
          return {
            id: s.id, key: s.stageKey, order: def.order, label: def.label, status: s.status, statusLabel: def.statuses.find((x) => x.key === s.status)?.label,
            done: !!s.completedAt, fields: def.fields ?? [],
            // A finished trip's link is closed, so it offers no more steps (an empty return is recorded from the office).
            nextSteps: DRIVER_STAGES.includes(s.stageKey) && j.status === 'OPEN' && active ? nextStepsFor(wf, all, s, rules) : [],
          };
        })
        .sort((a, b) => a.order - b.order),
    })),
  };
}

/** A driver moves one of their own containers' truck, release or delivery stages. Anything else is not found. Returns the trip id. */
export async function driverTransition(tx: Tx, token: string, stageInstanceId: string, input: { to: string; fields: Record<string, unknown>; remarks?: string }) {
  const { t, driverName } = await tripByToken(tx, token);
  const [s] = await tx.select().from(stageInstance).where(eq(stageInstance.id, stageInstanceId));
  const ids = (await tx.select().from(tripContainer).where(eq(tripContainer.tripId, t.id))).map((x) => x.containerId);
  if (!s?.containerId || !ids.includes(s.containerId) || !DRIVER_STAGES.includes(s.stageKey)) throw notFound('Stage');
  await transitionStage(tx, `${driverName} (driver)`, { jobId: t.jobId, stageInstanceId: s.id, input: { ...input, disbursements: [] } });
  return t.id;
}
