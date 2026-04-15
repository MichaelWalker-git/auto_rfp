# Migration Guide: API Gateway REST API (v1) → HTTP API (v2)

## Why Migrate

The current REST API (v1) has a hard limit of **300 resources** per API. With 35 domains and 100+ routes, each creating multiple API Gateway resources (path segments + methods + integrations + CORS OPTIONS), we've hit this ceiling. Adding new endpoints requires consolidating existing routes.

**HTTP API (v2) solves this** — it has no practical resource limit, is **~70% cheaper**, has **lower latency** (~10ms vs ~29ms overhead), and has simpler CORS/auth configuration.

## Architecture Comparison

| Aspect | REST API v1 (Current) | HTTP API v2 (Target) |
|--------|----------------------|---------------------|
| Resource limit | 300 per API | 300 routes (but routes are method+path combos, not tree nodes) |
| Cost | $3.50/million requests | $1.00/million requests |
| Latency overhead | ~29ms | ~10ms |
| CORS | Manual per-resource + root config | Built-in `CorsConfiguration` — one place |
| Auth | CognitoUserPoolsAuthorizer | JWT Authorizer (same Cognito, simpler config) |
| Deployment | Manual (deploy: false + Stage) | Auto-deploy (default) |
| Stage variables | Yes | Yes |
| Request/response transforms | Yes (VTL) | No (but not used) |
| WebSocket | Separate API | Separate API (no change) |
| WAF | Yes | No (use CloudFront if needed) |
| API Keys/Usage Plans | Yes | No (not used) |

## Migration Plan

### Phase 1: CDK Changes (No Downtime)

#### 1.1 Replace RestApi with HttpApi

**Current** (`api-orchestrator-stack.ts`):
```typescript
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

this.api = new apigateway.RestApi(this, 'AutoRfpApi', {
  restApiName: `AutoRFP API (${stage})`,
  deploy: false,
  defaultCorsPreflightOptions: { ... },
});
```

**New:**
```typescript
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigwv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';

this.httpApi = new apigwv2.HttpApi(this, 'AutoRfpHttpApi', {
  apiName: `AutoRFP API (${stage})`,
  corsPreflight: {
    allowOrigins: ['*'],
    allowMethods: [apigwv2.CorsHttpMethod.ANY],
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'X-Amz-Date',
      'X-Api-Key',
      'X-Amz-Security-Token',
      'X-Org-Id',
    ],
    allowCredentials: true,
    maxAge: cdk.Duration.hours(1),
  },
  createDefaultStage: false, // We create the stage manually
});
```

#### 1.2 Replace Cognito Authorizer with JWT Authorizer

**Current:**
```typescript
const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
  cognitoUserPools: [userPool],
});
```

**New:**
```typescript
const jwtAuthorizer = new apigwv2Authorizers.HttpJwtAuthorizer(
  'CognitoJwtAuthorizer',
  `https://cognito-idp.${region}.amazonaws.com/${userPool.userPoolId}`,
  {
    jwtAudience: [userPoolClientId], // from auth stack output
  },
);
```

> **Note:** JWT Authorizer validates the token directly — no Cognito API call. Faster and cheaper.

#### 1.3 Rewrite ApiDomainRoutesStack

**Current approach:** Each route creates API Gateway Resources (tree nodes) + Methods + Lambda integrations in nested stacks.

**New approach:** Flat route registration — no resource tree, no nested stacks needed.

```typescript
// No longer a NestedStack — just a helper function
export const addDomainRoutes = (
  httpApi: apigwv2.HttpApi,
  domain: DomainRoutes,
  lambdaRole: iam.IRole,
  commonEnv: Record<string, string>,
  authorizer: apigwv2Authorizers.HttpJwtAuthorizer,
  stage: string,
) => {
  for (const route of domain.routes) {
    const functionId = `${domain.basePath}-${route.path}-${route.method}`.replace(/[^a-zA-Z0-9]/g, '-');

    const lambdaFunction = new nodejs.NodejsFunction(/* same as current */);

    const integration = new apigwv2Integrations.HttpLambdaIntegration(
      `${functionId}-integration`,
      lambdaFunction,
    );

    const routePath = `/${domain.basePath}/${route.path}`.replace(/\/+/g, '/');
    const httpMethod = apigwv2.HttpMethod[route.method as keyof typeof apigwv2.HttpMethod];

    httpApi.addRoutes({
      path: routePath,
      methods: [httpMethod],
      integration,
      authorizer: route.auth === 'NONE' ? undefined : authorizer,
    });
  }
};
```

#### 1.4 Create Stage Manually

```typescript
const apiStage = new apigwv2.HttpStage(this, 'ApiStage', {
  httpApi: this.httpApi,
  stageName: stage,
  autoDeploy: true, // Auto-deploy on changes — no manual deployment needed
});

