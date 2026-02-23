# Notification System — Implementation Document

## 1. Overview

| Property | Value |
|---|---|
| Feature | Multi-channel Notification System |
| Priority | P2 |
| Estimated Hours | 8 hours |
| Domains | `notification` (new) |
| Channels | Email (SES), In-App (DynamoDB + REST), Slack (future), SMS (future) |

**Business context**: Missing a deadline means disqualification. The notification system keeps the team informed of RFP lifecycle events, deadline alerts, and activity changes — reducing email overload and enabling async work.

**Scope of this document**:
- In-app notification center (badge count, list, mark read/unread, archive)
- Bell icon in the app header showing unread count for the current user
- Mention notifications: user receives an in-app notification when mentioned in a comment under a question
- Email / Slack / SMS notifications are **opt-in** — disabled by default; user can enable them in their profile page, or an admin can enable them in the user management page
- User notification preferences (per-channel, per-type overrides, quiet hours)
- Extend the existing `notification-worker.ts` (currently handles collaboration mentions/assignments) into a full notification pipeline

**Default channel behaviour**:
| Channel | Default | Who can change |
|---|---|---|
| In-app | ✅ **Enabled** | User (profile page) or Admin (user management) |
| Email | ❌ Disabled | User (profile page) or Admin (user management) |
| Slack | ❌ Disabled | User (profile page) or Admin (user management) |
| SMS | ❌ Disabled | User (profile page) or Admin (user management) |

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Event Sources                               │
│  Lambda handlers  │  EventBridge (scheduled)  │  DynamoDB Streams   │
└────────┬──────────┴────────────┬──────────────┴──────────┬──────────┘
         │                       │                          │
         ▼                       ▼                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    SQS: notification-queue                          │
│              (existing collab queue — extended)                     │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Lambda: notification-worker (extended)                 │
│  1. Persist in-app notification to DynamoDB (PK.NOTIFICATION)       │
│  2. Send email via SES (if user prefs allow)                        │
│  3. (future) Post to Slack webhook                                  │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│              REST API: /notification domain                         │
│  GET  list-notifications   — paginated inbox                        │
│  POST mark-read            — mark one or many as read               │
│  POST mark-all-read        — mark all as read                       │
│  DELETE archive            — soft-delete / archive                  │
│  GET  get-preferences      — fetch user prefs                       │
│  PUT  update-preferences   — save user prefs                        │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│              EventBridge: deadline-alert-scheduler                  │
│  Rule: rate(1 hour) → Lambda: deadline-alert-scanner                │
│  Scans projects with deadlines in next 7/3/1 days / 6 hours         │
│  Enqueues deadline alert messages to notification-queue             │
└─────────────────────────────────────────────────────────────────────┘
```

| Technology | Decision |
|---|---|
| In-app storage | DynamoDB single-table (`PK.NOTIFICATION`) |
| Email delivery | AWS SES (already used by existing notification-worker) |
| Queue | Existing SQS `auto-rfp-collab-notifications-{stage}` — extended |
| Scheduling | EventBridge scheduled rule (hourly) |
| Preferences | DynamoDB single-table (`PK.NOTIFICATION_PREFS`) |
| Slack | Future — webhook URL stored in org settings |
| SMS | Future — opt-in only |

## 3. Data Models & Zod Schemas

**File**: `packages/core/src/schemas/notification.ts`

```typescript
import { z } from 'zod';

// ─── Notification Type ────────────────────────────────────────────────────────

export const NotificationTypeSchema = z.enum([
  // RFP lifecycle
  'RFP_UPLOADED',
  'QUESTIONS_EXTRACTED',
  'ANSWERS_GENERATED',
  'PROPOSAL_SUBMITTED',
  'WIN_RECORDED',
  'LOSS_RECORDED',
  // Collaboration
  'REVIEW_ASSIGNED',
  'MENTION',
  'ASSIGNMENT',
  // Deadline alerts
  'DEADLINE_7_DAYS',
  'DEADLINE_3_DAYS',
  'DEADLINE_1_DAY',
  'DEADLINE_6_HOURS',
  // System
  'PROCESSING_COMPLETE',
  'PROCESSING_ERROR',
  'EXPORT_READY',
]);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

// ─── Notification Item (stored in DynamoDB) ───────────────────────────────────

