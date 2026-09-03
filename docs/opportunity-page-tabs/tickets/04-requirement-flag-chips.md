# 04 — Requirement flag chips in the persistent header

**What to build:** A row of can't-miss requirement chips lives in the persistent header, visible on every tab, each auto-hiding when it does not apply: "US-based team required", "Physical submission", and "Notary required". Clicking a chip jumps straight to the tab that owns the full detail — US-based team → Details, Physical submission → Compliance details, Notary required → Required forms. The chips are additive: the fuller detail stays in its owning tab (physical-submission banner in Compliance details, notary trigger list in Required forms). The "US-based team required" fact is stated only in the header chip, not duplicated in the Details body.

**Blocked by:** 01, 03

**Status:** ready-for-agent

Chip conditions: US-based team required when `opportunity.deliveryLocationConstraint === 'US_ONLY'`; Physical submission via `PhysicalSubmissionChip` (`submissionMethod` is PHYSICAL/BOTH); Notary required via `OpportunityNotaryChip` (`opportunity.notarySummary`). Both `submissionMethod` and `notarySummary` are present on the detail-page opportunity object — verify they flow through and wire up only if missing (no new backend/schema fields).

- [ ] The requirement flag-row renders in the persistent header above the tab strip.
- [ ] US-based team chip shows only for `deliveryLocationConstraint === 'US_ONLY'`; the existing US-team badge is removed from the Details/header body so the fact is not stated twice.
- [ ] Physical submission chip (`PhysicalSubmissionChip`) shows only when submission is physical; Notary chip (`OpportunityNotaryChip`) shows only when a notary summary is present.
- [ ] Each chip auto-hides when its condition is false.
- [ ] Clicking a chip selects its owning tab: US-team → Details, Physical → Compliance details, Notary → Required forms.
- [ ] Tab-shell render test covers: each chip appears only when applicable, the US-team fact does not also appear in the Details body, and each chip click selects the correct tab.
