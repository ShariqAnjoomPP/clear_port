/**
 * Demo customers and jobs for tests (and demos): run after seed.ts. Eight jobs at different points of the workflow,
 * driven through the real services (same rules as the API), with trips, payments, floats and invoices; timestamps are
 * then spread over the past days so SLAs and ageing look realistic.
 */
import { containerCheckDigit, uuidv7 } from '@clearport/kernel';
import type { CreateJobInput, DisbursementInput } from '@clearport/contracts';
import { asc, eq } from 'drizzle-orm';
import { db, pool, transaction } from '../../src/lib/db';
import { customer, disbursement, stageInstance, staff, vehicle } from '../../src/lib/schema';
import { newLinkToken } from '../../src/lib/tokens';
import { uploadDocument } from '../../src/functions/documents/service';
import { createTrip } from '../../src/functions/fieldops/service';
import { approvalUrl, portalUrl } from '../../src/functions/engagement/service';
import { generateInvoice, issueFloat, reconcile, setInvoiceStatus } from '../../src/functions/finance/service';
import { closeJob, createJob } from '../../src/functions/jobs/service';
import { assignStage, transitionStage } from '../../src/functions/workflow/stages';

const daysFromNow = (d: number) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);

// Staff and vehicles come from seed.ts; customers are created here.
const ids = { staff: {} as Record<string, string>, customers: {} as Record<string, string>, vehicles: [] as string[] };
for (const p of await db.select().from(staff)) ids.staff[p.name.split(' ')[0]!.toLowerCase()] = p.id;
ids.vehicles = (await db.select().from(vehicle).orderBy(asc(vehicle.plateNo))).map((v) => v.id);

await transaction(async (tx) => {
  const contact = (name: string, email: string, phone: string, role: string, whatsappOptIn: boolean) => ({ id: uuidv7(), name, email, phone, role, whatsappOptIn });
  const custs = await tx.insert(customer).values([
    { id: uuidv7(), name: 'Al Noor Trading LLC', customsCode: 'OM-1029384', tradeLicenceNo: 'CR-1177234', address: 'Ghala Industrial Area, Muscat', preferredChannel: 'WHATSAPP', creditLimit: '6000.000', creditDays: 30, tariff: { currency: 'OMR', perBl: '75.000', perContainer: '15.000', vatPct: 5, markupPct: 0 }, contacts: [contact('Ahmed Al Balushi', 'ahmed@alnoor.demo', '+96899112233', 'Logistics manager', true)], portalToken: newLinkToken() },
    { id: uuidv7(), name: 'Desert Bloom Foods', customsCode: 'OM-5582910', tradeLicenceNo: 'CR-1182301', address: 'Sohar Industrial Estate, Sohar', preferredChannel: 'EMAIL', creditLimit: '4000.000', creditDays: 15, tariff: { currency: 'OMR', perBl: '65.000', perContainer: '17.500', vatPct: 5, markupPct: 2 }, contacts: [contact('Lina Haddad', 'lina@desertbloom.demo', '+96899223344', 'Supply chain', false)], portalToken: newLinkToken() },
    { id: uuidv7(), name: 'Majan Steel Imports', customsCode: 'OM-3301877', tradeLicenceNo: 'CR-1090021', address: 'Rusayl Industrial Estate, Muscat', preferredChannel: 'WHATSAPP', language: 'ar', creditLimit: '15000.000', creditDays: 45, tariff: { currency: 'OMR', perBl: '90.000', perContainer: '12.000', vatPct: 5, markupPct: 0 }, contacts: [contact('Khalid Al Harthy', 'khalid@majansteel.demo', '+96899334455', 'Procurement', true)], portalToken: newLinkToken() },
    { id: uuidv7(), name: 'Coastal Electronics LLC', customsCode: 'OM-7710042', tradeLicenceNo: 'CR-1244120', address: 'Al Wadi Al Kabir, Muscat', preferredChannel: 'EMAIL', creditLimit: '8000.000', creditDays: 30, tariff: { currency: 'OMR', perBl: '80.000', perContainer: '16.000', vatPct: 5, markupPct: 0 }, contacts: [contact('Grace Fernandes', 'grace@coastal.demo', '+96899445566', 'Imports', false)], portalToken: newLinkToken() },
    // The consignee on the two real Maersk B/Ls below.
    { id: uuidv7(), name: 'Ameer Barka Business SPC', customsCode: 'OM-2751831', address: 'South Batinah, Barka 113, PO Box 797, Sultanate of Oman', preferredChannel: 'WHATSAPP', creditLimit: '10000.000', creditDays: 30, tariff: { currency: 'OMR', perBl: '70.000', perContainer: '20.000', vatPct: 5, markupPct: 0 }, contacts: [contact('Ameer Al Barkawi', 'imports@ameerbarka.demo', '+96899556677', 'Owner', true)], portalToken: newLinkToken() },
  ]).returning();
  for (const c of custs) ids.customers[c.name.split(' ')[0]!.toLowerCase()] = c.id;
});

