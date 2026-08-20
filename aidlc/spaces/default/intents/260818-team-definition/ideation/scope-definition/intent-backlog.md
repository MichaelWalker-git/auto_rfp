# Intent Backlog — Team Definition

Prioritized proto-units derived from the scope-document and the approved intent-statement (`../intent-capture/intent-statement.md`). MoSCoW applied per the confirmed answers (Q2: all five capability areas are Must). Build order follows the recommended dependency-first sequence with AI risk pulled early (scope-document, "Sequencing & Build Order").

## Backlog

| # | Proto-Unit | Priority (MoSCoW) | Depends on | Value / risk note |
|---|-----------|-------------------|------------|-------------------|
| PU-1 | Employee Pool Management — org-level page, employee CRUD, multiple primary/secondary roles, full record fields (name, roles, certifications, résumé/bio reference, on/offshore location) | Must | — | Foundation: every other unit reads this data |
| PU-2 | AI Employee List Generation — generate/populate the employee list by AI from CVs in org documents | Must | PU-1 | Highest uncertainty (extraction quality); scheduled early to de-risk |
| PU-3 | Solution-Plan Team Definition — personnel data (roles) in the solution plan, AI-recommended team with per-person match rationale, modify-team flow (change persons or roles), corrected team is saved | Must | PU-1 (PU-2 desirable for a populated pool) | The visible end-user payoff; second AI piece (matching) |
| PU-4 | TEAM_QUALIFICATIONS Document Generation — the team qualification document generates within the solution plan citing the approved team's real data | Must | PU-3 | Fixes the currently failing generation; last consumer in the chain |

## Won't Have (this time)

Per the confirmed exclusions (Q6: A):

- Standalone opportunity-level Team Definition page
- HR features beyond roles/CV data (vacations, contacts, payroll)
- Changes to CV upload/storage in org documents
- Notifications/alerts about team or employee changes

## Notes

- All four proto-units ship together as one release (Q1: A) — the sequence above is a build order within the release, not a release plan.
- No deadlines constrain the sequence (Q5: A).
