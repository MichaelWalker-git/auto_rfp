import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '../../sentry-lambda';
import middy from '@middy/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '@/middleware/rbac-middleware';
import { getQuestionFileItem } from '@/helpers/questionFile';

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const { projectId, oppId, questionFileId } = event.queryStringParameters || {};

    if (!projectId || !questionFileId || !oppId) {
      return apiResponse(400, {
        message: 'projectId, questionFileId, oppId are required query parameters',
      });
    }

    const item = await getQuestionFileItem(projectId, oppId, questionFileId);

    if (!item) {
      return apiResponse(404, {
        message: 'Question file not found',
        projectId,
        questionFileId,
      });
    }

    return apiResponse(200, {
      questionFileId: item.id,
      projectId: item.projectId,
      status: item.status,
      fileKey: item.fileKey,
      textFileKey: item.textFileKey,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    });
  } catch (err) {
    console.error('get-question-file error:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('question:read'))
    .use(httpErrorMiddleware())
);
