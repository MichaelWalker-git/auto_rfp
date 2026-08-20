# User Flows — Team Definition

Core flows derived from the approved intent-statement (`../intent-capture/intent-statement.md`), the scope-document and intent-backlog (`../scope-definition/`), and the wireframes in `wireframes.md`. Personas per the intent-statement: org admin (maintains the pool) and proposal manager (consumes it in solution plans).

## Flow 1 — Maintain the employee pool (manual)

- Persona: Org admin
- Trigger: Admin needs to add or correct an employee record
- Steps:
  1. Team page -> click `[+ Add]` (or a row) -> create/edit page opens
  2. Form -> fill name, primary/secondary roles, certifications, resume/bio reference, on/offshore location -> `[Save employee]`
  3. Team page -> updated table row visible
- Success outcome: the employee appears in the pool with correct roles and fields
- Error paths:
  - Validation failure -> message below the field -> admin corrects and re-saves
  - Save failure -> inline banner, entered data preserved -> retry

## Flow 2 — Generate the employee list from CVs (direct import)

- Persona: Org admin
- Trigger: Admin clicks `[Generate from CVs]` on the Team page
- Steps:
  1. Team page -> click `[Generate from CVs]` -> progress indicator appears, page stays usable
  2. AI extracts employees from the CVs in org documents -> rows fill in as extracted (direct import — no review gate, per Q3)
  3. Completion banner -> "N imported, M documents could not be processed" -> admin reviews and edits entries with normal editing (Flow 1)
- Success outcome: the pool is populated from existing CVs with minimal manual effort
- Error paths:
  - Some documents unreadable -> partial-success banner names them -> admin adds those people manually
  - Whole run fails -> plain-language banner with retry; already-imported rows remain
  - Re-run -> existing employees updated, not duplicated (merge rule settled at requirements)

## Flow 3 — Review and modify the solution-plan team

- Persona: Proposal manager
- Trigger: Opening the Team Definition section of a solution plan
- Steps:
  1. Solution plan -> Team Definition section -> recommended team shows person, role, and match rationale per row (generated from the employee pool against the plan's roles)
  2. Section -> click `[Edit team]` -> edit mode toggles in place (Q4)
  3. Edit mode -> swap a person, change a role, remove a line, or add a person from the pool -> `[Save team]`
  4. View mode -> the corrected team is what is saved and what documents cite
- Success outcome: a credible named team the manager has explicitly approved
- Error paths:
  - Empty employee pool -> section explains the prerequisite and links to the Team page
  - Recommendation failure -> plain-language message with retry; manual team assembly in edit mode remains available
  - Cancel -> edit mode discards changes, view mode returns

## Flow 4 — Generate the team qualification document

- Persona: Proposal manager
- Trigger: Clicking `[Generate]` for the team qualification document in the Team Definition section
- Steps:
  1. Team Definition section -> `[Generate]` -> generation runs against the approved (saved) team
  2. Document appears among the solution plan's documents -> `[View]` opens it, citing real employee data (names, roles, certifications)
- Success outcome: TEAM_QUALIFICATIONS generates successfully — the failure named in the intent-statement is resolved
- Error paths:
  - No saved team -> prompt to review/save the team first (Flow 3)
  - Generation failure -> plain-language error with retry

## Flow map

```
Org admin                          Proposal manager
   |                                     |
   v                                     v
[Team page] --(add/edit)--> [Employee form]
   |                                     |
   +--(Generate from CVs)--> [AI import] |
   |         (pool populated)            |
   |                                     v
   +----------(pool feeds)----> [Solution plan: Team Definition]
                                         |
                              (review + modify + save team)
                                         |
                                         v
                              [Team qualification document]
```
