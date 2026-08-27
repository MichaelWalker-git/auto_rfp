# Requirement-to-Unit Map — Team Definition

No stories.md exists in this workflow (the user-stories step is not in the plan), so this map assigns the functional requirements from requirements.md (`../requirements-analysis/`) to units, per the units-generation contract's FR fallback. Unit definitions and directories: `unit-of-work.md`; dependency shape: `unit-of-work-dependency.md`; component grounding: `../domain-design/components.md` and `../domain-design/decisions.md`.

## Requirement Assignment

| Requirement | Unit ID | Directory | Notes |
|-------------|---------|-----------|-------|
| FR1.1 | U1 | u1-employee-pool | Team page table |
| FR1.2 | U1 | u1-employee-pool | CRUD via separate pages |
| FR1.3 | U1 | u1-employee-pool | Employee record fields |
| FR1.4 | U1 | u1-employee-pool | Multi-role primary/secondary |
| FR1.5 | U1 | u1-employee-pool | Screen states |
| FR2.1 | U2 | u2-cv-import | Scan all org docs, detect CVs |
| FR2.2 | U2 | u2-cv-import | Direct import + progress |
| FR2.3 | U2 | u2-cv-import | Merge by name |
| FR2.4 | U2 | u2-cv-import | Failure reporting |
| FR2.5 | U2 | u2-cv-import | Field extraction |
| FR3.1 | U3 | u3-plan-team | Auto-generate with synthesis; preserve modified team |
| FR3.2 | U3 | u3-plan-team | Match rationale display |
| FR3.3 | U3 | u3-plan-team | Staffing position linkage |
| FR3.4 | U3 | u3-plan-team | In-place edit mode |
| FR3.5 | U3 | u3-plan-team | Personnel data in plan |
| FR3.6 | U3 | u3-plan-team | Empty-pool / failure states |
| FR4.1 | U4 | u4-team-qualifications | Cite real employee data |
| FR4.2 | U4 | u4-team-qualifications | No-team guard |
| FR4.3 | U4 | u4-team-qualifications | Document among plan docs |
| FR5.1 | U1 | u1-employee-pool | Employee permission strings |
| FR5.2 | U3 | u3-plan-team | Team editing under plan permissions |

## Cross-Cutting Concerns

- NFR3 (org scoping / personal-data protection) spans U1–U4 — enforced at every data path.
- NFR4/NFR5 (accessibility, responsiveness) span the UI-bearing units U1, U2, U3.
- NFR1/NFR2 (extraction quality, clean re-runs) verify within U2.
- NFR6 (async execution) verifies within U2 (import) and U3 (matching during plan generation).

## Implementation Order Within Units

- U1: schemas → backend domain + permissions → routes → Team page → create/edit pages.
- U2: detection/extraction helpers → worker EMPLOYEE branch + import run tracking → merge logic → UI progress states.
- U3: PlanTeam schema → matching engine → synthesis hook + preserve rule → team REST → section UI (view → edit).
- U4: context builder extension → no-team guard → document surfacing checks.

## Coverage Verification

- Every FR (21/21) is assigned to exactly one unit — no orphan requirements.
- Every unit carries at least one requirement: U1×7, U2×5, U3×7, U4×3 — no empty units.
