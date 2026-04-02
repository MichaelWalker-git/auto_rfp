import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { PK_NAME, SK_NAME } from '../constants/common';
import { USER_PROJECT_PK, buildUserProjectSK, UserProjectAccess } from '@auto-rfp/core';
import { docClient } from './db';
import { requireEnv } from './env';
import { nowIso } from './date';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * Result of getUserProjectAccessRecord - contains all info needed for authorization.
 */
export interface ProjectAccessInfo {
  /** Whether the user has an explicit access record for this project */
  hasAccess: boolean;
  /** The full access record if found */
  record: UserProjectAccess | null;
}

/**
 * Get a user's project access record with a single DynamoDB GetItem call.
 */
export const getUserProjectAccessRecord = async (userId: string, projectId: string): Promise<ProjectAccessInfo> => {
  const sk = buildUserProjectSK(userId, projectId);

  const res = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: USER_PROJECT_PK, [SK_NAME]: sk },
    }),
  );

  const record = res.Item as UserProjectAccess | undefined;

  if (!record) {
    return {
      hasAccess: false,
      record: null,
    };
  }

  return {
    hasAccess: true,
    record,
  };
};

/**
 * Assign a user to a project.
 */
export const assignProjectAccess = async (
  orgId: string,
  userId: string,
  projectId: string,
  assignedBy?: string,
): Promise<UserProjectAccess> => {
  const sk = buildUserProjectSK(userId, projectId);
  const now = nowIso();

  const item: UserProjectAccess & Record<string, unknown> = {
    [PK_NAME]: USER_PROJECT_PK,
    [SK_NAME]: sk,
    userId,
    projectId,
    orgId,
    assignedAt: now,
    assignedBy,
  };

  await docClient.send(
    new PutCommand({
      TableName: DB_TABLE_NAME,
      Item: item,
    }),
  );

  return item;
};

/**
 * Revoke a user's access to a project.
 */
export const revokeProjectAccess = async (userId: string, projectId: string): Promise<void> => {
  const sk = buildUserProjectSK(userId, projectId);
  await docClient.send(
    new DeleteCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: USER_PROJECT_PK, [SK_NAME]: sk },
    }),
  );
};

/**
 * Get all project IDs a user has explicit access to.
 */
export const getAccessibleProjectIds = async (userId: string): Promise<string[]> => {
  const records = await getUserProjectAccessRecords(userId);
  return records.map((r) => r.projectId);
};

/**
 * Get all USER_PROJECT access records for a user.
 */
export const getUserProjectAccessRecords = async (userId: string): Promise<UserProjectAccess[]> => {
  const records: UserProjectAccess[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
        ExpressionAttributeValues: {
          ':pk': USER_PROJECT_PK,
          ':skPrefix': `${userId}#`,
        },
        ExclusiveStartKey,
      }),
    );

    for (const item of res.Items ?? []) {
      records.push(item as UserProjectAccess);
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return records;
};

/**
 * Get all users who have access to a specific project.
 */
export const getProjectAccessUsers = async (projectId: string): Promise<UserProjectAccess[]> => {
  const records: UserProjectAccess[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk',
        FilterExpression: '#projectId = :projectId',
        ExpressionAttributeNames: { '#pk': PK_NAME, '#projectId': 'projectId' },
        ExpressionAttributeValues: {
          ':pk': USER_PROJECT_PK,
          ':projectId': projectId,
        },
        ExclusiveStartKey,
      }),
    );

    for (const item of res.Items ?? []) {
      records.push(item as UserProjectAccess);
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return records;
};

/**
 * Check if a user has access to a specific project.
 * Returns true if:
 * 1. User has an explicit assignment, OR
 * 2. No assignments exist for anyone (backward compatible), OR
 * 3. User is the project creator (checked separately)
 */
export const hasProjectAccess = async (userId: string, projectId: string): Promise<boolean> => {
  const allAccess = await getAccessibleProjectIds(userId);
  // If no access records exist, user may have access via createdBy (caller checks)
  return allAccess.includes(projectId);
};

/**
 * Delete all USER_PROJECT records for a user (used when removing user from org).
 */
export const deleteAllProjectAccessForUser = async (userId: string): Promise<number> => {
  const records = await getUserProjectAccessRecords(userId);
  for (const record of records) {
    await revokeProjectAccess(record.userId, record.projectId);
  }
  return records.length;
};

/**
 * Delete all USER_PROJECT records for a project (used when deleting a project).
 */
export const deleteAllProjectAccessForProject = async (projectId: string): Promise<number> => {
  const records = await getProjectAccessUsers(projectId);
  for (const record of records) {
    await revokeProjectAccess(record.userId, record.projectId);
  }
  return records.length;
};

/**
 * Bulk grant project access to all users with ADMIN role in the org.
 * Returns the count of users granted and skipped (already had access).
 */
export const grantProjectAccessToAllAdmins = async (
  orgId: string,
  projectId: string,
  assignedBy?: string,
  adminUserIds: string[] = [],
): Promise<{ grantedCount: number; skippedCount: number; grantedUserIds: string[] }> => {
  let grantedCount = 0;
  let skippedCount = 0;
  const grantedUserIds: string[] = [];

  // Get existing access for this project
  const existingAccess = await getProjectAccessUsers(projectId);
  const existingUserIds = new Set(existingAccess.map((a) => a.userId));

  for (const userId of adminUserIds) {
    if (existingUserIds.has(userId)) {
      skippedCount++;
      continue;
    }

    await assignProjectAccess(orgId, userId, projectId, assignedBy);
    grantedCount++;
    grantedUserIds.push(userId);
  }

  return { grantedCount, skippedCount, grantedUserIds };
};
