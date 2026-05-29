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
  /** Optional entity ID for deep-linking (e.g. questionId for MENTION) */
  entityId: z.string().optional(),
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
  /** Optional entity ID for deep-linking (e.g. questionId for MENTION notifications) */
  entityId: z.string().optional(),
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
