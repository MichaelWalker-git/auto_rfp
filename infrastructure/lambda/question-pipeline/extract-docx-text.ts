import mammoth from 'mammoth';
import { requireEnv } from '../helpers/env';
import { getFileFromS3, uploadToS3 } from '../helpers/s3';
import { withSentryLambda } from '../sentry-lambda';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

const streamToBuffer = async (stream: any) => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
};

// TODO Kate
const baseHandler = async (event: {
  projectId: string;
  questionFileId: string;
  sourceFileKey: string; // key of the uploaded docx
}) => {
  const { sourceFileKey, projectId, questionFileId } = event;

  const body = await getFileFromS3(DOCUMENTS_BUCKET, sourceFileKey);

  const buf = await streamToBuffer(body);
  const { value: text } = await mammoth.extractRawText({ buffer: buf });

  const textFileKey = `projects/${projectId}/question-files/${questionFileId}/extracted.txt`;

  await uploadToS3(DOCUMENTS_BUCKET, textFileKey, text ?? '', 'text/plain; charset=utf-8');

  return { textFileKey };
};

export const handler = withSentryLambda(baseHandler);
