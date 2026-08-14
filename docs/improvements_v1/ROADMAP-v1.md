# AutoRFP Improvements v1 — Roadmap & Task List

## Context

Per the Aug 10 meeting + Pavlo's additions: AutoRFP generates proposal documents in parallel (SQS fan-out, one message per doc type) with **no shared solution plan**, so Technical Proposal / Cost Proposal / Project Plan contradict each other (different timelines, costs). The AI also **invents prices** for third-party subscriptions ($7k / $5k / $17k for the same service across generations).

**v1 scope (confirmed):**
1. **Pre-Plan Solution / Source of Truth (SoT)** — mandatory step before doc generation:
   - Two-agent grilling in **separate isolated AI sessions**: a "Griller" agent (context: solicitation + exec brief) interrogates; a "Tech Lead" agent (context: KB/RAG, past performance, pricing, tools) answers with concrete decisions. Orchestrator relays turns.
   - A third "Synthesizer" step generates the SoT document from the transcript + RFP + KB.
   - UI: view SoT, **edit content directly (TipTap)**, and regenerate.
   - **Hard-block** document generation (frontend + server-side) until SoT exists.
   - Inject SoT as authoritative context into every document-generation prompt.
2. **Live pricing lookup tool** — new `search_service_pricing` AI tool via **Brave Search API** (free tier ~2,000 queries/month), provider-agnostic design, with DynamoDB cache (TTL 30 days). **Batched tool input** (`services[]` — all prices in one tool round; internally one Brave query per uncached service). Used by cost docs + the Tech Lead agent.
3. **Improve prompts for COST_PROPOSAL and PRICE_VOLUME** ("Cost-Value" = PRICE_VOLUME) — SoT consistency, never invent prices, page limits.

## Key codebase facts

- Doc generation: `POST /rfp-document/generate-document` → `apps/functions/src/handlers/rfp-document/generate-document.ts` → SQS `auto-rfp-doc-generation-{stage}` → `helpers/generate-document-worker.ts` `processJobInner` → `gatherAllContext` (`helpers/document-context.ts`) + prompts from `helpers/document-prompts.ts` (COST_PROPOSAL guidance ~L533 / task ~L946; PRICE_VOLUME ~L497 / ~L1024) → `invokeModel` (`helpers/bedrock-http-client.ts`) → S3 HTML.
- Reusable agent loop: `helpers/bedrock-tool-loop.ts` `invokeClaudeWithTools` (used by exec-brief-worker, compliance-review-engine).
- Pattern to copy for async AI worker: Executive Brief (`handlers/brief/init-executive-brief.ts` + `exec-brief-worker.ts`, SQS jobs, per-section status).
- Tool sets: `DOCUMENT_TOOLS` in `helpers/document-tools.ts` (8 tools incl. `get_pricing_data`); similar sets in `answer-tools.ts`, `brief-tools.ts`.
- Frontend generate UX: `apps/web/components/rfp-documents/generate-document-dialog.tsx`, mounted in `components/opportunities/opportunity-rfp-documents.tsx`; opportunity page `OpportunityView.tsx` renders anchored sections (`#executive-brief`, `#solicitation-documents`, `#rfp-documents`, …). Other generation entry points: `brief/components/RequiredDocumentsPanel.tsx`, `questions/components/GenerateRFPDocumentModal.tsx`, editor "Regenerate".
- Editor: `components/rfp-documents/rich-text-editor.tsx` (TipTap v3) + `opportunity-document-editor-page.tsx`. Polling: SWR `refreshInterval` (no websockets).
- Org flags: booleans on `packages/core/src/schemas/organization.ts` (`enableComplianceReview` pattern), read via `useCurrentOrganization`.
- No web-search capability exists anywhere today. No "Cost-Value" doc type — only `COST_PROPOSAL` and `PRICE_VOLUME`.

## Design decisions

> Refined by the 2026-08-11 grilling session — see `DECISIONS.md` (ADR-1…15) and `GLOSSARY.md`.

### 1. SolutionPlan entity (`packages/core/src/schemas/solution-plan.ts`)

