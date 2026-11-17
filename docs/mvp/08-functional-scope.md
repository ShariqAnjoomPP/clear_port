# 08 · MVP functional scope

The MVP is BRD phase **P1**: replace spreadsheets and WhatsApp for the client's core flow, with the exit gate "every new BL runs in the system for 4 consecutive weeks; under 5% of updates made outside it" (BRD §6).

## 1. How functional changes are introduced without breaking current behaviour

Every functional change uses one or more of these mechanisms. The PR description names which.

| Mechanism | Use it for | Why it is safe |
|---|---|---|
| **New workflow version** | Anything that changes stages, statuses, gates, required fields or stage actions | Running jobs keep the version they started with (`job.workflow_version`); only new BLs get the new flow |
| **Tenant feature flag** (doc 07 §7) | New screens, new notifications, new rules that are not workflow | Pilot tenant first; instant off switch |
| **Additive API change** | New fields, new endpoints | Old clients ignore new fields; OpenAPI diff in CI blocks breaking changes |
| **Expand/contract migration** (doc 05 §4) | New columns or tables, renamed data | Old and new code both work during the canary |
| **Characterisation snapshot update** (doc 07 §2.1) | Any intended behaviour change | Only the snapshots tied to the requirement may change, and the PR lists them |

**Change intake.** Each change gets an ID `FC-NNN`, filled into §3 before it is planned:

| Field | Content |
|---|---|
| ID / title | `FC-012` Held container raises an exception task |
| Source | BRD ID, client walkthrough, pilot feedback, or the team's identified change list |
| Current behaviour | What the prototype does today (link to the characterisation scenario) |
| New behaviour | Given / when / then acceptance criteria |
| Mechanism | From the table above |
| Modules touched | e.g. Workflow (command, event), Engagement (notification), PWA field shell |
| Events / API changes | New or changed events (doc 06 §2) and endpoints |
| Data changes | Migration name, expand/contract steps |
| Permissions | New permissions or scope rules (doc 04 §5) |
| Rollout | Flag name, tenants, removal date |

## 2. BRD P1 coverage in the prototype

Status comes from a code review of commit `eed84df`; **confirm each line in the Sprint 0 walkthrough** with the product owner. ✅ done · 🟡 partial · ❌ missing.

