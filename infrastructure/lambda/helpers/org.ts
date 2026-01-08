import { docClient } from './db';
import { PK_NAME, SK_NAME } from '../constants/common';
import { ORG_PK } from '../constants/organization';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { requireEnv } from './env';


const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export async function listAllOrgIds(): Promise<string[]> {
  const orgIds: string[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk',
        ExpressionAttributeNames: { '#pk': PK_NAME },
        ExpressionAttributeValues: { ':pk': ORG_PK },
        ExclusiveStartKey,
      }),
    );

    for (const it of res.Items ?? []) {
      const orgId = String((it as any)?.[SK_NAME] ?? '').trim();
      // ORG#UUID
      if (orgId) orgIds.push(orgId.split('#')[1]);
    }

    ExclusiveStartKey = res.LastEvaluatedKey as any;
  } while (ExclusiveStartKey);

  return orgIds;
}
