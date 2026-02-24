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
import { deleteSubscription } from '@/helpers/calendar-subscription';

const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  const orgId = event.pathParameters?.orgId;

  if (!orgId) {
    return apiResponse(400, { message: 'Missing orgId parameter' });
  }

  try {
    await deleteSubscription(orgId);
    
    
    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'config',
      resourceId: 'calendar-subscription',
    });

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
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);