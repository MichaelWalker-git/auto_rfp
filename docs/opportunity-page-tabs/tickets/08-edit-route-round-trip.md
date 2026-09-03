# 08 — Edit-route round-trip (`?tab=` on "back to opportunity")

**What to build:** When a user edits a form, solution plan, or RFP document on its full-page edit route (or opens the submit route) and clicks "back to opportunity", they return to the tab they came from rather than the default. The edit routes' "back to opportunity" links carry the originating tab through as a `?tab=` param, which the opportunity page already honors.

**Blocked by:** 01

**Status:** ready-for-agent

Affected routes (internals unchanged — only their back-links gain the param): `forms/[documentId]`, `solution-plan/edit`, `rfp-documents/[documentId]/edit`, `submit`.

- [ ] Each edit route's "back to opportunity" link appends `?tab=<originating tab>` so returning lands on the right tab.
- [ ] The originating tab is derived from where the user came from (the tab that owns the panel launching the edit), using the stable tab keys from ticket 01.
- [ ] Returning via the back-link lands on the intended tab (the opportunity page's `?tab=` handling from ticket 01 already selects it).
- [ ] No change to the internal behavior of the edit routes.
