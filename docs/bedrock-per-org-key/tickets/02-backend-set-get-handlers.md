# 02 — Persist & read Bedrock config (backend set/get handlers)

**What to build:** An org admin can save their Bedrock key + optional fallback model through a
dedicated API, and anyone with read access can query the configuration **status** — without the
key ever coming back over the wire. AI still runs on the shared key at this point (no probe, no
resolution flip); this ticket only stands up the storage + API surface end-to-end.

**Blocked by:** 01 — Bedrock config core schema.

**Status:** done

- [x] Dedicated Bedrock set/get handlers (NOT the unified search-opportunities handler), thin-Lambda
      pattern, standard middy stack (`authContextMiddleware → orgMembershipMiddleware →
      requirePermission → httpErrorMiddleware`), wrapped in `withSentryLambda`.
- [x] POST stores the key in Secrets Manager under `bedrock-api-key-<orgId>` via the existing
      `storeApiKey`/`getApiKey` helpers, and writes the non-secret config to DynamoDB through domain
      helpers (no raw SDK in handlers). Body is `{ orgId, apiKey, fallbackModelId? }`; `orgId` from
      the request, never the token.
- [x] Saving an **empty** key clears both the secret and the DynamoDB config (delete semantics,
      matching sibling cards).
- [x] GET returns `{ configured, fallbackModelId, lastProbe }` only — an explicit invariant that
      **no key field is present**; `orgId` from the query param.
- [x] RBAC: `org:manage_settings` to save/delete, `org:read` to read status.
- [x] Routes registered and the new domain wired into the orchestrator (both `allDomains` and
      `domainStackNames` at the same index; the synth-time length guard stays satisfied).
- [x] Handler tests on the exported business functions (mocks before imports, reset in `beforeEach`,
      `expect.any(String)` for timestamps): happy path, validation 400 + issues, RBAC/guard,
      empty-key delete, and the GET **never returns the key** assertion.
