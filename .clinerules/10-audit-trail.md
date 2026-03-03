# Audit Trail

> Every new feature MUST emit audit log events. This is a non-negotiable requirement.

---

## 🔒 Core Principle

**Every new handler, service, or AI feature MUST write audit log entries for all significant actions.**
Never ship a new feature without audit coverage. Audit logs are required for security compliance (FedRAMP, ISO 27001), debugging, and data access tracking.

---

## 📋 When to Write Audit Logs

Write an audit log entry for **every** action that:

- Creates, updates, or deletes a resource (CRUD)
- Triggers an AI generation (document, brief, answer)
- Invokes an AI tool (DynamoDB query, semantic search, etc.)
- Changes permissions or configuration
- Accesses sensitive data (org details, user info, contact data)
- Starts or completes a pipeline or background job
- Results in a failure or error that affects a user

---

## 🎯 Audit Actions to Use

Use existing actions from `AuditActionSchema` in `packages/core/src/schemas/audit.ts`.

**For new features, add new actions to the schema** — never use a generic action when a specific one is more accurate.

Common patterns:

| Feature Type | Actions to Emit |
|---|---|
| New CRUD handler | `{ENTITY}_CREATED`, `{ENTITY}_UPDATED`, `{ENTITY}_DELETED` |
| AI generation | `AI_GENERATION_STARTED`, `AI_GENERATION_COMPLETED`, `AI_GENERATION_FAILED` |
| AI tool call | `AI_TOOL_CALLED`, `AI_TOOL_FAILED` |
| Pipeline | `PIPELINE_STARTED`, `PIPELINE_COMPLETED`, `PIPELINE_FAILED` |
| Config change | `CONFIG_CHANGED` |
| Data export | `DATA_EXPORTED` |

---

## ✅ How to Write Audit Logs

Use `writeAuditLog()` from `apps/functions/src/helpers/audit-log.ts`:

```typescript
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { v4 as uuidv4 } from 'uuid';
import { nowIso } from '@/helpers/date';

// In a handler or service:
await writeAuditLog(
  {
    logId: uuidv4(),
    timestamp: nowIso(),
    userId: event.auth?.userId ?? 'system',
    userName: event.auth?.userName ?? 'system',
    organizationId: orgId,
    action: 'DOCUMENT_CREATED',
    resource: 'document',
    resourceId: documentId,
    changes: {
      before: undefined,
      after: { documentType, title },
    },
    ipAddress: event.requestContext?.http?.sourceIp ?? '0.0.0.0',
    userAgent: event.headers?.['user-agent'] ?? 'system',
    result: 'success',
  },
  await getHmacSecret(),
);
```

### For background workers (SQS, Step Functions)

Background workers have no HTTP context. Use `'system'` for `userId`, `userName`, `ipAddress`, and `userAgent`:

```typescript
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

### Non-blocking audit logs

For high-frequency events (e.g., AI tool calls per generation), write audit logs **non-blocking** to avoid adding latency to the critical path:

```typescript
// ✅ correct — non-blocking, errors are swallowed gracefully
writeAuditLog(payload, hmacSecret).catch(err =>
  console.warn('Failed to write audit log (non-blocking):', err.message),
);

// ❌ wrong — blocks the critical path for a non-critical operation
await writeAuditLog(payload, hmacSecret);
```

Use `await` only when the audit log is itself a critical operation (e.g., compliance-required write before a destructive action).

---

## 🏗️ Adding New Audit Actions

When a new feature requires an action not in `AuditActionSchema`:

1. **Add the action** to `AuditActionSchema` in `packages/core/src/schemas/audit.ts`:
   ```typescript
   export const AuditActionSchema = z.enum([
     // ... existing actions ...
     'MY_NEW_ACTION',  // add here
   ]);
   ```

2. **Add the resource type** to `AuditResourceSchema` if needed:
   ```typescript
   export const AuditResourceSchema = z.enum([
     // ... existing resources ...
     'my_new_resource',  // add here
   ]);
   ```

3. **Export the updated types** — `AuditAction` and `AuditResource` are inferred from the schemas, so no manual type updates needed.

4. **Update schema tests** in `packages/core/src/schemas/audit.test.ts` to cover the new action.

---

## 📊 What to Include in `changes`

The `changes` field captures the before/after state of the affected resource:

```typescript
// For CREATE operations:
changes: { after: { ...newEntityFields } }

// For UPDATE operations:
changes: { before: { ...oldFields }, after: { ...newFields } }

// For DELETE operations:
changes: { before: { ...deletedEntityFields } }

// For AI operations (no entity state change):
changes: {
  after: {
    toolName,          // which tool was called
    resultLength,      // chars returned
    resultEmpty,       // whether result was empty
    durationMs,        // execution time
  }
}
```

**Do NOT include PII or secrets** in `changes`. Sanitize inputs before logging:
- Omit passwords, tokens, API keys
- Truncate large text fields (max 500 chars)
- Omit full document HTML content

---

## 🚫 Common Mistakes

| Mistake | Correct approach |
|---|---|
| No audit log for new handler | Always add audit logging before shipping |
| Using `await` for non-critical audit writes | Use non-blocking `.catch()` pattern for high-frequency events |
| Logging PII or secrets in `changes` | Sanitize inputs — omit passwords, tokens, truncate large text |
| Using a generic action like `CONFIG_CHANGED` for a specific event | Add a specific action to the schema |
| Forgetting to add new actions to the schema | Update `AuditActionSchema` and `AuditResourceSchema` in `packages/core` |
| Not logging failures | Always emit `*_FAILED` action on errors, not just success |
| Skipping audit logs in background workers | Background workers MUST log — use `userId: 'system'` |

---

## 🔗 Related Files

- `packages/core/src/schemas/audit.ts` — Action and resource type definitions
- `apps/functions/src/helpers/audit-log.ts` — `writeAuditLog()` implementation
- `apps/functions/src/middleware/audit-middleware.ts` — Automatic audit logging for REST handlers
- `apps/functions/src/constants/audit.ts` — `AUDIT_LOG_PK`, TTL constants
- `docs/AUDIT-LOGGING-IMPLEMENTATION.md` — Full audit system design
