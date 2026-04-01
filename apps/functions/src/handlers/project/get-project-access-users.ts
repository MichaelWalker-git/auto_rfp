import { apiResponse, getOrgId } from '@/helpers/api';
import { getProjectAccessUsers } from '@/helpers/user-project';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import middy from '@middy/core';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'Org Id is required' });

  const projectId = event.queryStringParameters?.projectId;
  if (!projectId) {
    return apiResponse(400, { message: 'projectId is required' });
  }

  try {
    const users = await getProjectAccessUsers(projectId);
    return apiResponse(200, { users, projectId });
  } catch (err) {
    const error = err as Error;
    console.error('Error getting project access users:', {
      projectId,
      orgId,
      errorName: error.name,
      errorMessage: error.message,
      stack: error.stack,
    });
    return apiResponse(500, { 
      message: 'Failed to get project access users',
      errorType: error.name,
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:read'))
    .use(httpErrorMiddleware()),
);