this.apiUrl = apiStage.url;
```

#### 1.5 Remove Nested Stacks

HTTP API routes are flat — no resource tree means no 300-resource limit. All routes can be defined in the parent stack directly. If CloudFormation resource limits (~500 per stack) become an issue, use nested stacks for Lambda functions only (not routes).

### Phase 2: Handler Changes (Minimal)

#### 2.1 Event Format

REST API v1 uses `APIGatewayProxyEvent`. HTTP API v2 uses `APIGatewayProxyEventV2`.

**Key differences:**
```typescript
// v1 (current — most handlers already use v2 types)
event.httpMethod          → event.requestContext.http.method
event.resource            → event.routeKey
event.pathParameters      → event.pathParameters (same)
event.queryStringParameters → event.queryStringParameters (same)
event.body                → event.body (same)
event.headers             → event.headers (same, but lowercase keys)

// Auth context
event.requestContext.authorizer.claims → event.requestContext.authorizer.jwt.claims
```

**Most handlers already use `APIGatewayProxyEventV2`** — check imports. The RBAC middleware reads claims from:
```typescript
// Current (middleware/rbac-middleware.ts line 57-58)
const claims = rc.authorizer?.jwt?.claims ?? rc.authorizer?.claims;
```

This already supports both v1 and v2 formats. **No changes needed** for most handlers.

#### 2.2 Response Format

Both v1 and v2 accept the same response structure:
```typescript
{ statusCode: 200, headers: { ... }, body: JSON.stringify(data) }
```

The `apiResponse()` helper already returns this format. **No changes needed.**

#### 2.3 CORS Headers

With HTTP API v2, CORS is handled by the API Gateway itself (via `corsPreflight` config). The `apiResponse()` helper currently adds `Access-Control-Allow-Origin: *` header — this is redundant but harmless. Can be cleaned up later.

### Phase 3: Deployment Strategy (Zero Downtime)

**Option A: Blue-Green with Custom Domain**

1. Create the HTTP API alongside the existing REST API
2. Point a custom domain (e.g., `api.autorfp.com`) to the REST API
3. Deploy the HTTP API with all routes
4. Test the HTTP API directly via its URL
5. Switch the custom domain to the HTTP API
6. Delete the REST API stack

**Option B: Direct Replacement (Brief Downtime)**

1. Deploy with HTTP API replacing REST API
2. Update frontend `NEXT_PUBLIC_BASE_API_URL`
3. Redeploy frontend
4. ~2 minutes downtime during CloudFormation update

**Recommended: Option A** for production, **Option B** for dev/staging.

### Phase 4: Cleanup

After migration:
- Remove `api-domain-resource-stack.ts` (nested stacks no longer needed)
- Remove CORS headers from `apiResponse()` helper (handled by API Gateway)
- Remove manual deployment/stage logic
- Remove `corsConfiguredResources` tracking
- Update `router.ts` (if using proxy-per-domain pattern) — no longer needed

## File Changes Summary

| File | Change |
|------|--------|
| `packages/infra/api/api-orchestrator-stack.ts` | Replace RestApi → HttpApi, remove nested stacks, add JWT authorizer |
| `packages/infra/api/api-domain-resource-stack.ts` | Delete or convert to helper function |
| `packages/infra/api/routes/types.ts` | No change (route definitions stay the same) |
| `packages/infra/api/api-shared-infra-stack.ts` | No change (Lambda role/env shared) |
| `apps/functions/src/middleware/rbac-middleware.ts` | Already supports v2 JWT claims — verify |
| `apps/functions/src/helpers/api.ts` | Optional: remove CORS headers from apiResponse |
| `apps/web/.env.local` | Update API URL after migration |

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Breaking auth | JWT authorizer uses same Cognito tokens — test with existing tokens |
| Header case sensitivity | HTTP API v2 lowercases all header keys — verify `X-Org-Id` handling |
| Missing features (API Keys, WAF) | Not currently used — no impact |
| Path parameter format | v2 uses `{param}` same as v1 — no change |
| Binary media types | HTTP API handles automatically — simpler than v1 |
| CloudFormation stack replacement | Use Option A (blue-green) to avoid downtime |

## Estimated Effort

| Task | Time |
|------|------|
| CDK changes (HttpApi + routes) | 2-3 hours |
| JWT authorizer setup | 30 min |
| Handler verification | 1 hour (mostly grep/test) |
| Testing | 2 hours |
| Blue-green deployment | 1 hour |
| Cleanup | 1 hour |
| **Total** | **~8 hours** |

## References

- [AWS CDK HttpApi](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_apigatewayv2.HttpApi.html)
- [HTTP API vs REST API](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html)
- [JWT Authorizer](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html)
- [Migration Guide (AWS)](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-migrate.html)
