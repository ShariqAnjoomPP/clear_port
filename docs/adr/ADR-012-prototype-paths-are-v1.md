# ADR-012: The prototype's API paths are the published v1 contract

- **Status:** Proposed
- **Date:** 2026-11-10
- **Deciders:** Tech lead, product owner
- **Related:** SAD §8; [doc 01 A-9](../mvp/01-current-state-assessment.md); [doc 07 §3](../mvp/07-quality-and-operations.md#3-cicd-github-actions)

## Context
SAD §8 lists paths such as `/v1/jobs` and `/v1/stages/{id}/disbursements`. The prototype implements `/v1/clearance/jobs`, `/v1/workflow/jobs/{id}/stages/{sid}/transitions`, `/v1/field/trips`, `/public/trips/{token}` and so on, and the PWA, the offline outbox (queued paths in IndexedDB) and the E2E tests depend on them. The MVP must not change current behaviour.

## Decision
The prototype's paths, methods, request and response bodies are `/v1`. The OpenAPI 3.1 document is generated from `packages/contracts` and checked in CI for breaking changes. SAD §8 is superseded for paths; its conventions (RFC 9457, cursor pagination, Idempotency-Key, ETag/If-Match, money as strings) remain.

## Consequences
- No client migration; queued offline actions remain valid across the upgrade.
- Route prefixes map one-to-one to context Lambdas, which matches the runtime units in doc 02.
- Any future renaming goes into `/v2` with a Sunset header on `/v1`.

## Alternatives considered
- **Rename to SAD paths now** — breaks the PWA, queued offline actions and tests for no user benefit.
