-- ClearPort Lite — prototype schema.
-- One schema (public), one agency (no tenant_id), no row-level security.
-- The production design (multi-tenant, RLS, outbox) lives in db/migrations/.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ───────────────────────── setup ─────────────────────────
CREATE TABLE app_user (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Single row: the agency using the app.
CREATE TABLE company_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name text NOT NULL,
  address text,
  trn text,
  base_currency char(3) NOT NULL DEFAULT 'AED',
  timezone text NOT NULL DEFAULT 'Asia/Dubai',
  vat_pct numeric(5,2) NOT NULL DEFAULT 5,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- People who do the work (assignable to stages and trips). They do not log in.
CREATE TABLE staff (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('COORDINATOR','PRO','INSPECTOR','DRIVER','ACCOUNTS')),
  phone text,
  email text,
  licence_no text,
  licence_expiry date,
  transporter text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE master_item (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('PORT','TERMINAL','SHIPPING_LINE','FEE_TYPE')),
  code text NOT NULL,
  name text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  UNIQUE (kind, code)
);

-- The clearance workflow as versioned configuration. Seeded with v1; jobs keep the version they started on.
CREATE TABLE workflow_definition (
  id uuid PRIMARY KEY,
  version int NOT NULL UNIQUE,
  definition jsonb NOT NULL,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX workflow_definition_one_active ON workflow_definition (active) WHERE active;

-- Yearly sequences for job and invoice numbers.
CREATE TABLE counter (
  name text NOT NULL,
  year int NOT NULL,
  value int NOT NULL,
  PRIMARY KEY (name, year)
);

-- ───────────────────────── customers ─────────────────────────
CREATE TABLE customer (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  trade_licence_no text,
  customs_code text,
  address text,
  preferred_channel text NOT NULL DEFAULT 'WHATSAPP' CHECK (preferred_channel IN ('WHATSAPP','EMAIL','SMS')),
  language text NOT NULL DEFAULT 'en',
  credit_limit numeric(14,3),
  credit_days int NOT NULL DEFAULT 30,
  tariff jsonb,
  contacts jsonb NOT NULL DEFAULT '[]',
  portal_token text UNIQUE,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customer_code_uq ON customer (customs_code) WHERE customs_code IS NOT NULL;
CREATE INDEX customer_name_trgm ON customer USING gin (name gin_trgm_ops);

-- ───────────────────────── clearance ─────────────────────────
-- One job = one Bill of Lading being cleared for a customer.
CREATE TABLE job (
  id uuid PRIMARY KEY,
  job_no text NOT NULL UNIQUE,
  bl_no text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES customer(id),
  vessel text, voyage text, shipping_line_code text,
  port_of_loading text, port_of_discharge text, terminal text,
  eta date NOT NULL,
  ata date,
  commodity text NOT NULL,
  hs_codes text[] NOT NULL DEFAULT '{}',
  shipping_details text,
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  coordinator_staff_id uuid REFERENCES staff(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  workflow_version int NOT NULL,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_customer_idx ON job (customer_id);
CREATE INDEX job_bl_trgm ON job USING gin (bl_no gin_trgm_ops);

CREATE TABLE container (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES job(id),
  container_no text NOT NULL,
  size_type text NOT NULL,
  seal_no text,
  gross_weight_kg numeric(12,2),
  packages int,
  free_time_expires_at date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- The same container cannot be on two open jobs.
CREATE UNIQUE INDEX container_open_uq ON container (container_no) WHERE active;
CREATE INDEX container_job_idx ON container (job_id);
CREATE INDEX container_no_trgm ON container USING gin (container_no gin_trgm_ops);

CREATE TABLE document (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES job(id),
  container_id uuid REFERENCES container(id),
  stage_instance_id uuid,
  doc_type text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes int NOT NULL,
  storage_key text NOT NULL,
  customer_visible boolean NOT NULL DEFAULT false,
  uploaded_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_job_idx ON document (job_id);

CREATE TABLE comment (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES job(id),
  author_name text NOT NULL,
  body text NOT NULL,
  customer_visible boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comment_job_idx ON comment (job_id);

-- ───────────────────────── workflow ─────────────────────────
-- One row per stage per job (job-level stages) or per container (container-level stages).
CREATE TABLE stage_instance (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES job(id),
  container_id uuid REFERENCES container(id),
  stage_key text NOT NULL,
  status text NOT NULL,
  assignee_staff_id uuid REFERENCES staff(id),
  reference_no text,
  data jsonb NOT NULL DEFAULT '{}',
  sla_due_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX stage_instance_uq ON stage_instance (job_id, coalesce(container_id, '00000000-0000-0000-0000-000000000000'::uuid), stage_key);
CREATE INDEX stage_instance_assignee_idx ON stage_instance (assignee_staff_id) WHERE completed_at IS NULL;

-- Append-only history of every status change (the job timeline).
CREATE TABLE stage_event (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES job(id),
  container_id uuid,
  stage_instance_id uuid NOT NULL REFERENCES stage_instance(id),
  stage_key text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  actor_name text NOT NULL,
  remarks text,
  data jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stage_event_job_idx ON stage_event (job_id, occurred_at);

-- ───────────────────────── field operations ─────────────────────────
CREATE TABLE vehicle (
  id uuid PRIMARY KEY,
  plate_no text NOT NULL UNIQUE,
  type text NOT NULL,
  registration_expiry date,
  transporter text,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE trip (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES job(id),
  trip_no text NOT NULL UNIQUE,
  driver_staff_id uuid NOT NULL REFERENCES staff(id),
  vehicle_id uuid NOT NULL REFERENCES vehicle(id),
  inspector_staff_id uuid REFERENCES staff(id),
  delivery_address text NOT NULL,
  delivery_contact text,
  delivery_window text,
  status text NOT NULL DEFAULT 'ASSIGNED' CHECK (status IN ('ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED')),
  cost numeric(14,3),
  currency char(3),
  link_token text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trip_job_idx ON trip (job_id);

CREATE TABLE trip_container (
  trip_id uuid NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  container_id uuid NOT NULL REFERENCES container(id),
  PRIMARY KEY (trip_id, container_id)
);

-- ───────────────────────── finance ─────────────────────────
CREATE TABLE invoice (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES job(id),
  customer_id uuid NOT NULL REFERENCES customer(id),
  invoice_no text NOT NULL UNIQUE,
  issue_date date NOT NULL,
  due_date date NOT NULL,
  currency char(3) NOT NULL,
  subtotal numeric(14,3) NOT NULL,
  vat_amount numeric(14,3) NOT NULL,
  total numeric(14,3) NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ISSUED','PAID','VOID')),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoice_job_idx ON invoice (job_id);

CREATE TABLE invoice_line (
  id uuid PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES invoice(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('SERVICE','DISBURSEMENT')),
  description text NOT NULL,
  quantity int NOT NULL,
  unit_price numeric(14,3) NOT NULL,
  amount numeric(14,3) NOT NULL,
  vat_rate numeric(5,2) NOT NULL DEFAULT 0,
  disbursement_id uuid
);

-- Money paid on the customer's behalf at any stage (duty, DO charges, port storage…).
CREATE TABLE disbursement (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES job(id),
  stage_instance_id uuid REFERENCES stage_instance(id),
  stage_key text,
  fee_type text NOT NULL,
  description text,
  amount numeric(14,3) NOT NULL,
  currency char(3) NOT NULL,
  payment_method text NOT NULL CHECK (payment_method IN ('CASH_FLOAT','COMPANY_CARD','BANK_TRANSFER','ONLINE')),
  paid_on date NOT NULL,
  paid_by_staff_id uuid REFERENCES staff(id),
  paid_by_name text NOT NULL,
  receipt_document_id uuid REFERENCES document(id),
  billable boolean NOT NULL DEFAULT true,
  markup_pct numeric(5,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'RECORDED' CHECK (status IN ('RECORDED','RECONCILED','REVERSED')),
  reverses_id uuid REFERENCES disbursement(id),
  invoice_id uuid REFERENCES invoice(id),
  reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX disbursement_job_idx ON disbursement (job_id);

-- Cash advanced to a PRO to pay fees in the field.
CREATE TABLE pro_float (
  id uuid PRIMARY KEY,
  staff_id uuid NOT NULL REFERENCES staff(id),
  amount numeric(14,3) NOT NULL,
  currency char(3) NOT NULL,
  issued_on date NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── engagement ─────────────────────────
-- IN_APP rows are the bell; WHATSAPP/EMAIL/SMS rows are LOGGED (the prototype never sends them).
CREATE TABLE notification (
  id uuid PRIMARY KEY,
  channel text NOT NULL CHECK (channel IN ('IN_APP','WHATSAPP','EMAIL','SMS')),
  recipient text NOT NULL,
  job_id uuid REFERENCES job(id),
  template text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  link text,
  status text NOT NULL CHECK (status IN ('UNREAD','READ','LOGGED')),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_status_idx ON notification (channel, status, created_at DESC);

CREATE TABLE customer_approval (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES job(id),
  stage_instance_id uuid NOT NULL REFERENCES stage_instance(id),
  token text NOT NULL UNIQUE,
  summary jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','EXPIRED')),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  decided_by text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_approval_job_idx ON customer_approval (job_id);
