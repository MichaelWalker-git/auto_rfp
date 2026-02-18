import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '../../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import middy from '@middy/core';
import { createOrUpdateSubscription } from '@/helpers/calendar-subscription';

const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const orgId = event.pathParameters?.orgId;
  const authContext = (event as any).authContext;
  const userId = authContext?.userId || 'unknown';

  if (!orgId) {
    return apiResponse(400, { message: 'Missing orgId parameter' });
  }

  try {
    const subscription = await createOrUpdateSubscription(orgId, userId, true);
    
    return apiResponse(200, {
      ok: true,
      message: 'Subscription token regenerated. Previous URLs will no longer work.',
      subscription: {
        token: subscription.token,
        createdAt: subscription.createdAt,
      },
    });
  } catch (err) {
    console.error('regenerate-calendar-subscription error:', err);
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