# Audit Logging System — Implementation Document

## 1. Overview <!-- ⏳ PENDING -->

| Property | Value |
|---|---|
| Feature | Comprehensive Audit Logging System |
| Priority | P1 — Compliance requirement |
| Estimated Hours | 8 hours |
| Domains | `audit` (new) |
| Compliance | ISO 27001, FedRAMP, internal accountability |
| Storage (hot) | DynamoDB — 90 days |
| Storage (cold) | S3 Glacier — 7 years |

**Business context**: Government contracts require complete audit trails for ISO 27001 and FedRAMP certification. Every user action, system event, and security event must be logged immutably with cryptographic integrity. Logs cannot be deleted or modified. Compliance reports must be generated on demand.

**Scope of this document**:
- Immutable audit log storage in DynamoDB (hot, 90 days) with automatic archival to S3 Glacier (cold, 7 years)
- Lambda middleware that intercepts every REST handler and writes an audit entry automatically
- Three Lambda handlers: `log-event` (internal write), `query-logs` (search/filter), `generate-report` (compliance reports)
- SQS-based async write path so audit logging never adds latency to user-facing requests
- Frontend audit log viewer with search, filter, and export
- Compliance report generation: user activity summary, access report, change history, security events, export log

**What is logged**:

| Category | Events |
|---|---|
| User Actions | Login/logout, document uploads, answer edits, proposal submissions, user management, permission changes, export operations |
| System Events | Processing pipeline stages, AI generations, integration syncs, errors and failures, performance metrics |
| Security Events | Failed login attempts, unauthorized access, permission violations, data exports, configuration changes |
## 2. Architecture Overview <!-- ⏳ PENDING -->

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Event Sources                                       │
│  REST Lambda handlers (via audit middleware)  │  System/pipeline Lambdas     │
└──────────────────────┬───────────────────────┴──────────────┬───────────────┘
                       │  async (fire-and-forget)              │
                       ▼                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                    SQS: audit-log-queue                                      │
│              (decoupled — zero latency impact on user requests)              │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│              Lambda: audit-log-writer (SQS consumer)                        │
│  1. Validate AuditLogEntry via Zod                                           │
│  2. Compute SHA-256 HMAC integrity hash                                      │
│  3. Write to DynamoDB (PK.AUDIT_LOG) — write-only, no delete/update          │
│  4. Set TTL = 90 days (hot storage expiry)                                   │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│              DynamoDB Streams → Lambda: audit-archiver                       │
│  Triggered on TTL expiry (REMOVE events)                                     │
│  Writes expired log items to S3 Glacier (7-year cold storage)                │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│              REST API: /audit domain                                         │
│  GET  query-logs       — search/filter with pagination                       │
│  POST generate-report  — compliance report generation                        │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│              Audit Middleware (applied to every REST Lambda)                 │
│  After handler returns: enqueue AuditLogEntry to SQS audit-log-queue         │
│  Captures: userId, orgId, action, resource, resourceId, result, IP, UA       │
└──────────────────────────────────────────────────────────────────────────────┘
```

| Technology | Decision | Rationale |
|---|---|---|
| Hot storage | DynamoDB single-table (`PK.AUDIT_LOG`) | Fast queries, TTL auto-expiry at 90 days |
| Cold storage | S3 Glacier Instant Retrieval | 7-year retention at ~$0.004/GB/month |
| Write path | SQS → Lambda (async) | Zero latency impact on user-facing requests |
| Archival trigger | DynamoDB Streams (TTL REMOVE events) | Automatic — no cron needed |
| Integrity | SHA-256 HMAC per log entry | Tamper detection for compliance auditors |
| Search | DynamoDB query by org+date range | Sufficient for 90-day hot window |
| Reports | Lambda on-demand generation | Compliance reports exported as JSON/CSV |
## 3. Data Models & Zod Schemas <!-- ⏳ PENDING -->

**File**: `packages/core/src/schemas/audit.ts`

```typescript
import { z } from 'zod';

// ─── Audit Action Categories ──────────────────────────────────────────────────

