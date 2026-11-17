# ADR-010: Cognito authenticates, ClearPort authorises

- **Status:** Proposed
- **Date:** 2026-11-10
- **Deciders:** Tech lead, security reviewer, product owner
- **Related:** ADR-005; ADM-001, NFR-002, QA-1; [doc 04](../mvp/04-identity-and-access.md)

## Context
The prototype issues dev HS256 tokens carrying roles. Its Cognito path reads roles from `cognito:groups`, which are pool-wide, cannot express per-tenant roles or branch/port scope (ADM-001), and cannot be revoked faster than the token lifetime. Every request already starts a transaction that sets the tenant for RLS.

## Decision
1. Cognito proves identity only. Two user pools: **staff** (password + TOTP, mandatory for privileged roles) and **customer** (email one-time code). The token-handler pattern of ADR-005 is kept: refresh token in an `HttpOnly` cookie, access token in memory.
2. On every request, `platform.begin_request(issuer, sub)` (a `SECURITY DEFINER` function) resolves the user, tenant, role grants with scopes and `authz_version`, and sets the RLS context in the same statement.
3. Permissions stay a code catalogue; roles become tenant data (8 seeded system roles with today's grants + custom roles). Grants may carry scopes (branch, port, assignment, customer).
4. One evaluator `authorize(principal, action, resource)` is used by every module. Non-user principals (driver link, approval link, webhook, named system principals) have narrow fixed grants; `skipPermission` and the `OWNER` system actor are removed.
5. Dev login code is removed from non-dev bundles at build time.

## Consequences
- Role changes and deactivation take effect on the next request.
- No dependency on Cognito access-token customisation.
- One `SECURITY DEFINER` function becomes security-critical: it gets its own tests and review.
- One identity maps to one tenant in the MVP.

## Alternatives considered
- **Roles in token via pre-token-generation trigger** — stale for up to the token lifetime; needs a higher Cognito tier; still cannot carry rich scopes cleanly.
- **One pool with groups for staff and customers** — mixes MFA and sign-in policies; gateway cannot separate audiences.
- **Amazon Verified Permissions / Cedar now** — per-call cost and latency without a current need; our evaluator keeps a Cedar-compatible shape (principal, action, resource, context) so this stays open for P3.
- **Our own password store** — rejected in the SAD (risk).
