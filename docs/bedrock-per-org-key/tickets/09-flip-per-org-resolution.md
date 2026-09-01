# 09 — Flip to per-org resolution + cache + retry; make `orgId` required (contract)

**What to build:** The contract step. `invokeModel` stops using the shared key and resolves each
call's key from its `orgId`; an org with no valid key gets a clear, typed **"AI not configured"**
error instead of silently working. Warm containers cache keys per org with a short TTL and evict
on auth failure; a text-model gap transparently retries once on the org's fallback. `orgId` becomes
**required**, so a missing org is a build error. This compiles only once 06/07/08 have every call
site passing `orgId`, and it needs the config store (04) for the fallback model.

> ⚠️ Do **not** deploy this (or 12) to any shared environment until the P1 dev/test/CI key
> provisioning prerequisite is done and verified (see README) — this is the moment an org with no
> key goes dark.

**Blocked by:** 04 — save-time probe (config store + fallback); 06, 07, 08 — all call sites pass
`orgId`.

**Status:** ready-for-agent

- [ ] `invokeModel` resolves the per-org key from `orgId` via Secrets Manager (`bedrock-api-key-<orgId>`);
      the shared process-wide `cachedApiKey` and the shared SSM read are removed — a single
      resolution path (per-org key or error), no fallback branching.
- [ ] `orgId` is now a **required** parameter on `invokeModel` and `invokeClaudeWithTools` — a
      missing/ambiguous org is a compile error.
- [ ] Per-org cache: `Map<orgId, key>` with a short (~5 min) TTL. Cache hit within TTL avoids a
      second Secrets Manager fetch; TTL expiry re-fetches.
- [ ] Evict-on-auth: a Bedrock 401/403 drops that org's cached entry, re-fetches once, and retries
      before failing. Auth failures (401/403) are distinguished from unrelated errors so real
      problems aren't masked.
- [ ] Invoke-time text fallback: on `ResourceNotFoundException`/`AccessDenied` for a **text** role,
      transparently retry once with the org's `fallbackModelId`. A titan/embeddings failure is a
      **hard error** with no retry. Existing throttling retry is preserved.
- [ ] An org with no valid key produces a distinct, typed "AI not configured" error (no shared
      fallback). Any fail-open catch around a Bedrock call reports explicitly (Sentry /
      `console.error`) so a bad-key / missing-model condition is diagnosable.
- [ ] Seam-1 tests (assert observable behavior, not cache internals): org A never uses org B's key;
      unconfigured org → "AI not configured"; cache hit avoids a second fetch; TTL expiry re-fetches;
      401/403 evicts + re-fetches + retries; text-role not-found retries once on the fallback;
      titan failure is a hard error with no retry; throttling retry preserved.
