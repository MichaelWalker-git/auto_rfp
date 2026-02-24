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
  orgId: z.string().uuid().optional(),
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
  assignmentId: z.string().min(1),
  projectId: z.string().min(1),
  orgId: z.string().min(1),
  questionId: z.string().min(1),  // any string — question IDs may not be UUIDs
  assignedToUserId: z.string().optional(),
  assignedToDisplayName: z.string().max(200).optional(),
  assignedByUserId: z.string().min(1),
  status: QuestionStatusSchema.default('UNASSIGNED'),
  dueAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AssignmentItem = z.infer<typeof AssignmentItemSchema>;

export const UpsertAssignmentDTOSchema = z.object({
  projectId: z.string().min(1),
  orgId: z.string().min(1).optional(),
  questionId: z.string().min(1),  // not enforced as UUID — question IDs may be any string
  assignedToUserId: z.string().optional(),
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
  'ANSWER_DELTA',
  'ANSWER_STATUS',
  'HEARTBEAT',
  'ERROR',
]);
export type WsMessageType = z.infer<typeof WsMessageTypeSchema>;

export const WsInboundMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('HEARTBEAT'), payload: PresenceHeartbeatSchema }),
  z.object({ type: z.literal('EDITING_LOCK'), payload: z.object({ projectId: z.string().uuid(), questionId: z.string().uuid() }) }),
  z.object({ type: z.literal('EDITING_UNLOCK'), payload: z.object({ projectId: z.string().uuid(), questionId: z.string().uuid() }) }),
  z.object({ type: z.literal('ANSWER_DELTA'), payload: z.object({ projectId: z.string().uuid(), questionId: z.string().min(1), text: z.string() }) }),
  z.object({ type: z.literal('ANSWER_STATUS'), payload: z.object({
    projectId: z.string().uuid(),
    questionId: z.string().min(1),
    status: z.string().optional(),
    updatedByName: z.string().optional(),
    updatedAt: z.string().optional(),
    approvedByName: z.string().optional(),
    approvedAt: z.string().optional(),
  }) }),
]);
export type WsInboundMessage = z.infer<typeof WsInboundMessageSchema>;

export const WsOutboundMessageSchema = z.object({
  type: WsMessageTypeSchema,
  payload: z.unknown(),
  timestamp: z.string().datetime(),
});
export type WsOutboundMessage = z.infer<typeof WsOutboundMessageSchema>;
