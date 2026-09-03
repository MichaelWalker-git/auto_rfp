# Opportunity Tabs — Glossary

Shared vocabulary for the opportunity-page tabbed redesign. Added to as the design is grilled.

- **Opportunity detail page** — `apps/web/app/organizations/[orgId]/projects/[projectId]/opportunities/[oppId]/page.tsx`, rendering `OpportunityView` → `OpportunityContent`. Today a single long scrolling `space-y-6` div; being replaced by a tabbed layout.
- **opportunity-progress engine** — `apps/web/features/opportunity-progress`. Hook `useOpportunityProgress()` produces per-step `{ status, detailText ("X of Y filled"), reason, navigation, visible, domainData }`. Drives the current package-preparation progress bar. Being repurposed to drive **tab headers**.
- **Progress step** — one of the 7 tracked units of work: `solicitations`, `analysis`, `solution-plan`, `required-forms`, `rfp-documents`, `ai-review`, `submission`. Not 1:1 with tabs.
- **Tab** — a top-level section of the redesigned page. Header shows: name + completeness metric ("X of Y") + status icon + a "more details" affordance (popover), echoing the current progress-bar step appearance.
- **Persistent header** — chrome pinned above the tab strip on every tab: opportunity title, agency, back button, assignee selector, and the requirement flag-row.
- **Requirement flag chips** — can't-miss indicators in the persistent header, each auto-hiding when N/A: US-based team required (`deliveryLocationConstraint === 'US_ONLY'`), Physical submission (`PhysicalSubmissionChip`), Notary required (`OpportunityNotaryChip`). Clicking jumps to the owning tab; the full detail stays in that tab.
- **Approval banner** — the reviewer approve/reject panel (`OpportunityApprovalPanel`), shown above the tabs to an assigned reviewer only.
- **isHigherGov** — `!!opportunity.higherGovOppKey`. Gates the Related Opportunities tab.
