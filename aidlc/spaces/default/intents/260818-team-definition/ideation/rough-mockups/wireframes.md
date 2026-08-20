# Rough Wireframes — Team Definition

Low-fidelity concept wireframes derived from the approved intent-statement (`../intent-capture/intent-statement.md`), the scope-document and intent-backlog (`../scope-definition/`), and the confirmed answers in `rough-mockups-questions.md` (Q1–Q6). Layout follows the app's existing conventions: desktop-first responsive (Q5), keyboard navigable with WCAG AA as baseline (Q6).

## Screen 1 — Employee List (org-level "Team" page)

A new top-level item in the organization-level navigation (Q1). Sortable, filterable table with separate create/edit pages (Q2).

```
+----------------------------------------------------------------------+
| [Org Nav]  Projects | Documents | Team* | Settings        [User v]   |
+----------------------------------------------------------------------+
| Team                                                                 |
|                                                                      |
| [Search employees...    ]  [Filter: Role v] [Filter: Location v]     |
|                                    [Generate from CVs]  [+ Add]      |
| +------------------------------------------------------------------+|
| | Name          | Primary roles   | Secondary roles | Loc  | Certs ||
| |---------------+-----------------+-----------------+------+-------||
| | A. Petrenko   | Solutions Arch  | PM              | On   |  3    ||
| | K. Bondar     | Developer       | DevOps, QA      | Off  |  5    ||
| | ...           | ...             | ...             | ...  | ...   ||
| +------------------------------------------------------------------+|
| Showing 1-20 of 47                              [< Prev] [Next >]    |
+----------------------------------------------------------------------+
```

- Row click opens the employee's edit page. `[+ Add]` opens the create page (separate routes, Q2).
- `[Generate from CVs]` starts the AI import (Screen 3).

**States**
- Empty: "No employees yet. Add one manually or generate the list from the CVs in your organization's documents." with both actions.
- Loading: skeleton rows in the table (existing app convention).
- Populated: as drawn.
- Error: inline banner above the table with a plain-language message and a retry action.
- Partial/edge: long names truncate with tooltip; many roles collapse to "Developer +2"; pagination for large pools.

**Accessibility**: h1 "Team"; landmarks header/nav/main; keyboard entry point = search field, then filters, then actions, then table rows.

## Screen 2 — Employee Create/Edit page

Separate route per the app convention (Q2). Same form for create and edit.

```
+----------------------------------------------------------------------+
| Team > Add employee                                                  |
+----------------------------------------------------------------------+
| Name           [                          ]                          |
| Primary roles  [ Solutions Architect x ] [ + role ]                  |
| Secondary roles[ PM x ] [ QA x ]         [ + role ]                  |
| Certifications [ AWS SA Pro x ] [ PMP x ] [ + cert ]                 |
| Resume/bio     [ Link or select from org documents      ] [Browse]   |
| Location       ( ) Onshore   ( ) Offshore                            |
|                                                                      |
|                                        [Cancel]  [Save employee]     |
+----------------------------------------------------------------------+
```

**States**
- Default: empty form (create) or pre-filled (edit).
- Validation error: message below the offending field, described in text.
- Saving: save button shows pending state; form stays visible.
- Error: inline banner with plain-language message; entered data preserved.

**Accessibility**: h1 "Add employee" / "Edit employee"; breadcrumb nav landmark + main; keyboard entry point = Name field; all fields labeled, radio group for location arrow-key navigable.

## Screen 3 — AI Generation from CVs (direct import)

Triggered from the list page. Direct import (Q3): the AI writes the extracted list immediately; the user cleans up afterwards with normal editing.

```
+----------------------------------------------------------------------+
| Team                                                                 |
|                                                                      |
| +------------------------------------------------------------------+|
| | Generating employee list from CVs...                             ||
| | [############------------------]  12 of 31 documents processed  ||
| +------------------------------------------------------------------+|
| | (table fills in as employees are extracted)                      ||
| +------------------------------------------------------------------+|
+----------------------------------------------------------------------+

On completion:
+----------------------------------------------------------------------+
| | 28 employees imported from 31 CVs. 3 documents could not be      ||
| | processed (view list). Review and edit entries as needed.        ||
+----------------------------------------------------------------------+
```

**States**
- Running: progress indicator with document count; page remains usable.
- Success: count summary banner; imported rows appear in the table.
- Partial: names the documents that could not be processed, with a way to see which.
- Error: whole-run failure shows a plain-language banner with retry; no partial rows are silently lost — whatever was imported stays visible.
- Re-run/edge: running generation again must not create duplicate employees — existing entries are updated, new ones added (exact merge rule to be settled at requirements).

