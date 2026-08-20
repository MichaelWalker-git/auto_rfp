# Functional Design — employee-pool (U1) — Questions

Most of U1's behavior is settled by requirements.md (FR1, FR5.1) and the unit definition (unit-of-work.md). Two genuine gaps remain that upstream did not cover.

## Q1. Should an employee's own roles be linked to the org's labor-rate positions, or free text?

The staffing-plan linkage was settled for TEAM lines (plan-team unit); this is about the employee record itself. Labor rates define org-level position strings (e.g., "Senior Engineer").

A. Free text with suggestions — roles are plain strings; the UI suggests existing labor-rate positions and previously used roles while typing
B. Strict — an employee role MUST be one of the org's labor-rate positions
C. Plain free text — no suggestions, no linkage
D. Not yet defined — recommend during design
X. Other (please specify)

[Answer]: X. suggestions existing labor-rate positions but if existing rate doesnt content needed - free text (= option A semantics: suggest labor-rate positions, free text when no existing position fits)

## Q2. What happens when an employee who appears in a saved solution-plan team is deleted?

A. Block with guidance — deletion is refused while the employee is on any saved team; the error names the affected opportunities
B. Allow — saved teams keep a snapshot of the person's name/role; the team line is marked as referencing a removed employee
C. Cascade — deleting the employee silently removes their team lines
D. Not yet defined — recommend during design
X. Other (please specify)

[Answer]: B

## Consolidated Summary Confirmation

- Employee roles: free text with suggestions drawn from existing labor-rate positions; free text stands when no existing position fits (Q1: X ≈ A)
- Deleting an employee on a saved team: allowed — the team keeps a snapshot of name/role and the line is marked as referencing a removed employee (Q2: B)

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
