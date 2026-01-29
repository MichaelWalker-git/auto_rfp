import mammoth from 'mammoth';
import { requireEnv } from '../helpers/env';
import { getFileFromS3, uploadToS3 } from '../helpers/s3';
import { withSentryLambda } from '../sentry-lambda';
import { updateQuestionFile, checkQuestionFileCancelled } from '../helpers/questionFile';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

const streamToBuffer = async (stream: any) => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
};

type Event = {
  opportunityId: string;
  projectId: string;
  questionFileId: string;
  sourceFileKey: string;
}

const baseHandler = async (event: Event) => {
  console.log('event', event);
  const { sourceFileKey, projectId, questionFileId, opportunityId } = event;

  const isCancelled = await checkQuestionFileCancelled(projectId, opportunityId, questionFileId);
  if (isCancelled) {
    console.log(`Pipeline cancelled for ${questionFileId}, skipping processing`);
    return { textFileKey: '', cancelled: true };
  }

  const body = await getFileFromS3(DOCUMENTS_BUCKET, sourceFileKey);

  const buf = await streamToBuffer(body);
  const { value: text } = await mammoth.extractRawText({ buffer: buf });

  const textFileKey = `pr/${projectId}/opp/${opportunityId}/qf/${questionFileId}.txt`;

  await uploadToS3(DOCUMENTS_BUCKET, textFileKey, text ?? '', 'text/plain; charset=utf-8');

  await updateQuestionFile(projectId, opportunityId, questionFileId, {
    status: 'TEXT_READY', 
    textFileKey 
  });

  return { textFileKey, cancelled: false };
};

export const handler = withSentryLambda(baseHandler);
