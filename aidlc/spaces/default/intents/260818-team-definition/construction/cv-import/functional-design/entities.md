# Entities — cv-import (U2)

Entity model for U2 per unit-of-work.md (U2 boundary), unit-of-work-story-map.md (FR2.x), requirements.md, components.md (EmployeeImportRun owned by EmployeePool; import logic owned by EmployeePool per ADR-004), and the confirmed answers in `functional-design-questions.md` (Q1, Q2). The Employee entity is owned by U1 and is NOT modified by this unit — field-level precedence uses a separate snapshot entity owned here, so there is exactly one authoritative Employee schema.

```yaml
entities:
  - name: EmployeeImportRun
    description: One execution of the generate-from-CVs flow for an organization, tracking progress and outcome.
    attributes:
      - name: importRunId
        type: identifier
        required: true
        unique: true
        constraints: system-generated; immutable
      - name: orgId
        type: identifier
        required: true
        constraints: immutable; org-scoped access (same org-scoping rule as all tenant data)
      - name: status
        type: enumerated text
        required: true
        allowed_values: [RUNNING, COMPLETED, COMPLETED_WITH_ERRORS, FAILED]
        default: RUNNING
      - name: documentsScanned
        type: count
        required: true
        default: 0
      - name: cvsDetected
        type: count
        required: true
        default: 0
      - name: employeesCreated
        type: count
        required: true
        default: 0
      - name: employeesUpdated
        type: count
        required: true
        default: 0
      - name: failedDocuments
        type: list of objects
        required: true
        default: empty list
        constraints: each object has documentName (text, max 500 chars) and reason (enumerated text in {UNREADABLE, INCOMPLETE_EXTRACTION, EXTRACTION_FAILED, AMBIGUOUS_NAME})
      - name: triggeredBy
        type: identifier
        required: true
        constraints: the requesting user; must hold the employee manage permission
      - name: startedAt
        type: timestamp
        required: true
      - name: completedAt
        type: timestamp
        required: false
    entity_constraints:
      - At most one RUNNING import run per organization at a time (BR1.1 in rules.md).
      - Runs are append-only history; they are never edited after completion.
    relationships:
      - to: Employee (owned by employee-pool unit)
        cardinality: one run creates or updates many employees
        direction: writes-through-U1
        note: all writes go through U1's persistence rules (unit-of-work-dependency integration surface); U1's Employee schema is untouched by this unit
      - to: EmployeeExtractionSnapshot
        cardinality: one run refreshes many snapshots
        direction: owns-and-writes

  - name: EmployeeExtractionSnapshot
    description: The values the most recent extraction wrote for one employee — the comparison basis that makes manual edits win on re-import. Owned by this unit; one per employee touched by an import.
    attributes:
      - name: employeeId
        type: identifier
        required: true
        unique: true
        constraints: references a U1 Employee; one snapshot per employee
      - name: orgId
        type: identifier
        required: true
        constraints: immutable; org-scoped access
      - name: fields
        type: map of field name to extracted value
        required: true
        constraints: keys are Employee field names the extraction populates (name, primaryRoles, secondaryRoles, certifications, resumeRef, location)
      - name: updatedAt
        type: timestamp
        required: true
    entity_constraints:
      - Written only by the import flow; never edited by hand.
      - Field precedence on re-import derives from it — a field is overwritten only when its current Employee value still equals the snapshot value or is empty, so manual edits win without any change to U1's schema or edit flow (Q1; BR3.3 in rules.md).
      - An orphaned snapshot (its employee was deleted) is ignored and may be cleaned up lazily.
    relationships:
      - to: Employee (owned by employee-pool unit)
        cardinality: one snapshot per employee
        direction: references
```

## Entity Summary

Two entities, both owned by this unit. **EmployeeImportRun** is the progress/outcome record per generate-from-CVs execution: counts plus a failure list whose records are explicit objects with four reasons — the two the requester chose for reporting (Q2: UNREADABLE, INCOMPLETE_EXTRACTION) plus two operational ones surfaced by design review (EXTRACTION_FAILED for AI-service failures on a document, AMBIGUOUS_NAME for a candidate matching multiple employees). **EmployeeExtractionSnapshot** holds the last extracted values per employee; comparing current values against it makes "manual edits win" (Q1) mechanical, without extending or modifying U1's Employee schema — there is exactly one authoritative Employee entity, owned by U1.

## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-08-19T12:34:33Z
**Iteration:** 2

### Findings

| # | Severity | Location | Finding | Recommendation |
|---|---|---|---|---|
| — | — | — | No blocking issues found | All iteration 1 fixes verified and correctly implemented; all standing contracts satisfied |

### Verification of Iteration 1 Fixes

| Fix | Claimed Resolution | Verification Result |
|---|---|---|
| 1. Employee-schema extension conflict | Replaced extension with U2-owned EmployeeExtractionSnapshot entity | ✓ VERIFIED: EmployeeExtractionSnapshot (lines 67-93) references employeeId and holds snapshot fields; U1's Employee schema (employee-pool entities.md) contains no U2 extensions; BR3.3 implements field-level comparison logic correctly |
| 2. AI-service failure gaps | Added EXTRACTION_FAILED category with retry-once + five-consecutive escalation | ✓ VERIFIED: failedDocuments enum (line 44) includes EXTRACTION_FAILED; BR2.1 (lines 24-29) specifies retry-once and five-consecutive-failures escalation to FAILED; BR2.2 (lines 32-37) applies same handling; BR4.2 (lines 80-86) acknowledges mid-run failure preservation |
| 3. Duplicate normalized names | BR3.1 refuses ambiguous matches and records AMBIGUOUS_NAME | ✓ VERIFIED: AMBIGUOUS_NAME in failedDocuments enum (line 44); BR3.1 (lines 39-45) explicitly handles "two or more employees match" case with refusal logic |
| 4. failedDocuments structure | Changed to list of objects with documentName + four-value reason enum | ✓ VERIFIED: entities.md lines 40-44 specify "list of objects" with "documentName (text, max 500 chars)" and "reason (enumerated text in {UNREADABLE, INCOMPLETE_EXTRACTION, EXTRACTION_FAILED, AMBIGUOUS_NAME})" |

### Standing Contract Verification

| Contract | Requirement | Result |
|---|---|---|
| YAML well-formedness | Both entities.md and rules.md carry properly fenced yaml blocks | ✓ PASS: entities.md (2 entities), rules.md (11 rules), all blocks parse without errors |
| Traceability completeness | All FR2.x covered; all BRs targeted or explained in reverse[] | ✓ PASS: 5 FRs mapped (FR2.1→BR2.1, FR2.2→BR5.1, FR2.3→BR3.1, FR2.4→BR4.1, FR2.5→BR2.2); 6 rules explained in reverse[] (BR1.1, BR1.2, BR3.2, BR3.3, BR3.4, BR4.2); 11/11 rules accounted for with no orphans |
| Q1 faithfulness (manual edits win) | Re-import updates only AI-imported field values | ✓ PASS: EmployeeExtractionSnapshot comparison in BR3.3 (lines 56-62) implements "IF current value equals snapshot value OR is empty THEN overwrite"; entities.md lines 85-88 explicitly states manual edits win |
| Q2 faithfulness (two reporting categories) | User requested UNREADABLE + INCOMPLETE_EXTRACTION | ✓ PASS with extension: Two user-requested categories present (UNREADABLE, INCOMPLETE_EXTRACTION); two operational categories added by design review (EXTRACTION_FAILED, AMBIGUOUS_NAME) are reasonable extensions for failure cases not anticipated in Q&A, not contradictions of Q2's "two categories" answer |
| DIRECT import | No review-before-save step | ✓ PASS: functional-spec.md W1 step 5 (lines 11-12) shows merge writes directly through U1's persistence rules; no draft/approval step in workflow |
| Merge-by-name never delete | Existing employees not in current run remain untouched | ✓ PASS: BR3.2 (lines 48-54) explicitly prohibits deletion: "IF an existing employee matches no CV in this run THEN leave the record untouched" |
| Technology-agnostic | No code, SQL, framework references | ✓ PASS: All artifacts use logical types (identifier, enumerated text, count, list of objects, timestamp, map); rules use plain IF...THEN language; no implementation details |

