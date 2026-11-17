/**
 * API contracts shared by the API (server-side validation) and the PWA (form validation).
 * One schema, two enforcement points — the browser and the server can never disagree.
 */
import { z } from 'zod';
import { ROLES, checkContainerLength } from '@clearport/kernel';

const money = z.string().trim().regex(/^\d+(\.\d{1,3})?$/, 'Enter an amount with up to 3 decimals');
const currency = z.string().length(3, 'must be a 3-letter code, e.g. OMR').toUpperCase();
const isoDate = z.iso.date('must be a date');
const optionalText = z.string().trim().max(500).optional().or(z.literal('').transform(() => undefined));

export const containerNo = z
  .string()
  .transform((v, c) => {
    const r = checkContainerLength(v); // prototype: length only; validateContainerNo adds the ISO 6346 check digit
    if (!r.valid) {
      c.addIssue({ code: 'custom', message: `${r.value || 'empty'}: must be 11 letters/digits, e.g. MSKU9070323` });
      return z.NEVER;
    }
    return r.value;
  });

export const CONTAINER_TYPES = ['20GP', '40GP', '40HC', '45HC', '20RF', '40RF', '20RH', '40RH', '20OT', '40OT', '20FR', '40FR'] as const;
/** Refrigerated types: these carry a set temperature and ventilation. 40RH = 40' reefer high cube ("40 REEF 9'6"). */
export const REEFER_TYPES: readonly string[] = ['20RF', '40RF', '20RH', '40RH'];
export const PACKAGE_KINDS = ['CARTON', 'PALLET', 'BAG', 'BOX', 'CASE', 'DRUM', 'ROLL', 'BUNDLE', 'PIECE', 'BULK'] as const;
export const FREIGHT_TERMS = ['PREPAID', 'COLLECT'] as const;
export const SERVICE_TYPES = ['CY/CY', 'CY/DOOR', 'DOOR/CY', 'DOOR/DOOR'] as const;
export const FREE_TIME_BASES = ['COMBINED', 'DETENTION', 'DEMURRAGE'] as const;
export const INCOTERMS = ['EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'] as const;
export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const PAYMENT_METHODS = ['CASH_FLOAT', 'COMPANY_CARD', 'BANK_TRANSFER', 'ONLINE'] as const;
export const DOCUMENT_TYPES = [
  'BILL_OF_LADING', 'COMMERCIAL_INVOICE', 'PACKING_LIST', 'CERTIFICATE_OF_ORIGIN', 'BAYAN_COPY', 'DO_COPY',
  'CCRO_COPY', 'PHYTOSANITARY_CERTIFICATE', 'RECEIPT', 'INSPECTION_PHOTO', 'POD', 'OTHER',
] as const;
export const CHANNELS = ['WHATSAPP', 'EMAIL', 'SMS'] as const;

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values).optional().or(z.literal('').transform(() => undefined));
const weightKg = z.coerce.number().positive('must be more than 0').max(100_000, 'must be at most 100,000 kg').optional();
const volumeCbm = z.coerce.number().positive('must be more than 0').max(200, 'must be at most 200 CBM').optional();
const hsCode = z.string().trim().regex(/^\d{4,12}$/, 'must be 4–12 digits, e.g. 08055020');

export const ContainerInput = z.object({
  containerNo,
  sizeType: z.enum(CONTAINER_TYPES).default('40HC'),
  sealNo: optionalText,
  grossWeightKg: weightKg,
  packages: z.coerce.number().int().positive().optional(),
  packageKind: optionalEnum(PACKAGE_KINDS),
  volumeCbm,
  reeferTempC: z.coerce.number().min(-40, 'must be between -40 and 40 °C').max(40, 'must be between -40 and 40 °C').optional(),
  ventilation: optionalText,
  /** Typed by hand. Left empty, it is worked out from arrival + the B/L's free days. */
  freeTimeExpiresAt: isoDate.optional(),
});
export type ContainerInput = z.infer<typeof ContainerInput>;

/** One goods line on the B/L / packing list, e.g. "Fresh seedless lime, HS 08055020, 4,608 cartons, 18,432 kg net". */
export const CargoLineInput = z.object({
  description: z.string().trim().min(2, 'is required').max(300, 'must be at most 300 characters'),
  hsCode: hsCode.optional().or(z.literal('').transform(() => undefined)),
  packages: z.coerce.number().int().positive('must be more than 0').optional(),
  packageKind: optionalEnum(PACKAGE_KINDS),
  netWeightKg: weightKg,
  grossWeightKg: weightKg,
  volumeCbm,
  /** Which container the goods are in (by number, so it works before the containers exist). */
  containerNo: z.string().optional().transform((v) => (v ? v.replace(/[\s-]/g, '').toUpperCase() : undefined)),
  originCountry: optionalText,
});
export type CargoLineInput = z.infer<typeof CargoLineInput>;