export const AuditActionSchema = z.enum([
  // User actions
  'USER_LOGIN',
  'USER_LOGOUT',
  'USER_LOGIN_FAILED',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_DELETED',
  'USER_ROLE_CHANGED',
  'USER_INVITED',
  // Document actions
  'DOCUMENT_UPLOADED',
  'DOCUMENT_DELETED',
  'DOCUMENT_EXPORTED',
  'DOCUMENT_VIEWED',
  // Answer actions
  'ANSWER_CREATED',
  'ANSWER_EDITED',
  'ANSWER_DELETED',
  'ANSWER_GENERATED',
  // Proposal actions
  'PROPOSAL_SUBMITTED',
  'PROPOSAL_EXPORTED',
  // Project actions
  'PROJECT_CREATED',
  'PROJECT_UPDATED',
  'PROJECT_DELETED',
  // Organization actions
  'ORG_SETTINGS_CHANGED',
  'ORG_MEMBER_ADDED',
  'ORG_MEMBER_REMOVED',
  // Permission / security actions
  'PERMISSION_DENIED',
  'UNAUTHORIZED_ACCESS',
  'API_KEY_CREATED',
  'API_KEY_DELETED',
  'PERMISSION_CHANGED',
  // System / pipeline events
  'PIPELINE_STARTED',
  'PIPELINE_COMPLETED',
  'PIPELINE_FAILED',
  'AI_GENERATION_STARTED',
  'AI_GENERATION_COMPLETED',
  'AI_GENERATION_FAILED',
  'INTEGRATION_SYNC_STARTED',
  'INTEGRATION_SYNC_COMPLETED',
  'INTEGRATION_SYNC_FAILED',
  // Export / data operations
  'DATA_EXPORTED',
  'REPORT_GENERATED',
  // Configuration
  'CONFIG_CHANGED',
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

// ─── Audit Resource Types ─────────────────────────────────────────────────────

export const AuditResourceSchema = z.enum([
  'user',
  'organization',
  'project',
  'document',
  'answer',
  'question',
  'proposal',
  'knowledge_base',
  'template',
  'api_key',
  'permission',
  'pipeline',
  'report',
  'config',
  'system',
]);
export type AuditResource = z.infer<typeof AuditResourceSchema>;

// ─── Audit Log Entry (stored in DynamoDB) ─────────────────────────────────────

export const AuditLogEntrySchema = z.object({
  logId: z.string().uuid(),
  timestamp: z.string().datetime(),
  userId: z.string().min(1),           // 'system' for automated events
  userName: z.string().min(1),         // display name or 'system'
  organizationId: z.string().min(1),   // 'global' for cross-org system events
  action: AuditActionSchema,
  resource: AuditResourceSchema,
  resourceId: z.string().min(1),       // ID of the affected entity
  changes: z.object({
    before: z.unknown().optional(),
    after: z.unknown().optional(),
  }).optional(),
  ipAddress: z.string().min(1),        // '0.0.0.0' for system events
  userAgent: z.string().min(1),        // 'system' for automated events
  result: z.enum(['success', 'failure']),
  errorMessage: z.string().optional(),
  /** SHA-256 HMAC of the log entry for tamper detection */
  integrityHash: z.string().min(1),
  /** DynamoDB TTL — Unix epoch seconds, 90 days from creation */
  ttl: z.number().int().positive(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

// ─── SQS Payload (what gets enqueued by the middleware) ───────────────────────

export const AuditLogPayloadSchema = AuditLogEntrySchema.omit({
  integrityHash: true,
  ttl: true,
});
export type AuditLogPayload = z.infer<typeof AuditLogPayloadSchema>;

// ─── Query DTOs ───────────────────────────────────────────────────────────────

export const QueryAuditLogsSchema = z.object({
  orgId: z.string().min(1),
  userId: z.string().optional(),
  action: AuditActionSchema.optional(),
  resource: AuditResourceSchema.optional(),
  resourceId: z.string().optional(),
  result: z.enum(['success', 'failure']).optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  nextToken: z.string().optional(),
});
export type QueryAuditLogs = z.infer<typeof QueryAuditLogsSchema>;

// ─── Report DTOs ──────────────────────────────────────────────────────────────

export const ReportTypeSchema = z.enum([
  'user_activity_summary',
  'access_report',
  'change_history',
  'security_events',
  'export_log',
]);
export type ReportType = z.infer<typeof ReportTypeSchema>;

export const GenerateReportSchema = z.object({
  orgId: z.string().min(1),
  reportType: ReportTypeSchema,
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
  userId: z.string().optional(),       // scope report to a specific user
  format: z.enum(['json', 'csv']).default('json'),
});
export type GenerateReport = z.infer<typeof GenerateReportSchema>;

// ─── API Response Types ───────────────────────────────────────────────────────

export const AuditLogsResponseSchema = z.object({
  items: z.array(AuditLogEntrySchema),
  count: z.number(),
  nextToken: z.string().optional(),
});
export type AuditLogsResponse = z.infer<typeof AuditLogsResponseSchema>;

export const GenerateReportResponseSchema = z.object({
  reportType: ReportTypeSchema,
  orgId: z.string(),
  fromDate: z.string(),
  toDate: z.string(),
  generatedAt: z.string(),
  format: z.enum(['json', 'csv']),
  data: z.unknown(),                   // typed per report in the handler
  rowCount: z.number(),
});
export type GenerateReportResponse = z.infer<typeof GenerateReportResponseSchema>;
```

**Export from** `packages/core/src/schemas/index.ts` — add:
```typescript
export * from './audit';
```
## 4. DynamoDB Design <!-- ⏳ PENDING -->

### PK Constants

**File**: `apps/functions/src/constants/audit.ts`

```typescript
export const PK = {
  AUDIT_LOG: 'AUDIT_LOG',
} as const;

/** 90 days hot storage in DynamoDB before archival to S3 Glacier */
export const AUDIT_LOG_TTL_DAYS = 90;

/** 7 years cold storage in S3 Glacier (FedRAMP / ISO 27001 requirement) */
export const AUDIT_LOG_COLD_RETENTION_YEARS = 7;

/** HMAC secret env var name — stored in SSM Parameter Store */
export const AUDIT_HMAC_SECRET_PARAM = '/auto-rfp/audit-hmac-secret';
```

### Access Pattern Table

| Entity | PK | SK | Notes |
|---|---|---|---|
| Audit Log Entry | `AUDIT_LOG` | `{orgId}#{timestamp}#{logId}` | Query by org: `skPrefix = "{orgId}#"`. Query by org+date range: use `begins_with` + filter. Timestamp is ISO 8601 (sorts lexicographically). |

**Design decisions**:
- SK uses ISO 8601 timestamp so lexicographic sort = chronological sort — no GSI needed for time-range queries
- `logId` appended to SK to guarantee uniqueness when two events share the same millisecond
- No `updateItem` or `deleteItem` ever called on `AUDIT_LOG` items — write-only
- TTL attribute triggers DynamoDB Streams REMOVE event → archiver Lambda → S3 Glacier

### SK Builder Functions

**File**: `apps/functions/src/helpers/audit.ts` (SK builders section)

```typescript
export const buildAuditLogSK = (
  orgId: string,
  timestamp: string,
  logId: string,
): string => `${orgId}#${timestamp}#${logId}`;

export const buildAuditLogSkPrefix = (orgId: string): string => `${orgId}#`;

export const buildAuditLogSkDatePrefix = (orgId: string, datePrefix: string): string =>
  `${orgId}#${datePrefix}`;
```

### DynamoDB Helper Functions

**File**: `apps/functions/src/helpers/audit.ts` (full)

```typescript
import { createHmac } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { nowIso } from '@/helpers/date';
import type { AuditLogEntry, AuditLogPayload, QueryAuditLogs } from '@auto-rfp/core';
import { PK, AUDIT_LOG_TTL_DAYS } from '@/constants/audit';
import { PK_NAME, SK_NAME } from '@/constants/common';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

// ─── SK Builders ──────────────────────────────────────────────────────────────

export const buildAuditLogSK = (
  orgId: string,
  timestamp: string,
  logId: string,
): string => `${orgId}#${timestamp}#${logId}`;

export const buildAuditLogSkPrefix = (orgId: string): string => `${orgId}#`;

export const buildAuditLogSkDatePrefix = (orgId: string, datePrefix: string): string =>
  `${orgId}#${datePrefix}`;

// ─── Integrity Hash ───────────────────────────────────────────────────────────

export const computeIntegrityHash = (payload: AuditLogPayload, secret: string): string => {
  const canonical = JSON.stringify({
    logId: payload.logId,
    timestamp: payload.timestamp,
    userId: payload.userId,
    organizationId: payload.organizationId,
    action: payload.action,
    resource: payload.resource,
    resourceId: payload.resourceId,
    result: payload.result,
  });
  return createHmac('sha256', secret).update(canonical).digest('hex');
};

// ─── Write (immutable — PutCommand only, no update/delete) ───────────────────

export const writeAuditLog = async (
  payload: AuditLogPayload,
  hmacSecret: string,
): Promise<AuditLogEntry> => {
  const integrityHash = computeIntegrityHash(payload, hmacSecret);
  const ttl = Math.floor(Date.now() / 1000) + AUDIT_LOG_TTL_DAYS * 86400;

  const entry: AuditLogEntry & { [PK_NAME]: string; [SK_NAME]: string } = {
    ...payload,
    integrityHash,
    ttl,
    [PK_NAME]: PK.AUDIT_LOG,
    [SK_NAME]: buildAuditLogSK(payload.organizationId, payload.timestamp, payload.logId),
  };

  // Use raw PutCommand — NOT createItem — because:
  // 1. We never want a ConditionExpression that could reject duplicate logIds
  // 2. We manage createdAt/updatedAt ourselves (timestamp field)
  await docClient.send(new PutCommand({
    TableName: DB_TABLE_NAME,
    Item: entry,
  }));

  return entry;
};

// ─── Query (read-only) ────────────────────────────────────────────────────────

export const queryAuditLogs = async (
  params: QueryAuditLogs,
): Promise<{ items: AuditLogEntry[]; nextToken?: string }> => {
  const { orgId, userId, action, resource, resourceId, result, fromDate, toDate, limit, nextToken } = params;

  // Build SK range condition
  let keyCondition = '#pk = :pk AND begins_with(#sk, :skPrefix)';
  const names: Record<string, string> = { '#pk': PK_NAME, '#sk': SK_NAME };
  const values: Record<string, string> = {
    ':pk': PK.AUDIT_LOG,
    ':skPrefix': buildAuditLogSkPrefix(orgId),
  };

  // If date range provided, use SK range instead of begins_with
  if (fromDate && toDate) {
    keyCondition = '#pk = :pk AND #sk BETWEEN :skFrom AND :skTo';
    values[':skFrom'] = buildAuditLogSkDatePrefix(orgId, fromDate);
    values[':skTo'] = buildAuditLogSkDatePrefix(orgId, toDate + '\uffff');
    delete values[':skPrefix'];
  }

  // Build filter expression for additional fields
  const filterParts: string[] = [];
  if (userId) { names['#userId'] = 'userId'; values[':userId'] = userId; filterParts.push('#userId = :userId'); }
  if (action) { names['#action'] = 'action'; values[':action'] = action; filterParts.push('#action = :action'); }
  if (resource) { names['#resource'] = 'resource'; values[':resource'] = resource; filterParts.push('#resource = :resource'); }
  if (resourceId) { names['#resourceId'] = 'resourceId'; values[':resourceId'] = resourceId; filterParts.push('#resourceId = :resourceId'); }
  if (result) { names['#result'] = 'result'; values[':result'] = result; filterParts.push('#result = :result'); }

  const exclusiveStartKey = nextToken
    ? JSON.parse(Buffer.from(nextToken, 'base64').toString('utf-8'))
    : undefined;

  const res = await docClient.send(new QueryCommand({
    TableName: DB_TABLE_NAME,
    KeyConditionExpression: keyCondition,
    FilterExpression: filterParts.length > 0 ? filterParts.join(' AND ') : undefined,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    Limit: limit,
    ScanIndexForward: false, // newest first
    ExclusiveStartKey: exclusiveStartKey,
  }));

  const newNextToken = res.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString('base64')
    : undefined;

  return {
    items: (res.Items ?? []) as AuditLogEntry[],
    nextToken: newNextToken,
  };
};
```
## 5. Backend — Lambda Handlers <!-- ⏳ PENDING -->

### File Structure

```
apps/functions/src/handlers/audit/
├── query-logs.ts              # GET  — search/filter audit logs with pagination
├── generate-report.ts         # POST — generate compliance reports
├── audit-log-writer.ts        # SQS consumer — validates + writes to DynamoDB
└── audit-archiver.ts          # DynamoDB Streams consumer — archives to S3 Glacier

apps/functions/src/middleware/
└── audit-middleware.ts        # Middy after-hook — enqueues audit event for every REST handler
```

---

### `apps/functions/src/middleware/audit-middleware.ts`

This middleware is added to every REST Lambda's Middy stack. It fires **after** the handler returns, extracts context from the event and response, and enqueues an `AuditLogPayload` to SQS asynchronously. It never throws — audit failures must not break user requests.

```typescript
import type { MiddlewareObj } from '@middy/core';
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { v4 as uuidv4 } from 'uuid';
import type { AuthedEvent } from '@/middleware/rbac-middleware';
import type { AuditAction, AuditLogPayload, AuditResource } from '@auto-rfp/core';
import { nowIso } from '@/helpers/date';

const sqs = new SQSClient({});
const AUDIT_QUEUE_URL = process.env['AUDIT_LOG_QUEUE_URL'] ?? '';

export interface AuditContext {
  action: AuditAction;
  resource: AuditResource;
  resourceId: string;
  changes?: { before?: unknown; after?: unknown };
}

/**
 * Attach audit context to the event so the middleware can pick it up.
 * Call this inside your handler before returning:
 *   setAuditContext(event, { action: 'PROJECT_CREATED', resource: 'project', resourceId: project.projectId });
 */
export const setAuditContext = (event: AuthedEvent, ctx: AuditContext): void => {
  (event as AuthedEvent & { _auditCtx?: AuditContext })._auditCtx = ctx;
};

export const auditMiddleware = (): MiddlewareObj<AuthedEvent, APIGatewayProxyResultV2> => ({
  after: async (request) => {
    if (!AUDIT_QUEUE_URL) return; // skip if queue not configured (local dev)

    try {
      const event = request.event;
      const response = request.response as APIGatewayProxyResultV2 | undefined;
      const auditCtx = (event as AuthedEvent & { _auditCtx?: AuditContext })._auditCtx;

      if (!auditCtx) return; // handler did not set audit context — skip

      const statusCode = typeof response === 'object' && response !== null && 'statusCode' in response
        ? (response as { statusCode: number }).statusCode
        : 200;

      const userId = event.auth?.userId ?? 'anonymous';
      const orgId = event.auth?.orgId
        ?? event.queryStringParameters?.orgId
        ?? 'global';

      const payload: AuditLogPayload = {
        logId: uuidv4(),
        timestamp: nowIso(),
        userId,
        userName: userId,  // enriched by audit-log-writer from DynamoDB if needed
        organizationId: orgId,
        action: auditCtx.action,
        resource: auditCtx.resource,
        resourceId: auditCtx.resourceId,
        changes: auditCtx.changes,
        ipAddress: event.requestContext?.http?.sourceIp ?? '0.0.0.0',
        userAgent: event.requestContext?.http?.userAgent ?? 'unknown',
        result: statusCode >= 400 ? 'failure' : 'success',
        errorMessage: statusCode >= 400
          ? (() => { try { return JSON.parse((response as { body: string }).body)?.message; } catch { return undefined; } })()
          : undefined,
      };

      // Fire-and-forget — never await, never throw
      sqs.send(new SendMessageCommand({
        QueueUrl: AUDIT_QUEUE_URL,
        MessageBody: JSON.stringify(payload),
      })).catch((err) => {
        console.error('[audit-middleware] Failed to enqueue audit log:', err);
      });
    } catch (err) {
      // Audit failures must never break user requests
      console.error('[audit-middleware] Unexpected error:', err);
    }
  },

  onError: async (request) => {
    if (!AUDIT_QUEUE_URL) return;

    try {
      const event = request.event;
      const auditCtx = (event as AuthedEvent & { _auditCtx?: AuditContext })._auditCtx;
      if (!auditCtx) return;

      const userId = event.auth?.userId ?? 'anonymous';
      const orgId = event.auth?.orgId ?? event.queryStringParameters?.orgId ?? 'global';

      const payload: AuditLogPayload = {
        logId: uuidv4(),
        timestamp: nowIso(),
        userId,
        userName: userId,
        organizationId: orgId,
        action: auditCtx.action,
        resource: auditCtx.resource,
        resourceId: auditCtx.resourceId,
        ipAddress: event.requestContext?.http?.sourceIp ?? '0.0.0.0',
        userAgent: event.requestContext?.http?.userAgent ?? 'unknown',
        result: 'failure',
        errorMessage: request.error instanceof Error ? request.error.message : 'Unknown error',
      };

      sqs.send(new SendMessageCommand({
        QueueUrl: AUDIT_QUEUE_URL,
        MessageBody: JSON.stringify(payload),
      })).catch(() => { /* silent */ });
    } catch {
      // never throw from audit middleware
    }
  },
});
```

**Usage in any handler** (example: `create-project.ts`):

```typescript
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  // ... parse + validate ...
  const project = await createProject(data);

  // Set audit context before returning
  setAuditContext(event, {
    action: 'PROJECT_CREATED',
    resource: 'project',
    resourceId: project.projectId,
    changes: { after: project },
  });

  return apiResponse(201, project);
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:create'))
    .use(auditMiddleware())          // ← add after requirePermission
    .use(httpErrorMiddleware()),
);
```

---

### `apps/functions/src/handlers/audit/audit-log-writer.ts`

SQS consumer — validates the payload, computes the HMAC integrity hash, and writes immutably to DynamoDB.

```typescript
import type { SQSHandler } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { v4 as uuidv4 } from 'uuid';
import { AuditLogPayloadSchema } from '@auto-rfp/core';
import { writeAuditLog } from '@/helpers/audit';
import { requireEnv } from '@/helpers/env';
import { AUDIT_HMAC_SECRET_PARAM } from '@/constants/audit';

const ssm = new SSMClient({});
const REGION = requireEnv('REGION', 'us-east-1');

let cachedHmacSecret: string | null = null;

const getHmacSecret = async (): Promise<string> => {
  if (cachedHmacSecret) return cachedHmacSecret;
  const res = await ssm.send(new GetParameterCommand({
    Name: AUDIT_HMAC_SECRET_PARAM,
    WithDecryption: true,
  }));
  cachedHmacSecret = res.Parameter?.Value ?? '';
  return cachedHmacSecret;
};

export const handler: SQSHandler = async (event) => {
  const hmacSecret = await getHmacSecret();

  for (const record of event.Records) {
    try {
      const raw = JSON.parse(record.body) as unknown;
      const { success, data, error } = AuditLogPayloadSchema.safeParse(raw);

      if (!success) {
        console.error('[audit-log-writer] Invalid payload:', error.issues);
        // Do NOT throw — invalid messages go to DLQ after maxReceiveCount
        continue;
      }

      await writeAuditLog(data, hmacSecret);
    } catch (err) {
      console.error('[audit-log-writer] Failed to write audit log:', err);
      throw err; // rethrow so SQS retries this record
    }
  }
};
```

---

### `apps/functions/src/handlers/audit/audit-archiver.ts`

DynamoDB Streams consumer — triggered when TTL expires a log entry. Archives the item to S3 Glacier.

```typescript
import type { DynamoDBStreamHandler } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { requireEnv } from '@/helpers/env';
import { PK } from '@/constants/audit';
import { PK_NAME } from '@/constants/common';

const s3 = new S3Client({});
const AUDIT_ARCHIVE_BUCKET = requireEnv('AUDIT_ARCHIVE_BUCKET');

export const handler: DynamoDBStreamHandler = async (event) => {
  for (const record of event.Records) {
    // Only process TTL-triggered REMOVE events for AUDIT_LOG items
    if (record.eventName !== 'REMOVE') continue;
    if (!record.dynamodb?.OldImage) continue;

    const item = unmarshall(record.dynamodb.OldImage as Parameters<typeof unmarshall>[0]);
    if (item[PK_NAME] !== PK.AUDIT_LOG) continue;

    try {
      const { organizationId, timestamp, logId } = item as {
        organizationId: string;
        timestamp: string;
        logId: string;
      };

      // Archive path: audit-logs/{orgId}/{year}/{month}/{day}/{logId}.json
      const date = new Date(timestamp);
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      const key = `audit-logs/${organizationId}/${year}/${month}/${day}/${logId}.json`;

      await s3.send(new PutObjectCommand({
        Bucket: AUDIT_ARCHIVE_BUCKET,
        Key: key,
        Body: JSON.stringify(item),
        ContentType: 'application/json',
        StorageClass: 'GLACIER_IR', // Glacier Instant Retrieval
      }));

      console.log(`[audit-archiver] Archived ${logId} to s3://${AUDIT_ARCHIVE_BUCKET}/${key}`);
    } catch (err) {
      console.error('[audit-archiver] Failed to archive item:', err, item);
      throw err; // rethrow to retry
    }
  }
};
```

---

### `apps/functions/src/handlers/audit/query-logs.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { QueryAuditLogsSchema } from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { queryAuditLogs } from '@/helpers/audit';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const raw = event.queryStringParameters ?? {};
  const { success, data, error } = QueryAuditLogsSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Invalid query parameters', issues: error.issues });

  const { items, nextToken } = await queryAuditLogs(data);

  return apiResponse(200, { items, count: items.length, nextToken });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('audit:read'))
    .use(httpErrorMiddleware()),
);
```

---

### `apps/functions/src/handlers/audit/generate-report.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { GenerateReportSchema } from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { queryAuditLogs } from '@/helpers/audit';
import { nowIso } from '@/helpers/date';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import type { AuditLogEntry } from '@auto-rfp/core';

// ─── Report builders ──────────────────────────────────────────────────────────

const buildUserActivitySummary = (logs: AuditLogEntry[]) => {
  const byUser: Record<string, { userId: string; userName: string; actionCount: number; lastSeen: string }> = {};
  for (const log of logs) {
    const existing = byUser[log.userId];
    if (!existing) {
      byUser[log.userId] = { userId: log.userId, userName: log.userName, actionCount: 1, lastSeen: log.timestamp };
    } else {
      existing.actionCount++;
      if (log.timestamp > existing.lastSeen) existing.lastSeen = log.timestamp;
    }
  }
  return Object.values(byUser).sort((a, b) => b.actionCount - a.actionCount);
};

const buildAccessReport = (logs: AuditLogEntry[]) =>
  logs.filter((l) => ['USER_LOGIN', 'USER_LOGOUT', 'USER_LOGIN_FAILED', 'PERMISSION_DENIED', 'UNAUTHORIZED_ACCESS'].includes(l.action));

const buildChangeHistory = (logs: AuditLogEntry[]) =>
  logs.filter((l) => l.changes !== undefined);

const buildSecurityEvents = (logs: AuditLogEntry[]) =>
  logs.filter((l) => ['USER_LOGIN_FAILED', 'PERMISSION_DENIED', 'UNAUTHORIZED_ACCESS', 'API_KEY_CREATED', 'API_KEY_DELETED', 'PERMISSION_CHANGED', 'CONFIG_CHANGED'].includes(l.action));

const buildExportLog = (logs: AuditLogEntry[]) =>
  logs.filter((l) => ['DATA_EXPORTED', 'DOCUMENT_EXPORTED', 'PROPOSAL_EXPORTED', 'REPORT_GENERATED'].includes(l.action));

const toCsv = (rows: AuditLogEntry[]): string => {
  if (rows.length === 0) return '';
  const headers = ['logId', 'timestamp', 'userId', 'userName', 'organizationId', 'action', 'resource', 'resourceId', 'result', 'ipAddress', 'userAgent', 'errorMessage'];
  const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => escape(r[h as keyof AuditLogEntry])).join(',')),
  ].join('\n');
};

