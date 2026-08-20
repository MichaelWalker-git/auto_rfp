# Business Rules — employee-pool (U1)

Rules for U1 per requirements.md (FR1.x, FR5.1, NFR3), unit-of-work.md, components.md, and the confirmed answers (Q1, Q2). Rule IDs are stable `BR{group}.{seq}` keys; groups: BR1 validation, BR2 authorization/scoping, BR3 lifecycle, BR4 presentation constraints.

```yaml
rules:
  - id: BR1.1
    statement: An employee must have a non-empty name.
    category: validation
    applies_to: Employee create and edit
    trigger: any write of an Employee record
    logic: IF name is missing or empty after trimming THEN reject the write.
    violation: field-level validation error naming the field; nothing persisted
    source: FR1.3
  - id: BR1.2
    statement: Every role entry is non-empty text classified as primary or secondary.
    category: validation
    applies_to: Employee create and edit
    trigger: any write carrying roles
    logic: IF a role entry is empty OR not classified primary/secondary THEN reject the write.
    violation: field-level validation error; nothing persisted
    source: FR1.4
  - id: BR1.3
    statement: Location, when provided, is ONSHORE or OFFSHORE.
    category: validation
    applies_to: Employee create and edit
    trigger: any write carrying location
    logic: IF location is present AND not one of the allowed values THEN reject the write.
    violation: field-level validation error
    source: FR1.3
  - id: BR1.4
    statement: A resume/bio reference, when provided, is an org-document reference or an external link.
    category: validation
    applies_to: Employee create and edit
    trigger: any write carrying resumeRef
    logic: IF resumeRef is present AND is neither a resolvable org-document reference NOR a well-formed link THEN reject the write.
    violation: field-level validation error
    source: FR1.3
  - id: BR1.5
    statement: Role inputs suggest the org's labor-rate positions but accept free text.
    category: policy
    applies_to: role entry in create/edit views
    trigger: user typing a role
    logic: IF the org has labor-rate positions THEN offer them as suggestions; IF the typed value matches none THEN accept it as free text.
    violation: not applicable (no rejection path)
    source: FR1.4; Q1 answer
  - id: BR2.1
    statement: Viewing employees requires the employee read permission, granted to all org members.
    category: authorization
    applies_to: every Employee read
    trigger: any list/get request
    logic: IF the caller lacks the employee read permission for the org THEN refuse.
    violation: authorization error; no data returned
    source: FR5.1
  - id: BR2.2
    statement: Creating, editing, deleting employees and running generation require the employee manage permission, granted to org admins.
    category: authorization
    applies_to: every Employee mutation and import trigger
    trigger: any create/update/delete/generate request
    logic: IF the caller lacks the employee manage permission for the org THEN refuse.
    violation: authorization error; nothing persisted
    source: FR5.1
  - id: BR2.3
    statement: Every employee read and write is scoped to the caller's organization.
    category: constraint
    applies_to: all Employee operations
    trigger: any operation
    logic: IF the record's orgId differs from the request's org THEN treat as not found.
    violation: not-found behavior; no cross-org disclosure
    source: NFR3
  - id: BR3.1
    statement: Deleting an employee is allowed even when they appear on a saved solution-plan team; consuming teams retain a name/role snapshot and mark the line as referencing a removed employee.
    category: policy
    applies_to: Employee delete
    trigger: delete request
    logic: IF the employee is referenced by saved teams THEN delete proceeds; consumers resolve display from their stored snapshot (the snapshot is the plan-team unit's obligation).
    violation: not applicable (delete never blocked by references)
    source: FR1.2; Q2 answer
  - id: BR3.2
    statement: Every employee records its provenance as MANUAL or AI_IMPORT; edits never change identity.
    category: constraint
    applies_to: Employee create and edit
    trigger: any write
    logic: IF created by hand THEN source is MANUAL; IF created by the import flow THEN source is AI_IMPORT; identity (orgId, employeeId) is immutable across edits.
    violation: writes attempting identity change are rejected
    source: FR1.3; components.md (merge-by-name support)
  - id: BR4.1
    statement: The employee list returns org-scoped records with search, filtering, sorting, and pagination.
    category: constraint
    applies_to: Employee list view
    trigger: list request
    logic: IF search/filter/sort/pagination parameters are present THEN apply them within the org scope; otherwise return the first page in default order.
    violation: malformed parameters produce a validation error, not an empty success
    source: FR1.1
  - id: BR4.2
    statement: The list surface exposes empty, loading, populated, error, and edge states.
    category: policy
    applies_to: Team page rendering
    trigger: page render
    logic: IF no employees THEN the empty state names both creation paths; IF loading THEN skeletons; IF a request fails THEN a plain-language error with retry; edge content (long names, many roles) degrades without breaking layout.
    violation: not applicable (rendering contract)
    source: FR1.5
  - id: BR4.3
    statement: Create and edit are full-record operations in dedicated views; validation failures identify the offending field.
    category: policy
    applies_to: Employee create/edit views
    trigger: form submission
    logic: IF any BR1.x rule fails THEN the response carries the failing field(s) and message(s); the entered data is preserved for correction.
    violation: not applicable (defines the failure surface)
    source: FR1.2
```

## Rules Summary

| ID | Category | Rule | Source |
|----|----------|------|--------|
| BR1.1 | validation | Name required, non-empty | FR1.3 |
| BR1.2 | validation | Roles non-empty, classified primary/secondary | FR1.4 |
| BR1.3 | validation | Location in {ONSHORE, OFFSHORE} | FR1.3 |
| BR1.4 | validation | resumeRef is org-doc ref or link | FR1.3 |
| BR1.5 | policy | Role suggestions from labor-rate positions; free text allowed | FR1.4; Q1 |
| BR2.1 | authorization | Read permission — all org members | FR5.1 |
| BR2.2 | authorization | Manage permission — org admins | FR5.1 |
| BR2.3 | constraint | Org scoping on every operation | NFR3 |
| BR3.1 | policy | Delete allowed; teams keep snapshot | FR1.2; Q2 |
| BR3.2 | constraint | Provenance recorded; identity immutable | FR1.3 |
| BR4.1 | constraint | List = search/filter/sort/paginate in org scope | FR1.1 |
| BR4.2 | policy | Five screen states on the list surface | FR1.5 |
| BR4.3 | policy | Full-record create/edit; field-level errors | FR1.2 |
