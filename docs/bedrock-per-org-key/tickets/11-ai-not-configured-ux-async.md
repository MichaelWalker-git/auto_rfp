# 11 — "AI not configured" UX — async surfaces (P2)

**What to build:** When an async pipeline fails because the org has no valid key, that condition is
recorded and displayed as its own distinct outcome — not collapsed into a generic
`GENERATION_FAILED`. An end user (and support) can tell "AI isn't configured for this org" apart
from a real generation failure.

**Blocked by:** 09 — the typed "AI not configured" error exists.

**Status:** ready-for-agent

- [ ] A dedicated `AI_NOT_CONFIGURED` failure reason is added to each async pipeline's
      failure-recording path (extend the answer-generation resolution enum — currently
      `ANSWERED`/`NO_KB_MATCH`/`GENERATION_FAILED` — and the equivalent outcome fields on the other
      async pipelines).
- [ ] Workers map the typed "AI not configured" error to `AI_NOT_CONFIGURED` when recording the
      result, rather than the generic failure reason.
- [ ] Wherever those results are displayed, the new reason renders distinctly (its own label /
      empty-state), reusing the sync copy/pattern from ticket 10 for consistency.
- [ ] Core schema change is a Zod enum update with tests; producer/worker tests assert the new
      reason is recorded on the AI-not-configured path.
