import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse } from '@/helpers/api';
import { buildFoiaDashboard } from '@/helpers/foia-dashboard';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

/**
 * Org-wide FOIA comparison dashboard.
 *
 * Gated on `project:read` rather than `foia:send`: the requirement is that the charts
 * are viewable by all roles, and `foia:send` is a write permission held only by ADMIN
 * and EDITOR. `project:read` is in VIEWER_PERMISSIONS, so every role that can see the
 * organization can see the comparison. The response documents themselves are gated
 * separately, in the UI, on `foia:documents:read`.
 */
export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { orgId } = event.queryStringParameters ?? {};

  if (!orgId) {
    return apiResponse(400, { message: 'orgId is required' });
  }

  const dashboard = await buildFoiaDashboard(orgId);

  return apiResponse(200, { dashboard });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:read'))
    .use(httpErrorMiddleware()),
);
