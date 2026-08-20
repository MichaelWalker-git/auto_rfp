import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse } from '@/helpers/api';
import { listEmployeesByOrg } from '@/helpers/employee';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

/**
 * GET /employee/list?orgId=... — org-scoped employee list (BR2.1, BR2.3, BR4.1).
 */
export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { orgId } = event.queryStringParameters ?? {};
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const items = await listEmployeesByOrg(orgId);

  return apiResponse(200, { items, count: items.length });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('employee:read'))
    .use(httpErrorMiddleware()),
);
