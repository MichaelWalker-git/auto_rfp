# Code Summary — team-qualifications (U4)

All 9 plan steps executed (checkboxes marked in code-generation-plan.md).

## Files Created / Modified

**apps/functions** — `helpers/team-qualifications-context.ts` (new: `classifyTeamLine` with the BR2.5 fixed detection order UNFILLED → DELETED → FILLED plus invalid-shape warning; `hasSavedTeam` — BR1.1, persisted `planTeam` with ≥1 member; `assembleTeamQualificationsContext` — reads `plan.planTeam` directly, loads the org pool once via U1's `listEmployeesByOrg`, FILLED lines get structured fields + CV text via `resumeRef` → `getDocumentItemByDocumentId` → `loadTextFromS3` with try/catch degradation to structured-fields-only, stale FILLED reference degrades to pending replacement with a data-integrity warning, UNFILLED → openRoles, DELETED/invalid → pendingReplacements; `renderTeamContextBlock` with `TEAM_MEMBER_CV_TEXT_BUDGET` = 4k chars and `TEAM_CONTEXT_TEXT_BUDGET` = 24k chars, its own budget separate from the 18k enrichment blob), `team-qualifications-context.test.ts` (new, 15 tests); `handlers/rfp-document/generate-document.ts` (saved-team guard for TEAM_QUALIFICATIONS on BOTH paths — new document and regenerate — placed after orgId resolution and before any record is created or reset; 409 `{ code: 'TEAM_REQUIRED' }` with review/save guidance; solution-plan gate and permissions untouched — BR1.2) + 6 new guard tests in `generate-document.test.ts`; `helpers/document-prompts.ts` (`teamContext?: string | null` on `UserPromptContext`; `SAVED TEAM (SOURCE OF TRUTH FOR PERSONNEL)` block rendered between the solution-plan block and the enrichment context — exclusive personnel source, open-roles and pending-replacement handling, never-invent wording; `DOC_TYPE_TASK.TEAM_QUALIFICATIONS` re-pointed from "personnel data from the Knowledge Base" to the SAVED TEAM block) + 4 new prompt tests; `helpers/generate-document-worker.ts` (TEAM_QUALIFICATIONS context assembled inside Step 4's `Promise.all`; team absent at worker time → run marked FAILED with a clear `generationError` and the model is never invoked; `teamContext` passed via conditional spread so other doc types keep their exact prompt-context shape) + 3 new worker tests.

