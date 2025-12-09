import { Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, } from '@aws-sdk/lib-dynamodb';
import { StartDocumentTextDetectionCommand, TextractClient, } from '@aws-sdk/client-textract';

import { PK_NAME, SK_NAME } from '../constants/common';
import { DOCUMENT_PK } from '../constants/document';
import { DocumentItem } from '../schemas/document';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const textractClient = new TextractClient({});

// Use the same env var as your app table
const DB_TABLE_NAME = process.env.DB_TABLE_NAME;
const DOCUMENTS_BUCKET_NAME = process.env.DOCUMENTS_BUCKET_NAME;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;
const TEXTRACT_ROLE_ARN = process.env.TEXTRACT_ROLE_ARN;

if (!DB_TABLE_NAME) {
  throw new Error('DB_TABLE_NAME env var is not set');
}
if (!DOCUMENTS_BUCKET_NAME) {
  throw new Error('DOCUMENTS_BUCKET_NAME env var is not set');
}
if (!SNS_TOPIC_ARN) {
  throw new Error('SNS_TOPIC_ARN env var is not set');
}
if (!TEXTRACT_ROLE_ARN) {
  throw new Error('TEXTRACT_ROLE_ARN env var is not set');
}

interface StartTextractEvent {
  documentId?: string;
  // Provided by Step Functions callback pattern
  taskToken?: string;
}

interface StartTextractResult {
  jobId: string;
  documentId: string;
  knowledgeBaseId?: string;
  status: 'STARTED';
}

export const handler = async (
  event: StartTextractEvent,
  _context: Context,
): Promise<StartTextractResult> => {
  console.log('start-textract event:', JSON.stringify(event));

  const { documentId, taskToken } = event;

  if (!documentId) {
    throw new Error('documentId is required');
  }
  if (!taskToken) {
    throw new Error('taskToken is required for callback pattern');
  }

  // Our SK pattern:
  const skSuffix = `#DOC#${documentId}`;

  // 1) Load document metadata from DynamoDB using:
  //    PK = DOCUMENT_PK
  //    and SK that *ends with* the suffix above (checked in code)
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
    })[];

  const docItem = items.find((it) =>
    String(it[SK_NAME]).endsWith(skSuffix),
  );

  if (!docItem) {
    throw new Error(
      `Document not found for PK=${DOCUMENT_PK} and SK ending with ${skSuffix}`,
    );
  }

  const pk = docItem[PK_NAME];
  const sk = docItem[SK_NAME];
  const s3Key = docItem.fileKey;

  if (!s3Key) {
    throw new Error(
      `Document ${documentId} does not have fileKey attribute in DynamoDB`,
    );
  }

  // optional: derive knowledgeBaseId from SK = "KB#<kbId>#DOC#<docId>"
  let knowledgeBaseId: string | undefined;
  const skParts = String(sk).split('#'); // ["KB", "<kbId>", "DOC", "<docId>"]
  if (skParts.length >= 4) {
    knowledgeBaseId = skParts[1];
  }

  // 2) Start Textract async job
  const jobTag = documentId; // under 64 chars

  console.log('Starting Textract job with params:', {
    bucket: DOCUMENTS_BUCKET_NAME,
    key: s3Key,
    snsTopic: SNS_TOPIC_ARN,
    textractRole: TEXTRACT_ROLE_ARN,
    jobTag,
    jobTagLength: jobTag.length,
  });

  const startRes = await textractClient.send(
    new StartDocumentTextDetectionCommand({
      DocumentLocation: {
        S3Object: {
          Bucket: DOCUMENTS_BUCKET_NAME,
          Name: s3Key,
        },
      },
      NotificationChannel: {
        SNSTopicArn: SNS_TOPIC_ARN,
        RoleArn: TEXTRACT_ROLE_ARN,
      },
      JobTag: jobTag,
    }),
  );

  const jobId = startRes.JobId;
  if (!jobId) {
    throw new Error('Textract did not return a JobId');
  }

  // 3) Update Dynamo – store jobId + indexStatus + taskToken using the same PK/SK
  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: pk,
        [SK_NAME]: sk,
      },
      UpdateExpression:
        'SET #jobId = :jobId, #indexStatus = :status, #taskToken = :taskToken, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#jobId': 'jobId',
        '#indexStatus': 'indexStatus',
        '#taskToken': 'taskToken',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':jobId': jobId,
        ':status': 'processing',
        ':taskToken': taskToken,
        ':updatedAt': new Date().toISOString(),
      },
    }),
  );

  const result: StartTextractResult = {
    documentId,
    jobId,
    knowledgeBaseId,
    status: 'STARTED',
  };

  console.log('start-textract result:', JSON.stringify(result));
  return result;
};
