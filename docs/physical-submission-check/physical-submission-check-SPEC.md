# Physical Submission Check — Spec

## Problem Statement

Government RFPs sometimes require physical (mail) delivery of proposals, but this requirement is buried deep in solicitation documents — typically Section L (Instructions to Offerors) or Section M (Evaluation Criteria). The team has encountered situations where an RFP was complete and ready for submission close to the deadline, only to discover it required physical mail delivery. The result: missed submissions because mail transit time was unaccounted for.

The root cause is that physical submission requirements aren't surfaced early enough in the opportunity lifecycle. By the time someone notices, too much work has been done under the assumption of electronic submission, and there isn't enough time to mail the package.

## Solution

Automatically detect physical submission requirements at two points in the opportunity lifecycle — at SAM.gov import (early, lightweight) and during executive brief generation (thorough, authoritative) — and surface the finding prominently in both the AutoRFP dashboard and the Linear project board.

When physical submission is detected, the system:
- Marks the opportunity with a submission method (ELECTRONIC, PHYSICAL, BOTH, or UNKNOWN) and stores the mailing address and the solicitation excerpt that triggered detection
- Shows a warning banner on the opportunity detail page with the mailing address and a computed internal mail deadline (response deadline minus 5 business days)
- Shows a badge on opportunity cards in list and board views
- Applies the existing "physical submission" label to the opportunity's Linear ticket
- Auto-populates the FOIA contact address if it's currently empty

The user can manually toggle the submission method at any time, which also syncs the label to Linear.

## User Stories

1. As a proposal manager, I want the system to automatically detect physical submission requirements when an opportunity is imported from SAM.gov, so that I know about mailing constraints before investing time in the opportunity.

2. As a proposal manager, I want the system to perform a thorough scan of the full solicitation text during executive brief generation, so that physical submission requirements buried in Section L/M are reliably caught even when the SAM.gov description was too brief.

3. As a proposal manager, I want to see a warning banner on the opportunity detail page when physical submission is required, so that I'm immediately aware of the mailing constraint when reviewing the opportunity.

4. As a proposal manager, I want the warning banner to show the extracted mailing address, so that I know where to send the proposal without searching through the solicitation documents.

5. As a proposal manager, I want the warning banner to show a computed internal mail deadline (response deadline minus 5 business days), so that I can plan around the mail transit time.

6. As a proposal manager, I want to see a physical submission badge on opportunity cards in list and board views, so that I can identify physical-submission opportunities at a glance without opening each one.

7. As a proposal manager, I want the "physical submission" label to be automatically applied to the Linear ticket when the system detects physical submission, so that the project board reflects the constraint without manual labeling.

8. As a proposal manager, I want to manually toggle the submission method on an opportunity, so that I can correct the system's detection if it was wrong or if circumstances change.

9. As a proposal manager, I want my manual toggle to sync the "physical submission" label to Linear (add on toggle ON, remove on toggle OFF), so that the board stays consistent with my override.

10. As a proposal manager, I want the FOIA contact address to be auto-populated from the extracted mailing address when it's currently empty, so that I don't have to enter the same address twice.

11. As a proposal manager, I want the FOIA contact address to NOT be overwritten if I've already entered one, so that my manual data entry is preserved.

12. As a proposal manager, I want to see the solicitation excerpt that triggered the detection (the rationale), so that I can verify the system's finding against the source text.

13. As a proposal manager, I want the thorough scan (during brief generation) to overwrite the lightweight SAM.gov import result, so that the most reliable detection is always authoritative.

14. As a proposal manager, I want re-running the executive brief to re-scan for physical submission requirements, so that existing opportunities can be retroactively checked.

15. As a proposal manager, I want the mail deadline to be computed at render time (not stored), so that it automatically adjusts if the response deadline changes.

16. As a proposal manager, I want physical submission detection to never block or fail the executive brief generation, so that a detection error doesn't prevent me from getting my brief.

17. As a proposal manager, I want Linear label sync failures to be silently logged (not user-facing errors), so that a Linear API outage doesn't disrupt my workflow.

18. As a proposal manager, I want the physical submission badge to appear on pipeline board cards (the kanban view), so that I can see the constraint while managing opportunities across stages.

