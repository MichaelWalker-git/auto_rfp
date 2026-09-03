# Per-Org Bedrock API Key — Spec

> Branch: `feat/bedrock-api-configuration`. Decisions and rationale are recorded in the ADRs at
> `docs/adr/bedrock-per-org-key/` (ADR-001 … ADR-007) and the glossary alongside them. This spec
> translates those decisions into a buildable, testable feature description. Where a decision is
> contested, the ADR wins.

---

## Problem Statement

Today a single, operator-owned Amazon Bedrock **Bearer API key** (one SSM SecureString,
`/auto-rfp/bedrock/api-key`) powers **every** AI capability for **every** organization: answer
generation, executive briefs, all compliance-review checks, question extraction, document generation,
and embeddings/RAG. From the customer's and operator's point of view this is a problem:

- **Customers can't bring their own Bedrock account.** They can't use their own model entitlements,
  their own billing, or keep their document text inside their own AWS data path — even though every
  *other* external integration (SAM.gov, DIBBS, HigherGov, Google, Linear) is already a
  customer-supplied credential configured per org.
- **The operator carries all Bedrock billing and data-governance risk** for all tenants on one key.
- There is **no per-tenant isolation** of entitlements or spend.

The customer-facing ask is simply: *"Make the Bedrock API key configurable per organization, using the
same settings UI as the other API keys."*

## Solution

Each organization brings its **own** Bedrock Bearer key (BYO — bring-your-own), configured from the
organization settings page just like the other integration keys, with one extra field. Concretely,
from the user's perspective:

- An **org admin** opens Organization Settings → Integrations and sees a new **Bedrock** card next to
  the existing integration cards. They paste their Bedrock API key and (optionally) a single **fallback
  model ID**, and save.
- On save, the system **probes** the key against every model the app needs. The admin gets immediate,
  specific feedback: either "configured successfully" or an exact list of which required models the key
  can't invoke — and the save is **rejected** until the key is viable (see acceptance rule below).
- Once a valid key is configured, **all** AI features work for that org using that org's key, billed to
  that org's AWS account.
- If an org has **no valid key**, every AI surface shows a clear **"AI not configured"** error rather
  than silently working — there is **no shared operator fallback** anymore.
- If a customer **rotates** their key in their AWS account, the app picks up the new key within minutes
  automatically, and immediately on the first failing call.
- An admin can **remove** the key; the org's AI then goes dark again until reconfigured.

This is a **coordinated migration**, not an opt-in toggle: the shared key is retired the moment the
feature ships, so every existing org must have configured a valid key by deploy time.

---

## User Stories

**Configuration (org admin)**

1. As an org admin, I want a Bedrock card in Organization Settings → Integrations that looks and behaves
   like the other API-key cards, so that configuring Bedrock feels familiar.
2. As an org admin, I want to paste my Bedrock Bearer API key and save it, so that my organization's AI
   features run on my own AWS account.
3. As an org admin, I want to optionally enter a single free-text **fallback model ID**, so that if my
   key can't invoke one of the pinned text models the app can still generate text with a model I do have.
4. As an org admin, I want the key field masked with a show/hide toggle, so that I don't expose the
   credential on screen.
5. As an org admin, I want to see a **"Configured" / "Not Configured"** status badge for Bedrock, so that
   I know at a glance whether my org's AI is live.
6. As an org admin, I want the save to be **blocked with a specific reason** when my key can't run the
   embeddings model, so that I don't leave RAG silently broken.
7. As an org admin, I want the save to be **blocked with the exact list of missing text models** when my
   key can't run one of them and I haven't supplied a working fallback, so that I know precisely what to
   fix.
8. As an org admin, I want the save to **succeed** when all required models (or a working fallback)
   probe successfully, so that I get positive confirmation my org is ready.
9. As an org admin, I want to **update** an already-configured key and have it re-probed, so that I can
   rotate credentials through the UI.
10. As an org admin, I want to **remove** the Bedrock key, so that I can decommission the integration —
    understanding this disables my org's AI.
11. As an org admin, I want the fallback-model field to be re-validated by the probe whenever I save, so
    that I can't save a fallback that itself doesn't work.
12. As an org admin without `org:manage_settings`, I want the Configure/Update/Remove actions hidden or
    disabled, so that only authorized admins can change the credential.
13. As an org member with only `org:read`, I want to be able to *see* the Bedrock configuration status,
    so that I understand whether AI is available without being able to change it.

**Security & privacy**

