# Component Inventory — AutoRFP

Component names below are the canonical names for scope tracking (referenced verbatim by `reverse-engineering-timestamp.md`).

## Package-Level Components

| Component | Package | Responsibility | Depends on |
|---|---|---|---|
| Web Frontend | `apps/web` (`@auto-rfp/web`) | Next.js App Router dashboard UI; 18 FSD features; SWR data layer; Amplify/Cognito auth | `@auto-rfp/core`, REST API, WebSocket API |
| Lambda Backend | `apps/functions` (`@auto-rfp/functions`) | 55 handler domains + ~150 helpers; middy RBAC middleware; all business logic | `@auto-rfp/core`, DynamoDB, S3, SQS, Pinecone, Bedrock (HTTP) |
| Core Schemas | `packages/core` (`@auto-rfp/core`) | ~80 Zod schema files, `z.infer` types, `PK_NAME`/`SK_NAME` constants; tsup ESM+CJS build — must build first | — |
| Infrastructure | `packages/infra` (`@auto-rfp/infra`) | CDK app: API orchestrator + per-domain Lambda stacks, DynamoDB, Cognito, S3, Step Functions, SQS, WebSocket, Amplify hosting | `@auto-rfp/core`; bundles `apps/functions/src` via `lambdaEntry()` |
| Evals | `evals` (`@auto-rfp/evals`) | AI evaluation suites: executive-brief, question_generation | Bedrock (HTTP) |

## Initiative-Relevant Deep-Dive Components

### Solution Plan
- **Backend**: `packages/core/src/schemas/solution-plan.ts` (`SolutionPlanItemSchema`), `apps/functions/src/handlers/solution-plan/` (5 REST endpoints + `solution-plan-worker.ts`), `apps/functions/src/helpers/solution-plan-prompts.ts`.
- One plan per opportunity, keyed `{orgId, projectId, opportunityId}`; DynamoDB holds metadata only, HTML body in S3 (`contentKey`); monotonic `version`; `isStale` orthogonal to status; statuses `GRILLING → GENERATING_SOT → READY | FAILED`.
- **No structured "sections" model** — one synthesized HTML blob (~10k chars target); "sections" are only `<h2>` headings plus `SOLUTION_PLAN_BRIEF_SECTIONS` (exec-brief section names the grilling agents may see: summary, deadlines, requirements, contacts, risks, pricing, pastPerformance — `scoring` excluded).
- Griller mandatory coverage area 4 is already "TEAM COMPOSITION — roles, headcount, allocation percentages, onshore/offshore mix" (`solution-plan-prompts.ts:93`) — team content exists **only as free prose** today.
- `costSchedule` — structured, nullable `SolutionPlanCostScheduleSchema` field with server-recomputed totals: the precedent for structured data alongside the HTML.
- **Frontend**: `apps/web/features/solution-plan/` — cleanest FSD exemplar; hooks `useSolutionPlan`, `useSolutionPlanHtmlContent`, `useUpdateSolutionPlan`, `useInitSolutionPlan`, `useSolutionPlanGate`, `useSolutionPlanActions`; `SolutionPlanPanel` embedded at `OpportunityView.tsx:305`; full-page TipTap editor at `.../opportunities/[oppId]/solution-plan/edit`; gated on org flag `enableSolutionPlan` (`organization.ts:87`); fully tested.

### Document Generation Pipeline
- `apps/functions/src/handlers/rfp-document/` (`create-rfp-document.ts`, `generate-document.ts`, `generate-document-worker.ts`) + helpers `generate-document-worker.ts` (1,527 lines), `document-generation.ts` (`validateGeneratedContent` + retries), `document-context.ts` (per-type context budgets; TEAM_QUALIFICATIONS maximizes KB "personnel/certs" at 12,000 chars, `document-context.ts:93`), `document-prompts.ts` (1,407 lines; TEAM_QUALIFICATIONS prompts at `:209` and `:1028` demand "ACTUAL names and bios from the Knowledge Base — do not invent personnel"), `document-tools.ts` (tool inventory, `getDocumentToolsForType`, past-perf tool executor).
- Flow: REST → placeholder `GENERATING` → SQS → context+prompts+tools → Bedrock (HTTP) → validation → 3 retries (30/60/120 s) → READY or FAILED + notification.
- **TEAM_QUALIFICATIONS failure root cause**: no personnel entity anywhere (no schema, no handler domain, no Pinecone type for people); KB retrieval is generic semantic search. Hypothesis (unverified against production logs): model fabricates or emits thin/placeholder content that validation rejects, exhausting retries into FAILED.

