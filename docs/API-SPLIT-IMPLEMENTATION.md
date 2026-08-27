# API Split — CloudFront-Routed Dual HTTP APIs

> Fixes the deploy-blocking AWS quota error:
> `Maximum number of Integrations for this API has been reached. Please contact AWS if you require additional Integrations.`

---

## 1. Overview <!-- ✅ IMPLEMENTED -->

| | |
|---|---|
| **Problem** | The single HTTP API has hit the hard AWS quota of **300 integrations per API**. No new route can deploy. |
| **Root cause** | `ApiDomainLambdaStack` creates one dedicated Lambda + one `HttpLambdaIntegration` per route. 46 registered domains × ~312 live routes = 312 integrations. |
| **Fix** | Split the routes across **two** HTTP APIs and put a **CloudFront distribution** in front, routing by path prefix. The frontend keeps a single base URL (the CloudFront domain). |
| **Quota headroom after split** | Primary API ≈ 189 routes, Secondary API ≈ 123 routes. A synth-time guard fails the build at 280 routes per API so this error can never reach CloudFormation again. |
| **Frontend impact** | None in code. `NEXT_PUBLIC_BASE_API_URL` (fed from `api.apiUrl` → AmplifyFeStack) simply becomes the CloudFront URL. |

## 2. Decision — why CloudFront over the alternatives <!-- ✅ DECIDED -->

| Option | Verdict | Why |
|---|---|---|
| Quota increase | ❌ Dead end | Integrations-per-API is a hard (non-adjustable) limit for HTTP APIs. AWS support confirmed by recommending a split. |
| Two API URLs, client picks (map in `auth-fetcher.ts`) | ❌ Rejected | Stale-tab problem: the domain→API map lives in the JS bundle, so every future domain reshuffle breaks open SPA tabs until refresh. Also, URLs that escape the app (calendar-subscription links, download links) would need the mapping applied at construction time. |
| API Gateway custom domain + API mappings | ❌ Rejected | Requires ACM cert + DNS we don't have for the API; HTTP API multi-level mapping keys require route paths to *include* the mapping key, forcing route rewrites. |
| **CloudFront distribution routing by path prefix** | ✅ **Chosen** | Server-side routing: domains can move between APIs (or collapse into per-domain router Lambdas later) with zero frontend deploys. No fixed monthly cost. One env value changes; none of the ~73 web files touching `BASE_API_URL` change. |

## 3. Architecture <!-- ✅ IMPLEMENTED -->

```text
Browser (NEXT_PUBLIC_BASE_API_URL = https://dXXXX.cloudfront.net)
    │
    ▼
CloudFront distribution  (CachingDisabled + AllViewerExceptHostHeader)
    │
    ├── default behavior ──────────────► HTTP API 1 "primary"   (origin path /{stage})
    │                                      38 domains, ~189 routes
    │
    └── /{basePath}/* per moved domain ─► HTTP API 2 "secondary" (origin path /{stage})
         /rfp-document/*  /foia/*           8 domains, ~123 routes
         /templates/*     /content-library/*
         /required-forms/* /pricing/*
         /brief/*         /pastperf/*
```

Key properties:

- Both APIs get an identical `HttpStage` (same `stageName`), so both origins share the path shape `/{stage}/{basePath}/...`. CloudFront's `originPath: /{stage}` re-adds the stage segment the client no longer sends.
- Both APIs get their own `HttpJwtAuthorizer` (an authorizer instance binds to exactly one API) and identical CORS config.
- The behavior policies are load-bearing: `CachePolicy.CACHING_DISABLED` + `OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER` is the pair that forwards the `Authorization` header to the JWT authorizer without ever caching authed responses. The CloudFront defaults silently strip `Authorization` → blanket 401s.
- CloudFront's 30s origin timeout > API Gateway's 29s cap, so timeout behavior is unchanged.
- The WebSocket collaboration API is a separate API Gateway and is unaffected.

