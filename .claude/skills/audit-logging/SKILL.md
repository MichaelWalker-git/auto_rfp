---
name: audit-logging
description: Add audit trail logging to handlers and services with proper actions, resources, and non-blocking patterns
---

# Audit Logging

Every new handler, service, or AI feature MUST emit audit log entries. This is non-negotiable.

## 1. Using Audit Middleware (REST Handlers)

For REST Lambda handlers, use `setAuditContext` in the handler and `auditMiddleware` in the middy chain:

```typescript
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

// Inside handler, before returning:
setAuditContext(event, {
  action: 'ENTITY_CREATED',
  resource: 'entity',
  resourceId: entity.id,
  orgId: data.orgId,  // explicit orgId when from body
  changes: {
    after: { name: data.name, status: data.status },
  },
});

// In middy chain:
export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('entity:write'))
    .use(auditMiddleware())       // ← MUST be included
    .use(httpErrorMiddleware()),
);
```

## 2. Using writeAuditLog Directly (Background Workers)

For SQS handlers, Step Functions, or background workers:

```typescript
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { v4 as uuidv4 } from 'uuid';
import { nowIso } from '@/helpers/date';

await writeAuditLog(
  {
    logId: uuidv4(),
    timestamp: nowIso(),
    userId: 'system',
    userName: 'system',
    organizationId: orgId,
    action: 'AI_GENERATION_COMPLETED',
    resource: 'document',
    resourceId: documentId,
    changes: {
      after: { documentType, tokensUsed, toolRounds },
    },
    ipAddress: '0.0.0.0',
    userAgent: 'system',
    result: 'success',
  },
  await getHmacSecret(),
);
```

## 3. Non-Blocking Pattern (High-Frequency Events)

For AI tool calls and other high-frequency events:

```typescript
// ✅ Non-blocking — errors swallowed gracefully
writeAuditLog(payload, hmacSecret).catch((err) =>
  console.warn('Failed to write audit log (non-blocking):', err.message),
);

// ❌ Wrong — blocks critical path
await writeAuditLog(payload, hmacSecret);
```

## 4. Adding New Audit Actions

When a feature needs a new action:

1. Add to `AuditActionSchema` in `packages/core/src/schemas/audit.ts`:
   ```typescript
   export const AuditActionSchema = z.enum([
     // ... existing ...
     'MY_NEW_ACTION',
   ]);
   ```

2. Add resource type to `AuditResourceSchema` if needed:
   ```typescript
   export const AuditResourceSchema = z.enum([
     // ... existing ...
     'my_new_resource',
   ]);
   ```

3. Update schema tests in `packages/core/src/schemas/audit.test.ts`

## 5. Action Naming Conventions

| Feature Type | Actions |
|---|---|
| CRUD handler | `{ENTITY}_CREATED`, `{ENTITY}_UPDATED`, `{ENTITY}_DELETED` |
| AI generation | `AI_GENERATION_STARTED`, `AI_GENERATION_COMPLETED`, `AI_GENERATION_FAILED` |
| AI tool call | `AI_TOOL_CALLED`, `AI_TOOL_FAILED` |
| Pipeline | `PIPELINE_STARTED`, `PIPELINE_COMPLETED`, `PIPELINE_FAILED` |
| Config change | `CONFIG_CHANGED` |
| Data export | `DATA_EXPORTED` |

## 6. Changes Field

```typescript
// CREATE: only after
changes: { after: { name, status, type } }

// UPDATE: before and after
changes: { before: { name: 'Old' }, after: { name: 'New' } }

// DELETE: only before
changes: { before: { name, status } }

// AI operations: metadata
changes: { after: { toolName, resultLength, durationMs } }
```

## 7. Hard Rules

- **Every mutation handler MUST have audit logging** — no exceptions
- **Always log failures** — emit `*_FAILED` action on errors
- **Do NOT log PII or secrets** — omit passwords, tokens, truncate large text (max 500 chars)
- **Background workers use `userId: 'system'`** — no HTTP context available
- **Use non-blocking pattern for high-frequency events** — never `await` for non-critical writes
- **Add new actions to schema BEFORE using them** — types must be valid
