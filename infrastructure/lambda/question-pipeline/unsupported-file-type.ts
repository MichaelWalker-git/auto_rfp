import { Context } from 'aws-lambda';
import { withSentryLambda } from '../sentry-lambda';
import { updateQuestionFile } from '../helpers/questionFile';

interface Event {
  projectId?: string;
  questionFileId?: string;
  opportunityId: string;
}

export const baseHandler = async (event: Event, _ctx: Context) => {
  const { questionFileId, projectId, opportunityId } = event;
  if (!questionFileId || !projectId || !opportunityId)
    throw new Error('projectId, opportunityId and questionFileId are required');

  await updateQuestionFile(projectId, opportunityId, questionFileId, { status: 'FAILED' });
  return { questionFileId, projectId, oppId: opportunityId };
};

export const handler = withSentryLambda(baseHandler);
