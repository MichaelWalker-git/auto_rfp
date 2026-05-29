import { Context } from 'aws-lambda';
import { withSentryLambda } from '@/sentry-lambda';
import { requireEnv } from '@/helpers/env';
import { updateQuestionFile, checkQuestionFileCancelled } from '@/helpers/questionFile';
import { getTextractText } from '@/helpers/textract';
import { uploadToS3 } from '@/helpers/s3';

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

  // Validate required fields with specific error messages (AUTO-RFP-4P)
  const missingFields: string[] = [];
  if (!projectId) missingFields.push('projectId');
  if (!questionFileId) missingFields.push('questionFileId');
  if (!jobId) missingFields.push('jobId');
  if (!opportunityId) missingFields.push('opportunityId');

  if (missingFields.length > 0) {
    throw new Error(
      `Missing required fields: ${missingFields.join(', ')}. ` +
      `Received: projectId=${projectId ?? 'undefined'}, questionFileId=${questionFileId ?? 'undefined'}, ` +
      `jobId=${jobId ?? 'undefined'}, opportunityId=${opportunityId ?? 'undefined'}`
    );
  }

  // After validation, TypeScript needs type narrowing
  const validProjectId = projectId as string;
  const validQuestionFileId = questionFileId as string;
  const validJobId = jobId as string;
  const validOpportunityId = opportunityId as string;

  const isCancelled = await checkQuestionFileCancelled(validProjectId, validOpportunityId, validQuestionFileId);

  if (isCancelled) {
    console.log(`Pipeline cancelled for ${validQuestionFileId}, skipping processing`);
    return {
      questionFileId: validQuestionFileId,
      projectId: validProjectId,
      textFileKey: '', // Empty key since we didn't process
      cancelled: true, // Flag for Step Function
    };
  }

  const { text, status } = await getTextractText(validJobId);

  if (status !== 'SUCCEEDED') {
    await updateQuestionFile(validProjectId, validOpportunityId, validQuestionFileId, { status: 'FAILED' });
    throw new Error(`Textract job failed: status=${status}`);
  }

  const textFileKey = `${validJobId}/${validProjectId}/${validQuestionFileId}.txt`;

  await uploadToS3(DOCUMENTS_BUCKET, textFileKey, text, 'text/plain; charset=utf-8');

  await updateQuestionFile(validProjectId, validOpportunityId, validQuestionFileId, { status: 'TEXT_READY', textFileKey });

  return { questionFileId: validQuestionFileId, projectId: validProjectId, textFileKey, cancelled: false };
};

export const handler = withSentryLambda(baseHandler);
