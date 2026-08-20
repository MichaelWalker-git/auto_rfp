# Unit Test Instructions — plan-team (U3)

Standard test strategy. All commands scoped to THIS unit's files. Existing framework setups apply.

## Running THIS Unit's Tests

```bash
# Core schemas (Vitest) — the plan-team additions to the solution-plan schema
cd packages/core && pnpm vitest run src/schemas/plan-team.test.ts

# Backend matching/persistence/handlers (Jest, scoped)
cd apps/functions && pnpm test -- --testPathPatterns='(team-matching|plan-team)'

# Frontend team section (Jest, scoped)
cd apps/web && pnpm test -- --testPathPattern='solution-plan.*[Tt]eam'
```

## Expected Coverage

- Schemas — three line shapes, defaults, save-request validation (≈6 tests).
- `team-matching.ts` — position-driven sizing, AI slot proposal, rationale presence + regenerate-once, unfilled lines, empty pool, failure isolation (≈7 tests).
- `plan-team.ts` — save semantics (userModified/savedAt), preserve-on-regen vs explicit reset, derive-on-read removedEmployee (≈5 tests).
- Handlers — team GET/save/regenerate happy + permission + validation paths (≈8 tests).
- Frontend — view (rationale, marks, open slots), edit save/cancel, regenerate confirmation, empty/failure states, permission gating (≈8 tests).

## Mocking / Stubbing Guidance

- Mock Bedrock at the helper boundary (ranking/rationale fixtures); mock U1's employee read helpers and the pricing staffing-plan reader; mock the solution-plan persistence path per the repo's Jest patterns; middy mocked before handler imports.
- Derive-on-read tests: fixture a saved team referencing one existing and one missing employeeId — assert the missing line comes back marked with snapshots intact.
- Frontend: mock hooks at the fetcher boundary; fixture teams with all three line shapes.

## Test Data Management

- Factories: `makeTeam(overrides)`, `makeMember(shape)` (filled/deleted/unfilled), staffing-plan fixtures with 2–3 positions; no shared mutable fixtures.
