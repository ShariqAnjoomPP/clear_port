import { Hono } from 'hono';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DriverInput, TransitionInput, TripInput, VehicleInput } from '@clearport/contracts';
import { uuidv7 } from '@clearport/kernel';
import { describeNextSteps, stageDef } from '@clearport/workflow';
import { config } from '../../config';
import { audit } from '../../shared/audit';
import { hashToken, newLinkToken } from '../../shared/auth';
import type { Consumer } from '../../shared/bus';
import type { AppEnv } from '../../shared/context';
import { definerQuery, withTenant, type Tx, type UnitOfWork } from '../../shared/db';
import { makeEvent } from '../../shared/events';
import { parseBody, protectedRouter } from '../../shared/http';
import { requirePermission } from '../../shared/policy';
import { conflict, notFound, unprocessable } from '../../shared/problem';
import { container, customer, driver, job, stageInstance, trip, tripContainer, vehicle } from '../../shared/schema';
import { requireJob } from '../clearance/public';
import { queueNotification } from '../engagement/public';
import { getWorkflow } from '../platform/public';
import { guardContext, transitionStage } from '../workflow/public';
import type { Actor } from '../../shared/context';

const today = () => new Date().toISOString().slice(0, 10);
const DRIVER_STAGES = ['TRUCK', 'RELEASE', 'DELIVERY'];

async function issueTripLink(tx: Tx, tripId: string) {
  const token = newLinkToken();
  await tx.update(trip).set({ linkTokenHash: await hashToken(token), linkExpiresAt: new Date(Date.now() + 48 * 3600_000) }).where(eq(trip.id, tripId));
  return `${config.PUBLIC_APP_URL}/trip/${token}`;
}

