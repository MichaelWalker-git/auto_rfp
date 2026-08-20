# Units Generation — Questions

Grounded in components.md and decisions.md (domain design) and requirements.md. These settle how the components are grouped into buildable units of work. Build-order/priority questions are deliberately absent — they were settled at scope definition and sequencing is not this step's job.

## Q1. How should the work be cut into units?

A. Four vertical slices mirroring the approved backlog — employee-pool (EmployeePool CRUD + Team page UI), cv-import (AI extraction flow), plan-team (TeamDefinition + plan team section UI), team-qualifications (document generation extension); recommended: matches the confirmed capability boundaries and keeps each AI risk isolated in its own unit
B. Three units — merge cv-import into employee-pool (pool and import ship together)
C. Layered units — schemas, backend, frontend as separate units
D. Not yet defined — recommend at the gate
X. Other (please specify)

[Answer]: A

## Q2. What deployment model do the units follow?

A. Shared deployment — all units land in the existing monorepo and ship through the existing deploy (new route stack + worker branch included); units are work packages, not deploy targets; recommended: matches the one-release decision and the repo's structure
B. Independent deployment — each unit gets its own deployable stack
C. Not yet defined — recommend at the gate
X. Other (please specify)

[Answer]: A

## Q3. May independent units be built in parallel where dependencies allow?

The natural dependency shape: cv-import and plan-team both depend on employee-pool but not on each other; team-qualifications depends on plan-team.

A. Yes — units without a dependency between them may proceed in parallel; recommended: keeps options open without changing the dependency structure
B. No — strictly one unit at a time in dependency order
C. Not yet defined — recommend at the gate
X. Other (please specify)

[Answer]: A

## Q4. Integration points between units — confirm the contract surfaces

Proposed: cv-import writes employees only through employee-pool's persistence helpers; plan-team reads employees via employee-pool's read helpers and persists the team as the plan-item field; team-qualifications reads the saved team + employee records through the same read paths. No new events or shared tables beyond these.

A. Confirmed — these are the only integration surfaces between units
B. Mostly — adjust something (please specify in Other)
C. Not yet defined — recommend at the gate
X. Other (please specify)

[Answer]: A

## Consolidated Summary Confirmation

- Unit cut: four vertical slices — employee-pool, cv-import, plan-team, team-qualifications (Q1: A)
- Deployment: shared — existing monorepo deploy; units are work packages (Q2: A)
- Parallelism: allowed where the dependency structure permits (Q3: A)
- Integration surfaces: confirmed as proposed — no new events or shared tables (Q4: A)

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