- 5-type Zod pattern (Create/Update/Item/DBItem/ListItem) per `.claude/rules/03-entity-definitions.md`, using `[PK_NAME]`/`[SK_NAME]`.
- Status (pure lifecycle): `z.enum(['GRILLING','GENERATING_SOT','READY','FAILED'])`. Freshness is the **orthogonal `isStale: boolean` + `staleReason`** — not a status (ADR-3).
- Item fields: `id, orgId, projectId, opportunityId, status, isStale, staleReason, runId, contentKey (S3), version (int), isUserEdited, editedBy, grillingRounds, grillingCompletedAt, error, audit fields`.
- Keys (`apps/functions/src/constants/solution-plan.ts`): `SOLUTION_PLAN_PK`, SK `{orgId}#{projectId}#{opportunityId}` — **one plan per opportunity** (stable id, mutable singleton; ADR-2), get = single `getItem`, regenerate = overwrite + wipe messages. No approval step: READY alone opens the gate (ADR-1).
- `version` is **monotonic across regenerations and user saves — never reset** (ADR-11), so S3 keys never collide and doc stamps stay unambiguous.
- Grilling transcript: **separate DDB items per message** (`GRILLING_MESSAGE_PK`, SK `{solutionPlanId}#{round:3pad}#{ts}#{messageId}`, role `GRILLER|TECH_LEAD|SYSTEM`) — avoids 400KB limit, incremental persistence, matches existing chat patterns.
- SoT content: **HTML in S3** (key `{orgId}/{projectId}/{opportunityId}/solution-plan/v{version}/solution-plan.html`) — required for TipTap round-trip; `version` bumped on user save/regenerate. Regenerate with `isUserEdited=true` warns that edits will be **permanently discarded** (ADR-4).
- Staleness: minimal v1 — `markSolutionPlanStale()` helper called from exec-brief regen + solicitation upload; **no-op unless status is READY** (ADR-3). Sets `isStale`; still passes the gate, UI shows warning banner; user save/regenerate clears it.

### 2. Grilling orchestration — SQS step-per-round (not one long loop)

- Files: `handlers/solution-plan/init-solution-plan.ts` (POST, `proposal:create`, upsert plan status=GRILLING with **fresh `runId`**, wipe old messages, enqueue round 1; re-init while GRILLING/GENERATING_SOT requires explicit restart intent from the UI — ADR-5), `handlers/solution-plan/solution-plan-worker.ts` (thin SQS handler), `helpers/solution-plan-worker.ts` (`processGrillingRound`, `processSynthesis`), `helpers/solution-plan-queue.ts`, `helpers/solution-plan-prompts.ts`, `helpers/solution-plan-tools.ts`, plus GET get/transcript/html-content (`proposal:read`) and PATCH update (`proposal:create`; **409 unless status READY** — ADR-8, ADR-12) handlers.
- Message: `{orgId, projectId, opportunityId, solutionPlanId, runId, round, phase: 'GRILL'|'SYNTHESIZE'}`. Worker loads the plan first and **no-ops if `message.runId ≠ plan.runId`** (zombie-round protection, ADR-5). Each worker invocation processes ONE round (Griller turn → persist → Tech Lead turn with tools → persist → enqueue next round or SYNTHESIZE). Keeps each Lambda run ~3-4 min, under 10-min timeout; idempotent on redelivery (skip if GRILLER message for round + runId exists).
- **Isolation**: two separate message arrays; orchestrator relays only the counterpart's last text.
- Griller: context = solicitation (60k cap) + exec brief (8k, **omitted if none exists — brief is recommended, never required**, ADR-14), NO tools, 1-3 pointed questions/round covering architecture, third-party services + pricing, timeline, team, risks; outputs literal `INTERVIEW_COMPLETE` token when satisfied. Token honored **only from round 2 onward and only as the whole message / final line** (ADR-13). maxTokens 2000.
- Tech Lead: persona system prompt (concrete decisions, never "it depends"), `invokeClaudeWithTools` per round with `SOLUTION_PLAN_TOOLS` = subset of DOCUMENT_TOOLS executors (`search_knowledge_base`, `search_past_performance`, `get_organization_context`, `get_pricing_data`, `get_executive_brief_analysis`) + new `search_service_pricing`. maxToolRounds 4, maxTokens 4000. Gets a 10k "opportunity primer" instead of raw solicitation (pulls detail via tools).
- Synthesizer: one call, output `{title, htmlContent}` with required sections: Solution Architecture, Selected Services & Licenses (with unit prices + source), Timeline & Phases, Team Composition, Key Risks, Cost Drivers & Assumptions. maxTokens 16000; prompt targets **~10k chars of body text** so injection never truncates mid-section (ADR-6).
- Defaults: `SOLUTION_PLAN_MAX_ROUNDS=4` (hard cap 8, **minimum 2** — ADR-13), env `SOLUTION_PLAN_MODEL_ID` (Sonnet), optional `SOLUTION_PLAN_GRILLER_MODEL_ID` (Haiku) for cost. Final-round relay instructs griller it MUST emit `INTERVIEW_COMPLETE`.
- Error handling: DLQ `maxReceiveCount: 1` (same rationale as compliance-review queue, `api-orchestrator-stack.ts` ~L200); worker catch-all sets status FAILED + `error`; UI "Retry" = re-init.

