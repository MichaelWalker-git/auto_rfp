# Per-Org Bedrock API Key — Architecture Decision Records

Making the Bedrock API key **configurable per organization** (bring-your-own key), replacing the
single shared key used by every org today.

These ADRs were produced in a grilling/design session on 2026-08-31 (branch
`feat/bedrock-api-configuration`). They record **decisions and rationale**, not implementation steps.
See [`GLOSSARY.md`](./GLOSSARY.md) for terms.

## Context snapshot (as-is, before this work)

- All Bedrock calls funnel through `apps/functions/src/helpers/bedrock-http-client.ts` →
  `invokeModel(modelId, body)` (no `orgId`).
- The key is a single Bedrock **Bearer API key** in SSM SecureString `/auto-rfp/bedrock/api-key`,
  module-cached in one process-wide `cachedApiKey` string. One key for the whole deployment.
- Model IDs are pinned per-Lambda via CDK env: `us.anthropic.claude-opus-4-6-v1` (default),
  `claude-haiku-4-5` (chat), `claude-sonnet-4-6` (workers), `amazon.titan-embed-text-v2` (embeddings).
  Region hard-fixed at `us-east-1`.
- `invokeModel` is called from ~30 helpers/handlers **and** from step-function tasks
  (answer-generation, question-pipeline, document-pipeline) and SQS workers that run outside request context.
- Existing per-org integration keys (SAM.gov, DIBBS, HigherGov, Google, Linear) use a reusable pattern:
  secret in **Secrets Manager** (`${prefix}-api-key-${orgId}` via `storeApiKey`/`getApiKey`), unified
  set/get handlers, and a shared `<ApiKeyConfiguration>` card in `OrganizationIntegrations.tsx`.

## Decision index

| ADR | Decision |
|-----|----------|
| [001](./001-byo-customer-key.md) | Per-org key = customer's **own** Bedrock key (BYO) |
| [002](./002-hard-block-no-shared-fallback.md) | **No shared fallback**; hard block on deploy; retire the shared key |
| [003](./003-model-access-and-fallback.md) | Keep pinned model IDs + fixed us-east-1; **titan required**, per-org **text fallback** model |
| [004](./004-detection-probe-and-retry.md) | Detect missing models by **probe-at-save + retry-at-invoke** |
| [005](./005-orgid-propagation.md) | Propagate org identity via an **explicit required `orgId`** on `invokeModel` |
| [006](./006-storage-api-and-security.md) | Secret → Secrets Manager, config → DynamoDB; dedicated handlers; **status-only GET**; RBAC |
| [007](./007-caching-and-rotation.md) | Per-org cache with **short TTL + evict-on-auth-failure** |

## Known implementation risks (carried forward, not decided here)

1. **orgId threading through async pipelines** is the primary risk — each step-function/SQS Bedrock
   step must actually carry `orgId` to the invoke; any that don't need payload plumbing.
2. **IAM** — worker Lambdas currently have only SSM read for the Bedrock param; they need
   `secretsmanager:GetSecretValue` on `bedrock-api-key-*`, and the old SSM grants are removed.
3. **Delete** a key ⇒ also clear the DynamoDB config; that org's AI goes dark again.
