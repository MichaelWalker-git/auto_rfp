import { Context } from 'aws-lambda';
import { withSentryLambda } from '../sentry-lambda';
import { requireEnv } from '../helpers/env';
import { updateQuestionFile, checkQuestionFileCancelled } from '../helpers/questionFile';
import { getTextractText } from '../helpers/textract';
import { uploadToS3 } from '../helpers/s3';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

interface Event {
  projectId?: string;
  questionFileId?: string;
  opportunityId: string;
  jobId?: string;
}

type Resp = { 
  questionFileId: string; 
  projectId: string; 
  textFileKey: string; 
  cancelled: boolean;
}

export const baseHandler = async (event: Event, _ctx: Context): Promise<Resp> => {
  console.log('process-question-file event:', JSON.stringify(event));

  const { questionFileId, projectId, jobId, opportunityId } = event;

  if (!questionFileId || !projectId || !jobId || !opportunityId) {
    throw new Error('questionFileId, projectId, jobId, opportunityId are required');
  }

  const isCancelled = await checkQuestionFileCancelled(projectId, opportunityId, questionFileId);

  if (isCancelled) {
    console.log(`Pipeline cancelled for ${questionFileId}, skipping processing`);
    return {
      questionFileId,
      projectId,
      textFileKey: '', // Empty key since we didn't process
      cancelled: true, // Flag for Step Function
    };
  }

  const { text, status } = await getTextractText(jobId);

  if (status !== 'SUCCEEDED') {
    await updateQuestionFile(projectId, opportunityId, questionFileId,{ status: 'FAILED' });
    throw new Error(`Textract job failed: status=${status}`);
  }

  const textFileKey = `${jobId}/${projectId}/${questionFileId}.txt`;

  await uploadToS3(DOCUMENTS_BUCKET, textFileKey, text, 'text/plain; charset=utf-8');

  await updateQuestionFile(projectId, opportunityId, questionFileId, { status: 'TEXT_READY', textFileKey });

  return { questionFileId, projectId, textFileKey, cancelled: false };
};

export const handler = withSentryLambda(baseHandler);
