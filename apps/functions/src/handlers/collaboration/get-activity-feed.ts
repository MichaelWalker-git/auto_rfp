import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse } from '@/helpers/api';
import { queryBySkPrefix } from '@/helpers/db';
import { PK } from '@/constants/collaboration';
import { buildActivitySK } from '@/helpers/collaboration';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import type { ActivityItem } from '@auto-rfp/core';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { orgId, projectId } = event.queryStringParameters ?? {};

  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!projectId) return apiResponse(400, { message: 'projectId is required' });

  // queryBySkPrefix returns items sorted by SK ascending; reverse for newest-first
  const items = await queryBySkPrefix<ActivityItem>(
    PK.ACTIVITY,
    buildActivitySK(orgId, projectId, '', ''),
  );

  return apiResponse(200, {
    items: items.reverse(),
    count: items.length,
  });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(httpErrorMiddleware()),
);
