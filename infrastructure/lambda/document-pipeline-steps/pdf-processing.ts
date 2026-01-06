import { Context } from 'aws-lambda';
import { QueryCommand, UpdateCommand, } from '@aws-sdk/lib-dynamodb';
import { StartDocumentTextDetectionCommand, TextractClient, } from '@aws-sdk/client-textract';

import { PK_NAME, SK_NAME } from '../constants/common';
import { DOCUMENT_PK } from '../constants/document';
import { DocumentItem } from '../schemas/document';
import { withSentryLambda } from '../sentry-lambda';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';

const REGION = requireEnv('REGION', 'us-east-1');
const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const TEXTRACT_SNS_TOPIC_ARN = requireEnv('TEXTRACT_SNS_TOPIC_ARN');
const TEXTRACT_ROLE_ARN = requireEnv('TEXTRACT_ROLE_ARN');

const textractClient = new TextractClient({ region: REGION });

interface PdfProcessingEvent {
  documentId?: string;
  knowledgeBaseId?: string; // optional; we can derive from SK
  taskToken?: string;
}

interface PdfProcessingResult {
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

  const documentId = event.documentId;
  if (!documentId) throw new Error('documentId is required');

  const taskToken = requireTaskToken(event.taskToken);

  // 1) Find document row (same approach you already use: query PK, then endsWith #DOC#id)
  const skSuffix = `#DOC#${documentId}`;

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
    })[];

  const docItem = items.find((it) => String(it[SK_NAME]).endsWith(skSuffix));
  if (!docItem) {
    throw new Error(`Document not found for PK=${DOCUMENT_PK} and SK ending with ${skSuffix}`);
  }

  const pk = docItem[PK_NAME];
  const sk = docItem[SK_NAME];

  const fileKey = docItem.fileKey;
  if (!fileKey) throw new Error(`Document ${documentId} has no fileKey`);

  // derive KB id from SK = "KB#<kbId>#DOC#<docId>" if possible
  let knowledgeBaseId: string | undefined = event.knowledgeBaseId;
  if (!knowledgeBaseId) {
    const skParts = String(sk).split('#'); // ["KB", "<kbId>", "DOC", "<docId>"]
    if (skParts.length >= 4) knowledgeBaseId = skParts[1];
  }

  // 2) Start Textract async for the PDF in S3
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

  // 3) Store taskToken + jobId + status in Dynamo so callback can complete SFN task
  const now = new Date().toISOString();

  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: pk,
        [SK_NAME]: sk,
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
        ':updatedAt': now,
      },
    }),
  );

  const result: PdfProcessingResult = {
    documentId,
    knowledgeBaseId,
    jobId,
    status: 'TEXTRACT_STARTED',
  };

  console.log('pdf-processing result:', JSON.stringify(result));
  return result;
};

export const handler = withSentryLambda(baseHandler);
