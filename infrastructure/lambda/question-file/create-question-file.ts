import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';

import { apiResponse, getOrgId, getUserId } from '../helpers/api';

import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '../middleware/rbac-middleware';
import middy from '@middy/core';
import { createQuestionFile } from '../helpers/questionFile';
import { CreateQuestionFileRequestSchema } from '@auto-rfp/shared';

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) {
      return apiResponse(400, { message: 'OrgId is missing' });
    }
    const bodyRaw = JSON.parse(event.body || '{}');

    const { success, data, error } = CreateQuestionFileRequestSchema.safeParse(bodyRaw);
    if (!success) {
      return apiResponse(400, { message: error.message });
    }

    const created = await createQuestionFile(orgId, data);

    return apiResponse(201, created);
  } catch (err) {
    console.error('create-question-file error:', err);
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
    .use(requirePermission('question:create'))
    .use(httpErrorMiddleware())
);
