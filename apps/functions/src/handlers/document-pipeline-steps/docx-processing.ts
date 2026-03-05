import type { Context } from 'aws-lambda';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import * as mammoth from 'mammoth';

import { withSentryLambda } from '@/sentry-lambda';
import { DOCUMENT_PK } from '@/constants/document';
import { requireEnv } from '@/helpers/env';
import { getItem, updateItem } from '@/helpers/db';
import { nowIso } from '@/helpers/date';
import { DocumentItem } from '@auto-rfp/core';
import { buildDocumentSK } from '@/helpers/document';

// Resolved lazily so tests can set process.env before module-level code runs
const getRegion = () => requireEnv('REGION');
const getDocumentsBucket = () => requireEnv('DOCUMENTS_BUCKET');

const s3 = new S3Client({});

type DocxProcessingEvent = {
  orgId: string;
  knowledgeBaseId: string;
  documentId?: string;
  fileKey?: string;
  bucket?: string;
};

type DocxProcessingResult = {
  orgId: string;
  documentId: string;
  knowledgeBaseId: string;
  status: 'TEXT_EXTRACTED';
  bucket: string;
  txtKey: string;
  textLength: number;
};

const streamToBuffer = (stream: NodeJS.ReadableStream): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });

const buildTxtKeyNextToOriginal = (originalKey: string): string => {
  const clean = originalKey.split('?')[0] ?? originalKey;
  const idx = clean.lastIndexOf('.');
  return idx === -1 ? `${clean}.txt` : `${clean.slice(0, idx)}.txt`;
};

export const baseHandler = async (
  event: DocxProcessingEvent,
  _ctx: Context,
): Promise<DocxProcessingResult> => {
  const { orgId, knowledgeBaseId, documentId } = event;
  if (!documentId) throw new Error('documentId is required');

  const bucket = event.bucket ?? getDocumentsBucket();

  // Prefer fileKey from event (start-processing result), fallback to DynamoDB
  let fileKey = event.fileKey;
  if (!fileKey) {
    const doc = await getItem<DocumentItem>(DOCUMENT_PK, buildDocumentSK(knowledgeBaseId, documentId));
    fileKey = doc?.fileKey;
    if (!fileKey) throw new Error(`Document ${documentId} has no fileKey in DynamoDB`);
  }

  // 1. Download DOCX from S3
  const obj = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: fileKey }),
  );

  const buf = await streamToBuffer(obj.Body as NodeJS.ReadableStream);

  // 2. Convert DOCX → plain text via mammoth
  const { value: rawText } = await mammoth.extractRawText({ buffer: buf });
  const text = rawText.trim();

  if (!text) throw new Error('DOCX extracted text is empty');

  // 3. Store .txt file next to the original
  const txtKey = buildTxtKeyNextToOriginal(fileKey);

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: txtKey,
      Body: Buffer.from(text, 'utf-8'),
      ContentType: 'text/plain; charset=utf-8',
    }),
  );

  // 4. Update document status in DynamoDB
  try {
    await updateItem(
      DOCUMENT_PK,
      buildDocumentSK(knowledgeBaseId, documentId),
      { indexStatus: 'TEXT_EXTRACTED', textFileKey: txtKey, updatedAt: nowIso() },
      { condition: 'attribute_exists(#pk)', conditionNames: { '#pk': 'partition_key' } },
    );
  } catch (err) {
    console.warn('Failed to update DynamoDB status/textFileKey (continuing):', err);
  }

  // 5. Return payload for the next Step Function step (chunking)
  return {
    orgId,
    documentId,
    knowledgeBaseId,
    status: 'TEXT_EXTRACTED',
    bucket,
    txtKey,
    textLength: text.length,
  };
};

export const handler = withSentryLambda(baseHandler);
