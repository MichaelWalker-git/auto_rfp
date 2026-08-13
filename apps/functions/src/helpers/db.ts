import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { requireEnv } from './env';
import { PK_NAME, SK_NAME } from '../constants/common';
import { nowIso } from './date';

const REGION = requireEnv('REGION', 'us-east-1');
const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

const ddbClient = new DynamoDBClient({ region: REGION });
export const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

/** Default number of retry attempts for transient DynamoDB errors. */
export const DEFAULT_MAX_RETRIES = 3;

/**
 * DynamoDB error names that are safe to retry — throttling, hot-partition
 * pressure, and transient server faults. ConditionalCheckFailedException is
 * deliberately excluded: it signals a business-rule failure (e.g. item already
 * exists / does not exist), not a transient fault, so retrying never helps.
 */
const RETRYABLE_ERROR_NAMES = new Set([
  'ProvisionedThroughputExceededException', // hot partition / throughput
  'ThrottlingException',
  'RequestLimitExceeded',
  'TransactionConflictException', // hot item contention
  'InternalServerError',
  'ServiceUnavailable',
]);

const isRetryableError = (err: unknown): boolean => {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as {
    name?: string;
    message?: string;
    $retryable?: unknown;
    $metadata?: { httpStatusCode?: number };
  };
  if (e.name && RETRYABLE_ERROR_NAMES.has(e.name)) return true;
  if (e.$retryable) return true; // AWS SDK marks transient faults as retryable
  const status = e.$metadata?.httpStatusCode;
  if (status === 429 || status === 500 || status === 503) return true;
  if (e.message?.includes('Throughput exceeds')) return true;
  return false;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run a DynamoDB operation with exponential backoff (+ jitter) on transient
 * errors. Retries up to `maxRetries` times (default 3) before rethrowing the
 * last error. Non-retryable errors (e.g. ConditionalCheckFailedException) are
 * rethrown immediately.
 */
export const withRetry = async <T>(
  operation: () => Promise<T>,
  options?: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    label?: string;
  },
): Promise<T> => {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options?.baseDelayMs ?? 100;
  const maxDelayMs = options?.maxDelayMs ?? 2000;

  let attempt = 0;
  for (;;) {
    try {
      return await operation();
    } catch (err) {
      if (!isRetryableError(err) || attempt >= maxRetries) throw err;
      const backoff = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      const delay = backoff + Math.random() * backoff * 0.2; // 20% jitter
      const name = (err as { name?: string })?.name ?? 'unknown';
      console.warn(
        `[db] retryable error${options?.label ? ` (${options.label})` : ''} on attempt ${attempt + 1}/${maxRetries}, retrying in ${Math.round(delay)}ms: ${name}`,
      );
      await sleep(delay);
      attempt++;
    }
  }
};

export type DBItem = {
  [PK_NAME]: string;
  [SK_NAME]: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
  createdByName?: string;
  updatedByName?: string;
}

export type UserContext = {
  userId?: string;
  userName?: string;
};

/**
 * Generic create item helper
 * Automatically adds createdAt and updatedAt timestamps
 */
export const createItem = async <T extends Record<string, any>>(
  pk: string,
  sk: string,
  item: Omit<T, typeof PK_NAME | typeof SK_NAME | 'createdAt' | 'updatedAt'>,
  options?: {
    condition?: string;
    conditionNames?: Record<string, string>;
    conditionValues?: Record<string, any>;
  }
): Promise<T & DBItem> => {
  const now = nowIso();
  
  // Keys after the spread, for the same reason as `putItem` below: an item that
  // carries its own key fields must not be able to overwrite the arguments.
  const fullItem = {
    ...item,
    [PK_NAME]: pk,
    [SK_NAME]: sk,
    createdAt: now,
    updatedAt: now,
  } as T & DBItem;

  const command: any = {
    TableName: DB_TABLE_NAME,
    Item: fullItem,
  };

  // Default condition: item must not exist
  if (options?.condition) {
    command.ConditionExpression = options.condition;
    command.ExpressionAttributeNames = options.conditionNames;
    command.ExpressionAttributeValues = options.conditionValues;
  } else {
    command.ConditionExpression = 'attribute_not_exists(#pk) AND attribute_not_exists(#sk)';
    command.ExpressionAttributeNames = { '#pk': PK_NAME, '#sk': SK_NAME };
  }

  await withRetry(() => docClient.send(new PutCommand(command)), { label: 'createItem' });

  return fullItem;
};

/**
 * Generic update item helper
 * Automatically updates updatedAt timestamp
 */
