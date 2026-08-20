# Code Generation Plan — employee-pool (U1)

Implements the approved functional design (`../functional-design/`: entities.md, rules.md, functional-spec.md, frontend-components.md) against requirements FR1.1–FR1.5, FR5.1 (unit-of-work.md U1). Standard test strategy: 5–8 tests per component. All code lands at the workspace root per repo conventions; brownfield files are modified in place.

## Implementation Steps

- [x] **Step 1 — Core schemas** (`packages/core/src/schemas/employee.ts` + barrel export in `schemas/index.ts`): the 5-type pattern — `EmployeeCreateRequestSchema`/`EmployeeUpdateRequestSchema`/`EmployeeItemSchema` (id, orgId, name, primaryRoles, secondaryRoles, certifications, resumeRef, location, source, timestamps)/`EmployeeDBItemSchema` ([PK_NAME]/[SK_NAME])/`EmployeeListItemSchema`. Location `z.enum(['ONSHORE','OFFSHORE'])`, source `z.enum(['MANUAL','AI_IMPORT'])` defaulting MANUAL. Validation per BR1.1–BR1.4 (name non-empty ≤200, role entries non-empty ≤100, certifications ≤200). Realizes FR1.3, FR1.4.
- [x] **Step 2 — Core schema tests** (`packages/core/src/schemas/employee.test.ts`, Vitest): valid create parses; missing/empty name fails (BR1.1); empty role entry fails (BR1.2); invalid location fails (BR1.3); update is partial with identifiers omitted; defaults applied (source MANUAL). 6 tests.
- [x] **Step 3 — Permissions** (`packages/core/src/schemas/user.ts`): add `employee:read` and `employee:manage` to the permission enum; grant `employee:read` to all org roles, `employee:manage` to admin roles, following the existing per-role grant lists (FR5.1, BR2.1/BR2.2). Update the existing user schema tests if grants are asserted.
- [x] **Step 4 — Rebuild core** (`pnpm --filter @auto-rfp/core build`) so dependent packages compile against the new schemas.
- [x] **Step 5 — Backend constants + helpers** (`apps/functions/src/constants/employee.ts`: `PK.EMPLOYEE`; `apps/functions/src/helpers/employee.ts`: SK builder `{orgId}#{employeeId}`, `createEmployee`, `getEmployee`, `listEmployeesByOrg` (org-prefix query), `updateEmployee` (identity immutable, BR3.2), `deleteEmployee` — all via `@/helpers/db`, no raw SDK). Realizes BR2.3 org scoping.
- [x] **Step 6 — Helper tests** (`apps/functions/src/helpers/employee.test.ts`, Jest, AWS SDK mocked before imports): create persists with generated id + timestamps; list queries by org prefix; update preserves identity; delete removes; org mismatch → not found. 5–6 tests.
- [x] **Step 7 — Handlers** (`apps/functions/src/handlers/employee/`): `list-employees.ts`, `get-employee.ts`, `create-employee.ts`, `update-employee.ts`, `delete-employee.ts` — thin middy pattern (destructured `safeParse`, `apiResponse`, `withSentryLambda`, middleware stack with `requirePermission('employee:read'|'employee:manage')`), `orgId` from body/query/path only. Delete never blocked by team references (BR3.1). Realizes FR1.2, FR5.1.
- [x] **Step 8 — Handler tests** (co-located `*.test.ts`, middy + SDK mocked): happy path per handler, validation 400 with field detail (BR4.3), not-found 404, org-scope guard. ~6 tests per mutating handler group, ~20 total.
- [x] **Step 9 — Routes + registration** (`packages/infra/api/routes/employee.routes.ts`: GET /employee/list, GET /employee/get, POST /employee/create, PATCH /employee/update, DELETE /employee/delete with Cognito auth; register the domain in BOTH index-aligned arrays of `packages/infra/api/api-orchestrator-stack.ts`; explicit CloudWatch log groups per repo convention).
- [x] **Step 10 — Frontend feature module** (`apps/web/features/employees/`): hooks (`useEmployees` with search/filter/sort/pagination params, `useEmployee`, `useCreateEmployee`, `useUpdateEmployee`, `useDeleteEmployee` — SWR + `authenticatedFetcher`, `nuqs` URL state); components (`EmployeeTable` sortable + `data-testid`s, `EmployeeTableSkeleton`, `EmployeeEmptyState` naming both creation paths, `EmployeeErrorState` with retry, `EmployeeForm` with react-hook-form + zodResolver + `z.input`, `RoleTagInput` with labor-rate position suggestions and free text per BR1.5); barrel `index.ts`. Realizes FR1.1, FR1.5, BR4.1/BR4.2.
- [x] **Step 11 — Pages + navigation** (`apps/web/app/organizations/[orgId]/employees/page.tsx` + `loading.tsx` (PageLoadingSkeleton list), `employees/create/page.tsx`, `employees/[employeeId]/edit/page.tsx` — separate routes per convention; add an "Employees" entry to the org nav array in `apps/web/layouts/sidebar-layout/sidebar-layout.tsx`; permission-aware action visibility (managers see mutating actions). Delete confirmation names the snapshot behavior (W4).
- [x] **Step 12 — Frontend tests** (`__tests__/` beside components): table renders rows; skeleton on loading; empty state shows both actions; form field-level validation errors preserve input; RoleTagInput accepts free text and shows suggestions; non-manager sees no mutating actions. 6–8 tests.
- [x] **Step 13 — Type checks** (`cd apps/functions && pnpm build`; `cd apps/web && npx tsc --noEmit`; `cd packages/infra && pnpm build`) — all green before completion.

## Story-to-Step Traceability

| Requirement | Plan steps |
|-------------|-----------|
| FR1.1 (list page) | 9, 10, 11 |
| FR1.2 (CRUD via separate pages) | 5, 7, 11 |
| FR1.3 (record fields) | 1, 10 |
| FR1.4 (multi-role primary/secondary) | 1, 10 |
| FR1.5 (screen states) | 10, 11, 12 |
| FR5.1 (permissions) | 3, 7, 11 |
| BR1.1–BR1.5, BR2.x, BR3.x, BR4.x | 1, 5, 7, 10 (see rules.md) |