// ───────────── demo jobs ─────────────
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj 4 0 obj<</Length 60>>stream\nBT /F1 18 Tf 72 760 Td (ClearPort demo document) Tj ET\nendstream endobj 5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
let serial = 300000;
const containerNo = (owner: string) => {
  const base = `${owner}${String(serial++).padStart(6, '0')}`;
  return `${base}${containerCheckDigit(base)}`;
};

type Spec = { customer: string; bl: string; line: string; owner: string; n: number; commodity: string; hs: string[]; eta: number; coordinator: string; vessel: string; pol: string; freeDays?: number };

async function newJob(s: Spec) {
  const boxes = Array.from({ length: s.n }, (_, i) => ({
    containerNo: containerNo(s.owner), sizeType: (i % 3 === 2 ? '20GP' : '40HC') as '20GP' | '40HC', sealNo: `SL${serial}`, grossWeightKg: 18000 + i * 750,
    packages: 400 + i * 20, packageKind: 'CARTON' as const, freeTimeExpiresAt: daysFromNow(s.freeDays !== undefined ? s.freeDays + i : s.eta + 7),
  }));
  const input: CreateJobInput = {
    customerId: ids.customers[s.customer]!, blNo: s.bl, vessel: s.vessel, voyage: `${100 + (serial % 90)}W`, shippingLineCode: s.line,
    portOfLoading: s.pol, portOfDischarge: 'OMSOH', terminal: 'SOH-CT', eta: daysFromNow(s.eta), hsCodes: [], freightTerms: 'PREPAID', freeTimeBasis: 'COMBINED',
    priority: s.n > 3 ? 'HIGH' : 'NORMAL', coordinatorId: ids.staff[s.coordinator],
    // One goods line per HS code, spread over the containers.
    cargoLines: s.hs.map((hsCode, i) => ({ description: s.hs.length > 1 ? `${s.commodity} (${hsCode})` : s.commodity, hsCode, containerNo: boxes[i % boxes.length]!.containerNo })),
    containers: boxes,
  };
  return createAndLoad(input);
}

async function createAndLoad(input: CreateJobInput) {
  const j = await transaction((tx) => createJob(tx, input));
  const containers = await db.query.container.findMany({ where: (c, { eq: e }) => e(c.jobId, j.id), orderBy: (c, { asc }) => asc(c.containerNo) });
  return { id: j.id, containers };
}