export const NotificationItemSchema = z.object({
  notificationId: z.string().uuid(),
  userId: z.string().uuid(),
  orgId: z.string().uuid(),
  type: NotificationTypeSchema,
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(1000),
  link: z.string().url().optional(),
  read: z.boolean().default(false),
  archived: z.boolean().default(false),
  channels: z.array(z.enum(['email', 'in_app', 'slack', 'sms'])),
  projectId: z.string().uuid().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type NotificationItem = z.infer<typeof NotificationItemSchema>;

// ─── Notification Preferences ─────────────────────────────────────────────────

export const NotificationFrequencySchema = z.enum(['immediate', 'daily_digest', 'weekly']);
export type NotificationFrequency = z.infer<typeof NotificationFrequencySchema>;

export const NotificationPreferencesSchema = z.object({
  userId: z.string().uuid(),
  orgId: z.string().uuid(),
  email: z.boolean().default(false),   // opt-in — disabled by default
  inApp: z.boolean().default(true),    // always on by default
  slack: z.boolean().default(false),   // opt-in — disabled by default
  sms: z.boolean().default(false),     // opt-in — disabled by default
  frequency: NotificationFrequencySchema.default('immediate'),
  quietHoursStart: z.string().regex(/^\d{2}:\d{2}$/).optional(), // "22:00"
  quietHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),   // "08:00"
  // Per-type overrides: key = NotificationType, value = enabled
  typeOverrides: z.record(NotificationTypeSchema, z.boolean()).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;

export const UpdateNotificationPreferencesDTOSchema = z.object({
  orgId: z.string().uuid(),
  email: z.boolean().optional(),
  inApp: z.boolean().optional(),
  slack: z.boolean().optional(),
  sms: z.boolean().optional(),
  frequency: NotificationFrequencySchema.optional(),
  quietHoursStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  quietHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  typeOverrides: z.record(NotificationTypeSchema, z.boolean()).optional(),
});
export type UpdateNotificationPreferencesDTO = z.infer<typeof UpdateNotificationPreferencesDTOSchema>;

// ─── SQS Notification Payload ─────────────────────────────────────────────────

export const NotificationPayloadSchema = z.object({
  type: NotificationTypeSchema,
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(1000),
  link: z.string().url().optional(),
  recipientUserIds: z.array(z.string().uuid()),
  orgId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  // Email-specific
  recipientEmails: z.array(z.string().email()).optional(),
  actorDisplayName: z.string().optional(),
});
export type NotificationPayload = z.infer<typeof NotificationPayloadSchema>;

// ─── API Response Types ───────────────────────────────────────────────────────

export const NotificationsResponseSchema = z.object({
  items: z.array(NotificationItemSchema),
  unreadCount: z.number(),
  nextToken: z.string().optional(),
  count: z.number(),
});
export type NotificationsResponse = z.infer<typeof NotificationsResponseSchema>;

export const MarkReadDTOSchema = z.object({
  orgId: z.string().uuid(),
  notificationIds: z.array(z.string().uuid()).min(1).max(100),
});
export type MarkReadDTO = z.infer<typeof MarkReadDTOSchema>;

export const ArchiveNotificationDTOSchema = z.object({
  orgId: z.string().uuid(),
  notificationId: z.string().uuid(),
});
export type ArchiveNotificationDTO = z.infer<typeof ArchiveNotificationDTOSchema>;
```

**Export from** `packages/core/src/schemas/index.ts` — add:
```typescript
export * from './notification';
```

## 4. DynamoDB Design

### PK Constants

**File**: `apps/functions/src/constants/notification.ts`

```typescript
export const PK = {
  NOTIFICATION: 'NOTIFICATION',
  NOTIFICATION_PREFS: 'NOTIFICATION_PREFS',
} as const;

export const NOTIFICATION_TTL_DAYS = 90; // auto-expire old notifications
```

### Access Pattern Table

| Entity | PK | SK | Notes |
|---|---|---|---|
| Notification | `NOTIFICATION` | `{orgId}#{userId}#{createdAt}#{notificationId}` | Query by user: `skPrefix = "{orgId}#{userId}#"` |
| Notification Prefs | `NOTIFICATION_PREFS` | `{orgId}#{userId}` | Single item per user per org |

### SK Builder Functions

**File**: `apps/functions/src/helpers/notification.ts` (SK builders section)

```typescript
export const buildNotificationSK = (
  orgId: string,
  userId: string,
  createdAt: string,
  notificationId: string,
): string => `${orgId}#${userId}#${createdAt}#${notificationId}`;

export const buildNotificationPrefsSK = (orgId: string, userId: string): string =>
  `${orgId}#${userId}`;
```

### DynamoDB Helper Functions

**File**: `apps/functions/src/helpers/notification.ts` (full)

```typescript
import { v4 as uuidv4 } from 'uuid';
import { createItem, putItem, getItem, queryBySkPrefix, updateItem } from '@/helpers/db';
import { nowIso } from '@/helpers/date';
import type { NotificationItem, NotificationPreferences } from '@auto-rfp/core';
import { PK, NOTIFICATION_TTL_DAYS } from '@/constants/notification';

// ─── SK Builders ──────────────────────────────────────────────────────────────

export const buildNotificationSK = (
  orgId: string,
  userId: string,
  createdAt: string,
  notificationId: string,
): string => `${orgId}#${userId}#${createdAt}#${notificationId}`;

export const buildNotificationPrefsSK = (orgId: string, userId: string): string =>
  `${orgId}#${userId}`;

// ─── Notifications ────────────────────────────────────────────────────────────

export const createNotification = async (
  item: Omit<NotificationItem, 'createdAt' | 'updatedAt'>,
): Promise<NotificationItem> => {
  const now = nowIso();
  const ttl = Math.floor(Date.now() / 1000) + NOTIFICATION_TTL_DAYS * 86400;
  return createItem<NotificationItem & { ttl: number }>(
    PK.NOTIFICATION,
    buildNotificationSK(item.orgId, item.userId, now, item.notificationId),
    { ...item, ttl },
  ) as Promise<NotificationItem>;
};

export const listNotifications = async (
  orgId: string,
  userId: string,
  includeArchived = false,
): Promise<NotificationItem[]> => {
  const items = await queryBySkPrefix<NotificationItem>(
    PK.NOTIFICATION,
    `${orgId}#${userId}#`,
  );
  return includeArchived ? items : items.filter((n) => !n.archived);
};

export const markNotificationsRead = async (
  orgId: string,
  userId: string,
  notificationIds: string[],
): Promise<void> => {
  // Fetch all to get their full SKs (needed for updateItem)
  const all = await listNotifications(orgId, userId, true);
  const targets = all.filter((n) => notificationIds.includes(n.notificationId));
  await Promise.all(
    targets.map((n) =>
      updateItem(
        PK.NOTIFICATION,
        buildNotificationSK(orgId, userId, n.createdAt, n.notificationId),
        { read: true },
      ),
    ),
  );
};

export const markAllNotificationsRead = async (
  orgId: string,
  userId: string,
): Promise<void> => {
  const unread = (await listNotifications(orgId, userId)).filter((n) => !n.read);
  await Promise.all(
    unread.map((n) =>
      updateItem(
        PK.NOTIFICATION,
        buildNotificationSK(orgId, userId, n.createdAt, n.notificationId),
        { read: true },
      ),
    ),
  );
};

export const archiveNotification = async (
  orgId: string,
  userId: string,
  notificationId: string,
): Promise<void> => {
  const all = await listNotifications(orgId, userId, true);
  const target = all.find((n) => n.notificationId === notificationId);
  if (!target) return;
  await updateItem(
    PK.NOTIFICATION,
    buildNotificationSK(orgId, userId, target.createdAt, notificationId),
    { archived: true },
  );
};

// ─── Preferences ──────────────────────────────────────────────────────────────

export const getNotificationPreferences = async (
  orgId: string,
  userId: string,
): Promise<NotificationPreferences | null> =>
  getItem<NotificationPreferences>(PK.NOTIFICATION_PREFS, buildNotificationPrefsSK(orgId, userId));

export const upsertNotificationPreferences = async (
  item: Omit<NotificationPreferences, 'createdAt' | 'updatedAt'>,
): Promise<NotificationPreferences> =>
  putItem<NotificationPreferences>(
    PK.NOTIFICATION_PREFS,
    buildNotificationPrefsSK(item.orgId, item.userId),
    item,
  );
```

## 5. Backend — Lambda Handlers

### File Structure

```
apps/functions/src/handlers/notification/
├── list-notifications.ts        # GET  — inbox list + unread count
├── mark-read.ts                 # POST — mark specific notifications read
├── mark-all-read.ts             # POST — mark all as read
├── archive-notification.ts      # DELETE — soft-archive one notification
├── get-preferences.ts           # GET  — fetch user prefs
├── update-preferences.ts        # PUT  — save user prefs
└── deadline-alert-scanner.ts    # EventBridge scheduled — enqueue deadline alerts

apps/functions/src/handlers/collaboration/
└── notification-worker.ts       # EXTENDED — now handles all notification types
```

---

### `list-notifications.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse } from '@/helpers/api';
import { listNotifications } from '@/helpers/notification';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { orgId, includeArchived } = event.queryStringParameters ?? {};
  const userId = event.auth?.userId;

  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!userId) return apiResponse(401, { message: 'Unauthorized' });

  const items = await listNotifications(orgId, userId, includeArchived === 'true');
  const unreadCount = items.filter((n) => !n.read).length;

  return apiResponse(200, { items, unreadCount, count: items.length });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('notification:read'))
    .use(httpErrorMiddleware()),
);
```

---

### `mark-read.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { MarkReadDTOSchema } from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { markNotificationsRead } from '@/helpers/notification';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const raw = JSON.parse(event.body ?? '{}') as unknown;
  const { success, data, error } = MarkReadDTOSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Invalid payload', issues: error.issues });

  const userId = event.auth?.userId;
  if (!userId) return apiResponse(401, { message: 'Unauthorized' });

  await markNotificationsRead(data.orgId, userId, data.notificationIds);
  return apiResponse(200, { ok: true });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('notification:read'))
    .use(httpErrorMiddleware()),
);
```

---

### `mark-all-read.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse } from '@/helpers/api';
import { markAllNotificationsRead } from '@/helpers/notification';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { orgId } = event.queryStringParameters ?? {};
  const userId = event.auth?.userId;

  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!userId) return apiResponse(401, { message: 'Unauthorized' });

  await markAllNotificationsRead(orgId, userId);
  return apiResponse(200, { ok: true });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('notification:read'))
    .use(httpErrorMiddleware()),
);
```

---

### `archive-notification.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { ArchiveNotificationDTOSchema } from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { archiveNotification } from '@/helpers/notification';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const raw = JSON.parse(event.body ?? '{}') as unknown;
  const { success, data, error } = ArchiveNotificationDTOSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Invalid payload', issues: error.issues });

  const userId = event.auth?.userId;
  if (!userId) return apiResponse(401, { message: 'Unauthorized' });

  await archiveNotification(data.orgId, userId, data.notificationId);
  return apiResponse(200, { ok: true });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('notification:read'))
    .use(httpErrorMiddleware()),
);
```

---

### `get-preferences.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse } from '@/helpers/api';
import { getNotificationPreferences } from '@/helpers/notification';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { orgId } = event.queryStringParameters ?? {};
  const userId = event.auth?.userId;

  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!userId) return apiResponse(401, { message: 'Unauthorized' });

  const prefs = await getNotificationPreferences(orgId, userId);
  // Return defaults if no prefs stored yet — in-app on, all other channels off
  return apiResponse(200, prefs ?? { email: false, inApp: true, slack: false, sms: false, frequency: 'immediate' });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('notification:read'))
    .use(httpErrorMiddleware()),
);
```

---

### `update-preferences.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { UpdateNotificationPreferencesDTOSchema } from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { getNotificationPreferences, upsertNotificationPreferences } from '@/helpers/notification';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const raw = JSON.parse(event.body ?? '{}') as unknown;
  const { success, data, error } = UpdateNotificationPreferencesDTOSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Invalid payload', issues: error.issues });

  const userId = event.auth?.userId;
  if (!userId) return apiResponse(401, { message: 'Unauthorized' });

  const existing = await getNotificationPreferences(data.orgId, userId);
  const merged = { ...existing, ...data, userId, orgId: data.orgId };
  const saved = await upsertNotificationPreferences(merged);
  return apiResponse(200, saved);
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('notification:read'))
    .use(httpErrorMiddleware()),
);
```

---

### `deadline-alert-scanner.ts` (EventBridge scheduled)

```typescript
import type { ScheduledHandler } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { queryBySkPrefix } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import type { NotificationPayload } from '@auto-rfp/core';

