import { afterAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { containerCheckDigit } from '@clearport/kernel';
import { FUNCTIONS } from '../src/functions';
import { pool } from '../src/lib/db';

/** One-person agency (the default): no step waits for an assignee. */
const app = new Hono();
for (const [name, fn] of Object.entries(FUNCTIONS)) app.route(`/api/${name}`, fn);

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await app.request(`/api${path}`, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}
const base = 'SOLU800001';
const containerNo = `${base}${containerCheckDigit(base)}`;

afterAll(() => pool.end());

describe('step assignment switched off (default)', () => {
  it('is off for a new company', async () => {
    expect((await call('GET', '/settings/company')).json.assignSteps).toBe(false);
  });

  it('files the Bayan without anyone assigned', async () => {
    const job = await call('POST', '/jobs', { blNo: 'SOLO0001', eta: '2026-10-30', commodity: 'Solo agent test', containers: [{ containerNo }], newCustomer: { name: 'Solo Agent Customer' } });
    expect(job.status).toBe(201);
    const jobId = job.json.id;
    const stage = async (key: string) => ((await call('GET', `/workflow/jobs/${jobId}/stages`)).json.jobStages as Json[]).find((s) => s.key === key)!;
    const move = async (key: string, to: string, fields: Json = {}) => call('POST', `/workflow/jobs/${jobId}/stages/${(await stage(key)).id}/transitions`, { to, fields });

    const form = new FormData();
    form.set('jobId', jobId); form.set('docType', 'BILL_OF_LADING'); form.set('file', new File(['%PDF-1.4\n'], 'bl.pdf', { type: 'application/pdf' }));
    await app.request('/api/documents', { method: 'POST', body: form });
    expect((await move('DOCUMENTS', 'RECEIVED')).status).toBe(200);
    expect((await move('DOCUMENTS', 'VERIFIED')).status).toBe(200);

    const bayan = await stage('BAYAN');
    expect(bayan.assignee).toBeNull();
    expect(bayan.nextSteps.find((n: Json) => n.to === 'FILED').gateOpen).toBe(true); // no "An assignee is required"
    expect((await move('BAYAN', 'FILED', { referenceNo: 'BYN-SOLO' })).status).toBe(200);
  });
});

describe('steps one by one (default)', () => {
  it('will not start a step before the previous one is complete, and says which one', async () => {
    const jobId = (await call('GET', '/jobs?q=SOLO0001')).json.items[0].jobId;
    const stages = (await call('GET', `/workflow/jobs/${jobId}/stages`)).json.jobStages as Json[];
    const doStage = stages.find((s) => s.key === 'DO')!;
    expect(doStage.nextSteps.every((n: Json) => !n.gateOpen)).toBe(true);
    expect(doStage.nextSteps[0].waitingFor).toEqual(['Finish “Bayan (customs declaration)” first']);
    const r = await call('POST', `/workflow/jobs/${jobId}/stages/${doStage.id}/transitions`, { to: 'APPLIED' });
    expect(r.status).toBe(409);
    expect(r.json.errors[0].message).toBe('Finish “Bayan (customs declaration)” first');
  });

  it('runs customs and the DO side by side when switched off', async () => {
    const company = (await call('GET', '/settings/company')).json;
    const put = (on: boolean) => call('PUT', '/settings/company', { name: company.name, address: company.address ?? '', trn: company.trn ?? '', baseCurrency: company.baseCurrency, timezone: company.timezone, vatPct: Number(company.vatPct), assignSteps: company.assignSteps, sequentialSteps: on });
    await put(false);
    const jobId = (await call('GET', '/jobs?q=SOLO0001')).json.items[0].jobId;
    const doStage = ((await call('GET', `/workflow/jobs/${jobId}/stages`)).json.jobStages as Json[]).find((s) => s.key === 'DO')!;
    expect((await call('POST', `/workflow/jobs/${jobId}/stages/${doStage.id}/transitions`, { to: 'APPLIED' })).status).toBe(200);
    await put(true);
  });
});
