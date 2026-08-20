# Intent Statement — Team Definition

## Problem Statement

RFP responses need named key personnel with real qualifications, but today a "Team Definition" is only abstract roles with rates — there is no personnel data anywhere in the system, which is also why TEAM_QUALIFICATIONS document generation fails. [desc] [Q1]

Beyond the RFP-response gap, the organization also needs a general employee/staff management capability (an HR-style directory at the organization level), which does not exist today. [Q1]

The organization already holds the raw material to close this gap: CVs of all team members are stored in the organization's documents, but nothing turns them into structured, searchable personnel data. [desc]

## Target Customer

Both internal user groups benefit, in complementary ways: [Q2]

- **Organization admins** maintain the employee pool — each employee can hold several roles, split into primary and secondary roles — and can populate the list with AI assistance from the CVs already stored in org documents. [desc] [Q2]
- **Proposal managers / BD staff** consume the pool in solution plans: the solution plan includes personnel data (roles for now) and the team qualification document, with the ability to modify the generated team (specific persons or roles). [desc] [Q2]

## Success Metrics

Success is end-to-end: the pool is populated AND downstream consumption works. [Q3]

- The organization-level employee page is populated via AI extraction from the CVs in org documents, and kept current with minimal manual effort. [desc] [Q3]
- Opening the team section of a solution plan shows a proposed team with roles, and each recommended person carries a visible match rationale (matched certifications/skills). [Q3] [Q9]
- The TEAM_QUALIFICATIONS document generates successfully, citing real employee data, where today it fails. [Q1] [Q3]
- A user can modify the generated team (swap specific persons or roles) in the solution plan UI, and the corrected team is what downstream documents use. [desc] [Q8]

## Initiative Trigger

Customer/RFP pressure: solicitations increasingly demand named key personnel, and the current output — abstract roles without named people — is not credible to reviewers. [Q4]

## Initial Scope Signal

**Workflow-selected scope** (workflow-selected): `team-definition` — a tailored plan covering ideation, requirements, design, and construction stages for this feature. [scope]

**User-confirmed product boundary** [Q8] [Q9]:

- An organization-level employee management page: employees with multiple roles (primary and secondary), plus an AI-powered "generate employee list from CVs" action reading the CVs in org documents. [desc] [Q8]
- The employee record holds: name, roles (primary/secondary), certifications, résumé/bio reference, and on/offshore location. [Q11]
- Solution-plan integration: the solution plan includes personnel data (roles only for now) and the team qualification document. [desc] [Q8]
- The task doc's Team Definition experience lives **inside the solution plan** — not as a separate opportunity-level page — showing the recommended team with per-person match rationale, and it is modifiable there (change specific persons or roles). [Q8] [Q9]
- AI-recommended team matching (résumés matched to required certifications/skills) is included as the generation behind the solution-plan team. [Q8]

## Assumptions & Open Questions

None.

## Review

**Verdict:** READY
**Reviewer:** aidlc-product-lead-agent
**Date:** 2026-08-19T07:15:28Z
**Iteration:** 2

### Findings

| # | Severity | Location | Finding | Recommendation |
|---|---|---|---|---|
| 1 | Major | Success Metrics, bullet 1 | Vague metric: "kept current with minimal manual effort" — "minimal" is not measurable, violating the Ideation Phase guardrail "Success metrics must be measurable". | Specify a measurable threshold (e.g., "updated with ≤3 manual actions per employee per quarter" or "95% of fields auto-populated from CVs"). Alternatively, defer precise measurement to requirements stage with the understanding this will need sharpening. |

### Summary

The artifacts correctly integrate the recent follow-up answers (Q10 stakeholders, Q11 employee record fields). Every substantive claim is properly grounded in resolvable source tags ([desc], [Q1]-[Q11], [scope]). The problem framing is clear, stakeholders are identified, the scope boundary reflects the confirmed Q8/Q9 answers, and the project-specific corrections (Team Definition inside solution plan, org-level employee page as the general surface) are faithfully applied.

The single Major finding is a vague success metric inherited from Q3's answer. The phrase "minimal manual effort" offers no measurable threshold — QA cannot verify it, and requirements would struggle to translate it into acceptance criteria. This is flagged so the human can decide whether to refine it now or accept that requirements will need to sharpen the measurement.

The artifact is otherwise complete, faithful to the Q&A, and readable for non-technical stakeholders. No implementation details leak into the ideation-level framing.
