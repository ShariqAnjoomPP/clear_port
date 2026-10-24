import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { FUNCTIONS } from '../src/functions';
import { pool } from '../src/lib/db';

/**
 * Milestone 2 core loop, driven over HTTP exactly like the web app does (in-process, no server):
 * customer → job with containers → documents → every job stage through CCRO → container stages.
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
const PDF = '%PDF-1.4\n%test\n';
async function upload(jobId: string, docType: string, content: string | Uint8Array<ArrayBuffer> = PDF, type = 'application/pdf') {
  const form = new FormData();
  form.set('jobId', jobId);
  form.set('docType', docType);
  form.set('file', new File([content], 'doc.pdf', { type }));
  const res = await app.request('/api/documents', { method: 'POST', body: form });
  return { status: res.status, json: (await res.json()) as Json };
}

let jobId = '';
let containerA = '';
let containerB = '';
const stage = async (key: string, containerId: string | null = null) => {
  const { json } = await call('GET', `/workflow/jobs/${jobId}/stages`);
  const list = containerId ? json.containerStages[containerId] : json.jobStages;
  return (list as Json[]).find((s) => s.key === key)!;
};
const move = async (key: string, to: string, fields: Json = {}, containerId: string | null = null) => {
  const s = await stage(key, containerId);
  return call('POST', `/workflow/jobs/${jobId}/stages/${s.id}/transitions`, { to, fields });
};
const assign = async (key: string, staffId: string) => call('PUT', `/workflow/jobs/${jobId}/stages/${(await stage(key)).id}/assignee`, { assigneeId: staffId });

// This suite covers the team set-up: each step assigned to a staff member, customs and DO run side by side
// (Settings → Company). The default one-person, one-by-one set-up is covered in assign-steps.test.ts.
const setAssignSteps = async (on: boolean) => {
  const company = (await call('GET', '/settings/company')).json;
  await call('PUT', '/settings/company', { name: company.name, address: company.address ?? '', trn: company.trn ?? '', baseCurrency: company.baseCurrency, timezone: company.timezone, vatPct: Number(company.vatPct), assignSteps: on, sequentialSteps: !on });
};
beforeAll(() => setAssignSteps(true));
afterAll(async () => {
  await setAssignSteps(false);
  await pool.end();
});

describe('core clearance loop', () => {
  let pro = '';

  it('creates a customer and a job with two containers', async () => {
    const staff = await call('GET', '/settings/staff?role=PRO');
    pro = staff.json.items[0].id;

    const cust = await call('POST', '/customers', { name: 'Test Imports LLC', preferredChannel: 'EMAIL', creditDays: 30, contacts: [{ name: 'Test Person', email: 'test@example.com' }] });
    expect(cust.status).toBe(201);
    expect(cust.json.contacts[0].id).toBeTruthy();

    const job = await call('POST', '/jobs', {
      customerId: cust.json.id, blNo: 'TESTBL0001', eta: '2026-10-20', commodity: 'Test goods',
      containers: [{ containerNo: 'CSQU3054383' }, { containerNo: 'MSKU9070323' }],
    });
    expect(job.status).toBe(201);
    expect(job.json.jobNo).toMatch(/^CP-\d{4}-\d{5}$/);
    jobId = job.json.id;

    const detail = await call('GET', `/jobs/${jobId}`);
    expect(detail.json.stages.jobStages.map((s: Json) => s.key)).toEqual(['DOCUMENTS', 'BAYAN', 'CUSTOMER_COMM', 'INSPECTION', 'DO', 'CCRO']);
    expect(detail.json.stages.jobStages[0].startedAt).toBeTruthy();
    [containerA, containerB] = detail.json.containers.map((c: Json) => c.id);
  });

  it('rejects invalid input', async () => {
    const dup = await call('POST', '/jobs', { customerId: (await call('GET', `/jobs/${jobId}`)).json.customerId, blNo: 'TESTBL0002', eta: '2026-10-20', commodity: 'x y', containers: [{ containerNo: 'CSQU3054383' }] });
    expect(dup.status).toBe(409); // container already on an open job
    const badLength = await call('POST', '/jobs', { customerId: (await call('GET', `/jobs/${jobId}`)).json.customerId, blNo: 'TESTBL0003', eta: '2026-10-20', commodity: 'x y', containers: [{ containerNo: 'CSQU305438' }] }); // 10 characters
    expect(badLength.status).toBe(400);
  });

  it('blocks Bayan until documents are verified and a PRO is assigned, listing every reason', async () => {
    const r = await move('BAYAN', 'FILED', { referenceNo: 'BYN-1' });
    expect(r.status).toBe(409);
    const reasons = r.json.errors.map((e: Json) => e.message);
    expect(reasons).toContain('Documents received must be: Verified');
    expect(reasons).toContain('An assignee is required');
  });

  it('requires a Bill of Lading before documents can be verified, and checks file content', async () => {
    expect((await move('DOCUMENTS', 'RECEIVED')).status).toBe(200);
    const early = await move('DOCUMENTS', 'VERIFIED');
    expect(early.status).toBe(422);
    expect(early.json.detail).toBe('Upload a bill of lading first');

    expect((await upload(jobId, 'BILL_OF_LADING', 'not really a pdf')).status).toBe(201); // unknown signature is allowed
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect((await upload(jobId, 'BILL_OF_LADING', png)).status).toBe(422); // PNG bytes declared as PDF
    expect((await move('DOCUMENTS', 'VERIFIED')).status).toBe(200);
  });

  it('walks customs, DO and CCRO, then spawns container stages', async () => {
    await assign('BAYAN', pro);
    expect((await move('BAYAN', 'FILED')).status).toBe(422); // Bayan number required
    expect((await move('BAYAN', 'FILED', { referenceNo: 'BYN-77' })).status).toBe(200);
    expect((await move('BAYAN', 'APPROVED')).status).toBe(200);
    expect((await move('BAYAN', 'DUTIES_PAID')).status).toBe(200);

    expect((await move('CUSTOMER_COMM', 'SENT')).status).toBe(200);
    expect((await move('CUSTOMER_COMM', 'CONFIRMED')).status).toBe(200);
    expect((await move('INSPECTION', 'REQUIRED', { selectedContainerIds: [containerA] })).status).toBe(200);
    expect((await move('INSPECTION', 'COMPLETED')).status).toBe(200);

    await assign('DO', pro);
    expect((await move('DO', 'APPLIED')).status).toBe(200);
    expect((await move('DO', 'CHARGES_PAID')).status).toBe(200);
    expect((await move('DO', 'DO_RECEIVED', { referenceNo: 'DO-9', validUntil: '2026-11-01' })).status).toBe(200);

    await assign('CCRO', pro);
    expect((await move('CCRO', 'APPLIED')).status).toBe(200);
    const issued = await move('CCRO', 'ISSUED', { referenceNo: 'CCRO-5' });
    expect(issued.status).toBe(200);

    const stages = issued.json.containerStages as Record<string, Json[]>;
    expect(Object.values(stages).flat()).toHaveLength(8);
    expect(stages[containerA]!.find((s) => s.key === 'PHYSICAL_INSPECTION')!.status).toBe('PENDING');
    expect(stages[containerB]!.find((s) => s.key === 'PHYSICAL_INSPECTION')!.status).toBe('NOT_REQUIRED');
  });

  it('enforces container-level gates', async () => {
    const release = await move('RELEASE', 'RELEASED', {}, containerB);
    expect(release.status).toBe(409); // truck not at port yet
    expect((await move('TRUCK', 'ASSIGNED', {}, containerB)).status).toBe(200);
    expect((await move('TRUCK', 'AT_PORT', {}, containerB)).status).toBe(200);
    expect((await move('RELEASE', 'RELEASED', {}, containerB)).status).toBe(200);
  });

  it('records a payment made at a container step in the same update', async () => {
    const s = await stage('RELEASE', containerB);
    const r = await call('POST', `/workflow/jobs/${jobId}/stages/${s.id}/transitions`, {
      to: 'GATED_OUT', disbursements: [{ feeType: 'TERMINAL_HANDLING', amount: '10', currency: 'OMR', paymentMethod: 'ONLINE', paidOn: '2026-10-15' }],
    });
    expect(r.status).toBe(200);
    const ledger = (await call('GET', `/finance/disbursements?jobId=${jobId}`)).json.items;
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ feeType: 'TERMINAL_HANDLING', stageKey: 'RELEASE', paidByName: 'Demo User' });
  });

  it('shows the job in lists, search, tasks and timeline', async () => {
    const list = await call('GET', '/jobs?q=MSKU9070323');
    expect(list.json.items).toHaveLength(1);
    expect(list.json.items[0].phase).toBe('DELIVERY');

    const byRef = await call('GET', '/jobs?q=ccro-5');
    expect(byRef.json.items.map((j: Json) => j.jobId)).toEqual([jobId]);

    const tasks = await call('GET', `/workflow/tasks?staffId=${pro}`);
    expect(tasks.status).toBe(200);

    await call('POST', `/jobs/${jobId}/comments`, { body: 'Called the line' });
    const tl = await call('GET', `/jobs/${jobId}/timeline`);
    const kinds = tl.json.items.map((i: Json) => i.kind);
    expect(kinds.filter((k: string) => k === 'stage').length).toBeGreaterThanOrEqual(16);
    expect(kinds).toContain('document');
    expect(kinds).toContain('comment');
    expect(tl.json.items.at(-1).kind).toBe('created');
  });
});