/** The two real Maersk B/Ls (Ho Chi Minh City → Sohar / Salalah, fresh limes and dragon fruit in 40' reefers), as printed. */
const maerskBl = (bl: string, pod: 'OMSOH' | 'OMSLL', eta: number, invoice: { no: string; value: string }, box: { no: string; seal: string; gross: number; temp: number }, lines: CreateJobInput['cargoLines']): CreateJobInput => ({
  customerId: ids.customers.ameer!, blNo: bl, bookingNo: bl, serviceContract: '2220719', shippingLineCode: 'MAEU', vessel: 'ARCHER', voyage: '636S',
  shipper: 'KDN AGRICULTURAL PRODUCTS IMPORT EXPORT CO., LTD\n1244/61 Le Duc Tho, Neighborhood 48, An Hoi Dong Ward, Ho Chi Minh City, Vietnam',
  notifyParty: 'Same as consignee', portOfLoading: 'VNSGN', portOfDischarge: pod, terminal: pod === 'OMSOH' ? 'SOH-CT' : 'SLL-CT', placeOfIssue: 'Ho Chi Minh City',
  blIssueDate: '2026-08-31', shippedOnBoardDate: '2026-08-31', originalsCount: 3, freightTerms: 'PREPAID', serviceType: 'CY/CY',
  freeTimeDays: 9, freeTimeBasis: 'COMBINED', invoiceNo: invoice.no, invoiceDate: '2026-08-29', invoiceValue: invoice.value, invoiceCurrency: 'USD', incoterm: 'CIF',
  countryOfOrigin: 'Vietnam', eta: daysFromNow(eta), hsCodes: [], priority: 'HIGH', coordinatorId: ids.staff.sara,
  containers: [{ containerNo: box.no, sizeType: '40RH', sealNo: box.seal, packages: 20, packageKind: 'PALLET', grossWeightKg: box.gross, volumeCbm: 50, reeferTempC: box.temp, ventilation: '25 CBM/H' }],
  cargoLines: lines,
});

const stageId = async (jobId: string, key: string, containerId: string | null = null) => {
  const rows = await db.select().from(stageInstance).where(eq(stageInstance.jobId, jobId));
  return rows.find((r) => r.stageKey === key && r.containerId === containerId)!.id;
};
const step = async (actor: string, jobId: string, key: string, to: string, fields: Record<string, unknown> = {}, containerId: string | null = null, disbursements: DisbursementInput[] = []) => {
  const stageInstanceId = await stageId(jobId, key, containerId);
  await transaction((tx) => transitionStage(tx, actor, { jobId, stageInstanceId, input: { to, fields, disbursements, remarks: undefined } }));
};
/** A payment made at a stage; PROs pay small fees from their cash float, bigger amounts go on the company card or by transfer. */
const pay = (feeType: string, amount: string, paidBy: string, method: DisbursementInput['paymentMethod'] = 'CASH_FLOAT'): DisbursementInput =>
  ({ feeType, amount, currency: 'OMR', paymentMethod: method, paidOn: daysFromNow(0), paidById: ids.staff[paidBy], billable: true, markupPct: 0 });
const assign = async (jobId: string, key: string, who: string, containerId: string | null = null) => {
  const stageInstanceId = await stageId(jobId, key, containerId);
  await transaction((tx) => assignStage(tx, jobId, stageInstanceId, ids.staff[who]!));
};
const addDoc = (jobId: string, docType: 'BILL_OF_LADING' | 'COMMERCIAL_INVOICE' | 'PACKING_LIST', name: string, customerVisible = false) =>
  uploadDocument(db, { jobId, docType, customerVisible, covers: [] }, { name, type: 'application/pdf', bytes: PDF }, 'Sara Khan');
/** One scanned PDF holding the whole set, as the shipper sends it. */
const addPack = (jobId: string, name: string, referenceNo: string) =>
  uploadDocument(db, { jobId, docType: 'BILL_OF_LADING', customerVisible: true, referenceNo, issueDate: '2026-08-31', covers: ['COMMERCIAL_INVOICE', 'PACKING_LIST', 'CERTIFICATE_OF_ORIGIN', 'PHYTOSANITARY_CERTIFICATE'] }, { name, type: 'application/pdf', bytes: PDF }, 'Sara Khan');