### 3. SoT injection + hard gate

- Injection: in `processJobInner` (`generate-document-worker.ts` ~L981) load plan via `getSolutionPlanByOpportunity`; if READY (stale or not), load S3 HTML → strip to text, truncate 12k chars (**safety net only — log a warning with plan id + length when it fires**, ADR-6). New optional `solutionPlanText` param on `buildUserPromptForDocumentType` inserting an `═══ APPROVED SOLUTION PLAN (SOURCE OF TRUTH) ═══` block (authoritative, OVERRIDES inference) after Q&A — its own budget, NOT inside the 18k `gatherAllContext` blob. Thread same param into `document-section-generator.ts`. Add one system-prompt line in `buildSystemPromptForDocumentType`. When a plan was injected, **stamp `solutionPlanId` + `solutionPlanVersion` (optional fields) on the generated document item** (ADR-7).
- Gate in `generate-document.ts`: for gated doc types (exclude CLARIFYING_QUESTIONS, QUESTIONS_AND_ANSWERS, QUESTIONNAIRE), if no plan with status READY → `apiResponse(409, { message, code: 'SOLUTION_PLAN_REQUIRED', solutionPlanStatus })`. `isStale` does not close the gate. **Grandfathering is required** (ADR-10): if the opportunity already has ≥1 generated gated-type document, the gate passes (UI shows a nudge banner). Escape hatches: env `SOLUTION_PLAN_GATING=off` + org flag `enableSolutionPlan` on organization schema (manual-DDB pattern like `enableComplianceReview`; flag off = no gating, no UI section).

### 4. Pricing search tool (Brave Search API)

- Provider: **Brave Search API** — free tier ~2,000 queries/month (1 req/sec), officially free and production-legitimate; with the 30-day global cache the volume stays well inside the free quota. Endpoint `GET https://api.search.brave.com/res/v1/web/search` with `X-Subscription-Token` header.
- `helpers/web-search-client.ts` — provider-agnostic HTTP client mirroring `bedrock-http-client.ts`; exposes `webSearch(query, opts)` returning normalized `{title, url, snippet}[]`; Brave implementation inside, swappable later (Tavily/Serper) without touching callers. API key from SSM `/auto-rfp/brave-search/api-key` (env `BRAVE_SEARCH_API_KEY_SSM_PARAM`), warm-container cache. Respect the 1 req/sec free-tier rate limit (retry-once on 429 with delay).
- `helpers/service-pricing.ts` — `searchServicePricing({services})` where `services: {serviceName, billingPeriod}[]` (capped at 10): for each service, normalize key → DDB cache check; for cache misses, `webSearch` sequentially (query template `"{serviceName} pricing {billingPeriod}"`, respects 1 req/sec) → one Haiku extraction pass over all results to `{price, currency, unit, tier, sourceUrl, confidence}[]` (Brave snippets are thinner than Tavily's, so the extraction step is essential — mark LOW confidence when snippets don't state a price) → cache writes with confidence-tiered `ttl` (**HIGH/MEDIUM 30 days, LOW ~24h** so bad lookups self-heal — ADR-9; table TTL already enabled, `database-stack.ts` L44-48). Batching matters: Brave can't combine services in one query (one HTTP request = one service), but the tool layer must return ALL prices in a single tool round — doc generation allows only 2 tool rounds per section (5 single-shot), so a per-service tool would exhaust the budget on ~8 services.
- Cache entity `packages/core/src/schemas/service-pricing-cache.ts` (5-type pattern): PK `SERVICE_PRICING_CACHE`, SK `{normalizedServiceName}#{billingPeriod}` — **global scope** (public list prices, cross-org sharing cuts API spend). Fields: serviceName, billingPeriod enum (MONTHLY/ANNUAL/ONE_TIME/USAGE_BASED/UNKNOWN), priceText, priceAmount, currency, unit, sourceUrl, retrievedAt, confidence (HIGH/MEDIUM/LOW), ttl.
- Tool `search_service_pricing` added to `document-tools.ts` (offered only for COST_PROPOSAL/PRICE_VOLUME, filtered by documentType where tools are passed) + `SOLUTION_PLAN_TOOLS`. **Batched input schema**: `{ services: [{ serviceName, billingPeriod? }] }` (max 10) — instructs the model to request ALL third-party services in ONE call. Executor returns a single formatted table (one row per service: price, unit, billing period, confidence); each row cites source URL + retrieval date, footer "ESTIMATES — subject to vendor quote". Failed lookups return "vendor quote required" rows, never omitted. **The executor never throws into the tool loop** — total outage (Brave down, quota exhausted, SSM key missing) degrades every row to "vendor quote required (lookup unavailable)" and the document still completes (ADR-15).
- Infra: SSM param per stage (manual runbook, like the Bedrock key), `ssm:GetParameter` grant on `commonLambdaRole`, `BRAVE_SEARCH_API_KEY_SSM_PARAM` in commonEnv.

