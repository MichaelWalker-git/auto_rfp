# Rough Mockups — Questions

Grounded in the approved intent-statement (`../intent-capture/intent-statement.md`), scope-document, and intent-backlog (`../scope-definition/`). The existing app's design system (Shadcn UI, Tailwind, indigo primary) is a given, so no brand questions are needed. These questions pin down layout and flow choices before wireframing.

## Q1. Where should the employee management page live in the app's navigation?

A. A new top-level item in the organization-level navigation (e.g., "Team" or "Employees")
B. Inside the existing organization settings area, as a new section
C. Recommend a placement based on the existing navigation and I'll review it
D. Not yet defined
X. Other (please specify)

[Answer]: A

## Q2. What layout should the employee page use?

A. A table/list view (sortable, filterable) with separate create/edit pages — matches the app's existing convention of separate routes for create/edit
B. A card grid (one card per employee) with separate create/edit pages
C. A table with inline row editing (no separate pages)
D. Recommend a layout and I'll review it
X. Other (please specify)

[Answer]: A

## Q3. How should the AI "generate employee list from CVs" flow behave?

A. Review-before-save — AI proposes the extracted employee list, the user reviews/edits/deselects entries, then confirms what gets saved ("AI prepares, experts validate")
B. Direct import — AI writes the list immediately; the user cleans it up afterwards with normal editing
C. Recommend a flow and I'll review it
D. Not yet defined
X. Other (please specify)

[Answer]: B

## Q4. How should the Team Definition appear inside the solution plan, and how should "modify team" work?

A. A dedicated team section in the solution plan view showing the recommended team (person, roles, match rationale) with an edit mode toggled in place
B. A dedicated team section, with modification happening in a dialog/drawer (swap person, change role) — consistent with how the solution plan already handles pricing edits
C. Recommend an approach based on the existing solution plan UI and I'll review it
D. Not yet defined
X. Other (please specify)

[Answer]: A

## Q5. What device/form factors must the new screens support?

A. Match the existing app — desktop-first with reasonable responsive behavior
B. Fully responsive including phone layouts as a first-class requirement
C. Desktop only — internal users on laptops/monitors
D. Not yet defined
X. Other (please specify)

[Answer]: A

## Q6. Are there accessibility requirements beyond the app's existing conventions?

A. Match existing app conventions (keyboard navigable, ARIA labels, WCAG AA as baseline)
B. Strict WCAG 2.1 AA compliance is a hard requirement for these screens
C. No specific requirement
D. Not yet defined
X. Other (please specify)

[Answer]: A

## Consolidated Summary Confirmation

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
