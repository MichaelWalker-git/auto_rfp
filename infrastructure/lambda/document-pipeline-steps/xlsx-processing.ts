import * as XLSX from 'xlsx';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { PK_NAME, SK_NAME } from '../constants/common';
import { DOCUMENT_PK } from '../constants/document';
import { withSentryLambda } from '../sentry-lambda';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';
import { buildDocumentSK } from '../helpers/document';
import { getFileFromS3, uploadToS3 } from '../helpers/s3';
import { nowIso } from '../helpers/date';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

interface XlsxProcessingEvent {
  documentId: string;
  knowledgeBaseId: string;
  orgId: string;
  fileKey: string;
}

const streamToBuffer = async (stream: any) => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
};

/**
 * Convert an XLSX/XLS workbook to plain text.
 * Each sheet is separated by a header line, and rows are tab-separated.
 */
function workbookToText(workbook: XLSX.WorkBook): string {
  const lines: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    lines.push(`\n=== Sheet: ${sheetName} ===\n`);

    const rows: string[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });

    for (const row of rows) {
      const line = row.map((cell) => String(cell ?? '').trim()).join('\t');
      if (line.trim()) lines.push(line);
    }
  }

  return lines.join('\n');
}

const baseHandler = async (event: XlsxProcessingEvent) => {
  console.log('xlsx-processing event:', JSON.stringify(event));

  const { documentId, knowledgeBaseId, orgId, fileKey } = event;

  // Download file from S3
  const body = await getFileFromS3(DOCUMENTS_BUCKET, fileKey);
  const buf = await streamToBuffer(body);

  // Convert XLSX to text
  const workbook = XLSX.read(buf, { type: 'buffer' });
  const text = workbookToText(workbook);

  // Upload text to S3
  const textFileKey = `${fileKey}.txt`;
  await uploadToS3(DOCUMENTS_BUCKET, textFileKey, text, 'text/plain; charset=utf-8');

  // Update DynamoDB
  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: DOCUMENT_PK,
        [SK_NAME]: buildDocumentSK(knowledgeBaseId, documentId),
      },
      UpdateExpression: 'SET #indexStatus = :status, #textFileKey = :textFileKey, #updatedAt = :now',
      ExpressionAttributeNames: {
        '#indexStatus': 'indexStatus',
        '#textFileKey': 'textFileKey',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':status': 'TEXT_EXTRACTED',
        ':textFileKey': textFileKey,
        ':now': nowIso(),
      },
    }),
  );

  return {
    documentId,
    knowledgeBaseId,
    orgId,
    textFileKey,
  };
};

export const handler = withSentryLambda(baseHandler);
