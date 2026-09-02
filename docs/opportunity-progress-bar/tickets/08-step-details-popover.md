# 08 — Step details popover

**What to build:** The user can expand any step to see a details view explaining exactly
what remains: the step's per-item state (each form's fill state, each required document's
readiness, the brief's section list) plus a hardcoded one-line "what's this step?"
description. The popover is purely presentational — it reads the same snapshot the step's
counts came from, with no new fetching. It is keyboard-openable (Enter on a secondary
affordance), closes on Escape, and returns focus to the step.

**Blocked by:** 02 (Analysis + Required Forms — section list + form fill states), 03 (RFP
Documents — required-document readiness).

**Status:** ready-for-agent

- [ ] A Shadcn `Popover` per step showing the step's per-item list (each form's fill state, each required document's readiness, the brief's section list) + a hardcoded one-line description
- [ ] Reads the snapshot already gathered by the assembly — no new fetching
- [ ] Keyboard-openable via a secondary affordance (Enter), closes on Escape, returns focus to the step
- [ ] Opening the popover does not interfere with the step's own navigation activation (click/Enter to scroll)
- [ ] Tests: popover opens on its affordance, closes on Escape, returns focus; renders the per-item list for at least one count-based step
