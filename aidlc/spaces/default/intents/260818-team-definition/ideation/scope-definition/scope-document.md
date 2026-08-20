# Scope Document — Team Definition

Derived from the approved intent-statement (`../intent-capture/intent-statement.md`) and the confirmed answers in `scope-definition-questions.md` (Q1–Q6). No feasibility-assessment or constraint-register exists for this initiative — the feasibility stage is not part of this workflow's plan, so scope decisions rest on the intent statement and the requester's confirmed answers alone.

## Scope Summary

The minimum viable scope IS the full confirmed boundary: all four capability areas ship together as one release (Q1: A). Every capability below is a must-have (Q2: A, B, C, D, E — MoSCoW: all Must). There are no hard deadlines; quality takes priority over speed (Q5: A).

## In Scope

1. **Employee Pool Management** — an organization-level page to create, edit, and delete employees. Each employee can hold several roles, split into primary and secondary roles. The record holds: name, roles, certifications, résumé/bio reference, and on/offshore location.
2. **AI Employee List Generation** — a button that generates/populates the employee list by AI from the CVs already stored in the organization's documents.
3. **Solution-Plan Team Definition** — the solution plan includes personnel data (roles for now) and shows the AI-recommended team, each recommended person with a visible match rationale (matched certifications/skills). A modify-team flow lets the user change the team (specific persons or roles); the corrected team is what is saved.
4. **TEAM_QUALIFICATIONS Document Generation** — the team qualification document generates as part of the solution plan, citing the approved team's real employee data (this generation fails today for lack of personnel data).

## Out of Scope

Confirmed exclusions (Q6: A):

- A standalone opportunity-level Team Definition page — the Team Definition experience lives inside the solution plan.
- HR features beyond roles/CV data — no vacations, contacts, payroll, or similar directory features.
- Changes to how CVs are uploaded or stored in the organization's documents.
- Notifications/alerts about team or employee changes.

## Value Stream Map

| Capability | Customer outcome |
|------------|------------------|
| Employee Pool Management | Org admins maintain an accurate, structured personnel pool instead of unstructured CVs |
| AI Employee List Generation | The pool is populated with minimal manual effort from existing CV documents |
| Solution-Plan Team Definition | Proposal managers see a credible, correctable named team with reasons for each pick |
| TEAM_QUALIFICATIONS Generation | Proposals cite real people and real qualifications — the currently-failing document generates |

## Sequencing & Build Order

The requester delegated ordering (Q3: C — recommend and review; Q4: D — no strong preference). Recommended order — dependency-first, with the highest-uncertainty AI work pulled as early as dependencies allow:

1. **Employee Pool Management** — the foundation every other capability reads.
2. **AI Employee List Generation** — the riskiest piece (AI extraction quality); proving it early de-risks the rest.
3. **Solution-Plan Team Definition** — consumes the pool; second AI piece (matching with rationale) plus the modify flow.
4. **TEAM_QUALIFICATIONS Document Generation** — reads the approved team; last consumer in the chain.

## Constraints & Deadlines

- No hard or soft deadlines (Q5: A).
- No external constraint register exists; if constraints surface later, they are handled at requirements analysis.