19. As a proposal manager, I want opportunities with submission method BOTH (accepts electronic and physical) to be treated as physical-submission opportunities for warning purposes, so that I still account for mail time even when electronic is also an option.

20. As a proposal manager, I want non-Linear opportunities (those not synced from Linear) to skip the label sync silently, so that the detection works regardless of where the opportunity originated.

## Implementation Decisions

### Detection Strategy (ADR-001)

- Two-stage pipeline: lightweight scan at SAM.gov import, thorough regex + AI fallback during executive brief generation.
- The thorough scan follows the identical pattern of `scanDeliveryLocationConstraint()` — a deterministic regex scanner that runs over the full raw solicitation text before truncation.
- Detection priority: regex scan (deterministic) > LLM extraction from brief prompt (fallback) > SAM.gov import scan (supplementary).
- The thorough scan result overwrites the import result when it runs.
- Regex categories: PHYSICAL indicators (mail/deliver language, carrier names, hard copy language), ELECTRONIC indicators (electronic-only language), BOTH (indicators from both categories present).
- Address extraction: after detecting PHYSICAL or BOTH, the scanner extracts a US mailing address from the ~500 characters surrounding the match, returning structured fields.

### Data Model (ADR-002)

- New enum `SubmissionMethodDetectedSchema` with values `ELECTRONIC`, `PHYSICAL`, `BOTH`, `UNKNOWN` — deliberately separate from the existing `SubmissionMethodSchema` in `proposal-submission.ts` which describes how a proposal was actually submitted, not what the RFP requires.
- Three new `.nullish()` fields on `OpportunityItemSchema`: `submissionMethod`, `submissionMailingAddress` (reusing `FoiaComponentAddressSchema`), and `submissionMethodRationale`.
- No source tracking (unlike `deliveryConstraintSource`). Re-scanning overwrites manual toggles. Accepted trade-off: physical submission is a factual property of the solicitation.
- `OpportunityListItemSchema` gains `submissionMethod` so badges render on cards without fetching the full opportunity.
- `isPhysicalSubmission(method)` — pure function in `packages/core` returning true for PHYSICAL or BOTH. Used by backend and frontend.
- `computeMailDeadline(responseDeadlineIso, transitDays)` — pure function in `packages/core`. Not persisted. Default transit: 5 business days (configurable constant `DEFAULT_MAIL_TRANSIT_BUSINESS_DAYS`).

### Linear Sync (ADR-003)

- Immediate app-to-Linear sync on detection. No batching.
- New `addLinearLabelByIdentifier()` function following the existing `swapLinearGateLabelByIdentifier()` identifier-resolution pattern — but additive (never removes other labels). Corresponding `removeLinearLabelByIdentifier()` for the toggle-OFF case.
- Orchestrator helper `syncPhysicalSubmissionLabel()` checks if the opportunity is Linear-synced (`oppId.startsWith('linear-')`) before calling the label API.
- Called from: exec-brief-worker after detection, and opportunity update handler when `submissionMethod` is toggled.
- Fire-and-forget with try/catch — never fails the brief or the update.

### Frontend

- Warning banner on opportunity detail page — visible when `isPhysicalSubmission(submissionMethod)` is true. Shows: submission method, mailing address (formatted via `formatFoiaComponentAddress()`), computed mail deadline, and the rationale excerpt. Includes a toggle to override.
- Badge on opportunity cards — follows the `OpportunityNotaryChip` pattern. Appears on `opportunity-item-card` (list view) and `PipelineCard` (board view).
- The toggle patches `submissionMethod` via the existing `PATCH /opportunities` endpoint — no new API endpoint needed.

### Integration Points

- Schema changes go in `packages/core/src/schemas/opportunity.ts` (after the `deliveryConstraintRationale` field, ~line 392).
- The new scanner goes in `apps/functions/src/helpers/executive-opportunity-brief.ts` alongside the existing `scanDeliveryLocationConstraint()`.
- Brief worker integration goes in `exec-brief-worker.ts` `runSummary()`, right after the existing delivery constraint scan block.
- SAM.gov import integration goes in `import-solicitation.ts`.
- The FOIA auto-fill happens in the brief worker: after detecting physical submission with an address, check if `foiaContactAddress` is empty and populate it using `formatFoiaComponentAddress()`.