14. As a security-conscious customer, I want the GET endpoint to return only **status** (configured,
    fallback model, last probe result) and **never** the key itself, so that my live credential never
    travels back over the network or lands in logs.
15. As a security-conscious customer, I want my key stored encrypted in Secrets Manager under an
    org-scoped name, so that it's isolated per tenant.
16. As the operator, I want org A's AI calls to **never** be able to invoke on org B's key, so that
    there's no cross-tenant billing or data leak.

**Using AI (any authenticated user in a configured org)**

17. As an end user, I want answer generation, executive briefs, compliance review, question extraction,
    and document generation to all work transparently on my org's key, so that nothing about my workflow
    changes once the key is set.
18. As an end user, I want embeddings/RAG (search, retrieval) to keep working on my org's key, so that
    knowledge-base features are unaffected.
19. As an end user whose org has configured a fallback, I want a call that hits a missing pinned text
    model to **transparently retry** on my fallback model, so that generation still succeeds without me
    noticing.
20. As an end user in an **unconfigured** org, I want a clear **"AI not configured"** message on every AI
    surface (sync features and async pipelines alike), so that I understand why AI isn't running and who
    to ask.
21. As an end user, I want async pipelines (answer-generation, question-pipeline, document-pipeline, SQS
    workers) to run on **my org's** key, so that background jobs are billed and isolated correctly.
22. As an end user, I want a rotated key to be picked up automatically within minutes, so that I'm not
    stuck with failures after my admin rotates the credential.

**Operator / migration**

23. As the operator, I want the shared SSM key path retired with no dual code path, so that there is a
    single, auditable key-resolution path.
24. As the operator, I want every Bedrock-invoking Lambda (including step-function tasks and SQS workers)
    to have Secrets Manager read on `bedrock-api-key-*` and the old SSM grant removed, so that IAM matches
    the new storage.
25. As the operator, I want a missing/ambiguous `orgId` at any Bedrock call site to be a **build error**,
    so that a cross-tenant mixup can't ship.

---

## Implementation Decisions

### Model & ownership (ADR-001, ADR-003)

- The per-org key is the **customer's own** Bedrock Bearer key (BYO): their AWS account, entitlements,
  billing, data path.
- **Model IDs stay pinned and global**, region stays fixed at **`us-east-1`** (the `us.anthropic.*`
  cross-region inference profiles only resolve in US regions). Region is **not** per-org configurable in
  v1; non-US-region customers are out of scope.
  - Roles: `opus-4-6` (default/strong), `haiku-4-5` (chat), `sonnet-4-6` (async workers),
    `titan-embed-text-v2` (embeddings).
- **Embeddings (`titan-embed-text-v2`) are hard-required with no fallback.** A different embedding model
  would produce different-dimension vectors and corrupt the existing index — so a key that can't invoke
  titan is **rejected**.
- **Text roles** (opus/haiku/sonnet) share **one** per-org free-text **fallback model ID**, used only
  when a pinned text model is unavailable on that key.

### No shared fallback; hard block (ADR-002)

- **No shared fallback.** An org with no valid key has AI **blocked entirely** with a consistent
  "AI not configured" error across all AI entry points (sync handlers and async pipelines).
- **Hard block on deploy**, no grace period, no per-org opt-in flag. The shared SSM key
  `/auto-rfp/bedrock/api-key` is **retired**; there is a single resolution path (per-org key or error) —
  no fallback branching.

### Detection: probe-at-save + retry-at-invoke (ADR-004)

- **Probe at save:** a tiny test invoke of each required model (titan + opus/haiku/sonnet) plus the
  fallback if supplied. Gives immediate feedback and gates acceptance.
- **Save-time acceptance rule (authoritative):**
  - titan-embed **must** be invokable, else **reject**.
  - If **all** text models are invokable → **accept**, no fallback needed.
  - If **any** text model is missing → a fallback **must** be supplied **and** itself probe-invokable,
    else **reject** with the **exact list of missing models**.
- **Retry at invoke:** at runtime, call the pinned model; on `ResourceNotFoundException` / `AccessDenied`
  for a **text** role, transparently retry **once** with the org's fallback model. A titan/embeddings
  failure is a **hard error** (no fallback).
- **Availability is NOT persisted as a map.** The save probe is for feedback + acceptance only; the
  invoke-time retry does the actual runtime model selection. This avoids a stale availability record.

### orgId propagation (ADR-005) — primary risk

