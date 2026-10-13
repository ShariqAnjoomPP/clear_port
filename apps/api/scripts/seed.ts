/**
 * Demo data for the stakeholder prototype. Jobs are driven through the real application services
 * (same gates, events, outbox and projections as production), then timestamps are spread over
 * the past weeks so reports and SLAs look realistic.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import pg from 'pg';
import { eq } from 'drizzle-orm';
import { containerCheckDigit, uuidv7, type Role } from '@clearport/kernel';
import { DEFAULT_WORKFLOW } from '@clearport/workflow';
import type { Actor } from '../src/shared/context';
import { db, withTenant, type Tx, type UnitOfWork } from '../src/shared/db';
import { appUser, container, contact, customer, document, driver, job, masterItem, stageDefinition, stageInstance, tenant, vehicle } from '../src/shared/schema';
import { boot } from '../src/composition';
import { relayOutbox } from '../src/shared/bus';
import { createJobStages, transitionStage, assignStage } from '../src/modules/workflow/public';
import { nextJobNo } from '../src/modules/clearance/public';
import { createTrip } from '../src/modules/fieldops/routes';
import { recordDisbursements } from '../src/modules/finance/public';
import { projectJob } from '../src/modules/insight/projector';
import { disbursement, customerApproval, invoice } from '../src/shared/schema';
import { generateInvoice } from '../src/modules/finance/public';
import { closeJob } from '../src/modules/clearance/service';
import { hashToken, newLinkToken } from '../src/shared/auth';

boot();
const FILE_DIR = resolve(process.cwd(), process.env.LOCAL_FILE_DIR ?? '.data/uploads');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj 4 0 obj<</Length 60>>stream\nBT /F1 18 Tf 72 760 Td (ClearPort demo document) Tj ET\nendstream endobj 5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
const SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

let serial = 300000;
const cno = (owner: string) => {
  const base = `${owner}${String(serial++).padStart(6, '0')}`;
  return `${base}${containerCheckDigit(base)}`;
};
const daysFromNow = (d: number) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);

type U = typeof appUser.$inferSelect;
const actorOf = (u: U): Actor => ({ kind: 'user', userId: u.id, tenantId: u.tenantId, name: u.name, roles: u.roles as Role[], customerId: u.customerId });

async function createTenant(name: string, slug: string) {
  const id = uuidv7();
  await withTenant({ tenantId: id, customerId: null }, async (tx) => {
    await tx.insert(tenant).values({ id, name, slug, baseCurrency: 'AED', timezone: 'Asia/Dubai', settings: { vatPct: 5 } });
    await tx.insert(stageDefinition).values({ id: uuidv7(), tenantId: id, version: 1, definition: DEFAULT_WORKFLOW, active: true });
  });
  return id;
}

async function main() {
  const existing = await db.$client.query('select 1 from platform.find_login($1)', ['owner@gulfgate.demo']);
  if (existing.rowCount) {
    console.log('Seed data already present (run `npm run db:reset` to start over)');
    process.exit(0);
  }

  // ── Tenant A: the pilot client ──
  const T = await createTenant('Gulf Gate Clearing LLC', 'gulfgate');
  const sys = { tenantId: T, customerId: null };

  const users = await withTenant(sys, async (tx) => {
    const mk = (email: string, name: string, roles: Role[], phone: string, customerId: string | null = null) => ({ id: uuidv7(), tenantId: T, email, name, roles, phone, customerId, locale: 'en' });
    const custIds = { alnoor: uuidv7(), desert: uuidv7(), steel: uuidv7(), coastal: uuidv7() };
    await tx.insert(customer).values([
      { id: custIds.alnoor, tenantId: T, name: 'Al Noor Trading LLC', customsCode: 'AE-1029384', tradeLicenceNo: 'DXB-772341', address: 'Al Quoz Industrial 3, Dubai', preferredChannel: 'WHATSAPP', language: 'en', creditLimit: '60000.000', creditDays: 30, tariff: { currency: 'AED', perBl: '750.000', perContainer: '150.000', vatPct: 5, markupPct: 0 } },
      { id: custIds.desert, tenantId: T, name: 'Desert Bloom Foods', customsCode: 'AE-5582910', tradeLicenceNo: 'SHJ-118230', address: 'Sharjah Industrial Area 6', preferredChannel: 'EMAIL', language: 'en', creditLimit: '40000.000', creditDays: 15, tariff: { currency: 'AED', perBl: '650.000', perContainer: '175.000', vatPct: 5, markupPct: 2 } },
      { id: custIds.steel, tenantId: T, name: 'Emirates Steel Imports', customsCode: 'AE-3301877', tradeLicenceNo: 'AUH-90021', address: 'ICAD II, Abu Dhabi', preferredChannel: 'WHATSAPP', language: 'ar', creditLimit: '150000.000', creditDays: 45, tariff: { currency: 'AED', perBl: '900.000', perContainer: '120.000', vatPct: 5, markupPct: 0 } },
      { id: custIds.coastal, tenantId: T, name: 'Coastal Electronics FZE', customsCode: 'AE-7710042', tradeLicenceNo: 'JAFZA-44120', address: 'JAFZA South, Dubai', preferredChannel: 'EMAIL', language: 'en', creditLimit: '80000.000', creditDays: 30, tariff: { currency: 'AED', perBl: '800.000', perContainer: '160.000', vatPct: 5, markupPct: 0 } },
    ]);
    await tx.insert(contact).values([
      { id: uuidv7(), tenantId: T, customerId: custIds.alnoor, name: 'Ahmed Al Mansouri', email: 'ahmed@alnoor.demo', phone: '+971501112233', role: 'Logistics manager', whatsappOptIn: true },
      { id: uuidv7(), tenantId: T, customerId: custIds.desert, name: 'Lina Haddad', email: 'lina@desertbloom.demo', phone: '+971502223344', role: 'Supply chain', whatsappOptIn: false },
      { id: uuidv7(), tenantId: T, customerId: custIds.steel, name: 'Khalid Al Suwaidi', email: 'khalid@emiratessteel.demo', phone: '+971503334455', role: 'Procurement', whatsappOptIn: true },
      { id: uuidv7(), tenantId: T, customerId: custIds.coastal, name: 'Grace Fernandes', email: 'grace@coastal.demo', phone: '+971504445566', role: 'Imports', whatsappOptIn: false },
    ]);
    const list = [
      mk('owner@gulfgate.demo', 'Omar Haddad', ['OWNER'], '+971500000001'),
      mk('sara@gulfgate.demo', 'Sara Khan', ['COORDINATOR'], '+971500000002'),
      mk('ravi@gulfgate.demo', 'Ravi Menon', ['COORDINATOR'], '+971500000003'),
      mk('yusuf@gulfgate.demo', 'Yusuf Ali', ['PRO'], '+971500000004'),
      mk('imran@gulfgate.demo', 'Imran Qureshi', ['PRO'], '+971500000005'),
      mk('fatima@gulfgate.demo', 'Fatima Noor', ['INSPECTOR'], '+971500000006'),
      mk('rashid@gulfgate.demo', 'Rashid Mahmood', ['DRIVER'], '+971500000007'),
      mk('priya@gulfgate.demo', 'Priya Nair', ['ACCOUNTS'], '+971500000008'),
      mk('admin@gulfgate.demo', 'Platform Admin', ['ADMIN'], '+971500000009'),
      mk('ahmed@alnoor.demo', 'Ahmed Al Mansouri', ['CUSTOMER'], '+971501112233', custIds.alnoor),
      mk('khalid@emiratessteel.demo', 'Khalid Al Suwaidi', ['CUSTOMER'], '+971503334455', custIds.steel),
    ];
    const rows = await tx.insert(appUser).values(list).returning();
    const masters: [string, string, string][] = [
      ['PORT', 'AEJEA', 'Jebel Ali, Dubai'], ['PORT', 'AEKHL', 'Khalifa Port, Abu Dhabi'], ['PORT', 'CNSHA', 'Shanghai'], ['PORT', 'INNSA', 'Nhava Sheva'], ['PORT', 'SGSIN', 'Singapore'], ['PORT', 'TRMER', 'Mersin'],
      ['TERMINAL', 'JA-T1', 'Jebel Ali Terminal 1'], ['TERMINAL', 'JA-T2', 'Jebel Ali Terminal 2'], ['TERMINAL', 'KP-CT', 'Khalifa Port Container Terminal'],
      ['SHIPPING_LINE', 'MSC', 'MSC'], ['SHIPPING_LINE', 'MAERSK', 'Maersk'], ['SHIPPING_LINE', 'CMA', 'CMA CGM'], ['SHIPPING_LINE', 'COSCO', 'COSCO'], ['SHIPPING_LINE', 'HAPAG', 'Hapag-Lloyd'],
      ['FEE_TYPE', 'CUSTOMS_DUTY', 'Customs duty'], ['FEE_TYPE', 'IMPORT_VAT', 'Import VAT'], ['FEE_TYPE', 'BAYAN_FEE', 'Bayan / declaration fee'], ['FEE_TYPE', 'DO_CHARGES', 'Shipping line DO charges'],
      ['FEE_TYPE', 'INSPECTION_FEE', 'Inspection / scanning fee'], ['FEE_TYPE', 'CCRO_FEE', 'CCRO fee'], ['FEE_TYPE', 'PORT_STORAGE', 'Port storage'], ['FEE_TYPE', 'TERMINAL_HANDLING', 'Terminal handling'], ['FEE_TYPE', 'OTHER', 'Other'],
    ];
    await tx.insert(masterItem).values(masters.map(([kind, code, name]) => ({ id: uuidv7(), tenantId: T, kind, code, name, data: {} })));
    const byEmail = Object.fromEntries(rows.map((r) => [r.email.split('@')[0]!, r]));
    const drivers = await tx.insert(driver).values([
      { id: uuidv7(), tenantId: T, name: 'Rashid Mahmood', phone: '+971500000007', licenceNo: 'DXB-HV-55120', licenceExpiry: daysFromNow(400), transporter: 'Gulf Gate fleet', userId: byEmail.rashid!.id },
      { id: uuidv7(), tenantId: T, name: 'Bilal Ahmed', phone: '+971505550101', licenceNo: 'DXB-HV-77812', licenceExpiry: daysFromNow(200), transporter: 'Karim Transport' },
      { id: uuidv7(), tenantId: T, name: 'Jomon Thomas', phone: '+971505550202', licenceNo: 'SHJ-HV-10293', licenceExpiry: daysFromNow(25), transporter: 'Karim Transport' },
    ]).returning();
    const vehicles = await tx.insert(vehicle).values([
      { id: uuidv7(), tenantId: T, plateNo: 'DXB-K-48211', type: 'Trailer 40ft', registrationExpiry: daysFromNow(300), transporter: 'Gulf Gate fleet' },
      { id: uuidv7(), tenantId: T, plateNo: 'DXB-L-10922', type: 'Trailer 40ft', registrationExpiry: daysFromNow(150), transporter: 'Karim Transport' },
      { id: uuidv7(), tenantId: T, plateNo: 'SHJ-3-77120', type: 'Trailer 20ft', registrationExpiry: daysFromNow(90), transporter: 'Karim Transport' },
    ]).returning();
    return { byEmail, custIds, drivers, vehicles };
  });

  const { byEmail: u, custIds, drivers, vehicles } = users;
  const sara = actorOf(u.sara!), ravi = actorOf(u.ravi!), yusuf = actorOf(u.yusuf!), imran = actorOf(u.imran!), fatima = actorOf(u.fatima!), rashid = actorOf(u.rashid!), priya = actorOf(u.priya!);

  type JobSpec = { customerId: string; bl: string; line: string; owner: string; n: number; commodity: string; hs: string[]; eta: number; coordinator: Actor; vessel: string; pol: string; freeDays?: number };
  const stagesOf = async (tx: Tx, jobId: string) => {
    const rows = await tx.select().from(stageInstance).where(eq(stageInstance.jobId, jobId));
    const get = (key: string, containerId: string | null = null) => rows.find((r) => r.stageKey === key && r.containerId === containerId)!;
    return { rows, get };
  };
  const step = async (tx: Tx, uow: UnitOfWork, actor: Actor, jobId: string, key: string, to: string, fields: Record<string, unknown> = {}, containerId: string | null = null, disb: Parameters<typeof recordDisbursements>[4] = []) => {
    const s = (await stagesOf(tx, jobId)).get(key, containerId);
    await transitionStage(tx, uow, actor, undefined, { jobId, stageInstanceId: s.id, input: { to, fields, disbursements: disb, remarks: undefined }, skipPermission: false });
  };
  const assign = async (tx: Tx, uow: UnitOfWork, jobId: string, key: string, who: Actor) => {
    const s = (await stagesOf(tx, jobId)).get(key);
    await assignStage(tx, uow, sara, undefined, jobId, s.id, who.userId);
  };
  const pay = (feeType: string, amount: string, method: 'CASH_FLOAT' | 'COMPANY_CARD' | 'BANK_TRANSFER' | 'ONLINE' = 'CASH_FLOAT', billable = true) =>
    ({ feeType, amount, currency: 'AED', paymentMethod: method, paidOn: daysFromNow(0), billable, markupPct: 0 }) as Parameters<typeof recordDisbursements>[4][number];

  async function createJob(spec: JobSpec) {
    return withTenant(sys, async (tx, uow) => {
      const id = uuidv7();
      const jobNo = await nextJobNo(tx, T);
      await tx.insert(job).values({
        id, tenantId: T, jobNo, blNo: spec.bl, customerId: spec.customerId, vessel: spec.vessel, voyage: `${100 + (serial % 90)}E`, shippingLineCode: spec.line,
        portOfLoading: spec.pol, portOfDischarge: 'AEJEA', terminal: 'JA-T2', eta: daysFromNow(spec.eta), commodity: spec.commodity, hsCodes: spec.hs,
        priority: spec.n > 3 ? 'HIGH' : 'NORMAL', coordinatorId: spec.coordinator.userId, status: 'OPEN', workflowVersion: 1, createdBy: spec.coordinator.userId,
      });
      const conts = await tx.insert(container).values(Array.from({ length: spec.n }, (_, i) => ({
        id: uuidv7(), tenantId: T, jobId: id, containerNo: cno(spec.owner), sizeType: i % 3 === 2 ? '20GP' : '40HC', sealNo: `SL${serial}`,
        grossWeightKg: String(18000 + i * 750), packages: 400 + i * 20, freeTimeExpiresAt: spec.freeDays !== undefined ? daysFromNow(spec.freeDays + i) : daysFromNow(spec.eta + 7),
      }))).returning();
      await createJobStages(tx, T, id, DEFAULT_WORKFLOW);
      uow.emit({ id: uuidv7(), type: 'JobCreated', tenantId: T, aggregateType: 'job', aggregateId: id, payload: { jobId: id }, occurredAt: new Date().toISOString() });
      return { id, jobNo, containers: conts };
    });
  }

  async function addDoc(jobId: string, docType: string, name: string, customerVisible = false) {
    await withTenant(sys, async (tx) => {
      const key = `tenant/${T}/job/${jobId}/${uuidv7()}/${name}`;
      const path = resolve(FILE_DIR, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, PDF);
      await tx.insert(document).values({ id: uuidv7(), tenantId: T, jobId, docType, fileName: name, contentType: 'application/pdf', sizeBytes: PDF.length, storageKey: key, customerVisible, uploadedBy: sara.userId, uploadedByName: sara.name });
    });
  }

  const run = (fn: (tx: Tx, uow: UnitOfWork) => Promise<unknown>) => withTenant(sys, fn);

  // Advances a job through the BL-level stages up to a named milestone.
  async function advance(jobId: string, until: 'RECEIVED' | 'VERIFIED' | 'BAYAN_FILED' | 'APPROVAL_SENT' | 'CCRO_READY' | 'CCRO_ISSUED', opts: { inspect?: string[]; pro?: Actor } = {}) {
    const pro = opts.pro ?? yusuf;
    await run((tx, uow) => step(tx, uow, sara, jobId, 'DOCUMENTS', 'RECEIVED'));
    if (until === 'RECEIVED') return;
    await addDoc(jobId, 'BILL_OF_LADING', 'bill-of-lading.pdf', true);
    await addDoc(jobId, 'COMMERCIAL_INVOICE', 'commercial-invoice.pdf');
    await addDoc(jobId, 'PACKING_LIST', 'packing-list.pdf');
    await run((tx, uow) => step(tx, uow, sara, jobId, 'DOCUMENTS', 'VERIFIED'));
    if (until === 'VERIFIED') return;
    await run(async (tx, uow) => {
      await assign(tx, uow, jobId, 'BAYAN', pro);
      await assign(tx, uow, jobId, 'DO', imran);
      await assign(tx, uow, jobId, 'INSPECTION', pro);
      await assign(tx, uow, jobId, 'CCRO', pro);
    });
    await run((tx, uow) => step(tx, uow, pro, jobId, 'BAYAN', 'FILED', { referenceNo: `BYN-${serial++}` }, null, [pay('BAYAN_FEE', '120.000')]));
    await run((tx, uow) => step(tx, uow, imran, jobId, 'DO', 'APPLIED'));
    if (until === 'BAYAN_FILED') return;
    await run((tx, uow) => step(tx, uow, pro, jobId, 'BAYAN', 'APPROVED'));
    await run((tx, uow) => step(tx, uow, pro, jobId, 'BAYAN', 'DUTIES_PAID', {}, null, [pay('CUSTOMS_DUTY', '8450.000', 'COMPANY_CARD'), pay('IMPORT_VAT', '2112.500', 'COMPANY_CARD')]));
    await run((tx, uow) => step(tx, uow, imran, jobId, 'DO', 'CHARGES_PAID', {}, null, [pay('DO_CHARGES', '1850.000', 'BANK_TRANSFER')]));
    await run((tx, uow) => step(tx, uow, imran, jobId, 'DO', 'DO_RECEIVED', { referenceNo: `DO-${serial++}`, validUntil: daysFromNow(10) }));
    await run((tx, uow) => step(tx, uow, sara, jobId, 'CUSTOMER_COMM', 'SENT'));
    if (until === 'APPROVAL_SENT') return;
    await run((tx, uow) => step(tx, uow, sara, jobId, 'CUSTOMER_COMM', 'CONFIRMED'));
    if (opts.inspect?.length) {
      await run((tx, uow) => step(tx, uow, pro, jobId, 'INSPECTION', 'REQUIRED', { selectedContainerIds: opts.inspect }, null, [pay('INSPECTION_FEE', '350.000')]));
      await run((tx, uow) => step(tx, uow, pro, jobId, 'INSPECTION', 'COMPLETED'));
    } else {
      await run((tx, uow) => step(tx, uow, pro, jobId, 'INSPECTION', 'CLEARED'));
    }
    if (until === 'CCRO_READY') return;
    await run((tx, uow) => step(tx, uow, pro, jobId, 'CCRO', 'APPLIED'));
    await run((tx, uow) => step(tx, uow, pro, jobId, 'CCRO', 'ISSUED', { referenceNo: `CCRO-${serial++}` }, null, [pay('CCRO_FEE', '210.000')]));
  }

  async function trip(jobId: string, containerIds: string[], d: number, v: number, inspector = false) {
    return run((tx, uow) => createTrip(tx, uow, sara, undefined, {
      jobId, containerIds, driverId: drivers[d]!.id, vehicleId: vehicles[v]!.id, inspectionAgentId: inspector ? fatima.userId! : undefined,
      deliveryAddress: 'Warehouse 14, Al Quoz Industrial 3, Dubai', deliveryContact: '+971501112233', deliveryWindow: '08:00–14:00', cost: '650.000', currency: 'AED',
    }));
  }
  const driverActor = (d: number) => (d === 0 ? rashid : { ...sara, name: `${drivers[d]!.name} (driver)` });
  async function deliverContainer(jobId: string, cId: string, d: number, inspected: 'none' | 'pass' | 'held') {
    const who = driverActor(d);
    await run((tx, uow) => step(tx, uow, who, jobId, 'TRUCK', 'AT_PORT', {}, cId));
    if (inspected !== 'none') {
      await run((tx, uow) => step(tx, uow, fatima, jobId, 'PHYSICAL_INSPECTION', 'SCHEDULED', {}, cId));
      await run((tx, uow) => step(tx, uow, fatima, jobId, 'PHYSICAL_INSPECTION', inspected === 'pass' ? 'PASSED' : 'HELD', { remarks: inspected === 'held' ? 'Labelling does not match invoice; sample sent to lab' : 'Contents match declaration' }, cId));
      if (inspected === 'held') return;
    }
    await run((tx, uow) => step(tx, uow, who, jobId, 'RELEASE', 'RELEASED', {}, cId));
    await run((tx, uow) => step(tx, uow, who, jobId, 'RELEASE', 'GATED_OUT', {}, cId));
    await run((tx, uow) => step(tx, uow, who, jobId, 'DELIVERY', 'IN_TRANSIT', {}, cId));
    await run((tx, uow) => step(tx, uow, who, jobId, 'DELIVERY', 'DELIVERED', { receiverName: 'Store keeper — Mohammed', podSignature: SIGNATURE }, cId));
  }

  const ages: Record<string, number> = {};
  // 1. Documents just received
  const j1 = await createJob({ customerId: custIds.alnoor, bl: 'MEDUJ4471023', line: 'MSC', owner: 'MSCU', n: 2, commodity: 'Household appliances', hs: ['8418', '8450'], eta: 3, coordinator: sara, vessel: 'MSC AURORA', pol: 'CNSHA' });
  await advance(j1.id, 'RECEIVED'); ages[j1.id] = 1;
  // 2. Bayan filed, DO applied
  const j2 = await createJob({ customerId: custIds.desert, bl: 'MAEU238874110', line: 'MAERSK', owner: 'MAEU', n: 3, commodity: 'Frozen poultry', hs: ['0207'], eta: 1, coordinator: ravi, vessel: 'MAERSK EMDEN', pol: 'INNSA' });
  await advance(j2.id, 'BAYAN_FILED'); ages[j2.id] = 3;
  // 3. Waiting for customer approval (one-tap link)
  const j3 = await createJob({ customerId: custIds.steel, bl: 'CMDU7781204', line: 'CMA', owner: 'CMAU', n: 4, commodity: 'Hot-rolled steel coils', hs: ['7208'], eta: -1, coordinator: sara, vessel: 'CMA CGM TAGE', pol: 'TRMER', freeDays: 6 });
  await advance(j3.id, 'APPROVAL_SENT', { pro: imran }); ages[j3.id] = 5;
  // 4. CCRO gate open
  const j4 = await createJob({ customerId: custIds.coastal, bl: 'COSU6129887', line: 'COSCO', owner: 'CSNU', n: 2, commodity: 'Consumer electronics', hs: ['8528', '8517'], eta: -2, coordinator: ravi, vessel: 'COSCO PRIDE', pol: 'CNSHA', freeDays: 4 });
  await advance(j4.id, 'CCRO_READY'); ages[j4.id] = 6;
  // 5. Delivering: one container on a trip, one waiting for a truck with free time running out
  const j5 = await createJob({ customerId: custIds.alnoor, bl: 'HLCUDXB250901', line: 'HAPAG', owner: 'HLXU', n: 3, commodity: 'Ceramic tiles', hs: ['6907'], eta: -4, coordinator: sara, vessel: 'BERLIN EXPRESS', pol: 'SGSIN', freeDays: 1 });
  await advance(j5.id, 'CCRO_ISSUED', { inspect: [] });
  await trip(j5.id, [j5.containers[0]!.id], 0, 0);
  await run((tx, uow) => step(tx, uow, rashid, j5.id, 'TRUCK', 'AT_PORT', {}, j5.containers[0]!.id));
  await trip(j5.id, [j5.containers[1]!.id], 1, 1); ages[j5.id] = 8;
  // 6. Mixed: one delivered, one held at physical inspection
  const j6 = await createJob({ customerId: custIds.desert, bl: 'MEDUJ4471999', line: 'MSC', owner: 'MSCU', n: 2, commodity: 'Rice (basmati)', hs: ['1006'], eta: -6, coordinator: ravi, vessel: 'MSC LENA', pol: 'INNSA', freeDays: 2 });
  await advance(j6.id, 'CCRO_ISSUED', { inspect: [j6.containers[1]!.id] });
  await trip(j6.id, j6.containers.map((c) => c.id), 0, 0, true);
  await deliverContainer(j6.id, j6.containers[0]!.id, 0, 'none');
  await deliverContainer(j6.id, j6.containers[1]!.id, 0, 'held'); ages[j6.id] = 10;
  // 7. All delivered, ready to close (payments reconciled)
  const j7 = await createJob({ customerId: custIds.steel, bl: 'CMDU7781555', line: 'CMA', owner: 'CMAU', n: 2, commodity: 'Steel rebar', hs: ['7214'], eta: -12, coordinator: sara, vessel: 'CMA CGM RIGOLETTO', pol: 'TRMER' });
  await advance(j7.id, 'CCRO_ISSUED', { pro: imran });
  await trip(j7.id, j7.containers.map((c) => c.id), 1, 1);
  for (const c of j7.containers) await deliverContainer(j7.id, c.id, 1, 'none');
  ages[j7.id] = 16;
  // 8. Closed and invoiced
  const j8 = await createJob({ customerId: custIds.coastal, bl: 'COSU6120001', line: 'COSCO', owner: 'CSNU', n: 1, commodity: 'Laptops', hs: ['8471'], eta: -20, coordinator: ravi, vessel: 'COSCO HOPE', pol: 'CNSHA' });
  await advance(j8.id, 'CCRO_ISSUED');
  await trip(j8.id, [j8.containers[0]!.id], 2, 2);
  await deliverContainer(j8.id, j8.containers[0]!.id, 2, 'none');
  ages[j8.id] = 25;

  // Reconcile payments for the finished jobs, issue invoices, close job 8.
  await withTenant(sys, async (tx) => {
    for (const jid of [j7.id, j8.id]) await tx.update(disbursement).set({ status: 'RECONCILED', reconciledBy: priya.userId, reconciledAt: new Date() }).where(eq(disbursement.jobId, jid));
  });
  // PRO float for Yusuf and Imran
  await withTenant(sys, async (tx) => {
    const { proFloat } = await import('../src/shared/schema');
    await tx.insert(proFloat).values([
      { id: uuidv7(), tenantId: T, userId: yusuf.userId!, amount: '5000.000', currency: 'AED', issuedOn: daysFromNow(-20), note: 'Monthly float', createdBy: priya.userId },
      { id: uuidv7(), tenantId: T, userId: imran.userId!, amount: '3000.000', currency: 'AED', issuedOn: daysFromNow(-20), note: 'Monthly float', createdBy: priya.userId },
    ]);
  });

  // Customer approval link for job 3 (printed so the demo can open it without email/WhatsApp).
  const approvalToken = newLinkToken();
  await withTenant(sys, async (tx) => {
    const [a] = await tx.select().from(customerApproval).where(eq(customerApproval.jobId, j3.id));
    if (a) await tx.update(customerApproval).set({ tokenHash: await hashToken(approvalToken) }).where(eq(customerApproval.id, a.id));
  });

  // ── Tenant B: proves isolation in the demo ──
  const T2 = await createTenant('Harbour Line Brokers', 'harbourline');
  await withTenant({ tenantId: T2, customerId: null }, async (tx) => {
    await tx.insert(appUser).values({ id: uuidv7(), tenantId: T2, email: 'owner@harbourline.demo', name: 'Hassan Rahimi', roles: ['OWNER'], phone: '+971509990000', locale: 'en' });
    const cid = uuidv7();
    await tx.insert(customer).values({ id: cid, tenantId: T2, name: 'Blue Ocean Retail', preferredChannel: 'EMAIL', language: 'en', creditDays: 30 });
    const id = uuidv7();
    await tx.insert(job).values({ id, tenantId: T2, jobNo: await nextJobNo(tx, T2), blNo: 'ONEYDXB000123', customerId: cid, eta: daysFromNow(2), commodity: 'Furniture', priority: 'NORMAL', status: 'OPEN', workflowVersion: 1 });
    await tx.insert(container).values({ id: uuidv7(), tenantId: T2, jobId: id, containerNo: cno('ONEU'), sizeType: '40HC' });
    await createJobStages(tx, T2, id, DEFAULT_WORKFLOW);
    await projectJob(tx, id);
  });

  // Let the in-process consumers finish, then sweep the outbox.
  await new Promise((r) => setTimeout(r, 1500));
  await relayOutbox(1000);
  await new Promise((r) => setTimeout(r, 500));

  // Spread timestamps over past weeks (owner connection) so SLAs, cycle times and ageing look realistic.
  const owner = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL });
  await owner.connect();
  for (const [jid, days] of Object.entries(ages)) {
    await owner.query(`
      WITH base AS (SELECT now() - make_interval(days => $2::int) AS t0)
      UPDATE workflow.stage_instance si SET
        started_at = CASE WHEN si.started_at IS NULL THEN NULL ELSE least(base.t0 + (o.ord * interval '14 hours'), now() - interval '3 hours') END,
        completed_at = CASE WHEN si.completed_at IS NULL THEN NULL ELSE least(base.t0 + (o.ord * interval '14 hours') + ((4 + abs(hashtext(si.id::text)) % 30) * interval '1 hour'), now() - interval '1 hour') END,
        sla_due_at = CASE WHEN si.completed_at IS NULL AND si.sla_due_at IS NOT NULL THEN least(base.t0 + (o.ord * interval '14 hours'), now() - interval '3 hours') + interval '30 hours' ELSE NULL END
      FROM base, (VALUES ('DOCUMENTS',0),('BAYAN',1),('DO',1),('CUSTOMER_COMM',2),('INSPECTION',3),('CCRO',4),('TRUCK',5),('PHYSICAL_INSPECTION',6),('RELEASE',6),('DELIVERY',7)) o(key, ord)
      WHERE si.job_id = $1 AND si.stage_key = o.key`, [jid, days]);
    await owner.query(`UPDATE clearance.job SET created_at = now() - make_interval(days => $2::int) WHERE id = $1`, [jid, days]);
    await owner.query(`UPDATE workflow.stage_event e SET occurred_at = coalesce(si.completed_at, si.started_at, e.occurred_at) FROM workflow.stage_instance si WHERE si.id = e.stage_instance_id AND e.job_id = $1`, [jid]);
    await owner.query(`UPDATE finance.disbursement d SET created_at = coalesce(si.completed_at, si.started_at, d.created_at), paid_on = coalesce(si.completed_at, si.started_at, d.created_at)::date FROM workflow.stage_instance si WHERE si.id = d.stage_instance_id AND d.job_id = $1`, [jid]);
  }
  await owner.end();

  // Invoice job 7 (draft) and job 8 (issued + paid), close job 8 — same application services as the API.
  const accounts = actorOf(u.priya!);
  const owner2 = actorOf(u.owner!);
  await withTenant(sys, (tx) => generateInvoice(tx, accounts, undefined, j7.id));
  await withTenant(sys, async (tx, uow) => {
    const inv = await generateInvoice(tx, accounts, undefined, j8.id);
    await tx.update(invoice).set({ status: 'PAID', paidAt: new Date() }).where(eq(invoice.id, inv.id));
    await closeJob(tx, uow, owner2, undefined, j8.id);
  });
  await new Promise((r) => setTimeout(r, 800));
  await withTenant(sys, async (tx) => {
    for (const jid of Object.keys(ages)) await projectJob(tx, jid);
  });

  console.log('\nSeed complete.');
  console.log('Tenant A: Gulf Gate Clearing LLC — 8 jobs across every stage. Tenant B: Harbour Line Brokers (isolation check).');
  console.log('Sign in with any demo user from the login screen (dev mode), e.g. sara@gulfgate.demo (coordinator), yusuf@gulfgate.demo (PRO).');
  console.log(`Customer approval link for BL CMDU7781204: ${process.env.PUBLIC_APP_URL ?? 'http://localhost:5173'}/approve/${approvalToken}`);
  void users; void j1; void j2; void j4;
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