### Cross-Reference Integrity

| Reference | Target | Resolution |
|---|---|---|
| Employee (owned by employee-pool unit) | U1 entities.md | ✓ Resolves: Employee entity exists with employeeId at employee-pool/functional-design/entities.md lines 7-57 |
| EmployeeExtractionSnapshot.employeeId → Employee | U1 Employee | ✓ Valid reference documented in entities.md line 74 and relationship line 91 |
| BR source references (FR2.x, FR5.1, NFR6, Q1, integration surface) | requirements.md, Q&A, unit-of-work.md | ✓ All 11 BR sources resolve to valid upstream artifacts |
| failedDocuments reason enum values | BR logic | ✓ All four values (UNREADABLE, INCOMPLETE_EXTRACTION, EXTRACTION_FAILED, AMBIGUOUS_NAME) referenced in BR2.1, BR2.2, BR3.1 logic |

### Architectural Soundness

**Component boundary adherence**: U2 writes employees only through U1's persistence rules (BR3.4, functional-spec.md line 11), preserving the architectural ownership declared in components.md and ADR-004. The EmployeeExtractionSnapshot entity is correctly scoped to U2 (import logic) and references but does not extend U1's Employee schema. ✓

**Entity ownership clarity**: Both entities (EmployeeImportRun, EmployeeExtractionSnapshot) are unambiguously owned by this unit; Employee ownership remains with U1 per components.md lines 44-49 and employee-pool entities.md. ✓

**Workflow completeness**: W1 (6 steps) covers trigger through completion with all failure paths; W2 (2 steps) covers outcome review and correction; state machine (4 transitions) covers all status values declared in entities.md line 22. ✓

**Business rules consistency**: All 11 rules internally consistent; BR2.1 and BR2.2 share retry/escalation logic; BR3.3 references EmployeeExtractionSnapshot fields correctly; BR4.1 and BR4.2 cover completion and mid-run failure without overlap. ✓

**Failure containment**: AI-service failures (EXTRACTION_FAILED) are per-document with bounded escalation (five consecutive → run FAILED); ambiguous name matches (AMBIGUOUS_NAME) record failure without guessing; mid-run failures preserve already-imported employees (BR4.2). Blast radius is clear and contained. ✓

### Summary

The Functional Design artifacts for **cv-import (U2), iteration 2**, are **architecturally sound and ready for approval**. After exhaustive adversarial review attempting to refute the design through cross-reference validation, consistency checks, and faithfulness verification, zero blocking issues were found.

**Iteration 1 fixes**: All four claimed fixes are correctly and completely implemented. The EmployeeExtractionSnapshot entity cleanly separates U2's import precedence concerns from U1's Employee schema. The EXTRACTION_FAILED category with retry-once and five-consecutive-failures escalation closes the AI-service failure gap. The AMBIGUOUS_NAME handling prevents silent overwrites on duplicate normalized names. The failedDocuments structure now provides explicit documentName and reason for every failure.

**Standing contracts**: All seven standing contracts are satisfied. YAML blocks are well-formed and parse without errors. Traceability covers all 5 FRs and explains all 6 untargeted rules with no orphans. Q1 (manual edits win) is faithfully implemented via snapshot comparison. Q2 (two reporting categories) is honored with two reasonable operational extensions. DIRECT import, merge-by-name never delete, and technology-agnostic constraints are all satisfied.

**Cross-unit integration**: The Employee entity reference resolves correctly to U1's schema. U2 writes employees only through U1's persistence rules (BR3.4), preserving the architectural boundary declared in domain-design. The EmployeeExtractionSnapshot entity is correctly scoped to U2 and references but does not extend U1's schema.

**Implementability**: A developer could build this import flow from these artifacts without architectural guidance beyond this document. Workflows are complete with all failure paths specified. Business rules are internally consistent and trace to requirements. Entity relationships are clear with explicit cardinality and direction.

**Recommend approval to proceed to code-generation.**