| ID | Requirement (short) | Pri | Status | MVP work | Module |
|---|---|---|---|---|---|
| CUS-001/002 | Customers, contacts, channel and language | M | ✅ | Add WhatsApp opt-in per contact | Customer |
| JOB-001/003/005 | BL intake, duplicate blocks, job no., coordinator, priority | M | ✅ | Add branch on intake (ADM-001) | Clearance |
| JOB-002 | Container list: bulk paste, CSV import, ISO 6346 | M | 🟡 paste works; no CSV file import | CSV/XLSX import with row-level errors | Clearance, PWA |
| JOB-004 | Upload documents + completeness checklist per commodity | M | 🟡 upload works; only the BL is required to verify | `document_requirement` per tenant/commodity; checklist gates `DOCUMENTS → VERIFIED` (workflow v2) | Clearance, Workflow |
| BAY-001…004 | PRO assignment, Bayan statuses, amounts with receipt, customer confirmation | M | ✅ | Disbursement relay (doc 03 §5) | Workflow, Finance |
| DO-001…003 | DO in parallel; statuses; DO no., charges, validity, copy | M | ✅ (`validUntil` captured) | — | Workflow |
| DO-004 | Alert before DO validity expires with undelivered containers | S | ❌ | Scheduler timers (doc 06 §5) | Workflow, Engagement |
| INS-001…003 | Inspection result, selected containers, fees | M | ✅ | — | Workflow |
| CCR-001…003 | CCRO gate with reasons; record CCRO; notify on issue | M | ✅ | — | Workflow, Engagement |
| TRK-001/002 | Per-container truck assignment, several at once | M | ✅ | Command relay instead of direct stage writes (A-10); trip counter (A-11) | FieldOps |
| TRK-003 | Drivers, vehicles, transporters; licence and registration expiry | M | 🟡 expiry blocks assignment; no transporter entity, no expiry alert | Transporter master data; expiry timers | FieldOps |
| TRK-004 | Driver trip link | S | ✅ | Narrow link principal (doc 04 §6) | FieldOps |
| PHY-001 | Inspection result per container from mobile | M | ✅ (Passed / Held; no Partial) | Add `PARTIAL` status **[Confirm]** (workflow v2) | Workflow |
| PHY-002 | Photos/videos with timestamp and geotag | S | 🟡 photos as documents; no geotag | `evidence` metadata, camera capture with location permission | FieldOps, PWA |
| PHY-003 | Held container raises an exception task; rest of BL continues | M | ❌ `HELD` exists, nothing happens | `exception_task` (reason, owner, due date), `ContainerHeld` event, appears in My tasks | Workflow |
| REL-001 | Release / gate-out with time and reference | M | ✅ | — | Workflow |
| DEL-001, 004, 005 | Delivery details; auto-close with blockers; manager reopen | M | ✅ | Closure rule from catalogue, not hard-coded keys (§4) | Clearance, Workflow |
| DEL-002 | e-POD: signature + photo; PDF shared with customer | S | 🟡 signature captured; no PDF | POD PDF worker (doc 06 §6) | FieldOps, Engagement |
| FIN-001 | Ledger of every amount paid per BL | M | ✅ | — | Finance |
| FIN-002 | PRO float and settlement | S | ✅ | — | Finance |
| OPS-001…003, 005, 006 | Kanban, container board, timeline, My tasks, global search | M | ✅ | Search projection + indexes (doc 05 §6); branch scope on lists | Insight |
| OPS-004 | SLA timers, amber then red | S | 🟡 breach by polling; no amber warning | Scheduler SLA + warning timers | Workflow, Insight |
| NTF-001 | In-app and email: assignments, gate unlocks, SLA breaches, **mentions** | M | 🟡 no mentions; no gate-unlock notice | `@mentions` in comments; `GateSatisfied` notification | Engagement, Clearance |
| NTF-002 | WhatsApp milestones to customers | S | 🟡 free-form text only | Approved EN/AR templates; opt-in (doc 06 §4) | Engagement |
| DOC-001 | Documents per BL/container, type, **version history**, preview | M | 🟡 versions stored; history not shown | Version history panel | Clearance, PWA |
| DOC-002 | Mobile camera capture with auto-crop, saved as PDF | S | ❌ compression only | Camera capture → edge crop → PDF on device **[Confirm library]** | PWA |
| DOC-003 | Internal vs customer-visible | M | ✅ | — | Clearance |
| ADM-001 | Roles and permissions per stage and action; **branch/port scoping** | M | 🟡 fixed roles; no scoping | Roles as data, custom roles, scopes (doc 04 §5) | Platform |
| ADM-002 | Configure stage catalogue: stages, statuses, gates, required fields, SLAs | S | 🟡 SLA hours only | Guided editor for labels, SLAs, required fields, gates; validation before publish (§4) | Platform, Workflow |
| ADM-003 | Master data | M | ✅ | Add transporters, branches | Platform |
| ADM-004 | Immutable audit of every change | M | ✅ | Login and permission-change events; audit viewer for owners | Platform |
| ADM-006 | Bilingual UI with RTL; multi-currency | M | 🟡 EN/AR + RTL done; amounts carry currency; no FX to base currency | Base-currency reporting with recorded rate per disbursement **[Confirm need for P1]** | Finance, PWA |
| NFR-002 | Hashed passwords, 2FA for owner/accounts, session timeout | M | ❌ dev login | Doc 04 §3 | Auth |
| NFR-006 | Backups, 99.5% | M | ❌ no infra | Doc 05 §9, doc 02 §7 | Infra |
| NFR-011 | Logging, error tracking, uptime alerts, per-tenant usage | M | ❌ | Doc 07 §5 | All |
| — | Web Push for field users (SAD §9) | S | ❌ | VAPID push as a notification channel | Engagement, PWA |

## 3. Additional functional changes (team's list)

