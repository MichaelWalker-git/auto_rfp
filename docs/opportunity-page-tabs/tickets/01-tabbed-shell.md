# 01 — Tabbed shell: persistent header, URL state, lazy keep-alive, always-on tabs

**What to build:** The opportunity detail page renders as a set of tabs instead of one long scrolling column. On every tab, a persistent header stays pinned above the tab strip showing the opportunity title, agency, the back-to-opportunities button, and the assignee selector. The always-shown tabs exist — Details (core details + Context & Knowledge Base panel + solicitation documents), Analysis, RFP docs, Compliance details, and Outcome — each holding its existing panel moved in unchanged. A user can switch tabs instantly; the tab they land on is reflected in the URL so it can be bookmarked or shared. Opening the page with no tab specified starts on Details; opening it with an unrecognized `?tab=` value also lands on Details. The approval banner still shows above the tabs for an assigned reviewer, and the floating AI assistant is still reachable from every tab. The standalone package-preparation progress bar is gone from the page.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] The opportunity detail page renders a tab strip with the always-on tabs (Details, Analysis, RFP docs, Compliance details, Outcome); the old single-column `space-y-6` layout is replaced.
- [ ] Persistent header (title, agency, back button, assignee selector) is visible above the tab strip on every tab.
- [ ] Details tab combines core details, the Context & Knowledge Base panel, and solicitation documents; every other always-on panel is moved into its tab unchanged (no behavior change inside panels).
- [ ] Active tab is stored in a `?tab=` query param (nuqs `useQueryState` + `parseAsStringLiteral` over a `readonly` `TAB_VALUES` tuple, per the PromptManager pattern); default is Details.
- [ ] A `?tab=` value not in the tab set falls back to Details.
- [ ] Lazy keep-alive: only the Details body renders on first paint; a tab body mounts on first open and stays mounted (hidden via CSS) afterwards, so switching back is instant and in-tab state is preserved.
- [ ] The standalone `OpportunityProgressBar` host is removed from the page; the approval banner renders above the tabs (self-gated to assigned reviewer) and the floating chat stays floating.
- [ ] `OpportunityView` / `OpportunityContent` render is tested with mocked seams (nuqs, `useOpportunityContext`, `useCurrentOrganization`, child panels stubbed) per the PromptManager test pattern: default tab, `?tab=<key>`, invalid `?tab=` → Details, always-on tabs render, lazy keep-alive (unopened body not mounted on first paint; stays in DOM after switching away).
- [ ] `OpportunityProvider` wrapper and the smart-polling hook are retained.
