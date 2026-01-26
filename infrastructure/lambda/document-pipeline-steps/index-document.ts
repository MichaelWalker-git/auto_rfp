import { Context } from 'aws-lambda';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { withSentryLambda } from '../sentry-lambda';
import { getEmbedding } from '../helpers/embeddings';
import { indexDocToPinecone } from '../helpers/pinecone';
import { PK_NAME, SK_NAME } from '../constants/common';
import { DOCUMENT_PK } from '../constants/document';
import { streamToString } from '../helpers/s3';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';


const REGION = requireEnv('REGION', 'us-east-1');
const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

const s3Client = new S3Client({ region: REGION });

interface IndexChunkEvent {
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
}

export const baseHandler = async (
  event: IndexChunkEvent,
  _context: Context,
): Promise<IndexChunkResult> => {
  console.log('IndexChunk event:', JSON.stringify(event));

  const { documentId, chunkKey } = event;
  if (!documentId || !chunkKey) throw new Error('documentId and chunkKey are required');

  const bucket = event.bucket || DOCUMENTS_BUCKET;

  const text = typeof event.text === 'string' && event.text.trim().length > 0
    ? event.text
    : await readChunkTextFromS3(bucket, chunkKey);

  const embedding = await getEmbedding(text);

  const externalId = makeStableId(documentId, chunkKey);

  const pineconeId = await indexDocToPinecone(
    documentId,
    chunkKey,
    bucket,
    embedding,
    externalId,
  );

  let markedIndexed = false;
  const idx = typeof event.index === 'number' ? event.index : undefined;
  const total = typeof event.totalChunks === 'number' ? event.totalChunks : undefined;

  // NOTE: some pipelines use 1-based indexing; keep the same logic you used before
  if (idx != null && total != null && idx === total) {
    await markIndexed(documentId);
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


function makeStableId(documentId: string, chunkKey: string) {
  return `${documentId}#${chunkKey}`;
}

async function markIndexed(documentId: string): Promise<void> {
  if (!documentId) throw new Error('documentId is required');

  const pk = DOCUMENT_PK;
  const now = new Date().toISOString();

  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
        },
        ExpressionAttributeValues: {
          ':pk': pk,
        },
        ProjectionExpression: '#pk, #sk',
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    const items = (res.Items ?? []).filter((it) => {
      const sk = String(it[SK_NAME] ?? '');
      return sk.endsWith(documentId);
    });

    await Promise.all(
      items.map((it) =>
        docClient.send(
          new UpdateCommand({
            TableName: DB_TABLE_NAME!,
            Key: {
              [PK_NAME]: it[PK_NAME],
              [SK_NAME]: it[SK_NAME],
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
        ),
      ),
    );

    lastEvaluatedKey = res.LastEvaluatedKey;
  } while (lastEvaluatedKey);
}

export const handler = withSentryLambda(baseHandler);