# 07 — Navigation repointing: navigateToStep + compliance finding navigation → tab selection

**What to build:** In-app navigation that used to scroll to a section anchor now switches to the owning tab, keeping navigation consistent with the tabbed layout. The progress engine's "Jump to step" action selects the owning tab instead of smooth-scrolling to a section id. Any compliance-review navigation that relied on scrolling to the old `ai-compliance-review` / `submission-compliance` section anchors is repointed to tab selection. (Compliance findings that route to full-page edit routes are unaffected here — their round-trip is ticket 08.)

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `navigateToStep` switches from `scrollIntoView` on a section id to selecting the owning tab via the `?tab=` state, using the tab-select (`{ kind: 'route' }`) navigation descriptor rather than `{ kind: 'anchor' }`.
- [ ] Verify no compliance navigation still relies on scrolling to the removed `ai-compliance-review` / `submission-compliance` section anchors; repoint any that do to tab selection.
- [ ] Confirm no external / notification deep-link targets the old section anchors before removing them (they are removed by the tab reorg).
- [ ] `navigateToStep` test (`components/__tests__/navigateToStep.test.ts`) is refactored (not rewritten) to assert it selects the owning tab instead of scrolling.