### 5. Prompt improvements (COST_PROPOSAL + PRICE_VOLUME in `document-prompts.ts`)

Guidance additions (both types): SOLUTION PLAN CONSISTENCY rule (CLINs/phases/labor mix/PoP must match SoT exactly); THIRD-PARTY PRICING rule (never invent prices — call `search_service_pricing`, cite source URL + date, label estimate, "vendor quote required" on lookup failure); INTERNAL RATES only from `get_pricing_data`; PAGE LIMITS rule (respect solicitation-specified limits); new structure subsection "Third-Party Services & Subscriptions" table.
Task additions: read APPROVED SOLUTION PLAN first; use `get_pricing_data` for labor; list ALL third-party services up front and price them with ONE batched `search_service_pricing` call; cross-check totals against SoT cost drivers. Phrase SoT references conditionally ("if provided") so this ships before the SoT feature. Note: orgs with stored prompt overrides (`document-prompt-overrides.ts`) miss the new defaults — mention in release notes; the system-prompt SoT line is non-overridable backstop.

### 6. Frontend (`apps/web/features/solution-plan/`)

- `hooks/`: `useSolutionPlan` (SWR GET, refreshInterval 3s while GRILLING/GENERATING_SOT), `useGrillingTranscript` (poll 3s while GRILLING), `useInitSolutionPlan` (POST init, also = regenerate), `useUpdateSolutionPlan` (PATCH).
- `components/`: `SolutionPlanPanel` (status badge, CTAs: Start / in-progress transcript / View & Edit / Regenerate / Retry; `isStale` warning banner; Regenerate confirm dialog warns edits are permanently lost when `isUserEdited` — ADR-4), `GrillingTranscriptView` (live Q/A feed, skeletons), `SolutionPlanStatusBadge`. `lib/status.ts`: `canGenerateDocuments(plan)` (READY regardless of `isStale`).
- Placement: new `<section id="solution-plan">` in `OpportunityView.tsx` between `#executive-brief` and `#solicitation-documents`; render only when `enableSolutionPlan`.
- Edit page: `app/organizations/[orgId]/projects/[projectId]/opportunities/[oppId]/solution-plan/edit/page.tsx` reusing `rich-text-editor.tsx`, mirroring `opportunity-document-editor-page.tsx` (GET html-content / PATCH update).
- Gating: disable Generate + inline "Create a Solution Plan first" callout in `generate-document-dialog.tsx`; same shared check in `RequiredDocumentsPanel.tsx`, `GenerateRFPDocumentModal.tsx`, editor Regenerate; handle 409 `SOLUTION_PLAN_REQUIRED` in `useGenerateRFPDocument` (`lib/hooks/use-rfp-documents.ts`).

### 7. Infra

- Queue `auto-rfp-solution-plan-{stage}` (visibility 16 min, DLQ maxReceiveCount 1) + worker Lambda `auto-rfp-solution-plan-worker-{stage}` (timeout 10 min, memory 1024, `commonLambdaRole`, SqsEventSource batchSize 1, reportBatchItemFailures, explicit LogGroup 2-wk non-prod) in `api-orchestrator-stack.ts`, mirroring the ExecBriefWorker block (~L458).
- `packages/infra/api/routes/solution-plan.routes.ts` (init/get/transcript/update/html-content), registered in `allDomains` + `domainStackNames` (index-aligned).

