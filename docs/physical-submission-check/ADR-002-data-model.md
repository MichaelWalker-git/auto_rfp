# ADR-002: Data Model — Separate Detection Enum, Structured Address, No Source Tracking

## Status

Accepted

## Context

The codebase has an existing `SubmissionMethodSchema` in `packages/core/src/schemas/proposal-submission.ts` with values `PORTAL`, `EMAIL`, `MANUAL`, `HAND_DELIVERY`, `OTHER`. This describes **how a proposal was actually submitted** (the action taken). The physical submission check needs to describe **what the RFP requires** (the solicitation's instruction). These are semantically different axes.

The codebase also has two established patterns for AI-detected fields on opportunities:
1. **With source tracking** — `deliveryLocationConstraint` has `deliveryConstraintSource: 'AI_DETECTED' | 'USER_SET'` to prevent the AI from overwriting user edits on re-scan.
2. **Without source tracking** — `foiaContactAddress` is a simple string field, user-editable, AI-populated.

For structured addresses, the `FoiaComponentAddressSchema` provides a proven schema with `formatFoiaComponentAddress()` for rendering.

## Decision

### Separate enum from proposal-submission

New enum `SubmissionMethodDetectedSchema` on `OpportunityItemSchema`:
```
z.enum(['ELECTRONIC', 'PHYSICAL', 'BOTH', 'UNKNOWN'])
```

This is deliberately separate from `SubmissionMethodSchema` in `proposal-submission.ts`. The naming includes `Detected` to make the distinction clear at the type level.

### Three new fields on OpportunityItemSchema

Added after `deliveryConstraintRationale` (line ~392), following the existing section-comment pattern:

| Field | Type | Purpose |
|-------|------|---------|
| `submissionMethod` | `SubmissionMethodDetectedSchema.nullish()` | What the RFP requires |
| `submissionMailingAddress` | `FoiaComponentAddressSchema.nullish()` | Structured mailing address for physical submission |
| `submissionMethodRationale` | `z.string().max(500).nullish()` | Excerpt from solicitation that indicates the submission method |

All fields are `.nullish()` so existing opportunity records and construction sites read cleanly with no migration.

### No source tracking (unlike deliveryConstraint)

The user's override is a simple toggle that patches `submissionMethod` directly. No `submissionMethodSource: 'AI_DETECTED' | 'USER_SET'` field.

**Trade-off acknowledged**: When the exec brief is re-generated, the scan will overwrite a user's manual toggle. This is acceptable because:
- Physical submission is a factual property of the solicitation, not a subjective judgment
- If the solicitation says "electronic only" but the user toggled "physical", the re-scan correcting it back to "electronic" is likely the right behavior
- The rationale field shows what text triggered the detection, making it easy to verify

### Computed helper, not stored field

`isPhysicalSubmission(method)` is a pure function exported from `packages/core`, not a stored field. It returns `true` for `PHYSICAL` or `BOTH`. Used by both backend (brief worker, Linear sync) and frontend (badge, banner conditional rendering).

Similarly, `computeMailDeadline()` is a pure function that calculates the internal mail deadline from `responseDeadlineIso` minus configurable transit days. Not persisted.

### Structured address reusing FoiaComponentAddressSchema

`submissionMailingAddress` uses `FoiaComponentAddressSchema` directly (imported, not duplicated). This enables:
- `formatFoiaComponentAddress()` for display in the banner
- Auto-population of `foiaContactAddress` (which is a flat string) using the same formatter
- Consistent address structure across the codebase

### ListItem includes submissionMethod

`OpportunityListItemSchema` gains `submissionMethod: SubmissionMethodDetectedSchema.nullish()` so the badge can render on cards without fetching the full opportunity.

## Alternatives Considered

### A. Extend existing SubmissionMethodSchema in proposal-submission.ts
Add `MAIL`/`POSTAL` to the existing enum. **Rejected** because: semantic mismatch. The existing enum is about the action taken ("we submitted via portal"), not the RFP's instruction ("the RFP requires physical mail"). Mixing them creates confusion when both are present on the same opportunity.

### B. Boolean `isPhysicalSubmission` stored on opportunity
A simple true/false flag. **Rejected** because: loses nuance between PHYSICAL-only, BOTH, and ELECTRONIC. The enum captures the full picture and the boolean is trivially derivable.

### C. Source tracking with conditional write guard
Like `deliveryConstraintSource: 'AI_DETECTED' | 'USER_SET'` with a guard that never overwrites USER_SET. **Rejected** by user decision: adds complexity without proportional value. The toggle is a simple override, and re-scan correction is acceptable behavior.

### D. Free-text address field
A single string field instead of structured address. **Rejected** because: structured address enables FOIA auto-population, future address validation, and consistent display. The existing `FoiaComponentAddressSchema` is already built and tested.

## Consequences

- No migration needed — all new fields are `.nullish()`
- Existing code that reads `OpportunityItem` is unaffected
- The `PATCH /opportunities` endpoint already supports arbitrary field updates, so the toggle works without a new endpoint
- Re-generating the executive brief may overwrite a user's manual toggle (accepted trade-off)
- Address extraction is best-effort — imperfect parsing stored in structured fields may have empty sub-fields
