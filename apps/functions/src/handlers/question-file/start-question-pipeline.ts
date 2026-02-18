import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '../../sentry-lambda';
import { getQuestionFileItem, updateQuestionFile } from '@/helpers/questionFile';
import { startPipeline } from '@/helpers/solicitation';

type StartBody = {
  projectId?: string;
  questionFileId?: string;
  oppId?: string;
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  console.log('start-question-pipeline event:', JSON.stringify(event));

  const body: StartBody = JSON.parse(event.body || '');

  const { questionFileId, projectId, oppId } = body;

  if (!questionFileId || !projectId || !oppId) {
    return apiResponse(400, {
      message: 'questionFileId, oppId and projectId are required',
    });
  }

  try {
    const { fileKey, mimeType } = await getQuestionFileItem(projectId, oppId, questionFileId) || {};

    const { executionArn, startDate } = await startPipeline(
      projectId,
      oppId,
      questionFileId,
      fileKey,
      mimeType,
    );

    await updateQuestionFile(projectId, oppId, questionFileId, {
      status: 'PROCESSING',
      executionArn: executionArn, 
    });

    return apiResponse(202, {
      message: 'Question pipeline started',
      executionArn,
      startDate,
    });
  } catch (err: any) {
    console.error('Error starting question pipeline:', err);
    if (err?.name === 'ConditionalCheckFailedException') {
      return apiResponse(404, { message: 'Question file not found' });
    }
    return apiResponse(500, {
      message: 'Failed to start question pipeline',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(baseHandler);