## Task list / roadmap (~2-3 devs)

**Track P — pricing & prompts (independent, ship first as Release 1):**
| # | Task | Size | Deps |
|---|------|------|------|
| T1 | Rewrite COST_PROPOSAL + PRICE_VOLUME guidance/task in `document-prompts.ts` (SoT-conditional phrasing) + test updates | S | — |
| T2 | Brave web-search client (provider-agnostic) + `service-pricing.ts` + cache schema/constants + tests | M | — |
| T3 | `search_service_pricing` tool in `document-tools.ts` (doc-type filtered) + SSM/IAM/env wiring | S | T2 |

**Track S — SoT backbone:**
| # | Task | Size | Deps |
|---|------|------|------|
| T4 | `solution-plan.ts` core schemas + constants + barrel + vitest; rebuild core | S | — |
| T5 | DB/S3 helper `helpers/solution-plan.ts` + tests | M | T4 |
| T6 | Grilling worker: prompts, tools, `solution-plan-worker.ts` (round + synthesis), queue helper + tests | L | T5 (T3 soft) |
| T7 | REST handlers (init/get/transcript/update/html-content) + routes + orchestrator registration (queue, worker, log group) | M | T5 |
| T8 | SoT injection into doc generation (worker load, prompt param, section-generator threading) + tests | M | T5 |
| T9 | Server-side gate in `generate-document.ts` (409 + code, exemptions, org flag + env escape hatch) + tests | S | T5 |

**Track F — frontend (parallel with T6):**
| # | Task | Size | Deps |
|---|------|------|------|
| T10 | `features/solution-plan/` hooks + panel + transcript view + OpportunityView section + org flag | M | T4 (types), T7 (API) |
| T11 | SoT edit page (TipTap reuse, save flow) | M | T7, T10 |
| T12 | Gating in all 4 generation entry points + 409 handling | S | T9, T10 |
| T13 | Staleness triggers (exec-brief regen, solicitation upload) + `isStale` banner — can slip to v1.1 | S | T5, T10 |
| T14 | E2E happy path (Playwright) + eval spot-check COST_PROPOSAL cites pricing sources | S | all |

Critical path: T4→T5→T6→T7→T10→T12. Releases: **R1** = T1+T2+T3 (fixes invented prices immediately); **R2** = SoT behind `enableSolutionPlan` flag; **R3** = flip gating on per org.

## Verification

- `pnpm --filter @auto-rfp/core build && pnpm --filter @auto-rfp/core test` after schema work; `pnpm tsc --noEmit` in functions/web/infra.
- Jest (functions): worker round processing (termination token, max-round cap, idempotent redelivery, FAILED on throw), service-pricing cache hit/TTL/extraction fallback, prompt builder SoT block on/off, generate-document 409/exemptions/flag-off bypass.
- Web Jest: panel states per status, dialog disabled-state; Playwright e2e: init plan → poll READY (mocked) → generate doc.
- Manual on dev: run grilling on a real opportunity, inspect transcript, verify Cost Proposal cites web-sourced prices with URLs and matches SoT timeline.

## Risks

1. Grilling cost/latency (~10-15 Sonnet calls, 5-10 min) → 4-round default, Haiku griller option, live transcript UI.
2. SoT staleness → `isStale` banner only in v1, no blocking.
3. Backward compat (existing opportunities can't regenerate docs) → org flag + env escape hatch + **required grandfathering** in T9 (ADR-10).
4. Org prompt overrides miss new cost rules → non-overridable system-prompt backstop + release note.
5. Web-search price quality (Brave snippets are thin; pricing pages volatile/regional) → Haiku extraction with confidence field (LOW when snippets lack a stated price) + mandatory "estimate" labeling + 30-day TTL; provider swappable to Tavily/Serper if quality is insufficient.
6. Griller never terminates → hard cap + forced `INTERVIEW_COMPLETE` instruction on final round.
7. Brave free-tier limits (2,000 queries/mo, 1 req/sec) → global cache keeps volume low; retry-once on 429; upgrade path is a paid tier or provider swap behind `web-search-client.ts`.