import { Context } from 'aws-lambda';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { withSentryLambda } from '../../sentry-lambda';
import { indexChunkToPinecone } from '@/helpers/pinecone';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { DOCUMENT_PK } from '@/constants/document';
import { streamToString } from '@/helpers/s3';
import { requireEnv } from '@/helpers/env';
import { docClient, getItem } from '@/helpers/db';
import { DocumentItem } from '@auto-rfp/core';
import { buildDocumentSK } from '@/helpers/document';


const REGION = requireEnv('REGION', 'us-east-1');
const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

const s3Client = new S3Client({ region: REGION });

interface IndexChunkEvent {
  orgId: string;
  knowledgeBaseId: string;
  documentId?: string;
  bucket?: string;
  chunkKey?: string;
  text?: string;
  index?: number;
  totalChunks?: number;
}

interface IndexChunkResult {
  success: boolean;
  documentId: string;
  chunkKey: string;
  pineconeIndex: string;
  markedIndexed: boolean;
  pineconeId?: string;
  skipped?: boolean;
  skipReason?: string;
}

export const baseHandler = async (
  event: IndexChunkEvent,
  _context: Context,
): Promise<IndexChunkResult> => {
  console.log('IndexChunk event:', JSON.stringify(event));

  const { orgId, documentId, chunkKey, knowledgeBaseId } = event;

  if (!orgId || !documentId || !chunkKey || !knowledgeBaseId) throw new Error('orgId, documentId and chunkKey are required');

  const bucket = event.bucket || DOCUMENTS_BUCKET;

  const text = typeof event.text === 'string' && event.text.trim().length > 0
    ? event.text
    : await readChunkTextFromS3(bucket, chunkKey);

  const document = await getItem<DocumentItem>(
    DOCUMENT_PK,
    buildDocumentSK(knowledgeBaseId, documentId),
  );

  // Handle case where document was deleted mid-pipeline (AUTO-RFP-6F)
  // Instead of throwing, return early with skipped status
  if (!document) {
    console.warn(
      `Document not found, may have been deleted mid-pipeline. documentId=${documentId}, knowledgeBaseId=${knowledgeBaseId}`
    );
    return {
      success: true,
      documentId,
      chunkKey,
      pineconeIndex: 'documents',
      markedIndexed: false,
      skipped: true,
      skipReason: 'document_deleted',
    };
  }

  const pineconeId = await indexChunkToPinecone(
    orgId,
    document,
    chunkKey,
    text,
  );

  let markedIndexed = false;
  const idx = typeof event.index === 'number' ? event.index : undefined;
  const total = typeof event.totalChunks === 'number' ? event.totalChunks : undefined;

  // NOTE: some pipelines use 1-based indexing; keep the same logic you used before
  if (idx != null && total != null && idx === total) {
    await markIndexed(documentId, knowledgeBaseId);
    markedIndexed = true;
  }

  return {
    success: true,
    documentId,
    chunkKey,
    pineconeIndex: 'documents',
    markedIndexed,
    pineconeId,
  };
};

async function readChunkTextFromS3(bucket: string, key: string): Promise<string> {
  const res = await s3Client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );

  if (!res.Body) {
    throw new Error(`S3 GetObject returned empty body. s3://${bucket}/${key}`);
  }

  return streamToString(res.Body as any);
}

/**
 * Retry configuration for handling WCU/RCU throttling
 */
const RETRY_CONFIG = {
  maxRetries: 5,
  initialDelayMs: 100,
  maxDelayMs: 32000,
};

/**
 * Calculate exponential backoff delay with jitter
 */
function getBackoffDelay(attemptNumber: number): number {
  const exponentialDelay = RETRY_CONFIG.initialDelayMs * Math.pow(2, attemptNumber);
  const cappedDelay = Math.min(exponentialDelay, RETRY_CONFIG.maxDelayMs);
  // Add jitter: random value between 0 and capped delay
  return cappedDelay * Math.random();
}

/**
 * Delay utility function
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if error is a throttling/capacity error
 */
function isThrottlingError(error: any): boolean {
  const errorCode = error?.__type || error?.name || '';
  const errorMessage = error?.message || '';

  return (
    errorCode.includes('ThrottlingException') ||
    errorCode.includes('ProvisionedThroughputExceededException') ||
    errorCode.includes('ValidationException') && errorMessage.includes('throughput') ||
    errorMessage.includes('throttl')
  );
}

/**
 * Update a single item with retry logic
 */
async function updateItemWithRetry(
  key: Record<string, any>,
  now: string,
  attemptNumber: number = 0,
): Promise<void> {
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: DB_TABLE_NAME!,
        Key: {
          [PK_NAME]: key[PK_NAME],
          [SK_NAME]: key[SK_NAME],
        },
        UpdateExpression: 'SET #indexStatus = :s, #updatedAt = :u',
        ExpressionAttributeNames: {
          '#indexStatus': 'indexStatus',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':s': 'INDEXED',
          ':u': now,
        },
      }),
    );
  } catch (error) {
    if (isThrottlingError(error) && attemptNumber < RETRY_CONFIG.maxRetries) {
      const backoffMs = getBackoffDelay(attemptNumber);
      console.warn(
        `Throttling detected for item ${key[SK_NAME]}, retrying after ${backoffMs.toFixed(0)}ms (attempt ${attemptNumber + 1}/${RETRY_CONFIG.maxRetries})`,
      );
      await delay(backoffMs);
      return updateItemWithRetry(key, now, attemptNumber + 1);
    }
    throw error;
  }
}

async function markIndexed(documentId: string, knowledgeBaseId?: string): Promise<void> {
  if (!documentId) throw new Error('documentId is required');

  const pk = DOCUMENT_PK;
  const now = new Date().toISOString();

  // If we have knowledgeBaseId, we can do a targeted query with begins_with
  // Otherwise, fall back to querying all documents and filtering (AUTO-RFP-6E fix)
  if (knowledgeBaseId) {
    // Targeted approach: query using the known SK prefix
    const skPrefix = `KB#${knowledgeBaseId}#DOC#${documentId}`;
    try {
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
          ProjectionExpression: '#pk, #sk',
        }),
      );

      for (const item of res.Items ?? []) {
        await updateItemWithRetry(item, now);
      }
      return;
    } catch (error: unknown) {
      // Log and fall through to broader query if targeted query fails
      console.warn('Targeted markIndexed query failed, falling back to broad query:', error);
    }
  }

  // Fallback: query all documents and filter client-side
  // Note: We only use #pk in KeyConditionExpression to avoid FilterExpression issues (AUTO-RFP-6E)
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
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
        ProjectionExpression: 'partition_key, sort_key',
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    const items = (res.Items ?? []).filter((it: Record<string, unknown>) => {
      const sk = String(it[SK_NAME] ?? '');
      return sk.endsWith(documentId);
    });

    // Process updates sequentially with retry logic to avoid overwhelming the table
    for (const item of items) {
      await updateItemWithRetry(item, now);
    }

    lastEvaluatedKey = res.LastEvaluatedKey;
  } while (lastEvaluatedKey);
}

export const handler = withSentryLambda(baseHandler);