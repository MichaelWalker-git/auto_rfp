# ADR-002 — No shared fallback; hard block on deploy; retire the shared key

**Status:** Accepted (2026-08-31)

## Context

Unlike the other integrations (an unconfigured SAM.gov key just disables *that* feature), Bedrock
powers nearly all core functionality: answer generation, executive briefs, every compliance-review
check, question extraction, document generation, and embeddings/RAG. The question is what happens for
an org that has not configured its own key — fall back to the shared key, or deny AI.

## Decision

- **No shared fallback.** An org with no configured (and valid) key has AI **blocked** entirely, with a
  clear "AI not configured" error surfaced on every AI surface.
- **Hard block on deploy.** The block takes effect the moment the feature ships — no grace period, no
  per-org opt-in flag. Configuration is coordinated with customers around the deploy.
- The shared SSM key `/auto-rfp/bedrock/api-key` is **retired**; there is no dual code path.

## Consequences

- This is a coordinated **migration**, not a drop-in toggle: every existing org is dark until it
  configures a valid key. Acceptable only because the org count is small and configuration is
  coordinated at deploy time.
- Simplifies the runtime: a single resolution path (per-org key or error), no fallback branching.
- Requires a clear, consistent "AI not configured" UX across all AI entry points (sync handlers and
  async pipelines alike).
- The old shared-key IAM grants (SSM `GetParameter` on the Bedrock param) are removed; workers gain
  Secrets Manager access instead (see [ADR-006](./006-storage-api-and-security.md)).

## Alternatives rejected

- **Fall back to the shared key** — non-breaking and opt-in, but keeps operator billing/entitlements in
  play indefinitely and prevents retiring the shared key; contradicts the clean BYO model in ADR-001.
- **Grace period behind a kill-switch** / **block per-org as each opts in** — safer rollout, but adds
  transitional fallback code and defers the clean single-path end state; not wanted given the small,
  coordinated org set.
