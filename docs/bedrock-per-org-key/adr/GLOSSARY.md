# Glossary — Per-Org Bedrock API Key

**Bedrock API key (Bearer key)** — A long-lived Amazon Bedrock API key sent as an
`Authorization: Bearer <key>` header to `bedrock-runtime.us-east-1.amazonaws.com`. It is scoped to
one AWS account and can only invoke models **enabled in that account/region**. Distinct from SigV4/IAM
credentials; `bedrock-http-client.ts` uses the Bearer key, not the caller's IAM role.

**BYO (bring-your-own) key** — The chosen model here: each organization supplies a Bedrock key from
**their own** AWS account. Their entitlements, their billing, their data path.

**Shared key** — The single deployment-wide key in SSM `/auto-rfp/bedrock/api-key` used by all orgs
today. Retired by [ADR-002](./002-hard-block-no-shared-fallback.md).

**Hard block** — With no shared fallback, an org that has not configured a valid key gets AI
**disabled** entirely (a clear "AI not configured" error on every AI surface), rather than silently
falling back to an operator key.

**Pinned model IDs** — The fixed Bedrock model identifiers the app requests per role: opus-4-6
(default/strong), haiku-4-5 (chat), sonnet-4-6 (async workers), titan-embed-text-v2 (embeddings).
Remain global; the customer's key must have them enabled. See
[ADR-003](./003-model-access-and-fallback.md).

**Text roles** — Any Bedrock call that generates/analyzes text (opus/haiku/sonnet usages). Eligible
for the fallback model. Contrast with **embeddings**.

**Embeddings** — Vector generation via `titan-embed-text-v2`, powering RAG/search. **Hard-required**
with **no fallback** — a different embedding model would produce different-dimension vectors and could
corrupt the existing index.

**Fallback model** — A single per-org, free-text Bedrock model ID used **only** when a pinned *text*
model is not available on the customer's key. Validated by the save-time probe.

**Probe (save-time)** — A tiny test invoke of each required model (+ the fallback if supplied) when a
key is saved, to (a) give the customer immediate feedback and (b) gate acceptance. Titan missing ⇒
reject; any text model missing without a working fallback ⇒ reject.

**Retry (invoke-time)** — Runtime safety net: on `ResourceNotFoundException`/`AccessDenied` for a text
model, transparently retry once with the org's fallback model. Self-heals when entitlements change.
Does not apply to embeddings.

**Per-org key cache** — In-memory `Map<orgId, key>` in warm Lambda containers, with a short TTL and
eviction on a Bedrock `401/403` so a rotated key is picked up within minutes. Replaces the single
module-level `cachedApiKey`.

**Secret name convention** — `bedrock-api-key-<orgId>` in AWS Secrets Manager, matching the existing
`${prefix}-api-key-${orgId}` pattern used by the other integrations.