- Add a **required `orgId`** parameter to **`invokeModel`** and to the **`bedrock-tool-loop`** helper
  (`invokeClaudeWithTools`). Every one of the ~30 call sites must pass it; the TypeScript compiler turns
  a missing `orgId` into a **build error** rather than a silent cross-tenant leak.
- **Step-function task payloads and SQS message bodies must carry `orgId`** through to the worker that
  invokes Bedrock (answer-generation, question-pipeline, document-pipeline, and any SQS worker). Any
  async step that doesn't already thread `orgId` needs payload plumbing — this is the **primary
  implementation risk**.
- **Key resolution stays centralized** inside `bedrock-http-client.ts` (resolve from `orgId`). The secret
  is **not** passed around the call graph. `orgId` (safe identifier) is threaded; the key is not.
- Rejected: AsyncLocalStorage request-context (implicit, workers must remember to seed, hard to audit),
  and threading the resolved key/client object down (leaks the secret further).

### Storage, API surface, security (ADR-006)

- **Secret** (the Bedrock key) → **AWS Secrets Manager**, secret name **`bedrock-api-key-<orgId>`**,
  reusing `storeApiKey` / `getApiKey` from `api-key-storage.ts` (same `${prefix}-api-key-${orgId}`
  convention as the sibling integrations).
- **Non-secret config** (fallback model ID, last-probe result, timestamps) → a **DynamoDB entity defined
  in `packages/core`** following the mandatory **5-type schema pattern** (`CreateRequest`, `UpdateRequest`,
  `Item`, `DBItem`, `ListItem`). `DBItem` uses the computed `[PK_NAME]`/`[SK_NAME]` keys and lives in
  core.
- **Dedicated Bedrock set/get handlers** — NOT the unified `search-opportunities` handler (Bedrock isn't
  a search-opportunity source and needs Bedrock-specific fields: fallback model + probe result). Follow
  the thin-Lambda pattern and the standard middy stack
  (`authContextMiddleware → orgMembershipMiddleware → requirePermission → httpErrorMiddleware`), wrapped
  in `withSentryLambda`.
- **GET returns status only** — `{ configured, fallbackModelId, lastProbe }`, **never the key**. This is
  a deliberate improvement over the sibling GET handlers (which return the plaintext key). `orgId` is read
  from the request (query param), never from the token.
- **RBAC:** `org:manage_settings` to save/delete, `org:read` to read status.
- **Delete:** clearing the key also clears the DynamoDB config; the org's AI re-blocks.
- **IAM:** every Bedrock-invoking Lambda — including step-function tasks and SQS workers, which today have
  only SSM read for the shared param — gains `secretsmanager:GetSecretValue` on `bedrock-api-key-*`; the
  old SSM grant is removed.

### Caching & rotation (ADR-007)

- Replace the single process-wide `cachedApiKey` string with a per-org cache: a **`Map<orgId, key>`** in
  warm containers, with:
  - a **short TTL** (~5 minutes), and
  - **eviction on a Bedrock `401/403`**: on an auth failure, drop that org's cached entry, re-fetch once
    from Secrets Manager, and retry before failing.
- The evict-on-auth path must distinguish auth failures (401/403) from unrelated errors so it doesn't
  mask real problems.

### API contracts (surface)

- `POST` set-bedrock-key — body `{ orgId, apiKey, fallbackModelId? }`. Runs the save-time probe; on
  reject returns a 4xx with the list of missing models; on accept stores the secret + config and returns
  success. RBAC `org:manage_settings`.
- `GET` bedrock-key status — query `?orgId=…`. Returns `{ configured, fallbackModelId, lastProbe }` only.
  RBAC `org:read`.
- Delete — modeled the same way the sibling cards do it (saving an empty key clears the secret **and** the
  DynamoDB config). RBAC `org:manage_settings`.

### Frontend (ADR-006)

- A new **`BedrockApiKeyConfiguration`** card in `OrganizationIntegrations.tsx`, reusing the shared
  `<ApiKeyConfiguration>` style plus **one extra free-text fallback-model field** (validated by the save
  probe). Follows the existing feature-sliced structure: presentation-only component, logic in a hook,
  types imported from `@auto-rfp/core`, Shadcn UI only, skeleton loading states.
- The card's status badge is driven by the status-only GET (`configured` boolean), so nothing that reads
  the old `configured` field breaks.

---

## Prerequisite & Companion Tickets