The team has identified further changes beyond the BRD. They are recorded here, one row per change, using the intake fields in §1. **This table is to be filled in from the team's list at the Sprint 0 scope workshop**; nothing is planned until a row exists.

| ID | Title | Source | Mechanism | Modules | Priority | Sprint |
|---|---|---|---|---|---|---|
| FC-001 | *(to be added)* | | | | | |

## 4. Workflow catalogue v2 (removes hard-coded stage keys)

ADR-008 says the flow is configuration, but code still names stages (A-7). Catalogue v2 adds **semantic markers** so code refers to *what a stage means*, not its key:

```ts
interface StageDef {
  // … existing fields …
  marker?: 'DOCUMENTS' | 'RELEASE_ORDER' | 'TRUCK' | 'PHYSICAL_INSPECTION' | 'GATE_OUT' | 'DELIVERY';
  permissionRoles?: string[];          // replaces the PRO/INSPECTOR/DRIVER stage lists in the kernel
  statuses: (StatusDef & { exception?: boolean })[];   // e.g. HELD → raises an exception task
}
interface WorkflowDefinition {
  version: number;
  stages: StageDef[];
  closure: { jobMarkersDone: string[]; containerMarkersDone: string[]; requireReconciledPayments: boolean };
  phases: { key: string; label: I18nText; when: Guard }[];   // board columns, replaces deriveJobPhase's hard-coded rules
}
```

| Code today | Becomes |
|---|---|
| `closeJob`: `stageKey === 'CCRO'`, `'DELIVERY'` | `closure` block in the catalogue |
| `deriveJobPhase`: `DOCUMENTS`, `DO_RECEIVED`, `CLEARED`… | `phases[].when` guards (same Specification engine) |
| `scanFreeTime`: `'RELEASE'` / `'GATED_OUT'` | stage with `marker: 'GATE_OUT'` reaching a done status |
| `fieldops`: `DRIVER_STAGES`, `'TRUCK'` | stages with `marker: 'TRUCK' \| 'GATE_OUT' \| 'DELIVERY'` |
| Kernel `PRO: ['stage.BAYAN.update', …]` | `permissionRoles` on each stage |

**v2 publication rule:** the default v2 catalogue is behaviourally identical to v1 for everything v1 does (proven by running the characterisation suite against a job created on v2), plus the new P1 items: document checklist gate, `PARTIAL` inspection result **[Confirm]**, exception status markers. Existing jobs stay on v1.

**ADM-002 editor guardrails:** a tenant may edit labels, SLA targets, required fields and add guards, but the editor validates before publishing: every marker the closure and phases need is present, every guard references existing stages and statuses, no status is unreachable, and the engine's unit tests run against the draft in the browser (`packages/workflow` is already shared with the PWA).

## 5. Prototype features beyond P1

The prototype shows several P2 features in working form. They stay, so stakeholders lose nothing, but behind flags so the MVP's support scope is clear:

| Feature | BRD | MVP position | Flag |
|---|---|---|---|
| Invoices from tariff + billable disbursements | FIN-003 (P2) | Kept, pilot tenant only | `finance.invoicing` |
| Receivables and ageing | FIN-004 (P2) | Kept, pilot tenant only | `finance.receivables` |
| Customer portal | CXP-001 (P2) | Kept; gets real customer sign-in (doc 04 §3) | `portal` |
| One-tap customer approval | BAY-005 (P2) | Kept | `approvals.link` |
| Profitability and team reports | FIN-005 (P2), reports | Kept | `reports.advanced` |
| Free-time alerts | §9 basic alert is P1 | P1, moved to timers | — |

## 6. Out of MVP scope

Document AI and email-in intake (JOB-006/007), tariff and quotation engine (CUS-003, FIN-007), accounting connectors (FIN-006 beyond CSV), GPS tracking (TRK-006), tenant self-onboarding and subscriptions (ADM-005), customer self-service requests (CXP-002), WhatsApp chatbot (CXP-003), all P3 integrations. Each already has a port or module in the architecture (SAD §5), so adding them later does not change the MVP's structure.
