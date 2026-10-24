import { z } from 'zod';
import { TripInput, VehicleInput } from '@clearport/contracts';
import { db, transaction } from '../../lib/db';
import { createFunction, parseBody } from '../../lib/http';
import { cancelTrip, createTrip, createVehicle, listTrips, listVehicles, readyContainers, reissueLink, updateVehicle } from './service';

const app = createFunction();

// ── Vehicles (drivers are staff with the DRIVER role, managed in settings) ──
app.get('/vehicles', async (c) => c.json({ items: await listVehicles(db, c.req.query('all') === '1') }));
app.post('/vehicles', async (c) => {
  const input = await parseBody(c, VehicleInput);
  return c.json(await createVehicle(db, input), 201);
});
app.patch('/vehicles/:id', async (c) => {
  const input = await parseBody(c, z.object({ active: z.boolean().optional(), registrationExpiry: z.iso.date().nullable().optional(), transporter: z.string().trim().max(120).nullable().optional(), type: z.string().trim().min(2).max(40).optional() }));
  return c.json(await updateVehicle(db, c.req.param('id'), input));
});

// ── Trips ──
app.get('/ready-containers', async (c) => c.json({ items: await readyContainers(db) }));
app.get('/trips', async (c) => c.json({ items: await listTrips(db, { status: c.req.query('status'), jobId: c.req.query('jobId') }) }));
app.post('/trips', async (c) => {
  const input = await parseBody(c, TripInput);
  return c.json(await transaction((tx) => createTrip(tx, c.get('user').name, input)), 201);
});
app.post('/trips/:id/link', async (c) => c.json({ url: await reissueLink(db, c.req.param('id')) }));
app.post('/trips/:id/cancel', async (c) => c.json(await transaction((tx) => cancelTrip(tx, c.req.param('id')))));

export default app;
