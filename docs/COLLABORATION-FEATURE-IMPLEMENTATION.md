# Real-Time Collaboration Feature — Implementation Guide

> **Priority:** P1 — High value for teams  
> **Estimated Effort:** 16 hours  
> **Reference:** Section 8 (Multi-tenancy)

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture Overview](#architecture-overview)
3. [Data Models & Zod Schemas](#data-models--zod-schemas)
4. [DynamoDB Design](#dynamodb-design)
5. [Backend — Lambda Handlers](#backend--lambda-handlers)
6. [WebSocket Infrastructure (CDK)](#websocket-infrastructure-cdk)
7. [REST API Routes](#rest-api-routes)
8. [Frontend — Hooks & Components](#frontend--hooks--components)
9. [Permissions & RBAC](#permissions--rbac)
10. [Email Notifications](#email-notifications)
11. [CDK Stack Updates](#cdk-stack-updates)
12. [Implementation Tickets](#implementation-tickets)
13. [Acceptance Criteria Checklist](#acceptance-criteria-checklist)

---

## Overview

Real-time collaboration enables multiple team members to work simultaneously on the same proposal with full visibility and coordination. The feature covers:

| Feature | Description |
|---|---|
| **Real-Time Presence** | See who is viewing/editing which question right now |
| **Comment Threads** | Threaded discussions on any answer with @mentions |
| **Assignment Workflow** | Assign questions to team members with status tracking |
| **Activity Feed** | Chronological log of all actions on a project |
| **Conflict Prevention** | Optimistic locking + "is editing" indicators |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (Next.js)                        │
│                                                                   │
│  usePresence()   useComments()   useAssignment()   useActivity() │
│       │               │                │                │        │
│       └───────────────┴────────────────┴────────────────┘        │
│                              │                                    │
│              WebSocket (API GW WS) + REST (API GW HTTP)          │
└──────────────────────────────┬──────────────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
   ┌──────▼──────┐    ┌────────▼───────┐   ┌───────▼──────┐
   │  presence   │    │   comments     │   │ activity-feed│
   │  Lambda     │    │   Lambda       │   │  Lambda      │
   └──────┬──────┘    └────────┬───────┘   └───────┬──────┘
          │                    │                    │
          └────────────────────┼────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   DynamoDB          │
                    │   (single table)    │
                    │                     │
                    │  PK=PRESENCE        │
                    │  PK=COMMENT         │
                    │  PK=ASSIGNMENT      │
                    │  PK=ACTIVITY        │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  DynamoDB Streams   │
                    │  → Activity Feed    │
                    │    Lambda           │
                    └─────────────────────┘
```

### Key Technology Decisions

| Concern | Solution | Rationale |
|---|---|---|
| Real-time transport | API Gateway WebSocket API | Already using API GW; no extra infra |
| Presence heartbeat | Client pings every 30s; TTL auto-expires stale records | Serverless-friendly, no persistent connections needed |
| Activity feed | DynamoDB Streams → Lambda fan-out | Decoupled; captures all mutations automatically |
| Conflict prevention | Optimistic locking via `version` attribute on answers | DynamoDB conditional writes; no distributed lock needed |
| Email notifications | SES via async Lambda triggered from comment creation | Keeps comment Lambda fast; retries handled by SQS |

---

## Data Models & Zod Schemas

All schemas live in `packages/core/src/schemas/`. Types are always inferred from Zod — never defined manually.

### `packages/core/src/schemas/collaboration.ts`

```typescript
import { z } from 'zod';

// ─── Presence ────────────────────────────────────────────────────────────────

export const PresenceStatusSchema = z.enum(['viewing', 'editing', 'generating', 'reviewing']);
export type PresenceStatus = z.infer<typeof PresenceStatusSchema>;

export const PresenceItemSchema = z.object({
  connectionId: z.string().min(1),   // API GW WebSocket connection ID
  projectId: z.string().uuid(),
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  displayName: z.string().min(1).max(200),
  questionId: z.string().uuid().optional(), // which question they are on
  status: PresenceStatusSchema,
  connectedAt: z.string().datetime(),
  lastHeartbeatAt: z.string().datetime(),
  ttl: z.number().int(),             // Unix epoch seconds — DynamoDB TTL
});
export type PresenceItem = z.infer<typeof PresenceItemSchema>;

export const PresenceHeartbeatSchema = z.object({
  projectId: z.string().uuid(),
  questionId: z.string().uuid().optional(),
  status: PresenceStatusSchema,
});
export type PresenceHeartbeat = z.infer<typeof PresenceHeartbeatSchema>;

// ─── Comments ────────────────────────────────────────────────────────────────

// Supported entity types that can be commented on
export const CommentEntityTypeSchema = z.enum([
  'QUESTION',
  'QUESTION_FILE',
  'DOCUMENT',
  'ANSWER',
  'BRIEF',
]);
export type CommentEntityType = z.infer<typeof CommentEntityTypeSchema>;

export const CommentItemSchema = z.object({
  commentId: z.string().uuid(),
  projectId: z.string().uuid(),
  orgId: z.string().uuid(),
  // Generic entity reference — works for any commentable entity in the single table
  entityType: CommentEntityTypeSchema,       // discriminator: what kind of entity is being commented on
  entityId: z.string().min(1),               // the entity's own ID (questionId, documentId, etc.)
  entityPk: z.string().min(1),               // partition_key of the commented entity (for direct GetItem)
  entitySk: z.string().min(1),               // sort_key of the commented entity (for direct GetItem)
  parentCommentId: z.string().uuid().optional(), // null = top-level thread
  userId: z.string().uuid(),
  displayName: z.string().min(1).max(200),
  content: z.string().min(1).max(4000),
  mentions: z.array(z.string().uuid()),          // userId list
  resolved: z.boolean().default(false),
  resolvedBy: z.string().uuid().optional(),
  resolvedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().optional(),   // soft delete
});
export type CommentItem = z.infer<typeof CommentItemSchema>;

export const CreateCommentDTOSchema = z.object({
  projectId: z.string().uuid(),
  // Generic entity reference — pass the type, ID, and DynamoDB keys of the entity being commented on
  entityType: CommentEntityTypeSchema,
  entityId: z.string().min(1),               // e.g. questionId, documentId, questionFileId, etc.
  entityPk: z.string().min(1),               // partition_key of the entity in the single table
  entitySk: z.string().min(1),               // sort_key of the entity in the single table
  parentCommentId: z.string().uuid().optional(),
  content: z.string().min(1).max(4000),
  mentions: z.array(z.string().uuid()).default([]),
});
export type CreateCommentDTO = z.infer<typeof CreateCommentDTOSchema>;

export const UpdateCommentDTOSchema = z.object({
  commentId: z.string().uuid(),
  projectId: z.string().uuid(),
  content: z.string().min(1).max(4000).optional(),
  resolved: z.boolean().optional(),
});
export type UpdateCommentDTO = z.infer<typeof UpdateCommentDTOSchema>;

export const CommentsResponseSchema = z.object({
  items: z.array(CommentItemSchema),
  nextToken: z.string().optional(),
  count: z.number(),
});
export type CommentsResponse = z.infer<typeof CommentsResponseSchema>;

// ─── Assignment ───────────────────────────────────────────────────────────────

export const QuestionStatusSchema = z.enum([
  'UNASSIGNED',
  'ASSIGNED',
  'IN_PROGRESS',
  'IN_REVIEW',
  'APPROVED',
]);
export type QuestionStatus = z.infer<typeof QuestionStatusSchema>;

export const AssignmentItemSchema = z.object({
  assignmentId: z.string().uuid(),
  projectId: z.string().uuid(),
  orgId: z.string().uuid(),
  questionId: z.string().uuid(),
  assignedToUserId: z.string().uuid().optional(),
  assignedToDisplayName: z.string().max(200).optional(),
  assignedByUserId: z.string().uuid(),
  status: QuestionStatusSchema.default('UNASSIGNED'),
  dueAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AssignmentItem = z.infer<typeof AssignmentItemSchema>;

export const UpsertAssignmentDTOSchema = z.object({
  projectId: z.string().uuid(),
  questionId: z.string().uuid(),
  assignedToUserId: z.string().uuid().optional(),
  status: QuestionStatusSchema,
  dueAt: z.string().datetime().optional(),
});
export type UpsertAssignmentDTO = z.infer<typeof UpsertAssignmentDTOSchema>;

export const AssignmentsResponseSchema = z.object({
  items: z.array(AssignmentItemSchema),
  count: z.number(),
});
export type AssignmentsResponse = z.infer<typeof AssignmentsResponseSchema>;

// ─── Activity Feed ────────────────────────────────────────────────────────────

export const ActivityActionSchema = z.enum([
  'ANSWER_EDITED',
  'ANSWER_APPROVED',
  'COMMENT_ADDED',
  'COMMENT_RESOLVED',
  'QUESTION_ASSIGNED',
  'STATUS_CHANGED',
  'BRIEF_GENERATED',
  'DOCUMENT_UPLOADED',
  'USER_JOINED',
]);
export type ActivityAction = z.infer<typeof ActivityActionSchema>;

export const ActivityItemSchema = z.object({
  activityId: z.string().uuid(),
  projectId: z.string().uuid(),
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  displayName: z.string().min(1).max(200),
  action: ActivityActionSchema,
  target: z.string().min(1).max(500),   // human-readable target, e.g. "Q1 answer"
  targetId: z.string().optional(),       // questionId, commentId, etc.
  metadata: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.string().datetime(),
  ttl: z.number().int(),                 // auto-expire after 90 days
});
export type ActivityItem = z.infer<typeof ActivityItemSchema>;

export const ActivityFeedResponseSchema = z.object({
  items: z.array(ActivityItemSchema),
  nextToken: z.string().optional(),
  count: z.number(),
});
export type ActivityFeedResponse = z.infer<typeof ActivityFeedResponseSchema>;

// ─── WebSocket Messages ───────────────────────────────────────────────────────

export const WsMessageTypeSchema = z.enum([
  'PRESENCE_UPDATE',
  'COMMENT_CREATED',
  'COMMENT_UPDATED',
  'ASSIGNMENT_UPDATED',
  'ACTIVITY_EVENT',
  'EDITING_LOCK',
  'EDITING_UNLOCK',
  'HEARTBEAT',
  'ERROR',
]);
export type WsMessageType = z.infer<typeof WsMessageTypeSchema>;

export const WsInboundMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('HEARTBEAT'), payload: PresenceHeartbeatSchema }),
  z.object({ type: z.literal('EDITING_LOCK'), payload: z.object({ projectId: z.string().uuid(), questionId: z.string().uuid() }) }),
  z.object({ type: z.literal('EDITING_UNLOCK'), payload: z.object({ projectId: z.string().uuid(), questionId: z.string().uuid() }) }),
]);
export type WsInboundMessage = z.infer<typeof WsInboundMessageSchema>;

export const WsOutboundMessageSchema = z.object({
  type: WsMessageTypeSchema,
  payload: z.unknown(),
  timestamp: z.string().datetime(),
});
export type WsOutboundMessage = z.infer<typeof WsOutboundMessageSchema>;
```

### Export from `packages/core/src/schemas/index.ts`

```typescript
// Add to existing exports:
export * from './collaboration';
```

---

## DynamoDB Design

All collaboration data lives in the **existing single table** (`RFP-table-{stage}`). No new tables are needed.

### Partition Keys (add to `apps/functions/src/constants/common.ts`)

```typescript
// Existing:
export const PK_NAME = 'partition_key';
export const SK_NAME = 'sort_key';

// Add to apps/functions/src/constants/collaboration.ts:
export const PK = {
  PRESENCE:   'PRESENCE',
  COMMENT:    'COMMENT',
  ASSIGNMENT: 'ASSIGNMENT',
  ACTIVITY:   'ACTIVITY',
  WS_CONNECTION: 'WS_CONNECTION',
} as const;

export const PRESENCE_TTL_SECONDS = 90;        // 30s heartbeat × 3 = 90s grace
export const ACTIVITY_TTL_DAYS    = 90;
export const WS_CONNECTION_TTL_SECONDS = 7200; // 2 hours max session
```

### Access Patterns

| Entity | PK | SK | Notes |
|---|---|---|---|
| Presence record | `PRESENCE` | `{orgId}#{projectId}#{userId}` | TTL auto-expires stale |
| WS Connection | `WS_CONNECTION` | `{connectionId}` | Maps connectionId → userId/projectId |
| Comment | `COMMENT` | `{orgId}#{projectId}#{entityType}#{entityId}#{commentId}` | Sorted by entity type + entity |
| Assignment | `ASSIGNMENT` | `{orgId}#{projectId}#{questionId}` | One record per question |
| Activity | `ACTIVITY` | `{orgId}#{projectId}#{timestamp}#{activityId}` | Sorted by time desc |

### SK Builder Functions (`apps/functions/src/helpers/collaboration.ts`)

```typescript
import { PK_NAME, SK_NAME } from '@/constants/common';
import { PK } from '@/constants/collaboration';

// ─── SK Builders ─────────────────────────────────────────────────────────────

export function buildPresenceSK(orgId: string, projectId: string, userId: string): string {
  return `${orgId}#${projectId}#${userId}`;
}

export function buildCommentSK(
  orgId: string,
  projectId: string,
  entityType: string,  // e.g. 'QUESTION', 'DOCUMENT', 'QUESTION_FILE', 'ANSWER', 'BRIEF'
  entityId: string,    // the entity's own ID
  commentId: string,
): string {
  return `${orgId}#${projectId}#${entityType}#${entityId}#${commentId}`;
}

export function buildAssignmentSK(orgId: string, projectId: string, questionId: string): string {
  return `${orgId}#${projectId}#${questionId}`;
}

export function buildActivitySK(orgId: string, projectId: string, timestamp: string, activityId: string): string {
  return `${orgId}#${projectId}#${timestamp}#${activityId}`;
}

export function buildWsConnectionSK(connectionId: string): string {
  return connectionId;
}

// ─── DynamoDB Helpers (wrap @/helpers/db) ────────────────────────────────────
// All helpers use the shared docClient and DB helpers — no raw SDK commands in handlers.

import { createItem, putItem, getItem, deleteItem, queryBySkPrefix } from '@/helpers/db';
import type { PresenceItem, CommentItem, AssignmentItem, ActivityItem } from '@auto-rfp/core';
import { PK, PRESENCE_TTL_SECONDS, ACTIVITY_TTL_DAYS } from '@/constants/collaboration';

// ── Presence ──────────────────────────────────────────────────────────────────

export async function upsertPresence(item: Omit<PresenceItem, 'ttl'>): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + PRESENCE_TTL_SECONDS;
  await putItem(
    PK.PRESENCE,
    buildPresenceSK(item.orgId, item.projectId, item.userId),
    { ...item, ttl },
    true, // preserve createdAt if already set
  );
}

export async function deletePresence(orgId: string, projectId: string, userId: string): Promise<void> {
  await deleteItem(PK.PRESENCE, buildPresenceSK(orgId, projectId, userId));
}

export async function listPresence(orgId: string, projectId: string): Promise<PresenceItem[]> {
  return queryBySkPrefix<PresenceItem>(PK.PRESENCE, buildPresenceSK(orgId, projectId, ''));
}

// ── WS Connections ────────────────────────────────────────────────────────────

export async function putWsConnection(connectionId: string, data: Record<string, unknown>): Promise<void> {
  await putItem(PK.WS_CONNECTION, buildWsConnectionSK(connectionId), data);
}

export async function getWsConnection(connectionId: string): Promise<Record<string, unknown> | null> {
  return getItem<Record<string, unknown>>(PK.WS_CONNECTION, buildWsConnectionSK(connectionId));
}

export async function deleteWsConnection(connectionId: string): Promise<void> {
  await deleteItem(PK.WS_CONNECTION, buildWsConnectionSK(connectionId));
}

// ── Comments ──────────────────────────────────────────────────────────────────

export async function createComment(
  orgId: string,
  item: Omit<CommentItem, 'createdAt' | 'updatedAt'>,
): Promise<CommentItem> {
  return createItem<CommentItem>(
    PK.COMMENT,
    buildCommentSK(orgId, item.projectId, item.entityType, item.entityId, item.commentId),
    item,
  );
}

export async function listComments(
  orgId: string,
  projectId: string,
  entityType: string,
  entityId: string,
): Promise<CommentItem[]> {
  const prefix = buildCommentSK(orgId, projectId, entityType, entityId, '');
  const items = await queryBySkPrefix<CommentItem>(PK.COMMENT, prefix);
  return items.filter((c) => !c.deletedAt);
}

// ── Assignments ───────────────────────────────────────────────────────────────

export async function upsertAssignment(
  orgId: string,
  item: Omit<AssignmentItem, 'createdAt' | 'updatedAt'>,
): Promise<AssignmentItem> {
  return putItem<AssignmentItem>(
    PK.ASSIGNMENT,
    buildAssignmentSK(orgId, item.projectId, item.questionId),
    item,
  );
}

export async function listAssignments(orgId: string, projectId: string): Promise<AssignmentItem[]> {
  return queryBySkPrefix<AssignmentItem>(PK.ASSIGNMENT, `${orgId}#${projectId}#`);
}

// ── Activity Feed ─────────────────────────────────────────────────────────────

export async function createActivity(
  orgId: string,
  item: Omit<ActivityItem, 'ttl'>,
): Promise<ActivityItem> {
  const ttl = Math.floor(Date.now() / 1000) + ACTIVITY_TTL_DAYS * 86400;
  return createItem<ActivityItem>(
    PK.ACTIVITY,
    buildActivitySK(orgId, item.projectId, item.timestamp, item.activityId),
    { ...item, ttl },
    { condition: undefined }, // allow duplicates (activityId is unique)
  );
}
```

---

## Backend — Lambda Handlers

All handlers follow the existing thin-Lambda pattern: parse → validate → call helper → respond.

### File Structure

```
apps/functions/src/
├── constants/
│   └── collaboration.ts          # PK constants, TTL values
├── helpers/
│   └── collaboration.ts          # SK builders + DynamoDB helpers
├── handlers/
│   └── collaboration/
│       ├── ws-connect.ts         # $connect route
│       ├── ws-disconnect.ts      # $disconnect route
│       ├── ws-message.ts         # $default route (heartbeat, lock/unlock)
│       ├── get-presence.ts       # GET /collaboration/presence
│       ├── create-comment.ts     # POST /collaboration/comments
│       ├── get-comments.ts       # GET /collaboration/comments
│       ├── update-comment.ts     # PATCH /collaboration/comments/{commentId}
│       ├── delete-comment.ts     # DELETE /collaboration/comments/{commentId}
│       ├── upsert-assignment.ts  # PUT /collaboration/assignments
│       ├── get-assignments.ts    # GET /collaboration/assignments
│       └── get-activity-feed.ts  # GET /collaboration/activity
```

---

### `apps/functions/src/handlers/collaboration/ws-connect.ts`

Handles WebSocket `$connect`. Stores the connection record in DynamoDB so we can broadcast to all connections in a project.

```typescript
import type { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';
import { WS_CONNECTION_TTL_SECONDS } from '@/constants/collaboration';
import { putWsConnection } from '@/helpers/collaboration';

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const { connectionId } = event.requestContext;
  // orgId and projectId are passed as query params on the WebSocket upgrade URL
  const { projectId, orgId } = event.queryStringParameters ?? {};

  if (!connectionId || !projectId || !orgId) {
    return { statusCode: 400, body: 'Missing required query params: projectId, orgId' };
  }

  // userId comes from the Cognito JWT validated by the WS authorizer Lambda
  const claims = (event.requestContext as unknown as { authorizer?: { claims?: Record<string, string> } })
    ?.authorizer?.claims ?? {};
  const userId = claims['sub'] ?? '';

  const ttl = Math.floor(Date.now() / 1000) + WS_CONNECTION_TTL_SECONDS;

  await putWsConnection(connectionId, { connectionId, projectId, orgId, userId, ttl });

  return { statusCode: 200, body: 'Connected' };
};
```

---

### `apps/functions/src/handlers/collaboration/ws-disconnect.ts`

```typescript
import type { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';
import { getWsConnection, deleteWsConnection, deletePresence } from '@/helpers/collaboration';

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const { connectionId } = event.requestContext;

  // Look up the connection record to find orgId/projectId/userId
  const conn = await getWsConnection(connectionId);

  if (conn) {
    const { orgId, projectId, userId } = conn as { orgId: string; projectId: string; userId: string };
    await deletePresence(orgId, projectId, userId);
    await deleteWsConnection(connectionId);
  }

  return { statusCode: 200, body: 'Disconnected' };
};
```

---

### `apps/functions/src/handlers/collaboration/ws-message.ts`

Handles all inbound WebSocket messages: heartbeats, editing locks/unlocks. Broadcasts presence updates to all connections in the same project.

```typescript
import type { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { requireEnv } from '@/helpers/env';
import { PK } from '@/constants/collaboration';
import { getWsConnection, upsertPresence, listPresence } from '@/helpers/collaboration';
import { WsInboundMessageSchema } from '@auto-rfp/core';

const WS_ENDPOINT = requireEnv('WS_API_ENDPOINT');

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const { connectionId } = event.requestContext;

  const conn = await getWsConnection(connectionId);
  if (!conn) return { statusCode: 410, body: 'Connection not found' };

  const { orgId, projectId, userId, displayName } = conn as {
    orgId: string; projectId: string; userId: string; displayName: string;
  };

  const raw = JSON.parse(event.body ?? '{}');
  const { success, data: msg } = WsInboundMessageSchema.safeParse(raw);
  if (!success) return { statusCode: 400, body: 'Invalid message format' };

  const now = new Date().toISOString();

  if (msg.type === 'HEARTBEAT') {
    await upsertPresence({
      connectionId,
      projectId,
      orgId,
      userId,
      displayName: displayName ?? userId,
      questionId: msg.payload.questionId,
      status: msg.payload.status,
      connectedAt: now,
      lastHeartbeatAt: now,
    });
  }

  await broadcastToProject(WS_ENDPOINT, orgId, projectId, connectionId, {
    type: msg.type === 'HEARTBEAT' ? 'PRESENCE_UPDATE' : msg.type,
    payload: { userId, displayName, ...msg.payload },
    timestamp: now,
  });

  return { statusCode: 200, body: 'OK' };
};

async function broadcastToProject(
  wsEndpoint: string,
  orgId: string,
  projectId: string,
  senderConnectionId: string,
  message: unknown,
): Promise<void> {
  // Fetch all active connections for this project via the helper
  const connections = await listPresence(orgId, projectId);
  const apigw = new ApiGatewayManagementApiClient({ endpoint: wsEndpoint });
  const body = JSON.stringify(message);

  const sends = connections
    .filter((c) => c.connectionId !== senderConnectionId)
    .map((c) =>
      apigw.send(new PostToConnectionCommand({
        ConnectionId: c.connectionId,
        Data: Buffer.from(body),
      })).catch(() => { /* stale connection — ignore */ }),
    );

  await Promise.allSettled(sends);
}
```

---

### `apps/functions/src/handlers/collaboration/get-presence.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse } from '@/helpers/api';
import { listPresence } from '@/helpers/collaboration';
import { withSentryLambda } from '@/sentry-lambda';
import { authContextMiddleware, httpErrorMiddleware, orgMembershipMiddleware, type AuthedEvent } from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  // orgId comes from the request body, query param, or path param — never from the token
  const orgId = event.queryStringParameters?.orgId;
  const { projectId } = event.queryStringParameters ?? {};

  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!projectId) return apiResponse(400, { message: 'projectId is required' });

  const items = await listPresence(orgId, projectId);

  return apiResponse(200, { items, count: items.length });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(httpErrorMiddleware()),
);
```

---

### `apps/functions/src/handlers/collaboration/create-comment.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import middy from '@middy/core';
import { CreateCommentDTOSchema } from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { createComment } from '@/helpers/collaboration';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const raw = JSON.parse(event.body ?? '{}');
  const { success, data, error } = CreateCommentDTOSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Invalid payload', issues: error.issues });

  // orgId comes from the request body — the client always sends it
  const orgId = data.orgId ?? event.queryStringParameters?.orgId;
  const userId = event.auth?.userId;
  const displayName = (event.auth?.claims?.['name'] as string | undefined) ?? userId ?? 'Unknown';

  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!userId) return apiResponse(401, { message: 'Unauthorized' });

  const item = await createComment(orgId, {
    commentId: uuidv4(),
    projectId: data.projectId,
    orgId,
    entityType: data.entityType,
    entityId: data.entityId,
    entityPk: data.entityPk,
    entitySk: data.entitySk,
    parentCommentId: data.parentCommentId,
    userId,
    displayName,
    content: data.content,
    mentions: data.mentions,
    resolved: false,
  });

  return apiResponse(201, item);
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('answer:read'))
    .use(httpErrorMiddleware()),
);
```

---

### `apps/functions/src/handlers/collaboration/upsert-assignment.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import middy from '@middy/core';
import { UpsertAssignmentDTOSchema } from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { upsertAssignment } from '@/helpers/collaboration';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const raw = JSON.parse(event.body ?? '{}');
  const { success, data, error } = UpsertAssignmentDTOSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Invalid payload', issues: error.issues });

  // orgId comes from the request body — the client always sends it
  const orgId = data.orgId ?? event.queryStringParameters?.orgId;
  const assignedByUserId = event.auth?.userId;

  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!assignedByUserId) return apiResponse(401, { message: 'Unauthorized' });

  const item = await upsertAssignment(orgId, {
    assignmentId: uuidv4(),
    projectId: data.projectId,
    orgId,
    questionId: data.questionId,
    assignedToUserId: data.assignedToUserId,
    assignedByUserId,
    status: data.status,
    dueAt: data.dueAt,
  });

  return apiResponse(200, item);
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('question:edit'))
    .use(httpErrorMiddleware()),
);
```

---

### `apps/functions/src/handlers/collaboration/get-activity-feed.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse } from '@/helpers/api';
import { queryBySkPrefix } from '@/helpers/db';
import { PK } from '@/constants/collaboration';
import { buildActivitySK } from '@/helpers/collaboration';
import { withSentryLambda } from '@/sentry-lambda';
import { authContextMiddleware, httpErrorMiddleware, orgMembershipMiddleware, type AuthedEvent } from '@/middleware/rbac-middleware';
import type { ActivityItem } from '@auto-rfp/core';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  // orgId comes from query param — the client always sends it
  const { orgId, projectId } = event.queryStringParameters ?? {};

  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!projectId) return apiResponse(400, { message: 'projectId is required' });

  // queryBySkPrefix returns items sorted by SK ascending; reverse for newest-first
  const items = await queryBySkPrefix<ActivityItem>(
    PK.ACTIVITY,
    buildActivitySK(orgId, projectId, '', ''),
  );

  return apiResponse(200, {
    items: items.reverse(),
    count: items.length,
  });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(httpErrorMiddleware()),
);
```

---

## WebSocket Infrastructure (CDK)

### New file: `packages/infra/collaboration-websocket-stack.ts`

```typescript
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigwv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as path from 'path';

