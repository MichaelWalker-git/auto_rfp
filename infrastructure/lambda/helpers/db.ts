import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  ScanCommand
} from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { requireEnv } from './env';
import { PK_NAME, SK_NAME } from '../constants/common';

const REGION = requireEnv('REGION', 'us-east-1');
const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

const ddbClient = new DynamoDBClient({ region: REGION });
export const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

export type DBItem = {
  [PK_NAME]: string;
  [SK_NAME]: string;
  createdAt?: string;
  updatedAt?: string;
}


export const deleteItem = async (pk: string, sk: string) => {
  console.log('Deleting record from DynamoDB', DB_TABLE_NAME, pk, sk);
  return await docClient.send(
    new DeleteCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: pk,
        [SK_NAME]: sk,
      },
    }),
  );
};

export const getItem = async <T>(
  pk: string,
  sk: string,
): Promise<T | null> => {
  const res = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: pk,
        [SK_NAME]: sk,
      },
    }),
  );

  return (res.Item as T) ?? null;
};

export const queryBySkPrefix = async <T>(pk: string, skPrefix: string): Promise<T[]> => {
  const res = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
      ExpressionAttributeValues: {
        ':pk': pk,
        ':skPrefix': skPrefix,
      },
    }),
  );

  return (res.Items as T[]) ?? [];
};

export const queryByPkAndSkContains = async <T>(
  pk: string,
  skSubstring: string,
): Promise<T[]> => {
  const res = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
      },
      ExpressionAttributeValues: {
        ':pk': pk,
      },
    }),
  );

  return ((res.Items as T[]) ?? []).filter((item: any) =>
    item[SK_NAME]?.includes(skSubstring)
  );
};

/**
 * Query all items by PK and SK prefix with pagination support
 * Returns full items (not just keys) for additional processing
 */
export const queryAllBySkPrefix = async <T>(
  pk: string,
  skPrefix: string,
  projectionExpression?: string,
  expressionAttributeNames?: Record<string, string>,
): Promise<T[]> => {
  const items: T[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
          ...expressionAttributeNames,
        },
        ExpressionAttributeValues: {
          ':pk': pk,
          ':skPrefix': skPrefix,
        },
        ProjectionExpression: projectionExpression,
        ExclusiveStartKey,
      }),
    );

    items.push(...((res.Items as T[]) ?? []));
    ExclusiveStartKey = res.LastEvaluatedKey as any;
  } while (ExclusiveStartKey);

  return items;
};

/**
 * Scan items by PK with a filter expression (for cases where Query is not possible)
 */
export const scanByPkWithFilter = async <T>(
  pk: string,
  filterAttribute: string,
  filterValue: string,
): Promise<T[]> => {
  const items: T[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;

  do {
    const res = await docClient.send(
      new ScanCommand({
        TableName: DB_TABLE_NAME,
        FilterExpression: '#pk = :pk AND #filterAttr = :filterVal',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#filterAttr': filterAttribute,
        },
        ExpressionAttributeValues: {
          ':pk': pk,
          ':filterVal': filterValue,
        },
        ExclusiveStartKey,
      }),
    );

    items.push(...((res.Items as T[]) ?? []));
    ExclusiveStartKey = res.LastEvaluatedKey as any;
  } while (ExclusiveStartKey);

  return items;
};

/**
 * Batch delete items from DynamoDB with exponential backoff for throttling
 * Handles up to 25 items per batch (DynamoDB limit)
 */
export const batchDeleteItems = async (
  items: Array<{ pk: string; sk: string }>,
): Promise<{ deleted: number; failed: number }> => {
  if (!items.length) return { deleted: 0, failed: 0 };

  const BATCH_SIZE = 25;
  let deleted = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const deleteRequests = batch.map((item) => ({
      DeleteRequest: {
        Key: {
          [PK_NAME]: item.pk,
          [SK_NAME]: item.sk,
        },
      },
    }));

    let retries = 0;
    const maxRetries = 5;
    let unprocessedItems = deleteRequests;

    while (unprocessedItems.length > 0 && retries < maxRetries) {
      try {
        const res = await docClient.send(
          new BatchWriteCommand({
            RequestItems: {
              [DB_TABLE_NAME]: unprocessedItems,
            },
          }),
        );

        const processedCount = unprocessedItems.length - (res.UnprocessedItems?.[DB_TABLE_NAME]?.length ?? 0);
        deleted += processedCount;

        unprocessedItems = (res.UnprocessedItems?.[DB_TABLE_NAME] ?? []) as typeof deleteRequests;

        if (unprocessedItems.length > 0) {
          // Exponential backoff for unprocessed items
          const delay = Math.min(100 * Math.pow(2, retries), 3000);
          await new Promise((resolve) => setTimeout(resolve, delay));
          retries++;
        }
      } catch (err: any) {
        if (err.name === 'ProvisionedThroughputExceededException' ||
          err.message?.includes('Throughput exceeds')) {
          // Exponential backoff for throughput errors
          const delay = Math.min(200 * Math.pow(2, retries), 5000);
          console.warn(`Throughput exceeded, retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          retries++;
        } else {
          console.error('Batch delete error:', err);
          failed += unprocessedItems.length;
          break;
        }
      }
    }

    if (retries >= maxRetries && unprocessedItems.length > 0) {
      console.warn(`Failed to delete ${unprocessedItems.length} items after ${maxRetries} retries`);
      failed += unprocessedItems.length;
    }

    // Small delay between batches to avoid throttling
    if (i + BATCH_SIZE < items.length) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  return { deleted, failed };
};

/**
 * Delete all items matching a PK and SK prefix
 */
export const deleteAllBySkPrefix = async (
  pk: string,
  skPrefix: string,
): Promise<{ deleted: number; failed: number }> => {
  const items = await queryAllBySkPrefix<DBItem>(pk, skPrefix);
  const keysToDelete = items.map((item) => ({
    pk: item[PK_NAME],
    sk: item[SK_NAME],
  }));
  return batchDeleteItems(keysToDelete);
};

/**
 * Delete a single item with retry logic for throughput errors
 */
export const deleteItemWithRetry = async (
  pk: string,
  sk: string,
  maxRetries = 3,
): Promise<boolean> => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await deleteItem(pk, sk);
      return true;
    } catch (err: any) {
      if (err.name === 'ProvisionedThroughputExceededException' ||
        err.message?.includes('Throughput exceeds')) {
        const delay = Math.min(100 * Math.pow(2, attempt), 2000);
        console.warn(`Throughput exceeded for delete, retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        console.error('Delete item error:', err);
        return false;
      }
    }
  }
  return false;
};