**apps/web** — `features/solution-plan/hooks/useGenerateTeamQualifications.ts` (new: posts through the existing `useGenerateRFPDocument`, exposes the newest TEAM_QUALIFICATIONS document + GENERATING/RETRYING in-flight state from the self-polling `useRFPDocuments`, revalidates the documents list after 202; `toTeamRequiredMessage` Zod-parses the 409 body with a `TEAM_REQUIRED_MESSAGE` fallback); `components/TeamDefinitionSection.tsx` ("Generate Team Qualifications" button — `data-testid="team-generate-qualifications"`, disabled + guidance line when no saved team, in-flight label while GENERATING, permission-wrapped; 409 guidance surfaced as a destructive toast; View action — `data-testid="team-qualifications-view"` — linking the READY document at the opportunity's rfp-documents route) + 6 new tests in `__tests__/TeamDefinitionSection.test.tsx`; barrel extended (hook, `toTeamRequiredMessage`, `TEAM_REQUIRED_MESSAGE`).

**packages/core / packages/infra** — no changes (verified via `git diff --name-only`); no new routes, schemas, or infrastructure.

## Key Implementation Decisions

- **Guard before `if (existingDocumentId)`** — one check covers both the new-document and regenerate paths before any record is created or reset (pinned decision); orgId is already resolved at that point, so the plan key is complete.
- **Worker FAILED-mark returns normally (no throw)** — "no saved team" at worker time is a deterministic condition; throwing would burn SQS retries on a run that can never succeed. Genuine read errors still throw and retry.
- **`teamContext` via conditional spread** in the worker keeps the exact prompt-context object shape for non-TEAM_QUALIFICATIONS types, so the existing exact-match worker tests stay valid.
- **Guard tests mock the leaf deps** (`@/helpers/document`, `@/helpers/employee`, `@/helpers/s3`) rather than the context module, so the real `hasSavedTeam` BR1.1 logic is exercised; the worker test mocks the module as a unit because its import chain reads `DOCUMENTS_BUCKET` at module load and only the wiring is under test.
- **Component test keeps the real `toTeamRequiredMessage`** (`jest.requireActual` spread) so the 409 body parsing is exercised end-to-end with a real `ApiError`.

## Test / Type-check Results

- Functions: `team-qualifications-context` 15/15; `generate-document.test` 14/14 (8 existing + 6 new); `(document-prompts|generate-document-worker)` 132/132; combined scoped run 161/161; regression `(solution-plan|plan-team|rfp-document)` 320/320; full suite 2692 passed / 38 skipped / 0 new failures (2 pre-existing fast-check suites unchanged); tsc clean.
- Web: `TeamDefinitionSection` 18/18 (12 existing + 6 new); full jest run 728/728; tsc — 0 errors in any file touched by this unit (pre-existing matcher noise + WinRateCard.tsx untouched).
- Coverage, new helper: 98.73% lines / 100% functions / 82.25% branches (≥80% floor met).

## Deviations / Known Issues

- `resumeRef` may be an external link rather than an org document id (schema comment); such refs do not resolve via `getDocumentItemByDocumentId` and degrade to structured-fields-only with the missing bio source noted — consistent with BR2.2.
- The generate-document handler Lambda now transitively imports `@/helpers/document`, which reads `DOCUMENTS_BUCKET` at module load; that variable is already in the API stack's `commonEnv`, so no infra change is needed — flagged for awareness only.
- Pre-existing repo issues untouched: web test-file tsc matcher noise, WinRateCard.tsx error, 2 functions suites failing on missing fast-check.

## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-08-20T05:25:05Z
**Iteration:** 1

### Findings

| # | Severity | Location | Finding | Recommendation |
|---|---|---|---|---|
| — | — | — | No defects found | — |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| `npx jest --testPathPatterns='(team-qualifications-context\|generate-document\|document-prompts)'` | **PASS**: 161/161 tests (15 team-qualifications-context + 14 generate-document + 132 prompt/worker tests) | All backend unit tests pass; BR1.1-BR3.1 implementation verified via tests |
| `pnpm build` (apps/functions) | **PASS**: TypeScript compilation clean | No type errors; all imports resolve correctly |
| `pnpm test TeamDefinitionSection.test.tsx` (apps/web) | **PASS**: 18/18 tests (12 existing + 6 new U4 tests) | Frontend integration tests pass; 409 handling, disabled-button guard, in-flight state, and View action all verified |

### Summary

All business rules correctly implemented with machine-verified evidence:

- **BR1.1 (saved-team precondition)**: Guard placed at lines 78-91 of generate-document.ts, BEFORE the `if (existingDocumentId)` branch at line 93 — covers both new-document and regenerate paths before any record is created or reset. Returns 409 with `code: 'TEAM_REQUIRED'` and guidance; no FAILED run is created. Verified by tests: refuses when plan is null, when planTeam is null, when members array is empty, and on both request paths.

- **BR2.5 (line classification order)**: `classifyTeamLine` function (lines 93-102 of team-qualifications-context.ts) implements the exact fixed detection order: (1) `!employeeId && !nameSnapshot` → UNFILLED, (2) `removedEmployee` → DELETED, (3) `employeeId` → FILLED, (4) anything else → INVALID with warning. Defensive fallback at lines 199-210: stale FILLED reference (Employee lookup miss despite `removedEmployee: false`) degrades to DELETED with data-integrity warning, never fatal.

- **BR2.1/BR2.4 (grounding exclusivity)**: Saved-team block injected at line 1417 of document-prompts.ts (between solution-plan and enrichment context), with explicit "EXCLUSIVE source" wording prohibiting invention or KB-sourced personnel (lines 1388-1398). DOC_TYPE_TASK.TEAM_QUALIFICATIONS (line 1028+) re-points from KB to the saved-team block. Worker assembles context at line 1064-1066, passes via conditional spread (lines 1159-1161) so other doc types maintain exact prompt shape.

- **BR2.2 (CV text degradation)**: `loadCvText` function (lines 122-149) degrades gracefully on all failure paths: no resumeRef, document not found, empty text, S3/DB exceptions — all return `{ cvText: null, cvMissingReason }`, never throw. Per-member budget (4k) applied at line 140.

- **BR2.3 (open roles / pending replacements)**: Assembly loop (lines 178-222) populates `openRoles` for UNFILLED lines, `pendingReplacements` for DELETED/INVALID lines — snapshot-only, no qualification claims.

- **BR3.1 (View action)**: Frontend TeamDefinitionSection.tsx (lines 344-352) offers View action (`data-testid="team-qualifications-view"`) linking the newest READY document at the opportunity's rfp-documents route; generation uses existing endpoint, document lands via existing pipeline.

**Repo conventions verified**: No `any` types; all types via `z.infer`; destructured `safeParse` (line 56 generate-document.ts, line 40 useGenerateTeamQualifications.ts); `orgId` from body/query (line 67 generate-document.ts, never from `event.auth`); `apiResponse` for REST returns (line 86, 190); const arrow functions throughout; tests co-located; Shadcn UI components (Button, Skeleton) + `data-testid` attributes (13 in TeamDefinitionSection.tsx); barrel exports updated (line 25-28 of index.ts); Bedrock N/A (no AI invocation in this unit).

**Traceability**: All 11 coverage entries in traceability.json map to existing workspace files; no broken references.
