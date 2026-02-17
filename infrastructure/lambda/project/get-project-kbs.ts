import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { apiResponse, getOrgId } from '../helpers/api';
import { getProjectKBLinks } from '../helpers/project-kb';
import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';
import middy from '@middy/core';

export const baseHandler = async (event: APIGatewayProxyEventV2) => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'Org Id is required' });

    const projectId = event.queryStringParameters?.projectId;
    if (!projectId) {
      return apiResponse(400, { message: 'projectId query parameter is required' });
    }

    const links = await getProjectKBLinks(projectId);

    // Filter to only links belonging to this org (security)
    const orgLinks = links.filter((l) => l.orgId === orgId);

    return apiResponse(200, orgLinks);
  } catch (err) {
    console.error('Error getting project KBs:', err);
    return apiResponse(500, { message: 'Failed to get project knowledge bases' });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:read'))
    .use(httpErrorMiddleware()),
);
