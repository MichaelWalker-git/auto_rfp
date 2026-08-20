# Units of Work — Team Definition

Derived from the component catalogue and decision records (`../domain-design/components.md`, `../domain-design/decisions.md`), requirements.md (`../requirements-analysis/`), and the approved decomposition plan in `units-generation-questions.md` (Q1–Q4). No stories.md exists in this workflow; traceability keys on FR IDs.

## Unit Definitions

| Unit ID | Directory | Unit | Kind | Complexity | Deployment |
|---------|-----------|------|------|------------|------------|
| U1 | u1-employee-pool | employee-pool | service | M | shared (existing monorepo deploy) |
| U2 | u2-cv-import | cv-import | service | M | shared |
| U3 | u3-plan-team | plan-team | service | L | shared |
| U4 | u4-team-qualifications | team-qualifications | service | S | shared |

All four units are vertical slices (schemas → backend → routes → UI) through the existing monorepo; "shared" deployment means they ship via the existing deploy pipeline (Q2: A) as one release.

## U1 — employee-pool

- **Boundary**: the EmployeePool component's CRUD half plus the EmployeesFeatureUI module.
- **Responsibilities**: Employee entity schemas (5-type pattern in core); employee REST domain (list/get/create/update/delete) with the new employee permission strings (admins manage, members view — FR5.1); the org-level Team page (table with search/filter/sort/pagination), separate create/edit pages, skeleton/empty/error states; route registration.
- **Delivers**: FR1.1–FR1.5, FR5.1.
- **Constraints**: follow the 5-type entity pattern, thin handlers, db helpers, FSD frontend module (`features/solution-plan/` is the exemplar); new nav entry in the org sidebar.

## U2 — cv-import

- **Boundary**: the EmployeePool component's AI-import half (logic owned by EmployeePool per ADR-004).
- **Responsibilities**: CV detection across all org documents; field extraction via the AI HTTP client; direct-write import with merge-by-name (update existing, add new, never delete — FR2.3); EmployeeImportRun tracking; partial-failure reporting; the EMPLOYEE target type in the existing extraction worker (deployment reuse, ADR-004); import progress + completion UI on the Team page.
- **Delivers**: FR2.1–FR2.5, NFR1, NFR2, NFR6 (import path).
- **Constraints**: no draft-review step (direct import); writes employees only through U1's persistence helpers (Q4: A); async off the request path.

## U3 — plan-team

- **Boundary**: the TeamDefinition component plus the SolutionPlanFeatureUI team section.
- **Responsibilities**: PlanTeam schema (structured field on the solution plan item, ADR-002); matching engine — full pool, deterministic + AI scoring, per-person rationale (ADR-003); generation-pipeline hook (propose team during synthesis, preserve user-modified team — FR3.1, ADR-005); team save / explicit-regenerate REST behavior under existing solution-plan permissions (FR5.2); role linkage to staffing plan positions (FR3.3); Team Definition section UI — view mode with rationale, in-place edit mode, empty-pool and failure states.
- **Delivers**: FR3.1–FR3.6, FR5.2.
- **Constraints**: reads employees via U1's read helpers; persists only onto the plan item (no new table rows); the deliberate SolutionPlan ↔ TeamDefinition interaction is confined to the seams named in ADR-005.

## U4 — team-qualifications

- **Boundary**: the DocumentGeneration extension.
- **Responsibilities**: TEAM_QUALIFICATIONS context builder reads the saved PlanTeam and referenced Employee records so generation cites real people (FR4.1); the no-saved-team guard returns guidance instead of a FAILED run (FR4.2); document appears among the plan's documents with view (FR4.3).
- **Delivers**: FR4.1–FR4.3.
- **Constraints**: read-only against U1/U3 data via their read paths; changes stay within the generation pipeline's existing budget/prompt/tool structure.

## Implementation Notes

- U2 and U3 are mutually independent (Q3: A) — both depend only on U1's Employee entity and helpers.
- NFR3 (org scoping / data protection) and NFR4–NFR5 (accessibility, responsiveness) apply across all UI-bearing units (U1, U2, U3).

## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-08-19T11:01:38Z
**Iteration:** 1

### Findings

| # | Severity | Location | Finding | Recommendation |
|---|---|---|---|---|
| — | — | — | No blocking issues found | Proceed to approval gate |

### Validation Results

