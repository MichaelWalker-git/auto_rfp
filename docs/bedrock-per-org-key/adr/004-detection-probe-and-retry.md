# ADR-004 — Detect missing models via probe-at-save + retry-at-invoke

**Status:** Accepted (2026-08-31)

## Context

Given per-org fallback for missing text models ([ADR-003](./003-model-access-and-fallback.md)), the
system must know when a pinned model is unavailable on a customer's key so it can use the fallback,
and it should give the customer clear feedback at configuration time.

## Decision

Use **both** detection mechanisms:

- **Probe at save.** When a key is saved, invoke a tiny test request against each required model
  (titan-embed + opus/haiku/sonnet) and the fallback if supplied. This gives immediate feedback and
  gates acceptance.
- **Retry at invoke.** At runtime, call the pinned model; on `ResourceNotFoundException`/`AccessDenied`
  for a **text** role, transparently retry once with the org's fallback model. A titan/embeddings
  failure is a hard error (no fallback).

**Save-time acceptance rule:**
- titan-embed **must** be invokable, else **reject**.
- If all text models are invokable → accept, no fallback needed.
- If any text model is missing → a fallback must be supplied **and** itself probe-invokable, else
  **reject** with the exact list of missing models.

## Consequences

- Availability is **not persisted** as a map: the save probe is for feedback + acceptance, and the
  invoke-time retry does the actual runtime selection. This avoids a stale availability record.
- Onboarding surfaces exactly what's missing before any real work runs.
- The retry adds one fast round-trip on the failure path; because these errors fail fast (not
  timeouts), the cost is bounded, but it recurs on every call for a permanently-missing model (mitigated
  by the customer setting a fallback).
- The save probe costs a handful of tiny invokes on the customer's key.

## Alternatives rejected

- **Probe once at save, persist an availability map, select from it at invoke** — no runtime probe, but
  the map goes stale when the customer changes entitlements and needs an explicit refresh action.
- **Invoke-time retry only** — no save-time feedback; the customer discovers gaps mid-generation.
