/**
 * Base data for ClearPort Lite: the demo user, the agency, the workflow (v1), master data, staff and vehicles.
 * There are no customers or jobs: the first customer is created in "Create job". Tests add demo jobs on top
 * with scripts/lite/demo-data.ts.
 */
import { uuidv7 } from '@clearport/kernel';
import { DEFAULT_WORKFLOW } from '@clearport/workflow';
import { pool, transaction } from '../../src/lib/db';
import { hashPassword } from '../../src/lib/passwords';
import { appUser, companySettings, masterItem, staff, vehicle, workflowDefinition } from '../../src/lib/schema';

const daysFromNow = (d: number) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);

await transaction(async (tx) => {
  // The one login-free user every request acts as.
  // The staff sign-in: demouser / Demo@123 unless SEED_DEMO_PASSWORD says otherwise. Only the hash is stored.
  const passwordHash = await hashPassword(process.env.SEED_DEMO_PASSWORD || 'Demo@123');
  await tx.insert(appUser).values({ id: uuidv7(), email: 'demo@clearport.local', name: 'Demo User', username: 'demouser', passwordHash });

  // A clearing agency in Oman (fictional). OMR has 3 decimals (baisa), which the money type handles. trn holds the Omani VATIN.
  await tx.insert(companySettings).values({ id: 1, name: 'Batinah Gate Clearing LLC', address: 'Office 12, Sohar Free Zone, Sohar, Sultanate of Oman', trn: 'OM1100234567', phone: '+968 2684 1200', whatsapp: '+968 9100 0001', email: 'ops@batinahgate.demo', baseCurrency: 'OMR', timezone: 'Asia/Muscat', vatPct: '5' });

  // The single clearance workflow, stored as data so it can change without a code change.
  await tx.insert(workflowDefinition).values({ id: uuidv7(), version: DEFAULT_WORKFLOW.version, definition: DEFAULT_WORKFLOW, active: true });

  // Ports use UN/LOCODEs; shipping lines use their SCAC, as printed on the B/L (e.g. MAEU for Maersk).
  const masters: [string, string, string][] = [
    ['PORT', 'OMSOH', 'Sohar'], ['PORT', 'OMSLL', 'Salalah'], ['PORT', 'OMMCT', 'Muscat (Sultan Qaboos)'], ['PORT', 'OMDQM', 'Duqm'],
    ['PORT', 'VNSGN', 'Ho Chi Minh City'], ['PORT', 'CNSHA', 'Shanghai'], ['PORT', 'INNSA', 'Nhava Sheva'], ['PORT', 'SGSIN', 'Singapore'], ['PORT', 'TRMER', 'Mersin'],
    ['TERMINAL', 'SOH-CT', 'Sohar Container Terminal'], ['TERMINAL', 'SLL-CT', 'Salalah Container Terminal'], ['TERMINAL', 'DQM-CT', 'Duqm Container Terminal'],
    ['SHIPPING_LINE', 'MAEU', 'Maersk'], ['SHIPPING_LINE', 'MSCU', 'MSC'], ['SHIPPING_LINE', 'CMDU', 'CMA CGM'], ['SHIPPING_LINE', 'COSU', 'COSCO'], ['SHIPPING_LINE', 'HLCU', 'Hapag-Lloyd'],
    ['FEE_TYPE', 'CUSTOMS_DUTY', 'Customs duty'], ['FEE_TYPE', 'IMPORT_VAT', 'Import VAT'], ['FEE_TYPE', 'BAYAN_FEE', 'Bayan / declaration fee'], ['FEE_TYPE', 'DO_CHARGES', 'Shipping line DO charges'],
    ['FEE_TYPE', 'INSPECTION_FEE', 'Inspection / scanning fee'], ['FEE_TYPE', 'PLANT_QUARANTINE', 'Plant quarantine fee'], ['FEE_TYPE', 'CCRO_FEE', 'Port release fee'],
    ['FEE_TYPE', 'PORT_STORAGE', 'Port storage'], ['FEE_TYPE', 'REEFER_PLUGIN', 'Reefer plug-in / monitoring'], ['FEE_TYPE', 'DETENTION_DEMURRAGE', 'Detention & demurrage'],
    ['FEE_TYPE', 'TERMINAL_HANDLING', 'Terminal handling'], ['FEE_TYPE', 'OTHER', 'Other'],
  ];
  await tx.insert(masterItem).values(masters.map(([kind, code, name]) => ({ id: uuidv7(), kind, code, name })));

  await tx.insert(staff).values([
    { id: uuidv7(), name: 'Sara Khan', role: 'COORDINATOR', phone: '+96891000002', email: 'sara@batinahgate.demo' },
    { id: uuidv7(), name: 'Ravi Menon', role: 'COORDINATOR', phone: '+96891000003', email: 'ravi@batinahgate.demo' },
    { id: uuidv7(), name: 'Yusuf Ali', role: 'PRO', phone: '+96891000004' },
    { id: uuidv7(), name: 'Imran Qureshi', role: 'PRO', phone: '+96891000005' },
    { id: uuidv7(), name: 'Fatima Noor', role: 'INSPECTOR', phone: '+96891000006' },
    { id: uuidv7(), name: 'Rashid Mahmood', role: 'DRIVER', phone: '+96891000007', licenceNo: 'OM-HV-55120', licenceExpiry: daysFromNow(400), transporter: 'Batinah Gate fleet' },
    { id: uuidv7(), name: 'Bilal Ahmed', role: 'DRIVER', phone: '+96895550101', licenceNo: 'OM-HV-77812', licenceExpiry: daysFromNow(200), transporter: 'Al Batinah Transport' },
    { id: uuidv7(), name: 'Jomon Thomas', role: 'DRIVER', phone: '+96895550202', licenceNo: 'OM-HV-10293', licenceExpiry: daysFromNow(25), transporter: 'Al Batinah Transport' },
    { id: uuidv7(), name: 'Priya Nair', role: 'ACCOUNTS', phone: '+96891000008', email: 'priya@batinahgate.demo' },
  ]);

  await tx.insert(vehicle).values([
    { id: uuidv7(), plateNo: '48211 AB', type: 'Trailer 40ft (reefer plug)', registrationExpiry: daysFromNow(300), transporter: 'Batinah Gate fleet' },
    { id: uuidv7(), plateNo: '10922 BR', type: 'Trailer 40ft', registrationExpiry: daysFromNow(150), transporter: 'Al Batinah Transport' },
    { id: uuidv7(), plateNo: '77120 SD', type: 'Trailer 20ft', registrationExpiry: daysFromNow(90), transporter: 'Al Batinah Transport' },
  ]);
});

await pool.end();
console.log('Seeded: demo user (sign in as demouser), company, workflow v1, master data, 9 staff, 3 vehicles. No customers or jobs yet: create the first one in the app.');
