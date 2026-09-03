# 03 — Conditional tab gating (Solution plan, Required forms, Review) + visible-set fallback

**What to build:** Only the tabs relevant to this opportunity appear; irrelevant ones are hidden entirely rather than greyed out. The Solution plan tab appears only for an org with Solution Plan enabled; the Required forms tab appears only when the opportunity actually has required forms; the Review tab appears only for an org with Compliance Review enabled. A `?tab=` link pointing at a tab that is hidden or gated off for this opportunity falls back to the Details tab, so a stale or invalid link never lands the user on a broken or empty tab.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Solution plan tab renders only when `enableSolutionPlan` is set on the current org; hidden entirely otherwise.
- [ ] Review tab (AI Compliance Review panel) renders only when `enableComplianceReview` is set; hidden entirely otherwise.
- [ ] Required forms tab renders only when the opportunity has required forms (`requiredForms.length > 0`); hidden entirely otherwise.
- [ ] Each conditional tab holds its existing panel moved in unchanged (Solution plan panel, Required forms list, AI Compliance Review panel).
- [ ] `?tab=` is validated against the **visible** tab set (not just the literal `TAB_VALUES` union); a value for a hidden/gated tab falls back to Details.
- [ ] Tab-shell render test covers each gate on/off (Solution plan, Review via org flags; Required forms via forms count) and the gated-link → Details fallback; always-on tabs always render.
