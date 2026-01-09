import { Context } from 'aws-lambda';
import { withSentryLambda } from '../sentry-lambda';
import { updateQuestionFile } from '../helpers/questionFile';

interface Event {
  questionFileId?: string;
  projectId?: string;
}

// TODO Kate
export const baseHandler = async (event: Event, _ctx: Context) => {
  const { questionFileId, projectId } = event;
  if (!questionFileId || !projectId) throw new Error('questionFileId and projectId are required');

  await updateQuestionFile(projectId, questionFileId, { status: 'FAILED' });
  return { questionFileId, projectId };
};

export const handler = withSentryLambda(baseHandler);
