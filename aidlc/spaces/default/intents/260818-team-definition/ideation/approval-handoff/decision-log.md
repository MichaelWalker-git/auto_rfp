# Decision Log — Ideation Phase (Team Definition)

Every decision made during Ideation, with its source. Sources: intent-statement, stakeholder-map (`../intent-capture/`), scope-document, intent-backlog (`../scope-definition/`), wireframes (`../rough-mockups/`), and the three stages' question files. No competitive-analysis, feasibility-assessment, constraint-register, or team-assessment was produced (those stages are not in this workflow's plan).

## Intent Capture (approved 2026-08-19)

| # | Decision | Source |
|---|----------|--------|
| 1 | Problem is broader than RFP output — org needs general employee management too | intent Q1: B |
| 2 | Users: org admins (maintain pool) + proposal managers (consume in solution plans) | intent Q2: C |
| 3 | Success = pool populated by AI from CVs AND end-to-end consumption (team section + TEAM_QUALIFICATIONS generates) | intent Q3: C |
| 4 | Trigger: customer/RFP pressure for named key personnel | intent Q4: B |
| 5 | Requester decides scope/priority; dev team influences; product owner/manager kept in the loop | intent Q6: A, Q10: B |
| 6 | Communication: regular progress updates (PR descriptions, standup notes) | intent Q7: B |
| 7 | Team Definition lives INSIDE the solution plan (no separate opportunity-level page), modifiable, with per-person match rationale | intent Q8: X, Q9: A |
| 8 | Employee record fields: name, roles (primary/secondary), certifications, résumé/bio reference, on/offshore location | intent Q11: A |

## Scope Definition (approved 2026-08-19)

| # | Decision | Source |
|---|----------|--------|
| 9 | Minimum viable scope = the full confirmed boundary; one release | scope Q1: A |
| 10 | All four capability areas are Must (MoSCoW) | scope Q2: A–E |
| 11 | Build order: employee pool page → AI CV extraction → solution-plan team → TEAM_QUALIFICATIONS generation (dependency-first, AI risk early) | scope Q3: C, Q4: D |
| 12 | No deadlines — quality over speed | scope Q5: A |
| 13 | Exclusions confirmed: no standalone opportunity-level page, no HR features, no CV upload changes, no notifications | scope Q6: A |

## Rough Mockups (approved 2026-08-19)

| # | Decision | Source |
|---|----------|--------|
| 14 | Employee page is a new top-level org-navigation item | mockups Q1: A |
| 15 | Table/list layout with separate create/edit routes | mockups Q2: A |
| 16 | AI generation is DIRECT import; cleanup via normal editing | mockups Q3: B |
| 17 | Solution-plan team section edits in place (no dialog) | mockups Q4: A |
| 18 | Desktop-first responsive; accessibility per existing app conventions (WCAG AA baseline) | mockups Q5: A, Q6: A |
| 19 | Reviewer note carried forward: Screen 2 (create/edit) documents four states; add a fifth (e.g., save-success or edit-load) during refined design | rough-mockups review |

## Approval & Handoff (this stage)

| # | Decision | Source |
|---|----------|--------|
| 20 | Requester's gate approval is sufficient sign-off | handoff Q1: A |
| 21 | Four risks acknowledged with mitigations/follow-ups (extraction quality, rationale credibility, duplicate merge rule, personnel data sensitivity) | handoff Q2: A |
| 22 | Resourced to build now (AI-assisted, requester reviewing) | handoff Q3: A |
| 23 | Wireframes reflect the shared vision | handoff Q4: A |

## Carried follow-ups for Inception

- Quantify "kept current with minimal manual effort" success metric (intent-capture review finding).
- Settle the duplicate/merge rule for re-running CV generation (rough-mockups open question).
- Pin personnel-data handling expectations (handoff risk #4).
