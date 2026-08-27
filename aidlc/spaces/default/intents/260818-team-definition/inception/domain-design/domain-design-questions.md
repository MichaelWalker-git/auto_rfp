# Domain Design — Questions

Grounded in requirements.md (FR1–FR5, NFR1–NFR6) and the code knowledge base (architecture.md, component-inventory.md). These pin the component boundaries before the catalogue is written.

## Q1. How should the new building blocks be cut?

A. Two components — EmployeePool (employee CRUD + the CV-extraction flow) and TeamDefinition (matching, team persistence, and the plan-side behavior); recommended: extraction and pool share the employee entity and change together, while team logic changes with the solution plan
B. Three components — EmployeePool (CRUD), CvExtraction (import worker), TeamMatching (recommendation) as separate blocks
C. One component — a single "personnel" block owning everything from pool to plan team
D. Not yet defined — recommend at the gate
X. Other (please specify)

[Answer]: A

## Q2. Where does the saved (approved) team live?

The codebase precedent: the solution plan already carries a structured `costSchedule` field alongside its HTML body.

A. A structured field on the solution plan item (the costSchedule precedent) — recommended: the team is plan-scoped, versioned with the plan, read by document generation exactly like the cost schedule
B. A separate team entity keyed by opportunity — independent lifecycle from the plan
C. Not yet defined — recommend at the gate
X. Other (please specify)

[Answer]: A

## Q3. How does team matching find candidate employees?

The past-performance engine indexes projects in the vector database and scores hits deterministically. The employee pool is expected to be small (tens to low hundreds).

A. No vector index — load the org's full employee pool and match deterministically + with AI against the plan's roles and requirements; recommended: the pool is small, this avoids a new index type and keeps extraction simpler
B. Mirror the past-performance engine — index employees in the vector database (new metadata type) and semantic-search first
C. Not yet defined — recommend at the gate
X. Other (please specify)

[Answer]: A

## Q4. How should CV extraction be built?

An extraction worker pattern already exists (SQS worker dispatching on target type, producing draft records) — but this feature uses direct import, no draft step.

A. Extend the existing extraction worker with a new EMPLOYEE target type that writes employees directly (skipping the draft flow) — recommended: reuses job tracking, queue wiring, and document handling
B. A new dedicated employee-import worker inside the employee domain — clean separation from the draft-based flows
C. Not yet defined — recommend at the gate
X. Other (please specify)

[Answer]: A

## Q5. How should the frontend be structured?

A. A new `employees` feature module (pool page + create/edit) and an extension of the existing `solution-plan` feature (team section) — recommended: matches the app's feature-per-domain layout and the solution-plan exemplar
B. One new `team-definition` feature module owning both the org page and the plan section
C. Not yet defined — recommend at the gate
X. Other (please specify)

[Answer]: A

## Consolidated Summary Confirmation

- Component split: EmployeePool (CRUD + CV extraction) and TeamDefinition (matching + team persistence + plan-side behavior) (Q1: A)
- Saved team: structured field on the solution plan item, costSchedule precedent (Q2: A)
- Matching: no vector index — full-pool deterministic + AI matching (Q3: A)
- CV extraction: extend existing extraction worker with EMPLOYEE target type, direct write (Q4: A)
- Frontend: new `employees` feature + extend `solution-plan` feature (Q5: A)

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