## 4. Domain assignment <!-- ✅ IMPLEMENTED -->

Single source of truth: `packages/infra/api/routes/api-assignment.ts` (`SECONDARY_API_DOMAINS`).

**Secondary API** (document-generation / AI cluster — 123 routes): `rfp-document` (24), `foia` (17), `content-library` (15), `templates` (15), `pricing` (14), `required-forms` (14), `brief` (12), `pastperf` (12).

**Primary API** (everything else — 189 routes): all remaining 38 registered domains.

Rules going forward:

- A **new domain** goes to whichever API the synth guard has room for; add it to `SECONDARY_API_DOMAINS` if secondary.
- Moving an **existing** domain requires a matching CloudFront behavior change (both live in the orchestrator, one PR) — the frontend never changes.
- The synth guard throws when either API exceeds `MAX_ROUTES_PER_API` (280), with instructions, so the quota error surfaces at build time, not at deploy time.

## 5. Implementation <!-- ✅ IMPLEMENTED -->

### 5.1 New file: `packages/infra/api/routes/api-assignment.ts` <!-- ✅ IMPLEMENTED -->

- `SECONDARY_API_DOMAINS: ReadonlySet<string>` — basePaths served by the secondary API.
- `apiTierForDomain(basePath)` → `'primary' | 'secondary'`.
- `validateApiAssignment(domains)` — counts routes per tier, throws over `MAX_ROUTES_PER_API` (280). Called at synth.

### 5.2 `packages/infra/api/api-orchestrator-stack.ts` <!-- ✅ IMPLEMENTED -->

1. Second `HttpApi` (`AutoRfpHttpApi2`) with identical CORS, `createDefaultStage: false`.
2. Second `HttpJwtAuthorizer` (`CognitoJwtAuthorizer2`) — same issuer/audience.
3. `validateApiAssignment(allDomains)` before the domain-stack loop.
4. Domain-stack loop passes the tier-matching `httpApi` + `authorizer` per domain. Nested-stack logical IDs and all Lambdas are untouched — only `HttpRoute`/`HttpLambdaIntegration` resources are replaced onto the new API (create-before-delete, different APIs → no 409 conflicts).
5. Second `HttpStage` (`HttpApiStage2`), same `stageName`, `autoDeploy: true`.
6. CloudFront `Distribution`: default behavior → primary origin, one `/{basePath}/*` behavior per secondary domain (8 behaviors, default quota is 25). `PriceClass_100`, HTTPS-only, no custom domain (uses `*.cloudfront.net`).
7. `this.apiUrl` = CloudFront URL → flows to SSM `/auto-rfp/{stage}/api-url` and to `AmplifyFeStack.baseApiUrl` → `NEXT_PUBLIC_BASE_API_URL`. Raw execute-api URLs kept as `CfnOutput`s for debugging.

### 5.3 cdk-nag suppressions (`packages/infra/cdk-nag-suppressions.ts`) <!-- ✅ IMPLEMENTED -->

New `addCloudFrontSuppressions()` (wired into `addAllSuppressions`, which the bin already applies to the orchestrator stack), matching the repo's existing non-prod cost-rationale pattern:

- `CFR1` (geo restriction) — always suppressed: distribution fronts a JWT-authed API; no geo requirement.
- `CFR4` (TLS minimum) — always suppressed: the default `*.cloudfront.net` cert pins TLSv1 minimum; fixable only with a custom domain + ACM cert. Revisit if a custom API domain is attached.
- `CFR2` (WAF) / `CFR3` (access logging) — suppressed for **non-prod only** (mirrors `APIG3`/`APIG1`). A prod-stage synth will fail cdk-nag until WAF + access logging are added to the distribution or the suppressions are extended — deliberate, consistent with the repo's convention.

### 5.4 Tests <!-- ✅ IMPLEMENTED -->

`packages/infra/api/routes/api-assignment.test.ts` — tier resolution, per-tier counting, guard throws over the cap, guard passes at the cap.

