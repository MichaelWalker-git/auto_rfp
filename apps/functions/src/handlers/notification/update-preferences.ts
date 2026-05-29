import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { UpdateNotificationPreferencesDTOSchema } from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { getNotificationPreferences, upsertNotificationPreferences } from '@/helpers/notification';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const raw = JSON.parse(event.body ?? '{}') as unknown;
  const { success, data, error } = UpdateNotificationPreferencesDTOSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Invalid payload', issues: error.issues });

  const userId = event.auth?.userId;
  if (!userId) return apiResponse(401, { message: 'Unauthorized' });

  const existing = await getNotificationPreferences(data.orgId, userId);
  // Apply defaults for required boolean fields in case they are not yet stored
  const merged = {
    email: false,
    inApp: true,
    slack: false,
    sms: false,
    frequency: 'immediate' as const,
    ...existing,
    ...data,
    userId,
    orgId: data.orgId,
  };
  const saved = await upsertNotificationPreferences(merged);
  return apiResponse(200, saved);
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('notification:read'))
    .use(httpErrorMiddleware()),
);
