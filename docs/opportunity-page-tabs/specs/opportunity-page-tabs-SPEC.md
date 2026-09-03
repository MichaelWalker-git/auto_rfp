# Opportunity Page Tabs — Spec

> Derived from `docs/adr/opportunity-tabs/` (ADR 0001, DECISIONS D1–D15, GLOSSARY). Read those for the full rationale; this spec is the buildable synthesis.

## Problem Statement

A user working an opportunity opens its detail page and is dropped into a single long scrolling column that stacks every section: details, solicitation documents, analysis, solution plan, required forms, RFP docs, AI compliance review, submission & compliance, post-award outcome, related opportunities, a Context & Knowledge Base panel, an approval panel, and a floating chat dialog.

Because everything is on one page:

- Sections are easy to miss and there is no persistent sense of "where am I / what is left to do."
- Critical hard requirements — a US-based team is required, submission is physical, notarization is required — are buried inside individual sections and easy to overlook until late.
- A recently added package-preparation progress bar already computes per-step completeness, but it is a separate strip that duplicates the sense of progress the page should convey itself.

## Solution

Replace the long-scroll layout with a **tabbed layout** on the opportunity detail page.

From the user's perspective:

- Opportunity context (title, agency, back button, assignee) stays pinned above the tabs on every tab, so switching tabs never loses the sense of "which opportunity is this."
- A **requirement flag-row** of can't-miss chips (US-based team required, Physical submission, Notary required) sits in that persistent header, always visible, each auto-hiding when it does not apply. Clicking a chip jumps straight to the tab that owns the full detail.
- Each **tab header doubles as a progress indicator** — it shows the tab name, a completeness metric ("X of Y"), a status icon, and a "more details" popover — so the user reads their progress off the tabs themselves. The standalone progress bar is retired.
- Only the tabs relevant to this opportunity appear; irrelevant ones (e.g. Solution plan when the org flag is off, Required forms when there are none, Related opportunities for non-HigherGov opps) are hidden entirely rather than shown greyed-out.
- Tabs are deep-linkable via a `?tab=` URL param, so a user can share or bookmark a specific tab.
- The active tab loads on first open and stays mounted for the rest of the visit, so switching back and forth is instant and in-tab work (scroll position, open editors) is preserved.

No behavior inside any panel changes — this is a layout reorganization that moves existing panels into tabs.

## User Stories

