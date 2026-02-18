import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { apiResponse, getOrgId } from '@/helpers/api';
import { USER_PK } from '@/constants/user';
import { userSk } from '@/helpers/user';
import { withSentryLambda } from '@/sentry-lambda';
import { getItem } from '@/helpers/db';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const qs = event.queryStringParameters ?? {};
    const orgId = qs.orgId || getOrgId(event);
    const userId = qs.userId;

    if (!orgId) {
      return apiResponse(400, { message: 'orgId is required' });
    }

    if (!userId) {
      return apiResponse(400, { message: 'userId is required' });
    }

    const sk = userSk(orgId, userId);
    const user = await getItem(USER_PK, sk);

    if (!user) {
      return apiResponse(404, { message: 'User not found' });
    }

    return apiResponse(200, { ok: true, user });
  } catch (err) {
    console.error('Error in get-user:', err);
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
    .use(httpErrorMiddleware()),
);