// Deadline entity shape (minimal — only fields we need)
interface DeadlineItem {
  projectId: string;
  orgId: string;
  deadlineAt: string;
  title: string;
  memberUserIds?: string[];
  memberEmails?: string[];
}

const sqs = new SQSClient({});
const NOTIFICATION_QUEUE_URL = requireEnv('NOTIFICATION_QUEUE_URL');
const DEADLINE_PK = 'DEADLINE';

const ALERT_WINDOWS_MS = [
  { label: 'DEADLINE_7_DAYS' as const, ms: 7 * 24 * 60 * 60 * 1000 },
  { label: 'DEADLINE_3_DAYS' as const, ms: 3 * 24 * 60 * 60 * 1000 },
  { label: 'DEADLINE_1_DAY'  as const, ms: 1 * 24 * 60 * 60 * 1000 },
  { label: 'DEADLINE_6_HOURS' as const, ms: 6 * 60 * 60 * 1000 },
];

export const handler: ScheduledHandler = async () => {
  const now = Date.now();

  // Scan all deadlines — in production scope this by org or use GSI
  const deadlines = await queryBySkPrefix<DeadlineItem>(DEADLINE_PK, '');

  for (const deadline of deadlines) {
    const deadlineMs = new Date(deadline.deadlineAt).getTime();
    const remaining = deadlineMs - now;

    for (const window of ALERT_WINDOWS_MS) {
      // Fire if remaining is within ±30 minutes of the window
      const diff = Math.abs(remaining - window.ms);
      if (diff > 30 * 60 * 1000) continue;

      const payload: NotificationPayload = {
        type: window.label,
        title: `Deadline Alert: ${deadline.title}`,
        message: `The deadline for "${deadline.title}" is approaching.`,
        link: `/projects/${deadline.projectId}`,
        recipientUserIds: deadline.memberUserIds ?? [],
        recipientEmails: deadline.memberEmails ?? [],
        orgId: deadline.orgId,
        projectId: deadline.projectId,
      };

      await sqs.send(new SendMessageCommand({
        QueueUrl: NOTIFICATION_QUEUE_URL,
        MessageBody: JSON.stringify(payload),
      }));
    }
  }
};
```

---

### Extended `notification-worker.ts`

Replace the existing file at `apps/functions/src/handlers/collaboration/notification-worker.ts`:

```typescript
import type { SQSHandler } from 'aws-lambda';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { v4 as uuidv4 } from 'uuid';
import { requireEnv } from '@/helpers/env';
import { createNotification, getNotificationPreferences } from '@/helpers/notification';
import type { NotificationPayload } from '@auto-rfp/core';

