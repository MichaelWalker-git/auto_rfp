# 07 — Condensed-pinned + mobile rendering variants

**What to build:** The progress bar keeps the user oriented deep in a long page and on
small screens. As the user scrolls, the bar pins to the top of the viewport and condenses
to a slim single row of small circles that always shows the current (first non-complete)
step's name and count inline, with the other steps' names/counts on hover/focus tooltip —
all steps stay clickable. On mobile the bar collapses to a compact two-row treatment: a
title with an overall "K of N" count and small status circles, plus a "Next: <step> —
<detail>" line, with touch targets of at least 44px. Long step names truncate with an
ellipsis + tooltip, and the bar wraps to two rows before horizontal scrolling on narrow
desktop.

**Blocked by:** 01 — Scaffold + Solicitations step live.

**Status:** ready-for-agent

- [ ] Condensed pinned variant: pins on scroll, slim row of small circles, current step's name + count inline, other names/counts on hover/focus tooltip, all steps clickable/visible
- [ ] Mobile variant: two rows — title + overall "K of N", small circles, "Next: <step> — <detail>" line; touch targets ≥ 44px
- [ ] Long names truncate with ellipsis + tooltip; bar wraps to two rows before horizontal scroll on narrow desktop
- [ ] Condensed circles are hover/focus-able to reveal step name + count for keyboard and mouse users
- [ ] No new data fetching — variants render from the same `ProgressStep[]`
- [ ] Tests: condensed and mobile variants show the current step's name/count and overall "K of N"; condensed circle reveals name/count on focus
