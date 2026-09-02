# ADR-001 — Per-org Bedrock key is the customer's own key (BYO)

**Status:** Accepted (2026-08-31)

## Context

Today one shared Bedrock Bearer key serves every org. The request is to make it "configurable per org,
same UI as other configurable API keys." The other configurable keys (SAM.gov, DIBBS, HigherGov, Google,
Linear) are all **customer-supplied credentials to external services** — implying the same shape here.

A Bedrock Bearer key is scoped to one AWS account and can only invoke models enabled in that account.
So "per-org key" can mean either (a) the customer brings their own key from their own AWS account, or
(b) the operator manages several keys within the *same* account for isolation.

## Decision

The per-org key is the **customer's own** Bedrock key (BYO) — their AWS account, their model
entitlements, their billing, their data path.

## Consequences

- Model access becomes account-dependent: the customer must have the required models enabled, which
  forces the model-access decisions in [ADR-003](./003-model-access-and-fallback.md).
- Billing and Bedrock data governance shift to the customer.
- A wrong or unentitled key fails hard (`ResourceNotFoundException`/`AccessDenied`) rather than
  degrading — consistent with the model-id-pinning lessons already recorded for this repo.
- Cross-tenant correctness becomes safety-critical (org A must never invoke on org B's key), driving
  [ADR-005](./005-orgid-propagation.md).

## Alternatives rejected

- **Operator-managed, same account** — keys interchangeable in what they can invoke, model IDs stay
  global. Simpler, but does not match the "customer supplies their credential" intent of the sibling
  integrations and provides no real tenant billing/entitlement separation.
- **Hybrid (some BYO, some shared)** — deferred; superseded by the no-fallback decision in ADR-002.