// ─── Handler ──────────────────────────────────────────────────────────────────

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const raw = JSON.parse(event.body ?? '{}') as unknown;
  const { success, data, error } = GenerateReportSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Invalid payload', issues: error.issues });

  // Fetch all logs in the date range (paginate internally)
  const allLogs: AuditLogEntry[] = [];
  let nextToken: string | undefined;
  do {
    const result = await queryAuditLogs({
      orgId: data.orgId,
      userId: data.userId,
      fromDate: data.fromDate,
      toDate: data.toDate,
      limit: 200,
      nextToken,
    });
    allLogs.push(...result.items);
    nextToken = result.nextToken;
  } while (nextToken);

  let reportData: unknown;
  switch (data.reportType) {
    case 'user_activity_summary': reportData = buildUserActivitySummary(allLogs); break;
    case 'access_report':         reportData = buildAccessReport(allLogs); break;
    case 'change_history':        reportData = buildChangeHistory(allLogs); break;
    case 'security_events':       reportData = buildSecurityEvents(allLogs); break;
    case 'export_log':            reportData = buildExportLog(allLogs); break;
  }

  const rowCount = Array.isArray(reportData) ? reportData.length : 0;

  if (data.format === 'csv') {
    const csvData = toCsv(Array.isArray(reportData) ? reportData as AuditLogEntry[] : allLogs);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="audit-report-${data.reportType}-${data.fromDate.slice(0, 10)}.csv"`,
        'Access-Control-Allow-Origin': '*',
      },
      body: csvData,
    };
  }

  return apiResponse(200, {
    reportType: data.reportType,
    orgId: data.orgId,
    fromDate: data.fromDate,
    toDate: data.toDate,
    generatedAt: nowIso(),
    format: data.format,
    data: reportData,
    rowCount,
  });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('audit:report'))
    .use(httpErrorMiddleware()),
);
```
## 6. REST API Routes <!-- ⏳ PENDING -->

**File**: `packages/infra/api/routes/audit.routes.ts`

```typescript
import { lambdaEntry } from './route-helper';
import type { DomainRoutes } from './types';

export const auditDomain = (): DomainRoutes => ({
  basePath: 'audit',
  routes: [
    {
      method: 'GET',
      path: 'logs',
      entry: lambdaEntry('audit/query-logs.ts'),
    },
    {
      method: 'POST',
      path: 'report',
      entry: lambdaEntry('audit/generate-report.ts'),
      timeoutSeconds: 60, // report generation may paginate many log pages
      memorySize: 512,
    },
  ],
});
```

**Register in** `packages/infra/api/api-orchestrator-stack.ts`:

```typescript
// Add import:
import { auditDomain } from './routes/audit.routes';

// Add to allDomains array (after notificationDomain):
auditDomain(),

// Add to domainStackNames array (same index):
'AuditRoutes',
```

### Endpoint Summary

| Method | Path | Description | Permission |
|---|---|---|---|
| `GET` | `/audit/logs` | Query audit logs with filters + pagination | `audit:read` |
| `POST` | `/audit/report` | Generate compliance report (JSON or CSV) | `audit:report` |

---

## 7. CDK Infrastructure <!-- ⏳ PENDING -->

### New Stack: `AuditStack`

**File**: `packages/infra/audit-stack.ts`

```typescript
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as path from 'path';
import * as crypto from 'crypto';

export interface AuditStackProps extends cdk.StackProps {
  stage: string;
  mainTable: dynamodb.ITable;
  commonLambdaRoleArn: string;
  commonEnv: Record<string, string>;
}

export class AuditStack extends cdk.Stack {
  public readonly auditQueueName: string;
  public readonly auditArchiveBucketName: string;

  constructor(scope: Construct, id: string, props: AuditStackProps) {
    super(scope, id, props);

    const { stage, mainTable, commonLambdaRoleArn, commonEnv } = props;
    const isProd = stage.toLowerCase() === 'prod';

    const lambdaRole = iam.Role.fromRoleArn(this, 'SharedLambdaRole', commonLambdaRoleArn);

    const bundling = {
      minify: true,
      sourceMap: true,
      externalModules: ['@aws-sdk/*'],
    };

    // ── SSM: HMAC secret for log integrity ────────────────────────────────────
    // Generate a random secret and store it in SSM Parameter Store.
    // In production, rotate this via a separate process.
    const hmacSecret = new ssm.StringParameter(this, 'AuditHmacSecret', {
      parameterName: '/auto-rfp/audit-hmac-secret',
      stringValue: crypto.randomBytes(32).toString('hex'),
      description: 'HMAC secret for audit log integrity hashing',
      tier: ssm.ParameterTier.STANDARD,
    });

    // Grant Lambda role access to read the HMAC secret
    lambdaRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [hmacSecret.parameterArn],
    }));

    // ── S3: Audit Archive Bucket (Glacier cold storage) ───────────────────────
    const auditArchiveBucket = new s3.Bucket(this, 'AuditArchiveBucket', {
      bucketName: `auto-rfp-audit-archive-${stage.toLowerCase()}-${cdk.Aws.ACCOUNT_ID}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
      lifecycleRules: [
        {
          id: 'glacier-transition',
          // Objects are written directly as GLACIER_IR by the archiver Lambda.
          // This lifecycle rule transitions any STANDARD objects after 1 day
          // as a safety net, and expires objects after 7 years.
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL,
              transitionAfter: cdk.Duration.days(1),
            },
          ],
          expiration: cdk.Duration.days(365 * 7), // 7-year retention
        },
      ],
    });

    this.auditArchiveBucketName = auditArchiveBucket.bucketName;

    // Grant Lambda role write access to the archive bucket
    auditArchiveBucket.grantWrite(lambdaRole);

    // ── SQS: Audit Log Queue ──────────────────────────────────────────────────
    const auditLogDlq = new sqs.Queue(this, 'AuditLogDLQ', {
      queueName: `auto-rfp-audit-log-dlq-${stage.toLowerCase()}`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    const auditLogQueue = new sqs.Queue(this, 'AuditLogQueue', {
      queueName: `auto-rfp-audit-log-${stage.toLowerCase()}`,
      visibilityTimeout: cdk.Duration.seconds(30),
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        queue: auditLogDlq,
        maxReceiveCount: 3,
      },
    });

    this.auditQueueName = auditLogQueue.queueName;

    // Grant Lambda role send + consume permissions
    lambdaRole.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'AuditQueueAccess',
      actions: ['sqs:SendMessage', 'sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'],
      resources: [auditLogQueue.queueArn],
    }));

    const auditQueueUrl = `https://sqs.${cdk.Aws.REGION}.amazonaws.com/${cdk.Aws.ACCOUNT_ID}/${auditLogQueue.queueName}`;

    // ── Lambda: audit-log-writer (SQS consumer) ───────────────────────────────
    const auditLogWriter = new lambdaNodejs.NodejsFunction(this, 'AuditLogWriter', {
      functionName: `auto-rfp-audit-log-writer-${stage}`,
      entry: path.join(__dirname, '../../apps/functions/src/handlers/audit/audit-log-writer.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      role: lambdaRole,
      environment: {
        ...commonEnv,
        AUDIT_LOG_QUEUE_URL: auditQueueUrl,
      },
      bundling,
    });

    new logs.LogGroup(this, 'AuditLogWriterLogs', {
      logGroupName: `/aws/lambda/${auditLogWriter.functionName}`,
      retention: isProd ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    auditLogWriter.addEventSource(
      new lambdaEventSources.SqsEventSource(auditLogQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      }),
    );

    // ── Lambda: audit-archiver (DynamoDB Streams consumer) ────────────────────
    const auditArchiver = new lambdaNodejs.NodejsFunction(this, 'AuditArchiver', {
      functionName: `auto-rfp-audit-archiver-${stage}`,
      entry: path.join(__dirname, '../../apps/functions/src/handlers/audit/audit-archiver.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      role: lambdaRole,
      environment: {
        ...commonEnv,
        AUDIT_ARCHIVE_BUCKET: auditArchiveBucket.bucketName,
      },
      bundling,
    });

    new logs.LogGroup(this, 'AuditArchiverLogs', {
      logGroupName: `/aws/lambda/${auditArchiver.functionName}`,
      retention: isProd ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Attach DynamoDB Streams as event source — filters to REMOVE events only
    auditArchiver.addEventSource(
      new lambdaEventSources.DynamoEventSource(mainTable as dynamodb.Table, {
        startingPosition: lambda.StartingPosition.TRIM_HORIZON,
        batchSize: 100,
        bisectBatchOnError: true,
        retryAttempts: 3,
        filters: [
          lambda.FilterCriteria.filter({
            eventName: lambda.FilterRule.isEqual('REMOVE'),
          }),
        ],
      }),
    );

    // Grant Lambda role DynamoDB Streams read access
    lambdaRole.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'DynamoStreamsRead',
      actions: [
        'dynamodb:GetRecords',
        'dynamodb:GetShardIterator',
        'dynamodb:DescribeStream',
        'dynamodb:ListStreams',
      ],
      resources: [`${mainTable.tableArn}/stream/*`],
    }));

    // ── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'AuditLogQueueUrl', {
      value: auditQueueUrl,
      description: 'SQS queue URL for audit log events',
    });

    new cdk.CfnOutput(this, 'AuditArchiveBucketName', {
      value: auditArchiveBucket.bucketName,
      description: 'S3 bucket for long-term audit log archival (Glacier)',
    });
  }
}
```

### Register in `packages/infra/bin/auto-rfp-infrastructure.ts`

```typescript
// Add import:
import { AuditStack } from '../audit-stack';

