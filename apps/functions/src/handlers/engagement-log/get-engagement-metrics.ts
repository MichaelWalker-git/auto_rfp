import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId } from '@/helpers/api';
import { calculateEngagementMetrics } from '@/helpers/engagement-log';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

const QuerySchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
});

const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) {
    return apiResponse(401, { ok: false, error: 'Unauthorized' });
  }

  const q = event.queryStringParameters ?? {};
  const { success, data, error: errors } = QuerySchema.safeParse(q);

  if (!success) {
    return apiResponse(400, {
      ok: false,
      error: 'Invalid query parameters',
      details: errors.flatten(),
    });
  }

  const { projectId, opportunityId } = data;

  const metrics = await calculateEngagementMetrics({
    orgId,
    projectId,
    opportunityId,
  });

  return apiResponse(200, {
    ok: true,
    projectId,
    opportunityId,
    metrics,
  });
};

export const handler = withSentryLambda(
  middy<APIGatewayProxyEventV2, APIGatewayProxyResultV2>(baseHandler)
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:read')),
);
