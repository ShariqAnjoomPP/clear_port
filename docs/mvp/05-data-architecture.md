# 05 · Data architecture

The prototype's data conventions are correct and stay: one PostgreSQL 16 database, one schema per module, `tenant_id` on every business table, `FORCE ROW LEVEL SECURITY`, UUIDv7 keys, `numeric(14,3)` money with currency, `timestamptz`, `version` for optimistic locking, append-only audit and stage events. This document adds the **ownership rules** that make modules extractable, and the operational decisions for production.

## 1. Rules

1. **A schema belongs to exactly one module.** Only that module's `adapters/persistence` code reads or writes it.
2. **No new foreign keys across consistency groups.** Reference other modules' rows by id and validate through their Module API. Existing cross-group FKs stay in the MVP (§3) and are dropped only when a module moves to Level 2.
3. **No cross-schema joins in write paths.** Cross-module lists come from Insight projections.
4. **Every migration is backward compatible with the previous release** (expand/contract, §4), because Lambda canaries run old and new code side by side.
5. **Technical tables in `shared`** (`outbox`, `inbox`, `idempotency_key`, `audit_event`) are written only through the UoW runner (doc 03 §3.4).

## 2. Ownership map

| Schema | Owner module | Tables (current + MVP additions in *italics*) |
|---|---|---|
| `platform` | Platform | `tenant`, `app_user`, `master_item`, `stage_definition`, *`identity`, `role`, `user_role`, `branch`, `feature_flag`* |
| `customer` | Customer | `customer`, `contact` (*+ `whatsapp_opt_in_at`*) |
| `clearance` | Clearance (Operations core) | `job` (*+ `branch_id`*), `container`, `document`, `comment`, `job_counter`, *`document_requirement`* |
| `workflow` | Workflow (Operations core) | `stage_instance`, `stage_event`, *`exception_task`, `timer`* |
| `fieldops` | FieldOps | `driver`, `vehicle`, `trip`, `trip_container`, *`trip_counter`, `evidence` (geotag metadata)* |
| `finance` | Finance | `disbursement`, `pro_float`, `invoice`, `invoice_line`, `invoice_counter`, *`relay_receipt`* |
| `engagement` | Engagement | `notification`, `customer_approval`, *`notification_template`* |
| `insight` | Insight | `job_board`, *`container_board`, `stage_duration_fact`* |
| `shared` | Runtime (technical) | `outbox`, `inbox`, `idempotency_key`, `audit_event` |

Tables owned by one module and read by another today (to be replaced by Module API queries, doc 01 A-2): `disbursement`, `invoice` (read by Clearance), `stage_instance` (read and written by FieldOps, read by Engagement), `job`, `container`, `document` (read by Engagement, Finance, Workflow routes), `app_user` (read by Clearance, Finance).

## 3. Existing cross-group foreign keys

All tables reference `platform.tenant`; that FK stays everywhere (tenant is the root). The others cross a consistency-group boundary and are the work list for any future Level 2 move:

| From | To | Note |
|---|---|---|
| `clearance.job` | `customer.customer`, `platform.app_user` | Keep in MVP |
| `fieldops.trip`, `fieldops.trip_container` | `clearance.job`, `clearance.container`, `platform.app_user` | Drop when FieldOps moves to Level 2 |
| `finance.disbursement` | `clearance.job`, `clearance.document`, `workflow.stage_instance`, `platform.app_user` | Drop when Finance moves |
| `finance.invoice` | `clearance.job`, `customer.customer` | Drop when Finance moves |
| `engagement.customer_approval` | `clearance.job`, `workflow.stage_instance` | Drop when Engagement moves |
| `insight.job_board` | `clearance.job` | Drop when Insight gets its own database |

`clearance` ↔ `workflow` FKs are inside the Operations core group and stay permanently.

## 4. Migrations

The prototype applies `db/migrations/*.sql` in order as the owner role ([migrate.ts](../../apps/api/scripts/migrate.ts)). Keep the runner; add these rules:

- **Naming:** `NNNN_<module>_<change>.sql`, e.g. `0002_platform_roles.sql`. One module per file.
- **Expand/contract.** Example for roles (doc 04 §10):

  | Release | Database | Code |
  |---|---|---|
  | N | add `role`, `user_role`; backfill from `app_user.roles` | writes both; reads `app_user.roles` |
  | N+1 | — | reads `user_role` |
  | N+2 | drop `app_user.roles` | — |

- **Who runs them:** CI only, as the owner role, before the Lambda deploy. The application role never runs DDL.
- **Checks in CI:** apply all migrations to an empty database and to a copy of the staging snapshot; run the RLS suite (§8) after.
- **RLS on new tables is automatic:** keep the loop in `0001_init.sql` as a reusable function `shared.enable_tenant_rls(schema, table)` and call it in every migration that creates a table. CI fails if any table in a module schema lacks a `tenant_isolation` policy.

## 5. Connections and the database adapter

ADR-004 chooses between Neon and Aurora Serverless v2 based on residency. If data must stay in the UAE or Bahrain, Aurora in that region is the option. **[Confirm residency]** decides it; the code must not care.