## Testing Decisions

### What makes a good test

Tests exercise external behavior through the module's public API. They verify what a function returns or what side effects it produces given specific inputs — not how the function achieves the result internally. A test should survive internal refactors without changing.

### Testing seams and modules

1. **`scanPhysicalSubmission()` — pure function scanner (primary seam)**
   - Input: raw solicitation text string. Output: structured detection result or null.
   - Test categories: PHYSICAL indicators (each regex category), ELECTRONIC indicators, BOTH detection, UNKNOWN (no indicators), address extraction from surrounding text, edge cases (empty text, mixed signals, case insensitivity).
   - Prior art: `scanDeliveryLocationConstraint` tests in `apps/functions/src/helpers/executive-opportunity-brief-sanitize.test.ts`.

2. **`isPhysicalSubmission()` and `computeMailDeadline()` — core pure helpers**
   - `isPhysicalSubmission`: returns true for PHYSICAL and BOTH, false for ELECTRONIC/UNKNOWN/null/undefined.
   - `computeMailDeadline`: date math with business-day subtraction (skips weekends). Test with weekday deadlines, Monday deadlines (crosses weekend), edge dates.
   - Prior art: schema tests in `packages/core` (vitest).

3. **`exec-brief-worker` integration**
   - Verify the scanner is called with the raw text, results flow to `updateOpportunity()`, FOIA auto-fill occurs when address is present and FOIA is empty, FOIA is NOT overwritten when already populated, detection failure doesn't fail the brief.
   - Prior art: existing `apps/functions/src/handlers/brief/exec-brief-worker.test.ts`.

4. **`import-solicitation` integration**
   - Verify lightweight scan runs on import, results are stored on the opportunity, no-op when description has no indicators.
   - Prior art: existing `apps/functions/src/handlers/search-opportunity/import-solicitation.test.ts`.

5. **`addLinearLabelByIdentifier()` / `removeLinearLabelByIdentifier()`**
   - Verify label is added to the issue's existing label set (not replacing), removal only removes the target label, API failure is caught and doesn't throw.
   - Prior art: `swapLinearGateLabelByIdentifier()` call patterns in `apps/functions/src/helpers/linear.ts`. Note: this file currently has no tests — a new co-located test file is needed.

6. **Physical submission badge and banner components**
   - Badge: renders when `submissionMethod` is PHYSICAL or BOTH, hidden otherwise.
   - Banner: renders address, mail deadline, rationale, toggle.
   - Prior art: `apps/web/components/opportunities/OpportunityNotaryChip.test.tsx`, `apps/web/features/rfp-tracking/components/PipelineCard.test.tsx`.

## Out of Scope

- **Bidirectional Linear sync** — labels added directly in Linear are not synced back to the app. The app's `submissionMethod` field is the source of truth.
- **Retroactive bulk scan** — existing opportunities are only scanned when their executive brief is (re-)generated. No batch job to scan all historical opportunities.
- **Configurable transit days per opportunity** — the 5-business-day default is a global constant. Per-opportunity override is not included.
- **Address validation** — the extracted mailing address is best-effort. No USPS validation or geocoding.
- **Blocking workflow** — physical submission is a warning, not a gate. It doesn't prevent any action on the opportunity.
- **Notification system** — no email, Slack, or in-app notification when physical submission is detected. The banner, badge, and Linear label are the notification surfaces.
- **Non-US address formats** — address extraction targets US mailing address patterns only (matching `FoiaComponentAddressSchema`).

## Further Notes

- The `SubmissionMethodDetectedSchema` enum name includes "Detected" to distinguish it from `SubmissionMethodSchema` in `proposal-submission.ts`. The former is "what the RFP requires" (detection output); the latter is "how we submitted" (user action).
- All three new fields are `.nullish()`, so no data migration is needed. Existing opportunity records read cleanly.
- The existing `PATCH /opportunities` endpoint already supports arbitrary field updates, so the manual toggle works without a new endpoint.
- The 15-minute Linear sync (`sync-linear-pipeline.ts`) already preserves non-gate labels, so the "physical submission" label won't be accidentally removed by the sync cycle.
- The `computeMailDeadline()` function should handle the edge case where `responseDeadlineIso` is null or in the past — return null in those cases rather than a nonsensical date.
