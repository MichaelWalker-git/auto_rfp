import { apiResponse, getOrgId } from '@/helpers/api';
import { getProjectAccessUsers } from '@/helpers/user-project';
import { getProjectById } from '@/helpers/project';
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
    // Verify project exists and belongs to the requesting org
    const project = await getProjectById(projectId);
    if (!project) {
      return apiResponse(404, { message: 'Project not found' });
    }
    if (project.orgId !== orgId) {
      return apiResponse(403, { message: 'Access denied to this project' });
    }

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