| Check | Result | Evidence |
|---|---|---|
| YAML edge block well-formedness | PASS | 4 units declared once; all lowercase names with hyphens; every depends_on reference resolves to a declared unit; no self-dependencies |
| Acyclic dependency graph | PASS | Valid topological order: employee-pool → cv-import → plan-team → team-qualifications; Python cycle detection confirms DAG structure |
| Unit kind validity | PASS | All 4 units marked as `kind: service` (valid enum value) |
| Required content completeness | PASS | unit-of-work.md contains all required elements: U{n} IDs (U1-U4), directory names, responsibilities, deployment model (shared), complexity (M/M/L/S), kind (service), constraints |
| FR coverage completeness | PASS | All 21 FRs from requirements.md mapped exactly once with status "OK"; no gaps, no duplicates; targets U1×6, U2×5, U3×7, U4×3 |
| Target validity | PASS | All traceability.json targets (U1-U4) are declared units |
| Topology-only (no economic sequencing) | PASS | No "build order", "critical path", "recommend implement first", "risk-first", or "value-first" language found in any artifact; "Parallel Development Opportunities" section describes valid topological orderings (what CAN be done), not economic choice (what SHOULD be done first) |
| Component boundary adherence | PASS | EmployeePool (ADR-001 one component) split into U1 (CRUD) + U2 (import) for work packaging per Q1:A; architectural integrity preserved via U2 writing only through U1's helpers (integration surface documented) |
| ADR constraint satisfaction | PASS | ADR-002 (PlanTeam as plan field) implemented in U3; ADR-003 (full-pool matching) implemented in U3; ADR-004 (import logic owned by EmployeePool, writes via U1 helpers) implemented in U2; ADR-005 (deliberate cycle) handled by U3 extending SolutionPlan |
| Independent implementability | PASS | U1 has no dependencies; U2/U3 depend on U1 (Employee entity + helpers contract sufficient); U4 depends on U3 (PlanTeam contract sufficient); all integration surfaces documented with clear mechanisms |
| Project rule adherence | PASS | Direct import (U2), merge-by-name (FR2.3 in U2), auto-generation with preservation (FR3.1 in U3), team embedded in plan (U3 PlanTeam field), import logic owned by EmployeePool (ADR-004, U2 boundary), extraction worker reuse (ADR-004, U2 deployment), deliberate cycle (ADR-005, U3 constraints) |

### Summary

The Units Generation artifacts are **architecturally sound and ready for approval**. The YAML edge block is well-formed and acyclic with all 4 units declared once, all dependencies valid, and no self-references or cycles. All required content is present: stable U{n} IDs, directory names, a complete table, per-unit responsibilities/deployment/complexity/kind/constraints. Every functional requirement (21/21) is assigned to exactly one unit with valid targets. The artifacts contain topology only — no economic sequencing smuggled in — per the stage protocol's mandate that units-generation produces the dependency DAG while delivery-planning chooses the economic path through it.

**Component boundary handling**: The EmployeePool component (ADR-001: one architectural block owning Employee CRUD + AI import) is split into two units (U1 CRUD, U2 import) for work packaging. This split is explicitly approved in Q1:A ("four vertical slices... keeps each AI risk isolated in its own unit") and preserves architectural integrity: U2's boundary description states "logic owned by EmployeePool per ADR-004", and the integration surface documents that U2 writes "only through U1's persistence helpers". This is a valid work-packaging cut that respects the architectural ownership while enabling parallel development opportunities (U2 and U3 are independent once U1 delivers the Employee contract).

**ADR constraint satisfaction**: Every ADR decision is correctly reflected. ADR-002's embedded PlanTeam persistence is implemented in U3. ADR-003's full-pool matching (no vector index) is implemented in U3. ADR-004's import logic ownership and extraction-worker reuse is implemented in U2 with explicit helper indirection. ADR-005's deliberate SolutionPlan ↔ TeamDefinition cycle is handled by U3 extending the existing SolutionPlan component, with both sides (synthesis hook + team persistence) confined to U3's scope.

**Independent implementability**: Every unit can be built once its dependencies deliver their contracts. U1 (employee-pool) is independently implementable with no dependencies. U2 (cv-import) and U3 (plan-team) both depend only on U1's Employee entity schemas and helper functions — sufficient integration surface to proceed in parallel after U1. U4 (team-qualifications) depends on U3's saved PlanTeam field — sufficient contract to implement document generation extension.

**Traceability**: traceability.json correctly enumerates all 21 FRs with status "OK" and valid targets that match the story-map. No requirements are orphaned or duplicated. The unit-of-work-story-map.md provides clear FR-to-unit assignments with directory names for construction path resolution.

All project rules from scope-definition, rough-mockups, and domain-design are honored: direct import with merge-by-name (U2), auto-generation with user-edit preservation (U3), team embedded in plan item (U3), import logic owned by EmployeePool with extraction-worker reuse as deployment detail (U2 per ADR-004), deliberate cycle contained to ADR-005 seams (U3). No contradictions or unresolved conflicts found.

**Recommend approval to proceed to Construction phase.**