export function fieldRoutes() {
  const r = protectedRouter();

  // ── Drivers and vehicles (TRK-003) ──
  r.get('/drivers', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'field.read');
    return c.json({ items: await withTenant(actor, (tx) => tx.select().from(driver).where(eq(driver.active, true)).orderBy(asc(driver.name))) });
  });
  r.post('/drivers', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'field.manage');
    const input = await parseBody(c, DriverInput);
    const row = await withTenant(actor, async (tx) => {
      const [d] = await tx.insert(driver).values({ id: uuidv7(), tenantId: actor.tenantId, ...input, licenceNo: input.licenceNo ?? null, licenceExpiry: input.licenceExpiry ?? null, transporter: input.transporter ?? null, userId: input.userId ?? null }).returning();
      await audit(tx, actor, c.get('meta'), { action: 'driver.created', entityType: 'driver', entityId: d!.id, after: input });
      return d;
    });
    return c.json(row, 201);
  });
  r.get('/vehicles', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'field.read');
    return c.json({ items: await withTenant(actor, (tx) => tx.select().from(vehicle).where(eq(vehicle.active, true)).orderBy(asc(vehicle.plateNo))) });
  });
  r.post('/vehicles', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'field.manage');
    const input = await parseBody(c, VehicleInput);
    const row = await withTenant(actor, async (tx) => {
      const [v] = await tx.insert(vehicle).values({ id: uuidv7(), tenantId: actor.tenantId, ...input, registrationExpiry: input.registrationExpiry ?? null, transporter: input.transporter ?? null }).returning();
      await audit(tx, actor, c.get('meta'), { action: 'vehicle.created', entityType: 'vehicle', entityId: v!.id, after: input });
      return v;
    });
    return c.json(row, 201);
  });

  // ── Trips (TRK-001/002/004/005) ──
  r.get('/trips', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'field.read');
    const status = c.req.query('status');
    const rows = await withTenant(actor, (tx) =>
      tx.select({ t: trip, jobNo: job.jobNo, blNo: job.blNo, customerName: customer.name, driverName: driver.name, driverPhone: driver.phone, plateNo: vehicle.plateNo,
        containers: sql<string[]>`(select array_agg(ct.container_no order by ct.container_no) from fieldops.trip_container tc join clearance.container ct on ct.id = tc.container_id where tc.trip_id = ${trip.id})` })
        .from(trip).innerJoin(job, eq(job.id, trip.jobId)).innerJoin(customer, eq(customer.id, job.customerId)).innerJoin(driver, eq(driver.id, trip.driverId)).innerJoin(vehicle, eq(vehicle.id, trip.vehicleId))
        .where(status ? eq(trip.status, status) : ne(trip.status, 'CANCELLED')).orderBy(desc(trip.createdAt)).limit(200),
    );
    return c.json({ items: rows.map(({ t, ...rest }) => { const { linkTokenHash, ...safe } = t; void linkTokenHash; return { ...safe, ...rest }; }) });
  });

  /** Containers ready for a truck: CCRO issued and TRUCK still unassigned. */
  r.get('/ready-containers', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'field.read');
    const rows = await withTenant(actor, (tx) =>
      tx.select({ containerId: container.id, containerNo: container.containerNo, sizeType: container.sizeType, freeTimeExpiresAt: container.freeTimeExpiresAt, jobId: job.id, jobNo: job.jobNo, blNo: job.blNo, customerName: customer.name, portOfDischarge: job.portOfDischarge })
        .from(stageInstance).innerJoin(container, eq(container.id, stageInstance.containerId)).innerJoin(job, eq(job.id, stageInstance.jobId)).innerJoin(customer, eq(customer.id, job.customerId))
        .where(and(eq(stageInstance.stageKey, 'TRUCK'), eq(stageInstance.status, 'UNASSIGNED'), eq(job.status, 'OPEN')))
        .orderBy(asc(container.freeTimeExpiresAt)),
    );
    return c.json({ items: rows });
  });

  r.post('/trips', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'field.manage');
    const input = await parseBody(c, TripInput);
    const created = await withTenant(actor, async (tx, uow) => createTrip(tx, uow, actor, c.get('meta'), input));
    return c.json(created, 201);
  });

  r.post('/trips/:id/link', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'field.manage');
    const url = await withTenant(actor, async (tx) => {
      const [t] = await tx.select().from(trip).where(eq(trip.id, c.req.param('id')));
      if (!t || t.status === 'CANCELLED') throw notFound('Trip');
      const link = await issueTripLink(tx, t.id);
      await audit(tx, actor, c.get('meta'), { action: 'trip.link_reissued', entityType: 'trip', entityId: t.id });
      return link;
    });
    return c.json({ url });
  });

  r.post('/trips/:id/cancel', async (c) => {
    const actor = c.get('actor');
    requirePermission(actor, 'field.manage');
    const row = await withTenant(actor, async (tx) => {
      const [t] = await tx.update(trip).set({ status: 'CANCELLED', linkTokenHash: null }).where(and(eq(trip.id, c.req.param('id')), eq(trip.status, 'ASSIGNED'))).returning();
      if (!t) throw conflict('Only trips that have not started can be cancelled');
      const cids = (await tx.select().from(tripContainer).where(eq(tripContainer.tripId, t.id))).map((x) => x.containerId);
      await tx.update(stageInstance).set({ status: 'UNASSIGNED', assigneeId: null, completedAt: null }).where(and(inArray(stageInstance.containerId, cids), eq(stageInstance.stageKey, 'TRUCK'), eq(stageInstance.status, 'ASSIGNED')));
      await audit(tx, actor, c.get('meta'), { action: 'trip.cancelled', entityType: 'trip', entityId: t.id });
      return t;
    });
    return c.json(row);
  });

  return r;
}

