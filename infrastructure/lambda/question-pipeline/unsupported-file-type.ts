import { Context } from 'aws-lambda';
import { withSentryLambda } from '../sentry-lambda';
import { updateQuestionFile } from '../helpers/questionFile';

interface Event {
  projectId?: string;
  questionFileId?: string;
  oppId: string;
}

export const baseHandler = async (event: Event, _ctx: Context) => {
  const { questionFileId, projectId, oppId } = event;
  if (!questionFileId || !projectId || !oppId) throw new Error('questionFileId and projectId are required');

  await updateQuestionFile(projectId, oppId, questionFileId, { status: 'FAILED' });
  return { questionFileId, projectId, oppId };
};

export const handler = withSentryLambda(baseHandler);
