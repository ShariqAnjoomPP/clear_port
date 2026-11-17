# clear_port

**ClearPort Lite**: a mobile-first PWA prototype of a customs clearance and delivery app for port clearing agents in Oman (Sohar, Salalah; OMR). One job is one Bill of Lading. The app takes it from documents received, through customs (Bayan), customer approval of charges, inspection, the delivery order and the port release (gate pass), to trucks, delivery, invoicing and closing the job.

The prototype is deliberately simple. It has one demo user (sign in as **demouser / Demo@123**), one agency (no multi-tenancy), and one workflow stored in the database. WhatsApp, email and SMS are logged, not sent. Every feature is real, and each backend function is already packaged as an AWS Lambda.

## Run it locally

You need Node 22 (`.nvmrc`) and PostgreSQL 16.

```bash
brew install postgresql@16 && brew services start postgresql@16
createdb clearport                 # app data
createdb clearport_test            # used by the API tests
nvm use
cp .env.example .env               # set DATABASE_URL to your macOS user: postgres://<you>@localhost:5432/clearport
npm install
npm run db:reset                   # create tables and the base data (agency, staff, vehicles, workflow); no customers or jobs
npm run db:demo                    # optional: add 10 demo jobs and 5 customers (prints an approval link and a portal link)
npm run dev                        # web on http://localhost:5173, API on http://localhost:4000
```

The app opens on **Sign in** (demouser / Demo@123), then on **Home**: quick search, **Create job**, **Jobs** and **Customers**. The bottom navigation (Home · Jobs · Customers · More) reaches everything else. Customers are created inside **Create job** (step 1: pick an existing customer or enter a new one, together with the B/L details). On a phone, add it to the home screen to use it as an app.

## Demo data

A fresh `db:reset` has no customers or jobs. `npm run db:demo` (also used by the API tests) adds 10 jobs at different points of the workflow: documents received, customs in progress, waiting for the customer's approval, ready for port release, delivering, one container held at inspection, ready to close, and closed and paid. Two of them (B/Ls 275183155 to Sohar and 275183136 to Salalah) are typed in from real Maersk B/Ls: shipper, booking no., freight terms, 9 days free time, goods lines with HS codes and weights, 40' reefers with set temperature, and the commercial invoice. The data also includes 5 customers, 9 staff (coordinators, PROs, an inspector, drivers, accounts), 3 vehicles, trips, payments, PRO cash floats and invoices. Timestamps are spread over the past weeks so SLA and overdue flags look realistic.

No-login pages are opened from links. The links appear in **Notifications → Messages sent**, on the customer card, and on the Trips page:

| Page | Path | Who uses it |
|---|---|---|
| Charge approval | `/a/<token>` | Customer, from WhatsApp or email |
| Driver trip | `/t/<token>` | Driver, on a phone |
| Customer portal | `/p/<token>` | Customer |
| Shipment tracking | `/track` | Any customer: enters the mobile number the agent has on file. Shows progress, containers, goods and updates (no money or documents), plus WhatsApp, call and email buttons from Settings → Company |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API and web with live reload |
| `npm run db:reset` | Drop everything in the local database and uploads, migrate, seed the base data (local databases only) |
| `npm run db:demo` | Add the demo customers and jobs on top of a fresh reset |
| `npm test` | Unit tests (workflow engine, money, container numbers) and API integration tests on `clearport_test` |
| `npm run typecheck` | TypeScript across all packages |
| `npm run build` | Web app to `apps/web/dist-lite`, one Lambda bundle per function to `apps/api/dist/<name>/index.mjs` |
| `npm run smoke:lambdas` | Build, then invoke every Lambda bundle with a real API Gateway event against the local database |

## Put it online (free)

See [DEPLOY.md](DEPLOY.md): Vercel for the web app and the whole API as one serverless function, Neon for Postgres. The online database starts fresh (`npm run db:setup:remote` = migrate + seed, no demo jobs). `npm run build:vercel` writes the prebuilt output Vercel deploys.

## How it is built

```
apps/web     React 19 + Vite + TanStack Router/Query + Tailwind, Material 3 style, installable PWA. Calls /api/<function>/...
apps/api     Hono functions. Locally one dev server; in production one Lambda per function.
  src/functions/<name>/   routes.ts (HTTP + validation) and service.ts (business rules)
  src/lib/                database, schema, errors, file store, demo user
packages/workflow         The clearance workflow engine (pure, unit-tested): stages, gates, next steps
packages/contracts        Zod schemas shared by the API and the web forms
packages/kernel           Money (3-decimal, no floats), container numbers (prototype checks 11 characters; ISO 6346 check digit kept for later), ids
db/migrations-lite        The database schema
```

| Function | Responsibility |
|---|---|
| `session`, `settings` | The demo user; company, staff and master data |
| `customers` | Customers, contacts, tariff, credit check |
| `jobs` | Jobs (B/Ls), containers, comments, timeline, close and reopen |
| `documents` | Uploads (local disk) and downloads |
| `workflow` | Workflow definition, stage changes, assignments, task list |
| `fieldops` | Vehicles, trips, driver links |
| `finance` | Payments, PRO floats, invoices, receivables |
| `engagement` | In-app inbox, outbound message log, approvals, alerts |
| `insight` | Board, container tracker, dashboard, reports |
| `public` | No-login pages: approval, driver trip, customer portal |

The workflow is data, not code. The ten stages, their statuses, the gates between them ("port release needs the DO received and customs cleared") and their SLA hours live in the `workflow_definition` table, seeded from `packages/workflow`. Changing SLA hours in Settings publishes a new version, and running jobs keep the version they started on.

## Moving to production

| Prototype | Production | Change |
|---|---|---|
| Dev server | API Gateway → one Lambda per function | Bundles already built by `npm run build`. Add infrastructure (e.g. CDK). |
| Local Postgres | Neon or Aurora Serverless v2 | `DATABASE_URL` (plus a connection pooler) |
| Files on local disk | S3 with presigned uploads | A new `FileStore` in `apps/api/src/lib/files.ts`. Uploads are capped at 4 MB to stay under Lambda's request limit until then. |
| Messages logged | WhatsApp Cloud API, SES | A sender in `apps/api/src/functions/engagement/service.ts` (`logOutbound`) |
| Tracking page check | One-time code by WhatsApp/SMS | Swap the phone match in `apps/api/src/functions/public/tracking.ts`; set `TRACK_SECRET`; throttle `/public/track/lookup` in API Gateway or WAF (the in-memory limit is per Lambda instance) |
| One shared demo sign-in (cookie) | Real accounts (e.g. Cognito) | Replace `apps/api/src/lib/current-user.ts` and the `session` function |
| One agency | Multi-tenant | Add `tenant_id` and row-level security. This is the largest change. |

## Earlier production design

The repository also holds the original, fuller design: multi-tenant with row-level security, Cognito, an event outbox with EventBridge/SQS, and per-role permissions. It lives in `apps/api/src/modules`, `apps/api/src/shared`, `db/migrations`, `infra/` and `docs/`, and is kept for reference. It is not compiled or run. The `tsconfig.json` files list exactly what the prototype builds.
