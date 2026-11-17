# ADR-011: No polling — one-off timers and event-driven side effects

- **Status:** Proposed
- **Date:** 2026-11-10
- **Deciders:** Tech lead
- **Related:** ADR-006; QA-4; OPS-004, DO-004; [doc 06](../mvp/06-events-and-async.md)

## Context
The prototype runs four interval jobs: outbox relay (30 s), notification dispatcher (30 s), SLA scan (60 s), free-time scan (1 h), each over every tenant. On serverless Postgres these keep the database awake permanently, cancelling the scale-to-zero saving that motivated the design (QA-4). The SLA scan also keeps its window in memory, so cold starts miss or double-fire breaches.

## Decision
1. Timers are **one-off EventBridge Scheduler schedules** created by a consumer when a due date is set, targeting an SQS queue. They are **stale-tolerant**: never cancelled; on firing, the handler re-checks current state and does nothing if no longer due. Names are deterministic for idempotent creation; a `workflow.timer` table is the registry.
2. Notifications are sent by a consumer of `NotificationQueued`, not by a dispatcher loop. The sender's reserved concurrency matches provider rate limits.
3. The outbox keeps its fast path; failures signal a relay through SQS; the scheduled relay runs every minute in business hours and hourly otherwise.

## Consequences
- The database can auto-pause outside business hours.
- Breaches and alerts fire once, at the right time, regardless of Lambda lifecycle.
- New infrastructure: a Scheduler group and role, more queues. Local development uses an in-process timer adapter.

## Alternatives considered
- **Keep scans, run them less often** — still wakes the database; coarse timing.
- **Postgres `pg_cron`** — not available on all options under ADR-004; keeps the database awake.
- **DynamoDB TTL as a timer** — imprecise (up to 48 h delay), adds a data store.
