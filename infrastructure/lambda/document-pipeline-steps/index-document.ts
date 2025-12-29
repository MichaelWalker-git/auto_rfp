import { Context } from 'aws-lambda';
import https from 'https';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@smithy/protocol-http';

import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

import { withSentryLambda } from '../sentry-lambda';
import { getEmbedding } from '../helpers/embeddings';
import { PK_NAME, SK_NAME } from '../constants/common';
import { DOCUMENT_PK } from '../constants/document';
import { streamToString } from '../helpers/s3';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';


const REGION = requireEnv('REGION');
const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const OPENSEARCH_ENDPOINT = requireEnv('OPENSEARCH_ENDPOINT');
const OPENSEARCH_INDEX = requireEnv('OPENSEARCH_INDEX');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const BEDROCK_EMBEDDING_MODEL_ID = requireEnv('BEDROCK_EMBEDDING_MODEL_ID');

const s3Client = new S3Client({ region: REGION });
const bedrockClient = new BedrockRuntimeClient({ region: REGION });

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
  opensearchIndex: string;
  markedIndexed: boolean;
  opensearchId?: string;
}

const baseHandler = async (
  event: IndexChunkEvent,
  _context: Context,
): Promise<IndexChunkResult> => {
  console.log('IndexChunk event:', JSON.stringify(event));

  const { documentId, chunkKey } = event;
  if (!documentId || !chunkKey) throw new Error('documentId and chunkKey are required');

  const bucket = event.bucket || DOCUMENTS_BUCKET;

  // 1) Load text (prefer event.text, else read from S3)
  const text = typeof event.text === 'string' && event.text.trim().length > 0
    ? event.text
    : await readChunkTextFromS3(bucket, chunkKey);

  // 2) Embed
  const embedding = await getEmbedding(bedrockClient, BEDROCK_EMBEDDING_MODEL_ID, text);

  // 3) Index to OpenSearch Serverless (NO client-specified _id)
  const externalId = makeStableId(documentId, chunkKey);

  const doc = {
    type: 'chunk',
    documentId,
    chunkKey,
    bucket,
    embedding,
    externalId,
    createdAt: new Date().toISOString(),
  };

  console.log('AOSS target:', {
    endpoint: OPENSEARCH_ENDPOINT,
    index: OPENSEARCH_INDEX,
    path: `/${encodeURIComponent(OPENSEARCH_INDEX)}/_doc`,
  });

  const opensearchId = await aossIndexDoc(OPENSEARCH_INDEX, doc);

  // 4) Mark document indexed on last chunk (if provided)
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
    opensearchIndex: OPENSEARCH_INDEX,
    markedIndexed,
    opensearchId,
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
 * OpenSearch Serverless indexing:
 * - Use POST /{index}/_doc (no /_doc/{id})
 * - Don’t include `_id` in bulk metadata either
 */
async function aossIndexDoc(indexName: string, body: unknown): Promise<string | undefined> {
  const endpointUrl = new URL(OPENSEARCH_ENDPOINT!);
  const payload = JSON.stringify(body);

  const req = new HttpRequest({
    method: 'POST',
    protocol: endpointUrl.protocol,
    hostname: endpointUrl.hostname,
    path: `/${encodeURIComponent(indexName)}/_doc`,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload).toString(),
      host: endpointUrl.hostname,
    },
    body: payload,
  });

  const signer = new SignatureV4({
    service: 'aoss',
    region: REGION,
    credentials: defaultProvider(),
    sha256: Sha256,
  });

  const signed = await signer.sign(req);

  return new Promise((resolve, reject) => {
    const r = https.request(
      {
        method: signed.method,
        hostname: signed.hostname,
        path: signed.path,
        headers: signed.headers as any,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          const bodyStr = Buffer.concat(chunks).toString('utf-8');

          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            // typical response includes {"_id":"..."} but don’t rely on it
            try {
              const json = JSON.parse(bodyStr);
              resolve(json?._id);
            } catch {
              resolve(undefined);
            }
            return;
          }

          reject(
            new Error(
              `OpenSearch index failed: ${res.statusCode} ${res.statusMessage} - ${bodyStr}`,
            ),
          );
        });
      },
    );

    r.on('error', reject);
    if (signed.body) r.write(signed.body);
    r.end();
  });
}

function makeStableId(documentId: string, chunkKey: string): string {
  // deterministic id you can query on later (stored as externalId in the document)
  // keep it short-ish; chunkKey can be long, so hash-like string is better in prod,
  // but this is fine as a baseline.
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
        TableName: DB_TABLE_NAME!,
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