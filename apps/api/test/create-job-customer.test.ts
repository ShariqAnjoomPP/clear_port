import { afterAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { containerCheckDigit } from '@clearport/kernel';
import { FUNCTIONS } from '../src/functions';
import { pool } from '../src/lib/db';

/** Customers are created while opening a job (or an existing one is picked), plus search and the Home summary. */
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
let serial = 700000;
const box = () => {
  const base = `TSTU${serial++}`;
  return `${base}${containerCheckDigit(base)}`;
};
const blFields = (bl: string, containers = [box(), box()]) => ({ blNo: bl, eta: '2026-10-25', commodity: 'Office furniture', containers: containers.map((containerNo) => ({ containerNo })) });

afterAll(() => pool.end());

describe('create job with a new customer', () => {
  it('creates the customer and the job together', async () => {
    const r = await call('POST', '/jobs', {
      ...blFields('NEWCUST0001'),
      newCustomer: { name: 'Sahara Furniture Trading', contactName: 'Omar Saeed', phone: '+971 55 123 4567', email: 'omar@sahara.example', whatsappOptIn: true, preferredChannel: 'WHATSAPP' },
    });
    expect(r.status).toBe(201);
    const job = (await call('GET', `/jobs/${r.json.id}`)).json;
    expect(job.customer.name).toBe('Sahara Furniture Trading');
    const cust = (await call('GET', `/customers/${job.customer.id}`)).json;
    expect(cust.contacts).toHaveLength(1);
    expect(cust.contacts[0]).toMatchObject({ name: 'Omar Saeed', phone: '+971 55 123 4567', whatsappOptIn: true });
    expect(cust.portalUrl).toMatch(/\/p\//);
  });

  it('requires exactly one of: existing customer or new customer', async () => {
    const existing = (await call('GET', '/customers?q=Sahara')).json.items[0].id;
    const both = await call('POST', '/jobs', { ...blFields('NEWCUST0002'), customerId: existing, newCustomer: { name: 'Someone Else' } });
    expect(both.status).toBe(400);
    const neither = await call('POST', '/jobs', blFields('NEWCUST0003'));
    expect(neither.status).toBe(400);
    const picked = await call('POST', '/jobs', { ...blFields('NEWCUST0004'), customerId: existing });
    expect(picked.status).toBe(201);
    expect((await call('GET', `/jobs?customerId=${existing}`)).json.items).toHaveLength(2);
  });

  it('creates nothing when the job fails (no orphan customer)', async () => {
    const taken = box();
    await call('POST', '/jobs', { ...blFields('NEWCUST0005', [taken]), newCustomer: { name: 'First Box Owner LLC' } });
    const clash = await call('POST', '/jobs', { ...blFields('NEWCUST0006', [taken]), newCustomer: { name: 'Orphan Check Imports' } });
    expect(clash.status).toBe(409); // container already on an open job
    expect((await call('GET', '/customers?q=Orphan Check')).json.items).toHaveLength(0);
  });
});

describe('validation messages', () => {
  it('name the field in plain words', async () => {
    const r = await call('POST', '/jobs', { blNo: '1', eta: '', commodity: '', hsCodes: ['84a'], containers: [{ containerNo: 'ABC123' }], newCustomer: { name: 'Acme', email: 'not-an-email' } });
    expect(r.status).toBe(400);
    expect(r.json.detail).toBe('Please check these fields');
    const messages = (r.json.errors as Json[]).map((e) => e.message);
    expect(messages).toContain('B/L number: must be at least 3 characters');
    expect(messages).toContain('ETA: must be a date');
    expect(messages).toContain('HS codes (1st): each HS code must be 4–12 digits, e.g. 8418');
    expect(messages).toContain('New customer · Email: is not in the right format');
    expect(messages.some((m) => m.startsWith('Containers (1st) · Container number:'))).toBe(true);
    expect(messages.join(' ')).not.toMatch(/\/\^|Invalid (string|input)/); // no raw patterns or Zod wording
  });
});

describe('finding customers and jobs', () => {
  it('searches customers by contact phone and email, and jobs by customer phone', async () => {
    expect((await call('GET', '/customers?q=omar@sahara')).json.items.map((c: Json) => c.name)).toEqual(['Sahara Furniture Trading']);
    expect((await call('GET', '/customers?q=123 4567')).json.items.map((c: Json) => c.name)).toEqual(['Sahara Furniture Trading']);
    expect((await call('GET', '/jobs?q=omar@sahara')).json.items.map((j: Json) => j.blNo).sort()).toEqual(['NEWCUST0001', 'NEWCUST0004']);
  });

  it('suggests possible duplicates by name (ignoring LLC/FZE) or phone', async () => {
    const byName = (await call('GET', '/customers/similar?name=Al Noor LLC')).json.items as Json[];
    expect(byName.map((c) => c.name)).toContain('Al Noor Trading LLC');
    const byPhone = (await call('GET', '/customers/similar?phone=055 1234567')).json.items as Json[];
    expect(byPhone.map((c) => c.name)).toEqual(['Sahara Furniture Trading']); // +971 55 123 4567 and 055 1234567 match
    expect((await call('GET', '/customers/similar?name=ab')).json.items).toEqual([]); // too short to suggest anything
  });

  it('Home summary agrees with the other endpoints', async () => {
    const h = (await call('GET', '/insight/home')).json;
    const open = (await call('GET', '/jobs?status=OPEN')).json.items as Json[];
    expect(h.openJobs).toBe(open.length);
    expect(h.overdueJobs).toBe(open.filter((j) => j.overdue).length);
    expect(h.customers).toBe((await call('GET', '/customers')).json.items.length);
    const alerts = (await call('GET', '/engagement/alerts')).json;
    expect(h.overdueStages).toBe(alerts.overdue.length);
    expect(h.freeTimeRisk).toBe(alerts.freeTime.length);
    expect(h.recent).toHaveLength(5);
  });
});
