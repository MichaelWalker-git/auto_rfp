---
name: lambda
description: Create a new Lambda handler with middy middleware, Zod validation, audit logging, and Sentry wrapping
---

# Lambda Handler Creation

When creating a new Lambda handler in this project, follow these exact steps:

## 1. File Location

Create `apps/functions/src/handlers/<domain>/<action>.ts`

## 2. Handler Template

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { nowIso } from '@/helpers/date';
import {
  authContextMiddleware,
  type AuthedEvent,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import middy from '@middy/core';
import { <Schema> } from '@auto-rfp/core';

export const <handlerName> = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  // 1. Parse input
  const bodyJson = event.body ? JSON.parse(event.body) : {};

  // 2. Validate — ALWAYS destructure safeParse immediately
  const { success, data, error } = <Schema>.safeParse(bodyJson);
  if (!success) {
    return apiResponse(400, { message: 'Validation failed', issues: error.issues });
  }

  // 3. Get orgId from request — NEVER from event.auth or JWT
  const orgId = getOrgId(event);

  // 4. Call helper — NO business logic in handler
  const result = await someHelper(data, orgId);

  // 5. Set audit context
  setAuditContext(event, {
    action: '<ENTITY>_CREATED',
    resource: '<entity>',
    resourceId: result.id,
  });

  // 6. Return with apiResponse — NEVER raw { statusCode, body }
  return apiResponse(200, { ok: true, data: result });
};

export const handler = withSentryLambda(
  middy(<handlerName>)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('<entity>:<action>'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
```

## 3. Hard Rules

- **Lambdas MUST be thin** — only parse, validate, call helper, return response
- **NO business logic** in handlers — all logic goes in `apps/functions/src/helpers/`
- **`safeParse` MUST be destructured immediately**: `const { success, data, error } = ...`
- **`orgId` from request** (body/query/path) — NEVER from `event.auth` or JWT claims
- **Always use `apiResponse`** from `@/helpers/api` — never construct raw response objects
- **Always use `withSentryLambda`** wrapper for error tracking
- **Always use `const` arrow functions** — never `function` keyword
- **Always set audit context** via `setAuditContext` for mutations
- **Middleware order**: `authContextMiddleware → orgMembershipMiddleware → requirePermission → auditMiddleware → httpErrorMiddleware`

## 4. GET Handler Pattern

For GET handlers, extract params from query string:
```typescript
const { orgId, entityId } = event.queryStringParameters ?? {};
if (!orgId) return apiResponse(400, { message: 'orgId is required' });
```

## 5. Register CDK Route

Add to `packages/infra/api/routes/<domain>.routes.ts`:
```typescript
{ method: 'POST', path: '<action>', entry: lambdaEntry('<domain>/<action>.ts') },
```

## 6. Create Tests

Create `apps/functions/src/handlers/<domain>/<action>.test.ts`:
- Mock middy, AWS SDK, and env vars before imports
- Test the exported function directly (not the middy-wrapped handler)
- Cover: happy path, validation errors, not found, guard clauses, edge cases
- Reset mocks in `beforeEach` with `jest.clearAllMocks()`
