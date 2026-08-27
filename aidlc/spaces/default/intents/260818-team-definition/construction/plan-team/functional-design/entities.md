# Entities — plan-team (U3)

Entity model for U3 per unit-of-work.md (U3 boundary), unit-of-work-story-map.md (FR3.x, FR5.2), requirements.md, components.md (PlanTeam owned by TeamDefinition, embedded in the solution plan item per ADR-002), and the confirmed answers in `functional-design-questions.md` (Q1, Q2). Employee is owned by U1; the snapshot fields below implement U1's delete policy (its BR3.1) on the consumer side.

```yaml
entities:
  - name: PlanTeam
    description: The team attached to one opportunity's solution plan — AI-recommended, human-correctable, and the single source downstream documents read.
    attributes:
      - name: opportunityId
        type: identifier
        required: true
        constraints: identifies the owning solution plan; PlanTeam is embedded as a structured field on the plan item (ADR-002)
      - name: members
        type: list of TeamMember
        required: true
        default: empty list
      - name: userModified
        type: boolean
        required: true
        default: false
        constraints: set true on any human save of an edited team; governs preservation across plan regeneration (BR1.2)
      - name: generatedAt
        type: timestamp
        required: false
        constraints: when the current recommendation was produced
      - name: savedAt
        type: timestamp
        required: false
        constraints: when a human last saved the team
    entity_constraints:
      - PlanTeam has no independent storage identity — it lives and versions with the solution plan item.
      - The SAVED team (after human save, or the generated one if never edited) is what document generation reads (BR3.2).
    relationships:
      - to: SolutionPlanItem (owned by the existing solution plan domain)
        cardinality: one plan item holds at most one PlanTeam
        direction: embedded-in
      - to: Employee (owned by employee-pool unit)
        cardinality: one PlanTeam references many employees via member lines
        direction: references

  - name: TeamMember
    description: One line of the team — a person in a role with the reasoning for the match. A value object inside PlanTeam, not independently stored.
    attributes:
      - name: employeeId
        type: identifier
        required: false
        constraints: reference to a U1 Employee; absent when the line is an unfilled position slot, or when the referenced employee was deleted after saving
      - name: nameSnapshot
        type: text
        required: false
        constraints: required whenever the line has (or had) a person — present when employeeId is set and preserved after the employee's deletion (U1 delete policy); absent only on unfilled position lines (BR1.3)
      - name: role
        type: text
        required: true
        constraints: the staffing plan position name where one exists, free text otherwise (BR2.1)
      - name: staffingPositionRef
        type: identifier reference to StaffingPlanLine
        required: false
        constraints: the staffing plan line's position identifier (positions are unique per staffing plan); present when the role line came from the opportunity's staffing plan (FR3.3)
      - name: rationale
        type: text
        required: false
        constraints: one or two plain sentences citing the strongest matches — certifications and skills against the role/requirements (Q1); absent on manually added lines
      - name: removedEmployee
        type: boolean
        required: true
        default: false
        constraints: true when the referenced employee no longer exists in the pool; the line renders from snapshots and is marked (U1 delete policy)
      - name: source
        type: enumerated text
        required: true
        allowed_values: [AI_RECOMMENDED, MANUAL]
        default: AI_RECOMMENDED
    entity_constraints:
      - Sizing rule — the generated team proposes one member per staffing plan position; with no staffing plan, the AI proposes role slots from the solicitation's requirements (Q2).
      - Line shapes — a FILLED line has employeeId + nameSnapshot; a DELETED-employee line has nameSnapshot + removedEmployee true and no employeeId; an UNFILLED position line has neither employeeId nor nameSnapshot nor rationale, only role (+ staffingPositionRef where applicable) (BR1.3).
    relationships:
      - to: StaffingPlanLine (owned by the existing pricing domain)
        cardinality: at most one position per member line
        direction: references
```

## Entity Summary

