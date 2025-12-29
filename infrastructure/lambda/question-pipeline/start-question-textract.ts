import { StartDocumentTextDetectionCommand, TextractClient } from '@aws-sdk/client-textract';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';
import { withSentryLambda } from '../sentry-lambda';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';

const textract = new TextractClient({});

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const TEXTRACT_ROLE_ARN = requireEnv('TEXTRACT_ROLE_ARN');
const TEXTRACT_SNS_TOPIC_ARN = requireEnv('TEXTRACT_SNS_TOPIC_ARN');

interface StartEvent {
  questionFileId: string;
  projectId: string;
  taskToken?: string;
}

export const baseHandler = async (event: StartEvent) => {
  const { questionFileId, projectId, taskToken } = event;

  if (!questionFileId || !projectId)
    throw new Error('questionFileId and projectId required');

  const sk = `${projectId}#${questionFileId}`;

  // load fileKey
  const res = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: QUESTION_FILE_PK,
        [SK_NAME]: sk
      }
    })
  );

  const item = res.Item;
  if (!item) throw new Error('question_file not found');

  const fileKey = item.fileKey;
  if (!fileKey) throw new Error('fileKey missing');

  const startRes = await textract.send(
    new StartDocumentTextDetectionCommand({
      DocumentLocation: {
        S3Object: { Bucket: DOCUMENTS_BUCKET, Name: fileKey }
      },
      NotificationChannel: {
        RoleArn: TEXTRACT_ROLE_ARN,
        SNSTopicArn: TEXTRACT_SNS_TOPIC_ARN
      },
      JobTag: questionFileId
    })
  );

  const jobId = startRes.JobId!;
  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: QUESTION_FILE_PK,
        [SK_NAME]: sk
      },
      UpdateExpression: 'SET #jobId = :j, #status = :s, #taskToken = :taskToken',
      ExpressionAttributeNames: {
        '#jobId': 'jobId',
        '#status': 'status',
        '#taskToken': 'taskToken',
      },
      ExpressionAttributeValues: {
        ':j': jobId,
        ':s': 'textract_running',
        ':taskToken': taskToken,
      }
    })
  );

  return { jobId };
};

export const handler = withSentryLambda(baseHandler);
