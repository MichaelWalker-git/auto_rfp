# Entities — employee-pool (U1)

Entity model for U1 per unit-of-work.md (U1 boundary), unit-of-work-story-map.md (FR1.x, FR5.1 assignment), requirements.md (FR1.3/FR1.4), the component catalogue (components.md — Employee owned by EmployeePool), and the confirmed answers in `functional-design-questions.md` (Q1, Q2). Technology-agnostic; storage-key mechanics belong to code generation. The EmployeeImportRun entity belongs to U2's design.

```yaml
entities:
  - name: Employee
    description: A member of the organization's delivery workforce, maintained as reference data for team assembly and proposal documents.
    attributes:
      - name: employeeId
        type: identifier
        required: true
        unique: true
        constraints: system-generated; immutable
      - name: orgId
        type: identifier
        required: true
        constraints: immutable; every read and write is scoped to it (BR2.3)
      - name: name
        type: text
        required: true
        constraints: non-empty after trimming; max 200 characters
      - name: primaryRoles
        type: list of text
        required: false
        default: empty list
        constraints: each entry non-empty, max 100 characters; suggestions drawn from the org's labor-rate positions, free text allowed (BR1.5)
      - name: secondaryRoles
        type: list of text
        required: false
        default: empty list
        constraints: same shape as primaryRoles
      - name: certifications
        type: list of text
        required: false
        default: empty list
        constraints: each entry non-empty, max 200 characters
      - name: resumeRef
        type: reference or link
        required: false
        constraints: when present, either an org-document reference or an external link (BR1.4)
      - name: location
        type: enumerated text
        required: false
        allowed_values: [ONSHORE, OFFSHORE]
      - name: source
        type: enumerated text
        required: true
        allowed_values: [MANUAL, AI_IMPORT]
        default: MANUAL
        constraints: records how the record was created; manual edits never change identity (BR3.2)
      - name: createdAt
        type: timestamp
        required: true
      - name: updatedAt
        type: timestamp
        required: true
    entity_constraints:
      - Employee identity is (orgId, employeeId); records never move across organizations.
      - Deletion is physical for the pool but referentially safe for consumers — saved plan teams retain a name/role snapshot (Q2: B; the snapshot lives in U3's PlanTeam, not here).
    relationships:
      - to: PlanTeam member line (owned by plan-team unit)
        cardinality: one Employee to many team lines
        direction: referenced-by
        note: reference by employeeId; consumer keeps a display snapshot for removed employees
      - to: LaborRate position (existing pricing domain)
        cardinality: none (no stored link)
        direction: advisory
        note: positions feed role SUGGESTIONS only; no foreign-key relationship is stored (Q1)
```

## Entity Summary

One entity: **Employee**, owned by this unit. Roles are plain text lists split into primary and secondary, with typing suggestions sourced from the org's labor-rate positions but no stored linkage — free text stands when no position fits (Q1). The record carries its provenance (`source`) so AI-imported and manually created employees are distinguishable, which the merge rule in U2 relies on. Deletion is permitted even when the employee sits on a saved solution-plan team; the consuming team keeps a snapshot (Q2: B), so this entity holds no back-references.

## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-08-19T11:49:36Z
**Iteration:** 1

### Findings

