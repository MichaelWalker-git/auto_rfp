# Code Summary — plan-team (U3)

All 12 plan steps executed (checkboxes marked in code-generation-plan.md).

## Files Created / Modified

**packages/core** — `src/schemas/solution-plan.ts` (extended in place: `PlanTeamMemberSourceSchema`, `PlanTeamMemberSchema` with a `superRefine` enforcing the three line shapes — FILLED requires nameSnapshot, DELETED forbids employeeId and requires nameSnapshot, UNFILLED carries role only; `PlanTeamSchema` with userModified default false + generatedAt/savedAt; `PlanTeamSaveRequestSchema`; `PlanTeamResponseSchema`; `PlanTeamRegenerateResponseSchema`; `planTeam: PlanTeamSchema.nullish()` on the plan item — the costSchedule precedent, legacy plans parse without it), `plan-team.test.ts` (new, 12 Vitest tests).

**apps/functions** — `helpers/team-matching.ts` (new: full-pool load via U1's `listEmployeesByOrg` — ADR-003; slot sizing from the most recently updated staffing plan, or AI-proposed slots capped at 8 when none — BR1.3; deterministic scoring on role fit/certifications/location; ONE Bedrock HTTP call via `invokeModel` for ranking + rationale; regenerate-once-then-drop-to-unfilled on missing rationale — BR1.4; hallucinated-id guard; `{emptyPool: true}` prerequisite — BR4.1; typed `TeamMatchingError` — BR4.2); `helpers/plan-team.ts` (new: `deriveTeamMembers`/`getDerivedPlanTeam` — removedEmployee DERIVED ON READ against the pool, snapshots refreshed from live employees, GET never writes back; `saveUserEditedTeam` — userModified + savedAt + version bump; `attachGeneratedTeam` — skips matching entirely when userModified, BR1.2; `regenerateTeam` — resets userModified, clears savedAt, version bump, failure throws before any write); `helpers/solution-plan-worker.ts` (synthesis hook after the READY transition; hook failure logs and never fails synthesis — BR4.2, ADR-005 seam); handlers `solution-plan/get-plan-team.ts` (`proposal:read`), `save-plan-team.ts`, `regenerate-plan-team.ts` (both `proposal:create`, matching the existing plan endpoints; regenerate maps `TeamMatchingError` → 502 `TEAM_MATCHING_FAILED`), each with co-located tests. 41 scoped tests across matching/persistence/handlers + 2 new worker-hook tests.

**packages/infra** — `api/routes/solution-plan.routes.ts` extended: `GET team`, `PATCH team/save`, `POST team/regenerate` (timeout 120s / 512MB per the existing sync-AI route precedent). No new domain, no orchestrator change.

**apps/web** — `features/solution-plan/hooks/usePlanTeam.ts` (+ `planTeamKey`), `useSavePlanTeam.ts`, `useRegeneratePlanTeam.ts` (new); components `TeamDefinitionSection.tsx` (empty-pool state linking to the Employees page, failure alert with retry while manual edit stays available, regenerate confirmation — destructive wording when userModified), `TeamViewTable.tsx` (rationale column, "Removed from pool — pending replacement" badge, "Open role" badge), `TeamEditTable.tsx` (person Select over U1's pool, role Input with staffing-position datalist suggestions + free text per BR2.1, add/remove lines, Save/Cancel); `SolutionPlanPanel.tsx` renders the section inside the READY state; barrel extended; `__tests__/TeamDefinitionSection.test.tsx` (12 tests) and the existing panel test stubs the section.

## Key Implementation Decisions

- **removedEmployee derived on read** (pinned design gap): `getDerivedPlanTeam`/`saveUserEditedTeam` reconcile each referenced employeeId against the pool at serve/save time; GET is read-only (never writes back); rationale and nameSnapshot are retained on DELETED lines.
- savedAt clears on explicit regenerate — the whole `planTeam` map is replaced.
- Explicit team mutations (save/regenerate) bump the plan's monotonic version; the synthesis-attach does not (synthesis already bumped it).
- Empty pool during synthesis or regenerate leaves any existing team untouched (nothing to replace with — BR4.1 prerequisite state, not an error).
- One Bedrock call covers both modes: rank-into-fixed-slots (staffing plan present) or propose-slots-then-assign (none), AI slots capped at 8.

## Test / Type-check Results

- Core: build clean; `plan-team.test.ts` 12/12; full suite 816/816 green.
- Functions: `--testPathPatterns='(team-matching|plan-team)'` 41/41; all solution-plan suites 191/191; tsc clean.
- Web: `--testPathPattern='solution-plan'` 17 suites / 102 tests green; non-test tsc clean.
- Infra: tsc clean.

## Deviations / Known Issues

- `POST /solution-plan/team/regenerate` is a synchronous Bedrock call behind API Gateway — shortlist-sized prompt keeps latency well inside the gateway window, matching the existing sync-AI route pattern (e.g. required-forms reprocess).
- Pre-existing repo issues untouched: web test-file tsc matcher noise, WinRateCard.tsx error, 2 functions suites failing on missing fast-check.

## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-08-19T16:16:56Z
**Iteration:** 1

### Findings

| # | Severity | Location | Finding | Recommendation |
|---|---|---|---|---|
| 1 | Minor | `apps/functions/src/helpers/team-matching.ts:39` | MAX_AI_PROPOSED_SLOTS cap of 8 is not traced to a requirements-driven constraint — it appears to be an arbitrary limit on AI-proposed slots when no staffing plan exists (BR1.3 alternative path). | Document the rationale for the cap (e.g., "keeps the prompt size and UI rendering manageable while covering typical solicitation team sizes") or expose it as a configurable constant with a clear business justification. This is not a blocker as the cap is reasonable, but future maintainers may question whether to raise/lower it. |
| 2 | Minor | `packages/core/src/schemas/solution-plan.ts:260` | savedAt documentation states "cleared by an explicit regenerate" but doesn't specify the mechanism — code inspection confirms `regenerateTeam` creates a fresh team object with no savedAt field, which is correct, but a developer reading only the schema comment might expect an explicit `savedAt: undefined` assignment. | No code change needed; the implementation is correct. Consider clarifying the comment to "absent (undefined) after an explicit regenerate" for precision. |
| 3 | Info | Cross-unit reference | Employee.id vs employeeId naming mismatch between functional-design artifact (U1 entities.md line 10 uses "employeeId") and workspace implementation (Employee schema uses "id"). | No action required — the workspace standardizes on `id` per repo conventions (5-type pattern always uses `id` for the entity identifier). The functional design's `employeeId` was an artifact-level name; the implementation correctly follows the established pattern. This is not an error, just a cross-artifact naming variance to note for traceability. |
| 4 | Info | Test coverage | Handler tests (get/save/regenerate-plan-team.test.ts) test the exported business functions directly per conventions, but the test file names might suggest they test the handlers — a reader might expect to see middy middleware verification. | No action required — the convention is correct (test the business function, not the middy wrapper). The handler wrappers are thin enough that their correctness is evident from inspection. Consider a comment in each handler test file noting "tests the business function; middy middleware correctness verified by inspection per repo conventions" if future confusion arises. |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| `pnpm build` (core) | PASS | 12/12 tests green, build clean |
| `npx jest --testPathPatterns='(team-matching\|plan-team)'` (functions) | PASS | 41/41 tests green covering matching/persistence/handlers |
| `pnpm build` (functions) | PASS | TypeScript compilation clean, no type errors |
| `pnpm test -- TeamDefinitionSection` (web) | PASS | 12/12 frontend tests green, all BRs/FRs explicitly tested |
| `pnpm build` (infra) | PASS | CDK synthesis clean |

### Business Rules Verification

All 12 business rules (BR1.1–BR5.2) verified against implementation:

| BR | Rule | Implementation Location | Status |
|----|------|------------------------|--------|
| BR1.1 | Auto-propose team at synthesis | `solution-plan-worker.ts:264-273` synthesis hook calls `attachGeneratedTeam` | ✓ PASS |
| BR1.2 | User-modified preserved; explicit regenerate replaces | `plan-team.ts:134-142` checks `userModified`, returns early; `regenerateTeam` resets flag | ✓ PASS |
| BR1.3 | One member per staffing position; AI slots otherwise | `team-matching.ts:346-356` derives slots from staffing plan, falls back to AI-proposed slots capped at 8 | ✓ PASS |
| BR1.4 | Short-sentence rationale per AI recommendation | `team-matching.ts:303-305` checks `hasMissingRationale`, regenerates once, then drops to unfilled | ✓ PASS |
| BR2.1 | Role → staffing position ref where exists | `solution-plan.ts:210-211` schema includes `staffingPositionRef` optional field; matching sets it per slot | ✓ PASS |
| BR3.1 | Save persists + marks user-modified; Cancel discards | `plan-team.ts:117-132` sets `userModified: true`, `savedAt`, bumps version; Cancel is client-side (TeamDefinitionSection.tsx:126-130) | ✓ PASS |
| BR3.2 | Saved team is what documents read | Documented in schema comment line 246; enforced by persistence primitives reading `plan.planTeam` | ✓ PASS |
| BR3.3 | Removed-employee lines render from snapshots, marked | `plan-team.ts:40-56` `deriveTeamMembers` reconciles each employeeId against pool, drops id and sets flag when missing | ✓ PASS |
| BR4.1 | Empty pool → prerequisite state | `team-matching.ts:376-377` returns `{emptyPool: true}`; handler maps to response | ✓ PASS |
| BR4.2 | Matching failure → error + retry + manual assembly | `team-matching.ts:52-60` `TeamMatchingError` wrapper; synthesis hook try-catch line 268-273 logs and never fails plan | ✓ PASS |
| BR5.1 | Solution-plan permissions govern team edits | Handler middleware `requirePermission('proposal:read')` for GET, `'proposal:create'` for save/regenerate | ✓ PASS |
| BR5.2 | Full-pool matching, no vector index | `team-matching.ts:4-5` comment + `listEmployeesByOrg` loads full pool; scoring is deterministic + one Bedrock call | ✓ PASS |

### Conventions Verification

| Convention | Status | Evidence |
|------------|--------|----------|
| No `any` types | ✓ PASS | `grep -r ": any"` across helpers/handlers returned no matches |
| Types inferred from Zod | ✓ PASS | All domain types use `z.infer<typeof Schema>` pattern |
| Thin handlers | ✓ PASS | All three handlers follow parse→validate→helper→apiResponse pattern; destructured `safeParse` on line 28/33 |
| orgId from request | ✓ PASS | No `event.auth.*orgId` found; identifiers sourced from query params (GET) or body (PATCH/POST) |
| Bedrock via HTTP only | ✓ PASS | `team-matching.ts:21` imports `invokeModel` from `bedrock-http-client`; no direct SDK import |
| Middy middleware stack | ✓ PASS | All handlers use authContext→orgMembership→requirePermission→httpError per lines 44-48 |
| withSentryLambda wrapper | ✓ PASS | All three handlers wrapped on export line 43/48/54 |
| DynamoDB via helpers | ✓ PASS | Handlers call `plan-team.ts` helpers; helpers use `db.ts` primitives (updateItem, no raw SDK) |
| Tests co-located | ✓ PASS | `.test.ts` files adjacent to every handler and helper |
| Test business functions | ✓ PASS | Tests import and invoke the exported function directly, not the middy wrapper |
| Frontend 'use client' | ✓ PASS | `TeamDefinitionSection.tsx:0` directive present |
| Shadcn UI only | ✓ PASS | Imports Alert, Button, Skeleton from `@/components/ui` |
| Skeleton loading | ✓ PASS | `TeamDefinitionSection.tsx:8` imports Skeleton; loading states use it (line 176-184 in component) |
| Types from @auto-rfp/core | ✓ PASS | `PlanTeamMember` imported from core on line 15 |
| Barrel exports | ✓ PASS | `index.ts` exports all hooks and components with named exports |

### Traceability Coverage

All 7 functional requirements (FR3.1–FR3.6, FR5.2) traced to implementation:

- **FR3.1** (auto-generate + preserve): Matching engine (`team-matching.ts`) + synthesis hook (`solution-plan-worker.ts:264-273`) + attach logic (`plan-team.ts:134-142`)
- **FR3.2** (rationale display): Schema field (`solution-plan.ts:212-213`) + matching output (`team-matching.ts:303-305`) + UI rendering (`TeamViewTable.tsx`)
- **FR3.3** (staffing position linkage): Schema field (`solution-plan.ts:210-211`) + slot derivation (`team-matching.ts:346-356`) + UI suggestions (`TeamDefinitionSection.tsx:77-82`)
- **FR3.4** (in-place edit, save persists): Save helper (`plan-team.ts:117-132`) + handlers (save-plan-team.ts) + UI edit mode (`TeamEditTable.tsx` + `TeamDefinitionSection.tsx:88-136`)
- **FR3.5** (personnel data in plan): Schema field `planTeam` on plan item (`solution-plan.ts:344`)
- **FR3.6** (empty pool / failure states): Empty pool return (`team-matching.ts:376-377`) + `TeamMatchingError` wrapper (`team-matching.ts:52-60`) + UI states (`TeamDefinitionSection.tsx:168-203`)
- **FR5.2** (solution-plan permissions): Handler middleware (`get-plan-team.ts:47`, `save-plan-team.ts:52`, `regenerate-plan-team.ts:58`)

### Cross-Unit Reference Integrity

- **U1 dependency** (`listEmployeesByOrg`): Resolves to `apps/functions/src/helpers/employee.ts:109`; returns `EmployeeItem[]` with `id` field matching plan-team's `employeeId` references. Verified against U1 functional design entities.md (Employee entity line 10-14); workspace implementation standardizes identifier to `id` per repo conventions.
- **Staffing plan reference**: `getStaffingPlansByOpportunity` resolves to `apps/functions/src/helpers/pricing.ts`; returns `StaffingPlan[]` with `laborItems` containing `position` field matched by team-matching slot derivation.

### Pinned Decisions Compliance

1. **removedEmployee derived on read** (code-generation-plan.md line 5): Implemented in `plan-team.ts:40-56` `deriveTeamMembers` function; GET handler reads-only (never writes back); save helper derives and persists as side effect. ✓ VERIFIED
2. **Three line shapes only** (entities.md line 189-196): Enforced by `PlanTeamMemberSchema.superRefine` on `solution-plan.ts:218-240`; matching output conforms (`team-matching.ts:249-268`). ✓ VERIFIED
3. **savedAt clears on regenerate** (code-summary.md line 18): `regenerateTeam` creates fresh team object with no `savedAt` field (`plan-team.ts:163-169`). ✓ VERIFIED
4. **userModified survives regeneration** (BR1.2): `attachGeneratedTeam` early-returns on `plan.planTeam?.userModified` check (`plan-team.ts:138-140`). ✓ VERIFIED

### Summary

**The implementation is READY for approval.** All 12 plan steps executed successfully with comprehensive test coverage (41 backend + 12 frontend + 12 core = 65 tests, all green). Business rules BR1.1–BR5.2 are correctly implemented and explicitly tested. Repo conventions are followed without deviation: thin handlers with destructured validation, orgId from request params, Bedrock via HTTP client only, no `any` types, co-located tests, Shadcn UI with skeleton loading states, barrel exports, and proper permission gating.

The pinned design decisions are faithfully implemented: `removedEmployee` is derived on read (reconciled against the pool at serve/save time with no write-back on GET), the three line shapes are enforced via Zod `superRefine`, `savedAt` is cleared (absent) on explicit regenerate, and user-modified teams survive plan regeneration. Cross-unit references resolve correctly (U1's `listEmployeesByOrg` returns `EmployeeItem[]` with the expected `id` field).

The four minor/info findings are documentation clarifications and naming variance notes — none block the implementation. The MAX_AI_PROPOSED_SLOTS cap of 8 is reasonable but undocumented; the savedAt mechanism is correct but could be more explicit in comments; the employeeId vs id naming variance between functional design and workspace is a harmless standardization to repo conventions; and the handler test naming convention is correct per repo rules but could benefit from a clarifying comment if confusion arises.

All validation commands pass, traceability is complete (7/7 FRs covered with implementation locations), and the code is production-ready.
