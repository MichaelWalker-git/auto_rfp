import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse } from '@/helpers/api';
import { getNotificationPreferences } from '@/helpers/notification';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { orgId } = event.queryStringParameters ?? {};
  const userId = event.auth?.userId;

  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!userId) return apiResponse(401, { message: 'Unauthorized' });

  const prefs = await getNotificationPreferences(orgId, userId);
  // Return defaults if no prefs stored yet — in-app on, all other channels off
  return apiResponse(200, prefs ?? { email: false, inApp: true, slack: false, sms: false, frequency: 'immediate' });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('notification:read'))
    .use(httpErrorMiddleware()),
);
