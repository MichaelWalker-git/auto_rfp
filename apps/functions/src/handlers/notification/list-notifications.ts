import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse } from '@/helpers/api';
import { listNotifications } from '@/helpers/notification';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { orgId, includeArchived } = event.queryStringParameters ?? {};
  const userId = event.auth?.userId;

  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!userId) return apiResponse(401, { message: 'Unauthorized' });

  const items = await listNotifications(orgId, userId, includeArchived === 'true');
  const unreadCount = items.filter((n) => !n.read).length;

  return apiResponse(200, { items, unreadCount, count: items.length });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('notification:read'))
    .use(httpErrorMiddleware()),
);
