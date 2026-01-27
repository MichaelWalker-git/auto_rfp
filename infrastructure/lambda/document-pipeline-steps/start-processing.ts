import { Context } from 'aws-lambda';
import { QueryCommand, UpdateCommand, } from '@aws-sdk/lib-dynamodb';

import { PK_NAME, SK_NAME } from '../constants/common';
import { DOCUMENT_PK } from '../constants/document';
import { DocumentItem } from '../schemas/document';
import { withSentryLambda } from '../sentry-lambda';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

type FileFormat = 'PDF' | 'DOCX' | 'UNKNOWN';

interface StartProcessingEvent {
  documentId?: string;
  orgId: string;
}

interface StartProcessingResult {
  orgId: string;
  documentId: string;
  knowledgeBaseId?: string;

  fileKey: string;
  contentType?: string | null;

  format: FileFormat;
  ext?: string | null;

  status: 'STARTED';
}

function inferExtFromKey(fileKey: string): string | null {
  const clean = fileKey.split('?')[0] ?? fileKey; // defensive if ever passed a presigned URL key by mistake
  const idx = clean.lastIndexOf('.');
  if (idx === -1) return null;
  const ext = clean.slice(idx + 1).trim().toLowerCase();
  return ext || null;
}

function inferFormat(contentType?: unknown, fileKey?: unknown): { format: FileFormat; ext: string | null } {
  const ct = typeof contentType === 'string' ? contentType.toLowerCase() : '';
  const key = typeof fileKey === 'string' ? fileKey : '';
  const ext = key ? inferExtFromKey(key) : null;

  if (ct === 'application/pdf' || ext === 'pdf') return { format: 'PDF', ext };
  if (
    ct === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  ) {
    return { format: 'DOCX', ext };
  }

  return { format: 'UNKNOWN', ext };
}

const baseHandler = async (
  event: StartProcessingEvent,
  _context: Context,
): Promise<StartProcessingResult> => {
  console.log('start-processing event:', JSON.stringify(event));

  const { documentId, orgId } = event;

  if (!documentId) {
    throw new Error('documentId is required');
  }

  // Same SK suffix strategy you use today :contentReference[oaicite:1]{index=1}
  const skSuffix = `#DOC#${documentId}`;

  // 1) Find document row
  const queryRes = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
      },
      ExpressionAttributeValues: {
        ':pk': DOCUMENT_PK,
      },
    }),
  );

  const items =
    (queryRes.Items || []) as (DocumentItem & {
      [PK_NAME]: string;
      [SK_NAME]: string;
      fileKey?: string;
      contentType?: string;
      mimeType?: string;
    })[];

  const docItem = items.find((it) => String(it[SK_NAME]).endsWith(skSuffix));

  if (!docItem) {
    throw new Error(`Document not found for PK=${DOCUMENT_PK} and SK ending with ${skSuffix}`);
  }

  const pk = docItem[PK_NAME];
  const sk = docItem[SK_NAME];

  const fileKey = docItem.fileKey;
  if (!fileKey) {
    throw new Error(`Document ${documentId} does not have fileKey attribute in DynamoDB`);
  }
  let knowledgeBaseId: string | undefined;
  const skParts = String(sk).split('#');
  if (skParts.length >= 4) knowledgeBaseId = skParts[1];

  // try both fields (your DB might store either)
  const contentType: string | null =
    (typeof (docItem as any).contentType === 'string' && (docItem as any).contentType) ||
    (typeof (docItem as any).mimeType === 'string' && (docItem as any).mimeType) ||
    null;

  const { format, ext } = inferFormat(contentType ?? undefined, fileKey);

  // 2) Update Dynamo: mark started
  // We also clear jobId/taskToken to avoid stale callback tokens.
  const now = new Date().toISOString();

  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: pk,
        [SK_NAME]: sk,
      },
      UpdateExpression:
        'SET #indexStatus = :status, #updatedAt = :updatedAt REMOVE #jobId, #taskToken',
      ExpressionAttributeNames: {
        '#indexStatus': 'indexStatus',
        '#updatedAt': 'updatedAt',
        '#jobId': 'jobId',
        '#taskToken': 'taskToken',
      },
      ExpressionAttributeValues: {
        ':status': 'STARTED',
        ':updatedAt': now,
      },
    }),
  );

  const result: StartProcessingResult = {
    documentId,
    orgId,
    knowledgeBaseId,
    fileKey,
    contentType,
    format,
    ext,
    status: 'STARTED',
  };

  console.log('start-processing result:', JSON.stringify(result));
  return result;
};

export const handler = withSentryLambda(baseHandler);
