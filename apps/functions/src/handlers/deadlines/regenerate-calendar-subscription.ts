import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import middy from '@middy/core';
import { createOrUpdateSubscription } from '@/helpers/calendar-subscription';

const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  const orgId = event.pathParameters?.orgId;
  const authContext = (event as any).authContext;
  const userId = authContext?.userId || 'unknown';

  if (!orgId) {
    return apiResponse(400, { message: 'Missing orgId parameter' });
  }

  try {
    const subscription = await createOrUpdateSubscription(orgId, userId, true);
    
    
    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'config',
      resourceId: 'calendar-subscription',
    });

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
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);