| # | Severity | Location | Finding | Recommendation |
|---|---|---|---|---|
| — | — | — | No blocking issues found | Proceed to approval gate |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| YAML well-formedness | PASS | entities.md carries a properly fenced yaml block (lines 5-70) with all required attribute fields (name, type, required/unique, references, allowed values, defaults, constraints); rules.md carries a properly fenced yaml block (lines 6-111) with 13 rules in BR{group}.{seq} format, each with all required fields (statement, category, applies_to, trigger, logic, violation, source) |
| Entity model completeness | PASS | Entity-level constraints present (lines 58-60); relationships with cardinality and direction present (lines 61-69); all attributes from domain design (components.md line 46) correctly captured |
| Traceability completeness | PASS | All 6 upstream FRs (FR1.1-FR1.5, FR5.1) covered with status "OK" and valid BR targets; all 13 BR rules accounted for (6 direct targets in coverage[], 7 explained in reverse[]); no orphaned rules |
| Workflow completeness | PASS | functional-spec.md contains workflows W1-W4 with numbered steps, state machine with guards and actions (lines 34-42), derived ER diagram consistent with entities.md (Employee attributes match; createdAt/updatedAt omitted for readability), derived rules summary consistent with rules.md (all 13 BRs mentioned) |
| Cross-reference integrity | PASS | PlanTeam reference (entities.md line 63) resolves to TeamDefinition component in U3 per components.md; LaborRate reference (line 67) resolves to StaffingPlan per components.md lines 183-201; all BR sources trace to valid FRs or NFRs |
| Q&A faithfulness | PASS | Q1 (role suggestions with free-text fallback) correctly implemented in entities.md line 27, rules.md BR1.5, frontend-components.md line 15; Q2 (delete allowed with snapshot) correctly implemented in entities.md line 60, rules.md BR3.1, functional-spec.md W4 line 29 |
| Technology-agnostic verification | PASS | All artifacts use logical types (identifier, text, list of text, enumerated text, timestamp) with no SQL, framework names, or code; rules express logic in plain IF...THEN language |
| Domain design consistency | PASS | Employee owned by EmployeePool per components.md lines 44-48; no stored labor-rate linkage per entities.md line 69 and Q1 answer; EmployeeImportRun correctly scoped to U2 per work-packaging split in unit-of-work.md |
| Project rules adherence | PASS | Org-level employee page per frontend-components.md line 7; merge-by-name support via immutable identity (BR3.2); direct import mentioned in context |

### Summary

The Functional Design artifacts for unit **employee-pool (U1)** are **architecturally sound and ready for approval**. After exhaustive adversarial review attempting to refute the design through cross-reference validation, consistency checks, and faithfulness verification, zero blocking issues were found.

**Stage contract compliance**: entities.md carries a well-formed YAML source-of-truth block with all required attribute metadata, entity-level constraints, and relationships with cardinality. rules.md carries 13 business rules in the mandated BR{group}.{seq} format with all required fields and complete traceability. functional-spec.md serves as the source of truth for workflows and state machines, with derived ER and rules-summary views that are mechanically consistent with their source artifacts. traceability.json covers all 6 upstream functional requirements assigned to U1 (FR1.1-FR1.5, FR5.1) with valid BR targets, and the reverse array explains all 7 rules not directly targeted by FRs. No orphaned requirements or unexplained rules exist.

**Faithfulness verification**: Both confirmed Q&A answers are correctly and consistently implemented across all artifacts. Q1 (role suggestions from labor-rate positions with free-text fallback) appears in entities.md attribute constraints, rules.md BR1.5 logic, and frontend-components.md RoleTagInput specification. Q2 (delete allowed with consumer-kept snapshot) appears in entities.md entity constraints, rules.md BR3.1 policy, and functional-spec.md workflow W4 confirmation messaging. The domain design boundary (Employee owned by EmployeePool component, no stored labor-rate linkage) is honored. Project rules (org-level management surface, merge-by-name support via immutable identity) are satisfied.

**Adversarial attempts to refute**: Checked for circular dependencies (none — Employee has no entity dependencies), invalid cross-references (all resolve: PlanTeam to U3, LaborRate positions to StaffingPlan), implementation ambiguities (resumeRef clarified by BR1.4, role suggestions clarified by relationship notes, search/filter/sort specified in frontend-components.md), contradictions (physical deletion consistent with referential safety via snapshots, source defaults consistent with provenance rules), and technology leakage (none — all logical types, no SQL/framework/code). Blast radius is clear (Employee CRUD failure blocks TeamDefinition matching and DocumentGeneration personnel citations), and the design is independently implementable once its dependencies (OrgDocuments for CV reads) are available.

**Recommendation: Approve to proceed to code-generation.**
