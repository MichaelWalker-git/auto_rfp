import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse } from '@/helpers/api';
import { getFoiaAutomation } from '@/helpers/foia-automation';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { orgId, projectId, oppId } = event.queryStringParameters ?? {};

  if (!orgId || !projectId || !oppId) {
    return apiResponse(400, {
      message: 'Missing required query parameters: orgId, projectId, and oppId',
    });
  }

  const automation = await getFoiaAutomation(orgId, projectId, oppId);

  return apiResponse(200, { automation });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:read'))
    .use(httpErrorMiddleware()),
);
