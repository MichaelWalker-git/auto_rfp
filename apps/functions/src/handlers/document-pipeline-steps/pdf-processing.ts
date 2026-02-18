import { Context } from 'aws-lambda';
import { UpdateCommand, } from '@aws-sdk/lib-dynamodb';
import { StartDocumentTextDetectionCommand, TextractClient, } from '@aws-sdk/client-textract';

import { PK_NAME, SK_NAME } from '@/constants/common';
import { DOCUMENT_PK } from '@/constants/document';
import { DocumentItem } from '@auto-rfp/core';
import { withSentryLambda } from '@/sentry-lambda';
import { requireEnv } from '@/helpers/env';
import { docClient, getItem } from '@/helpers/db';
import { nowIso } from '@/helpers/date';
import { buildDocumentSK } from '@/helpers/document';

const REGION = requireEnv('REGION', 'us-east-1');
const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const TEXTRACT_SNS_TOPIC_ARN = requireEnv('TEXTRACT_SNS_TOPIC_ARN');
const TEXTRACT_ROLE_ARN = requireEnv('TEXTRACT_ROLE_ARN');

const textractClient = new TextractClient({ region: REGION });

interface PdfProcessingEvent {
  orgId: string;
  documentId?: string;
  knowledgeBaseId: string;
  taskToken?: string;
}

interface PdfProcessingResult {
  orgId: string;
  documentId: string;
  knowledgeBaseId?: string;
  jobId: string;
  status: 'TEXTRACT_STARTED';
}

function requireTaskToken(token?: unknown): string {
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error(
      'taskToken is required (use IntegrationPattern.WAIT_FOR_TASK_TOKEN in Step Functions)',
    );
  }
  return token.trim();
}

export const baseHandler = async (
  event: PdfProcessingEvent,
  _context: Context,
): Promise<PdfProcessingResult> => {
  console.log('pdf-processing event:', JSON.stringify(event));

  const { documentId, orgId, knowledgeBaseId } = event;
  if (!documentId || !orgId || !knowledgeBaseId) {
    throw new Error('documentId is required');
  }

  const taskToken = requireTaskToken(event.taskToken);

  const docItem = await getItem<DocumentItem>(DOCUMENT_PK, buildDocumentSK(knowledgeBaseId, documentId));
  if (!docItem) {
    throw new Error(`Document not found for PK=${DOCUMENT_PK} and SK=${buildDocumentSK(knowledgeBaseId, documentId)}`);
  }

  const fileKey = docItem?.fileKey;
  if (!fileKey) throw new Error(`Document ${documentId} has no fileKey`);

  const startCmd = new StartDocumentTextDetectionCommand({
    DocumentLocation: {
      S3Object: {
        Bucket: DOCUMENTS_BUCKET,
        Name: fileKey,
      },
    },
    JobTag: documentId,
    NotificationChannel: {
      SNSTopicArn: TEXTRACT_SNS_TOPIC_ARN,
      RoleArn: TEXTRACT_ROLE_ARN,
    },
  });

  const startRes = await textractClient.send(startCmd);
  const jobId = startRes.JobId;

  if (!jobId) {
    throw new Error('Textract did not return JobId');
  }

  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: DOCUMENT_PK,
        [SK_NAME]: buildDocumentSK(knowledgeBaseId, documentId),
      },
      UpdateExpression:
        'SET #jobId = :jobId, #taskToken = :taskToken, #indexStatus = :status, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#jobId': 'jobId',
        '#taskToken': 'taskToken',
        '#indexStatus': 'indexStatus',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':jobId': jobId,
        ':taskToken': taskToken,
        ':status': 'TEXTRACT_STARTED',
        ':updatedAt': nowIso(),
      },
    }),
  );

  const result: PdfProcessingResult = {
    orgId,
    documentId,
    knowledgeBaseId,
    jobId,
    status: 'TEXTRACT_STARTED',
  };

  console.log('pdf-processing result:', JSON.stringify(result));
  return result;
};

export const handler = withSentryLambda(baseHandler);