/** B/L and container fields of a job (without the customer). */
export const JobFieldsInput = z.object({
  blNo: z.string().trim().min(3, 'must be at least 3 characters').max(40, 'must be at most 40 characters').toUpperCase(),
  vessel: optionalText,
  voyage: optionalText,
  shippingLineCode: optionalText,
  portOfLoading: optionalText,
  portOfDischarge: optionalText,
  terminal: optionalText,
  eta: isoDate,
  /** Filled from the cargo lines when they are given. */
  commodity: z.string().trim().min(2, 'is required').max(200, 'must be at most 200 characters').optional(),
  hsCodes: z.array(z.string().trim().regex(/^\d{4,12}$/, 'each HS code must be 4–12 digits, e.g. 8418')).max(50, 'at most 50 codes').default([]),
  shippingDetails: optionalText,
  priority: z.enum(PRIORITIES).default('NORMAL'),
  coordinatorId: z.uuid().optional(),
  // As printed on the carrier's B/L
  bookingNo: optionalText,
  serviceContract: optionalText,
  shipper: optionalText,
  notifyParty: optionalText,
  placeOfReceipt: optionalText,
  placeOfDelivery: optionalText,
  placeOfIssue: optionalText,
  blIssueDate: isoDate.optional().or(z.literal('').transform(() => undefined)),
  shippedOnBoardDate: isoDate.optional().or(z.literal('').transform(() => undefined)),
  originalsCount: z.coerce.number().int().min(0).max(10, 'must be at most 10').optional(),
  freightTerms: optionalEnum(FREIGHT_TERMS),
  serviceType: optionalEnum(SERVICE_TYPES),
  freeTimeDays: z.coerce.number().int().min(0).max(365, 'must be at most 365 days').optional(),
  freeTimeBasis: z.enum(FREE_TIME_BASES).default('COMBINED'),
  // From the commercial invoice
  invoiceNo: optionalText,
  invoiceDate: isoDate.optional().or(z.literal('').transform(() => undefined)),
  invoiceValue: money.optional().or(z.literal('').transform(() => undefined)),
  invoiceCurrency: currency.optional().or(z.literal('').transform(() => undefined)),
  incoterm: optionalEnum(INCOTERMS),
  countryOfOrigin: optionalText,
  cargoLines: z.array(CargoLineInput).max(50, 'allows at most 50 lines').default([]),
  containers: z.array(ContainerInput).min(1).max(200),
});

/** Editing a job: B/L number, containers and goods lines have their own routes. ATA can be recorded here. */
export const UpdateJobInput = JobFieldsInput.omit({ containers: true, blNo: true, cargoLines: true }).partial().extend({
  ata: isoDate.nullable().optional(),
});
export type UpdateJobInput = z.infer<typeof UpdateJobInput>;
export const AddContainersInput = z.object({ containers: z.array(ContainerInput).min(1).max(200) });
export const UpdateContainerInput = z.object({
  /** null = go back to the date worked out from arrival + free days. */
  freeTimeExpiresAt: isoDate.nullable().optional(),
  sealNo: optionalText,
  sizeType: z.enum(CONTAINER_TYPES).optional(),
  grossWeightKg: weightKg,
  packages: z.coerce.number().int().positive().optional(),
  packageKind: optionalEnum(PACKAGE_KINDS),
  volumeCbm,
  reeferTempC: z.coerce.number().min(-40).max(40).nullable().optional(),
  ventilation: optionalText,
});
export type UpdateContainerInput = z.infer<typeof UpdateContainerInput>;

export const DisbursementInput = z.object({
  feeType: z.string().trim().min(2).max(50),
  description: optionalText,
  amount: money,
  currency,
  paymentMethod: z.enum(PAYMENT_METHODS),
  paidOn: isoDate,
  /** Staff member who paid (defaults to the person recording it). Cash-float payments count against their float. */
  paidById: z.uuid().optional(),
  receiptDocumentId: z.uuid().optional(),
  billable: z.boolean().default(true),
  markupPct: z.coerce.number().min(0).max(100).default(0),
});
export type DisbursementInput = z.infer<typeof DisbursementInput>;

export const TransitionInput = z.object({
  to: z.string().min(2).max(40),
  fields: z.record(z.string(), z.unknown()).default({}),
  remarks: optionalText,
  disbursements: z.array(DisbursementInput).max(10).default([]),
  /** Client-generated time of the action (offline queue); server time is authoritative for SLAs. */
  clientOccurredAt: z.iso.datetime().optional(),
});
export type TransitionInput = z.infer<typeof TransitionInput>;

