# Business Rules — plan-team (U3)

Rules for U3 per requirements.md (FR3.x, FR5.2, NFR6), unit-of-work.md, components.md (ADR-002/003/005 constraints), and the confirmed answers (Q1, Q2). Groups: BR1 generation, BR2 role linkage, BR3 editing/persistence, BR4 resilience, BR5 authorization/matching.

```yaml
rules:
  - id: BR1.1
    statement: Solution-plan generation automatically proposes a recommended team.
    category: policy
    applies_to: plan synthesis
    trigger: solution plan (re)generation completes synthesis
    logic: IF the org employee pool is non-empty THEN matching runs and the proposed team is attached to the plan item with generatedAt set and userModified false; ELSE the team is left empty with the prerequisite state (BR4.1).
    violation: matching failure follows BR4.2
    source: FR3.1
  - id: BR1.2
    statement: A user-modified team is preserved across plan regenerations and replaced only by an explicit team regenerate.
    category: policy
    applies_to: plan regeneration and the explicit regenerate action
    trigger: plan regeneration, or team regenerate request
    logic: IF the plan regenerates AND userModified is true THEN the saved team is kept as-is; IF the human explicitly regenerates the team THEN a fresh recommendation replaces it and userModified resets to false.
    violation: not applicable (defines precedence)
    source: FR3.1
  - id: BR1.3
    statement: The generated team proposes one member per staffing plan position; with no staffing plan, the AI proposes role slots from the solicitation's requirements.
    category: policy
    applies_to: matching
    trigger: team generation
    logic: IF the opportunity has a staffing plan THEN one member line per position (unfillable positions produce an unfilled line with no employee and no rationale); ELSE the AI derives role slots from the requirements and fills them.
    violation: not applicable
    source: Q2; FR3.3
  - id: BR1.4
    statement: Each AI-recommended member carries a one-or-two-sentence rationale citing the strongest matches.
    category: policy
    applies_to: matching output
    trigger: team generation
    logic: IF a member was AI-recommended THEN rationale is present, plain-language, and cites matched certifications/skills against the role or requirements; manually added lines carry no rationale.
    violation: a recommendation without rationale is invalid output and is regenerated
    source: Q1; FR3.2
  - id: BR2.1
    statement: A member's role references the opportunity's staffing plan position where one exists; free text otherwise.
    category: constraint
    applies_to: member role field
    trigger: any team write
    logic: IF the role matches a staffing plan position THEN staffingPositionRef is set; ELSE the role stands as free text with no reference.
    violation: not applicable
    source: FR3.3
  - id: BR3.1
    statement: In-place edit mode — Save persists the corrected team and marks it user-modified; Cancel discards all edits.
    category: policy
    applies_to: team section edit mode
    trigger: save or cancel
    logic: IF Save THEN persist members, set userModified true and savedAt; IF Cancel THEN restore the last persisted team unchanged.
    violation: not applicable
    source: FR3.4
  - id: BR3.2
    statement: The saved team is the single source downstream documents read.
    category: constraint
    applies_to: document generation reads
    trigger: any consumer read
    logic: IF a consumer needs the team THEN it reads the persisted PlanTeam on the plan item — never the transient recommendation.
    violation: not applicable
    source: FR3.4; ADR-002
  - id: BR3.3
    statement: A member line whose employee was deleted renders from its snapshots and is marked as referencing a removed employee.
    category: policy
    applies_to: team display and reads
    trigger: rendering or reading a team line
    logic: IF the referenced employee no longer exists THEN removedEmployee is true, nameSnapshot renders, and the mark is visible; the line is not silently dropped.
    violation: not applicable
    source: U1 delete policy (its Q2 answer); FR3.4
  - id: BR4.1
    statement: An empty employee pool yields the prerequisite state, not an error.
    category: policy
    applies_to: team section
    trigger: generation with empty pool, or rendering an empty team
    logic: IF the org has no employees THEN the section explains the prerequisite and links to the Team page; manual assembly stays unavailable until employees exist.
    violation: not applicable
    source: FR3.6
  - id: BR4.2
    statement: A matching/generation failure shows a plain-language error with retry, and manual team assembly remains available.
    category: policy
    applies_to: team generation failures
    trigger: matching error during synthesis or explicit regenerate
    logic: IF matching fails THEN the plan itself still completes, the team section shows the error with a retry action, and edit mode still allows building the team by hand.
    violation: not applicable (failure contract; never blocks the plan)
    source: FR3.6
  - id: BR5.1
    statement: Editing the team requires the existing solution-plan edit permissions.
    category: authorization
    applies_to: team save and regenerate
    trigger: any team mutation
    logic: IF the caller lacks the solution-plan edit permission for the org THEN refuse.
    violation: authorization error; nothing persisted
    source: FR5.2
  - id: BR5.2
    statement: Matching loads the org's full employee pool and scores deterministically plus with AI — no vector index.
    category: constraint
    applies_to: matching
    trigger: team generation
    logic: IF matching runs THEN candidates are the entire org pool read via the employee-pool unit; scoring combines deterministic signals (role fit, certifications, location) with AI reasoning against the plan's roles and solicitation requirements.
    violation: not applicable
    source: ADR-003; components.md
```

## Rules Summary

| ID | Category | Rule | Source |
|----|----------|------|--------|
| BR1.1 | policy | Auto-propose team at plan synthesis | FR3.1 |
| BR1.2 | policy | User-modified team preserved; explicit regenerate replaces | FR3.1 |
| BR1.3 | policy | One member per staffing position; AI slots otherwise | Q2 |
| BR1.4 | policy | Short-sentence rationale per AI recommendation | Q1; FR3.2 |
| BR2.1 | constraint | Role → staffing position ref where exists | FR3.3 |
| BR3.1 | policy | Save persists + marks user-modified; Cancel discards | FR3.4 |
| BR3.2 | constraint | Saved team is what documents read | FR3.4 |
| BR3.3 | policy | Removed-employee lines render from snapshots, marked | U1 delete policy |
| BR4.1 | policy | Empty pool → prerequisite state | FR3.6 |
| BR4.2 | policy | Matching failure → error + retry + manual assembly | FR3.6 |
| BR5.1 | authorization | Solution-plan permissions govern team edits | FR5.2 |
| BR5.2 | constraint | Full-pool matching, no vector index | ADR-003 |
