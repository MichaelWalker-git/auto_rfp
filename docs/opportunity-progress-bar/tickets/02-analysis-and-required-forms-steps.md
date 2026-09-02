# 02 — Analysis + Required Forms steps live

**What to build:** The Analysis and Required Forms steps in the progress bar stop being
placeholders and reflect real data. Analysis shows "N of 8 sections" and is complete only
when all 8 executive-brief sections are generated. Required Forms shows "X of Y filled"
(forms with every field filled, of total detected) and is complete only when ≥1 form is
detected and every detected form is fully filled — and the step is **hidden entirely** when
the solicitation has no detected required forms.

**Blocked by:** 01 — Scaffold + Solicitations step live.

**Status:** ready-for-agent

- [ ] Analysis rule: not-started when no brief; in-progress while any section is generating or only some are complete; complete when all 8 sections are `COMPLETE`; detail "N of 8 sections"
- [ ] Analysis snapshot read from the brief hook (which is a mutation-trigger + local state, not a shared SWR read) — the assembly calls the brief hook itself, not a shared cache key; `latestTimestamp` pre-computed from brief + per-section timestamps
- [ ] Required Forms rule: in-progress while some forms/fields (including zero) are filled but not all; complete when ≥1 form detected and every detected form has all fields filled; detail "X of Y filled" (uses `totalFieldCount`/`manualFieldCount`)
- [ ] Required Forms rule returns not-started ("No required forms") when none detected; the **assembly** hides the step in that case (visibility is the hook's job, not the rule's)
- [ ] Required Forms snapshot read from the required-forms list source; `latestTimestamp` pre-computed from per-form timestamps
- [ ] Both steps degrade to `unavailable` (never throw) on absent/partial/malformed snapshots, isolated from other steps
- [ ] Tests: table-driven rule tests for both (each base status, count string, boundaries — empty list, all-done, partial, zero-filled forms); assembly tests confirming Required Forms is hidden when none detected and both snapshots carry a pre-computed `latestTimestamp`