1. As a proposal manager, I want the opportunity detail page organized into tabs, so that I can navigate directly to the section I care about instead of scrolling a long page.
2. As a proposal manager, I want the opportunity title and agency pinned above the tabs, so that I always know which opportunity I am working on regardless of the active tab.
3. As a proposal manager, I want the back-to-opportunities button always visible above the tabs, so that I can leave the page from anywhere without scrolling up.
4. As a proposal manager, I want the assignee selector pinned above the tabs, so that I can reassign the opportunity from any tab.
5. As a proposal manager, I want each tab header to show a completeness metric and status icon, so that I can see at a glance how much of each part of the package is done.
6. As a proposal manager, I want a "more details" popover on each tab header, so that I can understand what a step means and why it is or is not complete without opening the tab.
7. As a proposal manager, I want the tab metrics to keep updating even while I am on a different tab, so that I notice when a long-running job (e.g. RFP-document generation) finishes.
8. As a proposal manager, I want a "US-based team required" chip in the persistent header when the opportunity requires it, so that I never miss that constraint.
9. As a proposal manager, I want a "Physical submission" chip in the persistent header when the opportunity must be submitted physically, so that I plan for a non-electronic submission early.
10. As a proposal manager, I want a "Notary required" chip in the persistent header when notarization is required, so that I arrange notarization in time.
11. As a proposal manager, I want each requirement chip to disappear when it does not apply, so that the header only surfaces constraints that are real for this opportunity.
12. As a proposal manager, I want clicking the "Physical submission" chip to jump to the Compliance details tab, so that I land on the full physical-submission detail.
13. As a proposal manager, I want clicking the "Notary required" chip to jump to the Required forms tab, so that I see the notary trigger list in context.
14. As a proposal manager, I want clicking the "US-based team required" chip to jump to the Details tab, so that I see the full delivery-location context.
15. As an assigned reviewer, I want the approval banner shown above the tabs, so that I can approve or reject the opportunity from any tab.
16. As a user who is not an assigned reviewer, I want the approval banner hidden, so that I am not shown controls I cannot use.
17. As a proposal manager, I want a Details tab combining core details, the Context & Knowledge Base panel, and solicitation documents, so that the foundational inputs live together.
18. As a proposal manager, I want the Details tab to show "X of Y processed" for solicitation documents, so that I know whether my source documents are ready.
19. As a proposal manager, I want an Analysis tab with the executive brief, so that I can review the AI analysis of the opportunity.
20. As a proposal manager, I want the Analysis tab header to show "X of 8 sections", so that I know how complete the brief is.
21. As a proposal manager in an org with Solution Plan enabled, I want a Solution plan tab, so that I can manage the source-of-truth plan.
22. As a proposal manager in an org without Solution Plan enabled, I want the Solution plan tab hidden, so that I am not shown a feature my org does not have.
23. As a proposal manager, I want a Required forms tab when the opportunity has required forms, so that I can fill each form.
24. As a proposal manager, I want the Required forms tab hidden when there are no required forms, so that empty sections do not clutter the tab bar.
25. As a proposal manager, I want the Required forms tab header to show "X of Y filled", so that I know how many forms remain.
26. As a proposal manager, I want an RFP docs tab, so that I can produce and manage the documents the solicitation demands.
27. As a proposal manager, I want the RFP docs tab header to show "X of Y required", so that I know how many required documents are still outstanding.
28. As a proposal manager in an org with Compliance Review enabled, I want a Review tab with the AI Compliance Review panel, so that I can triage findings.
29. As a proposal manager in an org without Compliance Review enabled, I want the Review tab hidden, so that I am not shown a feature my org does not have.
30. As a proposal manager, I want the Review tab header to show open-finding count / Ready / Running, so that I know whether the review is blocking submission.
31. As a proposal manager, I want a Compliance details tab with the compliance report/matrix, physical-submission banner, Submit button, and submission history, so that I can validate compliance and submit.
32. As a proposal manager, I want the Compliance details tab header to show "% pass rate" or Submitted, so that I know my compliance standing at a glance.
33. As a proposal manager, I want an Outcome tab with the post-award summary, debriefing, and FOIA panels, so that I can manage the opportunity after a decision.
34. As a proposal manager, I want the Outcome tab header to show a status label (Awaiting outcome / Won / Lost / No-bid / Withdrawn) rather than a count, so that I read the disposition directly.
35. As a proposal manager working a HigherGov-sourced opportunity with related RFPs, I want a Related opportunities tab, so that I can review related solicitations.
36. As a proposal manager, I want the Related opportunities tab hidden for non-HigherGov opportunities or when there are none, so that the tab only appears when it has content.
37. As a proposal manager, I want the Related opportunities tab header to show an "N related" count, so that I know how many related opportunities exist.
38. As a proposal manager, I want the active tab reflected in the URL, so that I can bookmark or share a link that opens the right tab.
39. As a proposal manager, I want a link to a hidden or gated tab to fall back to the Details tab, so that a stale or invalid link never lands me on a broken/empty tab.
40. As a proposal manager, I want the Details tab to be the default when no tab is specified, so that I start on the foundational view.
41. As a proposal manager, I want tabs to load on first open and stay mounted afterwards, so that returning to a tab is instant and does not re-run its loading state.
42. As a proposal manager, I want my in-tab state (scroll, expanded findings, open inline editors) preserved when I switch away and back, so that I do not lose place mid-task.
43. As a proposal manager on a smaller screen, I want the tab bar to scroll horizontally when tabs overflow, so that I can still reach every tab with its metric and icon intact.
44. As a proposal manager, I want to still use the floating AI assistant from any tab, so that I can ask questions without leaving my current tab.
45. As a proposal manager, I want the progress-bar "Jump to step" action to switch to the owning tab instead of scrolling, so that navigation stays consistent with the tabbed layout.
46. As a proposal manager who edits a form, solution plan, or RFP document on its full-page edit route, I want "back to opportunity" to return me to the tab I came from, so that I resume where I left off.
47. As a proposal manager, I want the US-team badge shown only in the persistent header (not duplicated in the Details body), so that the same fact is not stated twice.
48. As a proposal manager, I want no overall "K of N complete" rollup, so that I read progress per-tab without a redundant aggregate.