export async function createTrip(tx: Tx, uow: UnitOfWork, actor: Actor, meta: AppEnv['Variables']['meta'] | undefined, input: z.infer<typeof TripInput>) {
  const j = await requireJob(tx, input.jobId);
  if (j.status !== 'OPEN') throw conflict('This job is closed');
  const [d] = await tx.select().from(driver).where(and(eq(driver.id, input.driverId), eq(driver.active, true)));
  const [v] = await tx.select().from(vehicle).where(and(eq(vehicle.id, input.vehicleId), eq(vehicle.active, true)));
  if (!d || !v) throw unprocessable('Driver or vehicle not found');
  if (d.licenceExpiry && d.licenceExpiry < today()) throw unprocessable(`${d.name}'s licence expired on ${d.licenceExpiry}`);
  if (v.registrationExpiry && v.registrationExpiry < today()) throw unprocessable(`${v.plateNo} registration expired on ${v.registrationExpiry}`);

  const truckStages = await tx.select().from(stageInstance).where(and(eq(stageInstance.jobId, j.id), eq(stageInstance.stageKey, 'TRUCK'), inArray(stageInstance.containerId, input.containerIds)));
  if (truckStages.length !== input.containerIds.length) throw unprocessable('All containers must be on this job and released by CCRO');
  const busy = truckStages.filter((s) => s.status !== 'UNASSIGNED');
  if (busy.length) throw conflict('Some containers already have a truck assigned');

  const id = uuidv7();
  const count = await tx.select({ n: sql<number>`count(*)::int` }).from(trip);
  const tripNo = `TR-${new Date().getUTCFullYear()}-${String((count[0]?.n ?? 0) + 1).padStart(5, '0')}`;
  await tx.insert(trip).values({
    id, tenantId: actor.tenantId, jobId: j.id, tripNo, driverId: d.id, vehicleId: v.id, inspectionAgentId: input.inspectionAgentId ?? null,
    deliveryAddress: input.deliveryAddress, deliveryContact: input.deliveryContact ?? null, deliveryWindow: input.deliveryWindow ?? null,
    status: 'ASSIGNED', cost: input.cost ?? null, currency: input.currency ?? null,
  });
  await tx.insert(tripContainer).values(input.containerIds.map((cid) => ({ tripId: id, containerId: cid, tenantId: actor.tenantId })));

  // Field staff get these stages in "My tasks"; third-party drivers act through the trip link instead.
  await tx.update(stageInstance).set({ assigneeId: d.userId }).where(and(inArray(stageInstance.containerId, input.containerIds), inArray(stageInstance.stageKey, DRIVER_STAGES)));
  if (input.inspectionAgentId) {
    await tx.update(stageInstance).set({ assigneeId: input.inspectionAgentId }).where(and(inArray(stageInstance.containerId, input.containerIds), eq(stageInstance.stageKey, 'PHYSICAL_INSPECTION')));
  }
  for (const s of truckStages) {
    await transitionStage(tx, uow, actor, meta, { jobId: j.id, stageInstanceId: s.id, skipPermission: true, input: { to: 'ASSIGNED', fields: {}, remarks: `Trip ${tripNo}: ${d.name}, ${v.plateNo}`, disbursements: [] } });
  }

  const link = await issueTripLink(tx, id);
  const conts = await tx.select({ no: container.containerNo }).from(container).where(inArray(container.id, input.containerIds));
  await queueNotification(tx, {
    tenantId: actor.tenantId, channel: 'WHATSAPP', recipient: d.phone, jobId: j.id, template: 'TRIP_ASSIGNED',
    vars: { tripNo, containers: conts.map((x) => x.no).join(', '), port: j.portOfDischarge ?? 'port', address: input.deliveryAddress }, link, dedupeKey: `trip:${id}`,
  });
  uow.emit(makeEvent(actor.tenantId, 'TripAssigned', 'trip', id, { tripId: id, jobId: j.id, tripNo, containerIds: input.containerIds, driverId: d.id }));
  await audit(tx, actor, meta, { action: 'trip.created', entityType: 'trip', entityId: id, after: { tripNo, driver: d.name, vehicle: v.plateNo, containers: input.containerIds.length } });
  return { id, tripNo, link };
}

