import { Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, } from '@aws-sdk/lib-dynamodb';
import { GetDocumentTextDetectionCommand, TextractClient, } from '@aws-sdk/client-textract';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const textractClient = new TextractClient({});
const s3Client = new S3Client({});

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;
const DOCUMENTS_BUCKET_NAME = process.env.DOCUMENTS_BUCKET_NAME;

if (!DB_TABLE_NAME) throw new Error('DB_TABLE_NAME env var is not set');
if (!DOCUMENTS_BUCKET_NAME) throw new Error('DOCUMENTS_BUCKET_NAME env var is not set');

interface Event {
  questionFileId?: string;
  projectId?: string;
  jobId?: string;
}

interface GetTextractResult {
  text: string;
  status: string;
}

export const handler = async (
  event: Event,
  _ctx: Context,
): Promise<{ questionFileId: string; projectId: string; textFileKey: string }> => {
  console.log('process-question-file event:', JSON.stringify(event));

  const { questionFileId, projectId, jobId } = event;
  if (!questionFileId || !projectId || !jobId) {
    throw new Error('questionFileId, projectId, jobId are required');
  }

  // 1) Get text from Textract
  const { text, status } = await getTextractText(jobId);
  if (status !== 'SUCCEEDED') {
    console.warn(`Textract job ${jobId} finished with status=${status}`);
    await updateStatus(questionFileId, projectId, 'error');
    throw new Error(`Textract job failed with status=${status}`);
  }

  // 2) Save text to S3
  const textFileKey = `${jobId}/${projectId}/${questionFileId}.txt`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: DOCUMENTS_BUCKET_NAME,
      Key: textFileKey,
      Body: text,
      ContentType: 'text/plain; charset=utf-8',
    }),
  );

  // 3) Update question_file with textFileKey + status
  await updateStatus(questionFileId, projectId, 'text_ready', textFileKey);

  return {
    questionFileId,
    projectId,
    textFileKey,
  };
};

async function getTextractText(jobId: string): Promise<GetTextractResult> {
  let nextToken: string | undefined;
  const lines: string[] = [];
  let jobStatus: string | undefined;

  do {
    const res: any = await textractClient.send(
      new GetDocumentTextDetectionCommand({
        JobId: jobId,
        NextToken: nextToken,
      }),
    );

    jobStatus = res.JobStatus;
    if (!jobStatus) return { text: '', status: 'UNKNOWN' };
    if (jobStatus !== 'SUCCEEDED') return { text: '', status: jobStatus };

    if (res.Blocks) {
      for (const block of res.Blocks) {
        if (block.BlockType === 'LINE' && block.Text) {
          lines.push(block.Text);
        }
      }
    }

    nextToken = res.NextToken;
  } while (nextToken);

  return { text: lines.join('\n'), status: jobStatus };
}

async function updateStatus(
  questionFileId: string,
  projectId: string,
  status: 'processing' | 'text_ready' | 'questions_extracted' | 'error',
  textFileKey?: string,
) {
  const sk = `${projectId}#${questionFileId}`;

  const updateExpressions = ['#status = :status', '#updatedAt = :updatedAt'];
  const exprNames: Record<string, string> = {
    '#status': 'status',
    '#updatedAt': 'updatedAt',
  };
  const exprValues: Record<string, any> = {
    ':status': status,
    ':updatedAt': new Date().toISOString(),
  };

  if (textFileKey) {
    updateExpressions.push('#textFileKey = :textFileKey');
    exprNames['#textFileKey'] = 'textFileKey';
    exprValues[':textFileKey'] = textFileKey;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: QUESTION_FILE_PK,
        [SK_NAME]: sk,
      },
      UpdateExpression: 'SET ' + updateExpressions.join(', '),
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprValues,
    }),
  );
}
