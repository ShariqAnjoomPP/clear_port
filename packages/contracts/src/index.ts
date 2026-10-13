/**
 * API contracts shared by the API (server-side validation) and the PWA (form validation).
 * One schema, two enforcement points — the browser and the server can never disagree.
 */
import { z } from 'zod';
import { ROLES, validateContainerNo } from '@clearport/kernel';

const money = z.string().trim().regex(/^\d+(\.\d{1,3})?$/, 'Enter an amount with up to 3 decimals');
const currency = z.string().length(3).toUpperCase();
const isoDate = z.iso.date();
const optionalText = z.string().trim().max(500).optional().or(z.literal('').transform(() => undefined));

export const containerNo = z
  .string()
  .transform((v, c) => {
    const r = validateContainerNo(v);
    if (!r.valid) {
      c.addIssue({ code: 'custom', message: r.error === 'FORMAT' ? `${r.value}: not an ISO 6346 container number` : `${r.value}: check digit is wrong` });
      return z.NEVER;
    }
    return r.value;
  });

export const CONTAINER_TYPES = ['20GP', '40GP', '40HC', '45HC', '20RF', '40RF', '20OT', '40OT', '20FR', '40FR'] as const;
export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const PAYMENT_METHODS = ['CASH_FLOAT', 'COMPANY_CARD', 'BANK_TRANSFER', 'ONLINE'] as const;
export const DOCUMENT_TYPES = [
  'BILL_OF_LADING', 'COMMERCIAL_INVOICE', 'PACKING_LIST', 'CERTIFICATE_OF_ORIGIN', 'BAYAN_COPY', 'DO_COPY',
  'CCRO_COPY', 'RECEIPT', 'INSPECTION_PHOTO', 'POD', 'OTHER',
] as const;
export const CHANNELS = ['WHATSAPP', 'EMAIL', 'SMS'] as const;

export const ContainerInput = z.object({
  containerNo,
  sizeType: z.enum(CONTAINER_TYPES).default('40HC'),
  sealNo: optionalText,
  grossWeightKg: z.coerce.number().positive().optional(),
  packages: z.coerce.number().int().positive().optional(),
  freeTimeExpiresAt: isoDate.optional(),
});
export type ContainerInput = z.infer<typeof ContainerInput>;

export const CreateJobInput = z.object({
  customerId: z.uuid(),
  blNo: z.string().trim().min(3).max(40).toUpperCase(),
  vessel: optionalText,
  voyage: optionalText,
  shippingLineCode: optionalText,
  portOfLoading: optionalText,
  portOfDischarge: optionalText,
  terminal: optionalText,
  eta: isoDate,
  commodity: z.string().trim().min(2).max(200),
  hsCodes: z.array(z.string().trim().regex(/^\d{4,12}$/)).max(50).default([]),
  shippingDetails: optionalText,
  priority: z.enum(PRIORITIES).default('NORMAL'),
  coordinatorId: z.uuid().optional(),
  containers: z.array(ContainerInput).min(1).max(200),
});
export type CreateJobInput = z.infer<typeof CreateJobInput>;

export const UpdateJobInput = CreateJobInput.omit({ containers: true, customerId: true, blNo: true }).partial();
export const AddContainersInput = z.object({ containers: z.array(ContainerInput).min(1).max(200) });
export const UpdateContainerInput = z.object({ freeTimeExpiresAt: isoDate.nullable().optional(), sealNo: optionalText, sizeType: z.enum(CONTAINER_TYPES).optional() });

export const DisbursementInput = z.object({
  feeType: z.string().trim().min(2).max(50),
  description: optionalText,
  amount: money,
  currency,
  paymentMethod: z.enum(PAYMENT_METHODS),
  paidOn: isoDate,
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

export const FloatInput = z.object({ userId: z.uuid(), amount: money, currency, issuedOn: isoDate, note: optionalText });
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
