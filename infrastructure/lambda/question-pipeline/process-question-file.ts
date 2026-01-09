import { Context } from 'aws-lambda';
import { withSentryLambda } from '../sentry-lambda';
import { requireEnv } from '../helpers/env';
import { updateQuestionFile } from '../helpers/questionFile';
import { getTextractText } from '../helpers/textract';
import { uploadToS3 } from '../helpers/s3';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

interface Event {
  questionFileId?: string;
  projectId?: string;
  jobId?: string;
}

type Resp = { questionFileId: string; projectId: string; textFileKey: string }

// TODO Kate
export const baseHandler = async (event: Event, _ctx: Context): Promise<Resp> => {
  console.log('process-question-file event:', JSON.stringify(event));

  const { questionFileId, projectId, jobId } = event;

  if (!questionFileId || !projectId || !jobId) {
    throw new Error('questionFileId, projectId, jobId are required');
  }

  const { text, status } = await getTextractText(jobId);

  if (status !== 'SUCCEEDED') {
    await updateQuestionFile(projectId, questionFileId, { status: 'FAILED' });
    throw new Error(`Textract job failed: status=${status}`);
  }

  const textFileKey = `${jobId}/${projectId}/${questionFileId}.txt`;

  await uploadToS3(DOCUMENTS_BUCKET, textFileKey, text, 'text/plain; charset=utf-8');

  await updateQuestionFile(projectId, questionFileId, { status: 'TEXT_READY', textFileKey });

  return { questionFileId, projectId, textFileKey };
};

export const handler = withSentryLambda(baseHandler);
