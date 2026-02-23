import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { QueryAuditLogsSchema } from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { queryAuditLogs } from '@/helpers/audit-log';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const raw = event.queryStringParameters ?? {};
  const { success, data, error } = QueryAuditLogsSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Invalid query parameters', issues: error.issues });

  const { items, nextToken } = await queryAuditLogs(data);

  return apiResponse(200, { items, count: items.length, nextToken });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('audit:read'))
    .use(httpErrorMiddleware()),
);
