import { Context } from 'aws-lambda';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { withSentryLambda } from '../sentry-lambda';
import { PK_NAME, SK_NAME } from '../constants/common';
import { DOCUMENT_PK } from '../constants/document';
import { streamToString } from '../helpers/s3';
import { requireEnv } from '../helpers/env';

const REGION = requireEnv('REGION', 'us-east-1');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

const CHUNK_MAX_CHARS = Number(process.env.CHUNK_MAX_CHARS ?? 2500);
const CHUNK_OVERLAP_CHARS = Number(process.env.CHUNK_OVERLAP_CHARS ?? 250);
const CHUNK_MIN_CHARS = Number(process.env.CHUNK_MIN_CHARS ?? 200);

const s3 = new S3Client({ region: REGION });

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

interface ChunkingEvent {
  documentId?: string;
  knowledgeBaseId?: string;
  bucket?: string;
  txtKey?: string;
}

function buildChunksPrefixFromTxtKey(txtKey: string): string {
  const lastSlash = txtKey.lastIndexOf('/');
  const dir = lastSlash >= 0 ? txtKey.slice(0, lastSlash) : '';
  return (dir ? `${dir}/` : '') + 'chunks/';
}

function chunkText(
  text: string,
  opts: { maxChars: number; overlapChars: number; minChars: number },
): string[] {
  const cleaned = (text || '').trim();
  if (!cleaned) return [];

  const maxChars = Math.max(200, opts.maxChars);
  const overlap = Math.max(0, Math.min(opts.overlapChars, Math.floor(maxChars / 2)));
  const minChars = Math.max(1, opts.minChars);

  const out: string[] = [];
  let start = 0;

  while (start < cleaned.length) {
    const end = Math.min(cleaned.length, start + maxChars);
    let chunk = cleaned.slice(start, end);

    // Prefer to cut on a nicer boundary if possible
    if (end < cleaned.length) {
      const lastBreak = Math.max(
        chunk.lastIndexOf('\n\n'),
        chunk.lastIndexOf('\n'),
        chunk.lastIndexOf('. '),
      );
      if (lastBreak > Math.floor(maxChars * 0.6)) {
        chunk = chunk.slice(0, lastBreak + 1);
      }
    }

    chunk = chunk.trim();
    if (chunk.length >= minChars) out.push(chunk);

    if (end >= cleaned.length) break;

    start = start + (chunk.length || maxChars) - overlap;
    if (start < 0) start = 0;
  }

  return out;
}

async function findDocKey(documentId: string) {
  const skSuffix = `#DOC#${documentId}`;

  const queryRes = await ddb.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME!,
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: { '#pk': PK_NAME },
      ExpressionAttributeValues: { ':pk': DOCUMENT_PK },
    }),
  );

  const items = (queryRes.Items || []) as any[];
  const doc = items.find((it) => String(it[SK_NAME]).endsWith(skSuffix));
  if (!doc) throw new Error(`Document not found for documentId=${documentId}`);

  return { pk: doc[PK_NAME], sk: doc[SK_NAME] };
}

export const baseHandler = async (
  event: ChunkingEvent,
  _ctx: Context,
): Promise<{
  documentId: string;
  bucket: string;
  txtKey: string;
  chunksPrefix: string;
  chunksCount: number;
  items: Array<{ bucket: string; chunkKey: string; index: number }>;
}> => {
  console.log('chunking event:', JSON.stringify(event));

  const documentId = event.documentId;
  const txtKey = event.txtKey;
  const bucket = event.bucket || DOCUMENTS_BUCKET;

  if (!documentId) throw new Error('documentId is required');
  if (!txtKey) throw new Error('txtKey is required');
  if (!bucket) throw new Error('bucket is required');

  // 1) Read txt from S3
  const obj = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: txtKey,
    }),
  );

  const text = await streamToString(obj.Body as any);

  if (!text.trim()) {
    throw new Error('Text file is empty, nothing to chunk');
  }

  // 2) Chunk
  const chunks = chunkText(text, {
    maxChars: CHUNK_MAX_CHARS,
    overlapChars: CHUNK_OVERLAP_CHARS,
    minChars: CHUNK_MIN_CHARS,
  });

  const chunksPrefix = buildChunksPrefixFromTxtKey(txtKey);

  // 3) Save chunks to S3 and build items list for Step Functions Map
  const items: Array<{ bucket: string; chunkKey: string; index: number }> = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunkKey = `${chunksPrefix}${i + 1}.txt`;
    const body = chunks[i];

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: chunkKey,
        Body: Buffer.from(body, 'utf-8'),
        ContentType: 'text/plain; charset=utf-8',
      }),
    );

    items.push({ bucket, chunkKey, index: i + 1 });
  }

  // 4) Update Dynamo with chunking metadata (optional but very useful)
  try {
    const { pk, sk } = await findDocKey(documentId);
    const now = new Date().toISOString();

    await ddb.send(
      new UpdateCommand({
        TableName: DB_TABLE_NAME!,
        Key: { [PK_NAME]: pk, [SK_NAME]: sk },
        UpdateExpression:
          'SET #indexStatus = :s, #chunksPrefix = :p, #chunksCount = :c, #updatedAt = :u',
        ExpressionAttributeNames: {
          '#indexStatus': 'indexStatus',
          '#chunksPrefix': 'chunksPrefix',
          '#chunksCount': 'chunksCount',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':s': 'CHUNKED',
          ':p': chunksPrefix,
          ':c': chunks.length,
          ':u': now,
        },
      }),
    );
  } catch (e) {
    console.warn('Failed to update Dynamo with chunking metadata (continuing):', e);
  }

  return {
    documentId,
    bucket,
    txtKey,
    chunksPrefix,
    chunksCount: chunks.length,
    items,
  };
};

export const handler = withSentryLambda(baseHandler);
