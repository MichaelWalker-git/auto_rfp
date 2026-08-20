# Frontend Components — employee-pool (U1)

Component design for the Team page surface, per the approved wireframes (ideation), unit-of-work.md (U1 boundary), requirements.md (FR1.x), and rules.md (BR4.x). Design level only — implementation belongs to code generation.

## Component Hierarchy

- **TeamPage** (org-level route)
  - **TeamToolbar** — search input, role filter, location filter, Generate-from-CVs action (visible to managers; behavior owned by U2), Add-employee action (managers)
  - **EmployeeTable** — sortable columns (name, primary roles, secondary roles, location, certification count); row → edit view; pagination footer
  - **EmployeeTableSkeleton** — loading state (BR4.2)
  - **EmployeeEmptyState** — names both creation paths (BR4.2)
  - **EmployeeErrorState** — plain-language message + retry (BR4.2)
- **EmployeeCreatePage** / **EmployeeEditPage** (separate routes, BR4.3)
  - **EmployeeForm** — name, primary/secondary role editors, certifications editor, resume/bio reference picker (org document or link), location choice
    - **RoleTagInput** — tag-style multi-entry with suggestions from labor-rate positions, free text accepted (BR1.5)

## Props / State Design

| Component | Key inputs | Key state |
|-----------|-----------|-----------|
| TeamPage | orgId (route) | search/filter/sort/page (URL state), permission flags |
| EmployeeTable | employee list page, sort descriptor, callbacks | none (presentation) |
| EmployeeForm | initial employee (edit) or empty (create), submit/cancel callbacks | form field state, per-field errors |
| RoleTagInput | current entries, suggestion source, change callback | input text, open suggestion list |

## Interaction Flows

- Search/filter/sort changes update URL state and re-query within org scope (BR4.1).
- Form submission surfaces field-level errors below the offending field with entered data preserved (BR4.3).
- Delete asks for confirmation that names the snapshot behavior (W4, BR3.1).
- Managers see mutating actions; members see the read-only surface (BR2.1/BR2.2).

## Form Validation Rules

Mirror BR1.1–BR1.4 client-side for immediate feedback; the server remains authoritative. Validation messages are specific ("Name is required"), never generic.

## API Integration Points

- List/get employees (read permission) — powers TeamPage.
- Create/update/delete employee (manage permission) — powers the form pages.
- Import trigger and progress belong to U2; TeamToolbar only hosts the entry point.

## Accessibility

Per NFR4: labeled controls, keyboard-navigable table and form, the location choice as an arrow-key radio group, focus returned sensibly after dialogs, and list updates announced politely.
