# ADR 0001 — Convert the opportunity detail page to a tabbed layout

- **Status:** Accepted
- **Date:** 2026-09-02
- **Deciders:** Kateryna (product/eng), grilling session
- **Supersedes:** the single long-scroll opportunity detail layout (`OpportunityView` → `OpportunityContent`)
- **Related:** the package-preparation progress bar (`features/opportunity-progress`), which this retires and repurposes. See `DECISIONS.md` (D1–D15) and `GLOSSARY.md` in this folder.

## Context

The opportunity detail page (`apps/web/app/organizations/[orgId]/projects/[projectId]/opportunities/[oppId]/page.tsx` → `OpportunityView`) renders every section in a single long scrolling column: details, solicitation documents, analysis, solution plan, required forms, RFP docs, AI compliance review, submission & compliance, post-award outcome, related opportunities, plus a Context & KB panel, an approval panel, and a floating chat dialog.

The page is long, sections are easy to miss, and there is no persistent sense of "where am I / what's left." A recently added package-preparation progress bar (`features/opportunity-progress`) already computes per-step completeness ("X of Y") + status + a details popover for 7 steps (`solicitations`, `analysis`, `solution-plan`, `required-forms`, `rfp-documents`, `ai-review`, `submission`), and its visual language is close to what we want per-tab.

Critical hard requirements (US-based-team-required, physical submission, notary required) are currently buried inside individual sections and are easy to overlook.

## Decision

Replace the long-scroll layout with a **tabbed layout**, reusing the progress engine to drive tab headers, and surface hard-requirement flags in a persistent header.

### Layout

- **Persistent chrome above the tabs (visible on every tab):**
  - Opportunity title, agency, back button, assignee selector.
  - **Requirement flag-row** — `US-based team required` (`deliveryLocationConstraint === 'US_ONLY'`), `Physical submission` (`PhysicalSubmissionChip`), `Notary required` (`OpportunityNotaryChip`). Each auto-hides when N/A; clicking a chip jumps to its owning tab. The full detail stays in-tab; the US-team badge is removed from the Details body to avoid duplication.
  - **Approval banner** (`OpportunityApprovalPanel`) — shown to an assigned reviewer only.
  - **Floating chat dialog** — unchanged (stays floating/always-available).

- **Tab bar** — retires the standalone progress bar. Each tab header shows name + completeness metric + status icon + a "more details" popover, echoing the progress-bar steps. Driven by `useOpportunityProgress()`, which runs in the always-mounted tab strip so header metrics update regardless of the active tab.

| # | Tab | Content | Header metric | Shown when |
|---|-----|---------|---------------|-----------|
| 1 | Details & solicitation documents | Core details + Context & KB panel + solicitation documents | "X of Y processed" (`solicitations`) | always |
| 2 | Analysis | Executive brief / opportunity analysis | "X of 8 sections" (`analysis`) | always |
| 3 | Solution plan | Solution plan panel | (`solution-plan`) | `enableSolutionPlan` |
| 4 | Required forms | Required forms list | "X of Y filled" (`required-forms`) | forms exist (`> 0`) |
| 5 | RFP docs | RFP documents | "X of Y required" (`rfp-documents`) | always |
| 6 | Review | AI Compliance Review panel | "N open findings" / Ready / Running (`ai-review`) | `enableComplianceReview` |
| 7 | Compliance details | Submission & Compliance — report/matrix + physical-submission banner + Submit button + submission history | "% pass rate" / Submitted (`submission`) | always |
| 8 | Outcome | Post-award summary + Debriefing + FOIA | Status label: Awaiting outcome / Won / Lost / No-bid / Withdrawn (from `opportunity.status`), no count | always |
| 9 | Related opportunities | Related RFPs section | "N related" (informational count) | `isHigherGov` (`!!higherGovOppKey`) AND non-empty |

### Behaviour

- **Gating:** conditional tabs (3, 4, 6, 9) are hidden entirely when their condition isn't met — not disabled/greyed.
- **URL state:** active tab in a `?tab=` query param via nuqs `parseAsStringLiteral` (repo pattern, cf. `PromptManager`). Default = Details; a URL pointing at a hidden/gated tab falls back to Details.
- **Mounting:** lazy keep-alive — a tab body mounts on first open, then stays mounted (hidden via CSS) for the rest of the visit. Light initial load, no re-mount jank, in-tab state preserved.
- **Overflow:** single-row tab bar with horizontal scroll (edge fade/arrows) when tabs overflow; metric + icon stay attached to each tab.
- **Header popover:** every tab header has the "more details" popover. The 7 step-backed tabs reuse `StepDetailsContent`; Outcome shows a small status summary; Related shows a short count/last-updated summary.
- **No aggregate rollup:** the retired bar's overall "K of N complete" indicator is dropped; per-tab metrics convey progress.
- **Navigation repointing:** `navigateToStep` (progress engine) and `navigateToFinding` (compliance-review) switch to tab-selection instead of anchor-scroll. No external/notification deep-links target the old section anchors.
- **Edit-route round-trip:** full-page edit routes (`forms/[documentId]`, `solution-plan/edit`, `rfp-documents/[documentId]/edit`, `submit`) are unchanged; their "back to opportunity" links append `?tab=<originating tab>` so returning lands on the right tab.

### Scope & rollout

- **Layout reorg only** — move existing panels into tabs unchanged; no behavior change inside panels. Only trim section titles/dividers now redundant with the tab label. Two small new evaluators are added: Outcome status (reads `opportunity.status`) and Related count.
- **Direct replacement** — one PR, no feature flag.

## Alternatives considered

- **Keep the progress bar AND add tab metrics / keep bar with simple tabs** — rejected: duplication; the bar's look is what we want the tabs to be.
- **Everything (title/dates/assignee) inside the Details tab, no persistent header** — rejected: loses opportunity context when switching tabs.
- **Merge Review + Compliance into one tab** — rejected: contradicts the requested two-tab split (AI review vs submission/compliance).
- **Show disabled tabs instead of hiding** — rejected: shows tabs the user can't use; contradicts "required forms if any exist" / "related only for HigherGov".
- **Unmount inactive tabs (Radix default) or keep all mounted (forceMount)** — rejected in favor of lazy keep-alive: unmount causes re-render flicker on heavy panels; keep-all gives no load-time gain.
- **Feature-flagged rollout** — rejected: unnecessary flag debt given panels are unchanged; regressions are a revert.

## Consequences

- **Positive:** far lighter initial render; persistent context and can't-miss requirement flags; deep-linkable tabs; single source of truth for completeness (one engine feeds headers); progress metrics keep updating across tabs.
- **Negative / risks:** header metrics require the progress engine to fetch all step data eagerly (unchanged from today, but now the sole driver); two new evaluators to test; `navigateToStep`/`navigateToFinding` and their tests must be repointed; `StepDetailsContent` and the progress-bar components/tests need refactoring rather than deletion.
- **Follow-ups / impl notes:** verify the detail-page opportunity object carries `submissionMethod` and `notarySummary` (present on the list-card `item`) and wire up if missing; confirm nuqs provider covers this route (it does, via `providers.tsx`).
