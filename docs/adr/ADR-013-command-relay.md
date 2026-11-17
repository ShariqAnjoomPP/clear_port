# ADR-013: Command relay for writes across consistency groups

- **Status:** Proposed
- **Date:** 2026-11-10
- **Deciders:** Tech lead
- **Related:** ADR-009, ADR-006; [doc 03 §5](../mvp/03-module-standard.md#5-command-relay-cross-group-writes-without-a-shared-transaction)

## Context
Some user actions change two modules and the user sees both effects in one response: a PRO records "Duties paid" with the amounts (Workflow + Finance); a coordinator assigns a trip (FieldOps + Workflow). The prototype does this in one shared transaction, which ADR-009 forbids across groups. Pure eventual consistency would change visible behaviour.

## Decision
The caller commits its own change plus an outbox event fully describing the follow-up command, then calls the callee's Module API synchronously with an idempotency key derived from that event. The callee also subscribes to the event and runs the same command with the same key. Whichever runs second is a no-op. Applied to: Workflow → Finance (disbursements), FieldOps → Workflow (trip assign/cancel, driver-link transitions). Workflow → Engagement (approval request) becomes event-only.

## Consequences
- Happy path is identical to today; on a failure between the two steps the effect completes within seconds instead of being lost.
- Callee commands must be idempotent per key and must re-validate and re-authorise.
- The UI must tolerate a short "recording…" state in the rare failure case.

## Alternatives considered
- **Shared transaction** — blocks extraction.
- **Event only** — visible lag on screens that show both effects.
- **Saga orchestrator (Step Functions)** — cost and complexity unjustified for two-step, non-compensating flows.
