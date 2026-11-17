# 01 · Current-state assessment of the prototype

Reviewed: commit `eed84df` (about 9,100 lines of TypeScript and SQL). The prototype delivers the full P1 flow end to end and passes its Playwright suite. This review asks a different question: **is the code structured so that the MVP can be built on it, and so that each module can later be lifted out into its own serverless API without a rewrite?**

## 1. Verdict

The **data and safety foundations are production-grade** and should be kept as they are. The **module structure is not yet extractable**: business logic sits in HTTP handlers, and modules share tables and transactions. Authentication works only in dev mode. Infrastructure as code does not exist yet.

| Area | Rating | Summary |
|---|---|---|
| Tenant isolation (RLS) | ✅ Keep | `FORCE ROW LEVEL SECURITY` on every table, non-owner app role, `SECURITY DEFINER` lookups, customer-scope policy |
| Reliability patterns | ✅ Keep | Transactional outbox, inbox dedupe, idempotency keys, optimistic versions, append-only audit |
| Workflow engine | ✅ Keep, extend | Pure, table-driven, Specification guards that explain "waiting for…". Some stage keys are still hard-coded outside it |
| API conventions | ✅ Keep | RFC 9457 problems, ETag/If-Match, Zod contracts shared with the PWA, 404-not-403 for out-of-scope ids |
| PWA | ✅ Keep | Role shells, lazy routes, IndexedDB outbox with idempotency keys, RTL, compression before upload |
| Module boundaries | ⚠️ Rework | Facades exist, but routes query other modules' tables, and cross-module calls share a transaction |
| Code layering | ⚠️ Rework | Routes are transaction scripts: validation, authorisation, SQL and events in one handler |
| Async and timers | ⚠️ Rework | Three pollers hit the database every 30–60 s, which defeats scale-to-zero |
| Authentication | ❌ Build | Dev HS256 tokens with email-only login. Cognito verifier is incomplete; no MFA, no customer sign-in |
| Authorisation | ⚠️ Extend | Fixed role map in code; no branch/port scoping (ADM-001); system actor runs as `OWNER` |
| Infrastructure | ❌ Build | `infra/` is empty; no CDK stacks, no CI pipeline |
| Tests | ⚠️ Extend | Unit tests for kernel and workflow, 8 E2E tests. No API, RLS or contract tests |
| Observability | ❌ Build | `console.log` JSON only; no metrics, tracing or alarms |

## 2. What to keep, and why

These are deliberate, correct choices. The MVP builds on them; nobody should "simplify" them away.

| Pattern | Where | Why it matters for MVP |
|---|---|---|
| RLS with `set_config('app.tenant_id', …, true)` per transaction | [db.ts](../../apps/api/src/shared/db.ts) `withTenant` | QA-1 is met in the database, not only in code |
| `SECURITY DEFINER` functions for cross-tenant lookups | [0001_init.sql](../../db/migrations/0001_init.sql) (`find_login`, `resolve_trip_token`, `pending_outbox`) | The only legal way to read across tenants; reused for principal resolution (doc 04) |
| Outbox written in the same transaction, fast-path publish after commit, relay as safety net | [bus.ts](../../apps/api/src/shared/bus.ts) | No lost notifications (ADR-006) |
| Inbox table per consumer | [bus.ts](../../apps/api/src/shared/bus.ts) `deliver` | Consumers are idempotent under SQS redelivery |
| Pure transition planner returning `Result` | [engine.ts](../../packages/workflow/src/engine.ts) | Already a domain core with no I/O; the model for other modules |
| Workflow version pinned on each job | `job.workflow_version` | Lets us change the flow for new jobs without changing running ones. **This is the main tool for safe functional change** |
| Token-handler cookie (`HttpOnly`, `SameSite=Strict`, path `/api/auth`), access token in memory | [auth-routes.ts](../../apps/api/src/modules/platform/auth-routes.ts), [api.ts](../../apps/web/src/lib/api.ts) | Same shape stays with Cognito (ADR-005) |
| Ports with two adapters (`FileStore`, `EventPublisher`, `TokenVerifier`, `ChannelSender`) | `shared/*.ts` | The right idea; the wiring needs to move into a composition root |
| Link tokens hashed at rest, single purpose, expiring | trip links, approval links | Keep for drivers and one-tap approvals |

