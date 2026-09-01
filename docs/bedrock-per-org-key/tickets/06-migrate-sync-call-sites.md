# 06 — Migrate sync call sites to pass `orgId`

**What to build:** Every synchronous, request-path Bedrock caller now passes the org's identity
into `invokeModel`. Because these run behind request middleware, `orgId` is already available from
the event/RBAC context — this is mechanical plumbing. Behavior is unchanged (param still optional,
still resolves the shared key); the point is to get every site passing `orgId` so the contract
step can make it required.

**Blocked by:** 05 — expand `orgId` parameter.

**Status:** ready-for-agent

- [ ] All sync REST handlers and request-path helpers that call `invokeModel` pass `orgId`: answer
      generation, opportunity-assistant chat, rfp-document edit-section, required-forms ai-fill-field,
      embeddings (`getEmbedding`), service-pricing, matrix-autofill, document-section-generator,
      executive-opportunity-brief, griller-agent, docx-form-parser, notary-detection,
      disclosure-classifier, team-matching, employee-import-engine, extraction-processor.
- [ ] `orgId` is sourced from the request (body/query/path or the already-typed params these helpers
      receive) — never from the token or `event.auth`.
- [ ] Each touched file's co-located test is updated to the `orgId`-bearing call signature.
- [ ] `apps/functions` builds and all touched tests pass (CI green — param is still optional).
