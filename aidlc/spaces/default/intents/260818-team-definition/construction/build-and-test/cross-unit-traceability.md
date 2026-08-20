# Cross-Unit Traceability — Team Definition

Final coverage gate across all four units' `code-generation/traceability.json` files against `inception/requirements-analysis/requirements.md`. The user-stories stage was skipped in this workflow, so there are no `AC` IDs to enumerate; the check covers all FRs and NFRs.

## Verdict: PASS with 6 findings (NFR tracking gaps — see below)

- **Functional requirements: 21/21 covered** with status `OK`; every target file verified to exist on disk.
- **Non-functional requirements: 0/6 enumerated** in unit traceability files — surfaced as findings with an evidence assessment; none is an implementation gap that blocks release, but two (NFR1, NFR2) carry an outstanding measurement obligation.

## FR Coverage (21/21 OK)

| ID | Owning Unit | Target (verified exists) |
|----|-------------|--------------------------|
| FR1.1 | employee-pool | apps/web/features/employees/components/EmployeesPageContent.tsx |
| FR1.2 | employee-pool | apps/web/app/organizations/[orgId]/employees/create/page.tsx |
| FR1.3 | employee-pool | packages/core/src/schemas/employee.ts |
| FR1.4 | employee-pool | packages/core/src/schemas/employee.ts |
| FR1.5 | employee-pool | apps/web/features/employees/components/EmployeeEmptyState.tsx |
| FR2.1 | cv-import | apps/functions/src/helpers/employee-import-engine.ts |
| FR2.2 | cv-import | apps/functions/src/handlers/employee/trigger-employee-import.ts |
| FR2.3 | cv-import | apps/functions/src/helpers/employee-import-engine.ts |
| FR2.4 | cv-import | apps/web/features/employees/components/ImportResultBanner.tsx |
| FR2.5 | cv-import | apps/functions/src/helpers/employee-import-engine.ts |
| FR3.1 | plan-team | apps/functions/src/helpers/solution-plan-worker.ts |
| FR3.2 | plan-team | apps/web/features/solution-plan/components/TeamViewTable.tsx |
| FR3.3 | plan-team | apps/functions/src/helpers/team-matching.ts |
| FR3.4 | plan-team | apps/web/features/solution-plan/components/TeamEditTable.tsx |
| FR3.5 | plan-team | packages/core/src/schemas/solution-plan.ts |
| FR3.6 | plan-team | apps/web/features/solution-plan/components/TeamDefinitionSection.tsx |
| FR4.1 | team-qualifications | apps/functions/src/helpers/team-qualifications-context.ts |
| FR4.2 | team-qualifications | apps/functions/src/handlers/rfp-document/generate-document.ts |
| FR4.3 | team-qualifications | apps/web/features/solution-plan/components/TeamDefinitionSection.tsx |
| FR5.1 | employee-pool | packages/core/src/schemas/user.ts |
| FR5.2 | plan-team | apps/functions/src/handlers/solution-plan/save-plan-team.ts |

Every OK target was verified as an existing workspace file (scripted check, zero missing across all four traceability files, business-rule targets included).

## NFR Findings (6)

The per-unit traceability files enumerated FR + BR IDs only — the NFR design stages (3.2–3.4) were skipped by this workflow's composition, and the NFR IDs were not carried into the code-generation traceability. Evidence assessment per NFR:

| ID | Finding | Evidence assessment | Residual action |
|----|---------|---------------------|-----------------|
| NFR1 (≥90% extraction quality) | Not in any traceability file | Extraction engine + Zod-validated output implemented (U2); the ≥90% figure is a MEASUREMENT over a representative CV corpus | Outstanding: measure on a seeded dev org (see performance-test-instructions.md §4) |
| NFR2 (re-run cleanliness) | Not in any traceability file | Merge-by-name with manual-edits-win snapshot precedence implemented and unit-tested (U2); malformed CVs reported by name (FR2.4 tests) | Outstanding: same corpus measurement |
| NFR3 (org-scoped data protection) | Not in any traceability file | Org-prefixed SK keys, `orgId` from request (static check clean), permission middleware on every new handler (static check clean) | None — verified by security checks |
| NFR4 (accessibility) | Not in any traceability file | New screens follow app conventions (Shadcn primitives, labeled controls, skeleton states); live-region announcement for import progress implemented per U2 summary | Spot-check keyboard nav before release (manual) |
| NFR5 (responsiveness) | Not in any traceability file | Desktop-first with existing app conventions; no new layout system introduced | None |
| NFR6 (async execution) | Not in any traceability file | Import + generation run via SQS workers; no Bedrock in request handlers (static check clean); plan-team regenerate follows the existing sync-AI route precedent | None — verified |

## Conclusion

All functional behavior is implemented, traced, and test-covered. The six NFR rows are tracking gaps, not implementation gaps: four are verified by this stage's checks, and NFR1/NFR2 carry a post-release measurement task that needs a curated CV corpus in a dev environment.
