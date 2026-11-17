# ADR-015: Database access behind the unit-of-work port

- **Status:** Proposed — pending spike DB-1 and decision D-1
- **Date:** 2026-11-10
- **Deciders:** Tech lead, client sponsor (residency)
- **Related:** ADR-004; NFR-003, QA-3; [doc 05 §5](../mvp/05-data-architecture.md#5-connections-and-the-database-adapter)

## Context
ADR-004 leaves the production database open (Neon vs Aurora Serverless v2 in region). If Aurora, Lambdas outside a VPC cannot use a normal connection without a public endpoint; inside a VPC they need interface endpoints and possibly RDS Proxy, which add fixed monthly cost. The prototype uses `pg` with a pool of 5 per instance.

## Decision
All SQL runs through the unit-of-work runner port (doc 03 §3.4) with two adapters: `pg` (Neon, local, or Aurora in VPC) and **RDS Data API** (Aurora without VPC). Default for production on Aurora is the Data API, accepted if the transition endpoint's p95 server time stays under 300 ms in spike DB-1; otherwise Lambdas in VPC with RDS Proxy. Public database endpoints are not allowed. `pg` pools use `max: 1`; reserved concurrency caps total connections.

## Consequences
- The residency decision does not change application code.
- Statement count per request matters with the Data API, so principal resolution, tenant context and idempotency are folded into the transaction.
- Two adapters to test; the persistence suite runs against both in CI on a schedule.

## Alternatives considered
- **Aurora public endpoint + TLS** — rejected: internet-exposed database.
- **VPC + RDS Proxy from day one** — highest fixed cost; kept as the fallback.
- **DynamoDB** — rejected in ADR-004 (relational reporting).
