import { StartDocumentTextDetectionCommand, TextractClient } from '@aws-sdk/client-textract';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';
import { withSentryLambda } from '../sentry-lambda';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';
import { updateQuestionFile } from '../helpers/questionFile';

const textract = new TextractClient({});

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const TEXTRACT_ROLE_ARN = requireEnv('TEXTRACT_ROLE_ARN');
const TEXTRACT_SNS_TOPIC_ARN = requireEnv('TEXTRACT_SNS_TOPIC_ARN');

export interface StartTextractEvent {
  taskToken: string;
  questionFileId: string;
  projectId: string;
  sourceFileKey?: string;
  mimeType?: string;
}

export interface StartTextractResp {
  jobId: string;
}

// TODO Kate
export const baseHandler = async (event: StartTextractEvent) => {
  const { questionFileId, projectId, taskToken } = event;

  if (!questionFileId || !projectId)
    throw new Error('questionFileId and projectId required');

  const sk = `${projectId}#${questionFileId}`;

  const { Item: item } = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: QUESTION_FILE_PK,
        [SK_NAME]: sk
      }
    })
  );

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
  await updateQuestionFile(projectId, questionFileId, { status: 'TEXTRACT_RUNNING', jobId, taskToken });

  return { jobId } as StartTextractResp;
};

export const handler = withSentryLambda(baseHandler);
