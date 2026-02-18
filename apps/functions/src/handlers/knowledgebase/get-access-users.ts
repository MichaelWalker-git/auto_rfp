import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { apiResponse, getOrgId } from '@/helpers/api';
import { getKBAccessUsers } from '@/helpers/user-kb';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import middy from '@middy/core';

export const baseHandler = async (event: APIGatewayProxyEventV2) => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'Org Id is required' });

    const kbId = event.queryStringParameters?.kbId;
    if (!kbId) return apiResponse(400, { message: 'kbId is required' });

    const users = await getKBAccessUsers(kbId);
    return apiResponse(200, { users });
  } catch (err) {
    console.error('Error getting KB access users:', err);
    return apiResponse(500, { message: 'Failed to get KB access users' });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('kb:read'))
    .use(httpErrorMiddleware()),
);
