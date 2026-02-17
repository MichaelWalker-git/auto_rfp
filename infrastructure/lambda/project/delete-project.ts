import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { apiResponse, getOrgId } from '../helpers/api';
import { deleteProjectAndRelatedEntities } from '../helpers/project-cleanup';
import { deleteAllLinksForProject } from '../helpers/project-kb';
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

    // Cascade: clean up any PROJECT_KB links for this project
    let deletedKBLinks = 0;
    try {
      deletedKBLinks = await deleteAllLinksForProject(projectId);
      if (deletedKBLinks > 0) {
        console.log(`Cascade deleted ${deletedKBLinks} PROJECT_KB links for projectId=${projectId}`);
      }
    } catch (cascadeErr) {
      console.warn('Failed to cascade delete PROJECT_KB links:', (cascadeErr as Error)?.message);
    }

    return apiResponse(200, {
      success: true,
      message: 'Project deleted successfully',
      orgId,
      projectId,
      cleanup: { ...cleanup, deletedKBLinks },
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