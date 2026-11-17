-- Everything printed on a real carrier B/L (e.g. Maersk): parties, places, dates, freight terms,
-- free time, the commercial invoice, goods lines and reefer settings. Plus document packs
-- (one PDF holding the B/L, invoice, packing list, certificate of origin and phyto certificate).

ALTER TABLE job
  ADD COLUMN booking_no text,
  ADD COLUMN service_contract text,
  ADD COLUMN shipper text,
  ADD COLUMN notify_party text,
  ADD COLUMN place_of_receipt text,
  ADD COLUMN place_of_delivery text,
  ADD COLUMN place_of_issue text,
  ADD COLUMN bl_issue_date date,
  ADD COLUMN shipped_on_board_date date,
  ADD COLUMN originals_count int,
  ADD COLUMN freight_terms text CHECK (freight_terms IN ('PREPAID','COLLECT')),
  ADD COLUMN service_type text,
  ADD COLUMN free_time_days int CHECK (free_time_days BETWEEN 0 AND 365),
  ADD COLUMN free_time_basis text NOT NULL DEFAULT 'COMBINED' CHECK (free_time_basis IN ('COMBINED','DETENTION','DEMURRAGE')),
  ADD COLUMN invoice_no text,
  ADD COLUMN invoice_date date,
  ADD COLUMN invoice_value numeric(14,3),
  ADD COLUMN invoice_currency char(3),
  ADD COLUMN incoterm text,
  ADD COLUMN country_of_origin text;

ALTER TABLE container
  ADD COLUMN package_kind text,
  ADD COLUMN volume_cbm numeric(10,3),
  ADD COLUMN reefer_temp_c numeric(4,1),
  ADD COLUMN ventilation text,
  -- true when someone typed the free-time end date; false when it is worked out from arrival + free days.
  ADD COLUMN free_time_manual boolean NOT NULL DEFAULT false;
UPDATE container SET free_time_manual = true WHERE free_time_expires_at IS NOT NULL;

-- The goods on the B/L, one row per line (e.g. lime 4,608 ctn + dragon fruit 750 ctn in one container).
CREATE TABLE cargo_line (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES job(id),
  container_id uuid REFERENCES container(id),
  line_no int NOT NULL,
  description text NOT NULL,
  hs_code text,
  packages int,
  package_kind text,
  net_weight_kg numeric(12,2),
  gross_weight_kg numeric(12,2),
  volume_cbm numeric(10,3),
  origin_country text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cargo_line_job_idx ON cargo_line (job_id, line_no);

ALTER TABLE document
  ADD COLUMN covers text[] NOT NULL DEFAULT '{}',
  ADD COLUMN reference_no text,
  ADD COLUMN issue_date date;
