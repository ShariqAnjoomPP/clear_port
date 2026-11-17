import { afterAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { FUNCTIONS } from '../src/functions';
import { pool } from '../src/lib/db';

/**
 * Milestone 4: payments, floats, invoices, closing and reopening. Uses seeded jobs:
 *  MAEU238874110 — Bayan filed (Yusuf), CMDU7781555 — all delivered, payments reconciled, invoice issued,
 *  MEDUJ4471999 — one container held at inspection, payments not reconciled.
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
const jobByBl = async (bl: string) => (await call('GET', `/jobs?q=${bl}`)).json.items[0].jobId as string;
const pay = (extra: Json = {}) => ({ feeType: 'PORT_STORAGE', amount: '300', currency: 'OMR', paymentMethod: 'CASH_FLOAT', paidOn: '2026-10-16', ...extra });
/** Money in thousandths, so the test's own arithmetic is exact. */
const m = (v: string | number) => Math.round(Number(v) * 1000);

afterAll(() => pool.end());

describe('payments and floats', () => {
  let yusuf = '';
  let jobId = '';

  it('records a payment with a stage update and counts it against the PRO float', async () => {
    yusuf = (await call('GET', '/settings/staff?role=PRO')).json.items.find((s: Json) => s.name === 'Yusuf Ali').id;
    jobId = await jobByBl('MAEU238874110');
    const before = (await call('GET', '/finance/floats')).json.items.find((f: Json) => f.staffId === yusuf);

    const stages = (await call('GET', `/workflow/jobs/${jobId}/stages`)).json.jobStages as Json[];
    const bayan = stages.find((s) => s.key === 'BAYAN')!;
    const r = await call('POST', `/workflow/jobs/${jobId}/stages/${bayan.id}/transitions`, { to: 'APPROVED', disbursements: [pay({ feeType: 'BAYAN_FEE', paidById: yusuf })] });
    expect(r.status).toBe(200);

    const ledger = (await call('GET', `/finance/disbursements?jobId=${jobId}`)).json.items as Json[];
    expect(ledger[0]).toMatchObject({ feeType: 'BAYAN_FEE', stageKey: 'BAYAN', paidByName: 'Yusuf Ali', status: 'RECORDED' });
    const after = (await call('GET', '/finance/floats')).json.items.find((f: Json) => f.staffId === yusuf);
    expect(m(after.spent) - m(before.spent)).toBe(m(300));
    expect(m(after.balance)).toBe(m(after.issued) - m(after.spent));
  });

  it('refuses a receipt from another job and a float for a non-PRO', async () => {
    const other = (await call('GET', `/jobs/${await jobByBl('CMDU7781555')}`)).json.documents[0].id;
    expect((await call('POST', '/finance/disbursements', { jobId, ...pay({ receiptDocumentId: other }) })).status).toBe(422);
    const driver = (await call('GET', '/settings/staff?role=DRIVER')).json.items[0].id;
    expect((await call('POST', '/finance/floats', { staffId: driver, amount: '100', currency: 'OMR', issuedOn: '2026-10-16' })).status).toBe(422);
  });

  it('corrects a payment with a reversal entry instead of editing it', async () => {
    const created = await call('POST', '/finance/disbursements', { jobId, ...pay({ amount: '75.500' }) });
    expect(created.status).toBe(201);
    const totalBefore = (await call('GET', `/jobs/${jobId}`)).json.finance.totals[0].paid;

    const rev = await call('POST', `/finance/disbursements/${created.json.id}/reverse`, { reason: 'Entered twice' });
    expect(rev.status).toBe(201);
    expect(rev.json).toMatchObject({ amount: '-75.500', reversesId: created.json.id, status: 'REVERSED' });
    expect((await call('POST', `/finance/disbursements/${created.json.id}/reverse`, { reason: 'again' })).status).toBe(409);

    const totalAfter = (await call('GET', `/jobs/${jobId}`)).json.finance.totals[0].paid;
    expect(m(totalBefore) - m(totalAfter)).toBe(m('75.5'));
  });
});

describe('invoices', () => {
  let jobId = '';
  let invoiceId = '';

  it('will not reverse a payment that is on an invoice', async () => {
    jobId = await jobByBl('CMDU7781555');
    const j = (await call('GET', `/jobs/${jobId}`)).json;
    invoiceId = j.invoices[0].id;
    const invoiced = (j.finance.payments as Json[]).find((p) => p.invoiceId === invoiceId)!;
    expect((await call('POST', `/finance/disbursements/${invoiced.id}/reverse`, { reason: 'test' })).status).toBe(409);
  });

  it('voids and regenerates: service fees with VAT, payments at cost without VAT, totals add up', async () => {
    expect((await call('POST', `/finance/invoices/${invoiceId}/void`)).status).toBe(200);
    const gen = await call('POST', '/finance/invoices', { jobId });
    expect(gen.status).toBe(201);
    invoiceId = gen.json.id;
    expect(gen.json.invoiceNo).toMatch(/^INV-\d{4}-\d{5}$/);

    const inv = (await call('GET', `/finance/invoices/${invoiceId}`)).json;
    const service = (inv.lines as Json[]).filter((l) => l.kind === 'SERVICE');
    const passThrough = (inv.lines as Json[]).filter((l) => l.kind === 'DISBURSEMENT');
    expect(service.map((l) => [l.quantity, l.unitPrice])).toEqual([[1, '90.000'], [2, '12.000']]); // Majan Steel tariff, 2 containers
    expect(passThrough.every((l) => Number(l.vatRate) === 0)).toBe(true);

    const subtotal = (inv.lines as Json[]).reduce((s, l) => s + m(l.amount), 0);
    const vat = service.reduce((s, l) => s + Math.round((m(l.amount) * Number(l.vatRate)) / 100), 0);
    expect(m(inv.subtotal)).toBe(subtotal);
    expect(m(inv.vatAmount)).toBe(vat);
    expect(m(inv.total)).toBe(subtotal + vat);
    expect(inv.issuer).toMatchObject({ name: 'Batinah Gate Clearing LLC', trn: 'OM1100234567' });

    const again = await call('POST', '/finance/invoices', { jobId });
    expect(again.status).toBe(422); // nothing left to bill
  });

  it('moves draft → issued → paid, shows in receivables while unpaid, and refuses invalid moves', async () => {
    expect((await call('POST', `/finance/invoices/${invoiceId}/mark-paid`)).status).toBe(409); // still draft
    expect((await call('POST', `/finance/invoices/${invoiceId}/issue`)).status).toBe(200);
    const owed = (await call('GET', '/finance/receivables')).json.items as Json[];
    expect(owed.some((r) => r.customer_name === 'Majan Steel Imports')).toBe(true);
    expect((await call('POST', `/finance/invoices/${invoiceId}/mark-paid`)).status).toBe(200);
    expect((await call('POST', `/finance/invoices/${invoiceId}/void`)).status).toBe(409); // paid invoices cannot be voided
  });
});

describe('closing and reopening jobs', () => {
  it('lists every blocker when a job cannot be closed', async () => {
    const r = await call('POST', `/jobs/${await jobByBl('MEDUJ4471999')}/close`);
    expect(r.status).toBe(409);
    const codes = (r.json.errors as Json[]).map((e) => e.code);
    expect(codes).toContain('CONTAINER');
    expect(codes).toContain('PAYMENTS');
  });

  it('closes a finished job, locks it, and reopens it with a reason', async () => {
    const jobId = await jobByBl('CMDU7781555');
    const closed = await call('POST', `/jobs/${jobId}/close`);
    expect(closed.status).toBe(200);
    expect(closed.json.status).toBe('CLOSED');
    expect((await call('GET', `/jobs?q=CMDU7781555`)).json.items[0].phase).toBe('CLOSED');
    expect((await call('POST', `/jobs/${jobId}/close`)).status).toBe(409);

    const stage = ((await call('GET', `/workflow/jobs/${jobId}/stages`)).json.jobStages as Json[])[0]!;
    expect(stage.nextSteps).toEqual([]); // closed jobs offer no steps
    expect((await call('POST', `/workflow/jobs/${jobId}/stages/${stage.id}/transitions`, { to: 'RECEIVED' })).status).toBe(409);
    expect((await call('POST', '/finance/disbursements', { jobId, ...pay() })).status).toBe(409);

    expect((await call('POST', `/jobs/${jobId}/reopen`, { reason: 'no' })).status).toBe(400); // reason too short
    const reopened = await call('POST', `/jobs/${jobId}/reopen`, { reason: 'Customer disputed storage charge' });
    expect(reopened.json.status).toBe('OPEN');
    const tl = (await call('GET', `/jobs/${jobId}/timeline`)).json.items as Json[];
    expect(tl.some((i) => i.kind === 'comment' && i.title === 'Job reopened: Customer disputed storage charge')).toBe(true);
    expect(tl.some((i) => i.kind === 'payment')).toBe(true);
  });
});
