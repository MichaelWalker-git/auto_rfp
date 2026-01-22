import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { getProjectById } from '../helpers/project';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '../middleware/rbac-middleware';
import middy from '@middy/core';

export const baseHandler = async (event: APIGatewayProxyEventV2,): Promise<APIGatewayProxyResultV2> => {
  try {
    const { id: projectId } = event.pathParameters || {};

    if (!projectId) {
      return apiResponse(400, {
        message: 'Missing required query parameter: projectId',
      });
    }

    const project = await getProjectById(projectId);

    if (!project) {
      return apiResponse(404, { message: 'Project not found' });
    }

    return apiResponse(200, project);
  } catch (err) {
    console.error('Error in getProjectById handler:', err);
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
    .use(requirePermission('project:read'))
    .use(httpErrorMiddleware())
);
