---
name: cdk-route
description: Add a new API Gateway route with Lambda integration in CDK, including domain routes file and orchestrator registration
---

# CDK Route Creation

When adding a new API route to the project, follow these exact steps:

## 1. Create Domain Routes File

Create `packages/infra/api/routes/<domain>.routes.ts`:

```typescript
import { lambdaEntry } from './route-helper';
import type { DomainRoutes } from './types';

export const <domain>Domain = (args?: {
  // Pass any extra env vars needed (queue URLs, bucket names, etc.)
  someQueueUrl?: string;
}): DomainRoutes => ({
  basePath: '<domain>',
  routes: [
    {
      method: 'POST',
      path: 'create',
      entry: lambdaEntry('<domain>/create-<entity>.ts'),
    },
    {
      method: 'GET',
      path: 'list',
      entry: lambdaEntry('<domain>/list-<entities>.ts'),
    },
    {
      method: 'GET',
      path: 'get',
      entry: lambdaEntry('<domain>/get-<entity>.ts'),
    },
    {
      method: 'PATCH',
      path: 'update',
      entry: lambdaEntry('<domain>/update-<entity>.ts'),
    },
    {
      method: 'DELETE',
      path: 'delete',
      entry: lambdaEntry('<domain>/delete-<entity>.ts'),
    },
  ],
});
```

## 2. Register in Orchestrator

Add the domain to `packages/infra/api/api-orchestrator-stack.ts`:

1. Import the domain function
2. Add to `allDomains` array
3. Add to `domainStackNames` map

## 3. Route Configuration Options

Available `RouteDef` fields:
- `method`: `'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'`
- `path`: relative path under basePath (no leading slash)
- `entry`: use `lambdaEntry('<domain>/<handler>.ts')` — resolves to `apps/functions/src/handlers/`
- `handler`: export name (default: `'handler'`)
- `auth`: `'COGNITO' | 'NONE' | 'IAM'` (default: `'COGNITO'`)
- `extraEnv`: additional environment variables `Record<string, string>`
- `memorySize`: Lambda memory in MB (default: 128)
- `timeoutSeconds`: Lambda timeout (default: 10s, keep ≤ 30s)
- `nodeModules`: extra npm packages not bundled by esbuild

## 4. Hard Rules

- **Always use `lambdaEntry()`** helper — never construct paths manually
- **Default auth is COGNITO** — only set `auth: 'NONE'` for public endpoints
- **Keep timeouts short** (≤ 10s default, ≤ 30s max for most handlers)
- **Memory defaults to 128MB** — only increase if handler needs more
- **Every Lambda MUST have a CloudWatch Log Group** with 2-week retention (non-prod)
- **Cost optimization**: PAY_PER_REQUEST billing, no provisioned concurrency

## 5. Verify

```bash
cd packages/infra && pnpm tsc --noEmit
```