/** Driver trip link (no account): one trip's containers, the driver's next steps, POD capture. */
export function publicTripRoutes() {
  const r = new Hono<AppEnv>();
  const resolve = async (token: string) => {
    const rows = await definerQuery<{ trip_id: string; tenant_id: string }>('select * from fieldops.resolve_trip_token($1)', [await hashToken(token)]);
    if (!rows[0]) throw notFound('Trip');
    return rows[0];
  };

  const view = async (tx: Tx, tripId: string) => {
    const [t] = await tx.select({ t: trip, driverName: driver.name, plateNo: vehicle.plateNo }).from(trip).innerJoin(driver, eq(driver.id, trip.driverId)).innerJoin(vehicle, eq(vehicle.id, trip.vehicleId)).where(eq(trip.id, tripId));
    if (!t) throw notFound('Trip');
    const j = await requireJob(tx, t.t.jobId);
    const wf = await getWorkflow(tx, j.tenantId, j.workflowVersion);
    const cids = (await tx.select().from(tripContainer).where(eq(tripContainer.tripId, tripId))).map((x) => x.containerId);
    const conts = await tx.select().from(container).where(inArray(container.id, cids));
    const all = await tx.select().from(stageInstance).where(eq(stageInstance.jobId, j.id));
    return {
      tripNo: t.t.tripNo, status: t.t.status, driverName: t.driverName, plateNo: t.plateNo, deliveryAddress: t.t.deliveryAddress, deliveryContact: t.t.deliveryContact,
      deliveryWindow: t.t.deliveryWindow, blNo: j.blNo, port: j.portOfDischarge, terminal: j.terminal,
      containers: conts.map((ct) => ({
        id: ct.id, containerNo: ct.containerNo, sizeType: ct.sizeType,
        stages: all.filter((s) => s.containerId === ct.id).map((s) => {
          const def = stageDef(wf, s.stageKey)!;
          return {
            id: s.id, key: s.stageKey, label: def.label, status: s.status, statusLabel: def.statuses.find((x) => x.key === s.status)?.label, done: !!s.completedAt, version: s.version,
            fields: def.fields ?? [],
            nextSteps: DRIVER_STAGES.includes(s.stageKey) ? describeNextSteps(wf, s.stageKey, s.status, guardContext(all, s)) : [],
          };
        }).sort((a, b) => (stageDef(wf, a.key)!.order - stageDef(wf, b.key)!.order)),
      })),
    };
  };

  r.get('/:token', async (c) => {
    const ref = await resolve(c.req.param('token'));
    return c.json(await withTenant({ tenantId: ref.tenant_id, customerId: null }, (tx) => view(tx, ref.trip_id)));
  });

  r.post('/:token/stages/:stageId/transitions', async (c) => {
    const ref = await resolve(c.req.param('token'));
    const input = await parseBody(c, TransitionInput);
    const res = await withTenant({ tenantId: ref.tenant_id, customerId: null }, async (tx, uow) => {
      const [t] = await tx.select({ t: trip, driverName: driver.name, userId: driver.userId }).from(trip).innerJoin(driver, eq(driver.id, trip.driverId)).where(eq(trip.id, ref.trip_id));
      const [s] = await tx.select().from(stageInstance).where(eq(stageInstance.id, c.req.param('stageId')));
      const cids = (await tx.select().from(tripContainer).where(eq(tripContainer.tripId, ref.trip_id))).map((x) => x.containerId);
      if (!t || !s || !s.containerId || !cids.includes(s.containerId) || !DRIVER_STAGES.includes(s.stageKey)) throw notFound('Stage');
      const actor: Actor = { kind: 'driver-link', userId: t.userId, tenantId: ref.tenant_id, name: `${t.driverName} (driver)`, roles: ['DRIVER'], customerId: null };
      await transitionStage(tx, uow, actor, c.get('meta'), { jobId: t.t.jobId, stageInstanceId: s.id, input: { ...input, disbursements: [] }, skipPermission: true });
      return view(tx, ref.trip_id);
    });
    return c.json(res);
  });
  return r;
}

/** Keeps trip status in step with its containers (IN_PROGRESS on arrival at port, COMPLETED when all delivered). */
export const tripProgress: Consumer = {
  name: 'fieldops.trip-progress',
  handles: ['StageStatusChanged'],
  async handle(event, tx) {
    const p = event.payload as { containerId?: string; stageKey: string; to: string };
    if (!p.containerId) return;
    const links = await tx.select().from(tripContainer).where(eq(tripContainer.containerId, p.containerId));
    for (const l of links) {
      const [t] = await tx.select().from(trip).where(eq(trip.id, l.tripId));
      if (!t || t.status === 'CANCELLED' || t.status === 'COMPLETED') continue;
      const cids = (await tx.select().from(tripContainer).where(eq(tripContainer.tripId, t.id))).map((x) => x.containerId);
      const deliveries = await tx.select().from(stageInstance).where(and(inArray(stageInstance.containerId, cids), eq(stageInstance.stageKey, 'DELIVERY')));
      const allDone = deliveries.length === cids.length && deliveries.every((d) => d.completedAt);
      const next = allDone ? 'COMPLETED' : p.stageKey === 'TRUCK' && p.to === 'AT_PORT' ? 'IN_PROGRESS' : t.status === 'ASSIGNED' && p.stageKey !== 'TRUCK' ? 'IN_PROGRESS' : t.status;
      if (next !== t.status) await tx.update(trip).set({ status: next, linkTokenHash: next === 'COMPLETED' ? null : t.linkTokenHash }).where(eq(trip.id, t.id));
    }
  },
};
