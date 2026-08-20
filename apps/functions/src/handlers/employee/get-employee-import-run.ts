import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse } from '@/helpers/api';
import { getLatestImportRun } from '@/helpers/employee-import';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

/**
 * GET /employee/import/latest?orgId=... — the org's most recent import run,
 * or `run: null` when the org has never imported. Drives the progress banner
 * while RUNNING (BR5.1) and the completion report afterwards (BR4.1).
 */
export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { orgId } = event.queryStringParameters ?? {};
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const run = await getLatestImportRun(orgId);

  return apiResponse(200, { run });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('employee:read'))
    .use(httpErrorMiddleware()),
);
