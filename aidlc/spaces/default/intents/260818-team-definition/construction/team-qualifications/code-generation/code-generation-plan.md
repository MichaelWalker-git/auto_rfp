# Code Generation Plan — team-qualifications (U4)

Read-side extension of the existing document-generation pipeline (unit-of-work.md U4). No new persistent entities, no new routes, no infra changes — the unit adds a grounded personnel context to TEAM_QUALIFICATIONS generation, a saved-team precondition on the request path, and a generation entry point in the solution plan's Team Definition section. Sources: functional-spec.md (W1), rules.md (BR1.1–BR3.1), entities.md (TeamQualificationsContext), requirements.md (FR4.1–FR4.3).

## Pinned decisions

- **"Saved team" (BR1.1)** = the plan item has a persisted `planTeam` with ≥1 member. An auto-attached synthesis team qualifies — the rule keys on persistence, not `savedAt`/`userModified`.
- **Guard placement**: `generate-document.ts`, BOTH paths (new document AND regenerate-into-existing), before any run is created or reset. Refusal is a 409 with `code: 'TEAM_REQUIRED'` and guidance to review/save the team first — no document record is touched (FR4.2).
- **Worker fallback**: if the team vanished between request and SQS delivery, the worker marks the run FAILED with a clear `generationError` — it never generates ungrounded personnel content. (BR1.1's no-FAILED-run guarantee is request-time only.)
- **Assembly reads the persisted team directly** (`plan.planTeam`) and does its own Employee lookups per BR2.5 — it does NOT reuse `getDerivedPlanTeam` (that is the UI derivation; reusing it would double-derive and hide the data-integrity warning path).
- **KB budgets unchanged** — BR2.1's exclusivity is enforced in the prompt (personnel come ONLY from the SAVED TEAM block; KB stays legitimate for corporate capabilities/certs).

## Steps

### Step 1: Context-assembly helper (backend business logic) — FR4.1, BR2.1–BR2.5
- [x] `apps/functions/src/helpers/team-qualifications-context.ts` (new):
  - `classifyTeamLine(member)` — BR2.5 detection order: no `employeeId` AND no `nameSnapshot` → UNFILLED; `removedEmployee` → DELETED; `employeeId` → FILLED; any other shape → log data-integrity warning, cite as pending replacement.
  - `hasSavedTeam(plan)` — persisted `planTeam` with ≥1 member (pinned decision above).
  - `assembleTeamQualificationsContext({ orgId, projectId, opportunityId })` — loads the plan (`getSolutionPlanByOpportunity`), loads the org pool once (`listEmployeesByOrg`), classifies each line, builds `{ opportunityId, members, openRoles, pendingReplacements }`: FILLED → structured fields (nameSnapshot, role, certifications, location) + CV text where `resumeRef` resolves (`getDocumentItemByDocumentId` → `textFileKey` → `loadTextFromS3`), missing/unresolvable CV → structured fields alone with the missing bio source noted (BR2.2); FILLED line whose Employee lookup misses → DELETED with data-integrity warning (BR2.5 fallback); UNFILLED → open role, no personnel claims; DELETED → nameSnapshot + role only, marked pending replacement (BR2.3).
  - `renderTeamContextBlock(context)` — plain-text block for the prompt; per-member CV cap + own total budget constant (the `SOLUTION_PLAN_TEXT_BUDGET` precedent), separate from the 18k enrichment blob.
  - CV loads wrapped in try/catch — a failed S3 read degrades to structured-fields-only, never fails assembly.

### Step 2: Helper tests — BR2.2, BR2.3, BR2.5
- [x] `team-qualifications-context.test.ts` (co-located): classification order (all three shapes + invalid shape warning), stale FILLED reference → DELETED + warning, CV resolvable vs unresolvable vs S3 failure, empty/missing team detection, budget truncation, openRoles/pendingReplacements population. (~10 tests)

### Step 3: Request-path guard — FR4.2, BR1.1, BR1.2
- [x] `apps/functions/src/handlers/rfp-document/generate-document.ts`: for `documentType === 'TEAM_QUALIFICATIONS'`, after input validation and before the run is created (new path) or reset (regenerate path), check `hasSavedTeam`; refuse with `apiResponse(409, { message: <guidance to review/save the team first>, code: 'TEAM_REQUIRED' })`. Existing preconditions (solution-plan gate, permissions) untouched (BR1.2).

### Step 4: Guard tests
- [x] Extend `generate-document.test.ts`: no plan / no team / empty members → 409 `TEAM_REQUIRED`, no `putRFPDocument`/`updateRFPDocumentMetadata`/enqueue call; team present → proceeds; non-TEAM_QUALIFICATIONS types unaffected; regenerate path also guarded. (~5 tests)

### Step 5: Worker + prompt injection — FR4.1, BR2.1, BR2.4
- [x] `apps/functions/src/helpers/document-prompts.ts`: add `teamContext?: string | null` to `UserPromptContext`; render a `SAVED TEAM (SOURCE OF TRUTH FOR PERSONNEL)` block (authoritative wording mirroring the solution-plan block: personnel claims come exclusively from this block; open roles listed as open positions; pending-replacement lines cited snapshot-only; never invent people — BR2.4 rides the existing validation). Update the TEAM_QUALIFICATIONS task instructions to reference the block instead of "personnel data from the Knowledge Base".
- [x] `apps/functions/src/helpers/generate-document-worker.ts`: for TEAM_QUALIFICATIONS, assemble the context alongside Step 4's parallel loads and pass the rendered block into `buildUserPromptForDocumentType`; when the team is absent at worker time, mark the run FAILED with a clear `generationError` (pinned decision).

### Step 6: Worker/prompt tests
- [x] Prompt builder: block rendered when `teamContext` present, omitted when null; task text no longer directs personnel sourcing to the KB. Worker: TEAM_QUALIFICATIONS job assembles + injects; missing team → FAILED with message; other doc types skip assembly. (~6 tests)

### Step 7: Frontend — generation entry point + view action — FR4.2, FR4.3, BR3.1
- [x] `apps/web/features/solution-plan/hooks/useGenerateTeamQualifications.ts` (new): posts to the existing `rfp-document/generate-document` endpoint with `documentType: 'TEAM_QUALIFICATIONS'`; surfaces the 409 `TEAM_REQUIRED` guidance; revalidates the opportunity's documents list.
- [x] `TeamDefinitionSection.tsx`: "Generate Team Qualifications" action (data-testid); disabled/guidance state when no saved team; in-flight state while GENERATING; when a TEAM_QUALIFICATIONS document exists for the opportunity, a View action linking to it among the plan's documents (reuse the existing rfp-documents hooks/routes — no new document surface).
- [x] Barrel export updated.

### Step 8: Frontend tests
- [x] Extend/add `__tests__` coverage: button renders with saved team, guidance on 409 / no team, generating state, view action when document READY. (~5 tests)

### Step 9: Type checks + scoped test runs
- [x] `cd apps/functions && pnpm build` (tsc) and scoped Jest run green.
- [x] `cd apps/web && npx tsc --noEmit` and scoped Jest run green.
- [x] No `packages/core` or `packages/infra` changes expected — verify nothing drifted (`pnpm build` in infra only if routes were touched; they should not be).

## Traceability (FR → steps)

| ID | Steps | Evidence target |
|----|-------|-----------------|
| FR4.1 (grounded generation) | 1, 2, 5, 6 | `apps/functions/src/helpers/team-qualifications-context.ts`, `document-prompts.ts`, `generate-document-worker.ts` |
| FR4.2 (saved-team precondition, guidance) | 3, 4, 7, 8 | `apps/functions/src/handlers/rfp-document/generate-document.ts`, `TeamDefinitionSection.tsx` |
| FR4.3 (document among plan documents, view) | 7, 8 | `TeamDefinitionSection.tsx` + existing documents pipeline |
| BR1.1 | 3, 4 | guard before run creation/reset |
| BR1.2 | 3 | existing gates untouched |
| BR2.1–BR2.3, BR2.5 | 1, 2 | context assembly + classification |
| BR2.4 | 5, 6 | prompt block wording + existing validation |
| BR3.1 | 7 | view action over existing pipeline placement |