// After the collaborationWsStack instantiation:
const auditStack = new AuditStack(app, `AutoRfp-Audit-${stage}`, {
  env,
  stage,
  mainTable: db.tableName,
  commonLambdaRoleArn: api.commonLambdaRoleArn,
  commonEnv: {
    STAGE: stage,
    DB_TABLE_NAME: db.tableName.tableName,
    REGION: env.region ?? 'us-east-1',
    SENTRY_DSN: sentryDNS,
    SENTRY_ENVIRONMENT: stage,
    NODE_ENV: 'production',
  },
});

auditStack.addDependency(db);
auditStack.addDependency(api);
```

### Add `AUDIT_LOG_QUEUE_URL` to `commonEnv` in `api-orchestrator-stack.ts`

The audit middleware in every REST Lambda needs the queue URL. Add it to `commonEnv`:

```typescript
// In ApiOrchestratorStackProps, add:
auditLogQueueName?: string;

// In commonEnv construction, add:
...(auditLogQueueName ? {
  AUDIT_LOG_QUEUE_URL: `https://sqs.${cdk.Aws.REGION}.amazonaws.com/${cdk.Aws.ACCOUNT_ID}/${auditLogQueueName}`,
} : {}),
```

Then pass `auditLogQueueName: \`auto-rfp-audit-log-${stage.toLowerCase()}\`` from `bin/auto-rfp-infrastructure.ts`.

