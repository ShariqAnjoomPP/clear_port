# Architecture decision records

One file per decision, numbered, never renumbered. To change a decision, write a new ADR that **supersedes** the old one and update both statuses. Use [template.md](template.md).

Statuses: `Proposed` → `Accepted` → (`Superseded by ADR-NNN` | `Deprecated`).

## From the Solution Architecture v0.1 (12 Oct 2026)

These are recorded in [ClearPort_Solution_Architecture_v0.1.pdf](../ClearPort_Solution_Architecture_v0.1.pdf) §16 and are not duplicated here. They remain in force unless a later ADR below says otherwise.

| ADR | Decision | Status |
|---|---|---|
| ADR-001 | PWA, not native apps | Proposed |
| ADR-002 | Modular monolith on Lambda, one function per bounded context | Proposed; refined by ADR-009 |
| ADR-003 | TypeScript end to end (Hono, Drizzle, Zod) | Proposed |
| ADR-004 | PostgreSQL with RLS; Neon for prototype, Aurora Serverless v2 in region if residency requires | Proposed; needs residency answer (D-1); access path in ADR-015 |
| ADR-005 | Cognito with the token-handler pattern; no tokens in browser storage | Proposed; refined by ADR-010 |
| ADR-006 | Transactional outbox + EventBridge + SQS for all side effects | Proposed; refined by ADR-011, ADR-014 |
| ADR-007 | Document AI behind a port | Proposed (P2) |
| ADR-008 | Workflow stages as versioned configuration | Proposed; hard-coded keys removed per doc 08 §4 |

## MVP decisions

| ADR | Decision | Status |
|---|---|---|
| [ADR-009](ADR-009-extraction-ready-modules.md) | Extraction-ready module standard: Module API, client ports, consistency groups | Proposed |
| [ADR-010](ADR-010-authorisation-from-database.md) | Cognito authenticates, ClearPort authorises: principal resolved from the database; two user pools | Proposed |
| [ADR-011](ADR-011-no-polling.md) | No polling: one-off Scheduler timers and event-driven notifications | Proposed |
| [ADR-012](ADR-012-prototype-paths-are-v1.md) | The prototype's API paths are the published v1 contract | Proposed |
| [ADR-013](ADR-013-command-relay.md) | Command relay for writes across consistency groups | Proposed |
| [ADR-014](ADR-014-event-envelope-v1.md) | Event envelope v1 and versioning rules | Proposed |
| [ADR-015](ADR-015-database-access-port.md) | Database access behind the unit-of-work port; Data API or pg per environment | Proposed; pending spike DB-1 |
