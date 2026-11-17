import { afterAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { FUNCTIONS } from '../src/functions';
import { pool } from '../src/lib/db';

/**
 * Milestone 3: trips. Uses seeded job HLCUSOH250901 (port release issued; two containers still waiting for a truck).
 * Covers assignment checks, the driver's no-login link, proof of delivery, trip status and cancellation.
 */
const app = new Hono();
for (const [name, fn] of Object.entries(FUNCTIONS)) app.route(`/api/${name}`, fn);

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await app.request(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}
const SIGNATURE = 'data:image/png;base64,iVBORw0KGgo=';

afterAll(() => pool.end());

describe('trips and the driver link', () => {
  let jobId = '';
  let ready: Json[] = [];
  let driverId = '';
  let vehicleId = '';
  let token = '';
  let tripId = '';

  it('lists containers waiting for a truck, earliest free time first', async () => {
    const r = await call('GET', '/fieldops/ready-containers');
    ready = r.json.items.filter((x: Json) => x.blNo === 'HLCUSOH250901');
    expect(ready).toHaveLength(2);
    jobId = ready[0]!.jobId;
    const drivers = await call('GET', '/settings/staff?role=DRIVER');
    driverId = drivers.json.items.find((d: Json) => d.name === 'Bilal Ahmed').id;
    vehicleId = (await call('GET', '/fieldops/vehicles')).json.items[0].id;
  });

  it('refuses a driver whose licence has expired', async () => {
    const expired = await call('POST', '/settings/staff', { name: 'Old Licence', role: 'DRIVER', licenceExpiry: '2020-01-01' });
    const r = await call('POST', '/fieldops/trips', { jobId, containerIds: [ready[0]!.containerId], driverId: expired.json.id, vehicleId, deliveryAddress: 'Warehouse 1' });
    expect(r.status).toBe(422);
    expect(r.json.detail).toContain('licence expired');
  });

  it('creates a trip: truck stage assigned, driver owns the driver stages, link issued', async () => {
    const r = await call('POST', '/fieldops/trips', { jobId, containerIds: [ready[0]!.containerId], driverId, vehicleId, deliveryAddress: 'Warehouse 1, Sohar Industrial Estate', cost: '500', currency: 'OMR' });
    expect(r.status).toBe(201);
    expect(r.json.tripNo).toMatch(/^TR-\d{4}-\d{5}$/);
    expect(r.json.link).toMatch(/\/t\/[\w-]{20,}$/);
    token = r.json.link.split('/t/')[1];
    tripId = r.json.id;

    const again = await call('POST', '/fieldops/trips', { jobId, containerIds: [ready[0]!.containerId], driverId, vehicleId, deliveryAddress: 'x y z' });
    expect(again.status).toBe(409); // already has a truck

    const stages = (await call('GET', `/workflow/jobs/${jobId}/stages`)).json.containerStages[ready[0]!.containerId] as Json[];
    expect(stages.find((s) => s.key === 'TRUCK')!.status).toBe('ASSIGNED');
    for (const key of ['TRUCK', 'RELEASE', 'DELIVERY']) expect(stages.find((s) => s.key === key)!.assignee.id).toBe(driverId);

    const list = (await call('GET', '/fieldops/trips')).json.items;
    expect(list.find((t: Json) => t.id === tripId)).toMatchObject({ status: 'ASSIGNED', hasLink: true, driverName: 'Bilal Ahmed' });
    expect(list.find((t: Json) => t.id === tripId).linkToken).toBeUndefined();
  });

  it('lets the driver work through their container without logging in', async () => {
    const view = await call('GET', `/public/trips/${token}`);
    expect(view.status).toBe(200);
    expect(view.json.containers).toHaveLength(1);
    const stageOf = (v: Json, key: string) => (v.containers[0].stages as Json[]).find((s) => s.key === key)!;

    // Not a driver stage: hidden behind "not found".
    const insp = stageOf(view.json, 'PHYSICAL_INSPECTION');
    expect((await call('POST', `/public/trips/${token}/stages/${insp.id}/transitions`, { to: 'SCHEDULED' })).status).toBe(404);

    let v = view.json;
    for (const [key, to] of [['TRUCK', 'AT_PORT'], ['RELEASE', 'RELEASED'], ['RELEASE', 'GATED_OUT'], ['DELIVERY', 'IN_TRANSIT']] as const) {
      const r = await call('POST', `/public/trips/${token}/stages/${stageOf(v, key).id}/transitions`, { to });
      expect(r.status, `${key} → ${to}`).toBe(200);
      v = r.json;
    }
    expect(v.status).toBe('IN_PROGRESS');

    const noPod = await call('POST', `/public/trips/${token}/stages/${stageOf(v, 'DELIVERY').id}/transitions`, { to: 'DELIVERED' });
    expect(noPod.status).toBe(422); // receiver name and signature required
    const pod = await call('POST', `/public/trips/${token}/stages/${stageOf(v, 'DELIVERY').id}/transitions`, { to: 'DELIVERED', fields: { receiverName: 'Store keeper', podSignature: SIGNATURE } });
    expect(pod.status).toBe(200);
    expect(pod.json.status).toBe('COMPLETED');
    expect(pod.json.containers[0].stages.every((st: Json) => st.nextSteps.length === 0)).toBe(true); // no buttons on a closed link
  });

  it('switches the link off once the trip is completed, and records the driver in the timeline', async () => {
    expect((await call('GET', `/public/trips/${token}`)).status).toBe(404);
    const tl = (await call('GET', `/jobs/${jobId}/timeline`)).json.items as Json[];
    expect(tl.some((i) => i.actor === 'Bilal Ahmed (driver)' && i.title.includes('Delivered'))).toBe(true);
    // The signature is stored on the stage, not copied into the history.
    const stages = (await call('GET', `/workflow/jobs/${jobId}/stages`)).json.containerStages[ready[0]!.containerId] as Json[];
    expect(stages.find((s) => s.key === 'DELIVERY')!.data.podSignature).toBe(SIGNATURE);
  });

  it('cancels a trip that has not started and frees its container', async () => {
    const r = await call('POST', '/fieldops/trips', { jobId, containerIds: [ready[1]!.containerId], driverId, vehicleId, deliveryAddress: 'Warehouse 2' });
    const oldToken = r.json.link.split('/t/')[1];
    const relink = await call('POST', `/fieldops/trips/${r.json.id}/link`);
    expect((await call('GET', `/public/trips/${oldToken}`)).status).toBe(404); // replaced
    expect((await call('GET', `/public/trips/${relink.json.url.split('/t/')[1]}`)).status).toBe(200);

    expect((await call('POST', `/fieldops/trips/${r.json.id}/cancel`)).status).toBe(200);
    const stillReady = (await call('GET', '/fieldops/ready-containers')).json.items.map((x: Json) => x.containerId);
    expect(stillReady).toContain(ready[1]!.containerId);
    expect((await call('POST', `/fieldops/trips/${tripId}/cancel`)).status).toBe(409); // completed trips cannot be cancelled
  });
});
