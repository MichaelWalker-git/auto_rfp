# 02 — Progress-driven tab headers (metric + status icon + popover + overflow scroll)

**What to build:** Each tab header doubles as a progress indicator, so the user reads their progress off the tabs themselves. A header shows the tab name, a completeness metric ("X of Y"), a status icon, and a "more details" popover explaining what the step means and why it is or is not complete. The metrics keep updating even while the user is on a different tab, so a long-running job (e.g. RFP-document generation) finishing elsewhere is noticed. When there are more tabs than fit, the tab bar scrolls horizontally with the metric and icon staying attached to each tab.

**Blocked by:** 01

**Status:** ready-for-agent

Metric-to-step mapping for the always-on tabs: Details → `solicitations` ("X of Y processed"), Analysis → `analysis` ("X of 8 sections"), RFP docs → `rfp-documents` ("X of Y required"), Compliance details → `submission` ("% pass rate" / Submitted). Outcome's header label comes from a new evaluator (ticket 05) — until then it shows a plain label.

- [ ] `useOpportunityProgress()` runs in the always-mounted tab strip and drives each step-backed tab header; metrics update regardless of which tab is active.
- [ ] Each step-backed tab header renders name + "X of Y" metric text + status icon.
- [ ] Every tab header has a "more details" popover; the step-backed tabs reuse `StepDetailsContent`.
- [ ] The tab bar is a single row that scrolls horizontally (edge fade / arrows) when tabs overflow, with metric + icon staying attached to each tab.
- [ ] `ProgressBarUI` and `StepDetailsContent` are refactored (not deleted) into their tab-strip role; their tests (`ProgressBarUI.test.tsx`, `StepDetailsContent.test.tsx`) are updated to the new role, keeping the behavioral assertions that still hold.
- [ ] Tab-shell render test asserts headers render the metric text supplied by the mocked progress steps.
- [ ] No aggregate "K of N complete" rollup is shown anywhere.
