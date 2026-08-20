# Integration Test Instructions — Team Definition (all units)

Standard test strategy: key-boundary integration coverage for the cross-unit seams. Sources: per-unit `code-summary.md` and `unit-test-instructions.md` files under `construction/<unit>/code-generation/`, plus `code-generation-plan.md` per unit for the seam inventory.

## Cross-Unit Boundaries Under Test

| # | Boundary | Direction | Verified by |
|---|----------|-----------|-------------|
| 1 | cv-import → employee-pool | U2 writes employees ONLY through U1's persistence helpers (merge-by-name, never delete) | `apps/functions/src/helpers/employee-import-engine.test.ts` (merge precedence, create path) |
| 2 | plan-team → employee-pool | U3 matching reads the full pool via `listEmployeesByOrg`; derive-on-read reconciles stale employeeIds | `apps/functions/src/helpers/team-matching.test.ts`, `plan-team.test.ts` |
| 3 | plan-team → solution-plan pipeline | Synthesis hook attaches a generated team after READY; hook failure never fails synthesis | `apps/functions/src/helpers/solution-plan-worker.test.ts` (2 hook tests) |
| 4 | team-qualifications → plan-team | U4 reads the persisted `plan.planTeam` and classifies lines per the U3 line-shape contract (BR2.5) | `apps/functions/src/helpers/team-qualifications-context.test.ts` |
| 5 | team-qualifications → org-documents | CV text resolution via `resumeRef` → document `textFileKey` → S3, with degradation | `team-qualifications-context.test.ts` (CV resolvable / unresolvable / S3 failure) |
| 6 | team-qualifications → document generation | Request guard before run creation; SAVED TEAM block injection in the worker prompt path | `apps/functions/src/handlers/rfp-document/generate-document.test.ts`, `generate-document-worker.test.ts`, `document-prompts.test.ts` |
| 7 | Frontend ↔ REST | Team section hooks against team GET/save/regenerate and generate-document (409 TEAM_REQUIRED parsing) | `apps/web/features/solution-plan/components/__tests__/TeamDefinitionSection.test.tsx` (real 409-body parser) |

These boundary tests live co-located with the code (repo convention) rather than in a separate integration suite; they exercise the real business functions with the AWS SDK mocked at the client boundary — the integration contract (call shapes, key construction, merge semantics) is what they pin.

## How to Run

```bash
# All cross-unit boundary suites (backend)
cd apps/functions && pnpm test -- --testPathPatterns='(employee-import|team-matching|plan-team|solution-plan-worker|team-qualifications-context|generate-document|document-prompts)'

# Frontend boundary suite
cd apps/web && pnpm test -- --testPathPattern='TeamDefinitionSection'
```

## Environment / Test Data

- No live AWS needed: DynamoDB/S3/Bedrock mocked before imports; env vars set per test file.
- Fixtures are factory-style per file (`makeEmployee`, `makeTeam`, `makeMember`, CV-text fixtures); no shared mutable state.

## Coverage Expectations (Standard)

- Every boundary in the table has at least one happy-path and one failure/degradation test.
- Boundary 1 must pin never-delete; boundary 3 must pin hook-failure isolation; boundary 4 must pin the stale-reference fallback; boundary 6 must pin refusal-before-run-creation.

## Future (not in this release)

- Playwright e2e for the Team page → import → plan team → generate document journey (`apps/web pnpm test:e2e`) once a seeded dev environment exists for employee data.