/** Moves a job through the job-level stages up to a named point. */
async function advance(jobId: string, until: 'RECEIVED' | 'BAYAN_FILED' | 'CONFIRMATION_SENT' | 'CCRO_READY' | 'CCRO_ISSUED', opts: { inspect?: string[]; pro?: string } = {}) {
  const pro = opts.pro ?? 'yusuf';
  const proName = pro === 'yusuf' ? 'Yusuf Ali' : 'Imran Qureshi';
  await step('Sara Khan', jobId, 'DOCUMENTS', 'RECEIVED');
  if (until === 'RECEIVED') return;
  await addDoc(jobId, 'BILL_OF_LADING', 'bill-of-lading.pdf', true);
  await addDoc(jobId, 'COMMERCIAL_INVOICE', 'commercial-invoice.pdf');
  await addDoc(jobId, 'PACKING_LIST', 'packing-list.pdf');
  await step('Sara Khan', jobId, 'DOCUMENTS', 'VERIFIED');
  await assign(jobId, 'BAYAN', pro);
  await assign(jobId, 'DO', 'imran');
  await assign(jobId, 'INSPECTION', pro);
  await assign(jobId, 'CCRO', pro);
  // Steps one by one: Bayan → customer → inspection → DO → CCRO.
  await step(proName, jobId, 'BAYAN', 'FILED', { referenceNo: `BYN-${serial++}` }, null, [pay('BAYAN_FEE', '12.000', pro)]);
  if (until === 'BAYAN_FILED') return;
  await step(proName, jobId, 'BAYAN', 'APPROVED');
  await step(proName, jobId, 'BAYAN', 'DUTIES_PAID', {}, null, [pay('CUSTOMS_DUTY', '885.000', pro, 'COMPANY_CARD'), pay('IMPORT_VAT', '221.250', pro, 'COMPANY_CARD')]);
  await step('Sara Khan', jobId, 'CUSTOMER_COMM', 'SENT');
  if (until === 'CONFIRMATION_SENT') return;
  await step('Sara Khan', jobId, 'CUSTOMER_COMM', 'CONFIRMED');
  if (opts.inspect?.length) {
    await step(proName, jobId, 'INSPECTION', 'REQUIRED', { selectedContainerIds: opts.inspect }, null, [pay('INSPECTION_FEE', '35.000', pro)]);
    await step(proName, jobId, 'INSPECTION', 'COMPLETED');
  } else {
    await step(proName, jobId, 'INSPECTION', 'CLEARED');
  }
  await step('Imran Qureshi', jobId, 'DO', 'APPLIED');
  await step('Imran Qureshi', jobId, 'DO', 'CHARGES_PAID', {}, null, [pay('DO_CHARGES', '190.000', 'imran', 'BANK_TRANSFER')]);
  await step('Imran Qureshi', jobId, 'DO', 'DO_RECEIVED', { referenceNo: `DO-${serial++}`, validUntil: daysFromNow(10) });
  if (until === 'CCRO_READY') return;
  await step(proName, jobId, 'CCRO', 'APPLIED');
  await step(proName, jobId, 'CCRO', 'ISSUED', { referenceNo: `CCRO-${serial++}` }, null, [pay('CCRO_FEE', '22.000', pro)]);
}

const SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const trip = (jobId: string, containerIds: string[], driver: string, vehicle: number, inspector?: string) =>
  transaction((tx) => createTrip(tx, 'Sara Khan', {
    jobId, containerIds, driverId: ids.staff[driver]!, vehicleId: ids.vehicles[vehicle]!, inspectionAgentId: inspector ? ids.staff[inspector] : undefined,
    deliveryAddress: 'Warehouse 14, Sohar Industrial Estate', deliveryContact: '+96899112233', deliveryWindow: '08:00–14:00', cost: '65.000', currency: 'OMR',
  }));
