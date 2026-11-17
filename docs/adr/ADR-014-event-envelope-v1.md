# ADR-014: Event envelope v1 and versioning

- **Status:** Proposed
- **Date:** 2026-11-10
- **Deciders:** Tech lead
- **Related:** ADR-006; [doc 06 §1–2](../mvp/06-events-and-async.md)

## Context
Events today have `id, type, tenantId, aggregateType, aggregateId, payload, occurredAt`, a single EventBridge source `clearport`, and no schema per type. Once modules are separately deployable, producers and consumers change at different times.

## Decision
Keep every existing field and type name. Add `version`, `module`, `correlationId`, `causationId` and `actor`. EventBridge `Source` becomes `clearport.<module>`. Each event's payload has a Zod schema in the owner's `api/events.ts`. Optional additions keep the version; breaking changes publish both versions until consumers move. Payloads carry the state consumers need.

## Consequences
- Request-to-side-effect tracing via `correlationId`.
- Insight and Engagement stop reading producers' tables.
- Slightly larger events; a catalogue to maintain (doc 06 §2).

## Alternatives considered
- **EventBridge Schema Registry as source of truth** — useful for discovery later; Zod in code keeps one language and compile-time types.
- **CloudEvents envelope** — reasonable; not needed while all producers and consumers are ours. Fields map cleanly if adopted later.
