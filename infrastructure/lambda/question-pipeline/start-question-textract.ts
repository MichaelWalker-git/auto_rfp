import { StartDocumentTextDetectionCommand, TextractClient } from '@aws-sdk/client-textract';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';
import { withSentryLambda } from '../sentry-lambda';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';
import { buildQuestionFileSK, updateQuestionFile, checkQuestionFileCancelled } from '../helpers/questionFile';
import { SFNClient, SendTaskSuccessCommand } from '@aws-sdk/client-sfn';

const textract = new TextractClient({});

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const TEXTRACT_ROLE_ARN = requireEnv('TEXTRACT_ROLE_ARN');
const TEXTRACT_SNS_TOPIC_ARN = requireEnv('TEXTRACT_SNS_TOPIC_ARN');

export interface StartTextractEvent {
  taskToken: string;
  questionFileId: string;
  projectId: string;
  opportunityId: string;
  sourceFileKey?: string;
  mimeType?: string;
}

export interface StartTextractResp {
  jobId: string;
}

export const baseHandler = async (event: StartTextractEvent) => {
  const { questionFileId, projectId, opportunityId, taskToken } = event;
  const sfnClient = new SFNClient({ region: 'us-east-1' });

  console.log('event', event);

  if (!questionFileId || !projectId || !opportunityId)
    throw new Error('questionFileId, opportunityId and projectId required');

  const isCancelled = await checkQuestionFileCancelled(projectId, opportunityId, questionFileId);
  
  if (isCancelled) {    
    await sfnClient.send(new SendTaskSuccessCommand({
      taskToken,
      output: JSON.stringify({
        questionFileId,
        oppId: opportunityId,
        jobId: '',
        status: 'CANCELLED',
        cancelled: true,
      }),
    }));
    
    return { ok: true, cancelled: true };
  }

  const sk = buildQuestionFileSK(projectId, opportunityId, questionFileId);

  const { Item: item } = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: QUESTION_FILE_PK,
        [SK_NAME]: sk
      }
    })
  );

  if (!item) {
    console.log('Question file not found in DB - treating as cancelled');
    
    await sfnClient.send(new SendTaskSuccessCommand({
      taskToken,
      output: JSON.stringify({
        questionFileId,
        oppId: opportunityId,
        jobId: '',
        status: 'CANCELLED',
        cancelled: true,
      }),
    }));
    
    return { ok: true, cancelled: true };
  }

  console.log(`Question file found, status: ${item.status}`);

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
  
  const updateResult = await updateQuestionFile(projectId, opportunityId, questionFileId, { 
    status: 'TEXTRACT_RUNNING', 
    jobId, 
    taskToken 
  });

  if (updateResult.deleted) {
    await sfnClient.send(new SendTaskSuccessCommand({
      taskToken,
      output: JSON.stringify({
        questionFileId,
        oppId: opportunityId,
        jobId,
        status: 'CANCELLED',
        cancelled: true,
      }),
    }));
    
    return { ok: true, cancelled: true, deleted: true };
  }
  
  return { jobId } as StartTextractResp;
};

export const handler = withSentryLambda(baseHandler);
