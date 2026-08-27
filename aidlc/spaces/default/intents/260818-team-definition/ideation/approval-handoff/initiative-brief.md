# Initiative Brief — Team Definition

One-page summary compiling the Ideation artifacts: intent-statement and stakeholder-map (`../intent-capture/`), scope-document and intent-backlog (`../scope-definition/`), and wireframes (`../rough-mockups/`). No competitive-analysis, feasibility-assessment, constraint-register, or team-assessment exists — market research, feasibility, and team formation are not part of this workflow's plan, and their checks were adapted in `approval-handoff-questions.md` (Q1–Q4).

## Intent & Problem

RFP responses need named key personnel with real qualifications, but a "Team Definition" today is abstract roles with rates — there is no personnel data in the system, which is why TEAM_QUALIFICATIONS document generation fails. The org also needs a general employee-management surface. CVs of all team members already exist in org documents; nothing turns them into structured data. (Full statement: intent-statement.)

## Scope Boundary

Per the scope-document, all four capability areas ship as one release, all Must:

1. Org-level employee page — multi-role records (primary/secondary), fields: name, roles, certifications, résumé/bio reference, on/offshore location
2. AI "generate employee list from CVs" — direct import, cleanup via normal editing
3. Solution-plan Team Definition — recommended team with per-person match rationale, modifiable in place; the corrected team is what's saved
4. TEAM_QUALIFICATIONS document generation citing the approved team

Out: standalone opportunity-level team page, HR features beyond roles/CV data, CV upload/storage changes, notifications. (Backlog: intent-backlog, PU-1…PU-4.)

## Concept Visuals

Four wireframed screens (wireframes + user-flow, rough-mockups): the Team page (table, search/filter, generate + add actions), the employee create/edit page, the AI import flow with progress and partial-failure reporting, and the solution-plan Team Definition section with in-place edit mode and document actions. Approved at the Rough Mockups gate.

## Risk Highlights

Acknowledged by the requester (Q2: A), with mitigations:

| Risk | Mitigation |
|------|------------|
| AI CV extraction quality across heterogeneous formats | Built early (build order #2); post-import editing corrects errors |
| Match-rationale credibility | Modify-team flow keeps a human in control of the saved team |
| Duplicate employees on re-run | Merge rule to be settled at requirements analysis |
| Personnel data sensitivity (CVs contain personal data) | Handling expectations to be pinned at requirements analysis |

## Stakeholders & Team Plan

Requester decides; product owner/manager kept in the loop via regular progress updates; org admins and proposal managers are the users; the development work is AI-assisted with the requester reviewing at every gate (Q1: A, Q3: A; stakeholder-map).

## Go/No-Go Recommendation

**GO.** Intent, scope, backlog, and visuals are approved and consistent; risks are acknowledged with mitigations or named follow-ups; resourcing is committed (Q3: A); the wireframes reflect the shared vision (Q4: A). Recommended next: proceed to the design-and-build phases, starting with a scan of the existing codebase.
