# ADR-009: Extraction-ready module standard

- **Status:** Proposed
- **Date:** 2026-11-10
- **Deciders:** Tech lead, architect
- **Related:** ADR-002; [doc 03](../mvp/03-module-standard.md); [doc 01 A-1…A-6](../mvp/01-current-state-assessment.md#31-architecture-and-boundaries)

## Context
ADR-002 chose a modular monolith on Lambda so that modules "can be split out later". In the prototype the module boundary is not yet real: routes hold business logic and SQL, modules read and write each other's tables, and cross-module calls share a database transaction (`workflow` → `finance.recordDisbursements(tx)`, `fieldops` writing `workflow.stage_instance`). Splitting any module today would mean rewriting it.

## Decision
1. Every module is hexagonal: `domain/` (pure), `application/` (one handler per command/query, policies, ports), `adapters/` (http, persistence, events, outbound), `api/` (Module API + published events), `module.ts` (factory).
2. Modules interact only through another module's `api/` (via a client port bound in a composition root) or its published events.
3. A module's tables are private to its persistence adapter.
4. Module API DTOs are serializable Zod schemas; calls carry a principal and request id, never a transaction.
5. **Consistency groups** are the only place a transaction may span modules. MVP: Clearance + Workflow ("Operations core"), through `api/group.ts`.
6. Rules are enforced by dependency-cruiser (B-1…B-8) in CI, with a shrinking baseline of existing violations.

## Consequences
- Moving a module to its own service (Level 2) becomes: add internal routes, add a remote client, swap bindings, move the schema. No domain or application change.
- More files per feature; the Customer module is built first as a copyable template.
- Cross-module reads cost a function call now and a network call after extraction, so Module APIs must be coarse-grained.
- Insight must be fed by events with enough payload, not by joins.

## Alternatives considered
- **Keep facades taking `tx`** — simplest, but blocks extraction permanently.
- **Microservices now** (one service and database per module) — operational cost and latency the pilot does not need; contradicts ADR-002.
- **Lambda per endpoint** — rejected in ADR-002 (cold starts, sprawl).
