# Business Rules — cv-import (U2)

Rules for U2 per requirements.md (FR2.x, FR5.1, NFR1/NFR2/NFR6), unit-of-work.md, components.md, and the confirmed answers (Q1, Q2). Groups: BR1 run lifecycle, BR2 detection/extraction, BR3 merge, BR4 reporting, BR5 execution.

```yaml
rules:
  - id: BR1.1
    statement: At most one import run may be RUNNING per organization.
    category: constraint
    applies_to: generate-from-CVs trigger
    trigger: generate request
    logic: IF a run for the org is RUNNING THEN refuse the new request and point at the running one.
    violation: refusal with guidance; no new run created
    source: FR2.2
  - id: BR1.2
    statement: Triggering an import run requires the employee manage permission.
    category: authorization
    applies_to: generate-from-CVs trigger
    trigger: generate request
    logic: IF the caller lacks the employee manage permission for the org THEN refuse.
    violation: authorization error
    source: FR5.1
  - id: BR2.1
    statement: A run scans all org documents that have extracted text and classifies each as CV or non-CV; AI-service failures on a document are recorded, bounded, and never silent.
    category: policy
    applies_to: detection step
    trigger: run start
    logic: IF a document has no extracted text THEN record it as UNREADABLE; ELSE classify its text; IF classified non-CV THEN skip it silently (not a failure); IF the classification call fails (service error, timeout) THEN retry once and, on repeated failure, record the document as EXTRACTION_FAILED and continue; IF five consecutive documents record EXTRACTION_FAILED THEN treat the AI service as down and end the run per BR4.2.
    violation: per-document EXTRACTION_FAILED records; systemic failure escalates to BR4.2
    source: FR2.1; Q2
  - id: BR2.2
    statement: Extraction populates the employee record fields; a candidate without a detectable person name is an incomplete extraction, and a failed extraction call is recorded like a failed classification.
    category: policy
    applies_to: extraction step
    trigger: per detected CV
    logic: IF the extraction call fails THEN apply the same retry-then-EXTRACTION_FAILED handling and consecutive-failure escalation as BR2.1; ELSE IF the CV yields no name THEN record the document as INCOMPLETE_EXTRACTION and produce no employee; ELSE produce a candidate with name, roles, certifications, resume reference (the source document), and location where stated.
    violation: failure record per category; run continues except under BR2.1's consecutive-failure escalation
    source: FR2.5; Q2
  - id: BR3.1
    statement: Candidates merge into the pool by normalized name — update the single matching employee, create when none matches, and refuse ambiguous matches.
    category: policy
    applies_to: merge step
    trigger: per extracted candidate
    logic: IF exactly one org employee's name matches the candidate's name after trimming and case-folding THEN update that employee; IF no employee matches THEN create a new employee with source AI_IMPORT; IF two or more employees match THEN write nothing and record the document as AMBIGUOUS_NAME for manual resolution.
    violation: ambiguous matches produce a failure record, never a guess
    source: FR2.3
  - id: BR3.2
    statement: An import run never deletes an employee.
    category: constraint
    applies_to: merge step
    trigger: any run
    logic: IF an existing employee matches no CV in this run THEN leave the record untouched.
    violation: not applicable (prohibition)
    source: FR2.3
  - id: BR3.3
    statement: Manual edits win — a field is overwritten only when unchanged since the last import, judged against the U2-owned extraction snapshot.
    category: policy
    applies_to: merge step, per field of a matched employee
    trigger: updating an existing employee
    logic: IF the field's current Employee value equals the EmployeeExtractionSnapshot value for that field OR is empty THEN write the newly extracted value; in every case refresh the snapshot with the newly extracted values. IF no snapshot exists for the employee (e.g. manually created) THEN only empty fields are filled.
    violation: not applicable (defines precedence)
    source: Q1; FR2.3
  - id: BR3.4
    statement: All employee writes go through the employee-pool unit's persistence rules.
    category: constraint
    applies_to: merge step
    trigger: any create/update
    logic: IF a candidate fails U1's validation (e.g. BR1.x of U1) THEN record the document as INCOMPLETE_EXTRACTION rather than writing an invalid record.
    violation: failure record; run continues
    source: unit-of-work-dependency integration surface; NFR2
  - id: BR4.1
    statement: The completion report names every failed document with its category and the run's counts.
    category: policy
    applies_to: run completion
    trigger: run end
    logic: IF failedDocuments is non-empty THEN status is COMPLETED_WITH_ERRORS and the report lists each document and reason; ELSE status is COMPLETED.
    violation: not applicable (reporting contract)
    source: FR2.4; Q2; NFR2
  - id: BR4.2
    statement: A mid-run failure preserves already-imported employees and reports partial progress.
    category: policy
    applies_to: run failure
    trigger: unrecoverable error during a run
    logic: IF the run cannot continue THEN status is FAILED, counts reflect work completed, and no imported employee is rolled back.
    violation: not applicable (failure contract)
    source: FR2.4
  - id: BR5.1
    statement: Import runs execute off the request path with observable progress.
    category: constraint
    applies_to: run execution
    trigger: run start
    logic: IF a run is RUNNING THEN progress (documents processed) is readable while the page remains usable.
    violation: not applicable
    source: NFR6; FR2.2
```

## Rules Summary

| ID | Category | Rule | Source |
|----|----------|------|--------|
| BR1.1 | constraint | One RUNNING run per org | FR2.2 |
| BR1.2 | authorization | Manage permission to trigger | FR5.1 |
| BR2.1 | policy | Scan all docs; UNREADABLE vs skipped non-CVs; AI failure → EXTRACTION_FAILED with escalation | FR2.1; Q2 |
| BR2.2 | policy | No name → INCOMPLETE_EXTRACTION; failed call handled per BR2.1 | FR2.5; Q2 |
| BR3.1 | policy | Merge by normalized name; ambiguous → AMBIGUOUS_NAME record | FR2.3 |
| BR3.2 | constraint | Never delete | FR2.3 |
| BR3.3 | policy | Manual edits win via extraction-snapshot comparison | Q1 |
| BR3.4 | constraint | Writes only through U1's rules | integration surface |
| BR4.1 | policy | Completion report with categories + counts | FR2.4; Q2 |
| BR4.2 | policy | Mid-run failure preserves imports | FR2.4 |
| BR5.1 | constraint | Async with observable progress | NFR6 |