**Decision (ADR-015):** put SQL execution behind the UoW runner port (doc 03 §3.4) with two adapters, and choose per environment.

| Option | Network | Fixed monthly cost driver | Per-request latency | Use |
|---|---|---|---|---|
| A. Neon + `pg` (TLS, Neon pooler) | No VPC | Neon plan | Low | Dev, preview branches; prod if residency allows |
| B. Aurora SV2 + **RDS Data API** | No VPC, IAM auth, no NAT, no endpoints | Aurora ACUs only | +10–30 ms per statement **[measure]** | **Default for prod if Aurora** |
| C. Aurora SV2 + Lambdas in VPC + RDS Proxy | Private subnets, VPC interface endpoints for SQS/EventBridge/SSM/S3 | Endpoints per AZ + RDS Proxy minimum charge **[verify]** | Lowest | Switch to it if B fails the latency budget |
| D. Aurora with a public endpoint | Internet-exposed database | — | Low | **Rejected** (security) |

**Spike DB-1 (Sprint 0):** run the k6 scenario (doc 07 §4) with adapters A and B against the transition endpoint, which runs about 10 statements. Accept B if p95 server time stays under 300 ms; otherwise plan C.

Either way:

- `pg` pool `max: 1` per Lambda instance (fixes S-3). An instance serves one request at a time.
- **Reserved concurrency** per API Lambda caps total connections: Σ reserved concurrency < database max connections × 0.8.
- **Fewer statements per request:** principal resolution + tenant context in one call (doc 04 §4); idempotency inside the UoW (doc 03 §3.4); `jobFinanceSummary`-style aggregate queries instead of loops.
- **Scale to zero:** no pollers (doc 06), so Aurora can auto-pause at night and at weekends. In production, a Scheduler pair raises minimum capacity at 07:00 and lowers it at 20:00 tenant time (SAD §11), so the first morning request is not slow **[Verify Aurora auto-pause support and resume time in region]**.

## 6. Read models, search and performance

Insight owns projections, rebuilt from events and replayable (`POST /v1/insight/admin/rebuild?jobId=`, owner only).

- **Event-carried state:** published events carry the fields Insight needs (`jobNo`, `blNo`, `customerName`, `stageKey`, `to`, `done`…), so the projector stops querying five other modules' tables per event. Where a projection still needs more, it calls the owning module's query API.
- **Search (OPS-006, NFR-005):** add trigram indexes on `insight.job_board (bl_no, job_no, customer_name)` and a `search_terms` column (container numbers, Bayan/DO/CCRO references) maintained by the projector, so search is one indexed query on one table instead of `EXISTS` sub-queries into Clearance and Workflow (fixes S-5).
- **Pagination:** cursor on `(updated_at, job_id)` (fixes S-6). Same response shape (`nextCursor` string).
- **Board query target:** < 50 ms for 2,000 open BLs (SAD QA-5). Verified by the load test seed (doc 07 §4).

## 7. Files

Unchanged: private S3 bucket, SSE, presigned POST with content-type and size conditions, 5-minute expiry, key `tenant/{tenantId}/job/{jobId}/{documentId}/…`, lifecycle to Infrequent Access (90 days) and Glacier Instant Retrieval (1 year).

Added for the MVP:

- **S3 `ObjectCreated` → SQS → `wk-file-scan`:** reads the first bytes, checks the magic bytes against the registered content type, and quarantines a mismatch (fixes X-7). GuardDuty malware scanning for S3 is P2.
- **Evidence metadata** (PHY-002): `fieldops.evidence` stores capture time, device time and optional geolocation with accuracy for inspection photos and POD.
- **Retention** (DOC-004): per-tenant retention period **[Confirm customs record-keeping period]**, applied with S3 lifecycle expiration and a database archive job.

## 8. Tenant isolation test suite (QA-1)

A Vitest + Testcontainers suite that, for **every table in every module schema**:

1. seeds two tenants (and two customers in one tenant);
2. as tenant A's app role, tries `SELECT`, `UPDATE`, `DELETE`, and `INSERT` with tenant B's id;
3. expects zero rows affected or a policy violation;
4. as customer X, expects to see only customer X's jobs.

The table list is read from `information_schema`, so a new table is tested automatically. It runs in CI on every pull request.

## 9. Backup, recovery and privacy

| Need | Approach | Target (NFR-006) |
|---|---|---|
| Point-in-time restore | Aurora 7–35 days / Neon per plan | RPO < 24 h (actual: minutes) |
| Logical backup | Nightly `pg_dump` by a scheduled task to a separate, versioned, object-locked bucket | Survives account compromise |
| Restore drill | Quarterly, timed, into a scratch environment | RTO < 4 h |
| Personal data | Contacts, drivers, users. Export and erasure of personal fields on request (UAE PDPL **[Confirm law]**). Audit and stage-event rows are append-only and kept for the record-keeping period as a legal obligation **[Confirm with counsel]** | |
| WhatsApp consent | `customer.contact.whatsapp_opt_in_at`; no WhatsApp message without it (Meta policy) | |
