# Code Generation Plan — cv-import (U2)

Implements the approved functional design (`../functional-design/`: entities.md, rules.md, functional-spec.md) against FR2.1–FR2.5, NFR1/NFR2/NFR6 (unit-of-work.md U2). Import logic is owned by the employee domain; deployment reuses the existing extraction worker with a new EMPLOYEE target type (ADR-004). Direct-write import, merge-by-name, manual-edits-win via the extraction snapshot. Standard test strategy.

## Implementation Steps

- [x] **Step 1 — Core schemas** (`packages/core/src/schemas/employee-import.ts` + barrel export): `EmployeeImportRunItemSchema` (importRunId, orgId, status RUNNING/COMPLETED/COMPLETED_WITH_ERRORS/FAILED, documentsScanned, cvsDetected, employeesCreated, employeesUpdated, failedDocuments: array of {documentName ≤500, reason enum UNREADABLE/INCOMPLETE_EXTRACTION/EXTRACTION_FAILED/AMBIGUOUS_NAME}, triggeredBy, startedAt, completedAt optional) + DBItem + ListItem; `EmployeeExtractionSnapshotItemSchema` (employeeId, orgId, fields map, updatedAt) + DBItem. Add `EMPLOYEE` to the extraction target-type enum in `extraction-job.ts` (read it first; keep the draft-based targets untouched).
- [x] **Step 2 — Core schema tests** (`employee-import.test.ts`, Vitest): run statuses, failure-record shape (4 reasons), snapshot shape. ~5 tests.
- [x] **Step 3 — Rebuild core** (`pnpm --filter @auto-rfp/core build`).
- [x] **Step 4 — Backend constants + run/snapshot helpers** (`apps/functions/src/constants/employee-import.ts`: PK constants; `apps/functions/src/helpers/employee-import.ts`: SK builders, createImportRun (refuse when one is RUNNING for the org — BR1.1), getLatestImportRun, updateImportRunProgress, completeImportRun, getExtractionSnapshot, putExtractionSnapshot — all via `@/helpers/db`).
- [x] **Step 5 — Import engine helper** (`apps/functions/src/helpers/employee-import-engine.ts`): the run pipeline — list org documents with extracted text (reuse existing document helpers); classify CV/non-CV via the Bedrock HTTP client (BR2.1: no text → UNREADABLE; non-CV → silent skip; call failure → retry once then EXTRACTION_FAILED; 5 consecutive → abort run per BR4.2); extract fields (BR2.2: no name → INCOMPLETE_EXTRACTION); merge per BR3.1/BR3.3 (normalized-name match: exactly one → update via U1's updateEmployee with snapshot-based field precedence; none → createEmployee with source AI_IMPORT; several → AMBIGUOUS_NAME record); refresh snapshots; progress counters updated as documents process (BR5.1).
- [x] **Step 6 — Engine + helper tests** (Jest, Bedrock/db mocked): merge precedence (manual edit preserved, AI field updated), ambiguous name refusal, unreadable/incomplete/failed categorization, consecutive-failure abort, never-delete. ~8 tests.
- [x] **Step 7 — Worker branch** (`apps/functions/src/handlers/extraction/extraction-worker.ts`): add the EMPLOYEE targetType dispatch calling the import engine (direct write — bypasses the draft flow); job tracking reused; run completion writes the summary (BR4.1).
- [x] **Step 8 — Trigger + status handlers** (`apps/functions/src/handlers/employee/trigger-employee-import.ts` (POST, employee:manage; BR1.1 single-run guard; enqueues the extraction job with EMPLOYEE target) and `get-employee-import-run.ts` (GET, employee:read; latest run for progress/completion display)) + tests (~6).
- [x] **Step 9 — Routes** (extend `packages/infra/api/routes/employee.routes.ts` with POST /employee/import/trigger and GET /employee/import/latest; no new domain registration needed). Wire any queue/env the extraction worker needs for the new target (read the existing extraction stack first; reuse, don't create).
- [x] **Step 10 — Frontend import flow** (`apps/web/features/employees/`): `useEmployeeImport` hook (trigger + poll latest run while RUNNING, SWR refresh of the employee list on completion); enable the existing "Generate from CVs" button; `ImportProgressBanner` (progress counts, aria-live polite — NFR4) and `ImportResultBanner` (counts + named failed documents with reasons; plain-language; dismissible). Page stays usable during the run (BR5.1).
- [x] **Step 11 — Frontend tests** (~5: trigger disabled while RUNNING, progress banner renders counts, result banner lists failures by name, list refreshes on completion, button hidden without manage permission).
- [x] **Step 12 — Type checks + scoped tests** (core build; functions build + scoped tests; web tsc production code + scoped tests; infra build) — all green.

## Story-to-Step Traceability

| Requirement | Plan steps |
|-------------|-----------|
| FR2.1 (scan all org docs, detect CVs) | 5, 7 |
| FR2.2 (direct import, progress, usable page) | 5, 8, 10 |
| FR2.3 (merge by name, never delete) | 5 |
| FR2.4 (failure reporting, partial survival) | 5, 7, 10 |
| FR2.5 (field extraction) | 5 |
| NFR1/NFR2 (extraction quality, clean re-runs) | 5, 6 |
| NFR6 (async execution) | 7, 8 |
| BR1.1–BR5.1 | 4, 5, 7, 8, 10 (see rules.md) |
