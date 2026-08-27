# Requirements — Team Definition

Derived from the approved intent-statement and scope-document (ideation), the answers in `requirements-analysis-questions.md` (Q1–Q6), and the code knowledge base (business-overview, architecture, code-structure in `aidlc/spaces/default/codekb/auto_rfp/`). No team-practices artifact exists in this workspace (that step is not in this workflow's plan). Every requirement traces to its source in parentheses.

## Intent Analysis

The organization needs real, named personnel data in the system so that: (1) org admins can manage an employee pool as reference data; (2) proposal managers get a credible, correctable named team inside each solution plan; and (3) TEAM_QUALIFICATIONS document generation — which fails today because no personnel entity exists anywhere (business-overview) — generates successfully citing real people. The goal is end-to-end: pool populated from existing CVs by AI, consumed through the solution plan into customer-facing documents (intent-statement).

## Functional Requirements

### FR1 — Employee Pool Management (org level)

- **FR1.1** The system shall provide an organization-level "Team" page, reachable as a new top-level item in the org navigation, listing all employees in a searchable, filterable, sortable, paginated table. (intent-statement; wireframes Q1/Q2)
- **FR1.2** The system shall let permitted users create, edit, and delete employees via separate create/edit pages (no inline editing, no modals). (wireframes Q2; code-structure conventions)
- **FR1.3** An employee record shall hold: name, roles, certifications, résumé/bio reference (link or org document), and location (onshore/offshore). (intent Q11)
- **FR1.4** An employee shall hold multiple roles, each classified as primary or secondary. (intent-statement [desc])
- **FR1.5** The page shall handle empty, loading (skeleton), populated, error, and edge states (long names, many roles, large pools) per the app's existing conventions. (wireframes)

Acceptance (FR1): Given an org admin on the Team page, When they create an employee with two primary and one secondary role, Then the employee appears in the table with those roles; Given a required field is missing, When they save, Then a field-level error message appears and nothing is persisted.

### FR2 — AI Employee List Generation from CVs

- **FR2.1** The Team page shall offer a "Generate from CVs" action that scans **all org documents** and automatically detects which are CVs/résumés. (Q1: A)
- **FR2.2** Generation shall use **direct import**: extracted employees are written immediately (no review-before-save step); progress (documents processed) is visible and the page remains usable during the run. (project rule; rough-mockups Q3)
- **FR2.3** Re-running generation shall **merge by name**: existing employees matched by name have their extracted fields updated, new people are added, and no employee is ever deleted by a run. (Q2: A)
- **FR2.4** Documents that cannot be processed shall be reported by name at run completion — never silently skipped. Already-imported rows survive a mid-run failure. (Q6: C; wireframes)
- **FR2.5** Extraction shall populate the FR1.3 record fields from CV content. (intent-statement)

Acceptance (FR2): Given 31 org documents of which 28 are readable CVs, When generation runs, Then 28 employees exist afterwards and the 3 unprocessable documents are listed; Given an employee "A. Petrenko" already exists, When generation re-runs over an updated CV, Then that record's extracted fields update and no duplicate row is created.

### FR3 — Solution-Plan Team Definition

- **FR3.1** Solution-plan generation shall automatically produce a recommended team: employees from the org pool matched against the plan's roles and the solicitation's requirements. Every plan (re)generation proposes a fresh team, except that a user-modified team is preserved and replaced only via an explicit team regenerate action. (Q3: B)
- **FR3.2** The plan's Team Definition section shall display each recommended person with their role and a visible match rationale (matched certifications/skills). (intent Q9)
- **FR3.3** A team line's role shall reference the opportunity's staffing plan position where one exists; a free-text role is allowed otherwise. (Q4: A)
- **FR3.4** The section shall offer an in-place edit mode: swap a person (from the pool), change a role, remove a line, add a person; Save persists the corrected team, Cancel discards. The saved (approved) team is what downstream documents read. (intent-statement; rough-mockups Q4)
- **FR3.5** The solution plan shall include personnel data — roles only in this release — via the Team Definition section. (intent-statement [desc])
- **FR3.6** With an empty employee pool, the section shall explain the prerequisite and link to the Team page; a matching/generation failure shall show a plain-language error with retry, and manual team assembly in edit mode shall remain available. (user-flow)

Acceptance (FR3): Given a populated pool and a staffing plan, When a solution plan is generated, Then its Team Definition section shows recommended persons with roles and rationale; Given the user swapped one person and saved, When the solution plan is regenerated, Then the saved team is unchanged; When the user explicitly regenerates the team, Then a fresh recommendation replaces it.

### FR4 — TEAM_QUALIFICATIONS Document Generation

- **FR4.1** TEAM_QUALIFICATIONS generation shall read the approved (saved) solution-plan team and cite real employee data (names, roles, certifications). (intent-statement; task doc)
- **FR4.2** With a saved team present, generation shall succeed where it fails today; with no saved team, the user shall be prompted to review/save the team first instead of a failed run. (intent Q3; architecture failure mode)
- **FR4.3** The generated document shall appear among the solution plan's documents with a view action. (wireframes)

Acceptance (FR4): Given a saved team of 4 people, When TEAM_QUALIFICATIONS is generated, Then the document is READY and names those 4 people with their qualifications; Given no saved team, When generation is requested, Then the user is told to save the team first and no FAILED run is produced.

### FR5 — Permissions & Access

- **FR5.1** Employee data shall be governed by new employee permission strings following the existing `<domain>:<action>` RBAC pattern: org admins manage (create/edit/delete/generate), all org members view. (Q5: A)
- **FR5.2** Editing the solution-plan team shall follow the existing solution-plan permissions. (Q5: A)

Acceptance (FR5): Given a non-admin org member, When they open the Team page, Then they see the list but no create/edit/delete/generate actions; When they call a mutating employee endpoint directly, Then it is rejected by the permission check.

## Non-Functional Requirements

- **NFR1** Extraction quality: ≥90% of employee record fields are auto-populated by CV extraction for well-formed CVs (measured over a representative CV set). (Q6: C)
- **NFR2** Re-run cleanliness: re-generating from CVs requires no manual cleanup for correctly formatted CVs; malformed CVs are reported, not silently skipped. (Q6: C)
- **NFR3** Data protection: employee data is org-scoped like all tenant data (single-table, org-prefixed keys); access enforced per FR5; CV-derived personal data never crosses org boundaries. (Q5; architecture)
- **NFR4** Accessibility: new screens match the app's existing conventions — keyboard navigable, labeled controls, ARIA where appropriate, WCAG AA as baseline; extraction progress announced via a live region. (rough-mockups Q6)
- **NFR5** Responsiveness: desktop-first with reasonable responsive behavior, matching the existing app. (rough-mockups Q5)
- **NFR6** Async execution: CV extraction and team matching run off the request path (the app's existing worker pattern); the UI stays responsive and reflects progress. (architecture)

## Constraints

- All AI model calls go through the existing HTTP-based AI client — never the AWS AI SDK directly. (architecture; repo rules)
- New entities follow the repo's 5-type Zod schema pattern in `packages/core`; handlers are thin with destructured validation; DynamoDB access only via the shared db helpers; new REST domains registered per the existing route-registration pattern. (code-structure)
- Frontend is a Feature-Sliced module with barrel exports, SWR hooks, Shadcn UI, skeleton loading, separate create/edit routes; `features/solution-plan/` is the exemplar, the pricing UI under `components/` is the anti-exemplar. (code-structure)
- Direct import for CV extraction (no draft-review step) — decided; do not reuse the extraction draft-approve flow's review step. (project rule)
- All four capability areas ship as one release; build order: pool page → CV extraction → solution-plan team → TEAM_QUALIFICATIONS. (scope-document)
- No hard deadlines; quality over speed. (scope-document)

## Assumptions

- CVs are text-extractable documents already flowing through the existing document indexing pipeline; extraction can read their extracted text. (business-overview; to be validated at design)
- Employee pool size is modest (tens to low hundreds), so table pagination and name-based merge are adequate at this scale. (rationale: internal team CVs)
- The Team Definition section is subject to the same org feature flag that gates the solution plan feature. (code-structure; to be confirmed at design)

## Out of Scope

Per the approved scope-document exclusions: a standalone opportunity-level Team Definition page; HR features beyond roles/CV data (vacations, contacts, payroll); changes to how CVs are uploaded/stored in org documents; notifications/alerts about team or employee changes.

## Open Questions

- The exact content shape of the match rationale (which matched attributes are shown, how long) — settle at design within FR3.2's boundary.
- Whether a "may be outdated" indicator is needed on a saved team after pool changes — not required by Q3: B; revisit at design only if cheap.

## Review

**Verdict:** NOT-READY
**Reviewer:** aidlc-product-lead-agent
**Date:** 2026-08-19T09:57:13Z
**Iteration:** 1

### Findings

| # | Severity | Location | Finding | Recommendation |
|---|---|---|---|---|
| 1 | Major | NFR5 | Ambiguous language: "reasonable responsive behavior" lacks a measurable threshold, violating Inception guardrail "Avoid ambiguous language unless paired with a measurable threshold". While "matching the existing app" provides a reference point, it's a qualitative comparison, not a measurable criterion. | Specify measurable responsive behavior criteria (e.g., "supports viewport widths 320px–2560px with breakpoints at 768px/1024px/1440px" or "layout adapts without horizontal scroll on mobile/tablet/desktop, matching existing app breakpoints"). Alternatively, reference specific existing pages as the baseline (e.g., "matches responsive behavior of opportunities list and solution-plan editor pages"). |
| 2 | Minor | FR3.2 | "Visible match rationale" defers content shape details to design. While explicitly acknowledged in Open Questions and acceptable given the scoping, this could be tightened. | Consider specifying minimum rationale content (e.g., "shows at least 2 matched certifications or skills per person") or defer with a tighter constraint (e.g., "rationale must cite specific matched attributes from the person's record"). Not blocking if left as-is. |

### Summary

The requirements document is well-structured and faithfully reflects all Q&A decisions (Q1–Q6). Every functional requirement traces cleanly to upstream artifacts (intent-statement, scope-document, Q&A answers, or wireframes). The stable FR{n}.{m} and NFR{n} ID scheme is correctly applied throughout. All acceptance criteria follow Given/When/Then format and are independently testable.

The single Major finding is an Inception Phase guardrail violation: NFR5 uses "reasonable responsive behavior" without a measurable threshold. While "matching the existing app" provides a qualitative reference point, QA cannot verify compliance without specific criteria (viewport ranges, breakpoints, or named reference pages). This is the only item blocking a READY verdict.

The Minor finding on FR3.2 is explicitly acknowledged in Open Questions and acceptable as scoped, though tightening it would reduce downstream design ambiguity.

All other NFRs are measurable (NFR1: ≥90%; NFR4: WCAG AA baseline), no contradictions exist between requirements, and the confirmed Q&A decisions are faithfully captured (all-org-docs CV detection in FR2.1, name-based merge in FR2.3, auto-generation with preserved user edits in FR3.1, staffing-plan role linkage in FR3.3, admin-manage/member-view permissions in FR5.1–FR5.2, both quantified upkeep metrics in NFR1–NFR2).
