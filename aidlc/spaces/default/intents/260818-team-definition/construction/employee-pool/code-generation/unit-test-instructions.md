# Unit Test Instructions — employee-pool (U1)

Standard test strategy: 5–8 tests per component, unit tests plus integration-boundary coverage via mocked AWS SDK. All commands are scoped to THIS unit's files only.

## Framework Setup

No new test configuration needed — the repo's existing setups apply: Vitest in `packages/core`, Jest in `apps/functions` (AWS SDK + middy mocked before imports per `.claude/rules/09-testing.md`), Jest + React Testing Library in `apps/web` (tests in `__tests__/` subdirectories).

## Running THIS Unit's Tests

```bash
# Core schemas (Vitest)
cd packages/core && pnpm vitest run src/schemas/employee.test.ts

# Backend helpers + handlers (Jest, scoped by path pattern)
cd apps/functions && pnpm test -- --testPathPattern='(helpers/employee|handlers/employee)'

# Frontend feature (Jest, scoped)
cd apps/web && pnpm test -- --testPathPattern='features/employees'
```

## Expected Coverage

- `packages/core/src/schemas/employee.ts` — every schema exercised (create/update/item/list), defaults and enum rejections (≈6 tests).
- `apps/functions/src/helpers/employee.ts` — all five operations + org-scope guard (≈6 tests).
- `apps/functions/src/handlers/employee/*` — per handler: happy path, validation 400, not-found 404, permission-relevant shape (≈20 tests across 5 handlers).
- `apps/web/features/employees/*` — table/skeleton/empty/error states, form validation, role suggestions, permission-gated actions (≈7 tests).
- Target: comfortably above the web package's 50% global threshold for touched files; functions tests must keep the suite green.

## Mocking / Stubbing Guidance

- Mock `@middy/core` and the AWS SDK clients BEFORE importing handlers; test the exported business functions directly, never the middy-wrapped handler.
- `process.env.DB_TABLE_NAME` / `REGION` set in test setup.
- Frontend: mock SWR fetchers (`useApi`/`authenticatedFetcher`) at the hook boundary; use factory helpers for employee fixtures rather than JSON literals.
- Timestamps asserted with `expect.any(String)`.

## Test Data Management

- Employee fixtures via a local `makeEmployee(overrides)` factory in each test file; no shared mutable fixtures.
- Edge fixtures: long names (200 chars), many roles (10+), empty pool, org-mismatch records.
