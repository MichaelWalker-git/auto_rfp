import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { ArchiveNotificationDTOSchema } from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { archiveNotification } from '@/helpers/notification';
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
  const { success, data, error } = ArchiveNotificationDTOSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Invalid payload', issues: error.issues });

  const userId = event.auth?.userId;
  if (!userId) return apiResponse(401, { message: 'Unauthorized' });

  await archiveNotification(data.orgId, userId, data.notificationId);
  return apiResponse(200, { ok: true });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('notification:read'))
    .use(httpErrorMiddleware()),
);
