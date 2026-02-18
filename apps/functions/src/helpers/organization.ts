import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { PK_NAME, SK_NAME } from '../constants/common';
import { USER_PK } from '../constants/user';
import { requireEnv } from './env';
import { docClient } from './db';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const GSI_BY_USER_ID = 'byUserId';

/**
 * Get all org IDs a user belongs to using the byUserId GSI.
 * Returns empty array if no memberships found.
 */
export async function getAccessibleOrgIds(userId: string): Promise<string[]> {
  const orgIds: string[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        IndexName: GSI_BY_USER_ID,
        KeyConditionExpression: '#userId = :userId AND #pk = :pk',
        ExpressionAttributeNames: {
          '#userId': 'userId',
          '#pk': PK_NAME,
        },
        ExpressionAttributeValues: {
          ':userId': userId,
          ':pk': USER_PK,
        },
        ProjectionExpression: 'orgId',
        ExclusiveStartKey,
      }),
    );

    for (const item of res.Items ?? []) {
      if (item.orgId) orgIds.push(item.orgId);
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return orgIds;
}
