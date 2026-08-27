# Business Rules — team-qualifications (U4)

Rules for U4 per requirements.md (FR4.x), unit-of-work.md, components.md, and the confirmed answers (Q1, Q2). Groups: BR1 preconditions, BR2 grounding, BR3 output handling.

```yaml
rules:
  - id: BR1.1
    statement: TEAM_QUALIFICATIONS generation requires a saved team; without one the request is refused with guidance, never run to failure.
    category: constraint
    applies_to: generation request
    trigger: TEAM_QUALIFICATIONS generation requested
    logic: IF the opportunity's solution plan has no persisted team OR its member list is empty THEN refuse the request with guidance to review and save the team first; no generation job is created.
    violation: guidance response; no FAILED document run produced
    source: FR4.2
  - id: BR1.2
    statement: Existing generation preconditions (solution-plan gate, permissions) are unchanged.
    category: constraint
    applies_to: generation request
    trigger: TEAM_QUALIFICATIONS generation requested
    logic: IF the existing document-generation preconditions fail THEN the existing behavior stands; this unit adds only the saved-team precondition.
    violation: per existing pipeline behavior
    source: FR4.1; components.md (DocumentGeneration extended)
  - id: BR2.1
    statement: Personnel content is grounded exclusively in the saved team and the referenced employee records.
    category: constraint
    applies_to: context assembly
    trigger: generation job starts
    logic: IF the prompt needs personnel data THEN it receives the TeamQualificationsContext assembled from the saved team, the referenced Employees, and each member's referenced CV text (Q1) — never generic knowledge-base search results for personnel.
    violation: a generation grounded on anything else is a defect
    source: FR4.1
  - id: BR2.2
    statement: Each filled member is cited with structured fields plus the referenced CV's extracted text where resolvable.
    category: policy
    applies_to: context assembly
    trigger: per filled team line
    logic: IF the member's resumeRef resolves to an org document with extracted text THEN include that text (bounded by the pipeline's existing context budget); ELSE include the structured fields alone and note the missing bio source.
    violation: not applicable (defines grounding depth)
    source: Q1; FR4.1
  - id: BR2.3
    statement: Unfilled positions are cited as open roles; removed-employee lines cite the snapshot only, marked pending replacement.
    category: policy
    applies_to: context assembly
    trigger: per non-standard team line
    logic: IF a team line is unfilled THEN list its role as an open position with no personnel claims; IF a line references a removed employee THEN cite nameSnapshot and role only, marked pending replacement, with no qualification claims beyond the snapshot.
    violation: not applicable (defines edge-line handling)
    source: Q2
  - id: BR2.5
    statement: Team lines are classified by the plan-team unit's declared fields, with a defensive fallback for stale references.
    category: policy
    applies_to: context assembly, per team line
    trigger: classifying a TeamMember line
    logic: IF nameSnapshot absent AND employeeId absent THEN UNFILLED; ELSE IF removedEmployee is true THEN DELETED; ELSE IF employeeId present THEN FILLED and the Employee record is read; IF that read finds no record despite removedEmployee false THEN treat the line as DELETED (snapshot-only, pending replacement) and log a data-integrity warning; any other shape logs a warning and is cited as pending replacement rather than dropped.
    violation: no line is silently dropped; inconsistencies are logged, never fatal
    source: Q2; plan-team unit line-shape contract (its entities.md)
  - id: BR2.4
    statement: The prompt's no-invention instruction stands — people not on the saved team are never cited.
    category: constraint
    applies_to: generation
    trigger: any TEAM_QUALIFICATIONS generation
    logic: IF the model output names personnel absent from the context THEN existing content validation treats the output as invalid per the pipeline's rules.
    violation: per existing validation/retry behavior
    source: FR4.1
  - id: BR3.1
    statement: The generated document appears among the solution plan's documents with a view action.
    category: constraint
    applies_to: generation completion
    trigger: successful generation
    logic: IF generation succeeds THEN the document lands where the existing pipeline places generated documents for the opportunity, viewable from the plan's Team Definition section.
    violation: not applicable
    source: FR4.3
```

## Rules Summary

| ID | Category | Rule | Source |
|----|----------|------|--------|
| BR1.1 | constraint | No saved team → refuse with guidance, no failed run | FR4.2 |
| BR1.2 | constraint | Existing preconditions unchanged | FR4.1 |
| BR2.1 | constraint | Grounding = saved team + employee records only | FR4.1 |
| BR2.2 | policy | Structured fields + CV text per filled member | Q1 |
| BR2.3 | policy | Open roles + marked snapshots for edge lines | Q2 |
| BR2.4 | constraint | No invented personnel | FR4.1 |
| BR2.5 | policy | Line-shape detection order + stale-reference fallback | Q2; U3 contract |
| BR3.1 | constraint | Document among plan documents, viewable | FR4.3 |
