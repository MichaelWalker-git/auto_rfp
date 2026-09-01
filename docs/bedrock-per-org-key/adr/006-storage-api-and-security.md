# ADR-006 — Storage, API surface, and security

**Status:** Accepted (2026-08-31)

## Context

The Bedrock config needs more than the generic `{source, orgId, apiKey}` the existing unified
integration handler stores: it also carries a non-secret **fallback model ID** and the save-time probe
result. The existing GET handlers return the stored key in **plaintext** (the UI just never renders it),
which is undesirable for a live BYO credential.

## Decision

- **Secret** (the Bedrock key) → **AWS Secrets Manager**, secret name `bedrock-api-key-<orgId>`, reusing
  `storeApiKey`/`getApiKey` from `api-key-storage.ts`.
- **Non-secret config** (fallbackModelId, last-probe result, timestamps) → a **DynamoDB entity** defined
  in `packages/core` following the 5-type schema pattern.
- **Dedicated Bedrock set/get handlers** (not the `search-opportunities` unified handler — Bedrock is not
  a search-opportunity source and needs Bedrock-specific fields).
- **GET returns status only**: `{ configured, fallbackModelId, lastProbe }` — **never the key**. The
  existing UI only reads a `configured` boolean, so nothing breaks and the secret never leaves Secrets
  Manager over the network.
- **RBAC**: `org:manage_settings` to save, `org:read` to read — matching the newest unified integrations.
- **UI**: a new `BedrockApiKeyConfiguration` card in `OrganizationIntegrations.tsx`, reusing the shared
  `<ApiKeyConfiguration>` style plus one extra **free-text fallback-model** field (validated by the save
  probe).
- **Delete**: clearing a key also clears the DynamoDB config; that org's AI then re-blocks.

## Consequences

- Clean separation of secret vs queryable config; room for Bedrock-specific fields.
- Deviates (for the better) from the sibling integrations by not returning the secret.
- **IAM**: every Bedrock-invoking Lambda (including step-function/SQS workers, which today have only SSM
  read for the shared param) needs `secretsmanager:GetSecretValue` on `bedrock-api-key-*`; the old SSM
  grants are removed.

## Alternatives rejected

- **Extend the unified `{source,orgId,apiKey}` handler with a BEDROCK source** — fastest reuse, but the
  bare-key shape needs bolt-on fields for the fallback/probe, and "Bedrock" as a search-opportunity
  source is semantically wrong.
- **One Secrets Manager JSON blob** (`{apiKey, fallbackModelId, region}`) — fewest moving parts, but
  mixes secret and non-secret data, isn't queryable without decrypting, and diverges from the
  plain-string secret convention.
- **Return the key in GET (match existing pattern)** — consistency at the cost of exposing a live
  credential in API responses/logs.
