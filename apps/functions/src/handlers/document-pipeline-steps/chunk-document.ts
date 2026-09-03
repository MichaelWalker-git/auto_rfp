import { Context } from 'aws-lambda';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { withSentryLambda } from '@/sentry-lambda';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { loadTextFromS3 } from '@/helpers/s3';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import { nowIso } from '@/helpers/date';
import { DOCUMENT_PK } from '@/constants/document';
import { buildChunkKey, buildChunksPrefixFromTxtKey, buildDocumentSK } from '@/helpers/document-keys';

const REGION = requireEnv('REGION', 'us-east-1');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

const CHUNK_MAX_CHARS = Number(process.env.CHUNK_MAX_CHARS ?? 2500);
const CHUNK_OVERLAP_CHARS = Number(process.env.CHUNK_OVERLAP_CHARS ?? 250);
const CHUNK_MIN_CHARS = Number(process.env.CHUNK_MIN_CHARS ?? 10);

const s3 = new S3Client({ region: REGION });

type ChunkingEvent = {
  orgId: string;
  knowledgeBaseId?: string;
  documentId?: string;
  bucket?: string;
  txtKey?: string;
}

type ChunkResponse = {
  orgId: string;
  knowledgeBaseId?: string;
  documentId: string;
  bucket: string;
  txtKey: string;
  chunksPrefix: string;
  chunksCount: number;
  items: Array<{ bucket: string; chunkKey: string; index: number }>;
}

export function chunkText(text: string, opts: { maxChars: number; overlapChars: number; minChars: number }): string[] {
  if (!text) return [];
  const cleaned = text.trim();

  const maxChars = Math.max(200, opts.maxChars);
  const overlap = Math.max(0, Math.min(opts.overlapChars, Math.floor(maxChars / 2)));
  const minChars = Math.max(1, opts.minChars);

  const out: string[] = [];
  let start = 0;

  while (start < cleaned.length) {
    const end = Math.min(cleaned.length, start + maxChars);
    let chunk = cleaned.slice(start, end);

    // Number of raw characters consumed from `cleaned` by this window. Advancing
    // by this (pre-trim) amount — never by the trimmed length — is what guarantees
    // forward progress. Using the trimmed length against a raw index can go
    // negative for whitespace-heavy windows and loop forever (OOM).
    let consumed = end - start;

    // Prefer to cut on a nicer boundary if possible
    if (end < cleaned.length) {
      const lastBreak = Math.max(
        chunk.lastIndexOf('\n\n'),
        chunk.lastIndexOf('\n'),
        chunk.lastIndexOf('. '),
      );
      if (lastBreak > Math.floor(maxChars * 0.6)) {
        chunk = chunk.slice(0, lastBreak + 1);
        consumed = lastBreak + 1;
      }
    }

    const trimmed = chunk.trim();
    if (trimmed.length >= minChars) out.push(trimmed);

    if (end >= cleaned.length) break;

    // Always move forward by at least 1 char, even after overlap subtraction, so
    // the loop can never revisit the same region.
    start += Math.max(1, consumed - overlap);
  }

  return out;
}

export const baseHandler = async (event: ChunkingEvent, _ctx: Context): Promise<ChunkResponse> => {
  console.log('chunking event:', JSON.stringify(event));

  const { txtKey, orgId, knowledgeBaseId, documentId } = event;
  const bucket = event.bucket || DOCUMENTS_BUCKET;

  if (!documentId || !knowledgeBaseId || !txtKey || !orgId)
    throw new Error('Required parameter is misssing');

  const text = await loadTextFromS3(bucket, txtKey);

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
    const chunkKey = buildChunkKey(chunksPrefix, i);
    const body = chunks[i]!; // Safe: iterating within bounds

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

  // A document with zero chunks has nothing for the Step Functions Map state
  // to index — it finishes indexing right here, so chunkCount must be
  // persisted now rather than waiting on markIndexed() in index-document.ts.
  const isImmediatelyIndexed = chunks.length === 0;

  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: DOCUMENT_PK,
        [SK_NAME]: buildDocumentSK(knowledgeBaseId, documentId),
      },
      UpdateExpression: isImmediatelyIndexed
        ? 'SET #indexStatus = :s, #chunksPrefix = :p, #chunksCount = :c, #chunkCount = :cc, #updatedAt = :u'
        : 'SET #indexStatus = :s, #chunksPrefix = :p, #chunksCount = :c, #updatedAt = :u',
      ExpressionAttributeNames: {
        '#indexStatus': 'indexStatus',
        '#chunksPrefix': 'chunksPrefix',
        '#chunksCount': 'chunksCount',
        '#updatedAt': 'updatedAt',
        ...(isImmediatelyIndexed ? { '#chunkCount': 'chunkCount' } : {}),
      },
      ExpressionAttributeValues: {
        ':s': isImmediatelyIndexed ? 'INDEXED' : 'CHUNKED',
        ':p': chunksPrefix,
        ':c': chunks.length,
        ':u': nowIso(),
        ...(isImmediatelyIndexed ? { ':cc': 0 } : {}),
      },
    }),
  );


  return {
    orgId,
    knowledgeBaseId,
    documentId,
    bucket,
    txtKey,
    chunksPrefix,
    chunksCount: chunks.length,
    items,
  };
};

export const handler = withSentryLambda(baseHandler);