Also grant the shared Lambda role permission to send to the audit queue:

```typescript
if (auditLogQueueName) {
  sharedInfraStack.commonLambdaRole.addToPrincipalPolicy(
    new iam.PolicyStatement({
      sid: 'AuditQueueSend',
      actions: ['sqs:SendMessage'],
      resources: [
        `arn:aws:sqs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:${auditLogQueueName}`,
      ],
    }),
  );
}
```

### CDK Infrastructure Summary

| Resource | Type | Purpose |
|---|---|---|
| `auto-rfp-audit-log-{stage}` | SQS Queue | Async write buffer for audit events |
| `auto-rfp-audit-log-dlq-{stage}` | SQS DLQ | Failed audit writes (3 retries) |
| `auto-rfp-audit-log-writer-{stage}` | Lambda | SQS consumer — validates + writes to DynamoDB |
| `auto-rfp-audit-archiver-{stage}` | Lambda | DynamoDB Streams consumer — archives to S3 Glacier |
| `auto-rfp-audit-archive-{stage}-{account}` | S3 Bucket | Long-term cold storage (Glacier IR, 7-year lifecycle) |
| `/auto-rfp/audit-hmac-secret` | SSM SecureString | HMAC secret for log integrity hashing |
| `/aws/lambda/auto-rfp-audit-log-writer-{stage}` | CloudWatch Log Group | Writer logs (2 weeks non-prod, INFINITE prod) |
| `/aws/lambda/auto-rfp-audit-archiver-{stage}` | CloudWatch Log Group | Archiver logs (2 weeks non-prod, INFINITE prod) |
## 8. Frontend — Hooks & Components <!-- ⏳ PENDING -->

### File Structure

```
apps/web/features/audit/
├── hooks/
│   ├── useAuditLogs.ts          # SWR hook — paginated log query with filters
│   └── useAuditReport.ts        # Mutation hook — generate compliance report
├── components/
│   ├── AuditLogTable.tsx         # Paginated table of log entries
│   ├── AuditLogFilters.tsx       # Filter bar: user, action, resource, date range
│   ├── AuditLogRow.tsx           # Single log row with expandable changes diff
│   ├── AuditReportForm.tsx       # Report generation form
│   └── AuditLogTableSkeleton.tsx # Loading skeleton for the table
└── index.ts                      # Barrel export
```

---

### `hooks/useAuditLogs.ts`

```typescript
'use client';

import useSWR from 'swr';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import type { AuditLogsResponse } from '@auto-rfp/core';

const BASE = `${env.BASE_API_URL}/audit`;

export interface AuditLogFilters {
  orgId: string;
  userId?: string;
  action?: string;
  resource?: string;
  result?: 'success' | 'failure';
  fromDate?: string;
  toDate?: string;
  limit?: number;
  nextToken?: string;
}

export const useAuditLogs = (filters: AuditLogFilters | null) => {
  const key = filters
    ? (() => {
        const params = new URLSearchParams();
        Object.entries(filters).forEach(([k, v]) => {
          if (v !== undefined && v !== '') params.set(k, String(v));
        });
        return `${BASE}/logs?${params.toString()}`;
      })()
    : null;

  const { data, error, isLoading, mutate } = useSWR<AuditLogsResponse>(
    key,
    async (url: string) => {
      const res = await authFetcher(url);
      if (!res.ok) throw new Error('Failed to fetch audit logs');
      return res.json();
    },
    { revalidateOnFocus: false },
  );

  return {
    logs: data?.items ?? [],
    count: data?.count ?? 0,
    nextToken: data?.nextToken,
    isLoading,
    isError: !!error,
    mutate,
  };
};
```

---

### `hooks/useAuditReport.ts`

```typescript
'use client';

import useSWRMutation from 'swr/mutation';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import type { GenerateReport, GenerateReportResponse } from '@auto-rfp/core';

const BASE = `${env.BASE_API_URL}/audit`;

export const useAuditReport = () => {
  return useSWRMutation(
    `${BASE}/report`,
    async (url: string, { arg }: { arg: GenerateReport }): Promise<GenerateReportResponse | string> => {
      const res = await authFetcher(url, {
        method: 'POST',
        body: JSON.stringify(arg),
      });
      if (!res.ok) throw new Error('Failed to generate report');
      if (arg.format === 'csv') {
        // Return raw CSV text for download
        return res.text();
      }
      return res.json() as Promise<GenerateReportResponse>;
    },
  );
};
```

---

### `components/AuditLogFilters.tsx`

```typescript
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AuditActionSchema, AuditResourceSchema } from '@auto-rfp/core';
import type { AuditLogFilters } from '../hooks/useAuditLogs';

const FiltersSchema = z.object({
  userId: z.string().optional(),
  action: z.string().optional(),
  resource: z.string().optional(),
  result: z.enum(['success', 'failure', '']).optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

type FiltersForm = z.input<typeof FiltersSchema>;

interface AuditLogFiltersProps {
  orgId: string;
  onFilter: (filters: AuditLogFilters) => void;
}

export const AuditLogFilters = ({ orgId, onFilter }: AuditLogFiltersProps) => {
  const { register, handleSubmit, setValue, reset } = useForm<FiltersForm>({
    resolver: zodResolver(FiltersSchema),
  });

  const onSubmit = (values: FiltersForm) => {
    onFilter({
      orgId,
      userId: values.userId || undefined,
      action: values.action || undefined,
      resource: values.resource || undefined,
      result: (values.result as 'success' | 'failure') || undefined,
      fromDate: values.fromDate || undefined,
      toDate: values.toDate || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-wrap gap-3 items-end">
      <Input placeholder="User ID" {...register('userId')} className="w-48" />
      <Select onValueChange={(v) => setValue('action', v)}>
        <SelectTrigger className="w-52">
          <SelectValue placeholder="Action" />
        </SelectTrigger>
        <SelectContent>
          {AuditActionSchema.options.map((a) => (
            <SelectItem key={a} value={a}>{a}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select onValueChange={(v) => setValue('resource', v)}>
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Resource" />
        </SelectTrigger>
        <SelectContent>
          {AuditResourceSchema.options.map((r) => (
            <SelectItem key={r} value={r}>{r}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select onValueChange={(v) => setValue('result', v as 'success' | 'failure')}>
        <SelectTrigger className="w-36">
          <SelectValue placeholder="Result" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="success">Success</SelectItem>
          <SelectItem value="failure">Failure</SelectItem>
        </SelectContent>
      </Select>
      <Input type="datetime-local" {...register('fromDate')} className="w-52" />
      <Input type="datetime-local" {...register('toDate')} className="w-52" />
      <Button type="submit" variant="default">Filter</Button>
      <Button type="button" variant="outline" onClick={() => { reset(); onFilter({ orgId }); }}>Clear</Button>
    </form>
  );
};
```

