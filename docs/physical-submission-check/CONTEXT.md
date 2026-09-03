# Physical Submission Check — Design Context

## Problem

Government RFPs sometimes require physical (mail) delivery of proposals. The team has encountered situations where an RFP was complete and ready for submission close to the deadline, only to discover it required physical mail delivery. This leads to missed submissions because mail transit time was unaccounted for.

The root cause: physical submission requirements are buried in solicitation documents (often Section L/M) and aren't surfaced early enough in the opportunity lifecycle.

## Goal

Detect physical submission requirements early — ideally at import time or during initial analysis — so the team can account for mail delivery time before too much work has been done.

## Solution Overview

Two-stage detection pipeline that mirrors the existing `deliveryLocationConstraint` pattern:

1. **Lightweight detection at SAM.gov import** — scan structured metadata and description text for physical submission indicators. Provides early signal before any documents are uploaded.

2. **Thorough detection during executive brief generation** — deterministic regex scan over full solicitation text (before truncation), with AI extraction as fallback. This is the same pattern used for delivery location constraint detection.

When physical submission is detected:
- Store structured fields on the opportunity (`submissionMethod`, `submissionMailingAddress`, `submissionMethodRationale`)
- Show warning banner on opportunity detail page with mailing address and computed mail deadline
- Show badge on opportunity cards in list/board views
- Apply "physical submission" label to the Linear ticket (label already exists)
- Auto-populate FOIA contact address if empty

## Design Decisions Summary

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Detection timing | SAM.gov import + exec brief | Two chances to catch it; lightweight first, thorough second |
| 2 | Severity | Warning banner + badge, no blocking | Team needs visibility, not a gate — they manage their own timelines |
| 3 | Detection method | Regex-first + AI fallback | Follows `scanDeliveryLocationConstraint` pattern; regex is deterministic and reliable for explicit language |
| 4 | Data model | New fields on `OpportunityItemSchema` | Separate from `SubmissionMethodSchema` in `proposal-submission.ts` which describes HOW you submitted, not what the RFP REQUIRES |
| 5 | Address format | Structured, reusing `FoiaComponentAddressSchema` | Enables FOIA address auto-population and structured display |
| 6 | FOIA auto-fill | Auto-populate if empty | Only fills when `foiaContactAddress` is null/empty — never overwrites user data |
| 7 | Linear sync | Immediate, app-to-Linear only | Label is applied on detection; Linear-side changes don't sync back |
| 8 | Override | Simple toggle | No source tracking (unlike `deliveryConstraintSource`); toggle just patches `submissionMethod` |
| 9 | Mail timeline | Computed deadline (due date - 5 business days) | Pure function in `packages/core`; not persisted, calculated at render time |
| 10 | Brief output | Requirements section | Submission method info appears in the structured requirements extraction |

## Integration Points

### Existing patterns this feature follows

| Pattern | Source file | How we reuse it |
|---------|------------|----------------|
| Deterministic regex scan | `executive-opportunity-brief.ts` → `scanDeliveryLocationConstraint()` | New `scanPhysicalSubmission()` using identical structure |
| Opportunity field persistence | `exec-brief-worker.ts` lines 282-312 | Same try/catch + conditional `updateOpportunity()` block |
| Badge on opportunity cards | `OpportunityNotaryChip.tsx` | Same `Badge` component, sizing, and conditional rendering |
| Linear label management | `linear.ts` → `swapLinearGateLabelByIdentifier()` | New `addLinearLabelByIdentifier()` (add-only, no removal) |
| Structured address | `foia-component.ts` → `FoiaComponentAddressSchema` | Reuse directly for `submissionMailingAddress` field |

### Codebase touchpoints

- **Schema**: `packages/core/src/schemas/opportunity.ts` — new fields
- **Detection**: `apps/functions/src/helpers/executive-opportunity-brief.ts` — new scan function
- **Brief worker**: `apps/functions/src/handlers/brief/exec-brief-worker.ts` — invoke scan, persist results
- **SAM.gov import**: `apps/functions/src/handlers/search-opportunity/import-solicitation.ts` — lightweight check
- **Linear**: `apps/functions/src/helpers/linear.ts` — new additive label function
- **Frontend detail**: `apps/web/components/opportunities/OpportunityView.tsx` — banner
- **Frontend cards**: `apps/web/components/opportunities/opportunity-item-card.tsx` — badge
- **Frontend board**: `apps/web/features/rfp-tracking/components/PipelineCard.tsx` — badge

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Regex misses non-standard physical submission language | AI extraction in the brief prompt serves as fallback; user can manually toggle |
| Address extraction is imperfect | Structured fields are best-effort; user can edit the opportunity directly |
| Linear API call fails during brief generation | Fire-and-forget with try/catch; never fails the brief over a label |
| Existing opportunities don't get retroactively scanned | Re-running the exec brief triggers the scan; manual toggle always available |
| SAM.gov description text is too short for reliable detection | Lightweight check is supplementary; thorough check during brief is the primary gate |
