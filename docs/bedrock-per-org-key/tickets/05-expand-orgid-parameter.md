# 05 — Thread `orgId` through `invokeModel` & `invokeClaudeWithTools` (expand)

**What to build:** The expand step of a wide refactor. Both Bedrock entry points gain an `orgId`
parameter, and the tool-loop forwards it to every model invocation it makes — but resolution is
unchanged (still the shared key), so nothing breaks and no behavior changes. This is the seam that
later tickets migrate onto, done in isolation so the migration can proceed batch by batch while CI
stays green.

**Blocked by:** None — can start immediately (parallel to 01).

**Status:** done

- [x] `invokeModel` accepts `orgId` as an **optional** parameter (kept optional here so call-site
      migration in 06/07/08 can land incrementally without breaking the build).
- [x] `invokeClaudeWithTools` accepts `orgId` and forwards it to **every** internal `invokeModel`
      call — the main round, the truncation retry, and the JSON-repair retry.
- [x] Resolution behavior is untouched: with no per-org key configured it still resolves the shared
      key exactly as today. No test regressions.
- [x] `bedrock-tool-loop.test.ts` asserts `orgId` is threaded through to the underlying invoke on
      every round (tool-use rounds, truncation retry, JSON-repair retry).
