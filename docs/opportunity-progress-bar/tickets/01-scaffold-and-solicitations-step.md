# 01 — Progress-bar scaffold + Solicitations step live

**What to build:** Opening an opportunity page shows a new multi-step progress bar in
place of the old "Jump to" chip row. The bar renders all seven steps
(Solicitations → Analysis → Solution Plan → Required Forms → RFP Documents → AI Review →
Submission) as a connected stepper — status circle, clickable name, and a detail line
under each node. The **Solicitations** step is fully live ("X of Y processed", complete
only when ≥1 file exists and every non-deleted file is fully processed); the other six
render from a placeholder rule (not-started / "0 of N") until their own tickets land.
Clicking a step or pressing Enter smooth-scrolls to that page section. The bar renders
fully for a brand-new opportunity (empty state), shows a skeleton while data loads (never
a spinner), and omits Solution Plan / AI Review when the org has those features disabled.

This ticket establishes all three seams end-to-end: the pure `StepStatusRules` layer, the
`useOpportunityProgress` assembly hook, and the `ProgressBarUI` presentation component,
wired into `OpportunityView` as the sole host — retiring `SectionNavigation`. Section
cards, their hidden `data-doc-status` markers, and `useSmartPolling` are left untouched.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] New feature module `apps/web/features/opportunity-progress/` (`lib/`, `hooks/`, `components/`, `index.ts` barrel); host imports only from the barrel
- [ ] Feature-local view-model types defined: `StepId`, `StepStatus`, `StepDataSnapshot`, `StepEvaluation`, `ProgressStep`, `NavigationDescriptor` — as string unions / `z.enum` (no TS enums), not in `@auto-rfp/core`
- [ ] `StepStatusRules` is pure (no React, no I/O), one function per step; never throws — uncomputable input returns `unavailable`
- [ ] Solicitations rule: not-started when no non-deleted file; in-progress while any file is mid-pipeline; complete when ≥1 file exists AND all non-deleted files fully processed; detail "X of Y processed"
- [ ] `useOpportunityProgress` decides the visible step set (org gating via `useCurrentOrganization`), reads Solicitations data from `useQuestionFiles`, builds one `StepDataSnapshot` per step with a pre-computed `latestTimestamp`, invokes the rules, returns ordered `ProgressStep[]` each carrying a `NavigationDescriptor` (anchor `sectionId`)
- [ ] Placeholder rule renders the other six steps as not-started until their tickets replace it
- [ ] Solution Plan omitted when `!enableSolutionPlan`; AI Review omitted when `!enableComplianceReview` (mirrors existing `hiddenSectionIds` gating)
- [ ] `ProgressBarUI` full variant: connected stepper, connector solid when the left step is complete (dashed otherwise), always-visible detail line; renders four statuses + the `unavailable` display; skeleton on load; full empty state
- [ ] Click / Enter on a step activates its navigation descriptor → smooth `scrollIntoView` to the existing section id
- [ ] Accessibility: labeled `nav` landmark ("Package preparation progress"), one tab stop per step, status conveyed in text (not color alone)
- [ ] `OpportunityView` renders the bar where the "Jump to" row lived and no longer renders `SectionNavigation`; `data-doc-status` markers and `useSmartPolling` untouched
- [ ] Per-step data failure is isolated — one failing source degrades only that step to `unavailable`
- [ ] Tests: table-driven Solicitations rule tests (each base status, count string, boundary cases); assembly tests for visible set under gating + navigation descriptors + failure isolation; UI tests for the four statuses, skeleton, empty state, click/Enter activation, and `nav`/tab-stop/status-text semantics
