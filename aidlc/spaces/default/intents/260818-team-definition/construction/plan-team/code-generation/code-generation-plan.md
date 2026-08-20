# Code Generation Plan — plan-team (U3)

Implements the approved functional design (`../functional-design/`: entities.md, rules.md, functional-spec.md) against FR3.1–FR3.6, FR5.2 (unit-of-work.md U3). PlanTeam embeds in the solution plan item (ADR-002); matching is full-pool deterministic + AI (ADR-003); the SolutionPlan ↔ TeamDefinition interaction stays on the ADR-005 seams. Standard test strategy.

**Design gap pinned here** (open finding from the design review): the `removedEmployee` mark is **derived on read** — whenever the team is served (GET plan team / after save), the backend checks each referenced employeeId against the pool and sets the flag in the returned/persisted data; no U1-side cascade, no batch job. This is the cheapest mechanism, matches U4's defensive fallback, and involves no schema change.

## Implementation Steps

- [x] **Step 1 — Core schemas** (`packages/core/src/schemas/solution-plan.ts` extended in place): `PlanTeamMemberSchema` (employeeId optional, nameSnapshot optional, role required, staffingPositionRef optional, rationale optional, removedEmployee boolean default false, source enum AI_RECOMMENDED/MANUAL) with the three line shapes documented; `PlanTeamSchema` (members, userModified default false, generatedAt/savedAt optional); `planTeam` as a nullable optional field on the solution plan item (the costSchedule precedent); save-request schema. Barrel already exports solution-plan.
- [x] **Step 2 — Core schema tests** (extend `solution-plan` tests or add `plan-team.test.ts`, Vitest): line shapes (filled/deleted/unfilled), userModified default, save-request validation. ~6 tests.
- [x] **Step 3 — Rebuild core.**
- [x] **Step 4 — Matching engine** (`apps/functions/src/helpers/team-matching.ts`): load the full org pool via U1's read helpers (ADR-003); slot sizing — one member per staffing plan position (read staffing plan via the existing pricing helpers), or AI-proposed slots from the solicitation requirements when no staffing plan (BR1.3); deterministic scoring (role-name fit, certifications, location) + one Bedrock HTTP call for ranking/rationale (BR1.4: one-or-two-sentence rationale per AI-recommended member; a recommendation without rationale is regenerated once); unfillable positions → unfilled lines (no employee, no rationale); empty pool → empty result with prerequisite signal (BR4.1); matching failure → typed error that never blocks the plan (BR4.2).
- [x] **Step 5 — Team persistence helpers** (`apps/functions/src/helpers/plan-team.ts`): getPlanTeam (derive removedEmployee on read against the pool), savePlanTeam (validate, set userModified + savedAt, refresh snapshots' shapes per line rules, persist onto the plan item via the existing solution-plan update path), attachGeneratedTeam (used by synthesis: skip when userModified — BR1.2), regenerateTeam (explicit action: fresh recommendation, reset userModified).
- [x] **Step 6 — Synthesis hook** (existing solution-plan worker): after synthesis completes, invoke matching and attach the proposed team per BR1.1/BR1.2 (preserve user-modified); matching failure logs and leaves the team untouched — the plan still completes (BR4.2, ADR-005 seam).
- [x] **Step 7 — Backend tests** (Jest, ~12): sizing per positions / AI slots, rationale presence, preserve-on-regen vs explicit-regenerate reset, save semantics, derive-on-read removedEmployee, empty pool, matching failure isolation.
- [x] **Step 8 — Handlers** (`apps/functions/src/handlers/solution-plan/` or team-scoped files per existing domain layout): GET plan team (existing solution-plan read permission), PUT/PATCH save team + POST regenerate team (existing solution-plan edit permission — FR5.2, BR5.1) + tests (~8).
- [x] **Step 9 — Routes** (extend `solution-plan.routes.ts` with the team endpoints; no new domain).
- [x] **Step 10 — Frontend team section** (`apps/web/features/solution-plan/` extension): hooks (`usePlanTeam`, `useSavePlanTeam`, `useRegenerateTeam`); components (`TeamDefinitionSection` — view mode table: person snapshot/role/rationale, removed-employee mark, unfilled slots as open roles; in-place edit mode: person picker over U1's pool, role editor with staffing position suggestions + free text (BR2.1), add/remove lines, Save/Cancel per BR3.1; explicit Regenerate with confirmation; empty-pool prerequisite state linking to the Team page (BR4.1); failure state with retry + manual assembly still available (BR4.2)); wire into the existing solution plan view; the team qualification document actions surface stays for U4.
- [x] **Step 11 — Frontend tests** (~8: view renders rationale, removed mark, unfilled slots, edit save/cancel, regenerate confirmation, empty pool state, failure state, permission gating).
- [x] **Step 12 — Type checks + scoped tests** (core build + tests; functions build + scoped tests; web scoped tests; infra build) — all green.

## Story-to-Step Traceability

| Requirement | Plan steps |
|-------------|-----------|
| FR3.1 (auto-generate + preserve) | 4, 5, 6 |
| FR3.2 (rationale display) | 4, 10 |
| FR3.3 (staffing position linkage) | 4, 10 |
| FR3.4 (in-place edit, save persists) | 5, 8, 10 |
| FR3.5 (personnel data in plan) | 1, 10 |
| FR3.6 (empty pool / failure states) | 4, 10 |
| FR5.2 (solution-plan permissions) | 8 |
| BR1.1–BR5.2 | 1, 4, 5, 6, 8, 10 (see rules.md) |
