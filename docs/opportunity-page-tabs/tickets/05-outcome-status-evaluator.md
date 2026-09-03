# 05 — Outcome status evaluator → Outcome tab header

**What to build:** The Outcome tab header shows the opportunity's disposition as a status label rather than a completeness count, so the user reads the disposition directly: "Won", "Lost", "No-bid", or "Withdrawn" for terminal statuses, and "Awaiting outcome" for everything else. This is a new evaluator in the opportunity-progress engine, distinct from the 7 completeness steps — it produces a status label, not an "X of Y" metric.

**Blocked by:** 01, 02

**Status:** ready-for-agent

- [ ] A new progress-engine evaluator reads `opportunity.status`: `WON | LOST | NO_BID | WITHDRAWN` map to Won / Lost / No-bid / Withdrawn; all other statuses map to "Awaiting outcome".
- [ ] The Outcome tab header renders this status label (replacing its plain placeholder from ticket 01) with the tab's "more details" popover showing a small status summary.
- [ ] The evaluator is unit-tested in isolation (each terminal status → its label; non-terminal → "Awaiting outcome"), following the prior art in `lib/__tests__/rules.test.ts` / `status-display.test.ts`.
- [ ] `useOpportunityProgress` (and its test) is extended for the new evaluator.
