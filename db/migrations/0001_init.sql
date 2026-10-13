-- ClearPort initial schema. Runs as the owner role (clearport_owner).
-- Roles clearport_app (API, no BYPASSRLS) and clearport_definer (NOLOGIN, owns token-lookup functions)
-- are created by scripts/bootstrap.ts before this migration.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS customer;
CREATE SCHEMA IF NOT EXISTS clearance;
CREATE SCHEMA IF NOT EXISTS workflow;
CREATE SCHEMA IF NOT EXISTS fieldops;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS engagement;
CREATE SCHEMA IF NOT EXISTS insight;
CREATE SCHEMA IF NOT EXISTS shared;

-- Tenant of the current transaction (set with SET LOCAL by the API). NULL when unset => no rows.
CREATE OR REPLACE FUNCTION shared.current_tenant() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION shared.current_customer() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.customer_id', true), '')::uuid $$;

-- ───────────────────────── platform ─────────────────────────
CREATE TABLE platform.tenant (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  base_currency char(3) NOT NULL DEFAULT 'AED',
  timezone text NOT NULL DEFAULT 'Asia/Dubai',
  settings jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform.app_user (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  email text NOT NULL,
  name text NOT NULL,
  phone text,
  roles text[] NOT NULL,
  customer_id uuid,
  locale text NOT NULL DEFAULT 'en',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX app_user_email_uq ON platform.app_user (tenant_id, lower(email));
CREATE INDEX app_user_email_idx ON platform.app_user (lower(email));

CREATE TABLE platform.master_item (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  kind text NOT NULL CHECK (kind IN ('PORT','TERMINAL','SHIPPING_LINE','FEE_TYPE')),
  code text NOT NULL,
  name text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, kind, code)
);

CREATE TABLE platform.stage_definition (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  version int NOT NULL,
  definition jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, version)
);

