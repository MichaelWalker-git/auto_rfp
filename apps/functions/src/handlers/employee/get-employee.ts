import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse } from '@/helpers/api';
import { getEmployee } from '@/helpers/employee';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

/**
 * GET /employee/get?orgId=...&id=... — one employee within the org scope.
 * A record belonging to another org is a 404, never a disclosure (BR2.3).
 */
export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { orgId, id } = event.queryStringParameters ?? {};
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!id) return apiResponse(400, { message: 'id is required' });

  const item = await getEmployee(orgId, id);
  if (!item) return apiResponse(404, { message: 'Employee not found' });

  return apiResponse(200, { item });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('employee:read'))
    .use(httpErrorMiddleware()),
);
