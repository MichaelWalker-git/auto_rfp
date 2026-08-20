# Entities — team-qualifications (U4)

Entity model for U4 per unit-of-work.md (U4 boundary), unit-of-work-story-map.md (FR4.x), requirements.md, components.md (DocumentGeneration extended; no new owned entities), and the confirmed answers in `functional-design-questions.md` (Q1, Q2). U4 owns NO persistent entities — it is a read-side extension of the existing document generation pipeline. The value shape below describes the generation context it assembles transiently.

```yaml
entities:
  - name: TeamQualificationsContext
    description: Transient, per-generation value object — the grounded personnel context the TEAM_QUALIFICATIONS prompt receives. Never persisted; assembled fresh on each generation request.
    attributes:
      - name: opportunityId
        type: identifier
        required: true
        constraints: the solution plan whose saved team is read
      - name: members
        type: list of cited members
        required: true
        constraints: one entry per FILLED team line — nameSnapshot, role, certifications, location, and the referenced CV's extracted text where the employee's resumeRef resolves to an org document (Q1)
      - name: openRoles
        type: list of text
        required: true
        default: empty list
        constraints: role names of UNFILLED team lines, cited as open positions with no personnel claims (Q2)
      - name: pendingReplacements
        type: list of cited members
        required: true
        default: empty list
        constraints: removed-employee lines — nameSnapshot and role only, marked pending replacement; no qualification claims beyond the snapshot (Q2)
    entity_constraints:
      - Assembled ONLY from the persisted saved team (plan-team unit's rule that the saved team is what documents read) and the referenced Employee records — never from generic knowledge-base search for personnel.
      - Absent saved team means no context is assembled — the request is refused with guidance (rules.md BR1.1), never a failed generation run.
      - Line-shape detection — assembly classifies each TeamMember line by the plan-team unit's declared fields, in this order — IF nameSnapshot absent AND employeeId absent THEN UNFILLED (populate openRoles); ELSE IF removedEmployee is true THEN DELETED (populate pendingReplacements); ELSE IF employeeId present THEN FILLED (read the Employee, populate members); ELSE invalid line (log a data-integrity warning and cite the snapshot as pending replacement rather than dropping it). (rules.md BR2.5)
      - Defensive fallback — U4 trusts the plan-team unit's removedEmployee flag, but IF a FILLED line's Employee lookup finds no record THEN the line is treated as DELETED (snapshot-only, pending replacement) and a data-integrity warning is logged; the generation never fails on a stale flag. (rules.md BR2.5)
    relationships:
      - to: PlanTeam (owned by plan-team unit)
        cardinality: one context reads one saved team
        direction: reads
      - to: Employee (owned by employee-pool unit)
        cardinality: one context reads many employees
        direction: reads
      - to: Document (owned by the existing org-documents domain)
        cardinality: one context reads at most one CV text per member
        direction: reads
```

## Entity Summary

U4 persists nothing. Its one design shape, **TeamQualificationsContext**, is the transient grounding bundle each TEAM_QUALIFICATIONS generation assembles: filled team lines with structured fields plus the referenced CV's extracted text (Q1), open roles for unfilled positions, and snapshot-only pending-replacement entries for removed employees (Q2). The existing generated document remains owned by the document-generation domain; this unit only changes what feeds its prompt.

## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-08-19T13:06:04Z
**Iteration:** 2

### Findings

| # | Severity | Location | Finding | Recommendation |
|---|---|---|---|---|
| — | — | — | No blocking issues found | Proceed to approval gate |

### Validation Results — Iteration 1 Resolution

| Check | Result | Evidence |
|---|---|---|
| BR2.5 detection order vs U3 line shapes | PASS | U3 declares FILLED (employeeId + nameSnapshot), DELETED (nameSnapshot + removedEmployee true, no employeeId), UNFILLED (neither). BR2.5's order: (1) IF both absent → UNFILLED ✓ (2) ELSE IF removedEmployee true → DELETED ✓ (3) ELSE IF employeeId present → FILLED ✓. All three shapes correctly detected. |
| Defensive fallback coherence | PASS | BR2.5 lines 52-54: FILLED line whose Employee lookup finds no record is treated as DELETED with data-integrity warning, never fatal. This insulates U4 from U3's removedEmployee maintenance mechanism and handles stale references gracefully. Coherent. |
| Invalid shape handling | PASS | "any other shape logs a warning and is cited as pending replacement rather than dropped" (BR2.5 line 54) — catches the edge case (nameSnapshot present, employeeId absent, removedEmployee false) and handles it defensively rather than fatally. |

### Validation Results — Standing Contract