-- ───────────────────────── customer ─────────────────────────
CREATE TABLE customer.customer (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  name text NOT NULL,
  trade_licence_no text,
  customs_code text,
  address text,
  preferred_channel text NOT NULL DEFAULT 'WHATSAPP',
  language text NOT NULL DEFAULT 'en',
  credit_limit numeric(14,3),
  credit_days int NOT NULL DEFAULT 30,
  tariff jsonb,
  archived_at timestamptz,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customer_code_uq ON customer.customer (tenant_id, customs_code) WHERE customs_code IS NOT NULL;
CREATE INDEX customer_name_trgm ON customer.customer USING gin (name gin_trgm_ops);

CREATE TABLE customer.contact (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  customer_id uuid NOT NULL REFERENCES customer.customer(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  phone text,
  role text,
  whatsapp_opt_in boolean NOT NULL DEFAULT false
);
CREATE INDEX contact_customer_idx ON customer.contact (customer_id);

-- ───────────────────────── clearance ─────────────────────────
CREATE TABLE clearance.job_counter (
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  year int NOT NULL,
  value int NOT NULL,
  PRIMARY KEY (tenant_id, year)
);

CREATE TABLE clearance.job (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  job_no text NOT NULL,
  bl_no text NOT NULL,
  customer_id uuid NOT NULL REFERENCES customer.customer(id),
  vessel text, voyage text, shipping_line_code text,
  port_of_loading text, port_of_discharge text, terminal text,
  eta date NOT NULL,
  ata date,
  commodity text NOT NULL,
  hs_codes text[] NOT NULL DEFAULT '{}',
  shipping_details text,
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  coordinator_id uuid REFERENCES platform.app_user(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  workflow_version int NOT NULL,
  closed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, bl_no),
  UNIQUE (tenant_id, job_no)
);
CREATE INDEX job_customer_idx ON clearance.job (tenant_id, customer_id);
CREATE INDEX job_bl_trgm ON clearance.job USING gin (bl_no gin_trgm_ops);

CREATE TABLE clearance.container (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  job_id uuid NOT NULL REFERENCES clearance.job(id),
  container_no text NOT NULL,
  size_type text NOT NULL,
  seal_no text,
  gross_weight_kg numeric(12,2),
  packages int,
  free_time_expires_at date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- BRD JOB-003: the same container cannot be on two open jobs.
CREATE UNIQUE INDEX container_open_uq ON clearance.container (tenant_id, container_no) WHERE active;
CREATE INDEX container_job_idx ON clearance.container (job_id);
CREATE INDEX container_no_trgm ON clearance.container USING gin (container_no gin_trgm_ops);

CREATE TABLE clearance.document (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  job_id uuid NOT NULL REFERENCES clearance.job(id),
  container_id uuid REFERENCES clearance.container(id),
  stage_instance_id uuid,
  doc_type text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes int NOT NULL,
  storage_key text NOT NULL,
  version int NOT NULL DEFAULT 1,
  customer_visible boolean NOT NULL DEFAULT false,
  uploaded_by uuid,
  uploaded_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_job_idx ON clearance.document (job_id);

CREATE TABLE clearance.comment (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  job_id uuid NOT NULL REFERENCES clearance.job(id),
  author_id uuid,
  author_name text NOT NULL,
  body text NOT NULL,
  customer_visible boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comment_job_idx ON clearance.comment (job_id);

-- ───────────────────────── workflow ─────────────────────────
CREATE TABLE workflow.stage_instance (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  job_id uuid NOT NULL REFERENCES clearance.job(id),
  container_id uuid REFERENCES clearance.container(id),
  stage_key text NOT NULL,
  status text NOT NULL,
  assignee_id uuid REFERENCES platform.app_user(id),
  reference_no text,
  data jsonb NOT NULL DEFAULT '{}',
  sla_due_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX stage_instance_uq ON workflow.stage_instance (job_id, coalesce(container_id, '00000000-0000-0000-0000-000000000000'::uuid), stage_key);
CREATE INDEX stage_assignee_idx ON workflow.stage_instance (tenant_id, assignee_id) WHERE completed_at IS NULL;
CREATE INDEX stage_key_status_idx ON workflow.stage_instance (tenant_id, stage_key, status);

CREATE TABLE workflow.stage_event (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  job_id uuid NOT NULL,
  container_id uuid,
  stage_instance_id uuid NOT NULL,
  stage_key text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  actor_id uuid,
  actor_name text NOT NULL,
  remarks text,
  data jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  client_occurred_at timestamptz
);
CREATE INDEX stage_event_job_idx ON workflow.stage_event (job_id, occurred_at);

-- ───────────────────────── fieldops ─────────────────────────
CREATE TABLE fieldops.driver (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  name text NOT NULL,
  phone text NOT NULL,
  licence_no text,
  licence_expiry date,
  transporter text,
  user_id uuid REFERENCES platform.app_user(id),
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE fieldops.vehicle (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  plate_no text NOT NULL,
  type text NOT NULL,
  registration_expiry date,
  transporter text,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, plate_no)
);
CREATE TABLE fieldops.trip (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  job_id uuid NOT NULL REFERENCES clearance.job(id),
  trip_no text NOT NULL,
  driver_id uuid NOT NULL REFERENCES fieldops.driver(id),
  vehicle_id uuid NOT NULL REFERENCES fieldops.vehicle(id),
  inspection_agent_id uuid REFERENCES platform.app_user(id),
  delivery_address text NOT NULL,
  delivery_contact text,
  delivery_window text,
  status text NOT NULL DEFAULT 'ASSIGNED' CHECK (status IN ('ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED')),
  cost numeric(14,3),
  currency char(3),
  link_token_hash text,
  link_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, trip_no)
);
CREATE UNIQUE INDEX trip_token_uq ON fieldops.trip (link_token_hash) WHERE link_token_hash IS NOT NULL;
CREATE TABLE fieldops.trip_container (
  trip_id uuid NOT NULL REFERENCES fieldops.trip(id) ON DELETE CASCADE,
  container_id uuid NOT NULL REFERENCES clearance.container(id),
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  PRIMARY KEY (trip_id, container_id)
);

-- ───────────────────────── finance ─────────────────────────
CREATE TABLE finance.invoice_counter (
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  year int NOT NULL,
  value int NOT NULL,
  PRIMARY KEY (tenant_id, year)
);
CREATE TABLE finance.invoice (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  job_id uuid NOT NULL REFERENCES clearance.job(id),
  customer_id uuid NOT NULL REFERENCES customer.customer(id),
  invoice_no text NOT NULL,
  issue_date date NOT NULL,
  due_date date NOT NULL,
  currency char(3) NOT NULL,
  subtotal numeric(14,3) NOT NULL,
  vat_amount numeric(14,3) NOT NULL,
  total numeric(14,3) NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ISSUED','PAID','VOID')),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, invoice_no)
);
CREATE TABLE finance.invoice_line (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  invoice_id uuid NOT NULL REFERENCES finance.invoice(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('SERVICE','DISBURSEMENT')),
  description text NOT NULL,
  quantity int NOT NULL,
  unit_price numeric(14,3) NOT NULL,
  amount numeric(14,3) NOT NULL,
  vat_rate numeric(5,2) NOT NULL DEFAULT 0,
  disbursement_id uuid
);
CREATE TABLE finance.disbursement (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  job_id uuid NOT NULL REFERENCES clearance.job(id),
  stage_instance_id uuid REFERENCES workflow.stage_instance(id),
  stage_key text,
  fee_type text NOT NULL,
  description text,
  amount numeric(14,3) NOT NULL,
  currency char(3) NOT NULL,
  payment_method text NOT NULL,
  paid_on date NOT NULL,
  paid_by uuid REFERENCES platform.app_user(id),
  paid_by_name text NOT NULL,
  receipt_document_id uuid REFERENCES clearance.document(id),
  billable boolean NOT NULL DEFAULT true,
  markup_pct numeric(5,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'RECORDED' CHECK (status IN ('RECORDED','RECONCILED','REVERSED')),
  reverses_id uuid REFERENCES finance.disbursement(id),
  invoice_id uuid REFERENCES finance.invoice(id),
  reconciled_by uuid,
  reconciled_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX disbursement_job_idx ON finance.disbursement (job_id);
CREATE INDEX disbursement_payer_idx ON finance.disbursement (tenant_id, paid_by);
CREATE TABLE finance.pro_float (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  user_id uuid NOT NULL REFERENCES platform.app_user(id),
  amount numeric(14,3) NOT NULL,
  currency char(3) NOT NULL,
  issued_on date NOT NULL,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── engagement ─────────────────────────
CREATE TABLE engagement.notification (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  channel text NOT NULL CHECK (channel IN ('IN_APP','WHATSAPP','EMAIL','SMS','PUSH')),
  recipient text NOT NULL,
  user_id uuid,
  job_id uuid,
  template text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','SENT','FAILED','SKIPPED')),
  dedupe_key text NOT NULL,
  error text,
  read_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, dedupe_key)
);
CREATE INDEX notification_user_idx ON engagement.notification (tenant_id, user_id, created_at DESC);

CREATE TABLE engagement.customer_approval (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  job_id uuid NOT NULL REFERENCES clearance.job(id),
  stage_instance_id uuid NOT NULL REFERENCES workflow.stage_instance(id),
  token_hash text NOT NULL UNIQUE,
  summary jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','EXPIRED')),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  decided_by text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── insight (read models) ─────────────────────────
CREATE TABLE insight.job_board (
  job_id uuid PRIMARY KEY REFERENCES clearance.job(id),
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  job_no text NOT NULL,
  bl_no text NOT NULL,
  customer_id uuid NOT NULL,
  customer_name text NOT NULL,
  phase text NOT NULL,
  eta date,
  priority text NOT NULL,
  coordinator_id uuid,
  coordinator_name text,
  containers_total int NOT NULL,
  containers_delivered int NOT NULL,
  stages jsonb NOT NULL,
  next_sla_due_at timestamptz,
  overdue boolean NOT NULL DEFAULT false,
  free_time_next date,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_board_phase_idx ON insight.job_board (tenant_id, phase);

-- ───────────────────────── shared ─────────────────────────
CREATE TABLE shared.outbox (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts int NOT NULL DEFAULT 0
);
CREATE INDEX outbox_unpublished_idx ON shared.outbox (occurred_at) WHERE published_at IS NULL;

CREATE TABLE shared.inbox (
  consumer text NOT NULL,
  event_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);

CREATE TABLE shared.idempotency_key (
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  key text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  request_hash text NOT NULL,
  status_code int,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE shared.audit_event (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  actor_id uuid,
  actor_name text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before jsonb,
  after jsonb,
  ip text,
  user_agent text,
  request_id text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx ON shared.audit_event (tenant_id, entity_type, entity_id);

-- ───────────────────────── Row-level security ─────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS s, c.relname AS t
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname IN ('platform','customer','clearance','workflow','fieldops','finance','engagement','insight','shared')
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.s, r.t);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', r.s, r.t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I.%I USING (tenant_id = shared.current_tenant()) WITH CHECK (tenant_id = shared.current_tenant())',
      r.s, r.t);
  END LOOP;
END $$;

ALTER TABLE platform.tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON platform.tenant USING (id = shared.current_tenant());

-- Customer-portal sessions (app.customer_id set) only ever see their own jobs, enforced in the database too.
CREATE POLICY customer_scope ON clearance.job AS RESTRICTIVE
  USING (shared.current_customer() IS NULL OR customer_id = shared.current_customer());

-- Token lookups that must work before the tenant is known (login, driver trip link, customer approval link)
-- go through SECURITY DEFINER functions owned by clearport_definer. Only that role gets a cross-tenant read policy.
CREATE POLICY definer_lookup ON platform.app_user FOR SELECT TO clearport_definer USING (true);
CREATE POLICY definer_lookup ON platform.tenant FOR SELECT TO clearport_definer USING (true);
CREATE POLICY definer_lookup ON fieldops.trip FOR SELECT TO clearport_definer USING (true);
CREATE POLICY definer_lookup ON engagement.customer_approval FOR SELECT TO clearport_definer USING (true);
CREATE POLICY definer_lookup ON shared.outbox FOR SELECT TO clearport_definer USING (true);

GRANT USAGE ON SCHEMA platform, shared TO clearport_definer;
GRANT USAGE ON SCHEMA fieldops, engagement TO clearport_definer;
GRANT SELECT ON platform.app_user, platform.tenant, fieldops.trip, engagement.customer_approval, shared.outbox TO clearport_definer;

CREATE FUNCTION platform.find_login(p_email text)
  RETURNS TABLE (user_id uuid, tenant_id uuid, tenant_name text, name text, roles text[], customer_id uuid, locale text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, platform AS $$
    SELECT u.id, u.tenant_id, t.name, u.name, u.roles, u.customer_id, u.locale
    FROM platform.app_user u JOIN platform.tenant t ON t.id = u.tenant_id
    WHERE lower(u.email) = lower(p_email) AND u.active
  $$;
CREATE FUNCTION platform.list_demo_logins()
  RETURNS TABLE (email text, name text, roles text[], tenant_name text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, platform AS $$
    SELECT u.email, u.name, u.roles, t.name FROM platform.app_user u JOIN platform.tenant t ON t.id = u.tenant_id
    WHERE u.active ORDER BY t.name, u.roles[1], u.name
  $$;
CREATE FUNCTION fieldops.resolve_trip_token(p_hash text)
  RETURNS TABLE (trip_id uuid, tenant_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, fieldops AS $$
    SELECT id, tenant_id FROM fieldops.trip WHERE link_token_hash = p_hash AND link_expires_at > now() AND status <> 'CANCELLED'
  $$;
CREATE FUNCTION engagement.resolve_approval_token(p_hash text)
  RETURNS TABLE (approval_id uuid, tenant_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, engagement AS $$
    SELECT id, tenant_id FROM engagement.customer_approval WHERE token_hash = p_hash
  $$;
-- Outbox relay sweeps all tenants for unpublished events, then processes each one inside its tenant.
CREATE FUNCTION shared.pending_outbox(p_limit int, p_older_than interval)
  RETURNS TABLE (id uuid, tenant_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, shared AS $$
    SELECT id, tenant_id FROM shared.outbox
    WHERE published_at IS NULL AND occurred_at < now() - p_older_than AND attempts < 10
    ORDER BY occurred_at LIMIT p_limit
  $$;
-- Free-time scanner needs the list of tenants.
CREATE FUNCTION platform.all_tenant_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, platform AS $$ SELECT id FROM platform.tenant $$;

ALTER FUNCTION platform.find_login(text) OWNER TO clearport_definer;
ALTER FUNCTION platform.list_demo_logins() OWNER TO clearport_definer;
ALTER FUNCTION fieldops.resolve_trip_token(text) OWNER TO clearport_definer;
ALTER FUNCTION engagement.resolve_approval_token(text) OWNER TO clearport_definer;
ALTER FUNCTION shared.pending_outbox(int, interval) OWNER TO clearport_definer;
ALTER FUNCTION platform.all_tenant_ids() OWNER TO clearport_definer;

-- ───────────────────────── Grants for the application role ─────────────────────────
GRANT USAGE ON SCHEMA platform, customer, clearance, workflow, fieldops, finance, engagement, insight, shared TO clearport_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform, customer, clearance, workflow, fieldops, finance, engagement, insight, shared TO clearport_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA platform, customer, clearance, workflow, fieldops, finance, engagement, insight, shared TO clearport_app;
-- Audit trails are append-only, even for the application.
REVOKE UPDATE, DELETE ON shared.audit_event, workflow.stage_event FROM clearport_app;
REVOKE DELETE ON finance.disbursement, finance.invoice FROM clearport_app;
