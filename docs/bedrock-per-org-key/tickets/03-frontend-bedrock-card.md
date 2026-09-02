# 03 — Bedrock settings card (frontend)

**What to build:** An org admin opens Organization Settings → Integrations and sees a **Bedrock**
card alongside the existing integration cards. They paste a key and an optional fallback model ID,
save, and the card shows a **Configured / Not Configured** badge driven by the status GET. Members
with only read access can see the status but not change it.

**Blocked by:** 02 — Persist & read Bedrock config (backend set/get handlers).

**Status:** ready-for-agent

- [x] A `BedrockApiKeyConfiguration` card in `OrganizationIntegrations.tsx`, reusing the shared
      `<ApiKeyConfiguration>` style plus **one extra free-text fallback-model field**.
- [x] Key field is masked with a show/hide toggle; Configure/Update/Delete actions are gated by
      `org:manage_settings` (hidden/disabled otherwise); read-only users still see the status.
- [x] Status badge is driven by the status-only GET (`configured` boolean) via feature hooks —
      component is pure presentation, types imported from `@auto-rfp/core`, Shadcn UI only, skeleton
      loading states (no spinners).
- [x] Feature-sliced structure followed (hook holds the get/set logic + SWR revalidation; barrel
      export).
- [x] RTL tests: renders configured / not-configured states, save calls the hook, the fallback field
      is present, actions are permission-gated, loading uses skeletons.
