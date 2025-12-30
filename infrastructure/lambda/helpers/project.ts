import { BatchWriteCommand, DynamoDBDocumentClient, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { PK_NAME, SK_NAME } from '../constants/common';
import { ORG_PK, PROJECT_PK } from '../constants/organization';
import { DBItem, docClient } from '../helpers/db';
import { requireEnv } from '../helpers/env';

export async function getProjectById(docClient: DynamoDBDocumentClient, tableName: string, projectId: string): Promise<any | null> {
  const items: any[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined = undefined;

  // Suffix used in SK: "<orgId>#<projectId>"
  const idSuffix = `#${projectId}`;

  do {
    const res = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: '#pk = :pkValue AND contains(#sk, :idSuffix)',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
        },
        ExpressionAttributeValues: {
          ':pkValue': PROJECT_PK,
          ':idSuffix': idSuffix,
        },
        ExclusiveStartKey,
      }),
    );

    if (res.Items && res.Items.length > 0) {
      items.push(...res.Items);
    }

    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, any> | undefined;
  } while (ExclusiveStartKey);

  if (items.length === 0) {
    return null;
  }

  // From filtered results, pick the one whose SK really ends with "#<projectId>"
  const exact = items.find((item) => {
    const sk = item[SK_NAME];
    return typeof sk === 'string' && sk.endsWith(idSuffix);
  });

  const orgId: string = exact.sort_key.split('#')[0];
  const orgRes = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: {
      [PK_NAME]: ORG_PK,
      [SK_NAME]: orgId,
    },
  }));

  const withOrg = {
    ...exact,
    organization: orgRes.Item
  };

  return withOrg ?? null;
}

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

type ScanAndDeleteResult = {
  projectId: string;
  scannedCount: number;
  matchedCount: number;
  deletedCount: number;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function assertProjectId(projectId: string) {
  const pid = String(projectId ?? '').trim();
  if (!pid) throw new Error('projectId is required');
  return pid;
}

export async function scanKeysWhereSkContainsProjectId(projectId: string, limitPerPage = 250): Promise<DBItem[]> {
  const pid = assertProjectId(projectId);

  const keys: DBItem[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;

  do {
    const res = await docClient.send(
      new ScanCommand({
        TableName: DB_TABLE_NAME,
        FilterExpression: 'contains(#sk, :pid)',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
        },
        ExpressionAttributeValues: {
          ':pid': pid,
        },
        ProjectionExpression: '#pk, #sk',
        ExclusiveStartKey,
        Limit: limitPerPage,
      }),
    );

    for (const it of res.Items ?? []) {
      const pkVal = it?.[PK_NAME];
      const skVal = it?.[SK_NAME];
      if (typeof pkVal === 'string' && typeof skVal === 'string') keys.push({ [PK_NAME]: pkVal, [SK_NAME]: skVal });
    }

    ExclusiveStartKey = res.LastEvaluatedKey as any;
  } while (ExclusiveStartKey);

  return keys;
}

async function batchWriteDelete(keys: DBItem[]): Promise<number> {
  if (!keys.length) return 0;

  let deleted = 0;

  for (const group of chunk(keys, 25)) {
    const res = await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [DB_TABLE_NAME]: group.map((k) => ({
            DeleteRequest: {
              Key: {
                [PK_NAME]: k[PK_NAME],
                [SK_NAME]: k[SK_NAME],
              },
            },
          })),
        },
      }),
    );

    const unprocessed = res.UnprocessedItems?.[DB_TABLE_NAME] ?? [];
    deleted += group.length - unprocessed.length;

    if (unprocessed.length) {
      const retry = unprocessed
        .map((x) => x.DeleteRequest?.Key)
        .filter(Boolean)
        .map((k: any) => ({
          [PK_NAME]: k[PK_NAME] as string,
          [SK_NAME]: k[SK_NAME] as string,
        }));

      deleted += await batchWriteDelete(retry);
    }
  }

  return deleted;
}

export async function deleteEverythingWhereSkContainsProjectId(projectId: string): Promise<ScanAndDeleteResult> {
  const pid = assertProjectId(projectId);

  let scannedCount = 0;
  let matchedCount = 0;
  let deletedCount = 0;

  let ExclusiveStartKey: Record<string, any> | undefined;

  do {
    const res = await docClient.send(
      new ScanCommand({
        TableName: DB_TABLE_NAME,
        FilterExpression: 'contains(#sk, :pid)',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
        },
        ExpressionAttributeValues: {
          ':pid': pid,
        },
        ProjectionExpression: '#pk, #sk',
        ExclusiveStartKey,
        Limit: 250,
        ReturnConsumedCapacity: 'NONE',
      }),
    );

    scannedCount += res.ScannedCount ?? 0;

    const pageKeys: DBItem[] = [];
    for (const it of res.Items ?? []) {
      const pkVal = it?.[PK_NAME];
      const skVal = it?.[SK_NAME];
      if (typeof pkVal === 'string' && typeof skVal === 'string') pageKeys.push({ [PK_NAME]: pkVal, [SK_NAME]: skVal });
    }

    matchedCount += pageKeys.length;

    if (pageKeys.length) {
      deletedCount += await batchWriteDelete(pageKeys);
    }

    ExclusiveStartKey = res.LastEvaluatedKey as any;
  } while (ExclusiveStartKey);

  return { projectId: pid, scannedCount, matchedCount, deletedCount };
}