**PlanTeam** is the plan-embedded team (the cost-schedule precedent): a member list, a `userModified` flag that decides preservation across plan regenerations, and generation/save timestamps. **TeamMember** is a value object per line: an employee reference with name snapshot (so deleted employees render marked rather than breaking — the consumer half of U1's delete policy), a role linked to a staffing plan position where one exists, an optional short-sentence rationale (Q1), and a source marker distinguishing AI recommendations from manual additions. Sizing follows the staffing plan one-per-position; the AI proposes slots only when no staffing plan exists (Q2).

## Review

**Verdict:** NOT-READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-08-19T12:47:22Z
**Iteration:** 2

### Findings

| # | Severity | Location | Finding | Recommendation |
|---|---|---|---|---|
| 1 | Major | entities.md line 65-69, BR3.3 | removedEmployee update mechanism undefined — the design specifies the flag exists and what it means (BR3.3: "IF the referenced employee no longer exists THEN removedEmployee is true") but not WHO sets it or WHEN. Three architecturally distinct paths exist: (a) derived field computed on every read; (b) lazy background sync; (c) eager cascade on U1 employee delete. The choice affects performance, consistency, transaction boundaries, and component coupling. Since removedEmployee is declared as a required attribute with default false (not a computed field), it appears persisted, yet no BR or workflow specifies the update trigger. Workflow W2 says lines "render from snapshots with the removed-employee mark" (suggesting check-on-read), but the attribute definition suggests stored state. | Specify the update mechanism in BR3.3 or a new BR3.4: (a) "removedEmployee is computed on every team read by checking employee existence against U1's pool" (derived, no storage updates), (b) "a background job scans all teams hourly and marks lines whose employees no longer exist" (lazy batch), or (c) "U1's employee delete operation enqueues a team-marking task that updates all referencing PlanTeams" (eager cascade via event). Clarify whether this is U3's responsibility (detect on read) or U1's (notify on delete). |
| 2 | Minor | entities.md line 77, BR3.3 | Line-shape constraint incomplete for DELETED-employee rationale handling — the enumerated shapes specify "DELETED-employee line has nameSnapshot + removedEmployee true and no employeeId" but don't address rationale. When an AI-recommended employee (source=AI_RECOMMENDED, rationale present per BR1.4) is deleted, does the rationale persist on the line (showing why that person was originally chosen) or get dropped (leaving only name + removed mark)? This affects W2 rendering and BR3.3 implementation. | Extend the line-shape constraint to specify: "a DELETED-employee line has nameSnapshot + removedEmployee true, no employeeId, and retains its rationale if originally AI-recommended" (or explicitly states rationale is cleared on deletion). |
| 3 | Minor | BR2.1 line 39-46 | staffingPositionRef lifecycle ambiguous — BR2.1 states "IF the role matches a staffing plan position THEN staffingPositionRef is set" but doesn't specify WHEN this check runs (on generation? on save? on role edit?) or WHAT happens when the role text is edited away from a position match (does the ref persist or clear?). W3 step 2 allows "change a role" with staffing positions suggested and free text allowed, but doesn't clarify whether editing the role updates/clears/preserves staffingPositionRef. Also unclear whether BR2.1 applies to manually added lines (W3 "add a person") or only to AI-generated lines. | Add a constraint to BR2.1 or new BR2.2 specifying: "staffingPositionRef is set during team generation and on manual save if the role text matches a position name; it is cleared if the role is edited to non-matching text. Manual line additions (source=MANUAL) follow the same rule — ref is set if the user selects a suggested position, null for free-text roles." |
| 4 | Minor | entities.md line 29, W4 step 2 | savedAt behavior on explicit regenerate unspecified — W4 states "the fresh recommendation replaces the team, userModified resets to false" but doesn't mention savedAt. Should it be cleared (no "saved" version exists, it's now fresh AI) or retained (historical metadata of when the previous user-edited version was last saved)? The semantic meaning of savedAt ("when a human last saved the team") suggests it should clear, but this is not explicit. | Clarify in W4 step 2 or BR1.2: "explicit regenerate clears savedAt (set to undefined/null) along with resetting userModified to false" (or explicitly states it's retained as historical metadata). |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| YAML well-formedness | PASS | entities.md + rules.md carry properly fenced yaml blocks; all required fields present; 2 entities (PlanTeam, TeamMember), 12 rules (BR1.1–BR5.2) in correct format |
| Traceability completeness | PASS | All 7 upstream FRs (FR3.1–FR3.6, FR5.2) covered with status "OK" and valid BR targets; all 12 BR rules accounted for (7 direct coverage, 5 explained in reverse[]); no orphans |
| Cross-reference integrity | PASS | All entity references resolve: SolutionPlanItem → SolutionPlan component, Employee → U1, StaffingPlanLine → StaffingPlan (verified against components.md) |
| Q&A faithfulness | PASS | Q1 (short-sentence rationale) correctly in BR1.4 + entities.md line 62-65; Q2 (one per position / AI slots) correctly in BR1.3 + entity constraint line 76 |
| ADR constraint satisfaction | PASS | ADR-002 (embedded team) in entities.md lines 12, 32, BR3.2; ADR-003 (no vector index) in BR5.2 line 97; ADR-005 (deliberate cycle) acknowledged in W1 step 7 |
| Technology-agnostic verification | PASS | All logical types (identifier, text, list, boolean, timestamp, enumerated text); no SQL, no framework names, no code in any artifact |
| Iteration 1 fix verification | PASS | Critical finding (nameSnapshot contradiction) resolved with line-shape constraint; Minor finding (staffingPositionRef vague type) resolved with explicit "identifier reference to StaffingPlanLine" |

### Summary

Iteration 1's critical findings are successfully resolved: nameSnapshot is now required:false with a precise line-shape constraint enumerating FILLED/DELETED-employee/UNFILLED shapes, and staffingPositionRef is explicitly typed. The structural integrity is sound — YAML well-formed, traceability complete (7/7 FRs covered, 12/12 BRs accounted for), all cross-references resolve, Q&A answers faithfully implemented, ADR constraints satisfied, technology-agnostic throughout.

**However, one Major finding blocks READY: the removedEmployee update mechanism is architecturally undefined.** The design specifies the flag's meaning (BR3.3) but not the implementation path. This is not a code-generation detail — it's a cross-component architectural decision with performance, consistency, and coupling implications. Three distinct paths exist (derived field, lazy batch sync, eager cascade), each with radically different consequences. A developer implementing BR3.3 or W2 rendering cannot proceed without this specification, as it determines whether to build a check-on-read (U3 owns detection), a batch job (separate process), or a cascade trigger (U1 notifies U3 on delete). The attribute definition (required: true, default: false) suggests persisted state, yet no workflow or rule specifies the update trigger, and W2's "render from snapshots" phrasing suggests runtime detection. This ambiguity must be resolved before code-generation.

The three Minor findings (DELETED-employee rationale handling, staffingPositionRef lifecycle, savedAt on regenerate) are clarifications that improve implementability but don't block progress if the team accepts reasonable defaults. The Major finding, however, is a blocker — it crosses U1/U3 boundaries, affects the system's consistency model, and has no clear owner in the current design.

**Recommend addressing Finding #1 (removedEmployee mechanism) before approval. Findings #2-4 are improvements but not blockers.**
