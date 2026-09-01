# ADR-005 — Propagate org identity via an explicit required `orgId`

**Status:** Accepted (2026-08-31)

## Context

`invokeModel(modelId, body)` takes no `orgId` and is called from ~30 helpers/handlers **and** from
step-function tasks (answer-generation, question-pipeline, document-pipeline) and SQS workers that run
outside request context. With no shared fallback ([ADR-002](./002-hard-block-no-shared-fallback.md))
and per-tenant billing/data ([ADR-001](./001-byo-customer-key.md)), using the wrong org's key (org A's
call resolving org B's key) would be a billing/data incident. How org identity reaches the client is
therefore safety-critical.

## Decision

Add a **required `orgId`** parameter to `invokeModel` (and the `bedrock-tool-loop` helper). Every call
site must pass it; step-function task payloads and SQS message bodies must carry `orgId` through to the
worker that invokes Bedrock. The client resolves the per-org key from `orgId`.

## Consequences

- The TypeScript compiler forces every one of the ~30 call sites to supply `orgId` — a missing or
  ambiguous org is a **build error**, not a silent cross-tenant leak.
- Largest edit surface of the options, and the **primary implementation risk**: any async pipeline that
  doesn't already thread `orgId` to its Bedrock step needs payload plumbing (flagged in the README).
- Key resolution stays centralized in `bedrock-http-client.ts` (the secret is not passed around the
  call graph).

## Alternatives rejected

- **AsyncLocalStorage request context** — far fewer edits, but workers/step tasks aren't behind the
  request middleware and must each remember to seed the store; a forgotten seed means an error or, worse,
  a cross-tenant mixup. Implicit and hard to audit.
- **Resolve the key at each entry point and thread the key/client object down** — same edit fan-out as
  explicit `orgId`, but leaks the secret further through the call graph.