## Implementation Decisions

### Modules built / modified

- **`OpportunityView` / `OpportunityContent`** (`apps/web/components/opportunities/OpportunityView.tsx`) — rewritten from a single `space-y-6` column into: a persistent header region, a requirement flag-row, the approval banner, a tab strip, and lazily-mounted tab bodies. The existing panel components are moved into tab bodies unchanged. `OpportunityProvider` wrapper and the smart-polling hook are retained.
- **`opportunity-progress` engine** (`apps/web/features/opportunity-progress`) — repurposed to drive tab headers instead of the standalone bar. `useOpportunityProgress()` continues to compute per-step `{ status, detailText, reason, navigation, visible, domainData }`. The `OpportunityProgressBar` host and `ProgressBarUI` become the tab-strip renderer (or are superseded by a tab-strip component that reuses `StepDetailsContent` for the popover). Existing components/tests are refactored, not deleted.
- **Two new evaluators** added to the progress engine:
  - **Outcome status** — reads `opportunity.status`; terminal states `WON | LOST | NO_BID | WITHDRAWN` map to their label, everything else to "Awaiting outcome". No count. Distinct from the 7 completeness steps (it is a status label, not "X of Y").
  - **Related count** — informational "N related" count, not a completeness status.
- **`navigateToStep`** (`opportunity-progress/components/OpportunityProgressBar.tsx`) — repointed from anchor-scroll (`scrollIntoView` on a section id) to tab selection (set the `?tab=` state). The `NavigationDescriptor` union already anticipates non-anchor navigation (`{ kind: 'route' }`); a tab-select descriptor is the new path.
- **Sibling full-page edit routes** (`forms/[documentId]`, `solution-plan/edit`, `rfp-documents/[documentId]/edit`, `submit`) — unchanged internally; their "back to opportunity" links append `?tab=<originating tab>`.
- **`buildFindingHref` / compliance-review navigation** — findings already route to full-page edit routes (`/rfp-documents/{id}/edit`, `/forms/{id}`); these are covered by the edit-route round-trip (`?tab=` on the back link). Verify no compliance navigation relies on scrolling to the old `ai-compliance-review`/`submission-compliance` section anchors; repoint any that do to tab selection.

### Tab set, order, content, header metric, gating

| # | Tab | Content | Header metric | Progress step | Shown when |
|---|-----|---------|---------------|---------------|------------|
| 1 | Details & solicitation documents | Core details + Context & KB panel + solicitation documents | "X of Y processed" | `solicitations` | always |
| 2 | Analysis | Executive brief / opportunity analysis | "X of 8 sections" | `analysis` | always |
| 3 | Solution plan | Solution plan panel | (solution-plan) | `solution-plan` | `enableSolutionPlan` |
| 4 | Required forms | Required forms list | "X of Y filled" | `required-forms` | `requiredForms.length > 0` |
| 5 | RFP docs | RFP documents | "X of Y required" | `rfp-documents` | always |
| 6 | Review | AI Compliance Review panel | "N open findings" / Ready / Running | `ai-review` | `enableComplianceReview` |
| 7 | Compliance details | Report/matrix + physical-submission banner + Submit + submission history | "% pass rate" / Submitted | `submission` | always |
| 8 | Outcome | Post-award summary + Debriefing + FOIA | Status label (Awaiting / Won / Lost / No-bid / Withdrawn) | new evaluator | always |
| 9 | Related opportunities | Related RFPs section | "N related" (informational) | new (count only) | `isHigherGov` (`!!higherGovOppKey`) AND non-empty |