## 3. Findings that must change

Each finding has an ID used in the roadmap (doc 09). Severity: **H** blocks MVP or extraction, **M** must fix before pilot, **L** fix when touched.

### 3.1 Architecture and boundaries

| ID | Sev | Finding | Evidence | Fix (doc) |
|---|---|---|---|---|
| A-1 | H | Routes are transaction scripts. Validation, policy, SQL, events and audit live in the Hono handler, so the logic cannot be reused by a queue consumer, a different entry point or another service | [clearance/routes.ts](../../apps/api/src/modules/clearance/routes.ts) (309 lines), [fieldops/routes.ts](../../apps/api/src/modules/fieldops/routes.ts) | Commands and queries in an application layer (03 §3) |
| A-2 | H | Modules read other modules' tables directly | `clearance/routes.ts` selects from `disbursement`, `invoice`, `stageEvent`, `appUser`; `engagement/routes.ts` from `job`, `container`, `stageInstance`; `workflow/routes.ts` from `job`, `customer` | Module API queries (03 §4) |
| A-3 | H | One `shared/schema.ts` holds every module's tables, so any module can import any table | [schema.ts](../../apps/api/src/shared/schema.ts) | Per-module persistence schema + lint rule (03 §2, 05 §2) |
| A-4 | H | Cross-module calls pass the caller's transaction (`tx`) | `workflow/service.ts` → `finance.recordDisbursements(tx, …)` and `engagement.requestCustomerApproval(tx, …)`; `fieldops` → `workflow.transitionStage(tx, …)` | Consistency groups + events (03 §5) |
| A-5 | M | Adapters are chosen by module-level `config.X === …` singletons, not in a composition root | `fileStore`, `publisher`, `tokenVerifier`, `channels` | Composition root per runtime unit (03 §6) |
| A-6 | M | Every context Lambda bundles and boots every module and every consumer | [lambda/api.ts](../../apps/api/src/lambda/api.ts) calls `boot()` which registers all `CONSUMERS` | Entry point per runtime unit (02 §3) |
| A-7 | M | Stage keys hard-coded outside the catalogue, against ADR-008 | `closeJob` (`'CCRO'`, `'DELIVERY'`), `deriveJobPhase`, `scanFreeTime` (`'RELEASE'`/`'GATED_OUT'`), PRO's permission list | Stage roles/markers in the catalogue (08 §4) |
| A-8 | M | `lint:boundaries` script points to a `.dependency-cruiser.cjs` that does not exist | [package.json](../../package.json) | Add rules (03 §7) |
| A-9 | L | API paths differ from the Solution Architecture (`/v1/clearance/jobs` vs `/v1/jobs`) | [composition.ts](../../apps/api/src/composition.ts) | Keep the prototype's paths as the published v1 (ADR-012) |
| A-10 | H | FieldOps writes Workflow's `stage_instance` rows directly (assignees on trip create, `TRUCK` reset on cancel) and calls `transitionStage` inside its own transaction | `fieldops/routes.ts` `createTrip`, `POST /trips/:id/cancel` | Command relay (03 §5) |
| A-11 | M | Trip numbers come from `count(*) + 1`, so two concurrent trips can get the same number; no unique constraint catches it | `fieldops/routes.ts` `createTrip` | Per-tenant counter like `nextJobNo` |

### 3.2 Serverless fitness and cost

