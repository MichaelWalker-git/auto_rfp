# 07 — Frontend: badge on cards + warning banner on detail page

**What to build:** Surface physical submission detection in the UI at two levels — a chip on every opportunity card (list and board views) so the constraint is visible while scanning the pipeline, and a full warning banner on the detail page showing the mailing address, computed mail deadline, rationale, and a toggle to override the detected value.

**Blocked by:** 01 — Core schemas and pure helpers

**Status:** ready-for-agent

## Badge (chip on cards)

- [ ] Create `PhysicalSubmissionChip` component following the `OpportunityNotaryChip` pattern — a small `Badge` that renders only when `isPhysicalSubmission(submissionMethod)` is true, invisible otherwise.
- [ ] Add `PhysicalSubmissionChip` to `opportunity-item-card.tsx` (list view) in the same chip row as `OpportunityNotaryChip`.
- [ ] Add `PhysicalSubmissionChip` to `apps/web/features/rfp-tracking/components/PipelineCard.tsx` (board view).
- [ ] Component tests: renders the badge when `submissionMethod` is `PHYSICAL`, renders when `BOTH`, does not render when `ELECTRONIC`, does not render when `null`.

## Warning banner (detail page)

- [ ] Create `PhysicalSubmissionBanner` component rendered inside `OpportunityView.tsx` when `isPhysicalSubmission(opportunity.submissionMethod)` is true.
- [ ] Banner displays: the submission method value, the formatted mailing address (via `formatFoiaComponentAddress(submissionMailingAddress)`, gracefully absent when address is null), the computed internal mail deadline (via `computeMailDeadline(responseDeadline, DEFAULT_MAIL_TRANSIT_BUSINESS_DAYS)`, hidden when null), and the `submissionMethodRationale` excerpt.
- [ ] Banner includes a toggle (Shadcn UI `Switch` or `Button`) that PATCHes `submissionMethod` via the existing `PATCH /opportunities` endpoint. Toggling to a non-physical value hides the banner; toggling back shows it.
- [ ] Use skeleton state while the opportunity is loading — no spinner or "Loading..." text.
- [ ] Component tests: banner renders with address, deadline, and rationale when all fields are present; banner renders gracefully when `submissionMailingAddress` is null; deadline is hidden when `responseDeadline` is null; toggle calls the PATCH mutation with the correct payload; banner is absent when `submissionMethod` is `ELECTRONIC` or null.

## Shared

- [ ] Export `PhysicalSubmissionChip` and `PhysicalSubmissionBanner` through the appropriate barrel exports so pages never import from internal paths.
