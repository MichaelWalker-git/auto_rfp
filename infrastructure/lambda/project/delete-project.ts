import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { apiResponse, getOrgId } from '../helpers/api';
import { deleteProjectAndRelatedEntities } from '../helpers/project-cleanup';
import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const { projectId } = event.pathParameters || {};
    const orgId = getOrgId(event);

    if (!orgId || !projectId) {
      return apiResponse(400, {
        message: 'Missing required parameters: orgId and projectId',
      });
    }

    const cleanup = await deleteProjectAndRelatedEntities(orgId, projectId);

    return apiResponse(200, {
      success: true,
      message: 'Project deleted successfully',
      orgId,
      projectId,
      cleanup,
    });
  } catch (err: any) {
    console.error('Error in deleteProject handler:', err);

    if (err?.name === 'ConditionalCheckFailedException') {
      return apiResponse(404, { message: 'Project not found' });
    }

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
    .use(requirePermission('project:delete'))
    .use(httpErrorMiddleware()),
);