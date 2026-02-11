import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { PK_NAME, SK_NAME } from '../constants/common';
import { requireEnv } from './env';
import { docClient } from './db';
import { USER_PK } from '../constants/user';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');


/**
 * Resolve a set of user IDs (Cognito subs) to display names.
 * Queries the USER partition in DynamoDB and builds a userId → displayName map.
 * Returns a map where keys are userIds and values are display names.
 */
export async function resolveUserNames(
  orgId: string,
  userIds: string[],
): Promise<Record<string, string>> {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {};

  try {
    // Query all users for this org
    const skPrefix = `ORG#${orgId}#USER#`;
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
        },
        ExpressionAttributeValues: {
          ':pk': USER_PK,
          ':skPrefix': skPrefix,
        },
        ProjectionExpression: 'userId, firstName, lastName, displayName, email, cognitoSub, cognitoUsername',
      }),
    );

    const map: Record<string, string> = {};
    for (const item of res.Items ?? []) {
      const uid = item.userId as string;
      const cognitoSub = item.cognitoSub as string | undefined;
      const cognitoUsername = item.cognitoUsername as string | undefined;

      const name =
        (item.displayName as string) ||
        [item.firstName, item.lastName].filter(Boolean).join(' ') ||
        (item.email as string) ||
        uid || 'Unknown';

      // Map by app userId
      if (uid) map[uid] = name;
      // Also map by Cognito sub (which is what event.auth.userId stores)
      if (cognitoSub) map[cognitoSub] = name;
      // Also map by cognitoUsername (email) in case that's what's stored
      if (cognitoUsername) map[cognitoUsername] = name;
    }

    return map;
  } catch (err) {
    console.warn('Failed to resolve user names:', err);
    return {};
  }
}

/**
 * Enrich a list of items with createdByName and updatedByName fields.
 * Mutates the items in place and returns them.
 */
export async function enrichWithUserNames<T extends Record<string, any>>(
  orgId: string,
  items: T[],
): Promise<T[]> {
  const userIds: string[] = [];
  for (const item of items) {
    if (item.createdBy) userIds.push(item.createdBy);
    if (item.updatedBy) userIds.push(item.updatedBy);
  }

  const nameMap = await resolveUserNames(orgId, userIds);

  for (const item of items) {
    if (item.createdBy && nameMap[item.createdBy]) {
      (item as Record<string, any>).createdByName = nameMap[item.createdBy];
    }
    if (item.updatedBy && nameMap[item.updatedBy]) {
      (item as Record<string, any>).updatedByName = nameMap[item.updatedBy];
    }
  }

  return items;
}