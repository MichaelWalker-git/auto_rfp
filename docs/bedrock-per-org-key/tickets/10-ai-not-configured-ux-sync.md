# 10 — "AI not configured" UX — sync surfaces (P2)

**What to build:** In an org with no valid key, every synchronous AI surface shows a clear,
consistent "AI not configured for this organization" state that points an admin to the Bedrock
settings card — instead of a generic error or a silent failure. Designed once as a shared
component and consumed everywhere, since there's no existing AI-configuration UX to extend.

**Blocked by:** 03 — Bedrock card (the surface to point admins to); 09 — the typed "AI not
configured" error exists.

**Status:** ready-for-agent

- [ ] One shared error/empty-state component/pattern for "AI not configured," with a path for admins
      to the Bedrock settings card.
- [ ] Wired into the ~6 sync AI features: answer-generation trigger, executive brief, compliance
      review, question extraction, document generation, and opportunity-assistant chat — each
      recognizes the typed "AI not configured" error and renders the shared state.
- [ ] Presentation-only component, Shadcn UI, skeleton loading states; logic in hooks.
- [ ] RTL coverage that the shared state renders when the AI-not-configured error is surfaced and
      is hidden otherwise.
