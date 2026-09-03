# Opportunity Tabs — Decisions Log

Running record of decisions from the grilling session. Discrete ADRs are distilled from this once the design settles.

## D1 — Retire the progress bar; reuse its engine for tab headers
The standalone package-preparation progress bar is removed. Each tab header becomes the progress indicator (name + "X of Y" + status icon + details popover), visually echoing the current progress-bar steps. The existing `opportunity-progress` engine is reused and extended to cover tabs it does not yet track.

## D2 — Persistent header vs tab content
Always-visible chrome above the tabs: opportunity **title, agency, back button, assignee selector**. All other opportunity details (dates, badges, etc.) move into the first tab (Details).

## D3 — Placement of non-tab elements
- **Reviewer approval panel** → banner above the tabs (visible on every tab, only to an assigned reviewer).
- **Context & Knowledge Base panel** → folded into the Details tab.
- **Floating chat dialog** → stays floating/always-available (assumed, pending confirmation).

## D4 — Tab set, order, content, and header metric

| # | Tab | Content | Header metric | Underlying progress step |
|---|-----|---------|---------------|--------------------------|
| 1 | Details & solicitation documents | Core details + Context & KB panel + solicitation documents | "X of Y processed" | `solicitations` |
| 2 | Analysis | Executive brief / opportunity analysis | "X of 8 sections" | `analysis` |
| 3 | Solution plan | Solution plan panel | (solution-plan step) | `solution-plan` |
| 4 | Required forms | Required forms list | "X of Y filled" | `required-forms` |
| 5 | RFP docs | RFP documents | "X of Y required/ready" | `rfp-documents` |
| 6 | Review | AI Compliance Review panel | "N open findings" / Ready / Running | `ai-review` |
| 7 | Compliance details | Submission & Compliance section (report/matrix + physical-submission banner + Submit button + submission history) | "% pass rate" / Submitted | `submission` |
| 8 | Outcome | Post-award summary + Debriefing + FOIA | Status label: Awaiting outcome / Won / Lost (no count) | (new evaluator) |
| 9 | Related opportunities | Related RFPs section | Count: "N related" (informational, not completeness) | (new, count only) |

Metric = name + value + status icon + "more details" popover, echoing current progress-bar steps.

## D5 — Metrics for tabs with no existing progress step
- Details & solicitation docs → reuse `solicitations` metric ("X of Y processed").
- Outcome → status label (Awaiting outcome / Won / Lost / No-bid / Withdrawn), no count. New evaluator reads `opportunity.status` (terminal states WON|LOST|NO_BID|WITHDRAWN; else "Awaiting outcome").
- Related opportunities → informational count ("N related"), not a completeness status.

## D6 — Conditional tab visibility
Conditional tabs are **hidden entirely** when their condition isn't met (not disabled/greyed):
- Solution plan → org flag `enableSolutionPlan`
- Required forms → only if forms exist (`requiredForms.length > 0`)
- Review → org flag `enableComplianceReview`
- Related opportunities → `isHigherGov` (`!!higherGovOppKey`) AND non-empty
Always shown: Details, Analysis, RFP docs, Compliance details, Outcome.

## D7 — Tab URL state
Active tab in a `?tab=` query param via nuqs `parseAsStringLiteral` (repo pattern, cf. PromptManager). Default = Details. A URL pointing at a hidden/gated tab falls back to Details.

## D8 — Tab content mounting: lazy keep-alive
A tab body mounts on first open and stays mounted (hidden via CSS) for the rest of the visit. Light initial load (only Details renders), no re-mount jank, in-tab state preserved. Header metrics are computed by `useOpportunityProgress()` in the always-mounted tab strip, so they update regardless of which tab is open (e.g. RFP-doc generation finishing while on another tab).

## D9 — Tab overflow: horizontal scroll
Single-row tab bar; horizontal scroll (with edge fade/arrows) when tabs overflow. Metric + icon stay attached to each tab.

## D10 — Header "more details" popover on every tab
Every tab header has the info/details popover. The 7 step-backed tabs reuse existing `StepDetailsContent`; Outcome shows a small status summary; Related shows a short count/last-updated summary.

## D11 — Scope: layout reorg only
Move existing panels into tabs unchanged. Retire the progress bar, repurpose its engine for tab headers, add 2 small evaluators (Outcome status, Related count). Only trim section titles/dividers now redundant with the tab label. No behavior change inside panels.

## D12 — Rollout: direct replacement
Replace the long-scroll layout with tabs in one PR, no feature flag.

## D13 — No aggregate rollup
Drop the overall "K of N complete" indicator; per-tab metrics convey progress.

## D14 (default, override welcome) — Sibling edit-route round-trip
Full-page edit routes (`forms/[documentId]`, `solution-plan/edit`, `rfp-documents/[documentId]/edit`, `submit`) are unchanged. Their "back to opportunity" links append `?tab=<originating tab>` so returning lands on the right tab. `navigateToStep` (progress engine) and `navigateToFinding` (compliance-review) are repointed from anchor-scroll to tab selection.

## D15 — Requirement flags in the persistent header
Surface can't-miss requirement chips in the persistent header, always visible across tabs (each auto-hides when not applicable):
- **US-based team required** — `opportunity.deliveryLocationConstraint === 'US_ONLY'` (reuse existing badge; removed from the Details body to avoid duplication).
- **Physical submission** — `PhysicalSubmissionChip` (`opportunity.submissionMethod` PHYSICAL/BOTH).
- **Notary required** — `OpportunityNotaryChip` (`notarySummary`).

Chips are **additive**: the fuller detail stays in its owning tab (physical-submission banner in Compliance details, `NotaryTriggerList` in Required forms). Clicking a chip **jumps to the owning tab** (Physical → Compliance details, Notary → Required forms, US-team → Details).

Impl note: verify the detail-page opportunity object carries `submissionMethod` and `notarySummary` (both present on the list-card `item`); wire up if missing.