export const updateItem = async <T extends Record<string, any>>(
  pk: string,
  sk: string,
  updates: Partial<Omit<T, typeof PK_NAME | typeof SK_NAME | 'createdAt'>>,
  options?: {
    condition?: string;
    conditionNames?: Record<string, string>;
    conditionValues?: Record<string, any>;
    returnValues?: 'ALL_NEW' | 'ALL_OLD' | 'UPDATED_NEW' | 'UPDATED_OLD';
  }
): Promise<T & DBItem> => {
  const now = nowIso();
  
  const names: Record<string, string> = {
    '#pk': PK_NAME,
    '#sk': SK_NAME,
    '#updatedAt': 'updatedAt',
    ...(options?.conditionNames || {}),
  };
  
  const values: Record<string, any> = {
    ':updatedAt': now,
    ...(options?.conditionValues || {}),
  };
  
  const setParts: string[] = ['#updatedAt = :updatedAt'];
  
  // Build update expression from updates object
  Object.entries(updates).forEach(([key, value]) => {
    if (value !== undefined && key !== 'updatedAt') {
      const nameKey = `#${key}`;
      const valueKey = `:${key}`;
      names[nameKey] = key;
      values[valueKey] = value;
      setParts.push(`${nameKey} = ${valueKey}`);
    }
  });

  const command: any = {
    TableName: DB_TABLE_NAME,
    Key: {
      [PK_NAME]: pk,
      [SK_NAME]: sk,
    },
    UpdateExpression: `SET ${setParts.join(', ')}`,
    ReturnValues: options?.returnValues || 'ALL_NEW',
  };

  // Default condition: item must exist
  if (options?.condition) {
    command.ConditionExpression = options.condition;
  } else {
    command.ConditionExpression = 'attribute_exists(#pk) AND attribute_exists(#sk)';
  }

  // DynamoDB rejects the whole update when ExpressionAttributeNames/-Values
  // contain entries no expression references (e.g. the seeded #pk/#sk when a
  // caller supplies a custom condition that doesn't use them) — keep only
  // what the final expressions actually mention.
  const expressionText = `${command.UpdateExpression} ${command.ConditionExpression}`;
  const isReferenced = (key: string) =>
    new RegExp(`${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(expressionText);
  command.ExpressionAttributeNames = Object.fromEntries(
    Object.entries(names).filter(([key]) => isReferenced(key)),
  );
  command.ExpressionAttributeValues = Object.fromEntries(
    Object.entries(values).filter(([key]) => isReferenced(key)),
  );

  const res = await withRetry(() => docClient.send(new UpdateCommand(command)), { label: 'updateItem' });
  return res.Attributes as T & DBItem;
};

/**
 * Generic put item helper (upsert)
 * Automatically adds/updates timestamps
 */
export const putItem = async <T extends Record<string, any>>(
  pk: string,
  sk: string,
  item: Omit<T, typeof PK_NAME | typeof SK_NAME>,
  preserveCreatedAt: boolean = false
): Promise<T & DBItem> => {
  const now = nowIso();
  
  /**
   * Keys are applied AFTER the spread, so the caller's item can never clobber them.
   *
   * They used to come first, which meant an item carrying its own
   * `partition_key`/`sort_key` silently overwrote the arguments. That is not
   * hypothetical: `deriveFoiaRequest` seeded both with `''` to satisfy the
   * `DBFOIARequestItem` type, and every automated FOIA preparation then failed
   * with "The AttributeValue for a key attribute cannot contain an empty string
   * value" — a message that names the symptom and none of the twelve helpers in
   * the call graph.
   *
   * The `item: Omit<T, typeof PK_NAME | typeof SK_NAME>` signature does not
   * prevent this. `PK_NAME` is a `const` of type `string`, so that resolves to
   * `Omit<T, string>`, which strips nothing — and even a correct `Omit` only
   * removes the property from the *type*, never from the runtime object.
   */
  let fullItem: any = {
    ...item,
    [PK_NAME]: pk,
    [SK_NAME]: sk,
    updatedAt: now,
  };

  // If preserveCreatedAt is false and createdAt is not in item, add it
  if (!preserveCreatedAt && !item.createdAt) {
    fullItem.createdAt = now;
  }

  await withRetry(
    () => docClient.send(new PutCommand({
      TableName: DB_TABLE_NAME,
      Item: fullItem,
    })),
    { label: 'putItem' },
  );

  return fullItem as T & DBItem;
};


/**
 * Overwrite an item with a fully-formed record whose PK/SK are already embedded.
 *
 * Unlike `putItem`, this does NOT inject/overwrite `createdAt`/`updatedAt` — the
 * caller supplies the complete record (timestamps included). Use it when the
 * caller has already merged the desired state (e.g. an incremental sync that
 * preserves existing history/createdAt) and needs an idempotent full overwrite
 * keyed on the record's own PK/SK.
 */
export const putFullItem = async <T extends { [PK_NAME]: string; [SK_NAME]: string }>(
  item: T,
): Promise<T> => {
  await withRetry(
    () => docClient.send(new PutCommand({ TableName: DB_TABLE_NAME, Item: item })),
    { label: 'putFullItem' },
  );
  return item;
};

export const deleteItem = async (pk: string, sk: string) => {
  console.log('Deleting record from DynamoDB', DB_TABLE_NAME, pk, sk);
  return await withRetry(
    () => docClient.send(
      new DeleteCommand({
        TableName: DB_TABLE_NAME,
        Key: {
          [PK_NAME]: pk,
          [SK_NAME]: sk,
        },
      }),
    ),
    { label: 'deleteItem' },
  );
};

export const getItem = async <T>(
  pk: string,
  sk: string,
): Promise<T | null> => {
  const res = await withRetry(
    () => docClient.send(
      new GetCommand({
        TableName: DB_TABLE_NAME,
        Key: {
          [PK_NAME]: pk,
          [SK_NAME]: sk,
        },
      }),
    ),
    { label: 'getItem' },
  );

  return (res.Item as T) ?? null;
};

export const queryByPk = async <T>(pk: string): Promise<T[]> => {
  const res = await withRetry(
    () => docClient.send(
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
    ),
    { label: 'queryByPk' },
  );

  return (res.Items as T[]) ?? [];
};

export const queryBySkPrefix = async <T>(pk: string, skPrefix: string): Promise<T[]> => {
  const res = await withRetry(
    () => docClient.send(
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
    ),
    { label: 'queryBySkPrefix' },
  );

  return (res.Items as T[]) ?? [];
};

export const queryByPkAndSkContains = async <T>(
  pk: string,
  skSubstring: string,
): Promise<T[]> => {
  const res = await withRetry(
    () => docClient.send(
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
    ),
    { label: 'queryByPkAndSkContains' },
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
    const res = await withRetry(
      () => docClient.send(
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
      ),
      { label: 'queryAllBySkPrefix' },
    );

    items.push(...((res.Items as T[]) ?? []));
    ExclusiveStartKey = res.LastEvaluatedKey as any;
  } while (ExclusiveStartKey);

  return items;
};

/**
 * Query a GSI by its partition key (and optional sort key), with pagination.
 * Generic so any feature can query an index without a raw QueryCommand.
 */
export const queryByIndex = async <T>(
  indexName: string,
  partitionKeyName: string,
  partitionKeyValue: string,
  sortKey?: { name: string; value: string },
  projectionExpression?: string,
): Promise<T[]> => {
  const items: T[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;

  const names: Record<string, string> = { '#pk': partitionKeyName };
  const values: Record<string, any> = { ':pk': partitionKeyValue };
  let keyCondition = '#pk = :pk';
  if (sortKey) {
    names['#sk'] = sortKey.name;
    values[':sk'] = sortKey.value;
    keyCondition += ' AND #sk = :sk';
  }

  do {
    const res = await withRetry(
      () => docClient.send(
        new QueryCommand({
          TableName: DB_TABLE_NAME,
          IndexName: indexName,
          KeyConditionExpression: keyCondition,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ProjectionExpression: projectionExpression,
          ExclusiveStartKey,
        }),
      ),
      { label: 'queryByIndex' },
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
    const res = await withRetry(
      () => docClient.send(
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
      ),
      { label: 'scanByPkWithFilter' },
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
      } catch (err: unknown) {
        if (isRetryableError(err)) {
          // Exponential backoff for throughput / transient errors
          const delay = Math.min(200 * Math.pow(2, retries), 5000);
          console.warn(`Retryable batch-delete error, retrying in ${delay}ms...`);
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
 * Delete a single item, returning a boolean instead of throwing.
 * `deleteItem` already retries transient errors via withRetry; this wrapper
 * just converts a surviving failure into `false` for callers that prefer a
 * non-throwing API (e.g. best-effort cleanup).
 *
 * @param maxRetries Override the retry count (defaults to DEFAULT_MAX_RETRIES).
 */
export const deleteItemWithRetry = async (
  pk: string,
  sk: string,
  maxRetries = DEFAULT_MAX_RETRIES,
): Promise<boolean> => {
  try {
    await withRetry(
      () => docClient.send(
        new DeleteCommand({
          TableName: DB_TABLE_NAME,
          Key: { [PK_NAME]: pk, [SK_NAME]: sk },
        }),
      ),
      { maxRetries, label: 'deleteItemWithRetry' },
    );
    return true;
  } catch (err) {
    console.error('Delete item error after retries:', err);
    return false;
  }
};
