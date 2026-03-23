import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { PK_NAME, SK_NAME } from '../constants/common';
import { USER_KB_PK, buildUserKBSK, UserKBAccess } from '@auto-rfp/core';
import { docClient } from './db';
import { requireEnv } from './env';
import { nowIso } from './date';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * Result of getUserKBAccessRecord - contains all info needed for authorization.
 */
export interface KBAccessInfo {
  /** Whether the user has an explicit access record for this KB */
  hasAccess: boolean;
  /** The access level ('read', 'write', 'admin') or null if no record */
  accessLevel: string | null;
  /** Whether user can manage KB access (is KB admin) */
  isKBAdmin: boolean;
  /** The full access record if found */
  record: UserKBAccess | null;
}

/**
 * Get a user's KB access record with a single DynamoDB GetItem call.
 * This is the optimized version - use this for authorization checks.
 * 
 * NOTE: Returns hasAccess=false if no record exists. The caller should handle
 * backward compatibility (no records = access to all) at a higher level if needed.
 */
export async function getUserKBAccessRecord(userId: string, kbId: string): Promise<KBAccessInfo> {
  const sk = buildUserKBSK(userId, kbId);
  
  const res = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: USER_KB_PK, [SK_NAME]: sk },
    }),
  );

  const record = res.Item as UserKBAccess | undefined;
  
  if (!record) {
    return {
      hasAccess: false,
      accessLevel: null,
      isKBAdmin: false,
      record: null,
    };
  }

  return {
    hasAccess: true,
    accessLevel: record.accessLevel,
    isKBAdmin: record.accessLevel === 'admin',
    record,
  };
}

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
 * Get a user's access level on a specific KB.
 * Returns the accessLevel ('read', 'write', 'admin') or null if no access record.
 */
export async function getKBAccessLevel(userId: string, kbId: string): Promise<string | null> {
  const records = await getUserKBAccessRecords(userId);
  const record = records.find((r) => r.kbId === kbId);
  return record?.accessLevel ?? null;
}

/**
 * Check if user can manage KB access (has 'admin' accessLevel on this KB).
 */
export async function canManageKBAccess(userId: string, kbId: string): Promise<boolean> {
  const accessLevel = await getKBAccessLevel(userId, kbId);
  return accessLevel === 'admin';
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
