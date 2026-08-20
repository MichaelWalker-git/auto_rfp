# Unit Test Instructions — team-qualifications (U4)

Test strategy: **Standard** (5-8 tests per component, unit tests + key-boundary coverage). U4 touches three backend components (context helper, request guard, worker/prompt injection) and one frontend component (Team Definition section) — target ≈26 tests total.

## Frameworks & setup

- **Backend** (`apps/functions`): Jest + ts-jest, existing config. Mock middy and AWS SDK before imports per repo convention; mock `@/helpers/s3` (`loadTextFromS3`), `@/helpers/solution-plan`, `@/helpers/employee`, `@/helpers/document`, and `@/helpers/bedrock-http-client` — no live AWS calls. Env vars (`DB_TABLE_NAME`, `DOCUMENTS_BUCKET`, `REGION`) set at the top of each test file.
- **Frontend** (`apps/web`): Jest + React Testing Library, existing config. Mock the feature hooks (`useGenerateTeamQualifications`, documents list hook) at module level; assert on roles/test-ids, skeleton loading states.

## How to run THIS UNIT's tests (scoped — never a bare project-wide command)

```bash
# Backend: context helper + guard + worker/prompt tests
cd apps/functions && pnpm test -- --testPathPatterns='(team-qualifications-context|generate-document)'

# Frontend: Team Definition section (generation entry point + view action)
cd apps/web && pnpm test -- --testPathPattern='TeamDefinitionSection'
```

Type checks:

```bash
cd apps/functions && pnpm build
cd apps/web && npx tsc --noEmit
```

## What to cover (per component)

**`team-qualifications-context.ts` (~10 tests)**
1. Happy path: FILLED lines → members with structured fields + CV text.
2. Detection order: UNFILLED (no employeeId, no nameSnapshot) → openRoles.
3. DELETED (removedEmployee) → pendingReplacements, snapshot-only.
4. Stale FILLED reference (Employee lookup misses) → treated as DELETED + data-integrity warning logged (BR2.5 fallback).
5. Invalid shape (nameSnapshot present, no employeeId, removedEmployee false) → warning + pending replacement, never dropped.
6. CV unresolvable (no resumeRef / document missing / no textFileKey) → structured fields alone, missing bio source noted.
7. S3 read failure → degrades to structured-fields-only, assembly does not throw.
8. `hasSavedTeam`: no plan / no planTeam / empty members → false; auto-attached team (userModified false) → true.
9. Budget: per-member CV cap and total block budget enforced.
10. Render: block contains members, open roles, pending replacements sections.

**`generate-document.ts` guard (~5 tests)**
1. TEAM_QUALIFICATIONS + no saved team → 409 `TEAM_REQUIRED`, no record written, nothing enqueued.
2. TEAM_QUALIFICATIONS + saved team → 202, run created and enqueued.
3. Regenerate path (existing documentId) + no saved team → 409, document not reset.
4. Other document types → guard not applied.
5. Guidance message present in the 409 body.

**`document-prompts.ts` / `generate-document-worker.ts` (~6 tests)**
1. `teamContext` present → SAVED TEAM block in user prompt.
2. `teamContext` null → block omitted, prompt unchanged for other types.
3. TEAM_QUALIFICATIONS task instructions no longer source personnel from KB.
4. Worker assembles + injects for TEAM_QUALIFICATIONS jobs.
5. Worker: team absent at worker time → run FAILED with clear generationError.
6. Worker: non-TEAM_QUALIFICATIONS job skips assembly.

**`TeamDefinitionSection.tsx` (~5 tests)**
1. Generate action renders when a saved team exists (data-testid present).
2. No saved team → guidance state instead of silent failure.
3. 409 `TEAM_REQUIRED` response → guidance surfaced.
4. In-flight generation → loading state (skeleton/disabled, no spinner text).
5. READY TEAM_QUALIFICATIONS document → View action visible.

## Coverage target

New backend helper ≥80% line coverage; guard and worker changes covered by the scenario tests above. Existing suites (`solution-plan`, `rfp-document`) must remain green.

## Test data management

Factory-style inline fixtures per file (plan with planTeam variants, employees with/without resumeRef, document items with/without textFileKey). Timestamps asserted with `expect.any(String)`. No shared mutable fixtures.
