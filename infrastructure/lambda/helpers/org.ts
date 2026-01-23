import { docClient } from './db';
import { PK_NAME, SK_NAME } from '../constants/common';
import { ORG_PK } from '../constants/organization';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { requireEnv } from './env';
import { safeSplitAt, safeTrim } from './safe-string';


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
      const rawSk = safeTrim((it as any)?.[SK_NAME]);
      // SK format: ORG#UUID - extract UUID at index 1
      const uuid = safeSplitAt(rawSk, '#', 1);
      if (uuid) orgIds.push(uuid);
    }

    ExclusiveStartKey = res.LastEvaluatedKey as any;
  } while (ExclusiveStartKey);

  return orgIds;
}
