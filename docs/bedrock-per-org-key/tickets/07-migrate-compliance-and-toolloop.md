# 07 — Migrate compliance-review + tool-loop engines to pass `orgId`

**What to build:** The compliance-review sub-checks and the tool-loop-driven engines now pass the
org's identity into their Bedrock calls. Same mechanical migration as 06, split out because these
callers reach Bedrock through `invokeClaudeWithTools` and the compliance engine, which have their
own signatures to thread `orgId` down through. Behavior unchanged; every site ends up passing
`orgId`.

**Blocked by:** 05 — expand `orgId` parameter.

**Status:** ready-for-agent

- [ ] All `compliance-review-*` sub-checks (cert, consistency, kb-contradiction, nda-leak, pastperf,
      solution-plan, missing-forms) and the compliance-review engine pass `orgId`.
- [ ] The `invokeClaudeWithTools` consumers pass `orgId`: package-edit-engine, tech-lead-agent,
      autofill-fields-with-tools, package-edit chat handler (and any solution-plan/package-edit path
      that reaches Bedrock through these engines).
- [ ] `orgId` is threaded down each engine's own signature from the request context — never read
      from the token.
- [ ] Each touched file's co-located test is updated to the new signature.
- [ ] `apps/functions` builds and all touched tests pass (CI green — param still optional).