---

### `components/AuditLogTableSkeleton.tsx`

```typescript
import { Skeleton } from '@/components/ui/skeleton';

export const AuditLogTableSkeleton = () => (
  <div className="space-y-2">
    {Array.from({ length: 10 }).map((_, i) => (
      <div key={i} className="flex gap-4 items-center px-4 py-3 border rounded-md">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
    ))}
  </div>
);
```

---

### `components/AuditLogRow.tsx`

```typescript
'use client';

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AuditLogEntry } from '@auto-rfp/core';

interface AuditLogRowProps {
  entry: AuditLogEntry;
}

export const AuditLogRow = ({ entry }: AuditLogRowProps) => {
  const [expanded, setExpanded] = useState(false);
  const hasChanges = !!entry.changes;

  return (
    <>
      <tr className={cn('border-b hover:bg-slate-50 transition-colors', entry.result === 'failure' && 'bg-red-50/40')}>
        <td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">
          {new Date(entry.timestamp).toLocaleString()}
        </td>
        <td className="px-4 py-2 text-xs font-mono truncate max-w-[120px]" title={entry.userId}>
          {entry.userName}
        </td>
        <td className="px-4 py-2">
          <span className="text-xs font-medium bg-slate-100 px-2 py-0.5 rounded">{entry.action}</span>
        </td>
        <td className="px-4 py-2 text-xs text-slate-600">{entry.resource}</td>
        <td className="px-4 py-2 text-xs font-mono truncate max-w-[100px]" title={entry.resourceId}>
          {entry.resourceId}
        </td>
        <td className="px-4 py-2">
          <Badge variant={entry.result === 'success' ? 'default' : 'destructive'} className="text-xs">
            {entry.result}
          </Badge>
        </td>
        <td className="px-4 py-2 text-xs text-slate-400">{entry.ipAddress}</td>
        <td className="px-4 py-2">
          {hasChanges && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setExpanded((v) => !v)}>
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </Button>
          )}
        </td>
      </tr>
      {expanded && hasChanges && (
        <tr className="bg-slate-50">
          <td colSpan={8} className="px-6 py-3">
            <div className="grid grid-cols-2 gap-4 text-xs">
              {entry.changes?.before !== undefined && (
                <div>
                  <p className="font-semibold text-slate-500 mb-1">Before</p>
                  <pre className="bg-white border rounded p-2 overflow-auto max-h-40 text-slate-700">
                    {JSON.stringify(entry.changes.before, null, 2)}
                  </pre>
                </div>
              )}
              {entry.changes?.after !== undefined && (
                <div>
                  <p className="font-semibold text-slate-500 mb-1">After</p>
                  <pre className="bg-white border rounded p-2 overflow-auto max-h-40 text-slate-700">
                    {JSON.stringify(entry.changes.after, null, 2)}
                  </pre>
                </div>
              )}
            </div>
            {entry.errorMessage && (
              <p className="mt-2 text-xs text-red-600">Error: {entry.errorMessage}</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
};
```

---

### `components/AuditLogTable.tsx`

```typescript
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { AuditLogRow } from './AuditLogRow';
import { AuditLogFilters } from './AuditLogFilters';
import { AuditLogTableSkeleton } from './AuditLogTableSkeleton';
import { useAuditLogs } from '../hooks/useAuditLogs';
import type { AuditLogFilters as Filters } from '../hooks/useAuditLogs';

interface AuditLogTableProps {
  orgId: string;
}

export const AuditLogTable = ({ orgId }: AuditLogTableProps) => {
  const [filters, setFilters] = useState<Filters>({ orgId });
  const { logs, count, nextToken, isLoading } = useAuditLogs(filters);

  return (
    <div className="space-y-4">
      <AuditLogFilters orgId={orgId} onFilter={setFilters} />

      {isLoading ? (
        <AuditLogTableSkeleton />
      ) : logs.length === 0 ? (
        <div className="flex items-center justify-center h-32 text-sm text-slate-500 border rounded-md">
          No audit logs found for the selected filters.
        </div>
      ) : (
        <>
          <div className="text-xs text-slate-500">{count} entries</div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  {['Timestamp', 'User', 'Action', 'Resource', 'Resource ID', 'Result', 'IP Address', ''].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-medium text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map((entry) => (
                  <AuditLogRow key={entry.logId} entry={entry} />
                ))}
              </tbody>
            </table>
          </div>
          {nextToken && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFilters((f) => ({ ...f, nextToken }))}
              >
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
```

---

### `components/AuditReportForm.tsx`

```typescript
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { GenerateReportSchema, ReportTypeSchema } from '@auto-rfp/core';
import type { GenerateReport } from '@auto-rfp/core';
import { useAuditReport } from '../hooks/useAuditReport';

interface AuditReportFormProps {
  orgId: string;
}

export const AuditReportForm = ({ orgId }: AuditReportFormProps) => {
  const { trigger, isMutating } = useAuditReport();
  const { register, handleSubmit, setValue } = useForm<GenerateReport>({
    resolver: zodResolver(GenerateReportSchema),
    defaultValues: { orgId, format: 'json' },
  });

  const onSubmit = async (data: GenerateReport) => {
    const result = await trigger(data);
    if (data.format === 'csv' && typeof result === 'string') {
      // Trigger browser download
      const blob = new Blob([result], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-report-${data.reportType}-${data.fromDate.slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 max-w-lg">
      <input type="hidden" {...register('orgId')} />

      <Select onValueChange={(v) => setValue('reportType', v as GenerateReport['reportType'])}>
        <SelectTrigger>
          <SelectValue placeholder="Report type" />
        </SelectTrigger>
        <SelectContent>
          {ReportTypeSchema.options.map((t) => (
            <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-500 mb-1 block">From</label>
          <Input type="datetime-local" {...register('fromDate')} />
        </div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">To</label>
          <Input type="datetime-local" {...register('toDate')} />
        </div>
      </div>

      <Select onValueChange={(v) => setValue('format', v as 'json' | 'csv')} defaultValue="json">
        <SelectTrigger>
          <SelectValue placeholder="Format" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="json">JSON</SelectItem>
          <SelectItem value="csv">CSV (download)</SelectItem>
        </SelectContent>
      </Select>

      <Button type="submit" disabled={isMutating}>
        {isMutating ? 'Generating…' : 'Generate Report'}
      </Button>
    </form>
  );
};
```

---

### `index.ts` (barrel export)

```typescript
export { AuditLogTable } from './components/AuditLogTable';
export { AuditLogFilters } from './components/AuditLogFilters';
export { AuditLogRow } from './components/AuditLogRow';
export { AuditLogTableSkeleton } from './components/AuditLogTableSkeleton';
export { AuditReportForm } from './components/AuditReportForm';
export { useAuditLogs } from './hooks/useAuditLogs';
export { useAuditReport } from './hooks/useAuditReport';
```

---

### Page: `app/(dashboard)/audit/page.tsx`

```typescript
import { Suspense } from 'react';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';
import { AuditLogTable } from '@/features/audit';
import { AuditReportForm } from '@/features/audit';

export const metadata = { title: 'Audit Logs' };

export default function AuditPage() {
  return (
    <div className="space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit Logs</h1>
        <p className="text-sm text-slate-500 mt-1">
          Immutable record of all user actions, system events, and security events.
        </p>
      </div>

      <section>
        <h2 className="text-lg font-medium mb-4">Log Viewer</h2>
        <Suspense fallback={<PageLoadingSkeleton variant="list" />}>
          {/* orgId injected from server context / layout */}
          <AuditLogTable orgId="__ORG_ID_FROM_CONTEXT__" />
        </Suspense>
      </section>

      <section>
        <h2 className="text-lg font-medium mb-4">Compliance Reports</h2>
        <AuditReportForm orgId="__ORG_ID_FROM_CONTEXT__" />
      </section>
    </div>
  );
}
```

### `app/(dashboard)/audit/loading.tsx`

```typescript
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';

export default function AuditLoading() {
  return <PageLoadingSkeleton variant="list" />;
}
```
## 9. Permissions & RBAC <!-- ⏳ PENDING -->

### New Permissions

Add to `packages/core/src/schemas/user.ts`:

```typescript
// Add to ALL_PERMISSIONS array:
'audit:read',    // view audit logs — ADMIN only
'audit:report',  // generate compliance reports — ADMIN only
```

### Role Matrix

| Permission | ADMIN | EDITOR | VIEWER | BILLING |
|---|---|---|---|---|
| `audit:read` | ✅ | ❌ | ❌ | ❌ |
| `audit:report` | ✅ | ❌ | ❌ | ❌ |

