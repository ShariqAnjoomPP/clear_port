import { afterAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { FUNCTIONS } from '../src/functions';
import { pool } from '../src/lib/db';

/**
 * Milestone 5: notifications, the customer's charge approval and the customer portal.
 * Uses seeded job CMDU7781204 (Majan Steel, WhatsApp opted in): charges sent, approval link open.
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
  return { status: res.status, json: res.headers.get('content-type')?.includes('json') ? await res.json() : {} };
}
const jobByBl = async (bl: string) => (await call('GET', `/jobs?q=${bl}`)).json.items[0].jobId as string;
const tokenOf = (link: string, prefix: string) => link.split(`/${prefix}/`)[1]!;
const stageOf = async (jobId: string, key: string) => ((await call('GET', `/workflow/jobs/${jobId}/stages`)).json.jobStages as Json[]).find((s) => s.key === key)!;
const m = (v: string | number) => Math.round(Number(v) * 1000);

afterAll(() => pool.end());

describe('customer messages', () => {
  it('logs each update on the customer’s preferred channel, honouring WhatsApp consent', async () => {
    const all = (await call('GET', '/engagement/outbound')).json.items as Json[];
    const steel = all.filter((n) => n.title.includes('CMDU7781204'));
    expect(steel.length).toBeGreaterThan(0);
    expect(steel.every((n) => n.channel === 'WHATSAPP' && n.status === 'LOGGED')).toBe(true); // Majan Steel: WhatsApp, opted in
    const desert = all.filter((n) => n.title.includes('MAEU238874110'));
    expect(desert.every((n) => n.channel === 'EMAIL')).toBe(true); // Desert Bloom prefers email
    expect(all.some((n) => n.template === 'TRIP_ASSIGNED' && n.link?.includes('/t/'))).toBe(true); // driver links
    expect(all.some((n) => n.template === 'INVOICE_ISSUED')).toBe(true);
  });

  it('keeps an in-app inbox with an unread count', async () => {
    const before = (await call('GET', '/engagement/notifications')).json;
    expect(before.unread).toBeGreaterThan(0);
    expect((before.items as Json[]).some((n) => n.template === 'READY_TO_CLOSE')).toBe(true);
    await call('POST', '/engagement/notifications/read-all');
    expect((await call('GET', '/engagement/notifications')).json.unread).toBe(0);
  });

  it('works out alerts on request: overdue stages and free time running out', async () => {
    const a = (await call('GET', '/engagement/alerts')).json;
    expect(a.overdue.length).toBeGreaterThan(0);
    expect((a.freeTime as Json[]).some((f) => f.blNo === 'HLCUSOH250901')).toBe(true); // free time ends tomorrow in the seed
  });
});

describe('charge approval', () => {
  let jobId = '';
  let firstToken = '';

  it('sends a link listing every billable payment', async () => {
    jobId = await jobByBl('CMDU7781204');
    const msg = ((await call('GET', `/engagement/outbound?jobId=${jobId}`)).json.items as Json[]).find((n) => n.template === 'APPROVAL_REQUEST')!;
    firstToken = tokenOf(msg.link, 'a');
    const a = await call('GET', `/public/approvals/${firstToken}`);
    expect(a.json.status).toBe('PENDING');
    const billable = ((await call('GET', `/jobs/${jobId}`)).json.finance.payments as Json[]).filter((p) => p.billable && p.status !== 'REVERSED');
    expect(a.json.summary.lines).toHaveLength(billable.length);
    expect(m(a.json.summary.totals[0].amount)).toBe(billable.reduce((s, p) => s + m(p.amount), 0));
  });

  it('a dispute from the portal sends “Customer confirmation” back to Pending', async () => {
    const cust = (await call('GET', '/customers?q=Majan')).json.items[0];
    const portal = tokenOf((await call('GET', `/customers/${cust.id}`)).json.portalUrl, 'p');
    const home = (await call('GET', `/public/portal/${portal}`)).json;
    const pending = (home.approvals as Json[]).find((x) => x.jobId === jobId)!;
    const r = await call('POST', `/public/portal/${portal}/approvals/${pending.id}/decision`, { decision: 'REJECTED', note: 'Duty amount looks wrong' });
    expect(r.status).toBe(200);
    expect((await stageOf(jobId, 'CUSTOMER_COMM')).status).toBe('PENDING');
    const tl = (await call('GET', `/jobs/${jobId}/timeline`)).json.items as Json[];
    expect(tl.some((i) => i.actor === 'Khalid Al Harthy (customer)' && i.remarks === 'Duty amount looks wrong')).toBe(true);
    expect(((await call('GET', '/engagement/notifications')).json.items as Json[]).some((n) => n.template === 'CUSTOMER_DECISION')).toBe(true);
  });

  it('resending creates a new link; the old one can no longer be used', async () => {
    const s = await stageOf(jobId, 'CUSTOMER_COMM');
    expect((await call('POST', `/workflow/jobs/${jobId}/stages/${s.id}/transitions`, { to: 'SENT' })).status).toBe(200);
    expect((await call('POST', `/public/approvals/${firstToken}/decision`, { decision: 'APPROVED' })).status).toBe(409);

    const latest = ((await call('GET', `/engagement/outbound?jobId=${jobId}`)).json.items as Json[]).find((n) => n.template === 'APPROVAL_REQUEST')!;
    const token = tokenOf(latest.link, 'a');
    expect(token).not.toBe(firstToken);
    expect((await call('POST', `/public/approvals/${token}/decision`, { decision: 'APPROVED' })).status).toBe(200);
    expect((await stageOf(jobId, 'CUSTOMER_COMM')).status).toBe('CONFIRMED');
    expect((await call('GET', `/public/approvals/${token}`)).json.status).toBe('APPROVED');
    expect((await call('POST', `/public/approvals/${token}/decision`, { decision: 'REJECTED' })).status).toBe(409); // answered once
  });
});

describe('customer portal', () => {
  let token = '';
  let customerId = '';

  it('shows only this customer’s shipments', async () => {
    const cust = (await call('GET', '/customers?q=Al Noor')).json.items[0];
    customerId = cust.id;
    token = tokenOf((await call('GET', `/customers/${cust.id}`)).json.portalUrl, 'p');
    const home = (await call('GET', `/public/portal/${token}`)).json;
    expect(home.customer.name).toBe('Al Noor Trading LLC');
    expect((home.jobs as Json[]).map((j) => j.blNo).sort()).toEqual(['HLCUSOH250901', 'MEDUJ4471023']);

    const other = await jobByBl('COSU6129887'); // another customer's job
    expect((await call('GET', `/public/portal/${token}/jobs/${other}`)).status).toBe(404);
  });

  it('opens only documents shared with the customer', async () => {
    const jobId = await jobByBl('HLCUSOH250901');
    const detail = (await call('GET', `/public/portal/${token}/jobs/${jobId}`)).json;
    expect(detail.documents.map((d: Json) => d.docType)).toEqual(['BILL_OF_LADING']); // only the B/L is customer-visible in the seed
    expect((await app.request(`/api/public/portal/${token}/documents/${detail.documents[0].id}`)).status).toBe(200);
    const hidden = ((await call('GET', `/jobs/${jobId}`)).json.documents as Json[]).find((d) => !d.customerVisible)!;
    expect((await app.request(`/api/public/portal/${token}/documents/${hidden.id}`)).status).toBe(404);
  });

  it('a new portal link replaces the old one', async () => {
    const r = await call('POST', `/customers/${customerId}/portal-link`);
    expect((await call('GET', `/public/portal/${token}`)).status).toBe(404);
    expect((await call('GET', `/public/portal/${tokenOf(r.json.url, 'p')}`)).status).toBe(200);
  });
});