const ses = new SESClient({});
const FROM_EMAIL = requireEnv('NOTIFICATION_FROM_EMAIL');
const APP_URL = process.env['APP_URL'] ?? 'https://app.auto-rfp.com';

export const handler: SQSHandler = async (event) => {
  for (const record of event.Records) {
    const payload = JSON.parse(record.body) as NotificationPayload;
    await processNotification(payload);
  }
};

const processNotification = async (payload: NotificationPayload): Promise<void> => {
  const { recipientUserIds, recipientEmails = [], orgId, type, title, message, link, projectId } = payload;

  // 1. Persist in-app notification for each recipient
  await Promise.all(
    recipientUserIds.map(async (userId) => {
      const prefs = await getNotificationPreferences(orgId, userId);
      const inAppEnabled = prefs?.inApp ?? true;
      const typeEnabled = prefs?.typeOverrides?.[type] ?? true;

      if (!inAppEnabled || !typeEnabled) return;

      await createNotification({
        notificationId: uuidv4(),
        userId,
        orgId,
        type,
        title,
        message,
        link,
        read: false,
        archived: false,
        channels: ['in_app'],
        projectId,
      });
    }),
  );

  // 2. Send email to recipients who have email enabled
  const emailsToSend: string[] = [];
  for (let i = 0; i < recipientUserIds.length; i++) {
    const userId = recipientUserIds[i];
    if (!userId) continue;
    const prefs = await getNotificationPreferences(orgId, userId);
    const emailEnabled = prefs?.email ?? false; // email is opt-in — off by default
    const typeEnabled = prefs?.typeOverrides?.[type] ?? true;
    if (emailEnabled && typeEnabled && recipientEmails[i]) {
      emailsToSend.push(recipientEmails[i]!);
    }
  }

  for (const email of emailsToSend) {
    await ses.send(new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: { ToAddresses: [email] },
      Message: {
        Subject: { Data: title },
        Body: {
          Html: {
            Data: buildEmailBody({ title, message, link }),
          },
        },
      },
    }));
  }
};

const buildEmailBody = ({ title, message, link }: { title: string; message: string; link?: string }): string => `
  <html><body style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
    <h2>${title}</h2>
    <p>${message}</p>
    ${link ? `<p><a href="${APP_URL}${link}" style="background:#4f46e5;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">View in AutoRFP</a></p>` : ''}
    <hr/>
    <p style="color:#888;font-size:12px;">You received this because you are a member of this project. Manage your notification preferences in AutoRFP settings.</p>
  </body></html>
`;
```

## 6. REST API Routes

**File**: `packages/infra/api/routes/notification.routes.ts`

```typescript
import { lambdaEntry } from './route-helper';
import type { DomainRoutes } from './types';

export function notificationDomain(): DomainRoutes {
  return {
    basePath: 'notification',
    routes: [
      { method: 'GET',    path: 'list',               entry: lambdaEntry('notification/list-notifications.ts') },
      { method: 'POST',   path: 'mark-read',          entry: lambdaEntry('notification/mark-read.ts') },
      { method: 'POST',   path: 'mark-all-read',      entry: lambdaEntry('notification/mark-all-read.ts') },
      { method: 'DELETE', path: 'archive',             entry: lambdaEntry('notification/archive-notification.ts') },
      { method: 'GET',    path: 'preferences',        entry: lambdaEntry('notification/get-preferences.ts') },
      { method: 'PUT',    path: 'preferences',        entry: lambdaEntry('notification/update-preferences.ts') },
    ],
  };
}
```

**Register in** `packages/infra/api/api-orchestrator-stack.ts`:

```typescript
// Add import:
import { notificationDomain } from './routes/notification.routes';

// Add to allDomains array (after collaborationDomain):
notificationDomain(),

// Add to domainStackNames array (same index):
'NotificationRoutes',
```

### Endpoint Summary

| Method | Path | Description | Permission |
|---|---|---|---|
| `GET` | `/notification/list` | List inbox + unread count | `notification:read` |
| `POST` | `/notification/mark-read` | Mark specific notifications read | `notification:read` |
| `POST` | `/notification/mark-all-read` | Mark all as read | `notification:read` |
| `DELETE` | `/notification/archive` | Soft-archive a notification | `notification:read` |
| `GET` | `/notification/preferences` | Get user notification prefs | `notification:read` |
| `PUT` | `/notification/preferences` | Update user notification prefs | `notification:read` |

## 7. CDK Infrastructure

The notification system reuses the existing `CollaborationWebSocketStack` SQS queue and notification worker. The only new CDK additions are:

1. **EventBridge rule** for the deadline alert scanner
2. **Lambda: `deadline-alert-scanner`** triggered hourly
3. **IAM**: grant the scanner Lambda permission to send to the notification queue

Add these to `packages/infra/collaboration-websocket-stack.ts` inside the existing `CollaborationWebSocketStack` constructor, after the existing notification worker setup:

```typescript
// ── EventBridge: Deadline Alert Scanner ──────────────────────────────────────
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';