export const AssignInput = z.object({ assigneeId: z.uuid().nullable() });

export const ContactInput = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2).max(120),
  email: z.email().optional().or(z.literal('').transform(() => undefined)),
  phone: optionalText,
  role: optionalText,
  whatsappOptIn: z.boolean().default(false),
});

export const CustomerInput = z.object({
  name: z.string().trim().min(2).max(200),
  tradeLicenceNo: optionalText,
  customsCode: optionalText,
  address: optionalText,
  preferredChannel: z.enum(CHANNELS).default('WHATSAPP'),
  language: z.enum(['en', 'ar']).default('en'),
  creditLimit: money.optional(),
  creditDays: z.coerce.number().int().min(0).max(365).default(30),
  tariff: z
    .object({ currency, perBl: money, perContainer: money, vatPct: z.coerce.number().min(0).max(30).default(5), markupPct: z.coerce.number().min(0).max(100).default(0) })
    .optional(),
  contacts: z.array(ContactInput).max(20).default([]),
});
export type CustomerInput = z.infer<typeof CustomerInput>;

export const PresignInput = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  sizeBytes: z.number().int().positive().max(20 * 1024 * 1024, 'Files are limited to 20 MB'),
});
export const RegisterDocumentInput = z.object({
  uploadKey: z.string().min(10).max(300),
  fileName: z.string().trim().min(1).max(200),
  contentType: PresignInput.shape.contentType,
  sizeBytes: z.number().int().positive(),
  docType: z.enum(DOCUMENT_TYPES),
  containerId: z.uuid().optional(),
  stageInstanceId: z.uuid().optional(),
  customerVisible: z.boolean().default(false),
});

export const CommentInput = z.object({ body: z.string().trim().min(1).max(4000), customerVisible: z.boolean().default(false) });

export const DriverInput = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(30),
  licenceNo: optionalText,
  licenceExpiry: isoDate.optional(),
  transporter: optionalText,
  userId: z.uuid().optional(),
});
export const VehicleInput = z.object({
  plateNo: z.string().trim().min(2).max(30).toUpperCase(),
  type: z.string().trim().min(2).max(40).default('Trailer'),
  registrationExpiry: isoDate.optional(),
  transporter: optionalText,
});
export const TripInput = z.object({
  jobId: z.uuid(),
  containerIds: z.array(z.uuid()).min(1).max(50),
  driverId: z.uuid(),
  vehicleId: z.uuid(),
  inspectionAgentId: z.uuid().optional(),
  deliveryAddress: z.string().trim().min(3).max(300),
  deliveryContact: optionalText,
  deliveryWindow: optionalText,
  cost: money.optional(),
  currency: currency.optional(),
});
export type TripInput = z.infer<typeof TripInput>;

/** Cash advanced to a PRO (staff member) to pay fees in the field. */
export const FloatInput = z.object({ staffId: z.uuid(), amount: money, currency, issuedOn: isoDate, note: optionalText });
export const GenerateInvoiceInput = z.object({ jobId: z.uuid(), dueInDays: z.coerce.number().int().min(0).max(120).optional() });

export const UserInput = z.object({
  email: z.email(),
  name: z.string().trim().min(2).max(120),
  phone: optionalText,
  roles: z.array(z.enum(ROLES)).min(1),
  customerId: z.uuid().optional(),
  locale: z.enum(['en', 'ar']).default('en'),
});
export const MasterItemInput = z.object({
  kind: z.enum(['PORT', 'TERMINAL', 'SHIPPING_LINE', 'FEE_TYPE']),
  code: z.string().trim().min(2).max(30).toUpperCase(),
  name: z.string().trim().min(2).max(120),
  data: z.record(z.string(), z.unknown()).default({}),
});

export const ApprovalDecisionInput = z.object({ decision: z.enum(['APPROVED', 'REJECTED']), note: optionalText });

/** RFC 9457 problem details. */
export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  detail: z.string().optional(),
  errors: z.array(z.object({ path: z.string().optional(), code: z.string().optional(), message: z.string() })).optional(),
  requestId: z.string().optional(),
});
export type Problem = z.infer<typeof Problem>;

// ─────────────── ClearPort Lite (prototype) ───────────────

