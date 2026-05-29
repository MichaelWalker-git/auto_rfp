import { createItem, putItem, getItem, deleteItem, queryBySkPrefix } from '@/helpers/db';
import type { PresenceItem, CommentItem, AssignmentItem, ActivityItem } from '@auto-rfp/core';
import { PK, PRESENCE_TTL_SECONDS, ACTIVITY_TTL_DAYS } from '@/constants/collaboration';

// ─── SK Builders ─────────────────────────────────────────────────────────────

export function buildPresenceSK(orgId: string, projectId: string, userId: string): string {
  return `${orgId}#${projectId}#${userId}`;
}

export function buildCommentSK(
  orgId: string,
  projectId: string,
  entityType: string,
  entityId: string,
  commentId: string,
): string {
  return `${orgId}#${projectId}#${entityType}#${entityId}#${commentId}`;
}

export function buildAssignmentSK(orgId: string, projectId: string, questionId: string, userId?: string): string {
  return userId
    ? `${orgId}#${projectId}#${questionId}#${userId}`
    : `${orgId}#${projectId}#${questionId}`;
}

export function buildActivitySK(
  orgId: string,
  projectId: string,
  timestamp: string,
  activityId: string,
): string {
  return `${orgId}#${projectId}#${timestamp}#${activityId}`;
}

export function buildWsConnectionSK(connectionId: string): string {
  return connectionId;
}

// ─── Presence ─────────────────────────────────────────────────────────────────

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
  return queryBySkPrefix<PresenceItem>(PK.PRESENCE, `${orgId}#${projectId}#`);
}

// ─── WS Connections ───────────────────────────────────────────────────────────

export async function putWsConnection(
  connectionId: string,
  data: Record<string, unknown>,
): Promise<void> {
  await putItem(PK.WS_CONNECTION, buildWsConnectionSK(connectionId), data);
}

export async function getWsConnection(
  connectionId: string,
): Promise<Record<string, unknown> | null> {
  return getItem<Record<string, unknown>>(PK.WS_CONNECTION, buildWsConnectionSK(connectionId));
}

export async function deleteWsConnection(connectionId: string): Promise<void> {
  await deleteItem(PK.WS_CONNECTION, buildWsConnectionSK(connectionId));
}

// ─── Comments ─────────────────────────────────────────────────────────────────

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
  const prefix = `${orgId}#${projectId}#${entityType}#${entityId}#`;
  const items = await queryBySkPrefix<CommentItem>(PK.COMMENT, prefix);
  return items.filter((c) => !c.deletedAt);
}

export async function getComment(
  orgId: string,
  projectId: string,
  entityType: string,
  entityId: string,
  commentId: string,
): Promise<CommentItem | null> {
  return getItem<CommentItem>(
    PK.COMMENT,
    buildCommentSK(orgId, projectId, entityType, entityId, commentId),
  );
}

// ─── Assignments ──────────────────────────────────────────────────────────────

export async function upsertAssignment(
  orgId: string,
  item: Omit<AssignmentItem, 'createdAt' | 'updatedAt'>,
): Promise<AssignmentItem> {
  const now = new Date().toISOString();
  return putItem<AssignmentItem>(
    PK.ASSIGNMENT,
    buildAssignmentSK(orgId, item.projectId, item.questionId),
    { ...item, createdAt: now, updatedAt: now },
  );
}

export async function listAssignments(orgId: string, projectId: string): Promise<AssignmentItem[]> {
  return queryBySkPrefix<AssignmentItem>(PK.ASSIGNMENT, `${orgId}#${projectId}#`);
}

// ─── Activity Feed ────────────────────────────────────────────────────────────

export async function createActivity(
  orgId: string,
  item: Omit<ActivityItem, 'ttl'>,
): Promise<ActivityItem> {
  const ttl = Math.floor(Date.now() / 1000) + ACTIVITY_TTL_DAYS * 86400;
  return createItem<ActivityItem>(
    PK.ACTIVITY,
    buildActivitySK(orgId, item.projectId, item.timestamp, item.activityId),
    { ...item, ttl },
    { condition: undefined },
  );
}