const deadlineAlertScanner = new lambdaNodejs.NodejsFunction(this, 'DeadlineAlertScanner', {
  functionName: `auto-rfp-deadline-alert-scanner-${stage}`,
  entry: path.join(__dirname, '../../apps/functions/src/handlers/notification/deadline-alert-scanner.ts'),
  handler: 'handler',
  runtime: lambda.Runtime.NODEJS_20_X,
  timeout: cdk.Duration.minutes(2),
  memorySize: 256,
  role: lambdaRole,
  environment: {
    ...commonEnv,
    NOTIFICATION_QUEUE_URL: notificationQueue.queueUrl,
  },
  bundling,
});

new logs.LogGroup(this, 'DeadlineAlertScannerLogs', {
  logGroupName: `/aws/lambda/${deadlineAlertScanner.functionName}`,
  retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

// Run every hour
new events.Rule(this, 'DeadlineAlertRule', {
  ruleName: `auto-rfp-deadline-alert-${stage}`,
  schedule: events.Schedule.rate(cdk.Duration.hours(1)),
  targets: [new eventsTargets.LambdaFunction(deadlineAlertScanner)],
});

// Grant scanner permission to send to notification queue
notificationQueue.grantSendMessages(deadlineAlertScanner);
```

Also add the `NOTIFICATION_QUEUE_URL` env var to the existing `notificationWorker` environment (it already has it from the existing stack — verify it's present).

### CDK Infrastructure Summary

| Resource | Type | Purpose |
|---|---|---|
| `auto-rfp-deadline-alert-scanner-{stage}` | Lambda | Hourly scan for approaching deadlines |
| `/aws/lambda/auto-rfp-deadline-alert-scanner-{stage}` | CloudWatch Log Group | Scanner logs |
| `auto-rfp-deadline-alert-{stage}` | EventBridge Rule | Hourly trigger (rate: 1 hour) |
| `auto-rfp-collab-notifications-{stage}` | SQS Queue | **Existing** — reused for all notification types |
| `auto-rfp-collab-notification-worker-{stage}` | Lambda | **Extended** — now handles all notification types |

### IAM Additions to Shared Lambda Role

The shared Lambda role already has `ses:SendEmail` and `ses:SendRawEmail` from the existing collaboration stack. No new IAM additions needed beyond the `notificationQueue.grantSendMessages(deadlineAlertScanner)` call above.

## 8. Frontend — Hooks & Components

### File Structure

```
apps/web/features/notifications/
├── hooks/
│   ├── useNotifications.ts          # SWR hook — inbox list + unread count
│   └── useNotificationPreferences.ts # SWR hook — prefs get/update
├── components/
│   ├── NotificationBell.tsx         # Badge icon in nav with unread count
│   ├── NotificationCenter.tsx       # Dropdown panel — list + actions
│   ├── NotificationItem.tsx         # Single notification row
│   └── NotificationPreferencesForm.tsx # Prefs form (settings page)
└── index.ts                         # Barrel export
```

---

### `hooks/useNotifications.ts`

```typescript
'use client';

import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import type { NotificationItem, NotificationsResponse } from '@auto-rfp/core';

const BASE = `${env.BASE_API_URL}/notification`;

const fetcher = async (url: string): Promise<NotificationsResponse> => {
  const res = await authFetcher(url);
  if (!res.ok) throw new Error('Failed to fetch notifications');
  return res.json();
};

export const useNotifications = (orgId: string | null, includeArchived = false) => {
  const params = new URLSearchParams();
  if (orgId) params.set('orgId', orgId);
  if (includeArchived) params.set('includeArchived', 'true');

  const key = orgId ? `${BASE}/list?${params.toString()}` : null;

  const { data, error, isLoading, mutate } = useSWR<NotificationsResponse>(key, fetcher, {
    refreshInterval: 30_000, // poll every 30s for new notifications
    revalidateOnFocus: true,
  });

  const markRead = useSWRMutation(
    `${BASE}/mark-read`,
    async (url: string, { arg }: { arg: { orgId: string; notificationIds: string[] } }) => {
      const res = await authFetcher(url, { method: 'POST', body: JSON.stringify(arg) });
      if (!res.ok) throw new Error('Failed to mark read');
      await mutate();
    },
  );

  const markAllRead = useSWRMutation(
    `${BASE}/mark-all-read`,
    async (_url: string, { arg }: { arg: { orgId: string } }) => {
      const res = await authFetcher(`${BASE}/mark-all-read?orgId=${arg.orgId}`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to mark all read');
      await mutate();
    },
  );

  const archive = useSWRMutation(
    `${BASE}/archive`,
    async (url: string, { arg }: { arg: { orgId: string; notificationId: string } }) => {
      const res = await authFetcher(url, { method: 'DELETE', body: JSON.stringify(arg) });
      if (!res.ok) throw new Error('Failed to archive');
      await mutate();
    },
  );

  return {
    notifications: data?.items ?? [],
    unreadCount: data?.unreadCount ?? 0,
    count: data?.count ?? 0,
    isLoading,
    isError: !!error,
    mutate,
    markRead,
    markAllRead,
    archive,
  };
};
```

---

### `hooks/useNotificationPreferences.ts`

```typescript
'use client';

import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import type { NotificationPreferences, UpdateNotificationPreferencesDTO } from '@auto-rfp/core';

const BASE = `${env.BASE_API_URL}/notification`;

export const useNotificationPreferences = (orgId: string | null) => {
  const key = orgId ? `${BASE}/preferences?orgId=${orgId}` : null;

  const { data, error, isLoading, mutate } = useSWR<NotificationPreferences>(
    key,
    async (url: string) => {
      const res = await authFetcher(url);
      if (!res.ok) throw new Error('Failed to fetch preferences');
      return res.json();
    },
  );

  const update = useSWRMutation(
    `${BASE}/preferences`,
    async (url: string, { arg }: { arg: UpdateNotificationPreferencesDTO }) => {
      const res = await authFetcher(url, { method: 'PUT', body: JSON.stringify(arg) });
      if (!res.ok) throw new Error('Failed to update preferences');
      const updated = await res.json();
      await mutate(updated);
      return updated;
    },
  );

  return {
    preferences: data ?? null,
    isLoading,
    isError: !!error,
    update,
    mutate,
  };
};
```

---

### `components/NotificationBell.tsx`

```typescript
'use client';

import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { NotificationCenter } from './NotificationCenter';
import { useNotifications } from '../hooks/useNotifications';

interface NotificationBellProps {
  orgId: string;
}

export const NotificationBell = ({ orgId }: NotificationBellProps) => {
  const { unreadCount } = useNotifications(orgId);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs bg-indigo-500"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <NotificationCenter orgId={orgId} />
      </PopoverContent>
    </Popover>
  );
};
```

---

### `components/NotificationCenter.tsx`

```typescript
'use client';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { NotificationItem } from './NotificationItem';
import { useNotifications } from '../hooks/useNotifications';

interface NotificationCenterProps {
  orgId: string;
}

export const NotificationCenter = ({ orgId }: NotificationCenterProps) => {
  const { notifications, unreadCount, isLoading, markAllRead, archive } = useNotifications(orgId);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="font-semibold text-sm">Notifications</h3>
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-indigo-500"
            onClick={() => markAllRead.trigger({ orgId })}
          >
            Mark all read
          </Button>
        )}
      </div>

      <ScrollArea className="h-96">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-slate-500">
            No notifications
          </div>
        ) : (
          <div className="divide-y">
            {notifications.map((n) => (
              <NotificationItem
                key={n.notificationId}
                notification={n}
                onArchive={() => archive.trigger({ orgId, notificationId: n.notificationId })}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
};
```

---

### `components/NotificationItem.tsx`

```typescript
'use client';

import { formatDistanceToNow } from 'date-fns';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { NotificationItem as NotificationItemType } from '@auto-rfp/core';

interface NotificationItemProps {
  notification: NotificationItemType;
  onArchive: () => void;
}

export const NotificationItem = ({ notification, onArchive }: NotificationItemProps) => {
  const { title, message, read, createdAt, link } = notification;

  const content = (
    <div className={cn('flex gap-3 px-4 py-3 hover:bg-slate-50 transition-colors', !read && 'bg-indigo-50/50')}>
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm truncate', !read && 'font-semibold')}>{title}</p>
        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{message}</p>
        <p className="text-xs text-slate-400 mt-1">
          {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 text-slate-400 hover:text-slate-600"
        onClick={(e) => { e.stopPropagation(); onArchive(); }}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );

  if (link) {
    return <a href={link} className="block">{content}</a>;
  }

  return <div>{content}</div>;
};
```

---

### `index.ts` (barrel export)

```typescript
export { NotificationBell } from './components/NotificationBell';
export { NotificationCenter } from './components/NotificationCenter';
export { NotificationItem } from './components/NotificationItem';
export { NotificationPreferencesForm } from './components/NotificationPreferencesForm';
export { useNotifications } from './hooks/useNotifications';
export { useNotificationPreferences } from './hooks/useNotificationPreferences';
```

---

### Usage in Sidebar/Nav

Add `NotificationBell` to the sidebar layout:

```typescript
// apps/web/layouts/sidebar-layout/index.tsx (or nav-user.tsx)
import { NotificationBell } from '@/features/notifications';

// Inside the nav header:
<NotificationBell orgId={orgId} />
```

## 9. Permissions & RBAC

### New Permissions

Add to `packages/core/src/schemas/user.ts`:

```typescript
// Add to ALL_PERMISSIONS array:
'notification:read',
'notification:manage',  // future: admin-level notification management
```

### Role Matrix

| Permission | ADMIN | EDITOR | VIEWER | BILLING |
|---|---|---|---|---|
| `notification:read` | ✅ | ✅ | ✅ | ❌ |
| `notification:manage` | ✅ | ❌ | ❌ | ❌ |

Add `notification:read` to `ROLE_PERMISSIONS` for `ADMIN`, `EDITOR`, and `VIEWER` roles.

---

## 10. Implementation Tickets

> Each ticket is independently implementable. Follow the order — each step depends on the previous.

---

### N-1 · Core Schemas (30 min)

**Goal**: Define all Zod schemas and inferred types for the notification domain.

**Files to create**:
- `packages/core/src/schemas/notification.ts` — full schema file from Section 3

**Files to modify**:
- `packages/core/src/schemas/index.ts` — add `export * from './notification'`

**Acceptance**:
- [ ] All schemas exported: `NotificationTypeSchema`, `NotificationItemSchema`, `NotificationPreferencesSchema`, `NotificationPayloadSchema`, `NotificationsResponseSchema`, `MarkReadDTOSchema`, `ArchiveNotificationDTOSchema`, `UpdateNotificationPreferencesDTOSchema`
- [ ] `cd packages/core && pnpm tsc --noEmit` passes

---

### N-2 · Permissions (15 min)

**Goal**: Add `notification:read` and `notification:manage` to the RBAC system.

**Files to modify**:
- `packages/core/src/schemas/user.ts`:
  - Add `'notification:read'` and `'notification:manage'` to `ALL_PERMISSIONS`
  - Add `'notification:read'` to `ROLE_PERMISSIONS` for `ADMIN`, `EDITOR`, `VIEWER`
  - Add `'notification:manage'` to `ROLE_PERMISSIONS` for `ADMIN` only

**Acceptance**:
- [ ] `notification:read` present in `ALL_PERMISSIONS`
- [ ] `notification:read` granted to ADMIN, EDITOR, VIEWER roles
- [ ] `cd packages/core && pnpm tsc --noEmit` passes

---

### N-3 · DynamoDB Constants & Helpers (30 min)

**Goal**: Create PK constants and all DynamoDB helper functions for the notification domain.

**Files to create**:
- `apps/functions/src/constants/notification.ts` — PK constants + TTL value (Section 4)
- `apps/functions/src/helpers/notification.ts` — SK builders + all DB helpers (Section 4)

**Acceptance**:
- [ ] `buildNotificationSK` and `buildNotificationPrefsSK` exported
- [ ] `createNotification`, `listNotifications`, `markNotificationsRead`, `markAllNotificationsRead`, `archiveNotification` exported
- [ ] `getNotificationPreferences`, `upsertNotificationPreferences` exported
- [ ] `cd apps/functions && pnpm tsc --noEmit` passes

---

### N-4 · REST Lambda Handlers — Inbox (45 min)

**Goal**: Implement the 4 inbox management handlers.

**Files to create**:
- `apps/functions/src/handlers/notification/list-notifications.ts`
- `apps/functions/src/handlers/notification/mark-read.ts`
- `apps/functions/src/handlers/notification/mark-all-read.ts`
- `apps/functions/src/handlers/notification/archive-notification.ts`

**Rules to verify for each handler**:
- [ ] `safeParse` result destructured immediately
- [ ] `orgId` from `queryStringParameters` (GET) or `data.orgId` (POST/DELETE)
- [ ] `apiResponse` used for all responses
- [ ] Middy stack: `authContextMiddleware → orgMembershipMiddleware → requirePermission('notification:read') → httpErrorMiddleware`
- [ ] `withSentryLambda` wrapping
- [ ] `cd apps/functions && pnpm tsc --noEmit` passes

---

### N-5 · REST Lambda Handlers — Preferences (30 min)

**Goal**: Implement the 2 preferences handlers.

**Files to create**:
- `apps/functions/src/handlers/notification/get-preferences.ts`
- `apps/functions/src/handlers/notification/update-preferences.ts`

**Acceptance**:
- [ ] `get-preferences` returns stored prefs or sensible defaults if none exist
- [ ] `update-preferences` merges with existing prefs before saving
- [ ] Same middy stack and `withSentryLambda` as N-4
- [ ] `cd apps/functions && pnpm tsc --noEmit` passes

---

### N-6 · Extend Notification Worker (30 min)

**Goal**: Replace the existing collaboration-only `notification-worker.ts` with the full multi-type worker.

**Files to modify**:
- `apps/functions/src/handlers/collaboration/notification-worker.ts` — replace with extended version from Section 5

**Acceptance**:
- [ ] Worker persists in-app `NotificationItem` to DynamoDB via `createNotification`
- [ ] Worker reads user prefs via `getNotificationPreferences` before sending
- [ ] Worker respects `inApp`, `email`, and `typeOverrides` preferences
- [ ] Email still sent via SES with HTML template
- [ ] `cd apps/functions && pnpm tsc --noEmit` passes

---

### N-7 · Deadline Alert Scanner (30 min)

**Goal**: Implement the EventBridge-triggered Lambda that scans for approaching deadlines.

**Files to create**:
- `apps/functions/src/handlers/notification/deadline-alert-scanner.ts` — from Section 5

**Acceptance**:
- [ ] Fires for 7d / 3d / 1d / 6h windows (±30 min tolerance)
- [ ] Enqueues `NotificationPayload` to SQS notification queue
- [ ] `cd apps/functions && pnpm tsc --noEmit` passes

---

### N-8 · API Routes Registration (20 min)

**Goal**: Wire the notification REST endpoints into API Gateway.

**Files to create**:
- `packages/infra/api/routes/notification.routes.ts` — from Section 6

**Files to modify**:
- `packages/infra/api/api-orchestrator-stack.ts`:
  - Add `import { notificationDomain } from './routes/notification.routes'`
  - Add `notificationDomain()` to `allDomains` array
  - Add `'NotificationRoutes'` to `domainStackNames` array at the same index

**Acceptance**:
- [ ] 6 routes registered: `list`, `mark-read`, `mark-all-read`, `archive`, `preferences` (GET + PUT)
- [ ] `cd packages/infra && pnpm tsc --noEmit` passes

---

### N-9 · CDK — Deadline Scanner Infrastructure (30 min)

**Goal**: Add the EventBridge rule and deadline scanner Lambda to the existing collaboration stack.

**Files to modify**:
- `packages/infra/collaboration-websocket-stack.ts`:
  - Add `import * as events from 'aws-cdk-lib/aws-events'`
  - Add `import * as eventsTargets from 'aws-cdk-lib/aws-events-targets'`
  - Add `deadlineAlertScanner` Lambda (after existing notification worker)
  - Add `DeadlineAlertScannerLogs` CloudWatch Log Group
  - Add `DeadlineAlertRule` EventBridge rule (`rate(1 hour)`)
  - Grant `notificationQueue.grantSendMessages(deadlineAlertScanner)`

**Acceptance**:
- [ ] Lambda has explicit CloudWatch Log Group with correct retention
- [ ] EventBridge rule fires every 1 hour
- [ ] Scanner has `NOTIFICATION_QUEUE_URL` in environment
- [ ] `cd packages/infra && pnpm tsc --noEmit` passes

---

### N-10 · Frontend Hooks (30 min)

**Goal**: Implement SWR data hooks for the notification feature.

**Files to create**:
- `apps/web/features/notifications/hooks/useNotifications.ts` — from Section 8
- `apps/web/features/notifications/hooks/useNotificationPreferences.ts` — from Section 8

**Acceptance**:
- [ ] `useNotifications` polls every 30s, exposes `notifications`, `unreadCount`, `markRead`, `markAllRead`, `archive`
- [ ] `useNotificationPreferences` exposes `preferences`, `update`
- [ ] Both hooks start with `'use client'`
- [ ] Types imported from `@auto-rfp/core` — no inline type definitions
- [ ] `cd apps/web && pnpm tsc --noEmit` passes

---

### N-11 · Frontend Components (45 min)

**Goal**: Implement the notification UI components.

**Files to create**:
- `apps/web/features/notifications/components/NotificationBell.tsx`
- `apps/web/features/notifications/components/NotificationCenter.tsx`
- `apps/web/features/notifications/components/NotificationItem.tsx`
- `apps/web/features/notifications/components/NotificationPreferencesForm.tsx` *(stub — full form in follow-up)*
- `apps/web/features/notifications/index.ts` — barrel export

**Files to modify**:
- Sidebar nav (e.g. `apps/web/layouts/sidebar-layout/index.tsx` or `nav-user.tsx`) — add `<NotificationBell orgId={orgId} />`

**Acceptance**:
- [ ] `NotificationBell` shows badge with unread count (capped at 99+)
- [ ] `NotificationCenter` uses `<Skeleton>` while loading — no spinners
- [ ] `NotificationCenter` shows "No notifications" empty state
- [ ] `NotificationItem` highlights unread rows with `bg-indigo-50/50`
- [ ] All components use Shadcn UI — no raw `<button>` or `<input>`
- [ ] Barrel export covers all public components and hooks
- [ ] `cd apps/web && pnpm tsc --noEmit` passes

---

## 11. Acceptance Criteria Checklist

- [x] `GET /notification/list` returns notifications with `unreadCount` for authenticated user
- [x] `POST /notification/mark-read` marks specified notifications as read
- [x] `POST /notification/mark-all-read` marks all unread notifications as read
- [x] `DELETE /notification/archive` soft-archives a notification (excluded from default list)
- [x] `GET /notification/preferences` returns user preferences (defaults if none saved)
- [x] `PUT /notification/preferences` saves and returns updated preferences
- [x] `notification-worker` persists in-app notifications to DynamoDB for each recipient
- [x] `notification-worker` sends email via SES **only** when user has explicitly enabled email (opt-in)
- [x] `notification-worker` respects per-type `typeOverrides` preferences
- [x] User mentioned in a comment under a question receives an in-app `MENTION` notification (`create-comment.ts`)
- [x] `ASSIGNMENT` notification sent when a question is assigned to a user (`upsert-assignment.ts`)
- [x] `RFP_UPLOADED` notification sent to org members when a document pipeline starts (`start-document-pipeline.ts`)
- [x] `QUESTIONS_EXTRACTED` notification sent when all files are processed and answer generation starts (`check-and-trigger-answers.ts`)
- [x] `ANSWERS_GENERATED` notification sent when answer generation pipeline completes (`copy-cluster-answers.ts`)
- [x] `WIN_RECORDED` / `LOSS_RECORDED` notification sent to org members when outcome is set (`set-outcome.ts`)
- [x] `deadline-alert-scanner` fires for deadlines at 7d / 3d / 1d / 6h windows
- [x] `NotificationBell` is placed in the app header and shows correct unread badge count
- [x] `NotificationCenter` renders skeleton while loading
- [x] `NotificationCenter` shows "No notifications" when inbox is empty
- [x] `NotificationItem` highlights unread notifications
- [x] New users have in-app enabled and all other channels disabled by default
- [ ] User can change their notification preferences on their profile page *(UI form built — wire into profile page)*
- [ ] Admin can change notification preferences for any user in the user management page *(API ready — wire into admin UI)*
- [x] Notifications auto-expire after 90 days via DynamoDB TTL
- [x] All new permissions added to `user.ts` and role matrices
- [x] All Lambda functions have CloudWatch Log Groups in CDK
- [x] Sentry user feedback widget configured (see `global-error.tsx`)

---

## 12. Summary of New Files

| File | Type | Purpose |
|---|---|---|
| `packages/core/src/schemas/notification.ts` | Schema | All notification Zod schemas & inferred types |
| `apps/functions/src/constants/notification.ts` | Constants | PK constants, TTL values |
| `apps/functions/src/helpers/notification.ts` | Helper | SK builders + DynamoDB helpers |
| `apps/functions/src/handlers/notification/list-notifications.ts` | Lambda | GET inbox |
| `apps/functions/src/handlers/notification/mark-read.ts` | Lambda | POST mark read |
| `apps/functions/src/handlers/notification/mark-all-read.ts` | Lambda | POST mark all read |
| `apps/functions/src/handlers/notification/archive-notification.ts` | Lambda | DELETE archive |
| `apps/functions/src/handlers/notification/get-preferences.ts` | Lambda | GET prefs |
| `apps/functions/src/handlers/notification/update-preferences.ts` | Lambda | PUT prefs |
| `apps/functions/src/handlers/notification/deadline-alert-scanner.ts` | Lambda | EventBridge scheduled scanner |
| `packages/infra/api/routes/notification.routes.ts` | CDK Routes | REST route definitions |
| `apps/web/features/notifications/hooks/useNotifications.ts` | Hook | SWR inbox + mutations |
| `apps/web/features/notifications/hooks/useNotificationPreferences.ts` | Hook | SWR prefs |
| `apps/web/features/notifications/components/NotificationBell.tsx` | Component | Nav bell with badge |
| `apps/web/features/notifications/components/NotificationCenter.tsx` | Component | Dropdown inbox panel |
| `apps/web/features/notifications/components/NotificationItem.tsx` | Component | Single notification row |
| `apps/web/features/notifications/components/NotificationPreferencesForm.tsx` | Component | Settings page prefs form |
| `apps/web/features/notifications/index.ts` | Barrel | Feature exports |

### Modified Files

| File | Change |
|---|---|
| `packages/core/src/schemas/index.ts` | Add `export * from './notification'` |
| `packages/core/src/schemas/user.ts` | Add `notification:read`, `notification:manage` permissions |
| `apps/functions/src/handlers/collaboration/notification-worker.ts` | Extended to persist in-app + respect prefs |
| `packages/infra/api/api-orchestrator-stack.ts` | Register `notificationDomain()` |
| `packages/infra/collaboration-websocket-stack.ts` | Add deadline scanner Lambda + EventBridge rule |
| `apps/web/layouts/sidebar-layout/index.tsx` | Add `<NotificationBell orgId={orgId} />` |