/** Staff are the agency's people assigned to stages and trips. They do not log in. */
export const STAFF_ROLES = ['COORDINATOR', 'PRO', 'INSPECTOR', 'DRIVER', 'ACCOUNTS'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const StaffInput = z.object({
  name: z.string().trim().min(2).max(120),
  role: z.enum(STAFF_ROLES),
  phone: optionalText,
  email: z.email().optional().or(z.literal('').transform(() => undefined)),
  licenceNo: optionalText,
  licenceExpiry: isoDate.optional(),
  transporter: optionalText,
});
export type StaffInput = z.infer<typeof StaffInput>;

export const CompanyInput = z.object({
  name: z.string().trim().min(2).max(200),
  address: optionalText,
  trn: optionalText,
  baseCurrency: currency.default('OMR'),
  timezone: z.string().trim().min(3).max(60).default('Asia/Muscat'),
  vatPct: z.coerce.number().min(0).max(30).default(5),
  /** Assign each workflow step to a staff member (teams). Off: one person does every step. */
  assignSteps: z.boolean().default(false),
  /** Steps one by one: a step starts only after the previous one is complete. Off: customs and DO run in parallel. */
  sequentialSteps: z.boolean().default(true),
  /** How customers reach the agency (tracking page buttons). */
  phone: optionalText,
  whatsapp: optionalText,
  email: z.email('is not in the right format').optional().or(z.literal('').transform(() => undefined)),
});
export type CompanyInput = z.infer<typeof CompanyInput>;

export const SlaInput = z.object({ sla: z.record(z.string(), z.number().int().min(1).max(720)) });

/** Form fields sent with a multipart document upload (the file itself is the `file` part). */
export const DocumentMetaInput = z.object({
  jobId: z.uuid(),
  docType: z.enum(DOCUMENT_TYPES),
  containerId: z.uuid().optional().or(z.literal('').transform(() => undefined)),
  stageInstanceId: z.uuid().optional().or(z.literal('').transform(() => undefined)),
  customerVisible: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .default(false)
    .transform((v) => v === true || v === 'true'),
  /** Other documents inside the same file (a scanned pack). Multipart sends these comma-separated. */
  covers: z
    .union([z.array(z.enum(DOCUMENT_TYPES)), z.string()])
    .default([])
    .transform((v, c) => {
      const list = (Array.isArray(v) ? v : v.split(',')).map((x) => x.trim()).filter(Boolean);
      const bad = list.filter((x) => !(DOCUMENT_TYPES as readonly string[]).includes(x));
      if (bad.length) { c.addIssue({ code: 'custom', message: `unknown document type: ${bad.join(', ')}` }); return z.NEVER; }
      return [...new Set(list)] as (typeof DOCUMENT_TYPES)[number][];
    }),
  referenceNo: optionalText,
  issueDate: isoDate.optional().or(z.literal('').transform(() => undefined)),
});
export type DocumentMetaInput = z.infer<typeof DocumentMetaInput>;

export const ReopenInput = z.object({ reason: z.string().trim().min(5).max(300) });
export const ReverseInput = z.object({ reason: z.string().trim().min(3).max(300) });

/**
 * A customer created on the spot while opening a job: the essentials up front, everything else optional
 * (the full customer record can be completed later on the customer page).
 */
export const NewCustomerInput = CustomerInput.omit({ contacts: true }).extend({
  contactName: optionalText,
  phone: optionalText,
  email: z.email().optional().or(z.literal('').transform(() => undefined)),
  whatsappOptIn: z.boolean().default(false),
});
export type NewCustomerInput = z.infer<typeof NewCustomerInput>;

/** Opening a job: either pick an existing customer or create a new one in the same step. */
export const CreateJobInput = JobFieldsInput.extend({
  customerId: z.uuid().optional(),
  newCustomer: NewCustomerInput.optional(),
}).superRefine((v, c) => {
  if (!!v.customerId === !!v.newCustomer) c.addIssue({ code: 'custom', message: 'Choose an existing customer or enter a new one', path: ['customerId'] });
  if (!v.commodity && !v.cargoLines.length) c.addIssue({ code: 'custom', message: 'add at least one goods line', path: ['cargoLines'] });
  const boxes = new Set(v.containers.map((ct) => ct.containerNo));
  v.cargoLines.forEach((l, i) => {
    if (l.containerNo && !boxes.has(l.containerNo)) c.addIssue({ code: 'custom', message: `${l.containerNo} is not one of this job's containers`, path: ['cargoLines', i, 'containerNo'] });
  });
});
export type CreateJobInput = z.infer<typeof CreateJobInput>;

/** Public tracking page: the customer types the mobile number the agent has on file. */
export const TrackLookupInput = z.object({
  phone: z.string().trim().max(30).refine((v) => v.replace(/\D/g, '').length >= 8, 'enter the full mobile number, e.g. +968 9911 2233'),
});
