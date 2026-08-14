# AutoRFP Improvements v1 — Task List

> Companion to `ROADMAP-v1.md`, `DECISIONS.md` (ADR-1…15), `GLOSSARY.md`. Sizes: S ≈ 0.5–1 day, M ≈ 1–2 days, L ≈ 3–4 days.
> Releases: **R1** = T1–T3 (pricing fix, ships first) · **R2** = T4–T11 (SoT behind `enableSolutionPlan` org flag) · **R3** = T12 (flip gating on per org).

---

## Track P — Pricing & Prompts (independent, Release 1)

### T1 · Improve COST_PROPOSAL and PRICE_VOLUME prompts
**Size:** S · **Deps:** none

Rewrite the `DOC_TYPE_GUIDANCE` and `DOC_TYPE_TASK` entries for `COST_PROPOSAL` (~L533/L946) and `PRICE_VOLUME` (~L497/L1024) in `apps/functions/src/helpers/document-prompts.ts`. Add rules: (a) SOLUTION PLAN CONSISTENCY — CLINs, phases, labor mix, and period of performance must match the Approved Solution Plan exactly, phrased conditionally ("if provided") so it ships before the SoT feature; (b) THIRD-PARTY PRICING — never invent subscription/license prices, call `search_service_pricing`, cite source URL + retrieval date, label as estimate, write "vendor quote required" on lookup failure; (c) INTERNAL RATES only from `get_pricing_data`; (d) PAGE LIMITS — respect solicitation-specified limits; (e) new structure subsection "Third-Party Services & Subscriptions" table. Update `document-prompts.test.ts`. Note in release notes that orgs with stored prompt overrides (`document-prompt-overrides.ts`) won't get the new defaults.

