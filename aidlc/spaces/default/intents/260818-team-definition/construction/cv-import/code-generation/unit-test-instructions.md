# Unit Test Instructions — cv-import (U2)

Standard test strategy. All commands scoped to THIS unit's files only. Existing framework setups apply (Vitest in core, Jest in functions/web with the repo's mock patterns).

## Running THIS Unit's Tests

```bash
# Core schemas (Vitest)
cd packages/core && pnpm vitest run src/schemas/employee-import.test.ts

# Backend helpers, engine, worker branch, handlers (Jest, scoped)
cd apps/functions && pnpm test -- --testPathPatterns='(helpers/employee-import|handlers/employee/trigger-employee-import|handlers/employee/get-employee-import-run)'

# Frontend import flow (Jest, scoped)
cd apps/web && pnpm test -- --testPathPattern='features/employees.*[Ii]mport'
```

## Expected Coverage

- `employee-import.ts` schemas — statuses, 4-reason failure records, snapshot shape (≈5 tests).
- `helpers/employee-import.ts` + `employee-import-engine.ts` — single-run guard, categorization (UNREADABLE / INCOMPLETE_EXTRACTION / EXTRACTION_FAILED / AMBIGUOUS_NAME), retry-then-fail + consecutive-failure abort, merge precedence via snapshot (manual edits win), create-with-AI_IMPORT, never-delete (≈8 tests).
- Trigger/status handlers — happy path, single-run refusal with guidance, permission shape, latest-run retrieval (≈6 tests).
- Frontend — trigger/progress/result banners, list refresh, permission gating (≈5 tests).

## Mocking / Stubbing Guidance

- Mock the Bedrock HTTP client at the helper boundary (classification + extraction return fixtures); mock `@/helpers/db` operations per the repo's Jest pattern; middy mocked before handler imports; test `baseHandler` business functions.
- Snapshot-precedence tests: fixture an Employee whose field differs from the snapshot (manual edit) and one that matches (AI-owned) — assert only the AI-owned field updates.
- Frontend: mock the import hook's fetcher; fake timers for polling.

## Test Data Management

- Factories: `makeImportRun(overrides)`, `makeSnapshot(overrides)`, CV-text fixtures (well-formed, nameless, unreadable) per test file; no shared mutable fixtures.