export interface CollaborationWebSocketStackProps extends cdk.StackProps {
  stage: string;
  mainTable: dynamodb.ITable;
  userPool: cognito.IUserPool;
  lambdaRole: iam.IRole;
  commonEnv: Record<string, string>;
}

export class CollaborationWebSocketStack extends cdk.Stack {
  public readonly wsApiEndpoint: string;

  constructor(scope: Construct, id: string, props: CollaborationWebSocketStackProps) {
    super(scope, id, props);

    const { stage, mainTable, userPool, lambdaRole, commonEnv } = props;

    const bundling = {
      minify: true,
      sourceMap: true,
      externalModules: ['@aws-sdk/*'],
    };

    const wsEnv = {
      ...commonEnv,
      // WS_API_ENDPOINT is injected after the API is created (see below)
    };

    // ── Lambda: $connect ──────────────────────────────────────────────────────
    const connectFn = new lambdaNodejs.NodejsFunction(this, 'WsConnect', {
      functionName: `auto-rfp-ws-connect-${stage}`,
      entry: path.join(__dirname, '../../apps/functions/src/handlers/collaboration/ws-connect.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      role: lambdaRole,
      environment: wsEnv,
      bundling,
    });

    new logs.LogGroup(this, 'WsConnectLogs', {
      logGroupName: `/aws/lambda/${connectFn.functionName}`,
      retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── Lambda: $disconnect ───────────────────────────────────────────────────
    const disconnectFn = new lambdaNodejs.NodejsFunction(this, 'WsDisconnect', {
      functionName: `auto-rfp-ws-disconnect-${stage}`,
      entry: path.join(__dirname, '../../apps/functions/src/handlers/collaboration/ws-disconnect.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      role: lambdaRole,
      environment: wsEnv,
      bundling,
    });

    new logs.LogGroup(this, 'WsDisconnectLogs', {
      logGroupName: `/aws/lambda/${disconnectFn.functionName}`,
      retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── Lambda: $default (messages) ───────────────────────────────────────────
    const messageFn = new lambdaNodejs.NodejsFunction(this, 'WsMessage', {
      functionName: `auto-rfp-ws-message-${stage}`,
      entry: path.join(__dirname, '../../apps/functions/src/handlers/collaboration/ws-message.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(29),
      memorySize: 512,
      role: lambdaRole,
      environment: wsEnv,
      bundling,
    });

    new logs.LogGroup(this, 'WsMessageLogs', {
      logGroupName: `/aws/lambda/${messageFn.functionName}`,
      retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── WebSocket API ─────────────────────────────────────────────────────────
    const wsApi = new apigwv2.WebSocketApi(this, 'CollaborationWsApi', {
      apiName: `auto-rfp-collaboration-ws-${stage}`,
      connectRouteOptions: {
        integration: new apigwv2Integrations.WebSocketLambdaIntegration('ConnectIntegration', connectFn),
        // Cognito JWT authorizer for $connect
        authorizer: new apigwv2Authorizers.WebSocketLambdaAuthorizer('WsAuthorizer',
          // A simple Lambda authorizer that validates the Cognito JWT from
          // the ?token= query param on the WebSocket upgrade request.
          // See: packages/infra/api/ws-authorizer.ts
          new lambdaNodejs.NodejsFunction(this, 'WsAuthorizerFn', {
            functionName: `auto-rfp-ws-authorizer-${stage}`,
            entry: path.join(__dirname, '../../apps/functions/src/handlers/collaboration/ws-authorizer.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_20_X,
            timeout: cdk.Duration.seconds(5),
            memorySize: 128,
            role: lambdaRole,
            environment: { COGNITO_USER_POOL_ID: commonEnv['COGNITO_USER_POOL_ID'] ?? '', REGION: commonEnv['REGION'] ?? 'us-east-1' },
            bundling,
          }),
          { identitySource: ['route.request.querystring.token'] },
        ),
      },
      disconnectRouteOptions: {
        integration: new apigwv2Integrations.WebSocketLambdaIntegration('DisconnectIntegration', disconnectFn),
      },
      defaultRouteOptions: {
        integration: new apigwv2Integrations.WebSocketLambdaIntegration('MessageIntegration', messageFn),
      },
    });

    const wsStage = new apigwv2.WebSocketStage(this, 'WsStage', {
      webSocketApi: wsApi,
      stageName: stage,
      autoDeploy: true,
    });

    this.wsApiEndpoint = wsStage.callbackUrl; // e.g. https://abc.execute-api.us-east-1.amazonaws.com/dev

    // Inject the WS endpoint back into the message Lambda env
    messageFn.addEnvironment('WS_API_ENDPOINT', this.wsApiEndpoint);

    // Grant Lambda role permission to post to WebSocket connections
    lambdaRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [`arn:aws:execute-api:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:${wsApi.apiId}/${stage}/POST/@connections/*`],
    }));

    new cdk.CfnOutput(this, 'WsApiEndpoint', {
      value: wsStage.url,
      description: 'WebSocket API endpoint for collaboration',
    });

    new cdk.CfnOutput(this, 'WsCallbackUrl', {
      value: this.wsApiEndpoint,
    });
  }
}
```

### Wire into `packages/infra/bin/auto-rfp-infrastructure.ts`

```typescript
// Add after existing stack instantiations:
import { CollaborationWebSocketStack } from '../collaboration-websocket-stack';

const collaborationWsStack = new CollaborationWebSocketStack(app, `AutoRfp-${stage}-CollaborationWS`, {
  stage,
  mainTable: databaseStack.tableName,
  userPool: authStack.userPool,
  lambdaRole: apiOrchestratorStack.commonLambdaRole, // reuse shared role
  commonEnv: { /* same commonEnv object */ },
  env: { account, region },
});

// Pass WS endpoint to the REST API orchestrator so REST lambdas can broadcast too
// (add WS_API_ENDPOINT to commonEnv before creating ApiOrchestratorStack)
```

---

## REST API Routes

### `packages/infra/api/routes/collaboration.routes.ts`

```typescript
import { lambdaEntry } from './route-helper';
import type { DomainRoutes } from './types';

export function collaborationDomain(): DomainRoutes {
  return {
    basePath: 'collaboration',
    routes: [
      // Presence
      { method: 'GET',   path: 'presence',                entry: lambdaEntry('collaboration/get-presence.ts') },

      // Comments
      { method: 'POST',  path: 'comments',                entry: lambdaEntry('collaboration/create-comment.ts') },
      { method: 'GET',   path: 'comments',                entry: lambdaEntry('collaboration/get-comments.ts') },
      { method: 'PATCH', path: 'comments/{commentId}',    entry: lambdaEntry('collaboration/update-comment.ts') },
      { method: 'DELETE',path: 'comments/{commentId}',    entry: lambdaEntry('collaboration/delete-comment.ts') },

      // Assignments
      { method: 'PUT',   path: 'assignments',             entry: lambdaEntry('collaboration/upsert-assignment.ts') },
      { method: 'GET',   path: 'assignments',             entry: lambdaEntry('collaboration/get-assignments.ts') },

      // Activity Feed
      { method: 'GET',   path: 'activity',                entry: lambdaEntry('collaboration/get-activity-feed.ts') },
    ],
  };
}
```

### Register in `packages/infra/api/api-orchestrator-stack.ts`

```typescript
// Add import:
import { collaborationDomain } from './routes/collaboration.routes';

// Add to allDomains array:
collaborationDomain(),

// Add to domainStackNames array:
'CollaborationRoutes',
```

### REST Endpoint Summary

| Method | Path | Description | Permission |
|---|---|---|---|
| `GET` | `/collaboration/presence?projectId=&orgId=` | List active users in project | any authenticated |
| `POST` | `/collaboration/comments` | Create a comment | `answer:read` |
| `GET` | `/collaboration/comments?projectId=&entityType=&entityId=` | List comments for any entity | `answer:read` |
| `PATCH` | `/collaboration/comments/{commentId}` | Edit or resolve a comment | `answer:read` (own) |
| `DELETE` | `/collaboration/comments/{commentId}` | Soft-delete a comment | `answer:edit` |
| `PUT` | `/collaboration/assignments` | Assign/update question status | `question:edit` |
| `GET` | `/collaboration/assignments?projectId=` | List all assignments for project | `question:read` |
| `GET` | `/collaboration/activity?projectId=&limit=&nextToken=` | Paginated activity feed | any authenticated |

### WebSocket Endpoint

```
wss://{wsApiId}.execute-api.{region}.amazonaws.com/{stage}
  ?token={cognitoIdToken}
  &projectId={uuid}
  &orgId={uuid}
```

#### Inbound Messages (client → server)

```jsonc
// Heartbeat — sent every 30s
{ "type": "HEARTBEAT", "payload": { "projectId": "...", "questionId": "...", "status": "editing" } }

// Lock editing on a question
{ "type": "EDITING_LOCK", "payload": { "projectId": "...", "questionId": "..." } }

// Unlock editing
{ "type": "EDITING_UNLOCK", "payload": { "projectId": "...", "questionId": "..." } }
```

#### Outbound Messages (server → client broadcast)

```jsonc
// Presence update
{ "type": "PRESENCE_UPDATE", "payload": { "userId": "...", "displayName": "Michael", "status": "editing", "questionId": "..." }, "timestamp": "..." }

// Editing lock acquired
{ "type": "EDITING_LOCK", "payload": { "userId": "...", "displayName": "Kateryna", "questionId": "..." }, "timestamp": "..." }

// New comment
{ "type": "COMMENT_CREATED", "payload": { ...CommentItem }, "timestamp": "..." }

// Assignment changed
{ "type": "ASSIGNMENT_UPDATED", "payload": { ...AssignmentItem }, "timestamp": "..." }

// Activity event
{ "type": "ACTIVITY_EVENT", "payload": { ...ActivityItem }, "timestamp": "..." }
```

---

## Frontend — Hooks & Components

### File Structure

```
apps/web/
├── features/
│   └── collaboration/
│       ├── hooks/
│       │   ├── useWebSocket.ts          # Core WS connection manager
│       │   ├── usePresence.ts           # Real-time presence
│       │   ├── useComments.ts           # Comment threads
│       │   ├── useAssignment.ts         # Question assignment
│       │   └── useActivityFeed.ts       # Activity feed
│       ├── components/
│       │   ├── PresenceAvatars.tsx      # Floating avatar row
│       │   ├── EditingIndicator.tsx     # "[User] is editing..." banner
│       │   ├── CommentThread.tsx        # Threaded comment UI
│       │   ├── CommentInput.tsx         # @mention-aware input
│       │   ├── AssignmentBadge.tsx      # Status badge + assign dropdown
│       │   ├── ActivityFeed.tsx         # Scrollable activity list
│       │   └── CollaborationPanel.tsx   # Side panel combining all features
│       ├── lib/
│       │   └── ws-client.ts             # WebSocket singleton
│       └── index.ts                     # Barrel export
```

---

### `apps/web/features/collaboration/lib/ws-client.ts`

Singleton WebSocket manager. Reconnects automatically on disconnect.

```typescript
'use client';

import type { WsOutboundMessage } from '@auto-rfp/core';

type MessageHandler = (msg: WsOutboundMessage) => void;

interface WsClientOptions {
  wsUrl: string;
  token: string;
  projectId: string;
  orgId: string;
  onMessage: MessageHandler;
  onOpen?: () => void;
  onClose?: () => void;
}

export class WsClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(private readonly opts: WsClientOptions) {}

  connect(): void {
    const { wsUrl, token, projectId, orgId } = this.opts;
    const url = `${wsUrl}?token=${encodeURIComponent(token)}&projectId=${projectId}&orgId=${orgId}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.opts.onOpen?.();
      this.startHeartbeat();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as WsOutboundMessage;
        this.opts.onMessage(msg);
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.opts.onClose?.();
      if (!this.closed) {
        // Reconnect after 3 seconds
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      }
    };
  }

  send(type: string, payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  updatePresence(questionId: string | undefined, status: string): void {
    this.send('HEARTBEAT', { projectId: this.opts.projectId, questionId, status });
  }

  lockEditing(questionId: string): void {
    this.send('EDITING_LOCK', { projectId: this.opts.projectId, questionId });
  }

  unlockEditing(questionId: string): void {
    this.send('EDITING_UNLOCK', { projectId: this.opts.projectId, questionId });
  }

  disconnect(): void {
    this.closed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.send('HEARTBEAT', { projectId: this.opts.projectId, status: 'viewing' });
    }, 30_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
```

---

### `apps/web/features/collaboration/hooks/useWebSocket.ts`

```typescript
'use client';

import { useEffect, useRef, useCallback } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { WsClient } from '../lib/ws-client';
import type { WsOutboundMessage } from '@auto-rfp/core';

interface UseWebSocketOptions {
  projectId: string;
  orgId: string;
  onMessage: (msg: WsOutboundMessage) => void;
  enabled?: boolean;
}

export function useWebSocket({ projectId, orgId, onMessage, enabled = true }: UseWebSocketOptions) {
  const clientRef = useRef<WsClient | null>(null);

  useEffect(() => {
    if (!enabled || !projectId || !orgId) return;

    let mounted = true;

    const init = async () => {
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();
      if (!token || !mounted) return;

      const wsUrl = process.env.NEXT_PUBLIC_WS_API_URL ?? '';
      const client = new WsClient({ wsUrl, token, projectId, orgId, onMessage });
      clientRef.current = client;
      client.connect();
    };

    init();

    return () => {
      mounted = false;
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, [projectId, orgId, enabled]);

  const updatePresence = useCallback((questionId: string | undefined, status: string) => {
    clientRef.current?.updatePresence(questionId, status);
  }, []);

  const lockEditing = useCallback((questionId: string) => {
    clientRef.current?.lockEditing(questionId);
  }, []);

  const unlockEditing = useCallback((questionId: string) => {
    clientRef.current?.unlockEditing(questionId);
  }, []);

  return { updatePresence, lockEditing, unlockEditing };
}
```

---

### `apps/web/features/collaboration/hooks/usePresence.ts`

```typescript
'use client';

import { useState, useCallback } from 'react';
import type { PresenceItem, WsOutboundMessage } from '@auto-rfp/core';
import { useWebSocket } from './useWebSocket';

export function usePresence(projectId: string, orgId: string) {
  const [presenceMap, setPresenceMap] = useState<Map<string, PresenceItem>>(new Map());

  const handleMessage = useCallback((msg: WsOutboundMessage) => {
    if (msg.type === 'PRESENCE_UPDATE') {
      const item = msg.payload as PresenceItem;
      setPresenceMap((prev) => {
        const next = new Map(prev);
        next.set(item.userId, item);
        return next;
      });
    }
  }, []);

  const { updatePresence, lockEditing, unlockEditing } = useWebSocket({
    projectId,
    orgId,
    onMessage: handleMessage,
  });

  const activeUsers = Array.from(presenceMap.values());

  const getUsersOnQuestion = useCallback(
    (questionId: string) => activeUsers.filter((u) => u.questionId === questionId),
    [activeUsers],
  );

  return { activeUsers, getUsersOnQuestion, updatePresence, lockEditing, unlockEditing };
}
```

---

### `apps/web/features/collaboration/hooks/useComments.ts`

```typescript
'use client';

import useSWR, { mutate } from 'swr';
import { authenticatedFetcher } from '@/lib/hooks/use-api';
import type { CommentsResponse, CreateCommentDTO } from '@auto-rfp/core';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

export function useComments(projectId: string, entityType: string, entityId: string) {
  const key = `${API_BASE}/collaboration/comments?projectId=${projectId}&entityType=${entityType}&entityId=${entityId}`;

  const { data, error, isLoading } = useSWR<CommentsResponse>(key, authenticatedFetcher);

  const createComment = async (dto: CreateCommentDTO) => {
    await authenticatedFetcher(`${API_BASE}/collaboration/comments`, {
      method: 'POST',
      body: JSON.stringify(dto),
    });
    await mutate(key);
  };

  const resolveComment = async (commentId: string, resolved: boolean) => {
    await authenticatedFetcher(`${API_BASE}/collaboration/comments/${commentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ commentId, projectId, resolved }),
    });
    await mutate(key);
  };

  const deleteComment = async (commentId: string) => {
    await authenticatedFetcher(`${API_BASE}/collaboration/comments/${commentId}`, {
      method: 'DELETE',
    });
    await mutate(key);
  };

  return {
    comments: data?.items ?? [],
    isLoading,
    error,
    createComment,
    resolveComment,
    deleteComment,
  };
}
```

---

### `apps/web/features/collaboration/hooks/useAssignment.ts`

```typescript
'use client';

import useSWR, { mutate } from 'swr';
import { authenticatedFetcher } from '@/lib/hooks/use-api';
import type { AssignmentsResponse, UpsertAssignmentDTO } from '@auto-rfp/core';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

export function useAssignments(projectId: string) {
  const key = `${API_BASE}/collaboration/assignments?projectId=${projectId}`;
  const { data, error, isLoading } = useSWR<AssignmentsResponse>(key, authenticatedFetcher);

  const upsertAssignment = async (dto: UpsertAssignmentDTO) => {
    await authenticatedFetcher(`${API_BASE}/collaboration/assignments`, {
      method: 'PUT',
      body: JSON.stringify(dto),
    });
    await mutate(key);
  };

  const assignmentByQuestion = (questionId: string) =>
    data?.items.find((a) => a.questionId === questionId);

  return { assignments: data?.items ?? [], assignmentByQuestion, isLoading, error, upsertAssignment };
}
```

---

### `apps/web/features/collaboration/hooks/useActivityFeed.ts`

```typescript
'use client';

import useSWRInfinite from 'swr/infinite';
import { authenticatedFetcher } from '@/lib/hooks/use-api';
import type { ActivityFeedResponse } from '@auto-rfp/core';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

export function useActivityFeed(projectId: string) {
  const getKey = (pageIndex: number, previousPageData: ActivityFeedResponse | null) => {
    if (previousPageData && !previousPageData.nextToken) return null;
    const base = `${API_BASE}/collaboration/activity?projectId=${projectId}&limit=20`;
    return pageIndex === 0 ? base : `${base}&nextToken=${previousPageData?.nextToken}`;
  };

  const { data, size, setSize, isLoading } = useSWRInfinite<ActivityFeedResponse>(
    getKey,
    authenticatedFetcher,
    { refreshInterval: 30_000 }, // poll every 30s as fallback
  );

  const activities = data?.flatMap((page) => page.items) ?? [];
  const hasMore = !!data?.[data.length - 1]?.nextToken;

  return { activities, isLoading, hasMore, loadMore: () => setSize(size + 1) };
}
```

---

### `apps/web/features/collaboration/components/PresenceAvatars.tsx`

```tsx
'use client';

import type { PresenceItem } from '@auto-rfp/core';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface PresenceAvatarsProps {
  users: PresenceItem[];
  maxVisible?: number;
}

const STATUS_COLORS: Record<string, string> = {
  editing: 'bg-amber-400',
  reviewing: 'bg-blue-400',
  generating: 'bg-purple-400',
  viewing: 'bg-emerald-400',
};

export function PresenceAvatars({ users, maxVisible = 5 }: PresenceAvatarsProps) {
  const visible = users.slice(0, maxVisible);
  const overflow = users.length - maxVisible;

  return (
    <div className="flex items-center -space-x-2">
      {visible.map((user) => (
        <Tooltip key={user.userId}>
          <TooltipTrigger asChild>
            <div className="relative">
              <div className="h-8 w-8 rounded-full bg-indigo-500 flex items-center justify-center text-white text-xs font-semibold ring-2 ring-white cursor-default select-none">
                {user.displayName.charAt(0).toUpperCase()}
              </div>
              <span
                className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-1 ring-white ${STATUS_COLORS[user.status] ?? 'bg-slate-400'}`}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p className="font-medium">{user.displayName}</p>
            <p className="text-xs text-slate-400 capitalize">{user.status}</p>
            {user.questionId && <p className="text-xs text-slate-400">on Q{user.questionId.slice(-4)}</p>}
          </TooltipContent>
        </Tooltip>
      ))}
      {overflow > 0 && (
        <div className="h-8 w-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 text-xs font-semibold ring-2 ring-white">
          +{overflow}
        </div>
      )}
    </div>
  );
}
```

---

### `apps/web/features/collaboration/components/EditingIndicator.tsx`

```tsx
'use client';

import type { PresenceItem } from '@auto-rfp/core';

interface EditingIndicatorProps {
  editors: PresenceItem[];
}

export function EditingIndicator({ editors }: EditingIndicatorProps) {
  if (editors.length === 0) return null;

  const names = editors.map((e) => e.displayName).join(', ');

  return (
    <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
      <span>
        <strong>{names}</strong> {editors.length === 1 ? 'is' : 'are'} editing…
      </span>
    </div>
  );
}
```

---

### `apps/web/features/collaboration/components/AssignmentBadge.tsx`

```tsx
'use client';

import { useState } from 'react';
import type { AssignmentItem, QuestionStatus, UserListItem } from '@auto-rfp/core';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const STATUS_STYLES: Record<QuestionStatus, string> = {
  UNASSIGNED:  'bg-slate-100 text-slate-600',
  ASSIGNED:    'bg-blue-100 text-blue-700',
  IN_PROGRESS: 'bg-amber-100 text-amber-700',
  IN_REVIEW:   'bg-purple-100 text-purple-700',
  APPROVED:    'bg-emerald-100 text-emerald-700',
};

interface AssignmentBadgeProps {
  assignment: AssignmentItem | undefined;
  questionId: string;
  projectId: string;
  teamMembers: UserListItem[];
  onUpdate: (status: QuestionStatus, assignedToUserId?: string) => Promise<void>;
  canEdit: boolean;
}

export function AssignmentBadge({
  assignment,
  questionId,
  projectId,
  teamMembers,
  onUpdate,
  canEdit,
}: AssignmentBadgeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const status = assignment?.status ?? 'UNASSIGNED';

  return (
    <div className="flex items-center gap-2">
      <Badge className={STATUS_STYLES[status]}>{status.replace('_', ' ')}</Badge>
      {assignment?.assignedToDisplayName && (
        <span className="text-xs text-slate-500">→ {assignment.assignedToDisplayName}</span>
      )}
      {canEdit && (
        <Select
          value={status}
          onValueChange={(val) => onUpdate(val as QuestionStatus, assignment?.assignedToUserId)}
        >
          <SelectTrigger className="h-6 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'IN_REVIEW', 'APPROVED'] as QuestionStatus[]).map((s) => (
              <SelectItem key={s} value={s} className="text-xs">
                {s.replace('_', ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
```

---

### `apps/web/features/collaboration/components/ActivityFeed.tsx`

```tsx
'use client';

import type { ActivityItem } from '@auto-rfp/core';
import { useActivityFeed } from '../hooks/useActivityFeed';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const ACTION_ICONS: Record<string, string> = {
  ANSWER_EDITED:     '📝',
  ANSWER_APPROVED:   '✅',
  COMMENT_ADDED:     '💬',
  COMMENT_RESOLVED:  '✔️',
  QUESTION_ASSIGNED: '👤',
  STATUS_CHANGED:    '🔄',
  BRIEF_GENERATED:   '📤',
  DOCUMENT_UPLOADED: '📎',
  USER_JOINED:       '🙋',
};

function timeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface ActivityFeedProps {
  projectId: string;
}

export function ActivityFeed({ projectId }: ActivityFeedProps) {
  const { activities, isLoading, hasMore, loadMore } = useActivityFeed(projectId);

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-4 w-4 rounded-full" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {activities.map((item) => (
        <div key={item.activityId} className="flex items-start gap-2 px-4 py-2 hover:bg-slate-50 rounded">
          <span className="text-base leading-none mt-0.5">{ACTION_ICONS[item.action] ?? '•'}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-700 truncate">
              <strong>{item.displayName}</strong> {item.target}
            </p>
            <p className="text-xs text-slate-400">{timeAgo(item.timestamp)}</p>
          </div>
        </div>
      ))}
      {hasMore && (
        <Button variant="ghost" size="sm" className="mx-4 mt-1" onClick={loadMore}>
          Load more
        </Button>
      )}
      {activities.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-8">No activity yet</p>
      )}
    </div>
  );
}
```

---

### `apps/web/features/collaboration/index.ts`

```typescript
export { PresenceAvatars } from './components/PresenceAvatars';
export { EditingIndicator } from './components/EditingIndicator';
export { AssignmentBadge } from './components/AssignmentBadge';
export { ActivityFeed } from './components/ActivityFeed';
export { CommentThread } from './components/CommentThread';
export { usePresence } from './hooks/usePresence';
export { useComments } from './hooks/useComments';
export { useAssignments } from './hooks/useAssignment';
export { useActivityFeed } from './hooks/useActivityFeed';
export { useWebSocket } from './hooks/useWebSocket';
```

---

### Environment Variable

Add to `apps/web/.env.example`:

```bash
NEXT_PUBLIC_WS_API_URL=wss://YOUR_WS_API_ID.execute-api.us-east-1.amazonaws.com/dev
```

---

## Permissions & RBAC

### New permissions to add to `packages/core/src/schemas/user.ts`

```typescript
// Add to ALL_PERMISSIONS array:
'collaboration:presence',
'collaboration:comment',
'collaboration:assign',
'collaboration:activity',

// Add to ROLE_PERMISSIONS:
VIEWER: [
  ...VIEWER_PERMISSIONS,
  'collaboration:presence',
  'collaboration:activity',
],
EDITOR: [
  ...existing EDITOR permissions,
  'collaboration:presence',
  'collaboration:comment',
  'collaboration:assign',
  'collaboration:activity',
],
ADMIN: [...ALL_PERMISSIONS], // already includes everything
```

### Permission Matrix

| Action | VIEWER | EDITOR | ADMIN |
|---|---|---|---|
| View presence | ✅ | ✅ | ✅ |
| View activity feed | ✅ | ✅ | ✅ |
| Create/reply to comments | ❌ | ✅ | ✅ |
| Resolve comments | ❌ | ✅ (own) | ✅ |
| Delete comments | ❌ | ✅ (own) | ✅ |
| Assign questions | ❌ | ✅ | ✅ |
| Change question status | ❌ | ✅ | ✅ |
| Approve questions | ❌ | ❌ | ✅ |

---

## Email Notifications

Email notifications are sent asynchronously via SES when:
- A user is @mentioned in a comment
- A question is assigned to a user
- A comment thread they participated in gets a new reply

### Architecture

```
create-comment Lambda
       │
       ├── writes comment to DynamoDB
       └── sends SQS message → notification-worker Lambda
                                       │
                                       ├── resolves mentioned user emails
                                       ├── renders email template
                                       └── sends via AWS SES
```

### `apps/functions/src/handlers/collaboration/notification-worker.ts`

```typescript
import type { SQSHandler } from 'aws-lambda';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { requireEnv } from '@/helpers/env';
import { getItem } from '@/helpers/db';
import { PK as USER_PK } from '@/constants/user'; // PK.USER constant

const ses = new SESClient({});
const FROM_EMAIL = requireEnv('NOTIFICATION_FROM_EMAIL');

interface NotificationPayload {
  type: 'MENTION' | 'ASSIGNMENT' | 'REPLY';
  commentId?: string;
  projectId: string;
  questionId?: string;
  actorDisplayName: string;
  mentionedUserIds?: string[];
  assignedToUserId?: string;
  content?: string;
}

export const handler: SQSHandler = async (event) => {
  for (const record of event.Records) {
    const payload = JSON.parse(record.body) as NotificationPayload;
    await processNotification(payload);
  }
};

async function processNotification(payload: NotificationPayload): Promise<void> {
  const recipientIds: string[] = [];

  if (payload.type === 'MENTION' && payload.mentionedUserIds) {
    recipientIds.push(...payload.mentionedUserIds);
  } else if (payload.type === 'ASSIGNMENT' && payload.assignedToUserId) {
    recipientIds.push(payload.assignedToUserId);
  }

  for (const userId of recipientIds) {
    // Fetch user email from DynamoDB
    // (simplified — in practice query by userId using byUserId GSI)
    const subject = buildSubject(payload);
    const body = buildBody(payload);

    await ses.send(new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: { ToAddresses: [/* resolved email */] },
      Message: {
        Subject: { Data: subject },
        Body: { Html: { Data: body } },
      },
    }));
  }
}

function buildSubject(payload: NotificationPayload): string {
  switch (payload.type) {
    case 'MENTION': return `${payload.actorDisplayName} mentioned you in a comment`;
    case 'ASSIGNMENT': return `You've been assigned a question`;
    case 'REPLY': return `New reply in a thread you follow`;
  }
}

function buildBody(payload: NotificationPayload): string {
  return `
    <html><body>
      <h2>${buildSubject(payload)}</h2>
      <p>${payload.actorDisplayName} ${payload.type === 'MENTION' ? 'mentioned you' : 'assigned you a question'} in project ${payload.projectId}.</p>
      ${payload.content ? `<blockquote>${payload.content}</blockquote>` : ''}
      <p><a href="${process.env.APP_URL}/projects/${payload.projectId}">View in AutoRFP</a></p>
    </body></html>
  `;
}
```

### CDK: Add SQS Queue + Worker Lambda

```typescript
// In CollaborationWebSocketStack or a new CollaborationNotificationStack:

const notificationQueue = new sqs.Queue(this, 'NotificationQueue', {
  queueName: `auto-rfp-collab-notifications-${stage}`,
  visibilityTimeout: cdk.Duration.seconds(60),
  deadLetterQueue: {
    queue: new sqs.Queue(this, 'NotificationDLQ', {
      queueName: `auto-rfp-collab-notifications-dlq-${stage}`,
    }),
    maxReceiveCount: 3,
  },
});

const notificationWorker = new lambdaNodejs.NodejsFunction(this, 'NotificationWorker', {
  functionName: `auto-rfp-collab-notification-worker-${stage}`,
  entry: path.join(__dirname, '../../apps/functions/src/handlers/collaboration/notification-worker.ts'),
  handler: 'handler',
  runtime: lambda.Runtime.NODEJS_20_X,
  timeout: cdk.Duration.seconds(30),
  memorySize: 256,
  role: lambdaRole,
  environment: {
    ...commonEnv,
    NOTIFICATION_FROM_EMAIL: 'noreply@auto-rfp.com',
    NOTIFICATION_QUEUE_URL: notificationQueue.queueUrl,
  },
  bundling: { minify: true, sourceMap: true, externalModules: ['@aws-sdk/*'] },
});

notificationWorker.addEventSource(
  new lambdaEventSources.SqsEventSource(notificationQueue, {
    batchSize: 10,
    reportBatchItemFailures: true,
  }),
);

// Grant SES send permission
lambdaRole.addToPrincipalPolicy(new iam.PolicyStatement({
  actions: ['ses:SendEmail', 'ses:SendRawEmail'],
  resources: ['*'],
}));
```

---

## CDK Stack Updates

### Summary of all infrastructure changes

| Resource | Type | Purpose |
|---|---|---|
| `CollaborationWebSocketStack` | New CDK Stack | WebSocket API + 3 Lambda handlers |
| `auto-rfp-ws-connect-{stage}` | Lambda | Handle WS $connect |
| `auto-rfp-ws-disconnect-{stage}` | Lambda | Handle WS $disconnect |
| `auto-rfp-ws-message-{stage}` | Lambda | Handle WS messages + broadcast |
| `auto-rfp-ws-authorizer-{stage}` | Lambda | Validate Cognito JWT on WS connect |
| `CollaborationRoutes` (nested stack) | API GW REST routes | 8 REST endpoints |
| `auto-rfp-collab-notification-worker-{stage}` | Lambda | Send email notifications |
| `auto-rfp-collab-notifications-{stage}` | SQS Queue | Async notification delivery |
| `auto-rfp-collab-notifications-dlq-{stage}` | SQS DLQ | Failed notification retry |
| DynamoDB TTL on `ttl` attribute | Existing table | Auto-expire presence + activity |

### DynamoDB TTL — enable on existing table

The existing `RFP-table-{stage}` already has `stream: StreamViewType.NEW_IMAGE`. Add TTL:

```typescript
// In database-stack.ts, add after table creation:
const cfnTable = this.tableName.node.defaultChild as dynamodb.CfnTable;
cfnTable.timeToLiveSpecification = {
  attributeName: 'ttl',
  enabled: true,
};
```

### IAM additions to shared Lambda role

```typescript
// In api-orchestrator-stack.ts, add:
sharedInfraStack.commonLambdaRole.addToPrincipalPolicy(
  new iam.PolicyStatement({
    actions: ['execute-api:ManageConnections'],
    resources: [`arn:aws:execute-api:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:*/*/POST/@connections/*`],
  }),
);

sharedInfraStack.commonLambdaRole.addToPrincipalPolicy(
  new iam.PolicyStatement({
    actions: ['ses:SendEmail', 'ses:SendRawEmail'],
    resources: ['*'],
  }),
);

sharedInfraStack.commonLambdaRole.addToPrincipalPolicy(
  new iam.PolicyStatement({
    actions: ['sqs:SendMessage'],
    resources: [notificationQueue.queueArn],
  }),
);
```

---

## Implementation Tickets

### Sprint 1 — Core Infrastructure (5–6 hrs)

#### Ticket C-1: Zod Schemas & Constants
**Estimate:** 1 hr  
**Files:**
- `packages/core/src/schemas/collaboration.ts` — all schemas
- `packages/core/src/schemas/index.ts` — re-export
- `apps/functions/src/constants/collaboration.ts` — PK constants + TTL values
- `apps/functions/src/helpers/collaboration.ts` — SK builder functions

**Acceptance Criteria:**
- [ ] All schemas defined and exported from `@auto-rfp/core`
- [ ] Types inferred from Zod (no manual type definitions)
- [ ] SK builder functions unit-tested

---

#### Ticket C-2: DynamoDB TTL
**Estimate:** 0.5 hr  
**Files:**
- `packages/infra/database-stack.ts` — add TTL spec

**Acceptance Criteria:**
- [ ] TTL enabled on `ttl` attribute
- [ ] Presence records expire after 90s
- [ ] Activity records expire after 90 days

---

#### Ticket C-3: WebSocket CDK Stack
**Estimate:** 2 hrs  
**Files:**
- `packages/infra/collaboration-websocket-stack.ts`
- `packages/infra/bin/auto-rfp-infrastructure.ts`

**Acceptance Criteria:**
- [ ] WebSocket API deployed to dev
- [ ] $connect, $disconnect, $default routes wired
- [ ] Cognito JWT authorizer working
- [ ] `WS_API_ENDPOINT` env var injected into message Lambda

---

#### Ticket C-4: WebSocket Lambda Handlers
**Estimate:** 2 hrs  
**Files:**
- `apps/functions/src/handlers/collaboration/ws-connect.ts`
- `apps/functions/src/handlers/collaboration/ws-disconnect.ts`
- `apps/functions/src/handlers/collaboration/ws-message.ts`
- `apps/functions/src/handlers/collaboration/ws-authorizer.ts`

**Acceptance Criteria:**
- [ ] Connect stores connection record in DynamoDB
- [ ] Disconnect removes presence + connection records
- [ ] Heartbeat upserts presence with TTL
- [ ] Broadcast reaches all connections in same project
- [ ] Stale connections handled gracefully (GoneException caught)

---

### Sprint 2 — REST API (3–4 hrs)

#### Ticket C-5: Presence & Activity REST Handlers
**Estimate:** 1 hr  
**Files:**
- `apps/functions/src/handlers/collaboration/get-presence.ts`
- `apps/functions/src/handlers/collaboration/get-activity-feed.ts`

---

#### Ticket C-6: Comment REST Handlers
**Estimate:** 1.5 hrs  
**Files:**
- `apps/functions/src/handlers/collaboration/create-comment.ts`
- `apps/functions/src/handlers/collaboration/get-comments.ts`
- `apps/functions/src/handlers/collaboration/update-comment.ts`
- `apps/functions/src/handlers/collaboration/delete-comment.ts`

**Acceptance Criteria:**
- [ ] Threaded comments (parentCommentId) supported
- [ ] @mentions stored as userId array
- [ ] Soft delete (deletedAt) implemented
- [ ] Resolve/unresolve working

---

#### Ticket C-7: Assignment REST Handlers
**Estimate:** 1 hr  
**Files:**
- `apps/functions/src/handlers/collaboration/upsert-assignment.ts`
- `apps/functions/src/handlers/collaboration/get-assignments.ts`

---

#### Ticket C-8: API Routes Registration
**Estimate:** 0.5 hr  
**Files:**
- `packages/infra/api/routes/collaboration.routes.ts`
- `packages/infra/api/api-orchestrator-stack.ts`

---

### Sprint 3 — Frontend (5–6 hrs)

#### Ticket C-9: WebSocket Client & Core Hooks
**Estimate:** 2 hrs  
**Files:**
- `apps/web/features/collaboration/lib/ws-client.ts`
- `apps/web/features/collaboration/hooks/useWebSocket.ts`
- `apps/web/features/collaboration/hooks/usePresence.ts`

---

#### Ticket C-10: Data Hooks
**Estimate:** 1 hr  
**Files:**
- `apps/web/features/collaboration/hooks/useComments.ts`
- `apps/web/features/collaboration/hooks/useAssignment.ts`
- `apps/web/features/collaboration/hooks/useActivityFeed.ts`

---

#### Ticket C-11: UI Components
**Estimate:** 2 hrs  
**Files:**
- `apps/web/features/collaboration/components/PresenceAvatars.tsx`
- `apps/web/features/collaboration/components/EditingIndicator.tsx`
- `apps/web/features/collaboration/components/CommentThread.tsx`
- `apps/web/features/collaboration/components/CommentInput.tsx`
- `apps/web/features/collaboration/components/AssignmentBadge.tsx`
- `apps/web/features/collaboration/components/ActivityFeed.tsx`
- `apps/web/features/collaboration/components/CollaborationPanel.tsx`
- `apps/web/features/collaboration/index.ts`

---

#### Ticket C-12: Integration into Proposal View
**Estimate:** 1 hr  

Integrate collaboration components into the existing proposal/question view:
- Add `<PresenceAvatars>` to the project header
- Add `<EditingIndicator>` above each answer textarea
- Add `<AssignmentBadge>` to each question row
- Add `<CollaborationPanel>` as a collapsible side panel with comments + activity feed
- Call `updatePresence()` when user focuses an answer textarea
- Call `lockEditing()` / `unlockEditing()` on focus/blur

---

### Sprint 4 — Notifications & Polish (2 hrs)

#### Ticket C-13: Email Notification Worker
**Estimate:** 1.5 hrs  
**Files:**
- `apps/functions/src/handlers/collaboration/notification-worker.ts`
- CDK: SQS queue + worker Lambda

---

#### Ticket C-14: E2E Tests
**Estimate:** 0.5 hr  
**Files:**
- `apps/web/e2e/collaboration.auth.spec.ts`

**Test scenarios:**
- [ ] Two users connect to same project → see each other's presence
- [ ] User creates comment → other user receives WS broadcast
- [ ] User assigns question → status badge updates
- [ ] Activity feed shows all actions

---

## Acceptance Criteria Checklist

### Real-Time Presence
- [ ] Users see avatars of all active collaborators in the project header
- [ ] Avatar tooltip shows name, status, and current question
- [ ] Presence disappears within 90s of disconnect/inactivity
- [ ] Status dot color reflects current activity (editing/reviewing/generating/viewing)

### Comment Threads
- [ ] Comments can be added to any question answer
- [ ] Threaded replies supported (one level deep)
- [ ] @mention autocomplete shows org members
- [ ] Mentioned users receive email notification
- [ ] Comments can be resolved/unresolved
- [ ] Resolved comments visually distinguished

### Assignment Workflow
- [ ] Any question can be assigned to a team member
- [ ] Status transitions: UNASSIGNED → ASSIGNED → IN_PROGRESS → IN_REVIEW → APPROVED
- [ ] Assignment badge visible on each question row
- [ ] Assigned user receives email notification
- [ ] Assignments visible to all project members

### Activity Feed
- [ ] All actions logged: edits, approvals, comments, assignments, generation
- [ ] Feed sorted newest-first with relative timestamps
- [ ] Paginated (20 items per page, load more)
- [ ] Auto-refreshes every 30s
- [ ] Activity records auto-expire after 90 days

### Conflict Prevention
- [ ] "X is editing..." indicator shown when another user is editing a question
- [ ] Editing lock broadcast via WebSocket within 1s
- [ ] Lock released on blur/disconnect
- [ ] Auto-save drafts every 5s while editing (frontend only, uses localStorage)

### WebSocket Stability
- [ ] Reconnects automatically after disconnect (3s backoff)
- [ ] Heartbeat sent every 30s
- [ ] Stale connections cleaned up on disconnect
- [ ] Works with Cognito JWT auth

### Email Notifications
- [ ] @mention triggers email to mentioned user
- [ ] Assignment triggers email to assignee
- [ ] Emails sent within 60s of action
- [ ] Unsubscribe link included (future)

---

## Summary of New Files

| File | Purpose |
|---|---|
| `packages/core/src/schemas/collaboration.ts` | All Zod schemas |
| `apps/functions/src/constants/collaboration.ts` | PK constants, TTL values |
| `apps/functions/src/helpers/collaboration.ts` | SK builders |
| `apps/functions/src/handlers/collaboration/ws-connect.ts` | WS $connect |
| `apps/functions/src/handlers/collaboration/ws-disconnect.ts` | WS $disconnect |
| `apps/functions/src/handlers/collaboration/ws-message.ts` | WS $default |
| `apps/functions/src/handlers/collaboration/ws-authorizer.ts` | WS JWT authorizer |
| `apps/functions/src/handlers/collaboration/get-presence.ts` | REST: list presence |
| `apps/functions/src/handlers/collaboration/create-comment.ts` | REST: create comment |
| `apps/functions/src/handlers/collaboration/get-comments.ts` | REST: list comments |
| `apps/functions/src/handlers/collaboration/update-comment.ts` | REST: edit/resolve comment |
| `apps/functions/src/handlers/collaboration/delete-comment.ts` | REST: soft-delete comment |
| `apps/functions/src/handlers/collaboration/upsert-assignment.ts` | REST: assign question |
| `apps/functions/src/handlers/collaboration/get-assignments.ts` | REST: list assignments |
| `apps/functions/src/handlers/collaboration/get-activity-feed.ts` | REST: activity feed |
| `apps/functions/src/handlers/collaboration/notification-worker.ts` | SQS: email notifications |
| `packages/infra/collaboration-websocket-stack.ts` | CDK: WS API stack |
| `packages/infra/api/routes/collaboration.routes.ts` | CDK: REST routes |
| `apps/web/features/collaboration/lib/ws-client.ts` | WS singleton |
| `apps/web/features/collaboration/hooks/useWebSocket.ts` | WS React hook |
| `apps/web/features/collaboration/hooks/usePresence.ts` | Presence hook |
| `apps/web/features/collaboration/hooks/useComments.ts` | Comments hook |
| `apps/web/features/collaboration/hooks/useAssignment.ts` | Assignment hook |
| `apps/web/features/collaboration/hooks/useActivityFeed.ts` | Activity feed hook |
| `apps/web/features/collaboration/components/PresenceAvatars.tsx` | Avatar row |
| `apps/web/features/collaboration/components/EditingIndicator.tsx` | Editing banner |
| `apps/web/features/collaboration/components/CommentThread.tsx` | Comment UI |
| `apps/web/features/collaboration/components/CommentInput.tsx` | @mention input |
| `apps/web/features/collaboration/components/AssignmentBadge.tsx` | Status badge |
| `apps/web/features/collaboration/components/ActivityFeed.tsx` | Activity list |
| `apps/web/features/collaboration/components/CollaborationPanel.tsx` | Side panel |
| `apps/web/features/collaboration/index.ts` | Barrel export |