> **Implementation notes (as built, 2026-08-14):**
> - **The four rule blocks are non-overridable** (deviation from the spec's release-notes-only approach, by explicit decision): they live in a single `PRICING_GUIDANCE_RULES` constant appended to the system-prompt skeleton (`buildSystemPromptForDocumentType` + `buildSectionSystemPrompt`) as a "MANDATORY PRICING RULES" block for `COST_PROPOSAL`/`PRICE_VOLUME` only — org guidance overrides replace the guidance fragment but cannot remove these rules. They are also excluded from the editable defaults shown by the prompt-management API.
> - The "Third-Party Services & Subscriptions" structure subsection and the rewritten task steps remain part of the normal (overridable) guidance/task fragments.
> - **Release-notes item for R1 (reduced scope):** orgs with stored prompt overrides for these doc types still miss the improved *structure* subsection and *task* steps until they reset/re-save their override — but the four mandatory rule blocks now apply to them regardless.

### T2 · Brave web-search client + service pricing lookup with cache
**Size:** M · **Deps:** none

Create `apps/functions/src/helpers/web-search-client.ts` — a provider-agnostic HTTP client mirroring `bedrock-http-client.ts`, exposing `webSearch(query, opts)` that returns normalized `{title, url, snippet}[]`. Brave Search API implementation inside (`GET https://api.search.brave.com/res/v1/web/search`, `X-Subscription-Token` header, key from SSM `/auto-rfp/brave-search/api-key` cached in warm container, retry-once on 429 to respect the 1 req/sec free tier). Create `apps/functions/src/helpers/service-pricing.ts` — `searchServicePricing({services})` with batched input `services: {serviceName, billingPeriod}[]` (capped at 10): per service normalize cache key → check DynamoDB cache; for misses, `webSearch` sequentially (1 req/sec) → one Haiku extraction pass over all results to `{price, currency, unit, tier, sourceUrl, confidence}[]` (LOW confidence when no price stated) → cache writes with confidence-tiered `ttl`: HIGH/MEDIUM 30 days, **LOW ~24h** so bad lookups self-heal (ADR-9). Batched because Brave can't combine services in one query, but doc generation allows only 2 tool rounds per section — all prices must come back in a single tool round. Create the cache entity `packages/core/src/schemas/service-pricing-cache.ts` (full 5-type Zod pattern), PK `SERVICE_PRICING_CACHE`, SK `{normalizedServiceName}#{billingPeriod}`, global scope (no orgId). Co-located Jest + vitest tests.

### T3 · `search_service_pricing` AI tool + infra wiring
**Size:** S · **Deps:** T2

Add the `search_service_pricing` tool definition and executor branch to `apps/functions/src/helpers/document-tools.ts` with **batched input schema** `{ services: [{ serviceName, billingPeriod? }] }` (max 10); tool description instructs the model to request ALL third-party services in ONE call. Executor returns a single formatted table (one row per service), each row citing source URL + retrieval date, footer "ESTIMATES — subject to vendor quote"; failed lookups return "vendor quote required" rows. **The executor never throws into the tool loop** (ADR-15): total outage (Brave down, quota exhausted, SSM key missing) degrades all rows to "vendor quote required (lookup unavailable)" — the document always completes. Tests cover partial-failure and total-outage shapes. Offer the tool only for COST_PROPOSAL/PRICE_VOLUME (filter by `documentType` where `DOCUMENT_TOOLS` is passed in `generate-document-worker.ts`). Infra: create SSM parameter per stage (runbook, like the Bedrock key), grant `ssm:GetParameter` on the param ARN to `commonLambdaRole`, add `BRAVE_SEARCH_API_KEY_SSM_PARAM` to `commonEnv` in `api-orchestrator-stack.ts`.

> **Implementation notes (as built, 2026-08-14):**
> - Doc-type filtering is centralized in a new `getDocumentToolsForType(documentType)` export from `document-tools.ts`; every place that offered `DOCUMENT_TOOLS` to the model now uses it — single-shot + section-by-section generation (`generate-document-worker.ts` / `document-section-generator.ts`, which gained a required `documentType` arg) **and also `edit-section.ts`** (beyond spec, for consistency: the pricing tool is available when editing COST_PROPOSAL/PRICE_VOLUME sections, hidden elsewhere).
> - **T6's `search_service_pricing` stub in `solution-plan-tools.ts` was replaced** per its `TODO(T3)`: the tool name joined `SOLUTION_PLAN_SHARED_TOOL_NAMES` and the executor now delegates to the real Brave-backed lookup via `executeDocumentTool`.
> - **No new IAM grant was needed** — `commonLambdaRole` already has `ssm:GetParameter` on `parameter/auto-rfp/*`, which covers `/auto-rfp/brave-search/api-key`. Runbook: `docs/improvements_v1/RUNBOOK-BRAVE-SEARCH-API-KEY.md`.

---

## Track S — Source of Truth backbone (Release 2)

### T4 · SolutionPlan core schemas
**Size:** S · **Deps:** none

Create `packages/core/src/schemas/solution-plan.ts` with the 5-type Zod pattern (`SolutionPlanCreateRequest/UpdateRequest/Item/DBItem/ListItem`) using `[PK_NAME]`/`[SK_NAME]`. Status enum (pure lifecycle, ADR-3): `GRILLING | GENERATING_SOT | READY | FAILED`; freshness is the orthogonal `isStale: boolean` + `staleReason`. Item fields: `id, orgId, projectId, opportunityId, status, isStale, staleReason, runId, contentKey, version, isUserEdited, editedBy, grillingRounds, grillingCompletedAt, error` + audit fields. `version` is monotonic across regenerations — never reset (ADR-11). Also add optional `solutionPlanId`/`solutionPlanVersion` to the RFP document item schema (ADR-7). Also `GrillingMessageItemSchema`/`GrillingMessageDBItemSchema` (role `GRILLER | TECH_LEAD | SYSTEM`, round, content, toolCalls summary). Add barrel export to `schemas/index.ts`, constants `SOLUTION_PLAN_PK`/`GRILLING_MESSAGE_PK` in `apps/functions/src/constants/solution-plan.ts`, vitest schema tests, rebuild core.

### T5 · SolutionPlan DB/S3 helper
**Size:** M · **Deps:** T4

Create `apps/functions/src/helpers/solution-plan.ts`: SK builders (plan SK `{orgId}#{projectId}#{opportunityId}` — one plan per opportunity; message SK `{solutionPlanId}#{round:3pad}#{ts}#{messageId}`), `getSolutionPlanByOpportunity`, `putSolutionPlan`, `updateSolutionPlanStatus`, `appendGrillingMessage`, `listGrillingMessages`, `uploadSolutionPlanHtml`/`loadSolutionPlanHtml` (S3 key `{orgId}/{projectId}/{opportunityId}/solution-plan/v{version}/solution-plan.html`), `markSolutionPlanStale` (**no-op unless status READY**, sets `isStale` + `staleReason` — ADR-3). All DDB ops via `@/helpers/db`. Co-located Jest tests (incl. markStale no-op cases).

### T6 · Grilling worker (two-agent loop + SoT synthesis)
**Size:** L · **Deps:** T5 (T3 soft — pricing tool can be stubbed)

The core AI feature. Create `helpers/solution-plan-prompts.ts` (Griller, Tech Lead, Synthesizer system prompts), `helpers/solution-plan-tools.ts` (`SOLUTION_PLAN_TOOLS` = subset of `DOCUMENT_TOOLS` executors: `search_knowledge_base`, `search_past_performance`, `get_organization_context`, `get_pricing_data`, `get_executive_brief_analysis` + `search_service_pricing`), `helpers/solution-plan-queue.ts` (`enqueueGrillingRound`), `helpers/solution-plan-worker.ts` (`processGrillingRound`, `processSynthesis`) and the thin SQS handler `handlers/solution-plan/solution-plan-worker.ts`. Step-per-round design: each SQS message `{orgId, projectId, opportunityId, solutionPlanId, runId, round, phase}` processes ONE round — worker loads the plan first and **no-ops if `message.runId ≠ plan.runId`** (zombie-round protection, ADR-5) — Griller turn (solicitation 60k + exec brief 8k context **when a brief exists; omitted otherwise — brief never required**, ADR-14; no tools, 1–3 questions, `INTERVIEW_COMPLETE` termination token honored **only from round 2 and only as whole message / final line**, ADR-13) → persist → Tech Lead turn (`invokeClaudeWithTools`, maxToolRounds 4, 10k opportunity primer) → persist → enqueue next round or `SYNTHESIZE`. Synthesis: one call producing `{title, htmlContent}` with sections Architecture / Services & Licenses (prices + sources) / Timeline & Phases / Team / Risks / Cost Drivers, prompt targeting **~10k chars of body text** (ADR-6) → upload to S3 → status READY. Idempotent on SQS redelivery (skip round if GRILLER message for round + runId exists); catch-all sets FAILED + error. Env: `SOLUTION_PLAN_MODEL_ID`, `SOLUTION_PLAN_GRILLER_MODEL_ID` (optional Haiku), `SOLUTION_PLAN_MAX_ROUNDS=4` (hard cap 8, min 2). Jest tests: termination token → SYNTHESIZE, round-1 token ignored, mid-text token ignored, max-round cap, stale-runId no-op, idempotent redelivery, FAILED on throw.

### T7 · SolutionPlan REST API + infra registration
**Size:** M · **Deps:** T5 (end-to-end verification needs T6)

Handlers in `apps/functions/src/handlers/solution-plan/`: `init-solution-plan.ts` (POST, `proposal:create`, upsert plan status=GRILLING with **fresh `runId`**, wipe old messages, enqueue round 1 — modeled on `init-executive-brief.ts`; re-init while GRILLING/GENERATING_SOT only with explicit restart intent, ADR-5), `get-solution-plan.ts`, `get-transcript.ts` (both `proposal:read`, ADR-12), `update-solution-plan.ts` (PATCH content, `proposal:create`: **409 unless status READY** (ADR-8), bump version (monotonic, ADR-11), set `isUserEdited`, clear `isStale`, upload new S3 version), `get-html-content.ts` (`proposal:read`). All thin: destructured `safeParse`, `orgId` from request, `apiResponse`, full middy stack, `withSentryLambda`. Infra: `packages/infra/api/routes/solution-plan.routes.ts`, register in `allDomains` + `domainStackNames` (index-aligned) in `api-orchestrator-stack.ts`; SQS queue `auto-rfp-solution-plan-{stage}` (visibility 16 min, DLQ `maxReceiveCount: 1`) + worker Lambda `auto-rfp-solution-plan-worker-{stage}` (timeout 10 min, memory 1024, `commonLambdaRole`, SqsEventSource batchSize 1, `reportBatchItemFailures`, explicit LogGroup 2-week retention non-prod), mirroring the ExecBriefWorker block. Handler Jest tests.

### T8 · Inject SoT into document generation
**Size:** M · **Deps:** T5

In `helpers/generate-document-worker.ts` `processJobInner` (~L981): load plan via `getSolutionPlanByOpportunity`; if READY (stale or not), load S3 HTML, strip to text, truncate to 12k chars (own budget, separate from the 18k `gatherAllContext` blob; truncation is a safety net — **log a warning with plan id + length when it fires**, ADR-6). Add optional `solutionPlanText` param to `buildUserPromptForDocumentType` in `document-prompts.ts`, inserting an `═══ APPROVED SOLUTION PLAN (SOURCE OF TRUTH) ═══` block after Q&A ("authoritative — OVERRIDES anything you might otherwise infer"). Thread the same param into `document-section-generator.ts` so section-by-section mode receives it. Add one non-overridable line to `buildSystemPromptForDocumentType` context-usage instructions. When a plan was injected, **stamp `solutionPlanId` + `solutionPlanVersion` on the generated document item** (ADR-7). Update prompt tests (block present/absent; version stamp).

### T9 · Server-side generation gate
**Size:** S · **Deps:** T5

In `handlers/rfp-document/generate-document.ts`, before creating the placeholder doc: for gated doc types (exclude CLARIFYING_QUESTIONS, QUESTIONS_AND_ANSWERS, QUESTIONNAIRE), if no plan with status READY exists (`isStale` does not close the gate) → `apiResponse(409, { message, code: 'SOLUTION_PLAN_REQUIRED', solutionPlanStatus })`. Escape hatches: env `SOLUTION_PLAN_GATING=off` and org flag `enableSolutionPlan` added to `packages/core/src/schemas/organization.ts` (manual-DDB pattern like `enableComplianceReview`; flag off = no gate). **Grandfathering is required** (ADR-10): if the opportunity already has ≥1 generated gated-type document, the gate passes. Jest tests: 409 when missing, pass when READY (stale and not), exempt types bypass, flag-off bypass, grandfather bypass.

---

## Track F — Frontend (parallel with T6)

### T10 · Solution Plan feature module + opportunity page section
**Size:** M · **Deps:** T4 (types); T7 (live API)

Create `apps/web/features/solution-plan/` per Feature-Sliced Design: hooks `useSolutionPlan` (SWR, refreshInterval 3s while GRILLING/GENERATING_SOT), `useGrillingTranscript` (poll 3s while GRILLING), `useInitSolutionPlan` (POST init = start/regenerate), `useUpdateSolutionPlan` (PATCH); components `SolutionPlanPanel` (status badge; CTAs Start / live transcript / View & Edit / Regenerate / Retry; `isStale` warning banner; Regenerate confirm dialog explicitly warns manual edits are **permanently lost** when `isUserEdited` — ADR-4), `GrillingTranscriptView` (live Q&A feed, Skeleton loading), `SolutionPlanStatusBadge`; `lib/status.ts` with `canGenerateDocuments(plan)` (READY regardless of `isStale`); barrel `index.ts`. Mount as `<section id="solution-plan">` in `OpportunityView.tsx` between `#executive-brief` and `#solicitation-documents`, rendered only when `currentOrganization.enableSolutionPlan`. RTL component tests (panel states per status).

### T11 · SoT edit page (TipTap)
**Size:** M · **Deps:** T7, T10

Create `app/organizations/[orgId]/projects/[projectId]/opportunities/[oppId]/solution-plan/edit/page.tsx` mirroring `opportunity-document-editor-page.tsx`: load HTML via GET `/solution-plan/html-content`, edit with the existing `components/rfp-documents/rich-text-editor.tsx` (TipTap v3), save via PATCH `/solution-plan/update` (bumps version, sets `isUserEdited`). Warn on Regenerate when `isUserEdited` is true. Loading state via `PageLoadingSkeleton`.

### T12 · Frontend generation gating (Release 3 enabler)
**Size:** S · **Deps:** T9, T10

Apply `canGenerateDocuments` in all four generation entry points: `generate-document-dialog.tsx` (disable Generate + inline "Create a Solution Plan first" callout linking to `#solution-plan`; keep exempt doc-type rows un-gated), `brief/components/RequiredDocumentsPanel.tsx`, `questions/components/GenerateRFPDocumentModal.tsx`, and the editor Regenerate button. Handle 409 `code === 'SOLUTION_PLAN_REQUIRED'` in `useGenerateRFPDocument` (`lib/hooks/use-rfp-documents.ts`) with a specific toast as defense-in-depth. Dialog disabled-state test.

> **Implementation notes (as built, 2026-08-13):**
> - **Editor Regenerate stays un-gated.** The server only checks the gate when creating a *new* document — regeneration into an existing `documentId` bypasses it (`generate-document.ts`), consistent with ADR-10's intent that existing documents keep working. Gating the button client-side would be stricter than the server.
> - **Callout link is the full opportunity-page URL + `#solution-plan`** (not a bare anchor), so it also works from entry points hosted on other routes (e.g. the questions page).
> - **Grandfathered opportunities (ADR-10) show a non-blocking nudge banner** (`SolutionPlanNudgeBanner`) recommending a plan, per the ADR's "banner copy (T12)" consequence.
> - **Known limitation:** the stage-wide `SOLUTION_PLAN_GATING=off` kill switch is server-only; while active, the UI still gates flagged orgs (server remains authoritative and would allow generation).

### T13 · Staleness triggers (can slip to v1.1)
**Size:** S · **Deps:** T5, T10

Call `markSolutionPlanStale(projectId, opportunityId, reason)` from the exec-brief regeneration path and the solicitation-document upload path (no-op unless plan is READY — ADR-3). `isStale` keeps the gate open but shows the warning banner in `SolutionPlanPanel` ("Solution Plan may be outdated — regenerate recommended" + reason); cleared on save/regenerate. Tests for both triggers + the no-op guard.

### T14 · E2E + quality evals
**Size:** S · **Deps:** all

Playwright happy path: init Solution Plan → poll to READY (mocked backend) → generate document succeeds; blocked state before plan exists. Eval spot-check (manual or `evals/` suite): generate a COST_PROPOSAL on a dev opportunity and verify third-party prices carry source URLs + "estimate" labels and the timeline/team match the SoT.

---

## Dependency graph

```
T1 ──────────────────────────────► R1
T2 ─► T3 ─────────────────────────► R1
T4 ─► T5 ─► T6 ─► T7 ─► T10 ─► T11 ─► R2
            │          └► T12 ───────► R3
            ├► T8 ──────────────────► R2
            ├► T9 ─► T12
            └► T13 (v1.1 ok)
T14 last
```

Critical path: **T4 → T5 → T6 → T7 → T10 → T12**. With 3 devs: Dev A = T1→T2→T3→T8, Dev B = T4→T5→T6, Dev C = T7 + T10→T11→T12 (starts frontend against T4 types while T6 is in progress).