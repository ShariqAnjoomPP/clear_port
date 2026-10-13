/** Drizzle table definitions mirroring db/migrations. One Postgres schema per bounded context. */
import { boolean, date, integer, jsonb, numeric, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => numeric(name, { precision: 14, scale: 3 });

export const platform = pgSchema('platform');
export const customerSchema = pgSchema('customer');
export const clearance = pgSchema('clearance');
export const workflow = pgSchema('workflow');
export const fieldops = pgSchema('fieldops');
export const finance = pgSchema('finance');
export const engagement = pgSchema('engagement');
export const insight = pgSchema('insight');
export const shared = pgSchema('shared');

export const tenant = platform.table('tenant', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  baseCurrency: text('base_currency').notNull(),
  timezone: text('timezone').notNull(),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const appUser = platform.table('app_user', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  phone: text('phone'),
  roles: text('roles').array().notNull(),
  customerId: uuid('customer_id'),
  locale: text('locale').notNull().default('en'),
  active: boolean('active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const masterItem = platform.table('master_item', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  kind: text('kind').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  active: boolean('active').notNull().default(true),
});

export const stageDefinition = platform.table('stage_definition', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  version: integer('version').notNull(),
  definition: jsonb('definition').notNull(),
  active: boolean('active').notNull().default(true),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export type Tariff = { currency: string; perBl: string; perContainer: string; vatPct: number; markupPct: number };

export const customer = customerSchema.table('customer', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  tradeLicenceNo: text('trade_licence_no'),
  customsCode: text('customs_code'),
  address: text('address'),
  preferredChannel: text('preferred_channel').notNull(),
  language: text('language').notNull(),
  creditLimit: money('credit_limit'),
  creditDays: integer('credit_days').notNull(),
  tariff: jsonb('tariff').$type<Tariff | null>(),
  archivedAt: ts('archived_at'),
  version: integer('version').notNull().default(1),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const contact = customerSchema.table('contact', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  customerId: uuid('customer_id').notNull(),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  role: text('role'),
  whatsappOptIn: boolean('whatsapp_opt_in').notNull().default(false),
});

export const jobCounter = clearance.table('job_counter', {
  tenantId: uuid('tenant_id').notNull(),
  year: integer('year').notNull(),
  value: integer('value').notNull(),
});

export const job = clearance.table('job', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
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
  priority: text('priority').notNull(),
  coordinatorId: uuid('coordinator_id'),
  status: text('status').notNull(),
  workflowVersion: integer('workflow_version').notNull(),
  closedAt: ts('closed_at'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export const container = clearance.table('container', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  jobId: uuid('job_id').notNull(),
  containerNo: text('container_no').notNull(),
  sizeType: text('size_type').notNull(),
  sealNo: text('seal_no'),
  grossWeightKg: numeric('gross_weight_kg', { precision: 12, scale: 2 }),
  packages: integer('packages'),
  freeTimeExpiresAt: date('free_time_expires_at'),
  active: boolean('active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const document = clearance.table('document', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  jobId: uuid('job_id').notNull(),
  containerId: uuid('container_id'),
  stageInstanceId: uuid('stage_instance_id'),
  docType: text('doc_type').notNull(),
  fileName: text('file_name').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storageKey: text('storage_key').notNull(),
  version: integer('version').notNull().default(1),
  customerVisible: boolean('customer_visible').notNull().default(false),
  uploadedBy: uuid('uploaded_by'),
  uploadedByName: text('uploaded_by_name'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const comment = clearance.table('comment', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  jobId: uuid('job_id').notNull(),
  authorId: uuid('author_id'),
  authorName: text('author_name').notNull(),
  body: text('body').notNull(),
  customerVisible: boolean('customer_visible').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const stageInstance = workflow.table('stage_instance', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  jobId: uuid('job_id').notNull(),
  containerId: uuid('container_id'),
  stageKey: text('stage_key').notNull(),
  status: text('status').notNull(),
  assigneeId: uuid('assignee_id'),
  referenceNo: text('reference_no'),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  slaDueAt: ts('sla_due_at'),
  startedAt: ts('started_at'),
  completedAt: ts('completed_at'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export const stageEvent = workflow.table('stage_event', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  jobId: uuid('job_id').notNull(),
  containerId: uuid('container_id'),
  stageInstanceId: uuid('stage_instance_id').notNull(),
  stageKey: text('stage_key').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  actorId: uuid('actor_id'),
  actorName: text('actor_name').notNull(),
  remarks: text('remarks'),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
  clientOccurredAt: ts('client_occurred_at'),
});

export const driver = fieldops.table('driver', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  licenceNo: text('licence_no'),
  licenceExpiry: date('licence_expiry'),
  transporter: text('transporter'),
  userId: uuid('user_id'),
  active: boolean('active').notNull().default(true),
});

export const vehicle = fieldops.table('vehicle', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  plateNo: text('plate_no').notNull(),
  type: text('type').notNull(),
  registrationExpiry: date('registration_expiry'),
  transporter: text('transporter'),
  active: boolean('active').notNull().default(true),
});

export const trip = fieldops.table('trip', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  jobId: uuid('job_id').notNull(),
  tripNo: text('trip_no').notNull(),
  driverId: uuid('driver_id').notNull(),
  vehicleId: uuid('vehicle_id').notNull(),
  inspectionAgentId: uuid('inspection_agent_id'),
  deliveryAddress: text('delivery_address').notNull(),
  deliveryContact: text('delivery_contact'),
  deliveryWindow: text('delivery_window'),
  status: text('status').notNull(),
  cost: money('cost'),
  currency: text('currency'),
  linkTokenHash: text('link_token_hash'),
  linkExpiresAt: ts('link_expires_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export const tripContainer = fieldops.table('trip_container', {
  tripId: uuid('trip_id').notNull(),
  containerId: uuid('container_id').notNull(),
  tenantId: uuid('tenant_id').notNull(),
});

export const invoiceCounter = finance.table('invoice_counter', {
  tenantId: uuid('tenant_id').notNull(),
  year: integer('year').notNull(),
  value: integer('value').notNull(),
});

export const invoice = finance.table('invoice', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  jobId: uuid('job_id').notNull(),
  customerId: uuid('customer_id').notNull(),
  invoiceNo: text('invoice_no').notNull(),
  issueDate: date('issue_date').notNull(),
  dueDate: date('due_date').notNull(),
  currency: text('currency').notNull(),
  subtotal: money('subtotal').notNull(),
  vatAmount: money('vat_amount').notNull(),
  total: money('total').notNull(),
  status: text('status').notNull(),
  paidAt: ts('paid_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const invoiceLine = finance.table('invoice_line', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  invoiceId: uuid('invoice_id').notNull(),
  kind: text('kind').notNull(),
  description: text('description').notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: money('unit_price').notNull(),
  amount: money('amount').notNull(),
  vatRate: numeric('vat_rate', { precision: 5, scale: 2 }).notNull(),
  disbursementId: uuid('disbursement_id'),
});

export const disbursement = finance.table('disbursement', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  jobId: uuid('job_id').notNull(),
  stageInstanceId: uuid('stage_instance_id'),
  stageKey: text('stage_key'),
  feeType: text('fee_type').notNull(),
  description: text('description'),
  amount: money('amount').notNull(),
  currency: text('currency').notNull(),
  paymentMethod: text('payment_method').notNull(),
  paidOn: date('paid_on').notNull(),
  paidBy: uuid('paid_by'),
  paidByName: text('paid_by_name').notNull(),
  receiptDocumentId: uuid('receipt_document_id'),
  billable: boolean('billable').notNull(),
  markupPct: numeric('markup_pct', { precision: 5, scale: 2 }).notNull(),
  status: text('status').notNull(),
  reversesId: uuid('reverses_id'),
  invoiceId: uuid('invoice_id'),
  reconciledBy: uuid('reconciled_by'),
  reconciledAt: ts('reconciled_at'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const proFloat = finance.table('pro_float', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  amount: money('amount').notNull(),
  currency: text('currency').notNull(),
  issuedOn: date('issued_on').notNull(),
  note: text('note'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const notification = engagement.table('notification', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  channel: text('channel').notNull(),
  recipient: text('recipient').notNull(),
  userId: uuid('user_id'),
  jobId: uuid('job_id'),
  template: text('template').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  status: text('status').notNull(),
  dedupeKey: text('dedupe_key').notNull(),
  error: text('error'),
  readAt: ts('read_at'),
  sentAt: ts('sent_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const customerApproval = engagement.table('customer_approval', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  jobId: uuid('job_id').notNull(),
  stageInstanceId: uuid('stage_instance_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  summary: jsonb('summary').$type<Record<string, unknown>>().notNull(),
  status: text('status').notNull(),
  expiresAt: ts('expires_at').notNull(),
  decidedAt: ts('decided_at'),
  decidedBy: text('decided_by'),
  note: text('note'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const jobBoard = insight.table('job_board', {
  jobId: uuid('job_id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  jobNo: text('job_no').notNull(),
  blNo: text('bl_no').notNull(),
  customerId: uuid('customer_id').notNull(),
  customerName: text('customer_name').notNull(),
  phase: text('phase').notNull(),
  eta: date('eta'),
  priority: text('priority').notNull(),
  coordinatorId: uuid('coordinator_id'),
  coordinatorName: text('coordinator_name'),
  containersTotal: integer('containers_total').notNull(),
  containersDelivered: integer('containers_delivered').notNull(),
  stages: jsonb('stages').$type<Record<string, string>>().notNull(),
  nextSlaDueAt: ts('next_sla_due_at'),
  overdue: boolean('overdue').notNull(),
  freeTimeNext: date('free_time_next'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const outbox = shared.table('outbox', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  type: text('type').notNull(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
  publishedAt: ts('published_at'),
  attempts: integer('attempts').notNull().default(0),
});

export const inbox = shared.table('inbox', {
  consumer: text('consumer').notNull(),
  eventId: uuid('event_id').notNull(),
  tenantId: uuid('tenant_id').notNull(),
  processedAt: ts('processed_at').notNull().defaultNow(),
});

export const idempotencyKey = shared.table('idempotency_key', {
  tenantId: uuid('tenant_id').notNull(),
  key: text('key').notNull(),
  method: text('method').notNull(),
  path: text('path').notNull(),
  requestHash: text('request_hash').notNull(),
  statusCode: integer('status_code'),
  response: jsonb('response'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const auditEvent = shared.table('audit_event', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  actorId: uuid('actor_id'),
  actorName: text('actor_name').notNull(),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  requestId: text('request_id'),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
});
