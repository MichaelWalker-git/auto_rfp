import { DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { PK_NAME, SK_NAME } from '../constants/common';
import { USER_KB_PK, buildUserKBSK, UserKBAccess } from '@auto-rfp/core';
import { docClient } from './db';
import { requireEnv } from './env';
import { nowIso } from './date';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * Grant a user access to a knowledge base.
 */
export async function grantKBAccess(
  orgId: string,
  userId: string,
  kbId: string,
  accessLevel: 'read' | 'write' | 'admin' = 'read',
  grantedBy?: string,
): Promise<UserKBAccess> {
  const sk = buildUserKBSK(userId, kbId);
  const now = nowIso();

  const item: UserKBAccess & Record<string, any> = {
    [PK_NAME]: USER_KB_PK,
    [SK_NAME]: sk,
    userId,
    kbId,
    orgId,
    accessLevel,
    grantedAt: now,
    grantedBy,
  };

  await docClient.send(
    new PutCommand({
      TableName: DB_TABLE_NAME,
      Item: item,
    }),
  );

  return item;
}

/**
 * Revoke a user's access to a knowledge base.
 */
export async function revokeKBAccess(userId: string, kbId: string): Promise<void> {
  const sk = buildUserKBSK(userId, kbId);
  await docClient.send(
    new DeleteCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: USER_KB_PK, [SK_NAME]: sk },
    }),
  );
}

/**
 * Get all KB IDs a user has access to.
 * Returns empty array if no access records exist (meaning: user has access to ALL KBs — backward compatible).
 */
export async function getAccessibleKBIds(userId: string): Promise<string[]> {
  const links = await getUserKBAccessRecords(userId);
  return links.map((l) => l.kbId);
}

/**
 * Check if a user has access to a specific KB.
 * If no USER_KB records exist for the user at all, they have access to everything (backward compatible).
 */
export async function hasKBAccess(userId: string, kbId: string): Promise<boolean> {
  const allAccess = await getAccessibleKBIds(userId);
  // If no access records exist, user has access to all KBs (backward compatible)
  if (allAccess.length === 0) return true;
  return allAccess.includes(kbId);
}

/**
 * Get all USER_KB access records for a user.
 */
export async function getUserKBAccessRecords(userId: string): Promise<UserKBAccess[]> {
  const records: UserKBAccess[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
        ExpressionAttributeValues: {
          ':pk': USER_KB_PK,
          ':skPrefix': `${userId}#`,
        },
        ExclusiveStartKey,
      }),
    );

    for (const item of res.Items ?? []) {
      records.push(item as UserKBAccess);
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return records;
}

/**
 * Get all users who have access to a specific KB.
 */
export async function getKBAccessUsers(kbId: string): Promise<UserKBAccess[]> {
  const records: UserKBAccess[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk',
        FilterExpression: '#kbId = :kbId',
        ExpressionAttributeNames: { '#pk': PK_NAME, '#kbId': 'kbId' },
        ExpressionAttributeValues: {
          ':pk': USER_KB_PK,
          ':kbId': kbId,
        },
        ExclusiveStartKey,
      }),
    );

    for (const item of res.Items ?? []) {
      records.push(item as UserKBAccess);
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return records;
}

/**
 * Delete all USER_KB records for a user (used when removing user from org).
 */
export async function deleteAllKBAccessForUser(userId: string): Promise<number> {
  const records = await getUserKBAccessRecords(userId);
  for (const record of records) {
    await revokeKBAccess(record.userId, record.kbId);
  }
  return records.length;
}

/**
 * Delete all USER_KB records for a KB (used when deleting a KB).
 */
export async function deleteAllKBAccessForKB(kbId: string): Promise<number> {
  const records = await getKBAccessUsers(kbId);
  for (const record of records) {
    await revokeKBAccess(record.userId, record.kbId);
  }
  return records.length;
}