const driverName: Record<string, string> = { rashid: 'Rashid Mahmood (driver)', bilal: 'Bilal Ahmed (driver)', jomon: 'Jomon Thomas (driver)' };
/** Truck at port → (inspection) → release → gate out → delivered with proof of delivery. */
async function deliver(jobId: string, containerId: string, driver: string, inspection: 'none' | 'pass' | 'held' = 'none') {
  const who = driverName[driver]!;
  await step(who, jobId, 'TRUCK', 'AT_PORT', {}, containerId);
  if (inspection !== 'none') {
    await step('Fatima Noor', jobId, 'PHYSICAL_INSPECTION', 'SCHEDULED', {}, containerId);
    await step('Fatima Noor', jobId, 'PHYSICAL_INSPECTION', inspection === 'pass' ? 'PASSED' : 'HELD', { remarks: inspection === 'held' ? 'Labelling does not match invoice; sample sent to lab' : 'Contents match declaration' }, containerId);
    if (inspection === 'held') return;
  }
  await step(who, jobId, 'RELEASE', 'RELEASED', {}, containerId);
  await step(who, jobId, 'RELEASE', 'GATED_OUT', {}, containerId);
  await step(who, jobId, 'DELIVERY', 'IN_TRANSIT', {}, containerId);
  await step(who, jobId, 'DELIVERY', 'DELIVERED', { receiverName: 'Store keeper — Mohammed', podSignature: SIGNATURE }, containerId);
}

const ages: Record<string, number> = {};

