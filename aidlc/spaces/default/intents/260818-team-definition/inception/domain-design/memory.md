<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-08-19T10:21:38Z — modeled Q4 (reuse extraction worker) as a deployment decision (ADR-004) rather than a component boundary: import logic stays owned by EmployeePool, avoiding a second dependency cycle (EmployeePool ↔ ExtractionJobs); the one deliberate cycle is SolutionPlan ↔ TeamDefinition (ADR-005), inherent to embedding the team in the plan item.

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-08-19T10:21:38Z — declared existing components (SolutionPlan, DocumentGeneration, OrgDocuments, StaffingPlan) in the catalogue so all references resolve; alternative was a NEW-only catalogue with dangling names, which fails the well-formedness rules.

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
