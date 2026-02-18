import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId } from '@/helpers/api';
import { getOrgIcon } from '@/helpers/org-icon';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'OrgId is missing' });

    const result = await getOrgIcon(orgId);

    if (!result) {
      return apiResponse(404, { message: 'No icon configured for this organization' });
    }

    return apiResponse(200, { ok: true, ...result });
  } catch (err) {
    console.error('Error in get-icon:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:read'))
    .use(httpErrorMiddleware()),
);