// 1. Documents just received
const j1 = await newJob({ customer: 'al', bl: 'MEDUJ4471023', line: 'MSCU', owner: 'MSCU', n: 2, commodity: 'Household appliances', hs: ['8418', '8450'], eta: 3, coordinator: 'sara', vessel: 'MSC AURORA', pol: 'CNSHA' });
await advance(j1.id, 'RECEIVED'); ages[j1.id] = 1;
// 2. Bayan filed, DO applied
const j2 = await newJob({ customer: 'desert', bl: 'MAEU238874110', line: 'MAEU', owner: 'MAEU', n: 3, commodity: 'Frozen poultry', hs: ['0207'], eta: 1, coordinator: 'ravi', vessel: 'MAERSK EMDEN', pol: 'INNSA' });
await advance(j2.id, 'BAYAN_FILED'); ages[j2.id] = 3;
// 3. Charges sent, waiting for the customer to confirm
const j3 = await newJob({ customer: 'majan', bl: 'CMDU7781204', line: 'CMDU', owner: 'CMAU', n: 4, commodity: 'Hot-rolled steel coils', hs: ['7208'], eta: -1, coordinator: 'sara', vessel: 'CMA CGM TAGE', pol: 'TRMER', freeDays: 6 });
await advance(j3.id, 'CONFIRMATION_SENT', { pro: 'imran' }); ages[j3.id] = 5;
// 4. CCRO gate open
const j4 = await newJob({ customer: 'coastal', bl: 'COSU6129887', line: 'COSU', owner: 'CSNU', n: 2, commodity: 'Consumer electronics', hs: ['8528', '8517'], eta: -2, coordinator: 'ravi', vessel: 'COSCO PRIDE', pol: 'CNSHA', freeDays: 4 });
await advance(j4.id, 'CCRO_READY'); ages[j4.id] = 6;
// 5. Delivering: one container's truck at the port, two still waiting for a truck with free time running out
const j5 = await newJob({ customer: 'al', bl: 'HLCUSOH250901', line: 'HLCU', owner: 'HLXU', n: 3, commodity: 'Ceramic tiles', hs: ['6907'], eta: -4, coordinator: 'sara', vessel: 'BERLIN EXPRESS', pol: 'SGSIN', freeDays: 1 });
await advance(j5.id, 'CCRO_ISSUED');
await trip(j5.id, [j5.containers[0]!.id], 'rashid', 0);
await step('Rashid Mahmood (driver)', j5.id, 'TRUCK', 'AT_PORT', {}, j5.containers[0]!.id);
ages[j5.id] = 8;
// 6. Mixed: one container gated out, one held at physical inspection
const j6 = await newJob({ customer: 'desert', bl: 'MEDUJ4471999', line: 'MSCU', owner: 'MSCU', n: 2, commodity: 'Rice (basmati)', hs: ['1006'], eta: -6, coordinator: 'ravi', vessel: 'MSC LENA', pol: 'INNSA', freeDays: 2 });
const [c6a, c6b] = j6.containers;
await advance(j6.id, 'CCRO_ISSUED', { inspect: [c6b!.id] });
await trip(j6.id, [c6a!.id, c6b!.id], 'rashid', 0, 'fatima');
await deliver(j6.id, c6a!.id, 'rashid');
await deliver(j6.id, c6b!.id, 'rashid', 'held');
ages[j6.id] = 10;
// 7. Every container delivered with signed proof of delivery: trip completed, job ready to close
const j7 = await newJob({ customer: 'majan', bl: 'CMDU7781555', line: 'CMDU', owner: 'CMAU', n: 2, commodity: 'Steel rebar', hs: ['7214'], eta: -12, coordinator: 'sara', vessel: 'CMA CGM RIGOLETTO', pol: 'TRMER' });
await advance(j7.id, 'CCRO_ISSUED', { pro: 'imran' });
await trip(j7.id, j7.containers.map((c) => c.id), 'bilal', 1);
for (const c of j7.containers) await deliver(j7.id, c.id, 'bilal');
ages[j7.id] = 16;
// 8. Closed: delivered, payments reconciled, invoiced and paid
const j8 = await newJob({ customer: 'coastal', bl: 'COSU6120001', line: 'COSU', owner: 'CSNU', n: 1, commodity: 'Laptops', hs: ['8471'], eta: -20, coordinator: 'ravi', vessel: 'COSCO HOPE', pol: 'CNSHA' });
await advance(j8.id, 'CCRO_ISSUED');
await trip(j8.id, [j8.containers[0]!.id], 'jomon', 2);
await deliver(j8.id, j8.containers[0]!.id, 'jomon');
ages[j8.id] = 25;
// 9–10. The real Maersk B/Ls for Ameer Barka: the Sohar one has its document pack and Bayan filed; the Salalah one is just in.
const j9 = await createAndLoad(maerskBl('275183155', 'OMSOH', -2, { no: 'KDN/202608', value: '20160.000' }, { no: 'MNBU0358657', seal: 'ML-VN1780903', gross: 25344, temp: 5 }, [
  { description: 'Fresh seedless lime', hsCode: '08055020', packages: 5760, packageKind: 'CARTON', netWeightKg: 23040, grossWeightKg: 25344, containerNo: 'MNBU0358657' },
]));
await step('Sara Khan', j9.id, 'DOCUMENTS', 'RECEIVED');
await addPack(j9.id, 'SCAN 08 KDN AMEER CHANH MSK, 31 AUG 2026.pdf', '275183155');
await step('Sara Khan', j9.id, 'DOCUMENTS', 'VERIFIED');
await step('Yusuf Ali', j9.id, 'BAYAN', 'FILED', { referenceNo: `BYN-${serial++}` }, null, [pay('BAYAN_FEE', '12.000', 'yusuf'), pay('PLANT_QUARANTINE', '15.000', 'yusuf')]);
ages[j9.id] = 2;
const j10 = await createAndLoad(maerskBl('275183136', 'OMSLL', 3, { no: 'KDN/202609', value: '20703.000' }, { no: 'MNBU4571402', seal: 'ML-VN0785728', gross: 23687.7, temp: 4 }, [
  { description: 'Fresh seedless lime', hsCode: '08055020', packages: 4608, packageKind: 'CARTON', netWeightKg: 18432, grossWeightKg: 20275.2, containerNo: 'MNBU4571402' },
  { description: 'Fresh dragon fruit', hsCode: '08109092', packages: 750, packageKind: 'CARTON', netWeightKg: 3000, grossWeightKg: 3412.5, containerNo: 'MNBU4571402' },
]));
await step('Sara Khan', j10.id, 'DOCUMENTS', 'RECEIVED');
ages[j10.id] = 1;

// Accounts: cash floats for the PROs, payments reconciled on the finished jobs, invoices, and job 8 closed.
await issueFloat(db, { staffId: ids.staff.yusuf!, amount: '200.000', currency: 'OMR', issuedOn: daysFromNow(-20), note: 'Monthly float' });
await issueFloat(db, { staffId: ids.staff.imran!, amount: '150.000', currency: 'OMR', issuedOn: daysFromNow(-20), note: 'Monthly float' });
for (const jobId of [j7.id, j8.id]) {
  for (const d of await db.select().from(disbursement).where(eq(disbursement.jobId, jobId))) await reconcile(db, d.id);
}
const inv7 = await transaction((tx) => generateInvoice(tx, j7.id));
await transaction((tx) => setInvoiceStatus(tx, inv7.id, 'ISSUED'));
const inv8 = await transaction((tx) => generateInvoice(tx, j8.id));
await transaction(async (tx) => {
  await setInvoiceStatus(tx, inv8.id, 'ISSUED');
  await setInvoiceStatus(tx, inv8.id, 'PAID');
  await closeJob(tx, j8.id);
});

