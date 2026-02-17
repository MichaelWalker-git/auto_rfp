import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { apiResponse, getOrgId } from '../helpers/api';
import { getUserKBAccessRecords } from '../helpers/user-kb';
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

    const userId = event.queryStringParameters?.userId;
    if (!userId) return apiResponse(400, { message: 'userId is required' });

    const records = await getUserKBAccessRecords(userId);
    // Filter to only records belonging to this org
    const orgRecords = records.filter((r) => r.orgId === orgId);

    return apiResponse(200, { records: orgRecords });
  } catch (err) {
    console.error('Error getting user KB access:', err);
    return apiResponse(500, { message: 'Failed to get user KB access' });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('kb:read'))
    .use(httpErrorMiddleware()),
);
