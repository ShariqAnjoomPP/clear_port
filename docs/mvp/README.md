# ClearPort MVP — Architecture and Delivery Baseline

**Status:** Draft v0.1 for review · **Date:** 10 Nov 2026 · **Supersedes:** nothing; extends the Solution Architecture v0.1 (12 Oct 2026)
**Owners:** Tech lead (architecture), Product owner (functional scope)

This folder is the **source of truth** for turning the ClearPort prototype into the MVP (BRD phase P1). It sits between the two signed-off inputs and the code:

```
docs/Customs_Clearance_BRD_v0.1.pdf            what the business needs (requirement IDs)
docs/ClearPort_Solution_Architecture_v0.1.pdf  the target design (ADR-001…008)
docs/mvp/  (this folder)                       how we get from the prototype to that design, and the rules we code by
docs/adr/                                      every architecture decision, one file each
```

Where this folder and the Solution Architecture disagree, **this folder wins** and the conflict is recorded as an ADR.

## Documents

| # | Document | Read it when you… |
|---|---|---|
| 01 | [Current-state assessment](01-current-state-assessment.md) | want to know what the prototype got right, and what must change, with file references |
| 02 | [Target architecture](02-target-architecture.md) | need the big picture: runtime units, request and event paths, deployment |
| 03 | [Module standard](03-module-standard.md) | write or refactor backend code. **This is the coding pattern.** |
| 04 | [Identity and access](04-identity-and-access.md) | touch login, tokens, roles, permissions, scoping or link tokens |
| 05 | [Data architecture](05-data-architecture.md) | add a table, a migration, a query across modules, or a read model |
| 06 | [Events, async work and timers](06-events-and-async.md) | publish or consume an event, add a timer, or call an external provider |
| 07 | [Quality, performance, security and operations](07-quality-and-operations.md) | set up CI, tests, observability, or check an NFR |
| 08 | [MVP functional scope](08-functional-scope.md) | plan or accept a functional change |
| 09 | [Roadmap and migration plan](09-roadmap.md) | plan sprints or check what comes next |
| — | [ADR index](../adr/README.md) | look up why a decision was made |

## The five rules everything else follows

1. **No behaviour change by accident.** The prototype's API paths, response shapes and workflow behaviour are the contract. Refactors must pass the characterisation suite unchanged (doc 07 §2). Intended changes go through doc 08 and are released behind a tenant flag or a new workflow version.
2. **Modules talk through their public API or through events, never through each other's tables.** This is what makes a module extractable into its own serverless API later (doc 03).
3. **Cognito authenticates; ClearPort authorises.** Identity comes from a verified token. Roles, scopes and tenant come from our database, resolved on every request (doc 04).
4. **Nothing polls.** Timers are one-off schedules; side effects are events. The database must be able to scale to zero overnight (doc 06).
5. **Every decision has an ADR.** If you change a rule here, add or supersede an ADR in the same pull request.

## How to change these documents

- Changes go through a pull request like code, with one approving review from the tech lead.
- Items marked **[Confirm]** are open questions. Each one has an owner in [09-roadmap.md §6](09-roadmap.md#6-open-decisions).
- Keep requirement IDs from the BRD (`JOB-001`, `NFR-005`…) and quality scenarios from the Solution Architecture (`QA-1`…) so everything stays traceable.