Always shown: Details, Analysis, RFP docs, Compliance details, Outcome. Conditional (hidden entirely when the condition is false): Solution plan, Required forms, Review, Related opportunities.

### Persistent chrome (visible on every tab, above the tab strip)

- Opportunity title, agency, back button, assignee selector.
- Requirement flag-row of chips, each auto-hiding when N/A:
  - **US-based team required** — `opportunity.deliveryLocationConstraint === 'US_ONLY'` (reuse existing badge; removed from the Details body). Chip → Details tab.
  - **Physical submission** — `PhysicalSubmissionChip` (`opportunity.submissionMethod` is `PHYSICAL`/`BOTH`). Chip → Compliance details tab.
  - **Notary required** — `OpportunityNotaryChip` (`opportunity.notarySummary`). Chip → Required forms tab.
  - Chips are additive: the fuller detail stays in its owning tab (physical-submission banner in Compliance details; `NotaryTriggerList` in Required forms).
- **Approval banner** (`OpportunityApprovalPanel`) — renders only for an assigned reviewer (the panel already self-gates).
- **Floating chat dialog** — unchanged; stays floating/always-available.

### URL state (nuqs)

- Active tab in a `?tab=` query param via `useQueryState('tab', parseAsStringLiteral(TAB_VALUES).withDefault(<details>))` — the repo pattern from `PromptManager`.
- `TAB_VALUES` is a `readonly` string-literal tuple of the stable tab keys.
- Default = Details. A `?tab=` pointing at a hidden/gated tab falls back to Details (validate the parsed value against the *visible* tab set, not just the literal union).

### Mounting — lazy keep-alive

- A tab body mounts on first open and then stays mounted (hidden via CSS) for the rest of the visit — not Radix's default unmount, and not `forceMount` of everything.
- Only the initial (Details) body renders on first paint; heavy panels mount on demand.
- Header metrics are computed by `useOpportunityProgress()` in the **always-mounted tab strip**, so they update regardless of which tab is active.

### Tab bar

- Single row; horizontal scroll (edge fade / arrows) when tabs overflow. Metric + status icon stay attached to each tab.
- Every tab header has the "more details" popover: the 7 step-backed tabs reuse `StepDetailsContent`; Outcome shows a small status summary; Related shows a short count / last-updated summary.

### Scope

- Layout reorg only — move existing panels into tabs unchanged; no behavior change inside panels. Trim only section titles/dividers now redundant with the tab label.
- Direct replacement in one PR, no feature flag.
- No aggregate "K of N complete" rollup.

### Data prerequisites (verify during implementation)

- Confirm the detail-page opportunity object carries `submissionMethod` and `notarySummary` (both present on the list-card `item`); wire up if the detail fetch omits them.
- Confirm the nuqs provider covers this route (it does, via `providers.tsx`).

## Testing Decisions

**What makes a good test here:** assert externally-observable behavior — which tabs render, which are hidden, which chip shows, where a click lands, what the URL param does — never internal state shape, CSS class names, or which memoized value a hook returned. Drive the component the way a user would (render, query by role/text, click), and mock only the seams (data hooks, context, child panels, nuqs).

### Primary seam — `OpportunityView` component render

Render `OpportunityView` / `OpportunityContent` with mocked seams, following the established `components/organizations/__tests__/PromptManager.test.tsx` pattern:

- **Mock `nuqs`** with plain React state seeded from a per-test initial `?tab=` value (PromptManager already does exactly this — nuqs is ESM-only and not transformed by Jest).
- **Mock `useOpportunityProgress`** to return a controlled `steps` array (status/detailText/visible per step).
- **Mock `useCurrentOrganization`** to toggle `enableSolutionPlan` / `enableComplianceReview`.
- **Mock `useOpportunityContext`** / opportunity data to control `deliveryLocationConstraint`, `submissionMethod`, `notarySummary`, `higherGovOppKey`, `status`, and the required-forms count.
- **Mock the child panels** to lightweight stubs (they have their own tests) so the test isolates the tab shell.

Behaviors to cover:
- Default tab is Details when no `?tab=`.
- `?tab=<key>` opens that tab; `?tab=<hidden/gated>` falls back to Details.
- Gating: Solution plan / Review appear only with their org flags; Required forms appears only when forms exist; Related opportunities appears only for HigherGov + non-empty. Always-on tabs always render.
- Requirement chips appear only when applicable and are hidden otherwise; the US-team badge does not also appear in the Details body.
- Clicking a chip selects its owning tab (Physical → Compliance details, Notary → Required forms, US-team → Details).
- Approval banner presence follows the assigned-reviewer condition.
- Lazy keep-alive: a not-yet-opened tab body is not mounted on first paint; once opened it remains in the DOM after switching away.
- Tab headers render the metric text supplied by the mocked progress steps.

### Secondary seams — pure units

- **New evaluators** — Outcome status (each terminal `opportunity.status` → its label; non-terminal → "Awaiting outcome") and Related count, unit-tested in isolation. Prior art: `features/opportunity-progress/lib/__tests__/rules.test.ts` and `status-display.test.ts`.
- **`navigateToStep`** — assert it now selects the owning tab instead of scrolling. Prior art: the existing `features/opportunity-progress/components/__tests__/navigateToStep.test.ts` (refactor rather than rewrite).
- **`useOpportunityProgress`** — existing `hooks/__tests__/useOpportunityProgress.test.tsx` extended for the two new evaluators.

### Refactor (not rewrite) existing progress tests

`ProgressBarUI.test.tsx`, `StepDetailsContent.test.tsx`, and `navigateToStep.test.ts` should be updated to match the tab-strip role of these components, keeping the behavioral assertions that still hold.

## Out of Scope

- Any change to the internal behavior of the moved panels (solicitation documents, brief, solution plan, required forms, RFP docs, compliance review, submission/compliance, outcome, debriefing, FOIA, context panel, chat dialog).
- Changing the internals of the full-page edit routes — only their "back to opportunity" links gain a `?tab=` param.
- A feature flag or phased rollout — this is a direct one-PR replacement.
- An aggregate progress rollup / overall completeness indicator.
- New backend, schema, API, or CDK changes. If the detail-page opportunity object is missing `submissionMethod` / `notarySummary`, wiring the existing fields through is in scope; adding new fields is not.
- A Playwright e2e for the tab shell (the component render seam covers the behavior; e2e was explicitly declined).
- Redesigning the progress engine's semantics for the existing 7 steps.

## Further Notes

- **Glossary** (use consistently): *opportunity detail page*, *opportunity-progress engine*, *progress step* (the 7 tracked units — not 1:1 with tabs), *tab*, *persistent header*, *requirement flag chips*, *approval banner*, *isHigherGov*.
- **Progress steps vs tabs are not 1:1** — Details reuses the `solicitations` step metric; Outcome and Related are new evaluators without a completeness step.
- **Risks called out in the ADR:** header metrics require the progress engine to fetch all step data eagerly (unchanged from today, but now the sole driver); `navigateToStep` and any compliance navigation that relied on section anchors must be repointed; `StepDetailsContent` and the progress-bar components/tests are refactored rather than deleted.
- **Deep-link safety:** no external/notification deep-links currently target the old section anchors (`solicitation-documents`, `executive-brief`, `submission-compliance`, etc.); confirm this holds before removing the anchors.