A straight read of the decisions above yields the backend + config surface, but three work items are
**not** fully resolved by the core feature tickets and must be scheduled alongside them. The first two
are **prerequisites** — resolve them *before* the hard-block ships, or the feature ships broken; the
third is a **discovery spike** that de-risks the primary implementation risk (ADR-005).

### P1 — Dev / test / CI key provisioning (prerequisite, must land before deploy)

Retiring the shared SSM key (ADR-002) takes **internal** environments dark too, not just customers.
`bedrock-http-client.ts` reads the shared param today, and the three async step-function stacks
(`answer-generation`, `document-pipeline`, `question-pipeline`) each grant SSM read on that param ARN.
Once the shared path is removed, **every dev/test/CI org that exercises AI must have a per-org key
configured** — otherwise local development, backend AI tests that hit a real backend, and the
compliance-review e2e suite all fail with "AI not configured."

- Decision needed: who owns the internal test org(s)' Bedrock key, where it's stored, and how CI/e2e
  environments obtain a valid key for their fixture org before the shared key is removed.
- Sequencing: this must be **done and verified before** the hard-block deploy, not after.

### P2 — "AI not configured" UX design, sync + async (prerequisite for a coherent block)

The hard block is only as good as the message it surfaces. There is **no existing AI-configuration UX in
`apps/web`** to extend, so this is net-new and must be designed once, centrally, rather than reinvented
per surface:

- **Sync surfaces** (~6 AI features: answer generation trigger, executive brief, compliance review,
  question extraction, document generation, opportunity assistant chat): a consistent error state /
  empty state that says "AI not configured for this organization" and points an admin to the Bedrock
  settings card. Design once (shared component/pattern), consume everywhere.
- **Async surfaces**: async pipelines record failures as coarse resolutions today (answer generation
  uses a resolution enum, e.g. `NO_KB_MATCH` / `GENERATION_FAILED`). An "AI not configured" condition in
  a worker would otherwise collapse into a generic failure. To surface it distinctly, add a dedicated
  **`AI_NOT_CONFIGURED`** failure reason to each async pipeline's failure-recording path and render it
  distinctly wherever those results are displayed.
- Because the block is immediate at deploy, this UX must exist at ship time — it is not a
  fast-follow.

### P3 — `orgId` availability spike across async pipelines (discovery, de-risks ADR-005)

ADR-005 makes the missing-`orgId` case a compile error at the ~30 sync call sites, but the **primary
risk** is the async payloads that don't already carry `orgId` to their Bedrock step. Before estimating
the propagation ticket(s), run a spike that maps, for each Bedrock-invoking step-function task and SQS
worker (answer-generation, question-pipeline, document-pipeline, and any others), whether `orgId` is
already present in the task/message payload or needs plumbing. The spike output is the actual scope of
the propagation work; without it, that ticket's estimate is unreliable.

### Carried in existing tickets (flagged, not new work items)

- The ~30 `invokeModel` / `invokeClaudeWithTools` **consumer test-signature updates** ride along with the
  ADR-005 propagation change (see Testing Decisions).
- The **deploy / customer-coordination runbook** is operational and owned outside code (see Further
  Notes); it is not a code ticket but must be tracked to completion.

---

## Testing Decisions

**What makes a good test here:** assert **external behavior** at each seam, not internal wiring. Test the
exported business function directly (never the middy-wrapped handler), mock the AWS SDK / HTTP boundary
and Secrets Manager before imports, reset mocks in `beforeEach`, and use `expect.any(String)` for
timestamps. Do not assert on cache internals or private helpers — assert on what a caller observes
(which key was used, whether a retry happened, whether the save was rejected and with what message).

**Three seams (confirmed with the developer):**

1. **`invokeModel(orgId, …)` funnel** — `bedrock-http-client.ts`. The single highest seam; per-org key
   resolution, `Map<orgId,key>` caching, TTL + evict-on-401/403, and invoke-time text-fallback retry all
   live behind it. Cover:
   - resolves and uses the **correct org's** key (org A never uses org B's key);
   - **unconfigured org** → "AI not configured" error (no shared fallback);
   - **cache hit** within TTL avoids a second Secrets Manager fetch; **TTL expiry** re-fetches;
   - **401/403** evicts that org's entry, re-fetches once, retries;
   - **text-role `ResourceNotFoundException`/`AccessDenied`** transparently retries once on the org's
     fallback model; **titan/embeddings** failure is a hard error with **no** retry;
   - existing throttling-retry behavior is preserved.