| Check | Result | Evidence |
|---|---|---|
| YAML blocks well-formed | PASS | entities.md lines 5-43: properly fenced ```yaml block with all required fields (name, type, required, constraints, relationships). rules.md lines 6-84: properly fenced ```yaml block with 8 rules in BR{group}.{seq} format, each with all required fields (statement, category, applies_to, trigger, logic, violation, source). |
| Traceability for FR4.1-FR4.3 | PASS | traceability.json coverage[]: FR4.1 → BR2.1 (grounding), FR4.2 → BR1.1 (no-saved-team guard), FR4.3 → BR3.1 (document placement). All 3 FRs covered with status "OK" and valid BR targets. |
| BR2.5 reverse[] explanation | PASS | traceability.json reverse[] line 15: BR2.5 explained as "Q2 answer — line-shape detection and stale-reference fallback against the plan-team unit's contract". Correctly attributes it to Q2 and names the cross-unit dependency. |
| Q1 faithfulness (CV text grounding) | PASS | Q1 answer "A. Structured fields plus the referenced CV's text" implemented in entities.md lines 16-17 (members cite "the referenced CV's extracted text") and rules.md BR2.2 lines 32-38 (IF resumeRef resolves THEN include CV text). |
| Q2 faithfulness (edge-line handling) | PASS | Q2 answer "A. Unfilled positions are listed as open roles; removed-employee lines cite the snapshot, marked pending replacement" implemented in entities.md openRoles (line 19-22) + pendingReplacements (line 23-27) attributes, rules.md BR2.3 (lines 40-46), and BR2.5 line-shape detection (lines 47-54). |
| No-saved-team guard before run | PASS | BR1.1 lines 12-13: "refuse the request with guidance... no generation job is created". functional-spec.md state machine (line 22): no saved team → (no run) state with guidance response, never enters GENERATING. Refuses BEFORE creating a document run, so no FAILED run is produced. |
| Exclusive grounding | PASS | BR2.1 lines 28-30: "never generic knowledge-base search results for personnel". entities.md entity_constraints line 29-30: "Assembled ONLY from the persisted saved team... and the referenced Employee records — never from generic knowledge-base search for personnel." |
| Transient-only entities | PASS | entities.md line 3-4: "U4 owns NO persistent entities". TeamQualificationsContext description line 8: "Transient, per-generation value object ... Never persisted; assembled fresh on each generation request." Entity summary line 47: "U4 persists nothing." |
| Technology-agnostic | PASS | All artifacts use logical types (identifier, list, text, timestamp, enumerated text). rules.md uses plain IF...THEN language. functional-spec.md uses natural language workflows + mermaid (acceptable). No SQL, framework names, or code in any artifact. |
| Cross-reference integrity | PASS | entities.md relationships (lines 34-42): PlanTeam resolves to plan-team unit's entities.md, Employee resolves to employee-pool unit's entities.md, Document resolves to org-documents domain per components.md. All references valid. |
| Artifact consistency | PASS | entities.md entity_constraints (lines 31-33) correctly reference BR2.5 with inline detection-order summary. functional-spec.md W1 step 3 (lines 7-9) correctly references BR2.5's detection order + stale-reference fallback. Unhappy paths (line 13) correctly cite BR2.5 for the FILLED-line defensive fallback. All cross-artifact references consistent. |

### Summary

**Iteration 1 Critical finding: RESOLVED.** The line-shape detection logic is now fully specified via BR2.5 with a precise detection order that correctly handles all three U3-declared shapes (UNFILLED, DELETED, FILLED) and includes a coherent defensive fallback for stale references (FILLED line whose Employee lookup fails is treated as DELETED with a data-integrity warning, never fatal). The detection order is consistent across entities.md entity_constraints, rules.md BR2.5, and functional-spec.md W1 workflow — no contradictions found.

**All standing contract items satisfied:**
- YAML blocks present and well-formed (entities.md + rules.md)
- Traceability complete: all 3 FRs (FR4.1-FR4.3) covered with valid BR targets; BR2.5 explained in reverse[] with Q2 + U3 contract attribution
- Q1 and Q2 answers faithfully implemented (CV text grounding + edge-line handling)
- No-saved-team guard refuses before run creation (BR1.1), never produces FAILED document
- Exclusive grounding on saved team + referenced employees, explicitly excludes KB search (BR2.1)
- Transient-only entity design (TeamQualificationsContext never persisted)
- Technology-agnostic throughout (no SQL/framework/code)
- All cross-references resolve (PlanTeam to U3, Employee to U1, Document to org-documents)

**Adversarial review attempts to refute:** Checked for detection-order gaps (none — all shapes handled), fallback incoherence (none — stale reference treated as DELETED with warning is reasonable), artifact inconsistencies (none — entities, rules, spec, and traceability all align), invalid shape handling (correct — logged and cited as pending replacement, never dropped), missing behaviors (none — all Q1/Q2 answers covered), cross-unit contract violations (none — BR2.5 correctly references U3's TeamMember shapes). Zero blocking issues found.

**The functional design for U4 (team-qualifications) is architecturally sound and implementation-ready.** A developer could build the TEAM_QUALIFICATIONS context assembly and no-saved-team guard from these artifacts without architectural guidance beyond this document. The iteration 1 resolution correctly addresses the unspecified line-shape detection logic, and the design remains consistent with the upstream contracts (unit-of-work.md U4 boundary, requirements.md FR4.x, components.md DocumentGeneration extension).

**Recommend approval to proceed to code-generation.**