// Spread timestamps over past days so SLA clocks, overdue flags and the timeline look realistic.
for (const [jobId, days] of Object.entries(ages)) {
  await pool.query(`
    WITH base AS (SELECT now() - make_interval(days => $2::int) AS t0)
    UPDATE stage_instance si SET
      started_at = CASE WHEN si.started_at IS NULL THEN NULL ELSE least(base.t0 + (o.ord * interval '14 hours'), now() - interval '3 hours') END,
      completed_at = CASE WHEN si.completed_at IS NULL THEN NULL ELSE least(base.t0 + (o.ord * interval '14 hours') + ((4 + abs(hashtext(si.id::text)) % 30) * interval '1 hour'), now() - interval '1 hour') END,
      sla_due_at = CASE WHEN si.started_at IS NULL THEN NULL ELSE least(base.t0 + (o.ord * interval '14 hours'), now() - interval '3 hours') + interval '30 hours' END
    FROM base, (VALUES ('DOCUMENTS',0),('BAYAN',1),('DO',1),('CUSTOMER_COMM',2),('INSPECTION',3),('CCRO',4),('TRUCK',5),('PHYSICAL_INSPECTION',6),('RELEASE',6),('DELIVERY',7)) o(key, ord)
    WHERE si.job_id = $1 AND si.stage_key = o.key`, [jobId, days]);
  await pool.query(`UPDATE job SET created_at = now() - make_interval(days => $2::int) WHERE id = $1`, [jobId, days]);
  await pool.query(`UPDATE stage_event e SET occurred_at = coalesce(si.completed_at, si.started_at, e.occurred_at) FROM stage_instance si WHERE si.id = e.stage_instance_id AND e.job_id = $1`, [jobId]);
  await pool.query(`UPDATE document SET created_at = (SELECT created_at FROM job WHERE id = $1) + interval '2 hours' WHERE job_id = $1`, [jobId]);
  await pool.query(`UPDATE disbursement d SET created_at = coalesce(si.completed_at, si.started_at, d.created_at), paid_on = coalesce(si.completed_at, si.started_at, d.created_at)::date FROM stage_instance si WHERE si.id = d.stage_instance_id AND d.job_id = $1`, [jobId]);
}
// Invoice dates: job 7's invoice is past due (shows in receivables ageing); job 8 closed a few days ago.
await pool.query(`UPDATE invoice SET issue_date = current_date - 12, due_date = current_date - 5 WHERE id = $1`, [inv7.id]);
await pool.query(`UPDATE invoice SET issue_date = current_date - 8, due_date = current_date + 22, paid_at = now() - interval '3 days' WHERE id = $1`, [inv8.id]);
await pool.query(`UPDATE job SET closed_at = now() - interval '2 days' WHERE id = $1`, [j8.id]);

const [approval] = (await pool.query(`SELECT a.token FROM customer_approval a JOIN job j ON j.id = a.job_id WHERE j.bl_no = 'CMDU7781204' AND a.status = 'PENDING'`)).rows;
const [portal] = (await pool.query(`SELECT portal_token FROM customer WHERE name = 'Al Noor Trading LLC'`)).rows;
await pool.end();
console.log('Demo data: 5 customers, 10 jobs (2 from real Maersk B/Ls), 4 trips, payments, 2 floats, 2 invoices');
console.log(`Customer approval link (BL CMDU7781204): ${approvalUrl(approval.token)}`);
console.log(`Customer portal (Al Noor Trading):      ${portalUrl(portal.portal_token)}`);