2. **Save-probe handler** (exported business function). Cover the **acceptance rule** exhaustively:
   titan missing → reject; all text models present → accept (no fallback); a text model missing with a
   working fallback → accept; a text model missing with no/failing fallback → reject **with the exact
   missing-model list**; secret + config written on accept; probe uses the just-submitted key. Standard
   handler categories also apply: happy path, validation (400 + issues), RBAC/guard, edge cases.
3. **Status-GET handler** (exported business function). Cover: returns `{ configured, fallbackModelId,
   lastProbe }`; **never returns the key** (explicit assertion that no key field is present);
   `configured:false` when unset; `orgId` sourced from the request; validation when `orgId` missing.

**`bedrock-tool-loop` (`invokeClaudeWithTools`)** — since it gains a required `orgId` and forwards it to
every `invokeModel` call it makes, add/extend a test asserting the `orgId` is threaded through to the
underlying invoke on every round (tool-use rounds, truncation retry, and the JSON-repair retry).

**Core schema tests (Vitest)** for the new DynamoDB entity: valid data passes, invalid fails, optional
fields omitted, `Item` has no `partition_key`/`sort_key`, `DBItem` carries the computed keys.

**Frontend (RTL)** for the Bedrock card: renders configured / not-configured states, save calls the hook,
the fallback-model field is present, actions are permission-gated, loading uses skeletons.

**Prior art in the codebase to mirror:**

- Backend handler tests co-located next to sibling handlers (e.g. the search-opportunity and
  google/linear api-key handlers) — same mock-before-import pattern.
- `bedrock-tool-loop.test.ts` and the ~30 `invokeModel` consumer tests (e.g.
  `generate-answer.test.ts`, `classify-document.test.ts`, `compliance-review-*.test.ts`) already mock
  `invokeModel`; they must be updated to the new `orgId`-bearing signature.
- Existing 5-type entity schema tests in `packages/core` for the DynamoDB entity shape.
- Existing api-key card component tests for the frontend card.

---

## Out of Scope

- **Per-org region** and **per-org / per-role model-ID overrides.** Region stays `us-east-1`; model IDs
  stay pinned and global. Non-US-region customers are explicitly unsupported in v1 (ADR-003).
- **A separately configurable embedding fallback.** Embeddings are titan-only, no fallback (ADR-003).
- **A shared-key fallback, grace period, or per-org kill-switch/opt-in flag.** The shared key is retired
  outright; the block is immediate at deploy (ADR-002).
- **Persisting a per-org model-availability map** for runtime selection. Runtime selection is done by the
  invoke-time retry, not a stored map (ADR-004).
- **Returning the key from the GET endpoint** (even masked). Status only (ADR-006).
- **Migrating the sibling integration GET handlers** to also stop returning their plaintext keys — that's
  a good idea but not part of this feature.
- **Automated bulk onboarding / self-serve migration tooling.** Configuration is coordinated manually with
  the small, known set of orgs around the deploy.

Note: the "AI not configured" UX (P2), dev/test/CI key provisioning (P1), and the async-`orgId` spike
(P3) are **not** out of scope — they are scheduled as prerequisite/companion tickets (see that section).
Only the bullets above are excluded from v1.

## Further Notes

- **Migration is coordinated and breaking.** Because the shared key is retired at deploy, every existing
  org is dark until it configures a valid key. This is acceptable only because the org count is small and
  configuration is coordinated at deploy time (ADR-002). Sequencing the deploy with customer
  configuration is an operational prerequisite, not a code concern. **Note this cuts internal too:** the
  dev/test/CI environments must have keys provisioned before the block ships — tracked as ticket P1.
- **Respect the model-id-pinning lessons** (see the `bedrock-model-id-pinning` note): a Bearer key can
  only invoke the account's *active* models; Legacy/EOL ids fail with `ResourceNotFoundException`. The
  probe surfaces exactly this at save time instead of mid-generation. Also mind the API Gateway 30s cap
  on synchronous AI endpoints — the probe should be a *tiny* invoke per model and, ideally, the per-model
  probes run concurrently.
- **The `orgId` thread is the crux.** The build won't compile until every call site and every async
  payload carries `orgId`; treat the step-function/SQS payload plumbing as the highest-risk work item and
  verify each pipeline's Bedrock step actually receives the org's identity end-to-end.
- **Fail-loud, not silent.** Consistent with the phase guardrails and the model-id-pinning note: any
  fail-open catch around a Bedrock call must report explicitly (Sentry / `console.error`) so a
  permanently-missing-model or bad-key condition is diagnosable rather than a silent per-item failure.