### Past-Performance Matching Engine
- Schemas (`packages/core/src/schemas/past-performance.ts`): `PastProjectMatchSchema` `{project, relevanceScore 0–100, matchDetails, matchedRequirements[], narrative}`; `RequirementCoverageSchema` `{requirement, status COVERED|PARTIAL|GAP, matchedProjectId/Title, matchScore, recommendation}`; `GapAnalysisSchema` (coverage + overallCoverage + criticalGaps + recommendations).
- Engine (`helpers/past-performance.ts:557` `matchProjectsToRequirements`): truncated requirements+solicitation query → Pinecone org-namespace search filtered `type: 'past_project'` (Titan embeddings, 0.4 floor) → entity load → deterministic `MatchDetails` scoring (technical/domain/scale similarity, recency, success metrics) → disclosure gate (`isUsableInMatching` / `redactForGeneration`) → sorted top-K; "return all projects" fallback when search is empty.
- Orchestrated per exec-brief section by `helpers/past-performance-matching.ts` (input-hash caching, section status lifecycle). Requirements source: exec brief `sections.requirements.data`, fallback summary. **This is the pattern to re-point at people.**

### Pricing & Staffing (today's "team definition")
- `LaborRateSchema` (`pricing.ts:30`) — org-scoped `position` string with onshore + optional offshore rate buildups (base/overhead/G&A/profit → server-computed fully-loaded rates).
- `StaffingPlanSchema` (`pricing.ts:142–190`) — per-opportunity lines `{position, hours, rate, totalCost, phase, rateBasis}`; `position` must match `LaborRate.position`. **No person identity anywhere — roles only.**
- UI: `app/organizations/[orgId]/pricing/` hosting `components/pricing/` — `LaborRateManager`, `StaffingPlanBuilder`, `PendingDraftsSection` (older non-FSD pattern).

### Extraction Workers
- `packages/core/src/schemas/extraction-job.ts` + `apps/functions/src/handlers/extraction/extraction-worker.ts` — SQS worker dispatching on `targetType ∈ {PAST_PERFORMANCE, LABOR_RATE, BOM_ITEM}`, producing DRAFT records with a draft-action approve flow; `LaborRateDraftSchema` exists.
- Established "AI extracts structured records from an uploaded document" pattern. Affirmed rule: CV extraction will use **direct import** (no draft-review step); human validation moves to the solution-plan modify-team flow.

### Knowledge Base / Org Documents
- `KnowledgeBaseItemSchema` (`kb.ts`) — org-scoped KBs typed `DOCUMENTS | CONTENT_LIBRARY`; nav label "Org Documents" (`sidebar-layout.tsx:139`).
- `DocumentItemSchema` (`document.ts`) — S3 file (`fileKey`), extracted text (`textFileKey`), `indexStatus` lifecycle `pending → TEXT_EXTRACTED → CHUNKED → INDEXED`, freshness tracking; indexed via `document-pipeline-step-function` into Pinecone; chunks reloaded from S3 (`document-context.ts` `loadAndCompressChunks`). This is where uploaded CVs would land today.

### Org Navigation & Team Page
- Static nav array `apps/web/layouts/sidebar-layout/sidebar-layout.tsx:134–149`.
- "Org Members" (`/organizations/[orgId]/team` → `TeamContent`) is platform **user management**, distinct from the planned employee pool page.

## Shared Infrastructure Components

| Component | Location | Responsibility |
|---|---|---|
| DB helper layer | `apps/functions/src/helpers/db.ts` | all DynamoDB access (`createItem`, `queryBySkPrefix`, `queryByIndex`, …) |
| Bedrock HTTP client | `apps/functions/src/helpers/bedrock-http-client.ts` | only sanctioned Bedrock path; SSM API key |
| RBAC middleware | `apps/functions/src/middleware/rbac-middleware.ts` | `AuthedEvent`, auth/org-membership/permission checks |
| API orchestrator | `packages/infra/api/api-orchestrator-stack.ts` | index-aligned `allDomains[]`/`domainStackNames[]` registration (mismatch throws at synth) |
| Autofill tools | `apps/functions/src/helpers/autofill-fields-with-tools.ts` | tool-driven field autofill (top skimmed) |
| Collaboration WebSocket | `packages/infra/collaboration-websocket-stack.ts` | real-time collaboration API |