**Rationale**: Audit logs contain sensitive security and user activity data. Only ADMIN role should have access. This aligns with ISO 27001 requirement that audit log access is restricted to authorized personnel.

Add to `ROLE_PERMISSIONS` in `user.ts`:
```typescript
ADMIN: [
  ...ALL_PERMISSIONS,  // already includes audit:read and audit:report
],
// EDITOR, VIEWER, BILLING: do NOT add audit permissions
```

---

## 10. Implementation Tickets <!-- ⏳ PENDING -->

> Each ticket is independently implementable. Follow the order — each step depends on the previous.

---

### AL-1 · Core Schemas (30 min) <!-- ⏳ PENDING -->

**Goal**: Define all Zod schemas and inferred types for the audit domain.

**Files to create**:
- `packages/core/src/schemas/audit.ts` — full schema file from Section 3

**Files to modify**:
- `packages/core/src/schemas/index.ts` — add `export * from './audit'`

**Acceptance**:
- [ ] All schemas exported: `AuditActionSchema`, `AuditResourceSchema`, `AuditLogEntrySchema`, `AuditLogPayloadSchema`, `QueryAuditLogsSchema`, `ReportTypeSchema`, `GenerateReportSchema`, `AuditLogsResponseSchema`, `GenerateReportResponseSchema`
- [ ] `cd packages/core && pnpm tsc --noEmit` passes

---

### AL-2 · Permissions (15 min) <!-- ⏳ PENDING -->

**Goal**: Add `audit:read` and `audit:report` to the RBAC system.

**Files to modify**:
- `packages/core/src/schemas/user.ts`:
  - Add `'audit:read'` and `'audit:report'` to `ALL_PERMISSIONS`
  - Both permissions granted to `ADMIN` role only

**Acceptance**:
- [ ] `audit:read` and `audit:report` present in `ALL_PERMISSIONS`
- [ ] Both permissions granted to ADMIN only — not EDITOR, VIEWER, or BILLING
- [ ] `cd packages/core && pnpm tsc --noEmit` passes

---

### AL-3 · DynamoDB Constants & Helpers (45 min) <!-- ⏳ PENDING -->

**Goal**: Create PK constants and all DynamoDB helper functions for the audit domain.

**Files to create**:
- `apps/functions/src/constants/audit.ts` — PK constants, TTL values, HMAC param name (Section 4)
- `apps/functions/src/helpers/audit.ts` — SK builders, `computeIntegrityHash`, `writeAuditLog`, `queryAuditLogs` (Section 4)

**Rules to verify**:
- [ ] `writeAuditLog` uses raw `PutCommand` — NOT `createItem` (no ConditionExpression)
- [ ] `writeAuditLog` never calls `updateItem` or `deleteItem`
- [ ] `queryAuditLogs` supports date-range SK query (`BETWEEN`) and filter expressions
- [ ] `cd apps/functions && pnpm tsc --noEmit` passes

---

### AL-4 · Audit Middleware (30 min) <!-- ⏳ PENDING -->

**Goal**: Implement the Middy `after`/`onError` middleware that enqueues audit events.

**Files to create**:
- `apps/functions/src/middleware/audit-middleware.ts` — full middleware from Section 5

**Rules to verify**:
- [ ] Middleware never throws — all errors caught and logged
- [ ] Uses fire-and-forget SQS send (no `await`)
- [ ] `setAuditContext` helper exported for use in handlers
- [ ] Skips gracefully when `AUDIT_LOG_QUEUE_URL` is not set (local dev)
- [ ] `cd apps/functions && pnpm tsc --noEmit` passes

**Wire into 5 key handlers** (add `auditMiddleware()` + `setAuditContext` call):
- `create-project.ts` → `PROJECT_CREATED`
- `delete-project.ts` → `PROJECT_DELETED`
- `handlers/user/create-user.ts` → `USER_CREATED`
- `handlers/user/delete-user.ts` → `USER_DELETED`
- `handlers/document/upload-document.ts` → `DOCUMENT_UPLOADED`

---

### AL-5 · SQS Consumer: audit-log-writer (30 min) <!-- ⏳ PENDING -->

**Goal**: Implement the SQS consumer that validates and writes audit logs to DynamoDB.

**Files to create**:
- `apps/functions/src/handlers/audit/audit-log-writer.ts` — from Section 5

**Acceptance**:
- [ ] Validates each SQS record with `AuditLogPayloadSchema.safeParse` (destructured)
- [ ] Invalid records logged and skipped (not thrown) — go to DLQ naturally
- [ ] Valid records written via `writeAuditLog` with HMAC secret from SSM
- [ ] HMAC secret cached in Lambda memory (not re-fetched per record)
- [ ] `cd apps/functions && pnpm tsc --noEmit` passes

---

### AL-6 · DynamoDB Streams Consumer: audit-archiver (30 min) <!-- ⏳ PENDING -->

**Goal**: Implement the DynamoDB Streams consumer that archives expired logs to S3 Glacier.

**Files to create**:
- `apps/functions/src/handlers/audit/audit-archiver.ts` — from Section 5

**Acceptance**:
- [ ] Only processes `REMOVE` events (TTL expiry) — skips INSERT/MODIFY
- [ ] Only processes items where `partition_key === 'AUDIT_LOG'` — ignores other entities
- [ ] Archives to S3 path: `audit-logs/{orgId}/{year}/{month}/{day}/{logId}.json`
- [ ] Uses `StorageClass: 'GLACIER_IR'` for Glacier Instant Retrieval
- [ ] `cd apps/functions && pnpm tsc --noEmit` passes

---

### AL-7 · REST Lambda Handlers (30 min) <!-- ⏳ PENDING -->

**Goal**: Implement the two REST-facing audit handlers.

**Files to create**:
- `apps/functions/src/handlers/audit/query-logs.ts` — from Section 5
- `apps/functions/src/handlers/audit/generate-report.ts` — from Section 5

**Rules to verify for each handler**:
- [ ] `safeParse` result destructured immediately
- [ ] `orgId` from `queryStringParameters` (GET) or `data.orgId` (POST)
- [ ] `apiResponse` used for all JSON responses
- [ ] `generate-report.ts` returns raw CSV with correct `Content-Type` header when `format === 'csv'`
- [ ] Middy stack: `authContextMiddleware → orgMembershipMiddleware → requirePermission('audit:read'/'audit:report') → httpErrorMiddleware`
- [ ] `withSentryLambda` wrapping
- [ ] `cd apps/functions && pnpm tsc --noEmit` passes

---

### AL-8 · API Routes Registration (15 min) <!-- ⏳ PENDING -->

**Goal**: Wire the audit REST endpoints into API Gateway.

**Files to create**:
- `packages/infra/api/routes/audit.routes.ts` — from Section 6

**Files to modify**:
- `packages/infra/api/api-orchestrator-stack.ts`:
  - Add `import { auditDomain } from './routes/audit.routes'`
  - Add `auditDomain()` to `allDomains` array
  - Add `'AuditRoutes'` to `domainStackNames` array at the same index
  - Add `auditLogQueueName` prop and `AUDIT_LOG_QUEUE_URL` to `commonEnv`
  - Add IAM policy for `sqs:SendMessage` to audit queue

**Acceptance**:
- [ ] 2 routes registered: `GET /audit/logs`, `POST /audit/report`
- [ ] `generate-report` Lambda has `timeoutSeconds: 60` and `memorySize: 512`
- [ ] `cd packages/infra && pnpm tsc --noEmit` passes

---

### AL-9 · CDK AuditStack (45 min) <!-- ⏳ PENDING -->

**Goal**: Create the `AuditStack` CDK stack with all audit infrastructure.

**Files to create**:
- `packages/infra/audit-stack.ts` — full stack from Section 7

**Files to modify**:
- `packages/infra/bin/auto-rfp-infrastructure.ts`:
  - Add `import { AuditStack } from '../audit-stack'`
  - Instantiate `AuditStack` after `collaborationWsStack`
  - Add `auditStack.addDependency(db)` and `auditStack.addDependency(api)`

**Acceptance**:
- [ ] SQS audit queue + DLQ created with SQS_MANAGED encryption
- [ ] S3 archive bucket created with `GLACIER_IR` lifecycle transition after 1 day, expiry after 7 years
- [ ] S3 bucket uses `RETAIN` removal policy for prod, `DESTROY` for non-prod
- [ ] SSM parameter `/auto-rfp/audit-hmac-secret` created
- [ ] `audit-log-writer` Lambda has explicit CloudWatch Log Group
- [ ] `audit-archiver` Lambda has explicit CloudWatch Log Group
- [ ] DynamoDB Streams event source attached to `audit-archiver` with `REMOVE` filter
- [ ] `cd packages/infra && pnpm tsc --noEmit` passes

---

### AL-10 · Frontend Feature (60 min) <!-- ⏳ PENDING -->

**Goal**: Implement the audit log viewer and compliance report UI.