**Accessibility**: progress announced via a live region; the trigger button reflects the running state; keyboard focus stays where the user was.

## Screen 4 — Solution Plan: Team Definition section

A dedicated section inside the existing solution plan view (per the intent: no separate opportunity-level page). Shows the recommended team with per-person match rationale; edit mode toggles in place (Q4).

```
View mode:
+----------------------------------------------------------------------+
| Solution Plan                                                        |
|  ... (existing sections) ...                                         |
| +------------------------------------------------------------------+|
| | Team Definition                                   [Edit team]    ||
| |------------------------------------------------------------------||
| | Person        | Role            | Match rationale                ||
| |---------------+-----------------+--------------------------------||
| | A. Petrenko   | Solutions Arch  | AWS SA Pro cert; 4 similar     ||
| |               |                 | cloud migrations               ||
| | K. Bondar     | Lead Developer  | Required stack experience;     ||
| |               |                 | gov-contract delivery          ||
| +------------------------------------------------------------------+|
| | Team qualification document: [Generate] / [View]                 ||
| +------------------------------------------------------------------+|
+----------------------------------------------------------------------+

Edit mode (toggled in place):
+----------------------------------------------------------------------+
| | Team Definition                     [Cancel]  [Save team]        ||
| |------------------------------------------------------------------||
| | Person             | Role                  |                     ||
| |--------------------+-----------------------+---------------------||
| | [A. Petrenko    v] | [Solutions Arch    v] | [Remove]            ||
| | [K. Bondar      v] | [Lead Developer    v] | [Remove]            ||
| | [+ Add person]                                                   ||
| +------------------------------------------------------------------+|
+----------------------------------------------------------------------+
```

- Person selector draws from the org employee pool; role selector from the plan's roles.
- The corrected team is what is saved and what document generation reads (per the intent-statement).

**States**
- Empty: "No team yet. Generate a recommended team from your employee pool." with a generate action.
- Generating: skeleton rows in the section while the recommendation runs.
- Populated (view mode): as drawn, rationale visible per person.
- Edit mode: as drawn; Cancel discards, Save persists.
- Error: generation failure shows a plain-language message with retry; an empty employee pool explains the prerequisite and links to the Team page.

**Accessibility**: section heading h2 "Team Definition" within the solution plan's main landmark; keyboard entry point = Edit team button; edit-mode selectors are labeled comboboxes; save/cancel reachable by Tab.

## Information Architecture

- Organization level: Team page (employee pool) — new sibling of existing org-level pages.
- Project/solution level: Team Definition section inside the existing solution plan view, plus the team qualification document among the plan's documents.
- Out of scope surfaces per the scope-document: no standalone opportunity-level team page, no notification surfaces.

## Review

**Verdict:** NOT-READY
**Reviewer:** aidlc-product-lead-agent
**Date:** 2026-08-19T08:20:19Z
**Iteration:** 1

### Findings

| # | Severity | Location | Finding | Recommendation |
|---|---|---|---|---|
| 1 | Major | Screen 2 — Employee Create/Edit page, States section | Missing fifth screen state — only four states documented (Default, Validation error, Saving, Error). The stage requirement specifies "all five screen states per screen"; Screens 1, 3, and 4 each document five states, so this is an inconsistency and a completeness gap. | Add a fifth distinct state for Screen 2. Natural candidates: a success/confirmation state after save completes (showing feedback before returning to the list), or a loading state when fetching an existing employee record for edit. |

### Summary

The wireframes and user flows are comprehensive, well-structured, and faithfully implement all six confirmed design answers (Q1–Q6) from the Q&A file. Every in-scope capability from the scope-document is covered: the employee pool page with table layout and separate create/edit routes (PU-1), AI CV extraction with direct import (PU-2), the solution-plan team section with in-place edit mode and per-person match rationale (PU-3), and the team qualification document generation (PU-4). All out-of-scope surfaces are correctly excluded (no standalone opportunity-level team page, no notifications). ASCII diagrams use basic characters throughout, accessibility notes are present per screen, and the artifacts remain at ideation level without implementation details.

The single Major finding is the missing fifth state on Screen 2. This is a completeness gap against the explicit stage requirement and creates an inconsistency with the other three screens, each of which documents five states. Adding one more distinct state would resolve this and bring Screen 2 into alignment with the rest of the artifact.
