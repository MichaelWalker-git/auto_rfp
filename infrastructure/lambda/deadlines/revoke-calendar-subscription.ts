import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';
import middy from '@middy/core';
import { deleteSubscription } from '../helpers/calendar-subscription';

const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const orgId = event.pathParameters?.orgId;

  if (!orgId) {
    return apiResponse(400, { message: 'Missing orgId parameter' });
  }

  try {
    await deleteSubscription(orgId);
    
    return apiResponse(200, {
      ok: true,
      message: 'Subscription revoked. All calendar URLs for this organization are now invalid.',
    });
  } catch (err) {
    console.error('revoke-calendar-subscription error:', err);
    return apiResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:edit'))
    .use(httpErrorMiddleware())
);