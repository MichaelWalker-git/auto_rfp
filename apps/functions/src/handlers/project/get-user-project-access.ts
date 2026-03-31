import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { getUserProjectAccessRecords } from '@/helpers/user-project';
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
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'Org Id is required' });

    // Allow users to query their own access, admins can query any user
    const queryUserId = event.queryStringParameters?.userId;
    const currentUserId = getUserId(event);

    const userId = queryUserId || currentUserId;
    if (!userId) {
      return apiResponse(400, { message: 'userId is required' });
    }

    const projects = await getUserProjectAccessRecords(userId);

    // Filter to only projects in the current org
    const orgProjects = projects.filter((p) => p.orgId === orgId);

    return apiResponse(200, { projects: orgProjects, userId });
  } catch (err) {
    console.error('Error getting user project access:', err);
    return apiResponse(500, { message: 'Failed to get user project access' });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:read'))
    .use(httpErrorMiddleware()),
);