**Files to create**:
- `apps/web/features/audit/hooks/useAuditLogs.ts`
- `apps/web/features/audit/hooks/useAuditReport.ts`
- `apps/web/features/audit/components/AuditLogTable.tsx`
- `apps/web/features/audit/components/AuditLogFilters.tsx`
- `apps/web/features/audit/components/AuditLogRow.tsx`
- `apps/web/features/audit/components/AuditLogTableSkeleton.tsx`
- `apps/web/features/audit/components/AuditReportForm.tsx`
- `apps/web/features/audit/index.ts`
- `apps/web/app/(dashboard)/audit/page.tsx`
- `apps/web/app/(dashboard)/audit/loading.tsx`

**Acceptance**:
- [ ] `useAuditLogs` uses SWR with `revalidateOnFocus: false` (audit logs don't change)
- [ ] `AuditLogTable` shows `AuditLogTableSkeleton` while loading — no spinners
- [ ] `AuditLogRow` highlights failure rows with `bg-red-50/40`
- [ ] `AuditLogRow` shows expandable before/after diff for entries with `changes`
- [ ] `AuditReportForm` triggers CSV browser download when `format === 'csv'`
- [ ] All components use Shadcn UI — no raw `<button>` or `<input>`
- [ ] Types imported from `@auto-rfp/core` — no inline type definitions
- [ ] Audit page accessible at `/audit` in the dashboard layout
- [ ] `cd apps/web && pnpm tsc --noEmit` passes

---

### AL-11 · Add Audit Middleware to All Key Handlers (60 min) <!-- ⏳ PENDING -->

**Goal**: Wire `auditMiddleware` + `setAuditContext` into all handlers that require audit logging.

**Handlers to update** (add `auditMiddleware()` to Middy stack + `setAuditContext` call):

| Handler | Action | Resource |
|---|---|---|
| `project/create-project.ts` | `PROJECT_CREATED` | `project` |
| `project/delete-project.ts` | `PROJECT_DELETED` | `project` |
| `user/create-user.ts` | `USER_CREATED` | `user` |
| `user/delete-user.ts` | `USER_DELETED` | `user` |
| `user/edit-user.ts` | `USER_UPDATED` | `user` |
| `user/edit-user-role.ts` | `USER_ROLE_CHANGED` | `user` |
| `document/upload-document.ts` | `DOCUMENT_UPLOADED` | `document` |
| `document/delete-document.ts` | `DOCUMENT_DELETED` | `document` |
| `answer/edit-answer.ts` | `ANSWER_EDITED` | `answer` |
| `api-key/create-api-key.ts` | `API_KEY_CREATED` | `api_key` |
| `api-key/delete-api-key.ts` | `API_KEY_DELETED` | `api_key` |
| `organization/update-organization.ts` | `ORG_SETTINGS_CHANGED` | `organization` |
| `export/*.ts` | `DATA_EXPORTED` | `proposal` |

**Acceptance**:
- [ ] Each handler calls `setAuditContext(event, { action, resource, resourceId })` before `return apiResponse(...)`
- [ ] `auditMiddleware()` added to Middy stack after `requirePermission` and before `httpErrorMiddleware`
- [ ] `cd apps/functions && pnpm tsc --noEmit` passes

---

## 11. Acceptance Criteria Checklist <!-- ⏳ PENDING -->

- [ ] All user actions logged: login, logout, document uploads, answer edits, proposal submissions, user management, permission changes, export operations
- [ ] All system events logged: pipeline stages, AI generations, integration syncs, errors
- [ ] All security events logged: failed logins, unauthorized access, permission violations, data exports, config changes
- [ ] Audit logs are immutable — no `updateItem` or `deleteItem` ever called on `AUDIT_LOG` items
- [ ] Each log entry has a SHA-256 HMAC `integrityHash` for tamper detection
- [ ] `GET /audit/logs` returns paginated logs with filter support (user, action, resource, date range)
- [ ] `POST /audit/report` generates compliance reports in JSON and CSV format
- [ ] Five report types working: `user_activity_summary`, `access_report`, `change_history`, `security_events`, `export_log`
- [ ] Logs auto-expire from DynamoDB after 90 days via TTL
- [ ] Expired logs automatically archived to S3 Glacier via DynamoDB Streams
- [ ] S3 Glacier lifecycle rule enforces 7-year retention
- [ ] `audit:read` and `audit:report` permissions restricted to ADMIN role only
- [ ] Audit middleware never throws — audit failures do not break user requests
- [ ] `AuditLogTable` uses skeleton loading — no spinners
- [ ] `AuditLogRow` highlights failure entries in red
- [ ] CSV report download works in browser
- [ ] All Lambda functions have explicit CloudWatch Log Groups in CDK
- [ ] `cd packages/core && pnpm tsc --noEmit` passes
- [ ] `cd apps/functions && pnpm tsc --noEmit` passes
- [ ] `cd packages/infra && pnpm tsc --noEmit` passes
- [ ] `cd apps/web && pnpm tsc --noEmit` passes

---

## 12. Summary of New Files <!-- ⏳ PENDING -->

### New Files

| File | Type | Purpose |
|---|---|---|
| `packages/core/src/schemas/audit.ts` | Schema | All audit Zod schemas & inferred types |
| `apps/functions/src/constants/audit.ts` | Constants | PK constants, TTL values, HMAC param name |
| `apps/functions/src/helpers/audit.ts` | Helper | SK builders, integrity hash, write + query helpers |
| `apps/functions/src/middleware/audit-middleware.ts` | Middleware | Middy after-hook — enqueues audit events |
| `apps/functions/src/handlers/audit/audit-log-writer.ts` | Lambda | SQS consumer — validates + writes to DynamoDB |
| `apps/functions/src/handlers/audit/audit-archiver.ts` | Lambda | DynamoDB Streams consumer — archives to S3 Glacier |
| `apps/functions/src/handlers/audit/query-logs.ts` | Lambda | GET /audit/logs — search/filter with pagination |
| `apps/functions/src/handlers/audit/generate-report.ts` | Lambda | POST /audit/report — compliance report generation |
| `packages/infra/audit-stack.ts` | CDK Stack | All audit infrastructure (SQS, S3, Lambdas, SSM) |
| `packages/infra/api/routes/audit.routes.ts` | CDK Routes | REST route definitions for audit domain |
| `apps/web/features/audit/hooks/useAuditLogs.ts` | Hook | SWR hook for paginated log queries |
| `apps/web/features/audit/hooks/useAuditReport.ts` | Hook | SWR mutation for report generation |
| `apps/web/features/audit/components/AuditLogTable.tsx` | Component | Paginated table with filter bar |
| `apps/web/features/audit/components/AuditLogFilters.tsx` | Component | Filter bar (user, action, resource, date range) |
| `apps/web/features/audit/components/AuditLogRow.tsx` | Component | Single log row with expandable changes diff |
| `apps/web/features/audit/components/AuditLogTableSkeleton.tsx` | Component | Skeleton loading state for the table |
| `apps/web/features/audit/components/AuditReportForm.tsx` | Component | Compliance report generation form |
| `apps/web/features/audit/index.ts` | Barrel | Feature exports |
| `apps/web/app/(dashboard)/audit/page.tsx` | Page | Audit log viewer + report generation page |
| `apps/web/app/(dashboard)/audit/loading.tsx` | Loading | Skeleton loading state for the audit page |

### Modified Files

| File | Change |
|---|---|
| `packages/core/src/schemas/index.ts` | Add `export * from './audit'` |
| `packages/core/src/schemas/user.ts` | Add `audit:read`, `audit:report` to `ALL_PERMISSIONS`; grant to ADMIN |
| `packages/infra/api/api-orchestrator-stack.ts` | Add `auditDomain()`, `AuditRoutes`, `AUDIT_LOG_QUEUE_URL` to `commonEnv`, IAM policy for audit queue |
| `packages/infra/bin/auto-rfp-infrastructure.ts` | Instantiate `AuditStack`, add dependencies |
| `apps/functions/src/handlers/project/create-project.ts` | Add `auditMiddleware()` + `setAuditContext` |
| `apps/functions/src/handlers/project/delete-project.ts` | Add `auditMiddleware()` + `setAuditContext` |
| `apps/functions/src/handlers/user/create-user.ts` | Add `auditMiddleware()` + `setAuditContext` |
| `apps/functions/src/handlers/user/delete-user.ts` | Add `auditMiddleware()` + `setAuditContext` |
| `apps/functions/src/handlers/user/edit-user.ts` | Add `auditMiddleware()` + `setAuditContext` |
| `apps/functions/src/handlers/user/edit-user-role.ts` | Add `auditMiddleware()` + `setAuditContext` |
| `apps/functions/src/handlers/document/upload-document.ts` | Add `auditMiddleware()` + `setAuditContext` |
| `apps/functions/src/handlers/answer/edit-answer.ts` | Add `auditMiddleware()` + `setAuditContext` |
| `apps/functions/src/handlers/api-key/create-api-key.ts` | Add `auditMiddleware()` + `setAuditContext` |
| `apps/functions/src/handlers/api-key/delete-api-key.ts` | Add `auditMiddleware()` + `setAuditContext` |
| `apps/functions/src/handlers/organization/update-organization.ts` | Add `auditMiddleware()` + `setAuditContext` |
| `apps/functions/src/handlers/export/*.ts` | Add `auditMiddleware()` + `setAuditContext` |
