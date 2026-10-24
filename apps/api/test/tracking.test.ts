import { afterAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { FUNCTIONS } from '../src/functions';
import { pool } from '../src/lib/db';
import { signTrackToken } from '../src/lib/tokens';

/** Public tracking page: one link for everyone, the customer's mobile number opens their shipments (no money, no documents). */
const app = new Hono();
for (const [name, fn] of Object.entries(FUNCTIONS)) app.route(`/api/${name}`, fn);

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let ip = 0;
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: Json }> {
  const res = await app.request(`/api${path}`, {
    method,
    // A fresh client address per lookup, so the throttle only bites in its own test.
    headers: { 'x-forwarded-for': `10.0.0.${++ip}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}
const lookup = (phone: string) => call('POST', '/public/track/lookup', { phone });
const asCustomer = (token: string) => ({ 'x-track-token': token });

afterAll(() => pool.end());

describe('customer tracking by phone', () => {
  it('finds the customer whatever way the number is written', async () => {
    for (const phone of ['+968 9911 2233', '99112233', '0096899112233']) {
      const r = await lookup(phone);
      expect(r.status, phone).toBe(200);
      expect(r.json.customer.name).toBe('Al Noor Trading LLC');
      expect(r.json.maskedPhone).toBe('•••• 2233');
      expect(r.json.shipments.map((s: Json) => s.blNo).sort()).toEqual(['HLCUSOH250901', 'MEDUJ4471023']);
    }
    expect((await lookup('+968 9000 0000')).status).toBe(404);
    expect((await lookup('12345')).status).toBe(400);
  });

  it('needs a valid, unexpired token for the shipment list', async () => {
    const { json } = await lookup('+968 9955 6677');
    expect((await call('GET', '/public/track/shipments', undefined, asCustomer(json.trackToken))).json.items).toHaveLength(2);
    expect((await call('GET', '/public/track/shipments')).status).toBe(401);
    expect((await call('GET', '/public/track/shipments', undefined, asCustomer(`${json.trackToken}x`))).status).toBe(401);
    const expired = signTrackToken(['00000000-0000-0000-0000-000000000000'], -1000).token;
    expect((await call('GET', '/public/track/shipments', undefined, asCustomer(expired))).status).toBe(401);
  });

  it('shows one shipment in plain words, without money or documents, and only to its customer', async () => {
    const ameer = (await lookup('99556677')).json;
    const salalah = ameer.shipments.find((s: Json) => s.blNo === '275183136');
    const r = await call('GET', `/public/track/shipments/${salalah.jobId}`, undefined, asCustomer(ameer.trackToken));
    expect(r.status).toBe(200);
    expect(r.json.milestones.map((m: Json) => m.label)).toEqual(['Documents', 'Customs declaration', 'Customs inspection', 'Delivery order', 'Port release', 'Delivered']);
    expect(r.json.containers[0]).toMatchObject({ containerNo: 'MNBU4571402', status: 'Waiting for port release' });
    expect(r.json.containers[0].freeTimeExpiresAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.json.goods.map((g: Json) => [g.description, g.packages])).toEqual([['Fresh seedless lime', 4608], ['Fresh dragon fruit', 750]]);
    expect(r.json.updates[0].text).toBe('Documents: Received');
    for (const hidden of ['invoices', 'pendingApprovals', 'documents', 'invoiceValue', 'finance']) expect(r.json).not.toHaveProperty(hidden);

    const alNoor = (await lookup('99112233')).json;
    expect((await call('GET', `/public/track/shipments/${salalah.jobId}`, undefined, asCustomer(alNoor.trackToken))).status).toBe(404);
  });

  it('shows notes the agent shared, and not internal ones', async () => {
    const ameer = (await lookup('99556677')).json;
    const sohar = ameer.shipments.find((s: Json) => s.blNo === '275183155');
    await call('POST', `/jobs/${sohar.jobId}/comments`, { body: 'Vessel berthed, discharge tomorrow', customerVisible: true });
    await call('POST', `/jobs/${sohar.jobId}/comments`, { body: 'Internal: chase plant quarantine', customerVisible: false });
    const texts = (await call('GET', `/public/track/shipments/${sohar.jobId}`, undefined, asCustomer(ameer.trackToken))).json.updates.map((u: Json) => u.text);
    expect(texts[0]).toBe('Note from your agent: Vessel berthed, discharge tomorrow');
    expect(texts.join(' ')).not.toMatch(/Internal/);
    expect(texts).toContain('Customs declaration: Filed');
  });

  it('slows down repeated lookups from one address', async () => {
    const same = { 'x-forwarded-for': '10.9.9.9' };
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await call('POST', '/public/track/lookup', { phone: '+968 9000 0000' }, same)).status);
    expect(codes.slice(0, 10).every((s) => s === 404)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it("shows the agency's contact details for the WhatsApp, call and email buttons", async () => {
    const company = (await call('GET', '/settings/company')).json;
    const r = await call('PUT', '/settings/company', { ...company, vatPct: Number(company.vatPct), whatsapp: '+968 9100 0002', phone: '', email: 'help@batinahgate.demo' });
    expect(r.status).toBe(200);
    expect((await call('GET', '/public/track/agency')).json).toEqual({ name: 'Batinah Gate Clearing LLC', phone: null, whatsapp: '+968 9100 0002', email: 'help@batinahgate.demo' });
  });
});
