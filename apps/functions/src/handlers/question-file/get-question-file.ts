import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { getQuestionFileItem } from '@/helpers/questionFile';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { projectId, oppId, questionFileId } = event.queryStringParameters ?? {};

  if (!projectId || !questionFileId || !oppId) {
    return apiResponse(400, { message: 'projectId, oppId and questionFileId are required query parameters' });
  }

  const item = await getQuestionFileItem(projectId, oppId, questionFileId);

  if (!item) {
    return apiResponse(404, { message: 'Question file not found', projectId, questionFileId });
  }

  return apiResponse(200, item);
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('question:read'))
    .use(httpErrorMiddleware()),
);
