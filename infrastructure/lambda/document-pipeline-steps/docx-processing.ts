import { Context } from 'aws-lambda';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { QueryCommand, UpdateCommand, } from '@aws-sdk/lib-dynamodb';

import * as mammoth from 'mammoth';

import { withSentryLambda } from '../sentry-lambda';
import { PK_NAME, SK_NAME } from '../constants/common';
import { DOCUMENT_PK } from '../constants/document';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';

const REGION = requireEnv('REGION')
const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME')
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET')

const s3 = new S3Client({ region: REGION });

interface DocxProcessingEvent {
  documentId?: string;
  // from start-processing.ts output
  fileKey?: string;
  bucket?: string; // optional override
}

function streamToBuffer(stream: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function buildTxtKeyNextToOriginal(originalKey: string): string {
  const clean = originalKey.split('?')[0];
  const idx = clean.lastIndexOf('.');
  if (idx === -1) return `${clean}.txt`;
  return `${clean.slice(0, idx)}.txt`;
}

async function findDocumentKeys(documentId: string) {
  const skSuffix = `#DOC#${documentId}`;

  const queryRes = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME!,
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: { '#pk': PK_NAME },
      ExpressionAttributeValues: { ':pk': DOCUMENT_PK },
    }),
  );

  const items = queryRes.Items || [];
  const item = items.find((it) => String((it as any)[SK_NAME]).endsWith(skSuffix)) as any;

  if (!item) throw new Error(`Document not found for documentId=${documentId}`);

  return { pk: item[PK_NAME], sk: item[SK_NAME], fileKey: item.fileKey as string | undefined };
}

export const baseHandler = async (
  event: DocxProcessingEvent,
  _ctx: Context,
): Promise<{
  documentId: string;
  status: 'TEXT_EXTRACTED';
  bucket: string;
  txtKey: string;
  textLength: number;
}> => {
  console.log('docx-processing event:', JSON.stringify(event));

  const documentId = event.documentId;
  if (!documentId) throw new Error('documentId is required');

  const bucket = event.bucket || DOCUMENTS_BUCKET;

  // Prefer fileKey from event (start-processing result), fallback to Dynamo
  let fileKey = event.fileKey;
  if (!fileKey) {
    const found = await findDocumentKeys(documentId);
    fileKey = found.fileKey;
    if (!fileKey) throw new Error(`Document ${documentId} has no fileKey in DynamoDB`);
  }

  // 1) Download DOCX
  const obj = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: fileKey,
    }),
  );

  const buf = await streamToBuffer(obj.Body as any);

  // 2) Convert DOCX -> text (mammoth)
  const res = await mammoth.extractRawText({ buffer: buf });
  const text = (res?.value || '').trim();

  if (!text) {
    throw new Error('DOCX extracted text is empty');
  }

  // 3) Store txt next to original
  const txtKey = buildTxtKeyNextToOriginal(fileKey);

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: txtKey,
      Body: Buffer.from(text, 'utf-8'),
      ContentType: 'text/plain; charset=utf-8',
    }),
  );

  // 4) Update Dynamo status + textFileKey
  try {
    const { pk, sk } = await findDocumentKeys(documentId);
    const now = new Date().toISOString();

    await docClient.send(
      new UpdateCommand({
        TableName: DB_TABLE_NAME!,
        Key: { [PK_NAME]: pk, [SK_NAME]: sk },
        UpdateExpression: 'SET #indexStatus = :s, #textFileKey = :t, #updatedAt = :u',
        ExpressionAttributeNames: {
          '#indexStatus': 'indexStatus',
          '#textFileKey': 'textFileKey',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':s': 'TEXT_EXTRACTED',
          ':t': txtKey,
          ':u': now,
        },
      }),
    );
  } catch (e) {
    console.warn('Failed to update Dynamo status/textFileKey (continuing):', e);
  }

  // 5) Return payload for the NEXT step (chunking lambda)
  return {
    documentId,
    status: 'TEXT_EXTRACTED',
    bucket,
    txtKey,
    textLength: text.length,
  };
};

export const handler = withSentryLambda(baseHandler);