## 6. Cutover & rollback <!-- ⏳ PENDING -->

**Deploy (dev first):**

1. `pnpm deploy:dev:api` (or full pipeline). One deploy creates API 2 + CloudFront, moves the 8 domains, and updates SSM. The subsequent Amplify build picks up the CloudFront URL.
2. **Stale-tab window**: browser tabs holding the *old* bundle still point at the old execute-api URL; the 8 moved domains 404 there until the tab refreshes. Bounded by the Amplify deploy + a refresh; SWR error-retry recovers on refresh. Acceptable on dev/test; for prod, deploy in a low-traffic window (or temporarily dual-register moved domains on both APIs — secondary has headroom — then remove after bake time).
3. Local dev: update `NEXT_PUBLIC_BASE_API_URL` in `apps/web/.env.local` to the CloudFront URL (see the `ApiBaseUrl` stack output or SSM `/auto-rfp/dev/api-url`).

**Export-migration shim:** `apiUrl` used to reference the HTTP API, so CloudFormation auto-exported the API's Ref for `AmplifyFeStack` to import. Re-pointing `apiUrl` at CloudFront would delete that export while `AmplifyFeStack` still imports it (deploy fails with `Cannot delete export ... in use by AmplifyFeStack`). The orchestrator therefore calls `this.exportValue(this.httpApi.apiId)` to keep the old export alive during the migration. **Follow-up:** remove that line after one successful full `cdk deploy --all` per stage (dev/test/prod) — it's marked TEMPORARY in the code.

**Rollback:** revert the PR and redeploy — routes replace back onto API 1 (still under 300 after the move freed ~123), CloudFront and API 2 are deleted, SSM reverts to the execute-api URL.

## 7. Verification checklist <!-- ⏳ PENDING -->

- [ ] `pnpm --filter @auto-rfp/infra build` (tsc) passes; synth guard passes with 189/123.
- [ ] After deploy: authed GET via CloudFront to a **primary** domain (e.g. `/organization/...`) returns 200.
- [ ] Authed GET via CloudFront to a **secondary** domain (e.g. `/pricing/...` or `/foia/...`) returns 200.
- [ ] An unauthed request returns 401 (JWT authorizer reached ⇒ `Authorization` forwarding works).
- [ ] Browser preflight (OPTIONS) succeeds through CloudFront.
- [ ] `auth: 'NONE'` routes and webhook endpoints (e.g. Linear) work through CloudFront.
- [ ] Calendar-subscription URL (`CalendarSubscription.tsx`) resolves through CloudFront.
- [ ] E2E smoke (`pnpm test:e2e`) against dev.

## 8. Follow-ups (out of scope) <!-- ⏳ PENDING -->

- **Per-domain router Lambdas (lambdalith)** — the root-cause fix: one `ANY /{basePath}/{proxy+}` route per domain drops integrations to ~46 and cuts cold-start surface + deploy time. Convert incrementally, starting with high-route uniform domains; each conversion frees integrations. The CloudFront layer makes this invisible to clients.
- Delete dead route files `dibbs.routes.ts` / `samgov.routes.ts` (never registered; inflate apparent counts).

## 9. Summary of files <!-- ✅ IMPLEMENTED -->

| File | Change | Status |
|---|---|---|
| `packages/infra/api/routes/api-assignment.ts` | NEW — domain→API map + synth guard | ✅ |
| `packages/infra/api/routes/api-assignment.test.ts` | NEW — guard/tier tests | ✅ |
| `packages/infra/api/api-orchestrator-stack.ts` | Second HTTP API + authorizer + stage, CloudFront distribution, tier-aware domain loop, apiUrl → CloudFront | ✅ |
| `packages/infra/cdk-nag-suppressions.ts` | `addCloudFrontSuppressions` (CFR1/CFR4 always, CFR2/CFR3 non-prod) | ✅ |
