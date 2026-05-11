import { Context } from 'aws-lambda';
import { withSentryLambda } from '@/sentry-lambda';
import { updateQuestionFile } from '@/helpers/questionFile';

interface Event {
  projectId?: string;
  questionFileId?: string;
  opportunityId: string;
  sourceFileKey?: string;
  mimeType?: string;
}

const buildErrorMessage = (sourceFileKey?: string, mimeType?: string): string => {
  const lowerKey = (sourceFileKey ?? '').toLowerCase();
  const lowerMime = (mimeType ?? '').toLowerCase();
  const isLegacyDoc =
    lowerMime === 'application/msword' ||
    (lowerKey.endsWith('.doc') && !lowerKey.endsWith('.docx'));

  if (isLegacyDoc) {
    return 'Legacy .doc files are not supported. Please open the file in Word or Google Docs, save as .docx, and upload again.';
  }

  return 'Unsupported file type. Supported formats: PDF, DOCX, XLSX, XLS, PNG, JPEG, TIFF.';
};

export const baseHandler = async (event: Event, _ctx: Context) => {
  const { questionFileId, projectId, opportunityId, sourceFileKey, mimeType } = event;
  if (!questionFileId || !projectId || !opportunityId)
    throw new Error('projectId, opportunityId and questionFileId are required');

  const errorMessage = buildErrorMessage(sourceFileKey, mimeType);

  await updateQuestionFile(projectId, opportunityId, questionFileId, {
    status: 'FAILED',
    errorMessage,
  });
  return { questionFileId, projectId, oppId: opportunityId };
};

export const handler = withSentryLambda(baseHandler);
