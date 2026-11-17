/** Drizzle table definitions mirroring db/migrations-lite. One schema, one agency, no tenant columns. */
import { boolean, char, customType, date, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { WorkflowDefinition } from '@clearport/workflow';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => numeric(name, { precision: 14, scale: 3 });

// ── setup ──
export const appUser = pgTable('app_user', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  username: text('username'),
  passwordHash: text('password_hash'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
/** Uploaded files kept in the database (FILE_STORE=db), for hosting without a disk. */
export const fileBlob = pgTable('file_blob', {
  storageKey: text('storage_key').primaryKey(),
  bytes: bytea('bytes').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const companySettings = pgTable('company_settings', {
  id: integer('id').primaryKey().default(1),
  name: text('name').notNull(),
  address: text('address'),
  trn: text('trn'),
  baseCurrency: char('base_currency', { length: 3 }).notNull().default('AED'),
  timezone: text('timezone').notNull().default('Asia/Dubai'),
  vatPct: numeric('vat_pct', { precision: 5, scale: 2 }).notNull().default('5'),
  assignSteps: boolean('assign_steps').notNull().default(false),
  sequentialSteps: boolean('sequential_steps').notNull().default(true),
  /** Shown to customers on the tracking page. */
  phone: text('phone'),
  whatsapp: text('whatsapp'),
  email: text('email'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const staff = pgTable('staff', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  phone: text('phone'),
  email: text('email'),
  licenceNo: text('licence_no'),
  licenceExpiry: date('licence_expiry'),
  transporter: text('transporter'),
  active: boolean('active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const masterItem = pgTable('master_item', {
  id: uuid('id').primaryKey(),
  kind: text('kind').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  active: boolean('active').notNull().default(true),
});

export const workflowDefinition = pgTable('workflow_definition', {
  id: uuid('id').primaryKey(),
  version: integer('version').notNull(),
  definition: jsonb('definition').$type<WorkflowDefinition>().notNull(),
  active: boolean('active').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const counter = pgTable('counter', {
  name: text('name').notNull(),
  year: integer('year').notNull(),
  value: integer('value').notNull(),
}, (t) => [primaryKey({ columns: [t.name, t.year] })]);

// ── customers ──
export type Tariff = { currency: string; perBl: string; perContainer: string; vatPct: number; markupPct: number };
export type Contact = { id: string; name: string; email?: string; phone?: string; role?: string; whatsappOptIn: boolean };

export const customer = pgTable('customer', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  tradeLicenceNo: text('trade_licence_no'),
  customsCode: text('customs_code'),
  address: text('address'),
  preferredChannel: text('preferred_channel').notNull().default('WHATSAPP'),
  language: text('language').notNull().default('en'),
  creditLimit: money('credit_limit'),
  creditDays: integer('credit_days').notNull().default(30),
  tariff: jsonb('tariff').$type<Tariff | null>(),
  contacts: jsonb('contacts').$type<Contact[]>().notNull().default([]),
  portalToken: text('portal_token'),
  archivedAt: ts('archived_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// ── clearance ──
export const job = pgTable('job', {
  id: uuid('id').primaryKey(),
  jobNo: text('job_no').notNull(),
  blNo: text('bl_no').notNull(),
  customerId: uuid('customer_id').notNull(),
  vessel: text('vessel'),
  voyage: text('voyage'),
  shippingLineCode: text('shipping_line_code'),
  portOfLoading: text('port_of_loading'),
  portOfDischarge: text('port_of_discharge'),
  terminal: text('terminal'),
  eta: date('eta').notNull(),
  ata: date('ata'),
  commodity: text('commodity').notNull(),
  hsCodes: text('hs_codes').array().notNull().default([]),
  shippingDetails: text('shipping_details'),
  priority: text('priority').notNull().default('NORMAL'),
  bookingNo: text('booking_no'),
  serviceContract: text('service_contract'),
  shipper: text('shipper'),
  notifyParty: text('notify_party'),
  placeOfReceipt: text('place_of_receipt'),
  placeOfDelivery: text('place_of_delivery'),
  placeOfIssue: text('place_of_issue'),
  blIssueDate: date('bl_issue_date'),
  shippedOnBoardDate: date('shipped_on_board_date'),
  originalsCount: integer('originals_count'),
  freightTerms: text('freight_terms'),
  serviceType: text('service_type'),
  freeTimeDays: integer('free_time_days'),
  freeTimeBasis: text('free_time_basis').notNull().default('COMBINED'),
  invoiceNo: text('invoice_no'),
  invoiceDate: date('invoice_date'),
  invoiceValue: money('invoice_value'),
  invoiceCurrency: char('invoice_currency', { length: 3 }),
  incoterm: text('incoterm'),
  countryOfOrigin: text('country_of_origin'),
  coordinatorStaffId: uuid('coordinator_staff_id'),
  status: text('status').notNull().default('OPEN'),
  workflowVersion: integer('workflow_version').notNull(),
  closedAt: ts('closed_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const container = pgTable('container', {
  id: uuid('id').primaryKey(),
  jobId: uuid('job_id').notNull(),
  containerNo: text('container_no').notNull(),
  sizeType: text('size_type').notNull(),
  sealNo: text('seal_no'),
  grossWeightKg: numeric('gross_weight_kg', { precision: 12, scale: 2 }),
  packages: integer('packages'),
  freeTimeExpiresAt: date('free_time_expires_at'),
  packageKind: text('package_kind'),
  volumeCbm: numeric('volume_cbm', { precision: 10, scale: 3 }),
  reeferTempC: numeric('reefer_temp_c', { precision: 4, scale: 1 }),
  ventilation: text('ventilation'),
  /** True when the free-time end date was typed in; false when it is worked out from arrival + free days. */
  freeTimeManual: boolean('free_time_manual').notNull().default(false),
  active: boolean('active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** The goods on the B/L, one row per line. */
export const cargoLine = pgTable('cargo_line', {
  id: uuid('id').primaryKey(),
  jobId: uuid('job_id').notNull(),
  containerId: uuid('container_id'),
  lineNo: integer('line_no').notNull(),
  description: text('description').notNull(),
  hsCode: text('hs_code'),
  packages: integer('packages'),
  packageKind: text('package_kind'),
  netWeightKg: numeric('net_weight_kg', { precision: 12, scale: 2 }),
  grossWeightKg: numeric('gross_weight_kg', { precision: 12, scale: 2 }),
  volumeCbm: numeric('volume_cbm', { precision: 10, scale: 3 }),
  originCountry: text('origin_country'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const document = pgTable('document', {
  id: uuid('id').primaryKey(),
  jobId: uuid('job_id').notNull(),
  containerId: uuid('container_id'),
  stageInstanceId: uuid('stage_instance_id'),
  docType: text('doc_type').notNull(),
  fileName: text('file_name').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storageKey: text('storage_key').notNull(),
  customerVisible: boolean('customer_visible').notNull().default(false),
  uploadedByName: text('uploaded_by_name'),
  /** Other document types inside the same file (a scanned pack). */
  covers: text('covers').array().notNull().default([]),
  referenceNo: text('reference_no'),
  issueDate: date('issue_date'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const comment = pgTable('comment', {
  id: uuid('id').primaryKey(),
  jobId: uuid('job_id').notNull(),
  authorName: text('author_name').notNull(),
  body: text('body').notNull(),
  customerVisible: boolean('customer_visible').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// ── workflow ──
export const stageInstance = pgTable('stage_instance', {
  id: uuid('id').primaryKey(),
  jobId: uuid('job_id').notNull(),
  containerId: uuid('container_id'),
  stageKey: text('stage_key').notNull(),
  status: text('status').notNull(),
  assigneeStaffId: uuid('assignee_staff_id'),
  referenceNo: text('reference_no'),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  slaDueAt: ts('sla_due_at'),
  startedAt: ts('started_at'),
  completedAt: ts('completed_at'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const stageEvent = pgTable('stage_event', {
  id: uuid('id').primaryKey(),
  jobId: uuid('job_id').notNull(),
  containerId: uuid('container_id'),
  stageInstanceId: uuid('stage_instance_id').notNull(),
  stageKey: text('stage_key').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  actorName: text('actor_name').notNull(),
  remarks: text('remarks'),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
});

// ── field operations ──
export const vehicle = pgTable('vehicle', {
  id: uuid('id').primaryKey(),
  plateNo: text('plate_no').notNull(),
  type: text('type').notNull(),
  registrationExpiry: date('registration_expiry'),
  transporter: text('transporter'),
  active: boolean('active').notNull().default(true),
});

export const trip = pgTable('trip', {
  id: uuid('id').primaryKey(),
  jobId: uuid('job_id').notNull(),
  tripNo: text('trip_no').notNull(),
  driverStaffId: uuid('driver_staff_id').notNull(),
  vehicleId: uuid('vehicle_id').notNull(),
  inspectorStaffId: uuid('inspector_staff_id'),
  deliveryAddress: text('delivery_address').notNull(),
  deliveryContact: text('delivery_contact'),
  deliveryWindow: text('delivery_window'),
  status: text('status').notNull().default('ASSIGNED'),
  cost: money('cost'),
  currency: char('currency', { length: 3 }),
  linkToken: text('link_token'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const tripContainer = pgTable('trip_container', {
  tripId: uuid('trip_id').notNull(),
  containerId: uuid('container_id').notNull(),
}, (t) => [primaryKey({ columns: [t.tripId, t.containerId] })]);

// ── finance ──
export const invoice = pgTable('invoice', {
  id: uuid('id').primaryKey(),
  jobId: uuid('job_id').notNull(),
  customerId: uuid('customer_id').notNull(),
  invoiceNo: text('invoice_no').notNull(),
  issueDate: date('issue_date').notNull(),
  dueDate: date('due_date').notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  subtotal: money('subtotal').notNull(),
  vatAmount: money('vat_amount').notNull(),
  total: money('total').notNull(),
  status: text('status').notNull().default('DRAFT'),
  paidAt: ts('paid_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const invoiceLine = pgTable('invoice_line', {
  id: uuid('id').primaryKey(),
  invoiceId: uuid('invoice_id').notNull(),
  kind: text('kind').notNull(),
  description: text('description').notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: money('unit_price').notNull(),
  amount: money('amount').notNull(),
  vatRate: numeric('vat_rate', { precision: 5, scale: 2 }).notNull().default('0'),
  disbursementId: uuid('disbursement_id'),
});

export const disbursement = pgTable('disbursement', {
  id: uuid('id').primaryKey(),
  jobId: uuid('job_id').notNull(),
  stageInstanceId: uuid('stage_instance_id'),
  stageKey: text('stage_key'),
  feeType: text('fee_type').notNull(),
  description: text('description'),
  amount: money('amount').notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  paymentMethod: text('payment_method').notNull(),
  paidOn: date('paid_on').notNull(),
  paidByStaffId: uuid('paid_by_staff_id'),
  paidByName: text('paid_by_name').notNull(),
  receiptDocumentId: uuid('receipt_document_id'),
  billable: boolean('billable').notNull().default(true),
  markupPct: numeric('markup_pct', { precision: 5, scale: 2 }).notNull().default('0'),
  status: text('status').notNull().default('RECORDED'),
  reversesId: uuid('reverses_id'),
  invoiceId: uuid('invoice_id'),
  reconciledAt: ts('reconciled_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const proFloat = pgTable('pro_float', {
  id: uuid('id').primaryKey(),
  staffId: uuid('staff_id').notNull(),
  amount: money('amount').notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  issuedOn: date('issued_on').notNull(),
  note: text('note'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// ── engagement ──
export const notification = pgTable('notification', {
  id: uuid('id').primaryKey(),
  channel: text('channel').notNull(),
  recipient: text('recipient').notNull(),
  jobId: uuid('job_id'),
  template: text('template').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  link: text('link'),
  status: text('status').notNull(),
  readAt: ts('read_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const customerApproval = pgTable('customer_approval', {
  id: uuid('id').primaryKey(),
  jobId: uuid('job_id').notNull(),
  stageInstanceId: uuid('stage_instance_id').notNull(),
  token: text('token').notNull(),
  summary: jsonb('summary').$type<Record<string, unknown>>().notNull(),
  status: text('status').notNull().default('PENDING'),
  expiresAt: ts('expires_at').notNull(),
  decidedAt: ts('decided_at'),
  decidedBy: text('decided_by'),
  note: text('note'),
  createdAt: ts('created_at').notNull().defaultNow(),
});
