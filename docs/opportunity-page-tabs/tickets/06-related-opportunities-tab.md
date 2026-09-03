# 06 — Related opportunities tab (gating + count evaluator + header)

**What to build:** A Related opportunities tab lets the user review related solicitations for a HigherGov-sourced opportunity. The tab appears only for a HigherGov opportunity that actually has related RFPs, and is hidden otherwise so it only shows when it has content. Its header shows an informational "N related" count rather than a completeness metric.

**Blocked by:** 01, 02, 03

**Status:** ready-for-agent

- [ ] Related opportunities tab holds the existing `RelatedRfpsSection` moved in unchanged.
- [ ] The tab renders only when `isHigherGov` (`!!opportunity.higherGovOppKey`) AND there is at least one related opportunity; hidden entirely otherwise, and folded into the visible-set gating from ticket 03.
- [ ] A new count-only evaluator produces the "N related" value; the tab header renders it as an informational count (not a completeness status), with a "more details" popover showing a short count / last-updated summary.
- [ ] The count evaluator is unit-tested in isolation.
- [ ] Tab-shell render test covers: tab present for HigherGov + non-empty, hidden for non-HigherGov or empty.
