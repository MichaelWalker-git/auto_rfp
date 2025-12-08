import { Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, } from '@aws-sdk/lib-dynamodb';
import { StartDocumentTextDetectionCommand, TextractClient, } from '@aws-sdk/client-textract';

import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const textractClient = new TextractClient({});

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;
const DOCUMENTS_BUCKET_NAME = process.env.DOCUMENTS_BUCKET_NAME;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;
const TEXTRACT_ROLE_ARN = process.env.TEXTRACT_ROLE_ARN;

if (!DB_TABLE_NAME) throw new Error('DB_TABLE_NAME env var is not set');
if (!DOCUMENTS_BUCKET_NAME) throw new Error('DOCUMENTS_BUCKET_NAME env var is not set');
if (!SNS_TOPIC_ARN) throw new Error('SNS_TOPIC_ARN env var is not set');
if (!TEXTRACT_ROLE_ARN) throw new Error('TEXTRACT_ROLE_ARN env var is not set');

interface StartEvent {
  questionFileId?: string;
  projectId?: string;
}

interface QuestionFileItem {
  fileKey?: string;
  fileType?: string;
  status?: string;
  [PK_NAME]: string;
  [SK_NAME]: string;
}

interface StartResult {
  questionFileId: string;
  projectId: string;
  jobId: string;
}

export const handler = async (
  event: StartEvent,
  _ctx: Context,
): Promise<StartResult> => {
  console.log('start-question-textract event:', JSON.stringify(event));

  const { questionFileId, projectId } = event;
  if (!questionFileId || !projectId) {
    throw new Error('questionFileId and projectId are required');
  }

  const sk = `${projectId}#${questionFileId}`;

  // 1) Load question_file record
  const res = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: QUESTION_FILE_PK,
        [SK_NAME]: sk,
      },
    }),
  );

  if (!res.Item) {
    throw new Error(
      `question_file not found for PK=${QUESTION_FILE_PK} SK=${sk}`,
    );
  }

  const item = res.Item as QuestionFileItem;
  const fileKey = item.fileKey;
  const fileType = item.fileType || 'pdf'; // default

  if (!fileKey) {
    throw new Error(
      `question_file ${questionFileId} does not have fileKey attribute`,
    );
  }

  if (fileType.toLowerCase() !== 'pdf') {
    // You can add other branches later (docx, txt, etc.)
    throw new Error(`Unsupported fileType=${fileType}, only pdf is supported for now`);
  }

  // 2) Start Textract
  // Use JobTag = questionFileId (for callback)
  const jobTag = questionFileId;

  console.log('Starting Textract for question file:', {
    bucket: DOCUMENTS_BUCKET_NAME,
    key: fileKey,
    snsTopic: SNS_TOPIC_ARN,
    textractRole: TEXTRACT_ROLE_ARN,
    jobTag,
  });

  const startRes = await textractClient.send(
    new StartDocumentTextDetectionCommand({
      DocumentLocation: {
        S3Object: {
          Bucket: DOCUMENTS_BUCKET_NAME,
          Name: fileKey,
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
    throw new Error('Textract did not return JobId');
  }

  // 3) Update status in question_file
  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: QUESTION_FILE_PK,
        [SK_NAME]: sk,
      },
      UpdateExpression:
        'SET #status = :status, #jobId = :jobId, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#jobId': 'jobId',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':status': 'textract_running',
        ':jobId': jobId,
        ':updatedAt': new Date().toISOString(),
      },
    }),
  );

  const result: StartResult = {
    questionFileId,
    projectId,
    jobId,
  };

  console.log('start-question-textract result:', JSON.stringify(result));
  return result;
};
