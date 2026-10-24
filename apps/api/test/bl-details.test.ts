import { afterAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { FUNCTIONS } from '../src/functions';
import { pool } from '../src/lib/db';

/**
 * A job holds what a real carrier B/L prints. Modelled on Maersk B/L 275183136 (Ho Chi Minh City → Salalah):
 * one 40' reefer with two goods lines, 9 days combined free time, commercial invoice USD CIF, scanned as one pack.
 * Numbers are prefixed so they don't clash with the demo job built from the same B/L.
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

const BOX = 'TSTU4571402';
const salalahBl = (extra: Json = {}) => ({
  newCustomer: { name: 'Barka Test Imports SPC' },
  blNo: 'T275183136', bookingNo: 'T275183136', serviceContract: '2220719', shippingLineCode: 'MAEU', vessel: 'ARCHER', voyage: '636S',
  shipper: 'KDN AGRICULTURAL PRODUCTS IMPORT EXPORT CO., LTD\nHo Chi Minh City, Vietnam', notifyParty: 'Same as consignee',
  portOfLoading: 'VNSGN', portOfDischarge: 'OMSLL', placeOfIssue: 'Ho Chi Minh City', blIssueDate: '2026-08-31', shippedOnBoardDate: '2026-08-31',
  originalsCount: 3, freightTerms: 'PREPAID', serviceType: 'CY/CY', freeTimeDays: 9, freeTimeBasis: 'COMBINED',
  invoiceNo: 'TKDN/202609', invoiceDate: '2026-08-29', invoiceValue: '20703.00', invoiceCurrency: 'usd', incoterm: 'CIF', countryOfOrigin: 'Vietnam',
  eta: '2026-09-14',
  containers: [{ containerNo: BOX, sizeType: '40RH', sealNo: 'ML-VN0785728', packages: 20, packageKind: 'PALLET', grossWeightKg: 23687.7, volumeCbm: 50, reeferTempC: 4, ventilation: '25 CBM/H' }],
  cargoLines: [
    { description: 'Fresh seedless lime', hsCode: '08055020', packages: 4608, packageKind: 'CARTON', netWeightKg: 18432, grossWeightKg: 20275.2, containerNo: BOX },
    { description: 'Fresh dragon fruit', hsCode: '08109092', packages: 750, packageKind: 'CARTON', netWeightKg: 3000, grossWeightKg: 3412.5, containerNo: BOX },
  ],
  ...extra,
});

let jobId = '';
afterAll(() => pool.end());

describe('B/L details', () => {
  it('stores what the B/L prints, with goods lines and their totals', async () => {
    const r = await call('POST', '/jobs', salalahBl());
    expect(r.status).toBe(201);
    jobId = r.json.id;
    const j = (await call('GET', `/jobs/${jobId}`)).json;
    expect(j).toMatchObject({
      bookingNo: 'T275183136', shippingLineCode: 'MAEU', freightTerms: 'PREPAID', serviceType: 'CY/CY', originalsCount: 3,
      freeTimeDays: 9, freeTimeBasis: 'COMBINED', invoiceValue: '20703.000', invoiceCurrency: 'USD', incoterm: 'CIF', countryOfOrigin: 'Vietnam',
    });
    expect(j.commodity).toBe('Fresh seedless lime, Fresh dragon fruit');
    expect(j.hsCodes).toEqual(['08055020', '08109092']);
    expect(j.cargoLines.map((l: Json) => [l.lineNo, l.packages, l.originCountry])).toEqual([[1, 4608, 'Vietnam'], [2, 750, 'Vietnam']]);
    expect(j.cargoLines.every((l: Json) => l.containerId === j.containers[0].id)).toBe(true);
    expect(j.cargoTotals).toMatchObject({ lines: 2, packages: 5358, netWeightKg: 21432, grossWeightKg: 23687.7, warnings: [] });
    expect(j.containers[0]).toMatchObject({ sizeType: '40RH', reeferTempC: '4.0', ventilation: '25 CBM/H', volumeCbm: '50.000', packageKind: 'PALLET' });
  });

  it('works out free time from arrival: ETA first, then ATA; a typed date is kept', async () => {
    const box = async () => (await call('GET', `/jobs/${jobId}`)).json.containers[0];
    expect((await box()).freeTimeExpiresAt).toBe('2026-09-22'); // 14 Sep + 9 days, arrival day counted
    expect((await call('PATCH', `/jobs/${jobId}`, { ata: '2026-09-16' })).status).toBe(200);
    expect((await box()).freeTimeExpiresAt).toBe('2026-09-24');
    const c = await box();
    await call('PATCH', `/jobs/${jobId}/containers/${c.id}`, { freeTimeExpiresAt: '2026-09-30' }); // line granted extra days
    await call('PATCH', `/jobs/${jobId}`, { freeTimeDays: 7 });
    expect((await box()).freeTimeExpiresAt).toBe('2026-09-30');
    await call('PATCH', `/jobs/${jobId}/containers/${c.id}`, { freeTimeExpiresAt: null }); // back to the B/L's free days
    expect((await box()).freeTimeExpiresAt).toBe('2026-09-22');
  });

  it('flags goods weights that do not match the containers, and keeps the summary in step', async () => {
    const add = await call('POST', `/jobs/${jobId}/cargo-lines`, { description: 'Fresh passion fruit', hsCode: '08109094', packages: 10, grossWeightKg: 50 });
    expect(add.status).toBe(201);
    let j = (await call('GET', `/jobs/${jobId}`)).json;
    expect(j.hsCodes).toEqual(['08055020', '08109092', '08109094']);
    expect(j.cargoTotals.warnings[0]).toMatch(/23,737\.7 kg gross, containers to 23,687\.7 kg/);
    expect((await call('DELETE', `/jobs/${jobId}/cargo-lines/${add.json.id}`)).status).toBe(200);
    j = (await call('GET', `/jobs/${jobId}`)).json;
    expect(j.cargoTotals.warnings).toEqual([]);
    expect(j.commodity).toBe('Fresh seedless lime, Fresh dragon fruit');
    const bad = await call('POST', `/jobs/${jobId}/cargo-lines`, { description: 'Mangoes', containerNo: 'ZZZU0000000' });
    expect(bad.status).toBe(422);
  });

  it('accepts one scanned pack as the B/L for verifying documents', async () => {
    const stages = (await call('GET', `/workflow/jobs/${jobId}/stages`)).json;
    const docs = (stages.jobStages as Json[]).find((s) => s.key === 'DOCUMENTS')!;
    expect((await call('POST', `/workflow/jobs/${jobId}/stages/${docs.id}/transitions`, { to: 'RECEIVED' })).status).toBe(200);
    const form = new FormData();
    form.set('jobId', jobId); form.set('docType', 'COMMERCIAL_INVOICE'); form.set('referenceNo', 'TKDN/202609');
    form.set('covers', 'BILL_OF_LADING,PACKING_LIST,CERTIFICATE_OF_ORIGIN,PHYTOSANITARY_CERTIFICATE');
    form.set('file', new File(['%PDF-1.4\n'], 'SCAN 09 KDN AMEER.pdf', { type: 'application/pdf' }));
    const up = await app.request('/api/documents', { method: 'POST', body: form });
    expect(up.status).toBe(201);
    expect((await up.json()).covers).toEqual(['BILL_OF_LADING', 'PACKING_LIST', 'CERTIFICATE_OF_ORIGIN', 'PHYTOSANITARY_CERTIFICATE']);
    expect((await call('POST', `/workflow/jobs/${jobId}/stages/${docs.id}/transitions`, { to: 'VERIFIED' })).status).toBe(200);
  });

  it('finds the job by booking no., invoice no., seal no. and shipper', async () => {
    for (const q of ['T275183136', 'TKDN/202609', 'ML-VN0785728', 'KDN AGRICULTURAL']) {
      expect((await call('GET', `/jobs?q=${encodeURIComponent(q)}`)).json.items.map((j: Json) => j.blNo), q).toContain('T275183136');
    }
  });

  it('names the field in validation errors', async () => {
    const r = await call('POST', '/jobs', salalahBl({
      blNo: 'T275183137', containers: [{ containerNo: 'TSTU4571403', sizeType: '40RH', reeferTempC: 90 }],
      cargoLines: [{ description: 'Lime', hsCode: '08.05', containerNo: 'TSTU9999999' }],
    }));
    expect(r.status).toBe(400);
    const messages = (r.json.errors as Json[]).map((e) => e.message);
    expect(messages).toContain('Goods lines (1st) · HS code: must be 4–12 digits, e.g. 08055020');
    expect(messages).toContain("Goods lines (1st) · Container number: TSTU9999999 is not one of this job's containers");
    expect(messages).toContain('Containers (1st) · Reefer temperature (°C): must be between -40 and 40 °C');
    const none = await call('POST', '/jobs', salalahBl({ blNo: 'T275183138', containers: [{ containerNo: 'TSTU4571404' }], cargoLines: [] }));
    expect((none.json.errors as Json[]).map((e) => e.message)).toContain('Goods lines: add at least one goods line');
  });
});
