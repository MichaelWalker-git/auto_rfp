import { Context } from 'aws-lambda';
import { UpdateCommand, } from '@aws-sdk/lib-dynamodb';

import { PK_NAME, SK_NAME } from '@/constants/common';
import { DOCUMENT_PK } from '@/constants/document';
import { withSentryLambda } from '@/sentry-lambda';
import { requireEnv } from '@/helpers/env';
import { docClient, getItem } from '@/helpers/db';
import { buildDocumentSK } from '@/helpers/document';
import { DocumentItem } from '@auto-rfp/core';
import { nowIso } from '@/helpers/date';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

type FileFormat = 'PDF' | 'DOCX' | 'XLSX' | 'UNKNOWN';

interface StartProcessingEvent {
  knowledgeBaseId: string;
  documentId: string;
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

  status: string;
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
  if (
    ct === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    ct === 'application/vnd.ms-excel' ||
    ext === 'xlsx' || ext === 'xls'
  ) {
    return { format: 'XLSX', ext };
  }

  return { format: 'UNKNOWN', ext };
}

const baseHandler = async (
  event: StartProcessingEvent,
  _context: Context,
): Promise<StartProcessingResult> => {
  console.log('start-processing event:', JSON.stringify(event));

  const { documentId, orgId, knowledgeBaseId } = event;

  if (!documentId || !knowledgeBaseId) {
    throw new Error('documentId is required');
  }

  const docItem = await getItem<DocumentItem>(DOCUMENT_PK, buildDocumentSK(knowledgeBaseId, documentId));

  if (!docItem) {
    throw new Error(`Document not found for PK=${DOCUMENT_PK} and SK=${buildDocumentSK(knowledgeBaseId, documentId)}`);
  }

  const fileKey = docItem.fileKey;
  if (!fileKey) {
    throw new Error(`Document ${documentId} does not have fileKey attribute in DynamoDB`);
  }

  const contentType: string | null =
    (typeof (docItem as any).contentType === 'string' && (docItem as any).contentType) ||
    (typeof (docItem as any).mimeType === 'string' && (docItem as any).mimeType) ||
    null;

  const { format, ext } = inferFormat(contentType ?? undefined, fileKey);

  const status = format === 'UNKNOWN' ? 'FAILED' : 'STARTED';

  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: DOCUMENT_PK,
        [SK_NAME]: buildDocumentSK(knowledgeBaseId, documentId),
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
        ':status': status,
        ':updatedAt': nowIso(),
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
    status,
  };

  console.log('start-processing result:', JSON.stringify(result));
  return result;
};

export const handler = withSentryLambda(baseHandler);