| ID | Sev | Finding | Evidence | Fix (doc) |
|---|---|---|---|---|
| S-1 | H | Pollers run on intervals: outbox relay 30 s, SLA scan 60 s, notification dispatcher 30 s, free-time hourly. In production each one wakes the database, so Aurora Serverless v2 / Neon never pause | [local.ts](../../apps/api/src/local.ts), [timers.ts](../../apps/api/src/workers/timers.ts), [dispatcher.ts](../../apps/api/src/modules/engagement/dispatcher.ts) | One-off EventBridge Scheduler timers; event-driven sending (06 §4–5) |
| S-2 | M | SLA scan keeps its window in a module variable (`lastSlaScan`), so a cold start or two concurrent instances miss or double-fire breaches | `timers.ts` | Scheduler timers (06 §5) |
| S-3 | M | `pg.Pool` with `max: 5` per Lambda instance. An instance serves one request at a time, so 4 of 5 connections are waste and multiply database connections under load | [db.ts](../../apps/api/src/shared/db.ts) | `max: 1` or Data API adapter (05 §5) |
| S-4 | M | The idempotency middleware opens two extra transactions per write (claim, then store), on top of the command's own | [idempotency.ts](../../apps/api/src/shared/idempotency.ts) | Claim and store inside the command's unit of work (03 §3.4) |
| S-5 | L | Search uses `ILIKE '%q%'` on `insight.job_board`, which has no trigram index; will not meet NFR-005 at 50,000 BLs per tenant | `clearance/routes.ts` `GET /jobs`; migration indexes | Trigram indexes on the projection (05 §6) |
| S-6 | L | Cursor on `updated_at` alone; ties drop or repeat rows | `GET /jobs` | Composite cursor `(updated_at, job_id)` |

### 3.3 Security

| ID | Sev | Finding | Evidence | Fix (doc) |
|---|---|---|---|---|
| X-1 | H | Only the dev issuer works: anyone who can reach `/auth/dev-login` with a valid email gets a session. It is guarded by `AUTH_MODE`, but the code ships in every bundle | [auth-routes.ts](../../apps/api/src/modules/platform/auth-routes.ts) | Cognito token handler; dev routes excluded at build time (04 §3, §9) |
| X-2 | H | Cognito path takes roles from `cognito:groups`. Groups are pool-wide, not per tenant, and cannot express branch scope | [auth.ts](../../apps/api/src/shared/auth.ts) `CognitoTokenVerifier` | Principal resolved from our database (04 §4) |
| X-3 | H | No MFA, no password policy, no customer sign-in, no session revocation (NFR-002) | — | 04 §3 |
| X-4 | M | `systemActor` carries the `OWNER` role, so every consumer and timer runs with full rights | [context.ts](../../apps/api/src/shared/context.ts) | Least-privilege system principals (04 §7) |
| X-5 | M | `skipPermission: true` bypasses policy for driver links and approval consumers instead of expressing a narrower policy | `workflow/service.ts`, `fieldops/routes.ts`, `workflow/consumers.ts` | Principal kinds with their own policies (04 §6) |
| X-6 | L | Idempotency keys are scoped per tenant, not per principal. Two users sending the same key and body would get one shared response | `idempotency.ts` | Scope key by principal (03 §3.4) |
| X-7 | L | The magic-byte check runs only for the local file store; S3 uploads are not sniffed | `clearance/routes.ts` register document | S3 `ObjectCreated` → scan worker (06 §6) |

## 4. BRD P1 coverage

The functional gaps are listed in [08-functional-scope.md §2](08-functional-scope.md#2-brd-p1-coverage-in-the-prototype), where they are planned. In short: the 9-stage flow, gates, disbursements, trips, POD signature, board, tasks, search and audit work. Branch scoping, the document checklist, DO validity alerts, held-container exceptions, the POD PDF, geotagged evidence, stage-catalogue editing beyond SLAs, MFA and notification templates are missing or partial.

The prototype also contains simplified versions of several **P2** features (invoices, customer portal, one-tap approvals, profitability and free-time reports). The MVP keeps them, behind per-tenant feature flags, so nothing the stakeholders have seen disappears (08 §5).
