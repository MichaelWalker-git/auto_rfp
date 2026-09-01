# ADR-003 — Pinned models + fixed region; titan required; per-org text fallback

**Status:** Accepted (2026-08-31)

## Context

A BYO key can only invoke models enabled in the customer's account. The app pins model IDs per role
(opus-4-6 default, haiku-4-5 chat, sonnet-4-6 workers, titan-embed-text-v2 embeddings) and uses US
cross-region inference profile IDs (`us.anthropic.*`) that only resolve in US regions, with the client
hard-fixed to `us-east-1`. If a customer hasn't enabled a required model, `invokeModel` fails hard.

## Decision

- **Keep the pinned model IDs and region (`us-east-1`) global.** BYO onboarding requires the customer to
  have those models enabled in us-east-1. Region is **not** per-org configurable in v1; non-US-region
  customers are explicitly out of scope.
- **Embeddings (`titan-embed-text-v2`) are hard-required with no fallback.** If unavailable on the
  customer's key, the key is **rejected** — RAG cannot function, and substituting a different embedding
  model would produce different-dimension vectors that could corrupt the existing index.
- **Text roles get a single per-org fallback model.** Each org may configure one free-text Bedrock model
  ID, used only when a pinned *text* model (opus/haiku/sonnet) is unavailable on their key.

## Consequences

- Onboarding has a hard requirement: titan-embed enabled, plus either all text models enabled or a
  working fallback (see acceptance rule in [ADR-004](./004-detection-probe-and-retry.md)).
- Region and the `us.*` inference-profile IDs stay coupled and simple; no per-org model-ID matrix in v1.
- One fallback model covers all text roles, so a fallback that replaces opus for a heavy task may be a
  weaker model — accepted as the v1 trade-off for config simplicity.

## Alternatives rejected

- **Full per-org model-ID overrides** (per role) — robust for heterogeneous entitlements but expands
  scope significantly: the UI grows and every call site's role→model mapping becomes org-aware.
- **Separate configurable embedding fallback** — flexibility at the cost of vector-dimension-mismatch
  risk against the existing index.
- **Embeddings on the shared platform key** — guarantees RAG never breaks, but routes customer document
  text through the operator's account (data-governance wrinkle) and keeps operator paying for it;
  inconsistent with BYO.
- **Per-org region** — forces per-org/region-derived model-ID mapping because `us.*` profiles don't work
  outside US regions.
